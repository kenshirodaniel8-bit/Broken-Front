// Web Audio engine. Every sound is synthesised procedurally (clearly
// temporary assets); any of them can be replaced by a recorded sample by
// listing it in assets/audio/manifest.json, e.g. { "explosion": "boom.ogg" }.
//
// Signal chain: sources -> (panner) -> sfx/amb bus -> muffle lowpass -> master
//                                  \-> reverb send (indoor/outdoor IR) -/
// Tinnitus bypasses the muffle so it rings through the blackout.

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.vol = { master: 0.8, sfx: 0.9, voice: 1, ambience: 0.7 };
    this.samples = new Map();
    this.loops = new Set();
    this.voices = [];
    this.onSubtitle = null;
    this.tts = typeof speechSynthesis !== 'undefined';
    this.ttsEnabled = true;
    this.quality = 'high';
    this.indoor = false;
  }

  // Must be called from a user gesture.
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.vol.master;
    this.master.connect(ctx.destination);
    this.muffleFilter = ctx.createBiquadFilter();
    this.muffleFilter.type = 'lowpass';
    this.muffleFilter.frequency.value = 20000;
    this.muffleFilter.Q.value = 0.7;
    this.muffleFilter.connect(this.master);
    this.sfx = ctx.createGain();
    this.sfx.gain.value = this.vol.sfx;
    this.sfx.connect(this.muffleFilter);
    this.amb = ctx.createGain();
    this.amb.gain.value = this.vol.ambience;
    this.amb.connect(this.muffleFilter);
    this.ui = ctx.createGain();
    this.ui.gain.value = 0.6;
    this.ui.connect(this.master);
    // Reverb: two impulse responses, crossfaded by indoor/outdoor.
    this.revIn = ctx.createConvolver();
    this.revIn.buffer = this.impulse(0.7, 2.5, false);
    this.revOut = ctx.createConvolver();
    this.revOut.buffer = this.impulse(2.2, 3.5, true);
    this.revInGain = ctx.createGain();
    this.revOutGain = ctx.createGain();
    this.revInGain.gain.value = 0;
    this.revOutGain.gain.value = 0.22;
    this.revSend = ctx.createGain();
    this.revSend.connect(this.revIn);
    this.revSend.connect(this.revOut);
    this.revIn.connect(this.revInGain).connect(this.muffleFilter);
    this.revOut.connect(this.revOutGain).connect(this.muffleFilter);
    this.sfx.connect(this.revSend);
    // Tinnitus.
    this.tinnitus = ctx.createOscillator();
    this.tinnitus.frequency.value = 6900;
    this.tinGain = ctx.createGain();
    this.tinGain.gain.value = 0;
    this.tinnitus.connect(this.tinGain).connect(this.master);
    this.tinnitus.start();
    this.noise = this.noiseBuffer(false);
    this.brown = this.noiseBuffer(true);
    this.loadManifest();
  }

  async loadManifest() {
    try {
      const res = await fetch('assets/audio/manifest.json', { cache: 'no-cache' });
      if (!res.ok) return;
      const manifest = await res.json();
      for (const [name, file] of Object.entries(manifest)) {
        try {
          const buf = await (await fetch(`assets/audio/${file}`)).arrayBuffer();
          this.samples.set(name, await this.ctx.decodeAudioData(buf));
        } catch { /* keep the procedural version */ }
      }
    } catch { /* no manifest: procedural audio only */ }
  }

  get ready() { return !!this.ctx; }
  get now() { return this.ctx ? this.ctx.currentTime : 0; }

  setVolumes(v) {
    Object.assign(this.vol, v);
    if (!this.ctx) return;
    this.master.gain.value = this.vol.master;
    this.sfx.gain.value = this.vol.sfx;
    this.amb.gain.value = this.vol.ambience;
  }

  noiseBuffer(brown) {
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
    }
    return buf;
  }

  impulse(seconds, decay, sparse) {
    const rate = this.ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = this.ctx.createBuffer(2, len, rate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        let v = (Math.random() * 2 - 1) * (1 - t) ** decay;
        if (sparse) v *= Math.random() < 0.08 ? 3 : 0.25; // street slap-back echoes
        d[i] = v;
      }
    }
    return buf;
  }

  setIndoor(indoor) {
    if (!this.ctx || indoor === this.indoor) return;
    this.indoor = indoor;
    const t = this.now;
    this.revInGain.gain.setTargetAtTime(indoor ? 0.45 : 0, t, 0.3);
    this.revOutGain.gain.setTargetAtTime(indoor ? 0.04 : 0.22, t, 0.3);
  }

  // 0 = clear hearing, 1 = deafened.
  muffle(amount, time = 0.2) {
    if (!this.ctx) return;
    const f = 20000 * Math.pow(220 / 20000, amount);
    this.muffleFilter.frequency.setTargetAtTime(f, this.now, time);
  }

  ringing(level, time = 0.3) {
    if (!this.ctx) return;
    this.tinGain.gain.setTargetAtTime(level * 0.06, this.now, time);
  }

  setListener(pos, fwd, up) {
    if (!this.ctx) return;
    const L = this.ctx.listener;
    if (L.positionX) {
      const t = this.now;
      L.positionX.setTargetAtTime(pos.x, t, 0.02); L.positionY.setTargetAtTime(pos.y, t, 0.02); L.positionZ.setTargetAtTime(pos.z, t, 0.02);
      L.forwardX.setTargetAtTime(fwd.x, t, 0.02); L.forwardY.setTargetAtTime(fwd.y, t, 0.02); L.forwardZ.setTargetAtTime(fwd.z, t, 0.02);
      L.upX.setTargetAtTime(up.x, t, 0.02); L.upY.setTargetAtTime(up.y, t, 0.02); L.upZ.setTargetAtTime(up.z, t, 0.02);
    } else {
      L.setPosition(pos.x, pos.y, pos.z);
      L.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z);
    }
    this.listenerPos = pos;
  }

  // Output node for a sound: a panner at `pos`, or the bus directly.
  out(opts = {}) {
    const bus = opts.bus === 'amb' ? this.amb : opts.bus === 'ui' ? this.ui : this.sfx;
    if (!opts.pos) return bus;
    const p = this.ctx.createPanner();
    p.panningModel = this.quality === 'high' ? 'HRTF' : 'equalpower';
    p.distanceModel = 'inverse';
    p.refDistance = opts.ref || 3;
    p.rolloffFactor = opts.rolloff ?? 1.1;
    p.maxDistance = 600;
    if (p.positionX) { p.positionX.value = opts.pos.x; p.positionY.value = opts.pos.y; p.positionZ.value = opts.pos.z; } else p.setPosition(opts.pos.x, opts.pos.y, opts.pos.z);
    p.connect(bus);
    return p;
  }

  src(buffer, loop = false, rate = 1) {
    const s = this.ctx.createBufferSource();
    s.buffer = buffer;
    s.loop = loop;
    s.playbackRate.value = rate;
    if (loop) s.loopStart = Math.random();
    return s;
  }

  env(node, t, a, peak, d, sustain = 0) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, sustain || 0.0001), t + a + d);
    node.connect(g);
    return g;
  }

  filter(type, freq, q = 1) {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  distanceDelay(pos) {
    if (!pos || !this.listenerPos) return 0;
    const d = Math.hypot(pos.x - this.listenerPos.x, pos.y - this.listenerPos.y, pos.z - this.listenerPos.z);
    return d / 343;
  }

  // --- One-shots ---------------------------------------------------------------
  play(name, opts = {}) {
    if (!this.ctx) return;
    const t = this.now + (opts.delay || 0) + (opts.noDelay ? 0 : this.distanceDelay(opts.pos) * 0.6);
    const out = this.out(opts);
    const gain = opts.gain ?? 1;
    if (this.samples.has(name)) {
      const s = this.src(this.samples.get(name), false, opts.rate || 1);
      const g = this.ctx.createGain();
      g.gain.value = gain;
      s.connect(g).connect(out);
      s.start(t);
      return;
    }
    const gen = GEN[name];
    if (gen) gen(this, t, out, gain, opts);
  }

  // --- Loops: returns a handle { setGain, setPos, setRate, stop } -------------------
  loop(name, opts = {}) {
    if (!this.ctx) return NULL_LOOP;
    const out = this.out({ ...opts, bus: opts.bus || 'sfx' });
    const master = this.ctx.createGain();
    master.gain.value = 0;
    master.gain.setTargetAtTime(opts.gain ?? 1, this.now, opts.fade ?? 0.5);
    master.connect(out);
    let nodes;
    if (this.samples.has(name)) {
      const s = this.src(this.samples.get(name), true);
      s.connect(master);
      s.start();
      nodes = { stop: () => s.stop(), rate: (r) => { s.playbackRate.value = r; } };
    } else nodes = LOOPS[name](this, master, opts);
    const h = {
      setGain: (g, time = 0.3) => master.gain.setTargetAtTime(Math.max(0, g), this.now, time),
      setPos: (p) => {
        if (out.positionX) { out.positionX.setTargetAtTime(p.x, this.now, 0.05); out.positionY.setTargetAtTime(p.y, this.now, 0.05); out.positionZ.setTargetAtTime(p.z, this.now, 0.05); }
      },
      setRate: (r) => nodes.rate?.(r),
      stop: (fade = 0.4) => {
        master.gain.setTargetAtTime(0, this.now, fade / 3);
        setTimeout(() => { try { nodes.stop(); } catch { /* already stopped */ } master.disconnect(); }, fade * 1000 + 200);
        this.loops.delete(h);
      },
    };
    this.loops.add(h);
    return h;
  }

  stopAll() {
    for (const l of [...this.loops]) l.stop(0.2);
    if (this.tts) speechSynthesis.cancel();
  }

  // --- Voices --------------------------------------------------------------------
  // profile: { pitch, rate, lang, voiceURI }, opts: { pos, radio, shout }
  say(speaker, text, spoken, profile = {}, opts = {}) {
    this.onSubtitle?.(speaker, text, opts);
    if (opts.radio) this.play('radio_static', { gain: 0.5, bus: 'ui' });
    if (!this.ttsEnabled || !this.tts) {
      if (this.ctx) this.play('murmur', { pos: opts.pos, gain: opts.shout ? 1.2 : 0.7, duration: Math.min(4, 0.06 * (spoken || text).length) });
      return;
    }
    let vol = this.vol.voice;
    if (opts.pos && this.listenerPos) {
      const d = Math.hypot(opts.pos.x - this.listenerPos.x, opts.pos.z - this.listenerPos.z);
      vol *= Math.max(0.15, Math.min(1, 12 / (d + 4)));
    }
    if (this._muffled) vol *= 0.25;
    try {
      const u = new SpeechSynthesisUtterance((spoken || text).replace(/\(.*?\)/g, ''));
      const lang = spoken && profile.lang ? profile.lang : 'en-US';
      const voice = this.pickVoice(lang, profile.voiceURI, profile.pitch);
      if (voice) { u.voice = voice; u.lang = voice.lang; } else u.lang = lang;
      u.pitch = Math.max(0.1, Math.min(2, profile.pitch ?? 1));
      u.rate = Math.max(0.5, Math.min(1.6, (profile.rate ?? 1) * (opts.shout ? 1.15 : 1)));
      u.volume = Math.max(0, Math.min(1, vol));
      if (!opts.queue) speechSynthesis.cancel();
      speechSynthesis.speak(u);
    } catch { /* speech not available */ }
  }

  listVoices() {
    if (!this.tts) return [];
    try { return speechSynthesis.getVoices(); } catch { return []; }
  }

  pickVoice(lang, uri, pitch = 1) {
    const all = this.listVoices();
    if (!all.length) return null;
    if (uri) { const v = all.find((k) => k.voiceURI === uri); if (v) return v; }
    const base = lang.split('-')[0];
    const pool = all.filter((v) => v.lang === lang).concat(all.filter((v) => v.lang.startsWith(base) && v.lang !== lang));
    const list = pool.length ? pool : all.filter((v) => v.lang.startsWith('en'));
    if (!list.length) return all[0];
    // Spread different speakers over the available voices.
    return list[Math.floor(pitch * 7) % list.length];
  }

  setMuffledVoices(m) { this._muffled = m; }
}

