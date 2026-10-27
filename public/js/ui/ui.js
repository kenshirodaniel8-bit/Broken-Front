// UI facade used by the game: HUD, prompts, subtitles, toasts, screen effects
// and the stack of panels/dialogs. Panels live in their own modules.

import * as THREE from 'three';
import { h, $, clear, bar } from './dom.js';
import { MapRenderer } from './mapdraw.js';
import { formatClock, bearingDeg, yawTo, clamp, wrapAngle } from '../core/util.js';
import { condition, activeInjuries, INJURY_TYPES, maxStamina } from '../game/survival.js';
import { ITEMS, WEAPONS } from '../data/items.js';
import { objectiveText, activeObjectives, DAYS } from '../game/campaign.js';

export class UI {
  constructor(root) {
    this.root = root;
    this.game = null;
    this.flags = {};
    this.stack = []; // open panels/dialogs: { id, el, blocks, close }
    this.toasts = [];
    this.subs = [];
    this.hintTimer = 0;
    this.alertLevel = 0;
    this.build();
    window.addEventListener('keydown', (e) => this.onKey(e));
  }

  build() {
    const r = this.root;
    this.hud = h('div', { id: 'hud', hidden: true });
    this.el = {
      clock: h('div', { class: 'hud-clock' }),
      objectives: h('div', { class: 'hud-objectives' }),
      compass: h('div', { class: 'hud-compass' }, h('div', { class: 'strip' })),
      minimap: h('canvas', { class: 'hud-minimap', width: 200, height: 200 }),
      vitals: h('div', { class: 'hud-vitals' }),
      injuries: h('div', { class: 'hud-injuries' }),
      squad: h('div', { class: 'hud-squad' }),
      weapon: h('div', { class: 'hud-weapon' }),
      status: h('div', { class: 'hud-status' }),
      quick: h('div', { class: 'hud-quick' }),
      prompt: h('div', { class: 'hud-prompt', hidden: true }),
      subs: h('div', { class: 'hud-subs' }),
      toasts: h('div', { class: 'hud-toasts' }),
      crosshair: h('div', { class: 'crosshair' }),
      hit: h('div', { class: 'hitmarker' }),
      alert: h('div', { class: 'hud-alert' }),
      dmgDir: h('div', { class: 'dmg-dir' }),
      hint: h('div', { class: 'hud-hint', hidden: true }),
      prologueObj: h('div', { class: 'hud-prologue', hidden: true }),
    };
    this.hud.append(...Object.values(this.el));
    this.overlay = h('div', { id: 'overlay' }, h('div', { class: 'ov-red' }), h('div', { class: 'ov-dust' }), h('div', { class: 'ov-vignette' }), h('div', { class: 'ov-flash' }), h('div', { class: 'ov-hurt' }));
    this.fadeEl = h('div', { id: 'fade' });
    this.title = h('div', { id: 'title-card' });
    this.dayEl = h('div', { id: 'day-card' });
    this.droneHud = h('div', { id: 'drone-hud', hidden: true },
      h('div', { class: 'dh-frame' }), h('div', { class: 'dh-top' }), h('div', { class: 'dh-bottom' }), h('div', { class: 'dh-labels' }), h('canvas', { class: 'dh-static', width: 160, height: 90 }), h('div', { class: 'dh-cross' }));
    this.layer = h('div', { id: 'layer' });
    r.append(this.overlay, this.hud, this.droneHud, this.title, this.dayEl, this.layer, this.fadeEl);
    this.map = null;
  }

  attach(game) {
    this.game = game;
    this.map = new MapRenderer(game);
  }

  // --- Panels -------------------------------------------------------------------
  open(id, el, { blocks = true, onClose = null, captures = true } = {}) {
    this.close(id);
    const entry = { id, el, blocks, captures, onClose };
    this.stack.push(entry);
    this.layer.append(el);
    this.game?.input.releaseLock();
    return entry;
  }

