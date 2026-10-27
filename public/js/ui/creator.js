// Character creation with a live 3D preview.

import * as THREE from 'three';
import { h, clear } from './dom.js';
import { Character } from '../world/character.js';
import {
  defaultConfig, randomConfig, sanitizeConfig, deriveStats, fitKit, SKIN_TONES, HAIR_COLORS, EYE_COLORS, HAIR_STYLES, FACIAL_HAIR, FACE_SHAPES,
  VOICE_PRESETS, VOICE_STYLES, ROLES, PRIMARY_WEAPONS, UNIFORM_TYPES, UNIFORM_COLORS, CAMO_PATTERNS, HELMETS, HELMET_COVERS, VESTS, BACKPACKS, GLOVES,
  BOOTS, KNEEPADS, EYEWEAR, RADIOS, PATCH_COLORS, INSIGNIA, KIT_OPTIONS, KIT_COUNTS, PLAYER_LINES,
} from '../data/customization.js';
import { WEAPONS } from '../data/items.js';
import { loadPref, savePref } from '../game/save.js';

const TABS = [['identity', 'Identity'], ['face', 'Face & hair'], ['voice', 'Voice'], ['uniform', 'Uniform'], ['gear', 'Gear'], ['loadout', 'Loadout']];
// The model faces -Z, so the front camera sits on the -Z side.
const VIEWS = { front: [0, 1.15, -3.4], side: [3.4, 1.15, -0.2], back: [0, 1.25, 3.4], face: [0.15, 1.62, -0.95] };

const opts = (obj) => Object.entries(obj).filter(([, v]) => !(v && v.found)).map(([k, v]) => [k, typeof v === 'string' ? v : v.label]);

export class Creator {
  constructor(ui, audio, onDone, onBack) {
    this.ui = ui;
    this.audio = audio;
    this.onDone = onDone;
    this.onBack = onBack;
    this.cfg = sanitizeConfig(loadPref('character', defaultConfig()));
    this.tab = 'identity';
    this.view = 'front';
    this.yaw = 0;
  }

  open() {
    const root = this.ui.menuRoot;
    clear(root);
    root.hidden = false;
    this.canvas = h('canvas', { class: 'cc-canvas' });
    this.form = h('div', { class: 'cc-form' });
    this.summary = h('div', { class: 'cc-summary' });
    this.tabsEl = h('div', { class: 'cc-tabs' });
    const views = h('div', { class: 'cc-views' }, ...Object.keys(VIEWS).map((v) => h('button', { 'data-v': v, class: v === this.view ? 'active' : '', onclick: () => this.setView(v) }, v[0].toUpperCase() + v.slice(1))));
    this.viewsEl = views;
    root.append(h('div', { class: 'creator' },
      h('div', { class: 'cc-left' }, h('h2', {}, 'Create your soldier'), this.tabsEl, this.form),
      h('div', { class: 'cc-right' }, this.canvas, views, h('p', { class: 'cc-tip' }, 'Drag to rotate'), this.summary,
        h('div', { class: 'cc-actions' },
          h('button', { class: 'ghost', onclick: () => this.close(this.onBack) }, 'Back'),
          h('button', { class: 'ghost', onclick: () => { this.cfg = randomConfig(Date.now()); this.refresh(true); } }, 'Randomise'),
          h('button', { class: 'ghost', onclick: () => { this.cfg = defaultConfig(); this.refresh(true); } }, 'Reset'),
          h('button', { class: 'primary', onclick: () => this.deploy() }, 'Deploy ▶')))));
    this.initPreview();
    this.refresh(true);
  }

  close(then) {
    this.running = false;
    this.renderer?.dispose();
    this.renderer = null;
    then?.();
  }

  deploy() {
    this.cfg = sanitizeConfig(this.cfg);
    savePref('character', this.cfg);
    const root = this.ui.menuRoot;
    const box = h('div', { class: 'panel dialog cc-start' },
      h('h2', {}, 'Deploy'),
      h('p', {}, `${this.cfg.name}, ${ROLES[this.cfg.role].label}, Satgas Elang-7.`),
      h('div', { class: 'btn-col' },
        h('button', { class: 'primary', onclick: () => this.close(() => this.onDone(this.cfg, false)) }, 'Play the opening (recommended)'),
        h('button', { onclick: () => this.close(() => this.onDone(this.cfg, true)) }, 'Skip to the aftermath'),
        h('button', { class: 'ghost', onclick: () => box.remove() }, 'Cancel')));
    root.append(box);
  }

