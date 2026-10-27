// Procedural soldier / civilian model: a jointed rig built from the
// character configuration, dressed with the selected uniform and gear, and
// animated procedurally.
//
// Joint names (hips, spine, chest, neck, head, shoulderL/R, elbowL/R,
// handL/R, hipL/R, kneeL/R, footL/R) match a standard humanoid layout so a
// skinned GLB character can replace the procedural body later.

import * as THREE from 'three';
import { SKIN_TONES, HAIR_COLORS, EYE_COLORS, UNIFORM_COLORS, PATCH_COLORS } from '../data/customization.js';
import * as M from './materials.js';
import { textTexture } from './textures.js';
import { damp } from '../core/util.js';

const geoCache = new Map();
const G = (key, make) => {
  if (!geoCache.has(key)) geoCache.set(key, make());
  return geoCache.get(key);
};

const capsule = (r, len) => G(`cap:${r}:${len}`, () => new THREE.CapsuleGeometry(r, len, 4, 10));
const box = (x, y, z) => G(`box:${x}:${y}:${z}`, () => new THREE.BoxGeometry(x, y, z));
const sphere = (r, ws = 14, hs = 10) => G(`sph:${r}:${ws}:${hs}`, () => new THREE.SphereGeometry(r, ws, hs));
const cyl = (rt, rb, h, s = 10) => G(`cyl:${rt}:${rb}:${h}:${s}`, () => new THREE.CylinderGeometry(rt, rb, h, s));

function mesh(geo, mat, x = 0, y = 0, z = 0, parent = null, cast = true) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = cast;
  m.receiveShadow = false;
  if (parent) parent.add(m);
  return m;
}

function joint(name, parent, x = 0, y = 0, z = 0) {
  const g = new THREE.Group();
  g.name = name;
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

const BOOT_COLORS = { black: '#17181a', tan: '#8a7354', green: '#3a3f2c' };
const GLOVE_COLORS = { tactical: '#1d1f1c', fingerless: '#2a2c26' };

function torsoGeometry(female, build) {
  return G(`torso:${female}:${build}`, () => {
    const pts = female
      ? [[0.118, -0.1], [0.112, 0], [0.105, 0.08], [0.13, 0.2], [0.15, 0.27], [0.145, 0.34], [0.12, 0.4], [0.06, 0.44]]
      : [[0.13, -0.1], [0.132, 0], [0.14, 0.1], [0.16, 0.22], [0.168, 0.3], [0.16, 0.37], [0.13, 0.42], [0.06, 0.46]];
    const g = new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r * build, y)), 14);
    g.scale(1.18, 1, 0.66);
    return g;
  });
}

function headGeometry(shape, jaw, cheek) {
  const key = `head:${shape}:${jaw.toFixed(2)}:${cheek.toFixed(2)}`;
  return G(key, () => {
    const g = new THREE.SphereGeometry(0.105, 18, 14);
    const p = g.attributes.position;
    const sy = shape === 'long' ? 1.2 : shape === 'round' ? 1.04 : 1.12;
    const sx = shape === 'round' ? 0.98 : shape === 'long' ? 0.86 : 0.9;
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i);
      let y = p.getY(i);
      let z = p.getZ(i);
      x *= sx; y *= sy;
      if (y < 0) {
        // Jaw: square faces keep width toward the chin; others taper.
        const t = -y / (0.105 * sy);
        const taper = shape === 'square' ? 1 - t * 0.12 : 1 - t * (0.32 - jaw * 0.18);
        x *= taper;
        z *= 1 - t * 0.1;
      } else if (y < 0.04 && z < 0) {
        x *= 1 + cheek * 0.06; // cheekbones
      }
      if (z < 0) z *= 1.04; // face slightly forward
      p.setXYZ(i, x, y, z);
    }
    g.computeVertexNormals();
    return g;
  });
}

function hairShell(scale, cutY, bumpy) {
  return G(`hair:${scale}:${cutY}:${bumpy}`, () => {
    const g = new THREE.SphereGeometry(0.105 * scale, 18, 12, 0, Math.PI * 2, 0, Math.PI * cutY);
    if (bumpy) {
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const v = new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i));
        v.multiplyScalar(1 + Math.sin(i * 12.9898) * 0.04);
        p.setXYZ(i, v.x, v.y, v.z);
      }
      g.computeVertexNormals();
    }
    g.scale(0.92, 1.12, 1.02);
    return g;
  });
}

// --- Weapons -------------------------------------------------------------------