  close(id) {
    const i = this.stack.findIndex((s) => s.id === id);
    if (i < 0) return false;
    const [e] = this.stack.splice(i, 1);
    e.el.remove();
    e.onClose?.();
    if (!this.stack.length && this.game && (this.game.mode === 'play' || this.game.mode === 'drone')) this.game.input.requestLock();
    return true;
  }

  closeTop() {
    const top = this.stack[this.stack.length - 1];
    if (top) this.close(top.id);
    return !!top;
  }

  isOpen(id) { return this.stack.some((s) => s.id === id); }
  anyOpen() { return this.stack.length > 0; }
  blocksWorld() { return this.stack.some((s) => s.blocks); }
  capturesInput() { return this.stack.some((s) => s.captures); }
  get phoneOpen() { return this.isOpen('phone'); }

  onKey(e) {
    const g = this.game;
    if (!g || !['play', 'drone', 'paused'].includes(g.mode)) {
      if (e.code === 'Escape' && this.stack.length && g && g.mode !== 'menu') this.closeTop();
      return;
    }
    if (e.target?.tagName === 'INPUT') return;
    if (e.code === 'Escape') {
      e.preventDefault();
      // Esc also releases pointer lock, which already opened the pause menu.
      if (performance.now() - (this.pauseOpenedAt || 0) < 400) return;
      if (!this.closeTop()) {
        if (g.mode === 'drone') g.drone.land(); else this.openPause();
      }
      return;
    }
    const inPrologue = g.prologue?.phase !== 'done';
    const map = { Tab: 'inventory', KeyI: 'inventory', KeyM: 'map', KeyJ: 'journal', KeyK: 'squad' };
    const tab = map[e.code];
    if (tab && g.mode === 'play' && !g.player.frozen) {
      e.preventDefault();
      if (inPrologue && tab !== 'inventory') return;
      if (this.isOpen('tactical') && this.tacticalTab === tab) this.close('tactical');
      else this.openTactical(tab);
      if (tab === 'inventory') this.flags.inventoryOpened = true;
    }
    if (e.code === 'KeyP' && this.isOpen('phone')) { this.close('phone'); e.preventDefault(); }
  }

  // Implemented by the panel modules (installed in main.js).
  openTactical() {}
  openPause() {}
  openPhone() {}
  openLoot() {}
  openTreat() {}
  openTeammate() {}
  openShop() {}
  openSleep() {}
  openStash() {}
  confirmShelter() {}
  readDocument() {}
  showDeath() {}
  showEnding() {}

  showHud(v) { this.hud.hidden = !v; }

  // --- Messages -------------------------------------------------------------------
  toast(text, kind = 'info') {
    const el = h('div', { class: `toast ${kind}` }, text);
    this.el.toasts.prepend(el);
    const ttl = kind === 'objective' || kind === 'clue' ? 7 : 4.5;
    this.toasts.push({ el, t: ttl });
    while (this.el.toasts.children.length > 4) this.el.toasts.lastChild.remove();
  }

  subtitle(speaker, text, opts = {}) {
    if (this.game && !this.game.settings.subtitles) return;
    const el = h('div', { class: `sub${opts.radio ? ' radio' : ''}${opts.shout ? ' shout' : ''}` }, h('b', {}, `${speaker}: `), text);
    this.el.subs.append(el);
    this.subs.push({ el, t: Math.min(9, 2.5 + text.length * 0.055) });
    while (this.el.subs.children.length > 3) { this.el.subs.firstChild.remove(); this.subs.shift(); }
  }

  hint(text, seconds) {
    if (this.game && !this.game.settings.hints) return;
    this.el.hint.hidden = !text;
    this.el.hint.textContent = text;
    this.hintTimer = seconds;
  }

  setPrologueObjective(text) {
    this.el.prologueObj.hidden = !text;
    this.el.prologueObj.textContent = text || '';
  }

  titleCard(title, sub) {
    clear(this.title).append(h('h1', {}, title), h('p', {}, sub));
    this.title.classList.remove('show');
    void this.title.offsetWidth;
    this.title.classList.add('show');
  }