  // --- Preview ------------------------------------------------------------------
  initPreview() {
    const r = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.shadowMap.enabled = true;
    this.renderer = r;
    const scene = new THREE.Scene();
    this.scene = scene;
    scene.add(new THREE.HemisphereLight(0xd8e0ea, 0x2a2622, 1.6));
    const key = new THREE.DirectionalLight(0xfff0dc, 3.2);
    key.position.set(2.5, 4, 3);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x9ec4ff, 2.2);
    rim.position.set(-3, 2.5, -3);
    scene.add(rim);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(1.6, 48), new THREE.MeshStandardMaterial({ color: '#2b2e2c', roughness: 0.9 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);
    this.cam = new THREE.PerspectiveCamera(34, 1, 0.05, 50);
    this.camTarget = new THREE.Vector3(...VIEWS.front);
    this.cam.position.copy(this.camTarget);
    this.pivot = new THREE.Group();
    scene.add(this.pivot);
    let drag = null;
    this.canvas.addEventListener('pointerdown', (e) => { drag = e.clientX; this.canvas.setPointerCapture(e.pointerId); });
    this.canvas.addEventListener('pointermove', (e) => { if (drag != null) { this.yaw += (e.clientX - drag) * 0.01; drag = e.clientX; } });
    this.canvas.addEventListener('pointerup', () => { drag = null; });
    this.running = true;
    let last = performance.now();
    const loop = (now) => {
      if (!this.running || !this.renderer) return;
      requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const w = this.canvas.clientWidth;
      const hgt = this.canvas.clientHeight;
      if (this.canvas.width !== w || this.canvas.height !== hgt) { r.setSize(w, hgt, false); this.cam.aspect = w / hgt; this.cam.updateProjectionMatrix(); }
      this.cam.position.lerp(this.camTarget, 1 - Math.exp(-6 * dt));
      this.cam.lookAt(0, this.view === 'face' ? 1.6 : 1.0, 0);
      this.pivot.rotation.y = this.yaw;
      this.char?.animate(dt, { mode: 'idle' });
      r.render(scene, this.cam);
    };
    requestAnimationFrame(loop);
  }

  setView(v) {
    this.view = v;
    this.camTarget.set(...VIEWS[v]);
    for (const b of this.viewsEl.children) b.classList.toggle('active', b.dataset.v === v);
  }

  rebuildModel() {
    clearTimeout(this.rebuildT);
    this.rebuildT = setTimeout(() => {
      if (this.char) this.pivot.remove(this.char.root);
      this.char = new Character(this.cfg, { weapon: this.cfg.loadout.primary });
      this.char.root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      this.pivot.add(this.char.root);
    }, 40);
  }

  // --- Form ------------------------------------------------------------------------
  refresh(rebuildForm) {
    this.cfg = sanitizeConfig(this.cfg);
    if (rebuildForm) this.renderForm();
    this.renderSummary();
    this.rebuildModel();
  }

  set(path, value, rebuildForm = false) {
    const parts = path.split('.');
    let o = this.cfg;
    for (const p of parts.slice(0, -1)) o = o[p];
    o[parts[parts.length - 1]] = value;
    if (path === 'role') { this.cfg.loadout.primary = ROLES[value].primary; this.cfg.loadout.kit = [...ROLES[value].kit]; rebuildForm = true; }
    if (path === 'gender') { if (value === 'female') this.cfg.facialHair = 'none'; rebuildForm = true; }
    if (path === 'vest') { this.cfg.loadout.kit = fitKit(this.cfg.loadout.kit, VESTS[value].slots); rebuildForm = true; }
    this.refresh(rebuildForm);
  }