export function buildWeaponModel(key, { lowDetail = false } = {}) {
  const g = new THREE.Group();
  const metal = M.std('#1e2022', 0.45, 0.6);
  const poly = M.std('#2b2d2a', 0.7, 0.1);
  const tan = M.std('#6f6250', 0.75, 0.05);
  const add = (geo, mat, x, y, z, rx = 0) => {
    const m = mesh(geo, mat, x, y, z, g);
    m.rotation.x = rx;
    return m;
  };
  const barrel = (len, z) => { const m = add(cyl(0.011, 0.011, len, 8), metal, 0, 0.035, z); m.rotation.x = Math.PI / 2; };
  switch (key) {
    case 'pistol':
      add(box(0.03, 0.035, 0.18), metal, 0, 0.04, -0.06);
      add(box(0.028, 0.1, 0.045), poly, 0, -0.02, 0.01, 0.25);
      break;
    case 'smg':
      add(box(0.045, 0.075, 0.32), metal, 0, 0.03, -0.08);
      add(box(0.03, 0.17, 0.035), metal, 0, -0.08, -0.12);
      add(box(0.035, 0.09, 0.045), poly, 0, -0.03, 0.03, 0.3);
      add(box(0.03, 0.05, 0.22), poly, 0, 0.03, 0.17);
      barrel(0.12, -0.3);
      break;
    case 'shotgun':
      add(box(0.05, 0.07, 0.36), metal, 0, 0.03, -0.06);
      barrel(0.5, -0.45);
      add(cyl(0.02, 0.02, 0.28, 8), poly, 0, 0.0, -0.36).rotation.x = Math.PI / 2;
      add(box(0.04, 0.09, 0.3), M.std('#4a3424', 0.8), 0, -0.01, 0.26, -0.15);
      add(box(0.035, 0.09, 0.045), poly, 0, -0.04, 0.05, 0.3);
      break;
    default: {
      // AR / carbine / DMR share a layout; lengths differ.
      const long = key === 'dmr' ? 1.25 : key === 'carbine' ? 0.85 : 1.0;
      add(box(0.05, 0.08, 0.42 * long), metal, 0, 0.03, -0.1);
      add(box(0.055, 0.06, 0.26 * long), key === 'dmr' ? tan : poly, 0, 0.035, -0.38 * long);
      barrel(0.2 * long, -0.6 * long);
      add(box(0.032, 0.17, 0.05), metal, 0, -0.07, -0.16, 0.25);
      add(box(0.035, 0.09, 0.045), poly, 0, -0.04, 0.04, 0.3);
      add(box(0.04, 0.07, 0.26), key === 'dmr' ? tan : poly, 0, 0.02, 0.24);
      if (!lowDetail) {
        add(box(0.035, 0.045, 0.12), metal, 0, 0.1, -0.1);
        if (key === 'dmr') { const s = add(cyl(0.022, 0.022, 0.3, 10), metal, 0, 0.115, -0.12); s.rotation.x = Math.PI / 2; }
      }
    }
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

// --- Character ---------------------------------------------------------------------

export class Character {
  constructor(cfg, opts = {}) {
    this.cfg = cfg;
    this.kind = opts.kind || 'soldier';
    this.root = new THREE.Group();
    this.root.name = cfg.name || 'character';
    this.detail = [];
    this.phase = Math.random() * 10;
    this.t = Math.random() * 10;
    this.state = { mode: 'idle', speed: 0, crouch: 0, lookPitch: 0, wave: 0 };
    this.cur = {};
    this.build(opts);
  }

  build(opts) {
    const c = this.cfg;
    const female = c.gender === 'female';
    const civ = this.kind === 'civilian';
    const enemy = this.kind === 'enemy';
    const scale = opts.height || (female ? 0.95 : 1);
    this.root.scale.setScalar(scale);
    const skinMat = M.skin(SKIN_TONES[c.skin] || SKIN_TONES[4]);
    const hairCol = HAIR_COLORS[c.hair?.color] || '#111';
    const hairMat = M.std(hairCol, 0.75);
    let topMat;
    let legMat;
    let sleeveMat;
    if (civ) {
      topMat = M.std(opts.shirt || '#4a6a8a', 0.9);
      sleeveMat = topMat;
      legMat = M.std(opts.pants || '#2f3440', 0.9);
    } else if (enemy) {
      topMat = M.camo('urban', '#3a3d40');
      sleeveMat = topMat;
      legMat = topMat;
    } else {
      const col = UNIFORM_COLORS[c.uniform.color] || '#4f5838';
      const camo = M.camo(c.uniform.camo, col);
      legMat = camo;
      sleeveMat = camo;
      topMat = c.uniform.type === 'combatshirt' ? M.std(col, 0.92) : camo;
      if (c.uniform.type === 'urban') { legMat = M.camo('urban', '#5d6166'); sleeveMat = legMat; topMat = legMat; }
    }
    const build = civ ? (opts.build || 1) : 1.04;
    const hipH = female ? 0.92 : 0.95;
    const sw = female ? 0.175 : 0.2;
    const hw = female ? 0.1 : 0.095;
    const thigh = female ? 0.43 : 0.45;
    const shin = female ? 0.42 : 0.44;
    const upper = female ? 0.28 : 0.3;
    const fore = female ? 0.25 : 0.27;
    this.dims = { hipH, thigh, shin };

    const body = joint('body', this.root);
    const hips = joint('hips', body, 0, hipH, 0);
    const spine = joint('spine', hips, 0, 0.1, 0);
    const chest = joint('chest', spine, 0, 0.2, 0);
    const neck = joint('neck', chest, 0, 0.23, 0);
    const head = joint('head', neck, 0, 0.1, 0);
    const shoulderL = joint('shoulderL', chest, -sw, 0.17, 0);
    const elbowL = joint('elbowL', shoulderL, 0, -upper, 0);
    const handL = joint('handL', elbowL, 0, -fore, 0);
    const shoulderR = joint('shoulderR', chest, sw, 0.17, 0);
    const elbowR = joint('elbowR', shoulderR, 0, -upper, 0);
    const handR = joint('handR', elbowR, 0, -fore, 0);
    const hipL = joint('hipL', hips, -hw, 0, 0);
    const kneeL = joint('kneeL', hipL, 0, -thigh, 0);
    const footL = joint('footL', kneeL, 0, -shin, 0);
    const hipR = joint('hipR', hips, hw, 0, 0);
    const kneeR = joint('kneeR', hipR, 0, -thigh, 0);
    const footR = joint('footR', kneeR, 0, -shin, 0);
    this.j = { body, hips, spine, chest, neck, head, shoulderL, elbowL, handL, shoulderR, elbowR, handR, hipL, kneeL, footL, hipR, kneeR, footR };

    // Body.
    mesh(torsoGeometry(female, build), topMat, 0, -0.08, 0, spine);
    const pelvis = mesh(capsule(0.115 * build, 0.14), legMat, 0, 0.0, 0, hips);
    pelvis.rotation.z = Math.PI / 2;
    pelvis.scale.set(1, 1, 0.78);
    mesh(cyl(0.05, 0.055, 0.1), skinMat, 0, 0.02, 0, neck);
    for (const [hip, knee, foot, side] of [[hipL, kneeL, footL, -1], [hipR, kneeR, footR, 1]]) {
      mesh(capsule(0.078 * build, thigh - 0.1), legMat, 0, -thigh / 2, 0, hip);
      mesh(capsule(0.06, shin - 0.08), legMat, 0, -shin / 2, 0, knee);
      if (!civ) {
        // Cargo pocket.
        const pocket = mesh(box(0.035, 0.13, 0.12), legMat, side * 0.075, -thigh * 0.45, 0, hip);
        this.detail.push(pocket);
      }
      const bootMat = civ ? M.std(opts.shoes || '#2b2622', 0.7) : M.std(BOOT_COLORS[c.boots] || '#17181a', 0.65);
      mesh(box(0.1, 0.1, 0.25), bootMat, 0, -0.04, -0.05, foot);
      if (!civ) mesh(cyl(0.066, 0.07, 0.12), bootMat, 0, 0.03, 0, foot);
      if (!civ && c.kneepads === 'standard') {
        const kp = mesh(box(0.11, 0.12, 0.05), M.std('#1e201d', 0.6), 0, -0.02, -0.06, knee);
        this.detail.push(kp);
      }
    }
    const rolled = !civ && !enemy && c.uniform.type === 'rolled';
    const gloveCol = !civ && c.gloves !== 'none' ? GLOVE_COLORS[c.gloves] : null;
    for (const [sh, el, hand] of [[shoulderL, elbowL, handL], [shoulderR, elbowR, handR]]) {
      mesh(capsule(0.054 * build, upper - 0.08), sleeveMat, 0, -upper / 2, 0, sh);
      mesh(capsule(0.045, fore - 0.07), rolled || (civ && opts.shortSleeves) ? skinMat : sleeveMat, 0, -fore / 2, 0, el);
      if (rolled) mesh(cyl(0.056, 0.056, 0.05), sleeveMat, 0, -0.02, 0, el);
      const handMat = gloveCol ? M.std(gloveCol, 0.7) : skinMat;
      mesh(box(0.075, 0.1, 0.035), handMat, 0, -0.05, 0, hand);
      if (c.gloves === 'fingerless' && !civ) mesh(box(0.07, 0.03, 0.03), skinMat, 0, -0.105, 0, hand);
    }

    this.buildHead(head, skinMat, hairMat, female, civ, enemy);
    if (!civ) this.buildGear(spine, chest, head, shoulderL, enemy);
    if (opts.weapon) this.setWeapon(opts.weapon);
    this.root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  }

  buildHead(head, skinMat, hairMat, female, civ, enemy) {
    const c = this.cfg;
    const f = c.face || {};
    mesh(headGeometry(f.shape || 'oval', f.jaw ?? 0.5, f.cheek ?? 0.5), skinMat, 0, 0.02, 0, head);
    const det = [];
    // Ears.
    for (const s of [-1, 1]) {
      const ear = mesh(sphere(0.026, 8, 6), skinMat, s * 0.094, 0.02, 0.005, head);
      ear.scale.set(0.45, 1, 0.75);
      det.push(ear);
    }
    // Eyes: white, iris, pupil.
    const white = M.std('#eeeae2', 0.3);
    const iris = M.std(EYE_COLORS[c.eyes] || '#3a2414', 0.35);
    const pupil = M.std('#050505', 0.2);
    for (const s of [-1, 1]) {
      const e = mesh(sphere(0.016, 10, 8), white, s * 0.036, 0.035, -0.088, head, false);
      e.scale.set(1, 0.75, 0.6);
      det.push(e, mesh(sphere(0.0085, 8, 6), iris, s * 0.036, 0.035, -0.097, head, false), mesh(sphere(0.004, 6, 4), pupil, s * 0.036, 0.035, -0.1045, head, false));
      // Brows.
      const brow = mesh(box(0.038, 0.007 + (f.brow ?? 0.5) * 0.006, 0.01), M.std(HAIR_COLORS[c.hair?.color] || '#111', 0.8), s * 0.037, 0.058 + (f.brow ?? 0.5) * 0.004, -0.095, head, false);
      brow.rotation.z = s * -0.08;
      det.push(brow);
    }
    // Nose and mouth.
    const ns = 0.8 + (f.nose ?? 0.5) * 0.5;
    const nose = mesh(box(0.022 * ns, 0.04 * ns, 0.03 * ns), skinMat, 0, 0.0, -0.104, head, false);
    nose.rotation.x = -0.25;
    const lipMat = M.skin(new THREE.Color(SKIN_TONES[c.skin] || '#a06640').multiplyScalar(0.72).getStyle());
    det.push(nose, mesh(box(0.042, 0.009, 0.012), lipMat, 0, -0.045, -0.094, head, false));
    // Age lines.
    if ((f.age ?? 0) > 0.6) det.push(mesh(box(0.05, 0.003, 0.004), lipMat, 0, 0.075, -0.098, head, false));
    // Facial hair.
    if (!female && c.facialHair && c.facialHair !== 'none') {
      const fh = M.std(HAIR_COLORS[c.hair?.color] || '#111', 0.85, 0, c.facialHair === 'stubble' ? { transparent: true, opacity: 0.45 } : {});
      if (c.facialHair === 'mustache' || c.facialHair === 'goatee') det.push(mesh(box(0.05, 0.012, 0.012), fh, 0, -0.03, -0.1, head, false));
      if (c.facialHair === 'goatee') det.push(mesh(box(0.028, 0.035, 0.02), fh, 0, -0.07, -0.088, head, false));
      if (c.facialHair === 'beard' || c.facialHair === 'stubble') {
        const b = mesh(G('beard', () => new THREE.SphereGeometry(0.108, 16, 10, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.42)), fh, 0, 0.015, -0.004, head, false);
        b.scale.set(0.9, 1.12, 1.05);
        det.push(b);
      }
    }
    this.detail.push(...det);
    // Hair.
    const style = c.hair?.style || 'crew';
    if (enemy) {
      // Balaclava.
      const bal = mesh(G('balaclava', () => new THREE.SphereGeometry(0.11, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.95)), M.std('#141516', 0.9), 0, 0.02, 0, head);
      bal.scale.set(0.93, 1.13, 1.04);
      const slot = mesh(box(0.1, 0.03, 0.02), skinMat, 0, 0.035, -0.105, head, false);
      this.detail.push(slot);
    } else if (style !== 'bald') {
      const thick = style === 'buzz' ? 1.03 : style === 'curly' ? 1.12 : 1.08;
      const cut = style === 'bob' ? 0.62 : style === 'buzz' ? 0.5 : 0.56;
      const shell = mesh(hairShell(thick, cut, style === 'curly'), hairMat, 0, 0.025, 0.004, head);
      if (style === 'short' || style === 'crew') shell.rotation.x = -0.12;
      if (style === 'ponytail') {
        const tail = mesh(capsule(0.03, 0.16), hairMat, 0, -0.04, 0.12, head);
        tail.rotation.x = 0.35;
      }
      if (style === 'bun') mesh(sphere(0.045), hairMat, 0, 0.0, 0.11, head);
      if (style === 'braid') for (let i = 0; i < 5; i++) mesh(sphere(0.026 - i * 0.002), hairMat, 0, -0.03 - i * 0.045, 0.11 + i * 0.006, head);
      if (style === 'bob') {
        const bob = mesh(cyl(0.11, 0.12, 0.12, 16), hairMat, 0, -0.02, 0.012, head);
        bob.scale.set(0.95, 1, 1.05);
      }
    }
    if (civ) return;
    // Headgear.
    const helmetMat = c.helmetCover === 'camo' ? M.camo(c.uniform.camo, UNIFORM_COLORS[c.uniform.color]) : M.std(enemy ? '#2a2c2e' : '#4a4f3c', 0.7);
    const hm = enemy ? 'combat' : c.helmet;
    if (hm === 'combat' || hm === 'highcut' || hm === 'fire') {
      const shell = mesh(G(`helmet:${hm}`, () => new THREE.SphereGeometry(0.135, 18, 10, 0, Math.PI * 2, 0, hm === 'highcut' ? Math.PI * 0.42 : Math.PI * 0.52)), hm === 'fire' ? M.std('#d8d2c2', 0.4, 0.1) : helmetMat, 0, 0.035, 0.005, head);
      shell.scale.set(1, 0.95, 1.1);
      if (hm === 'highcut') {
        for (const s of [-1, 1]) this.detail.push(mesh(box(0.012, 0.025, 0.12), M.std('#222', 0.5, 0.4), s * 0.128, 0.05, 0, head));
        this.detail.push(mesh(box(0.04, 0.035, 0.02), M.std('#222', 0.5, 0.4), 0, 0.12, -0.12, head));
      }
      if (hm === 'fire') {
        const brim = mesh(cyl(0.16, 0.17, 0.012, 18), M.std('#d8d2c2', 0.4, 0.1), 0, 0.03, 0.04, head);
        brim.scale.set(1, 1, 1.25);
      }
      // Chin strap.
      for (const s of [-1, 1]) mesh(box(0.008, 0.11, 0.012), M.std('#1a1a18', 0.8), s * 0.092, -0.03, -0.01, head, false);
    } else if (hm === 'cap') {
      mesh(cyl(0.108, 0.112, 0.06, 16), helmetMat, 0, 0.09, 0.0, head);
      const bill = mesh(box(0.13, 0.008, 0.07), helmetMat, 0, 0.065, -0.115, head);
      bill.rotation.x = 0.12;
    } else if (hm === 'boonie') {
      mesh(cyl(0.1, 0.112, 0.08, 16), helmetMat, 0, 0.1, 0, head);
      mesh(cyl(0.19, 0.19, 0.008, 20), helmetMat, 0, 0.065, 0, head);
    }
    // Eyewear.
    if (!enemy && c.eyewear === 'glasses') {
      this.detail.push(mesh(box(0.11, 0.025, 0.01), M.std('#101418', 0.1, 0.7, { transparent: true, opacity: 0.8 }), 0, 0.035, -0.106, head, false));
    } else if (!enemy && c.eyewear === 'goggles') {
      const gg = mesh(box(0.13, 0.045, 0.03), M.std('#1a1d1a', 0.4), 0, 0.075, -0.1, head, false);
      gg.rotation.x = -0.6;
      mesh(box(0.2, 0.015, 0.2), M.std('#2c2a24', 0.9), 0, 0.075, 0.0, head, false).scale.set(1.05, 1, 1.15);
    }
  }

  buildGear(spine, chest, head, shoulderL, enemy) {
    const c = this.cfg;
    const vestCol = enemy ? '#24272a' : c.uniform.color === 'black' ? '#2b2d2f' : c.uniform.camo === 'desert' ? '#8b7a58' : '#3f4532';
    const vestMat = M.std(vestCol, 0.85);
    const strapMat = M.std('#202220', 0.8);
    const vest = enemy ? 'plate' : c.vest;
    if (vest === 'chestrig') {
      mesh(box(0.3, 0.16, 0.06), vestMat, 0, 0.06, -0.12, spine);
      for (const s of [-1, 1]) mesh(box(0.04, 0.03, 0.26), strapMat, s * 0.1, 0.36, 0.0, spine);
    } else {
      const big = vest === 'heavy' ? 1.12 : vest === 'police' ? 1.0 : vest === 'platelight' ? 0.92 : 1;
      mesh(box(0.34 * big, 0.36 * big, 0.06), vestMat, 0, 0.18, -0.115, spine);
      mesh(box(0.34 * big, 0.36 * big, 0.06), vestMat, 0, 0.18, 0.115, spine);
      for (const s of [-1, 1]) {
        mesh(box(0.05, 0.12, 0.22), vestMat, s * 0.175 * big, 0.12, 0, spine);
        mesh(box(0.06, 0.03, 0.27), strapMat, s * 0.1, 0.38, 0, spine);
      }
      if (vest === 'heavy') {
        mesh(box(0.3, 0.06, 0.3), vestMat, 0, 0.4, 0, spine);
        mesh(box(0.2, 0.14, 0.05), vestMat, 0, -0.08, -0.12, spine);
      }
      if (vest === 'police') {
        const label = mesh(box(0.2, 0.05, 0.005), M.textPlane('POLIZEI', { w: 256, h: 64, bg: '#1d2a3a', fg: '#ffffff', font: 'bold 40px Arial' }), 0, 0.24, -0.147, spine, false);
        this.detail.push(label);
      }
    }
    // Pouches: one per kit slot used, med pouch marked with a cross.
    const kit = enemy ? ['a', 'b', 'c'] : c.loadout?.kit || [];
    const n = Math.min(6, Math.max(2, kit.length));
    const medical = ['bandage', 'tourniquet', 'splint', 'painkillers', 'antiseptic', 'first_aid_kit'];
    for (let i = 0; i < n; i++) {
      const x = (i - (n - 1) / 2) * 0.07;
      const isMed = !enemy && medical.includes(kit[i]) && i === kit.findIndex((k) => medical.includes(k));
      const p = mesh(box(0.06, 0.1, 0.05), isMed ? M.std('#6a1e1a', 0.8) : vestMat, x, 0.05, -0.16, spine);
      this.detail.push(p);
      if (isMed) this.detail.push(mesh(box(0.035, 0.035, 0.002), M.textPlane('+', { w: 64, h: 64, bg: '#6a1e1a', fg: '#ffffff', font: 'bold 60px Arial' }), x, 0.06, -0.1855, spine, false));
    }
    // Name patch and insignia.
    if (!enemy && c.patch?.show !== false) {
      const surname = (c.name || '').trim().split(/\s+/).pop().toUpperCase();
      const patch = mesh(box(0.11, 0.028, 0.004), M.textPlane(surname, { w: 256, h: 64, bg: PATCH_COLORS[c.patch.color] || '#3c4430', fg: '#e8e2cc', font: 'bold 44px Arial' }), 0.085, 0.27, -0.149, spine, false);
      this.detail.push(patch);
    }
    if (!enemy && c.insignia && c.insignia !== 'none') {
      let mat;
      if (c.insignia === 'flag') {
        const t = document.createElement('canvas');
        t.width = 64; t.height = 40;
        const x = t.getContext('2d');
        x.fillStyle = '#ce1126'; x.fillRect(0, 0, 64, 20);
        x.fillStyle = '#f4f4f4'; x.fillRect(0, 20, 64, 20);
        const tex = new THREE.CanvasTexture(t);
        tex.colorSpace = THREE.SRGBColorSpace;
        mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 });
      } else if (c.insignia === 'medic') mat = M.textPlane('+', { w: 64, h: 64, bg: '#f2f2f2', fg: '#c01a1a', font: 'bold 64px Arial' });
      else mat = M.textPlane('ELANG', { w: 128, h: 80, bg: '#2a3020', fg: '#d9c48a', font: 'bold 34px Arial', border: '#d9c48a' });
      const ins = mesh(box(0.004, 0.045, 0.07), mat, -0.056, -0.06, 0, shoulderL, false);
      ins.rotation.y = Math.PI / 2;
      this.detail.push(ins);
    }
    // Backpack.
    const packMat = M.std(enemy ? '#2a2c2e' : vestCol, 0.9);
    const pack = enemy ? 'assault' : c.backpack;
    if (pack !== 'none') {
      const dim = { assault: [0.28, 0.36, 0.15], patrol: [0.32, 0.46, 0.2], ruck: [0.36, 0.6, 0.26] }[pack];
      mesh(box(...dim), packMat, 0, 0.18 + (pack === 'ruck' ? 0.03 : 0), 0.15 + dim[2] / 2, spine);
      if (pack !== 'assault') for (const s of [-1, 1]) mesh(box(0.06, dim[1] * 0.5, 0.1), packMat, s * (dim[0] / 2 + 0.03), 0.1, 0.17 + dim[2] / 2, spine);
      if (pack === 'ruck') mesh(box(0.3, 0.06, 0.2), M.std('#2f2f2a', 0.9), 0, 0.5, 0.26, spine);
    }
    // Radio.
    const radio = enemy ? 'handheld' : c.radio;
    if (radio === 'handheld') {
      mesh(box(0.05, 0.11, 0.03), M.std('#1b1c1c', 0.6), -0.11, 0.26, -0.155, spine);
      mesh(cyl(0.005, 0.005, 0.14, 6), M.std('#111', 0.6), -0.12, 0.38, -0.155, spine);
    } else if (radio === 'manpack') {
      mesh(box(0.18, 0.22, 0.08), M.std('#33382a', 0.7), 0, 0.42, 0.24, spine);
      const ant = mesh(cyl(0.004, 0.006, 0.9, 6), M.std('#111', 0.6), 0.08, 0.95, 0.26, spine);
      ant.rotation.z = -0.08;
      this.antenna = ant;
    }
  }

  // Weapon in the hands (`ready`) or slung across the back.
  setWeapon(key, mode = 'ready') {
    if (this.weapon) this.weapon.parent?.remove(this.weapon);
    this.weaponKey = key;
    if (!key) { this.weapon = null; return; }
    this.weapon = buildWeaponModel(key, { lowDetail: true });
    this.weaponMode = mode;
    if (mode === 'slung') {
      // Diagonally across the back, muzzle down to the left.
      this.j.spine.add(this.weapon);
      this.weapon.position.set(0.04, 0.22, 0.24);
      this.weapon.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), new THREE.Vector3(-0.55, -0.83, 0.06).normalize());
    } else {
      this.j.handR.add(this.weapon);
      this.weapon.position.set(0, -0.08, 0);
      this.weapon.rotation.set(-Math.PI / 2, 0, 0);
    }
  }

  setDetailVisible(v) {
    if (this._detailVisible === v) return;
    this._detailVisible = v;
    for (const d of this.detail) d.visible = v;
  }

  // Head-centre position in world space (for line of sight).
  headWorld(out = new THREE.Vector3()) {
    return this.j.head.getWorldPosition(out);
  }

  // s: { mode, speed, crouch, lookPitch, aiming, limp }
  animate(dt, s = this.state) {
    this.t += dt;
    const j = this.j;
    const tgt = {};
    const set = (name, x = 0, y = 0, z = 0) => { tgt[name] = [x, y, z]; };
    let bodyY = 0;
    let bodyRot = 0;
    let bodyZ = 0;
    const speed = s.speed || 0;
    const hasGun = !!this.weapon && this.weaponMode === 'ready';
    const mode = s.mode || 'idle';
    const walkish = mode === 'walk' || mode === 'run' || mode === 'limp' || mode === 'panic' || mode === 'crouchwalk';
    if (walkish) this.phase += dt * (mode === 'run' || mode === 'panic' ? 9.5 : mode === 'limp' ? 4.2 : 6.5) * Math.min(1.6, 0.5 + speed / 3);
    const ph = this.phase;
    const breathe = Math.sin(this.t * 1.7) * 0.015;
    // Legs.
    if (walkish) {
      const A = mode === 'run' || mode === 'panic' ? 0.8 : mode === 'crouchwalk' ? 0.45 : 0.5;
      const lf = mode === 'limp' ? 0.35 : 1;
      set('hipL', Math.sin(ph) * A * lf);
      set('hipR', Math.sin(ph + Math.PI) * A);
      set('kneeL', -Math.max(0, Math.sin(ph - 1.2)) * A * 1.6 * lf - 0.05);
      set('kneeR', -Math.max(0, Math.sin(ph + Math.PI - 1.2)) * A * 1.6 - 0.05);
      set('footL', Math.max(0, -Math.sin(ph)) * 0.3);
      set('footR', Math.max(0, Math.sin(ph)) * 0.3);
      bodyY = -Math.abs(Math.sin(ph)) * (mode === 'run' ? 0.05 : 0.025);
      const lean = mode === 'run' ? -0.2 : mode === 'panic' ? -0.28 : mode === 'limp' ? -0.08 : -0.04;
      set('spine', lean, Math.sin(ph) * 0.08, mode === 'limp' ? 0.12 : 0);
      set('chest', breathe, -Math.sin(ph) * 0.1);
      if (!hasGun || mode === 'panic') {
        set('shoulderL', -Math.sin(ph) * A * 0.8, 0, -0.08);
        set('shoulderR', Math.sin(ph) * A * 0.8, 0, 0.08);
        set('elbowL', 0.3 + (mode === 'run' || mode === 'panic' ? 0.9 : 0.1));
        set('elbowR', 0.3 + (mode === 'run' || mode === 'panic' ? 0.9 : 0.1));
        if (mode === 'panic') { set('shoulderL', 2.6 + Math.sin(ph * 2) * 0.3, 0, -0.3); set('elbowL', 0.8); }
      }
      set('neck', 0);
      set('head', s.lookPitch || 0);
      if (mode === 'crouchwalk') {
        bodyY -= 0.38;
        tgt.hipL[0] += 0.9; tgt.hipR[0] += 0.9;
        tgt.kneeL[0] -= 1.5; tgt.kneeR[0] -= 1.5;
        tgt.spine[0] -= 0.35;
      }
    } else {
      set('hipL'); set('hipR'); set('kneeL'); set('kneeR'); set('footL'); set('footR');
      set('spine', breathe * 0.5); set('chest', breathe); set('neck'); set('head', s.lookPitch || 0);
      set('shoulderL', 0.05, 0, -0.1); set('shoulderR', 0.05, 0, 0.1); set('elbowL', 0.15); set('elbowR', 0.15);
    }
    if (hasGun && mode !== 'panic') {
      if (s.aiming) {
        set('shoulderR', 1.25, -0.2, 0.25); set('elbowR', 0.45);
        set('shoulderL', 1.35, 0.25, -0.5); set('elbowL', 0.3);
      } else {
        // Low ready: muzzle down and across the body.
        set('shoulderR', 0.25, 0.3, 0.15); set('elbowR', 0.65);
        set('shoulderL', 0.75, 0.45, -0.3); set('elbowL', 0.85);
      }
    }
    switch (mode) {
      case 'crouch':
        bodyY = -0.4;
        set('hipL', 1.1, 0, -0.08); set('hipR', 0.7, 0, 0.08); set('kneeL', -1.8); set('kneeR', -1.5); set('footL', 0.65); set('footR', 0.75);
        set('spine', -0.3);
        break;
      case 'lookUp':
        set('head', 0.75); set('neck', 0.3); set('spine', 0.12);
        if (!hasGun) { set('shoulderR', 2.3, 0, 0.2); set('elbowR', 1.6); }
        break;
      case 'sitting':
        bodyY = -(this.dims.hipH - 0.13);
        set('hipL', 1.5, 0, -0.15); set('hipR', 1.35, 0, 0.12); set('kneeL', -0.15); set('kneeR', -0.5);
        set('spine', 0.18); set('head', -0.15 + Math.sin(this.t * 0.6) * 0.05);
        set('shoulderL', 0.25, 0, -0.15); set('elbowL', 0.9); set('shoulderR', 0.4, 0, 0.15); set('elbowR', 1.0);
        break;
      case 'lying':
        bodyRot = Math.PI / 2;
        bodyY = 0.14;
        set('hipL', 0, 0, -0.08); set('hipR', 0.15, 0, 0.12); set('kneeR', -0.3);
        set('shoulderL', 0, 0, -0.35); set('shoulderR', 0.1, 0, 0.3); set('elbowL', 0.2); set('elbowR', 0.4); set('head', 0, 0.4);
        break;
      case 'trapped':
        bodyRot = -Math.PI / 2;
        bodyY = 0.16;
        set('head', 0.5 + Math.sin(this.t * 0.8) * 0.06);
        set('shoulderL', 2.6, 0, -0.4); set('elbowL', 0.3);
        set('shoulderR', 2.4 + Math.max(0, Math.sin(this.t * 2.2)) * (s.wave || 0) * 0.6, 0, 0.5 + Math.sin(this.t * 6) * 0.2 * (s.wave || 0)); set('elbowR', 0.3);
        set('hipL', 0.05); set('hipR', -0.05);
        break;
      case 'wave':
        // Wave with the free hand if the right one holds a weapon.
        if (hasGun) { set('shoulderL', 2.7, 0, -0.35 - Math.sin(this.t * 7) * 0.35); set('elbowL', 0.4); } else { set('shoulderR', 2.7, 0, 0.35 + Math.sin(this.t * 7) * 0.35); set('elbowR', 0.4); }
        set('head', 0.15);
        break;
      case 'kneel':
        bodyY = -0.45;
        set('hipL', 1.4); set('kneeL', -1.4); set('footL', 0.0);
        set('hipR', -0.1); set('kneeR', -2.0); set('footR', 0.6);
        set('spine', -0.35);
        set('shoulderL', 1.0, 0, -0.1); set('elbowL', 0.9); set('shoulderR', 1.1, 0, 0.1); set('elbowR', 0.8 + Math.sin(this.t * 5) * 0.15);
        break;
      case 'dead':
        bodyRot = Math.PI / 2;
        bodyY = 0.13;
        set('shoulderL', 0.3, 0, -0.9); set('shoulderR', -0.2, 0, 1.1); set('hipR', 0.3); set('kneeR', -0.6); set('head', 0, -0.6);
        break;
      case 'board':
        set('shoulderL', 2.0); set('shoulderR', 2.0);
        break;
      default: break;
    }
    if (s.crouch && (mode === 'idle')) {
      bodyY = -0.4;
      set('hipL', 1.1, 0, -0.08); set('hipR', 0.7, 0, 0.08); set('kneeL', -1.8); set('kneeR', -1.5); set('footL', 0.65); set('footR', 0.75);
      set('spine', -0.25);
    }
    // Blend toward the target pose.
    const rate = 12;
    for (const [name, [x, y, z]] of Object.entries(tgt)) {
      const r = j[name].rotation;
      r.x = damp(r.x, x, rate, dt);
      r.y = damp(r.y, y, rate, dt);
      r.z = damp(r.z, z, rate, dt);
    }
    j.body.position.y = damp(j.body.position.y, bodyY, 10, dt);
    j.body.position.z = damp(j.body.position.z, bodyZ, 10, dt);
    j.body.rotation.x = damp(j.body.rotation.x, bodyRot, 6, dt);
  }
}