  dayCard(day, title, brief) {
    clear(this.dayEl).append(h('div', { class: 'day' }, `DAY ${day}`), h('div', { class: 'title' }, title.toUpperCase()), h('div', { class: 'brief' }, brief));
    this.dayEl.classList.remove('show');
    void this.dayEl.offsetWidth;
    this.dayEl.classList.add('show');
    this.game?.audio.play('heartbeat', { bus: 'ui', gain: 0.5 });
  }

  setPrompt(p) {
    const el = this.el.prompt;
    if (!p) { el.hidden = true; return; }
    el.hidden = false;
    el.classList.toggle('disabled', !!p.disabled);
    el.classList.toggle('dim', !!p.dim);
    const key = p.disabled ? '' : p.hold ? 'Hold E' : 'E';
    clear(el).append(key ? h('span', { class: 'key' }, key) : '', h('span', {}, p.label));
    if (p.hold && !p.disabled) el.append(h('div', { class: 'progress' }, h('div', { style: { width: `${Math.round(p.progress * 100)}%` } })));
  }

  // --- Screen effects ------------------------------------------------------------------
  fade(to, seconds) {
    this.fadeTarget = to;
    this.fadeEl.style.transition = `opacity ${seconds}s ease`;
    this.fadeEl.style.opacity = String(to);
  }

  // Jumps every CSS transition to its end state (automated screenshots).
  settle() {
    this.fadeEl.style.transition = 'none';
    this.fadeEl.style.opacity = String(this.fadeTarget ?? 0);
    this.title.classList.remove('show');
    this.dayEl.classList.remove('show');
    this.hudTimer = 0;
    this.mapTimer = 0;
  }

  flash(strength, seconds) {
    const f = $('.ov-flash', this.overlay);
    f.style.transition = 'none';
    f.style.opacity = String(strength);
    void f.offsetWidth;
    f.style.transition = `opacity ${seconds}s ease-out`;
    f.style.opacity = '0';
  }

  setDamageOverlay({ red, dust, blur }) {
    if (red != null) $('.ov-red', this.overlay).style.opacity = String(red);
    if (dust != null) $('.ov-dust', this.overlay).style.opacity = String(dust);
    if (blur != null && this.game) this.game.canvas.style.filter = blur > 0.05 ? `blur(${blur.toFixed(1)}px)` : '';
  }

  damageFlash(amount, dirYaw) {
    const el = $('.ov-hurt', this.overlay);
    el.style.transition = 'none';
    el.style.opacity = String(clamp(0.3 + amount, 0, 0.9));
    void el.offsetWidth;
    el.style.transition = 'opacity 1.2s ease-out';
    el.style.opacity = '0';
    if (dirYaw != null) {
      const d = this.el.dmgDir;
      d.style.transform = `translate(-50%,-50%) rotate(${-wrapAngle(dirYaw)}rad)`;
      d.classList.remove('show');
      void d.offsetWidth;
      d.classList.add('show');
    }
  }

  hitMarker(head) {
    const el = this.el.hit;
    el.classList.toggle('head', !!head);
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    this.game?.audio.play('click', { bus: 'ui', gain: 0.6 });
  }

  alert(level, dirYaw) {
    this.alertLevel = Math.max(this.alertLevel, level);
    this.alertTimer = 3;
    this.alertDir = dirYaw;
  }