  renderForm() {
    clear(this.tabsEl).append(...TABS.map(([id, label]) => h('button', { class: id === this.tab ? 'active' : '', onclick: () => { this.tab = id; this.renderForm(); } }, label)));
    const f = clear(this.form);
    const c = this.cfg;
    const sel = (label, path, options) => {
      const cur = path.split('.').reduce((o, k) => o[k], c);
      return h('label', { class: 'cc-row' }, h('span', {}, label), h('select', { onchange: (e) => this.set(path, e.target.value) }, ...options.map(([v, l]) => h('option', { value: v, selected: v === cur }, l))));
    };
    const swatches = (label, path, colors, isIndex = false) => {
      const cur = path.split('.').reduce((o, k) => o[k], c);
      const entries = isIndex ? colors.map((col, i) => [i, col]) : Object.entries(colors);
      return h('div', { class: 'cc-row' }, h('span', {}, label), h('div', { class: 'swatches' }, ...entries.map(([k, col]) => h('button', {
        class: `sw${String(k) === String(cur) ? ' active' : ''}`, style: { background: col }, title: String(k), onclick: () => this.set(path, isIndex ? Number(k) : k, true),
      }))));
    };
    const slider = (label, path, min = 0, max = 1, step = 0.01) => {
      const cur = path.split('.').reduce((o, k) => o[k], c);
      return h('label', { class: 'cc-row' }, h('span', {}, label), h('input', { type: 'range', min, max, step, value: cur, oninput: (e) => this.set(path, Number(e.target.value)) }));
    };
    const check = (label, path) => {
      const cur = path.split('.').reduce((o, k) => o[k], c);
      return h('label', { class: 'cc-row' }, h('span', {}, label), h('input', { type: 'checkbox', checked: cur, onchange: (e) => this.set(path, e.target.checked) }));
    };
    switch (this.tab) {
      case 'identity':
        f.append(
          h('label', { class: 'cc-row' }, h('span', {}, 'Name'), h('input', { type: 'text', maxlength: 24, value: c.name, oninput: (e) => { this.cfg.name = e.target.value; this.renderSummary(); clearTimeout(this.nameT); this.nameT = setTimeout(() => this.rebuildModel(), 400); } })),
          sel('Gender', 'gender', [['male', 'Male'], ['female', 'Female']]),
          sel('Military role', 'role', opts(ROLES)),
          h('p', { class: 'cc-note' }, ROLES[c.role].desc),
          check('Name patch', 'patch.show'),
          swatches('Patch colour', 'patch.color', PATCH_COLORS),
          sel('Shoulder insignia', 'insignia', opts(INSIGNIA)),
        );
        break;
      case 'face':
        f.append(
          swatches('Skin tone', 'skin', SKIN_TONES, true),
          sel('Face shape', 'face.shape', opts(FACE_SHAPES)),
          slider('Jaw width', 'face.jaw'), slider('Cheekbones', 'face.cheek'), slider('Nose', 'face.nose'), slider('Brow', 'face.brow'), slider('Age', 'face.age'),
          swatches('Eye colour', 'eyes', EYE_COLORS),
          sel('Hairstyle', 'hair.style', opts(HAIR_STYLES)),
          swatches('Hair colour', 'hair.color', HAIR_COLORS),
          c.gender === 'male' ? sel('Facial hair', 'facialHair', opts(FACIAL_HAIR)) : '',
          h('p', { class: 'cc-note' }, 'Tip: use the Face view to see details.'),
        );
        break;
      case 'voice': {
        const voices = this.audio.listVoices();
        f.append(
          sel('Voice', 'voice.preset', opts(VOICE_PRESETS)),
          slider('Pitch', 'voice.pitch', 0.5, 1.5, 0.01),
          sel('Speaking style', 'voice.style', opts(VOICE_STYLES)),
          voices.length ? sel('System voice', 'voice.voiceURI', [['', 'Automatic'], ...voices.map((v) => [v.voiceURI, `${v.name} (${v.lang})`])]) : h('p', { class: 'cc-note' }, 'No speech voices are available in this browser; lines appear as subtitles.'),
          h('button', { onclick: () => {
            this.audio.init();
            const style = c.voice.style;
            const p = VOICE_PRESETS[c.voice.preset];
            this.audio.say(c.name.split(' ')[0], PLAYER_LINES.follow[style], null, { pitch: p.pitch * c.voice.pitch, rate: p.rate * VOICE_STYLES[style].rate, voiceURI: c.voice.voiceURI });
          } }, '▶ Test voice'),
          h('p', { class: 'cc-note' }, 'Your voice is used when you give orders and call Central Command. The style changes your wording.'),
        );
        break;
      }
      case 'uniform':
        f.append(
          sel('Uniform', 'uniform.type', opts(UNIFORM_TYPES)),
          sel('Camouflage', 'uniform.camo', opts(CAMO_PATTERNS)),
          swatches('Base colour', 'uniform.color', UNIFORM_COLORS),
          sel('Boots', 'boots', opts(BOOTS)),
          sel('Gloves', 'gloves', opts(GLOVES)),
          sel('Knee pads', 'kneepads', opts(KNEEPADS)),
        );
        break;
      case 'gear':
        f.append(
          sel('Headgear', 'helmet', opts(HELMETS)),
          sel('Helmet cover', 'helmetCover', opts(HELMET_COVERS)),
          sel('Vest', 'vest', Object.entries(VESTS).filter(([, v]) => !v.found).map(([k, v]) => [k, `${v.label} — armour ${Math.round(v.armor * 100)}%, ${v.slots} pouches, ${v.weight} kg`])),
          sel('Backpack', 'backpack', Object.entries(BACKPACKS).map(([k, v]) => [k, `${v.label}${v.capacity ? ` (+${v.capacity} kg)` : ''}`])),
          sel('Eye protection', 'eyewear', opts(EYEWEAR)),
          sel('Radio', 'radio', Object.entries(RADIOS).map(([k, v]) => [k, `${v.label}${v.range ? ` (${v.range} m)` : ''}`])),
          h('p', { class: 'cc-note' }, 'Gear is visible on your soldier and changes armour, carrying capacity, speed, noise and what you can hear on the radio.'),
        );
        break;
      case 'loadout': {
        const slots = VESTS[c.vest].slots;
        const kit = c.loadout.kit;
        f.append(
          h('div', { class: 'cc-row' }, h('span', {}, 'Primary weapon'), h('div', { class: 'weapons' }, ...Object.entries(PRIMARY_WEAPONS).map(([k, label]) => {
            const W = WEAPONS[k];
            const stat = (name, v, max) => h('div', { class: 'wstat' }, h('span', {}, name), h('div', { class: 'bar' }, h('div', { class: 'fill', style: { width: `${Math.min(100, (v / max) * 100)}%` } })));
            return h('button', { class: `weapon${c.loadout.primary === k ? ' active' : ''}`, onclick: () => this.set('loadout.primary', k, true) }, h('b', {}, label),
              stat('Damage', (W.damage * (W.pellets || 1)), 110), stat('Rate', W.rpm, 900), stat('Range', W.range, 400), stat('Accuracy', 5 - W.spread, 5), stat('Noise', W.noise, 120));
          }))),
          h('p', { class: 'cc-note' }, 'Sidearm: P-9 pistol (always carried).'),
          h('div', { class: 'cc-row' }, h('span', {}, `Pouches (${kit.length}/${slots})`), h('div', { class: 'kit' }, ...Object.entries(KIT_OPTIONS).map(([k, label]) => {
            const n = kit.filter((x) => x === k).length;
            return h('div', { class: `kit-item${n ? ' on' : ''}` }, h('span', {}, `${label}${KIT_COUNTS[k] ? '' : ''}`),
              h('button', { class: 'tiny', disabled: !n, onclick: () => { const i = kit.lastIndexOf(k); kit.splice(i, 1); this.refresh(true); } }, '−'),
              h('b', {}, String(n)),
              h('button', { class: 'tiny', disabled: kit.length >= slots, onclick: () => { kit.push(k); this.refresh(true); } }, '+'));
          }))),
          h('p', { class: 'cc-note' }, 'Your vest decides how many pouches you have. Pouch items are bound to keys 3–8 in the field.'),
        );
        break;
      }
      default: break;
    }
  }

  renderSummary() {
    const s = deriveStats(this.cfg);
    const c = this.cfg;
    const row = (k, v) => h('div', {}, h('span', {}, k), h('b', {}, v));
    clear(this.summary).append(h('h3', {}, `${c.name || 'Soldier'} — ${ROLES[c.role].label}`), h('div', { class: 'cc-stats' },
      row('Body armour', `${Math.round(s.armor * 100)}%`), row('Head protection', `${Math.round(s.headArmor * 100)}%`), row('Carry capacity', `${s.capacity} kg`),
      row('Speed', `${Math.round(s.speedMult * 100)}%`), row('Footstep noise', `${Math.round(s.noiseMult * 100)}%`), row('Pouch slots', String(s.kitSlots)),
      row('Radio range', s.radioRange ? `${Math.round(s.radioRange)} m` : 'none'), row('Dust protection', `${Math.round(s.dustProtection * 100)}%`)));
  }
}