const NULL_LOOP = { setGain() {}, setPos() {}, setRate() {}, stop() {} };

// --- Sound generators -----------------------------------------------------------
// Each one schedules nodes starting at time t into `out`.

const GEN = {
  explosion(A, t, out, gain, o) {
    const ctx = A.ctx;
    const big = o.big ? 1.6 : 1;
    const n = A.src(A.brown, false, 0.6);
    const lp = A.filter('lowpass', 900 * big);
    lp.frequency.setValueAtTime(2200, t);
    lp.frequency.exponentialRampToValueAtTime(140, t + 2.6 * big);
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) { const x = (i / 128) - 1; curve[i] = Math.tanh(x * 4); }
    shaper.curve = curve;
    n.connect(lp).connect(shaper);
    A.env(shaper, t, 0.006, 1.3 * gain, 3.2 * big).connect(out);
    n.start(t);
    n.stop(t + 4 * big);
    const sub = ctx.createOscillator();
    sub.frequency.setValueAtTime(70, t);
    sub.frequency.exponentialRampToValueAtTime(24, t + 1.8);
    A.env(sub, t, 0.004, 1.2 * gain, 2.2).connect(out);
    sub.start(t);
    sub.stop(t + 2.5);
    const cr = A.src(A.noise);
    const hp = A.filter('highpass', 2500);
    cr.connect(hp);
    A.env(hp, t, 0.002, 0.5 * gain, 0.4).connect(out);
    cr.start(t);
    cr.stop(t + 0.6);
  },
  gunshot(A, t, out, gain, o) {
    const ctx = A.ctx;
    const w = o.weapon || 'ar';
    const n = A.src(A.noise, false, 1 + Math.random() * 0.1);
    const bp = A.filter('bandpass', w === 'pistol' ? 2200 : w === 'shotgun' ? 900 : 1500, 0.6);
    n.connect(bp);
    A.env(bp, t, 0.001, 1.4 * gain, w === 'shotgun' ? 0.35 : 0.18).connect(out);
    n.start(t);
    n.stop(t + 0.5);
    const th = ctx.createOscillator();
    th.frequency.setValueAtTime(w === 'shotgun' ? 110 : 160, t);
    th.frequency.exponentialRampToValueAtTime(45, t + 0.15);
    A.env(th, t, 0.001, 0.9 * gain, 0.16).connect(out);
    th.start(t);
    th.stop(t + 0.25);
  },
  impact(A, t, out, gain) {
    const n = A.src(A.noise, false, 1.5);
    const bp = A.filter('bandpass', 3000, 1.2);
    n.connect(bp);
    A.env(bp, t, 0.001, 0.5 * gain, 0.06).connect(out);
    n.start(t);
    n.stop(t + 0.1);
  },
  whizz(A, t, out, gain) {
    const n = A.src(A.noise, false, 1);
    const bp = A.filter('bandpass', 4000, 3);
    bp.frequency.setValueAtTime(5000, t);
    bp.frequency.exponentialRampToValueAtTime(1800, t + 0.12);
    n.connect(bp);
    A.env(bp, t, 0.01, 0.6 * gain, 0.12).connect(out);
    n.start(t);
    n.stop(t + 0.2);
  },
  footstep(A, t, out, gain, o) {
    const surf = o.surface || 'concrete';
    const n = A.src(A.noise, false, 0.8 + Math.random() * 0.4);
    const f = { concrete: ['bandpass', 1100, 0.8], rubble: ['highpass', 1800, 0.5], glass: ['highpass', 4200, 0.4], wood: ['bandpass', 420, 1.2], grass: ['lowpass', 700, 0.5], metal: ['bandpass', 2600, 4] }[surf] || ['bandpass', 1000, 1];
    const fl = A.filter(f[0], f[1], f[2]);
    n.connect(fl);
    A.env(fl, t, 0.003, 0.32 * gain, surf === 'rubble' || surf === 'glass' ? 0.12 : 0.07).connect(out);
    n.start(t);
    n.stop(t + 0.2);
    if (surf === 'rubble' || surf === 'glass') {
      for (let i = 0; i < 3; i++) {
        const k = A.src(A.noise, false, 2);
        const h = A.filter('highpass', surf === 'glass' ? 6000 : 3000);
        k.connect(h);
        const tt = t + 0.02 + Math.random() * 0.08;
        A.env(h, tt, 0.001, 0.12 * gain, 0.02).connect(out);
        k.start(tt);
        k.stop(tt + 0.05);
      }
    }
  },
  debris(A, t, out, gain) {
    for (let i = 0; i < 18; i++) {
      const tt = t + Math.random() * 1.6;
      const k = A.src(A.brown, false, 1 + Math.random());
      const f = A.filter('bandpass', 200 + Math.random() * 1200, 1.5);
      k.connect(f);
      A.env(f, tt, 0.002, (0.2 + Math.random() * 0.5) * gain, 0.12).connect(out);
      k.start(tt);
      k.stop(tt + 0.2);
    }
  },
  collapse(A, t, out, gain) {
    const n = A.src(A.brown, false, 0.5);
    const lp = A.filter('lowpass', 400);
    n.connect(lp);
    const g = A.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(1.2 * gain, t + 0.8);
    g.gain.linearRampToValueAtTime(0.8 * gain, t + 3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 6);
    lp.connect(g).connect(out);
    n.start(t);
    n.stop(t + 6.2);
    GEN.debris(A, t + 0.5, out, gain * 0.8);
    GEN.debris(A, t + 2, out, gain * 0.6);
  },
  glass(A, t, out, gain) {
    for (let i = 0; i < 14; i++) {
      const tt = t + Math.random() * 0.5;
      const o = A.ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = 2500 + Math.random() * 5000;
      A.env(o, tt, 0.001, 0.08 * gain, 0.15 + Math.random() * 0.2).connect(out);
      o.start(tt);
      o.stop(tt + 0.5);
    }
    const n = A.src(A.noise);
    const hp = A.filter('highpass', 3500);
    n.connect(hp);
    A.env(hp, t, 0.002, 0.5 * gain, 0.35).connect(out);
    n.start(t);
    n.stop(t + 0.5);
  },
  radio_static(A, t, out, gain) {
    const n = A.src(A.noise);
    const bp = A.filter('bandpass', 2200, 0.7);
    n.connect(bp);
    A.env(bp, t, 0.01, 0.25 * gain, 0.35).connect(out);
    n.start(t);
    n.stop(t + 0.45);
  },
  phone_buzz(A, t, out, gain) {
    // GSM interference: 217 Hz pulse bursts.
    for (let b = 0; b < 3; b++) {
      const o = A.ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = 217;
      const tt = t + b * 0.28;
      A.env(o, tt, 0.002, 0.12 * gain, 0.12).connect(out);
      o.start(tt);
      o.stop(tt + 0.15);
    }
  },
  beep(A, t, out, gain, o) {
    const osc = A.ctx.createOscillator();
    osc.frequency.value = o.freq || 880;
    A.env(osc, t, 0.005, 0.15 * gain, o.len || 0.12).connect(out);
    osc.start(t);
    osc.stop(t + (o.len || 0.12) + 0.05);
  },
  ringback(A, t, out, gain) {
    const osc = A.ctx.createOscillator();
    osc.frequency.value = 425; // German ringback tone
    const g = A.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.12 * gain, t + 0.02);
    g.gain.setValueAtTime(0.12 * gain, t + 1);
    g.gain.linearRampToValueAtTime(0.0001, t + 1.02);
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + 1.1);
  },
  busy(A, t, out, gain) {
    for (let i = 0; i < 4; i++) GEN.beep(A, t + i * 0.48, out, gain, { freq: 425, len: 0.24 });
  },
  click(A, t, out, gain) { GEN.beep(A, t, out, gain * 0.6, { freq: 1800, len: 0.02 }); },
  heartbeat(A, t, out, gain) {
    for (const [dt, f] of [[0, 60], [0.22, 52]]) {
      const o = A.ctx.createOscillator();
      o.frequency.value = f;
      A.env(o, t + dt, 0.01, 0.8 * gain, 0.15).connect(out);
      o.start(t + dt);
      o.stop(t + dt + 0.25);
    }
  },
  pickup(A, t, out, gain) {
    const n = A.src(A.noise, false, 0.6);
    const bp = A.filter('bandpass', 1800, 1);
    n.connect(bp);
    A.env(bp, t, 0.01, 0.2 * gain, 0.15).connect(out);
    n.start(t);
    n.stop(t + 0.25);
  },
  rustle(A, t, out, gain) {
    for (let i = 0; i < 5; i++) GEN.pickup(A, t + i * 0.12 + Math.random() * 0.05, out, gain * 0.7);
  },
  drink(A, t, out, gain) {
    for (let i = 0; i < 3; i++) {
      const o = A.ctx.createOscillator();
      o.frequency.setValueAtTime(320, t + i * 0.35);
      o.frequency.exponentialRampToValueAtTime(160, t + i * 0.35 + 0.12);
      A.env(o, t + i * 0.35, 0.01, 0.25 * gain, 0.13).connect(out);
      o.start(t + i * 0.35);
      o.stop(t + i * 0.35 + 0.2);
    }
  },
  eat(A, t, out, gain) {
    for (let i = 0; i < 4; i++) GEN.impact(A, t + i * 0.25, out, gain * 0.5);
  },
  bandage(A, t, out, gain) {
    for (let i = 0; i < 4; i++) {
      const n = A.src(A.noise, false, 1.4);
      const bp = A.filter('bandpass', 2600, 2);
      n.connect(bp);
      A.env(bp, t + i * 0.3, 0.01, 0.25 * gain, 0.2).connect(out);
      n.start(t + i * 0.3);
      n.stop(t + i * 0.3 + 0.25);
    }
  },
  reload(A, t, out, gain) {
    GEN.beep(A, t, out, gain * 0.5, { freq: 900, len: 0.02 });
    GEN.impact(A, t + 0.4, out, gain);
    GEN.beep(A, t + 0.9, out, gain * 0.6, { freq: 1300, len: 0.03 });
  },
  empty(A, t, out, gain) { GEN.beep(A, t, out, gain * 0.5, { freq: 2200, len: 0.015 }); },
  scrape(A, t, out, gain) {
    const n = A.src(A.brown, false, 1.5);
    const bp = A.filter('bandpass', 700, 1);
    n.connect(bp);
    A.env(bp, t, 0.05, 0.5 * gain, 0.6).connect(out);
    n.start(t);
    n.stop(t + 0.8);
    GEN.debris(A, t + 0.2, out, gain * 0.3);
  },
  flare(A, t, out, gain) {
    GEN.gunshot(A, t, out, gain * 0.4, { weapon: 'pistol' });
    const n = A.src(A.noise);
    const hp = A.filter('highpass', 3000);
    n.connect(hp);
    A.env(hp, t + 0.05, 0.1, 0.25 * gain, 3).connect(out);
    n.start(t);
    n.stop(t + 3.5);
  },
  shout(A, t, out, gain, o) { GEN.murmur(A, t, out, gain * 1.4, { ...o, duration: 0.7, shout: true }); },
  murmur(A, t, out, gain, o) {
    // Formant-filtered buzz: a stand-in voice when speech synthesis is off.
    const dur = o.duration || 1.2;
    const osc = A.ctx.createOscillator();
    osc.type = 'sawtooth';
    const base = o.shout ? 220 : 140;
    osc.frequency.setValueAtTime(base, t);
    for (let k = 0.1; k < dur; k += 0.12) osc.frequency.linearRampToValueAtTime(base * (0.8 + Math.random() * 0.5), t + k);
    const f1 = A.filter('bandpass', 700, 4);
    const f2 = A.filter('bandpass', 1200, 5);
    osc.connect(f1);
    osc.connect(f2);
    const g = A.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    for (let k = 0; k < dur; k += 0.15) g.gain.linearRampToValueAtTime((Math.random() * 0.5 + 0.2) * gain * 0.4, t + k + 0.05);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    f1.connect(g);
    f2.connect(g);
    g.connect(out);
    osc.start(t);
    osc.stop(t + dur + 0.1);
  },
};