  // --- Per-frame HUD ----------------------------------------------------------------------
  update(dt) {
    const g = this.game;
    for (const t of this.toasts) { t.t -= dt; if (t.t <= 0) t.el.remove(); }
    this.toasts = this.toasts.filter((t) => t.t > 0);
    for (const s of this.subs) { s.t -= dt; if (s.t <= 0) s.el.remove(); }
    this.subs = this.subs.filter((s) => s.t > 0);
    if (this.hintTimer > 0) { this.hintTimer -= dt; if (this.hintTimer <= 0) this.el.hint.hidden = true; }
    for (const s of this.stack) s.update?.(dt);
    if (!g || this.hud.hidden || !g.player) return;
    this.hudTimer = (this.hudTimer || 0) - dt;
    const slow = this.hudTimer <= 0;
    if (slow) this.hudTimer = 0.2;
    const drone = g.mode === 'drone';
    this.hud.classList.toggle('drone', drone);
    this.droneHud.hidden = !drone;
    if (drone) this.updateDroneHud(dt);
    this.updateCompass();
    if (slow) {
      this.updateVitals();
      this.updateClock();
      this.updateSquad();
      this.updateWeapon();
      this.updateQuick();
      this.updateStatus();
    }
    this.mapTimer = (this.mapTimer || 0) - dt;
    if (this.mapTimer <= 0 && g.campaignStarted) {
      this.mapTimer = 0.1;
      this.map.updateFog(0.1);
      const c = this.el.minimap;
      this.map.draw(c.getContext('2d'), c.width, c.height, { cx: g.player.pos.x, cz: g.player.pos.z, scale: 1.2, rotate: g.player.yaw, labels: false, round: true });
    }
    this.el.minimap.hidden = !g.campaignStarted;
    // Detection indicator.
    this.alertTimer = (this.alertTimer || 0) - dt;
    if (this.alertTimer <= 0) this.alertLevel = 0;
    const a = this.el.alert;
    a.className = `hud-alert lvl${this.alertLevel}`;
    if (this.alertLevel) a.style.transform = `translate(-50%,-50%) rotate(${-wrapAngle(this.alertDir || 0)}rad)`;
    // Crosshair spread.
    const cb = g.combat;
    if (cb) {
      const spread = 6 + (cb.bloom || 0) * 6 + (g.player.moving ? 6 : 0) - (cb.aim || 0) * 6;
      this.el.crosshair.style.setProperty('--s', `${Math.max(2, spread)}px`);
      this.el.crosshair.style.opacity = cb.aim > 0.8 || !g.campaignStarted || g.player.frozen ? '0' : '0.85';
    }
  }

  updateClock() {
    const g = this.game;
    const c = g.campaign;
    const inPrologue = g.prologue?.phase !== 'done';
    const day = inPrologue ? '' : `DAY ${c.day}`;
    const title = inPrologue ? 'Before the strike' : (DAYS[Math.min(c.day, 12)]?.title || 'Overtime');
    const rescue = c.rescue.confirmed ? ` · Rescue: Day ${c.rescue.day}` : '';
    clear(this.el.clock).append(h('div', { class: 'day' }, day, ' ', h('span', {}, formatClock(c.minutes))), h('div', { class: 'title' }, title + rescue));
    if (inPrologue) { clear(this.el.objectives); return; }
    const facts = g.facts();
    const list = activeObjectives(c).filter((o) => !o.optional).slice(0, 3);
    const opt = activeObjectives(c).filter((o) => o.optional).slice(0, 1);
    clear(this.el.objectives).append(...list.map((o) => h('div', { class: 'obj' }, objectiveText(o.id, facts))), ...opt.map((o) => h('div', { class: 'obj optional' }, `Optional: ${objectiveText(o.id, facts)}`)));
  }

  updateVitals() {
    const g = this.game;
    const v = g.vitals;
    const row = (label, val, max, cls, invert = false) => h('div', { class: `vital ${cls}` }, h('span', {}, label), bar(invert ? 100 - val : val, max, cls));
    const cond = condition(v);
    clear(this.el.vitals).append(
      row('HEALTH', v.health, 100, v.health < 30 ? 'hp crit' : 'hp'),
      row('STAMINA', v.stamina, 100, 'st'),
      row('FOOD', v.hunger, 100, v.hunger > 70 ? 'food warn' : 'food', true),
      row('WATER', v.thirst, 100, v.thirst > 70 ? 'water warn' : 'water', true),
      row('REST', v.fatigue, 100, v.fatigue > 75 ? 'rest warn' : 'rest', true),
    );
    const inj = activeInjuries(v);
    clear(this.el.injuries).append(
      h('div', { class: `cond lvl${cond.level}` }, cond.label),
      ...inj.map((i) => h('div', { class: `inj ${INJURY_TYPES[i.type].severity}` }, `${INJURY_TYPES[i.type].label} (${i.part})`)),
      v.painkiller > 0 ? h('div', { class: 'inj buff' }, 'Painkillers') : '',
      g.inv.load() > 1 ? h('div', { class: 'inj moderate' }, `Overloaded ${g.inv.weight().toFixed(1)}/${g.inv.capacity} kg`) : '',
    );
  }