// Random civilian appearance.
export function civilianConfig(rng) {
  const female = rng() < 0.5;
  return {
    name: 'Civilian', gender: female ? 'female' : 'male', skin: rng.int(0, 9),
    hair: { style: female ? rng.pick(['ponytail', 'bob', 'bun', 'short']) : rng.pick(['short', 'crew', 'bald', 'curly']), color: rng.pick(['black', 'darkbrown', 'brown', 'blonde', 'grey', 'auburn']) },
    eyes: rng.pick(['brown', 'blue', 'green', 'hazel', 'grey']),
    facialHair: female ? 'none' : rng.pick(['none', 'none', 'stubble', 'beard']),
    face: { shape: rng.pick(['oval', 'round', 'square', 'long']), jaw: rng(), cheek: rng(), nose: rng(), brow: rng(), age: rng() },
  };
}

export function civilianColors(rng) {
  const shirts = ['#4a6a8a', '#8a3a32', '#d9d4c8', '#2f4f3f', '#6b5a7a', '#c48a3a', '#33373d', '#9fb3c8', '#7a2b48'];
  const pants = ['#2f3440', '#3a3a3a', '#4d4639', '#1f2a3d', '#6b6152'];
  return { shirt: rng.pick(shirts), pants: rng.pick(pants), shoes: rng.pick(['#2b2622', '#e8e6e0', '#4a3424']), build: rng.range(0.95, 1.12), shortSleeves: rng() < 0.4 };
}