const LOOPS = {
  wind(A, out) {
    const n = A.src(A.brown, true, 0.5);
    const bp = A.filter('bandpass', 500, 0.6);
    const lfo = A.ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lg = A.ctx.createGain();
    lg.gain.value = 250;
    lfo.connect(lg).connect(bp.frequency);
    n.connect(bp).connect(out);
    n.start();
    lfo.start();
    return { stop: () => { n.stop(); lfo.stop(); } };
  },
  city(A, out) {
    // Traffic hum, distant voices and birdsong.
    const n = A.src(A.brown, true, 0.4);
    const lp = A.filter('lowpass', 350);
    const g = A.ctx.createGain();
    g.gain.value = 0.5;
    n.connect(lp).connect(g).connect(out);
    n.start();
    const chatter = A.src(A.noise, true, 1);
    const bp = A.filter('bandpass', 900, 3);
    const cg = A.ctx.createGain();
    cg.gain.value = 0.03;
    chatter.connect(bp).connect(cg).connect(out);
    chatter.start();
    let alive = true;
    const bird = () => {
      if (!alive) return;
      const t = A.now;
      for (let i = 0; i < 3 + Math.random() * 4; i++) {
        const o = A.ctx.createOscillator();
        const tt = t + i * 0.09;
        o.frequency.setValueAtTime(3000 + Math.random() * 1500, tt);
        o.frequency.exponentialRampToValueAtTime(2200 + Math.random() * 2000, tt + 0.07);
        A.env(o, tt, 0.005, 0.03, 0.07).connect(out);
        o.start(tt);
        o.stop(tt + 0.1);
      }
      setTimeout(bird, 1200 + Math.random() * 3500);
    };
    bird();
    return { stop: () => { alive = false; n.stop(); chatter.stop(); } };
  },
  fire(A, out) {
    const n = A.src(A.brown, true, 0.7);
    const lp = A.filter('lowpass', 300);
    const g = A.ctx.createGain();
    g.gain.value = 0.5;
    n.connect(lp).connect(g).connect(out);
    n.start();
    let alive = true;
    const crackle = () => {
      if (!alive) return;
      const t = A.now;
      for (let i = 0; i < 4; i++) {
        const k = A.src(A.noise, false, 2);
        const hp = A.filter('highpass', 2000 + Math.random() * 3000);
        k.connect(hp);
        const tt = t + Math.random() * 0.3;
        A.env(hp, tt, 0.001, 0.15 + Math.random() * 0.3, 0.02).connect(out);
        k.start(tt);
        k.stop(tt + 0.05);
      }
      setTimeout(crackle, 80 + Math.random() * 300);
    };
    crackle();
    return { stop: () => { alive = false; n.stop(); } };
  },
  jet(A, out) {
    const n = A.src(A.noise, true, 1);
    const b = A.src(A.brown, true, 0.8);
    const lp = A.filter('lowpass', 2400, 0.5);
    const hp = A.filter('highpass', 80);
    n.connect(lp);
    b.connect(lp);
    lp.connect(hp).connect(out);
    const whine = A.ctx.createOscillator();
    whine.frequency.value = 3200;
    const wg = A.ctx.createGain();
    wg.gain.value = 0.02;
    whine.connect(wg).connect(out);
    n.start(); b.start(); whine.start();
    return { stop: () => { n.stop(); b.stop(); whine.stop(); }, rate: (r) => { whine.frequency.value = 3200 * r; lp.frequency.value = 2400 * r; } };
  },
  heli(A, out) {
    const n = A.src(A.brown, true, 1);
    const lp = A.filter('lowpass', 500);
    const am = A.ctx.createGain();
    am.gain.value = 0.5;
    const lfo = A.ctx.createOscillator();
    lfo.type = 'triangle';
    lfo.frequency.value = 17;
    const lg = A.ctx.createGain();
    lg.gain.value = 0.5;
    lfo.connect(lg).connect(am.gain);
    n.connect(lp).connect(am).connect(out);
    const tur = A.ctx.createOscillator();
    tur.frequency.value = 1150;
    const tg = A.ctx.createGain();
    tg.gain.value = 0.015;
    tur.connect(tg).connect(out);
    n.start(); lfo.start(); tur.start();
    return { stop: () => { n.stop(); lfo.stop(); tur.stop(); }, rate: (r) => { lfo.frequency.value = 17 * r; } };
  },
  air_siren(A, out) {
    const o1 = A.ctx.createOscillator();
    const o2 = A.ctx.createOscillator();
    o1.type = 'sawtooth';
    o2.type = 'sawtooth';
    const lfo = A.ctx.createOscillator();
    lfo.frequency.value = 0.09;
    const lg = A.ctx.createGain();
    lg.gain.value = 140;
    o1.frequency.value = 440;
    o2.frequency.value = 446;
    lfo.connect(lg);
    lg.connect(o1.frequency);
    lg.connect(o2.frequency);
    const bp = A.filter('bandpass', 700, 0.8);
    const g = A.ctx.createGain();
    g.gain.value = 0.18;
    o1.connect(bp); o2.connect(bp);
    bp.connect(g).connect(out);
    o1.start(); o2.start(); lfo.start();
    return { stop: () => { o1.stop(); o2.stop(); lfo.stop(); } };
  },
  martinshorn(A, out) {
    // The German two-tone emergency horn (A4 / D5).
    const o = A.ctx.createOscillator();
    o.type = 'triangle';
    const t0 = A.now;
    for (let i = 0; i < 400; i++) o.frequency.setValueAtTime(i % 2 ? 587 : 440, t0 + i * 0.62);
    const g = A.ctx.createGain();
    g.gain.value = 0.12;
    o.connect(g).connect(out);
    o.start();
    return { stop: () => o.stop() };
  },
  panic(A, out) {
    const n = A.src(A.noise, true, 1);
    const f1 = A.filter('bandpass', 850, 4);
    const f2 = A.filter('bandpass', 1500, 4);
    const g = A.ctx.createGain();
    g.gain.value = 0.15;
    n.connect(f1); n.connect(f2); f1.connect(g); f2.connect(g); g.connect(out);
    n.start();
    let alive = true;
    const scream = () => {
      if (!alive) return;
      GEN.murmur(A, A.now, out, 0.35, { duration: 0.5 + Math.random() * 0.6, shout: true });
      setTimeout(scream, 300 + Math.random() * 1200);
    };
    scream();
    return { stop: () => { alive = false; n.stop(); } };
  },
  drone(A, out) {
    const o = A.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = 190;
    const o2 = A.ctx.createOscillator();
    o2.type = 'sawtooth';
    o2.frequency.value = 196;
    const lp = A.filter('lowpass', 1600);
    const g = A.ctx.createGain();
    g.gain.value = 0.08;
    o.connect(lp); o2.connect(lp); lp.connect(g).connect(out);
    o.start(); o2.start();
    return { stop: () => { o.stop(); o2.stop(); }, rate: (r) => { o.frequency.value = 190 * r; o2.frequency.value = 196 * r; } };
  },
  static(A, out) {
    const n = A.src(A.noise, true, 1);
    const bp = A.filter('bandpass', 2400, 0.8);
    const g = A.ctx.createGain();
    g.gain.value = 0.12;
    n.connect(bp).connect(g).connect(out);
    n.start();
    return { stop: () => n.stop() };
  },
  hiss(A, out) {
    const n = A.src(A.noise, true, 1);
    const hp = A.filter('highpass', 2500);
    const g = A.ctx.createGain();
    g.gain.value = 0.2;
    n.connect(hp).connect(g).connect(out);
    n.start();
    return { stop: () => n.stop() };
  },
  rumble(A, out) {
    const n = A.src(A.brown, true, 0.35);
    const lp = A.filter('lowpass', 120);
    n.connect(lp).connect(out);
    n.start();
    return { stop: () => n.stop() };
  },
};