  updateSquad() {
    const g = this.game;
    const list = g.squad.members.filter((m) => m.status !== 'prologue');
    clear(this.el.squad).append(...list.map((m) => {
      const st = m.status === 'dead' ? 'KIA' : m.status === 'rescued' ? ({ follow: 'Following', wait: 'Holding', shelter: m.sheltered ? 'At shelter' : 'To shelter' }[m.order]) : m.exact ? 'Found - needs help' : m.knownArea ? 'Heard nearby' : 'Missing';
      return h('div', { class: `mate ${m.status}` }, h('div', { class: 'name' }, m.name), h('div', { class: 'st' }, st), m.status !== 'missing' || m.exact ? bar(m.vitals.health, 100, 'hp') : '');
    }));
  }

  updateWeapon() {
    const g = this.game;
    const key = g.inv.activeWeapon();
    if (!key || g.prologue?.phase !== 'done') { this.el.weapon.hidden = true; return; }
    this.el.weapon.hidden = false;
    const W = WEAPONS[key];
    const reloading = g.combat.reloading > 0;
    clear(this.el.weapon).append(h('div', { class: 'wname' }, W.name), h('div', { class: 'ammo' }, h('b', {}, reloading ? '--' : String(g.inv.mags[key] || 0)), ` / ${g.inv.reserve(key)}`), h('div', { class: 'wkeys' }, '1 primary · 2 sidearm · R reload · T smoke'));
  }

  updateQuick() {
    const g = this.game;
    clear(this.el.quick).append(...g.inv.quick.map((id, i) => h('div', { class: `slot${id ? '' : ' empty'}` }, h('span', { class: 'k' }, String(i + 3)), id ? `${ITEMS[id].name.split(' (')[0]} ×${g.inv.count(id)}` : '—')));
  }

  updateStatus() {
    const g = this.game;
    const p = g.phone;
    const parts = [];
    if (g.campaignStarted) {
      const bars = g.signalHere();
      parts.push(h('div', { class: 'st-item' }, 'PHONE ', h('b', {}, p.battery > 0 ? `${Math.round(p.battery)}%` : 'DEAD'), ' ', h('span', { class: 'sig' }, '▮'.repeat(bars) + '▯'.repeat(4 - bars))));
      if (g.inv.has('drone') || g.drone.deployed) parts.push(h('div', { class: 'st-item' }, 'DRONE ', h('b', {}, `${Math.round(g.drone.battery)}%`)));
      if (g.inv.has('flashlight')) parts.push(h('div', { class: 'st-item' }, 'LIGHT ', h('b', {}, g.player.flashlightOn ? 'ON' : 'off'), ` ${Math.round(g.flashlightBattery ?? 100)}%`));
      if (g.campaign.rescue.confirmed) parts.push(h('div', { class: 'st-item good' }, 'RESCUE ', h('b', {}, `DAY ${g.campaign.rescue.day}`)));
    }
    clear(this.el.status).append(...parts);
  }

  updateCompass() {
    const g = this.game;
    const strip = this.el.compass.firstChild;
    const yaw = g.mode === 'drone' ? g.drone.yaw : g.player.yaw;
    const heading = bearingDeg(yaw);
    if (!this.compassBuilt) {
      this.compassBuilt = true;
      const labels = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
      for (let d = -180; d <= 540; d += 15) {
        const k = ((d % 360) + 360) % 360;
        strip.append(h('span', { class: labels[k] ? 'major' : 'minor', style: { left: `${(d + 180) * 3}px` } }, labels[k] || '|'));
      }
      this.compassMarks = h('div', { class: 'marks' });
      this.el.compass.append(this.compassMarks);
    }
    strip.style.transform = `translateX(${-((heading + 180) * 3) + this.el.compass.clientWidth / 2}px)`;
    // Markers: known teammates, shelter, LZ, waypoint.
    const pos = g.mode === 'drone' ? g.drone.pos : g.player.pos;
    const marks = [];
    for (const m of g.squad.members) {
      if (m.status === 'prologue' || m.status === 'dead') continue;
      const p = m.exact ? m.pos : m.knownArea;
      if (p) marks.push({ x: p.x, z: p.z, cls: m.status === 'rescued' ? 'mate' : 'clue', label: m.name[0] });
    }
    for (const mk of g.mapState.markers) if (!mk.hidden && ['shelter', 'lz', 'objective'].includes(mk.kind)) marks.push({ x: mk.x, z: mk.z, cls: mk.kind, label: mk.kind === 'lz' ? 'LZ' : mk.kind === 'shelter' ? 'S' : '!' });
    if (g.mapState.waypoint) marks.push({ ...g.mapState.waypoint, cls: 'wp', label: 'W' });
    clear(this.compassMarks).append(...marks.map((m) => {
      const b = bearingDeg(yawTo(pos.x, pos.z, m.x, m.z));
      let d = b - heading;
      d = ((d + 540) % 360) - 180;
      if (Math.abs(d) > 75) return '';
      const dist = Math.round(Math.hypot(m.x - pos.x, m.z - pos.z));
      return h('span', { class: `cm ${m.cls}`, style: { left: `${this.el.compass.clientWidth / 2 + d * 3}px` } }, m.label, h('small', {}, `${dist}m`));
    }));
  }

  updateDroneHud(dt) {
    const g = this.game;
    const d = g.drone;
    const dist = Math.hypot(d.pos.x - g.player.pos.x, d.pos.z - g.player.pos.z);
    const top = $('.dh-top', this.droneHud);
    const bottom = $('.dh-bottom', this.droneHud);
    const sigBars = Math.round(d.signal * 4);
    clear(top).append(h('span', { class: 'rec' }, '● REC'), h('span', {}, `BAT ${Math.round(d.battery)}%`), h('span', {}, `ALT ${Math.round(d.pos.y)}m`), h('span', {}, `DIST ${Math.round(dist)}m / ${Math.round(d.range)}m`), h('span', {}, `SIG ${'▮'.repeat(sigBars)}${'▯'.repeat(4 - sigBars)}`), d.returning ? h('span', { class: 'warn' }, 'RETURNING') : '');
    clear(bottom).append('WASD fly · Space/C up/down · Shift boost · Q mark · R return · G land (near you) · Esc land');
    top.classList.toggle('low', d.battery < 20);
    // Labels over spotted people.
    const labels = $('.dh-labels', this.droneHud);
    clear(labels);
    const v = new THREE.Vector3();
    for (const s of d.visible || []) {
      v.set(s.ref.pos.x, s.kind === 'enemy' ? 1.9 : 1.2, s.ref.pos.z).project(g.camera);
      if (v.z > 1) continue;
      const x = (v.x * 0.5 + 0.5) * window.innerWidth;
      const y = (-v.y * 0.5 + 0.5) * window.innerHeight;
      labels.append(h('div', { class: `dl ${s.kind}`, style: { left: `${x}px`, top: `${y}px` } }, s.label));
    }
    // Video static when the signal weakens.
    const c = $('.dh-static', this.droneHud);
    const noise = 1 - d.signal;
    c.style.opacity = String(Math.min(0.85, noise * 1.2 + (d.battery < 10 ? 0.15 : 0)));
    if (noise > 0.05) {
      const ctx = c.getContext('2d');
      const img = ctx.createImageData(c.width, c.height);
      for (let i = 0; i < img.data.length; i += 4) { const n = Math.random() * 255; img.data[i] = img.data[i + 1] = img.data[i + 2] = n; img.data[i + 3] = 255; }
      ctx.putImageData(img, 0, 0);
    }
  }
}
