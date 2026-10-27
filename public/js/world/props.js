// Street furniture and vehicles. Repeated objects are InstancedMeshes built
// from one merged geometry with vertex colours (one draw call per kind).

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as M from './materials.js';
import { bake, trs, colorArray } from './geometry.js';
import { makeRng } from '../core/util.js';
import { LINES, STREET_HALF, STREET_NAMES } from './layout.js';

const CAR_COLORS = ['#b9bcc0', '#1d1f22', '#e8e8e6', '#7a1d1d', '#1d3557', '#4a5a3a', '#8a8a8a', '#d8c9a8'];

function part(geo, x, y, z, color, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  return bake(geo, trs(x, y, z, rx, ry, rz, sx, sy, sz), colorArray(color));
}

function carGeometry(type, wreck = false) {
  const parts = [];
  const B = (w, h, l, x, y, z, c) => parts.push(part(new THREE.BoxGeometry(w, h, l), x, y, z, c));
  const len = type === 'van' ? 5.0 : type === 'hatch' ? 3.9 : 4.4;
  if (type === 'van') {
    B(1.95, 1.0, len, 0, 0.85, 0, '#ffffff');
    if (!wreck) B(1.9, 0.6, len - 1.2, 0, 1.6, 0.4, '#ffffff');
    B(1.92, 0.55, 1.0, 0, 1.6, -len / 2 + 0.75, wreck ? '#0a0a0a' : '#20282e');
    B(1.9, 0.6, len - 1.6, 0, 1.6, 0.55, '#ffffff');
  } else {
    B(1.8, 0.62, len, 0, 0.62, 0, '#ffffff');
    B(1.62, 0.48, len * 0.48, 0, 1.17, type === 'hatch' ? 0.25 : 0.15, wreck ? '#0a0a0a' : '#1e262c');
    B(1.56, 0.06, len * 0.44, 0, 1.43, type === 'hatch' ? 0.25 : 0.15, '#ffffff');
  }
  const wheel = new THREE.CylinderGeometry(0.33, 0.33, 0.24, 12);
  for (const sx of [-0.86, 0.86]) for (const sz of [-len * 0.32, len * 0.32]) parts.push(part(wheel, sx, 0.33, sz, '#101010', 0, 0, Math.PI / 2));
  if (!wreck) {
    for (const sx of [-0.65, 0.65]) {
      B(0.32, 0.12, 0.05, sx, 0.78, -len / 2, '#f4f1e2');
      B(0.32, 0.12, 0.05, sx, 0.8, len / 2, '#a01010');
    }
  }
  B(0.5, 0.11, 0.02, 0, 0.5, -len / 2 - 0.01, '#f0f0f0'); // number plate
  return mergeGeometries(parts);
}

function lampGeometry() {
  const parts = [];
  parts.push(part(new THREE.CylinderGeometry(0.07, 0.1, 6.2, 8), 0, 3.1, 0, '#3c4044'));
  parts.push(part(new THREE.BoxGeometry(0.08, 0.08, 1.4), 0, 6.1, -0.65, '#3c4044'));
  parts.push(part(new THREE.BoxGeometry(0.35, 0.14, 0.6), 0, 6.02, -1.3, '#2a2d30'));
  parts.push(part(new THREE.BoxGeometry(0.3, 0.02, 0.5), 0, 5.94, -1.3, '#f6f0d8'));
  return mergeGeometries(parts);
}

function treeGeometry(burnt) {
  const parts = [];
  parts.push(part(new THREE.CylinderGeometry(0.16, 0.24, 3.4, 8), 0, 1.7, 0, burnt ? '#1a1612' : '#4a3a2a'));
  if (!burnt) {
    const ico = new THREE.IcosahedronGeometry(1.9, 1);
    parts.push(part(ico, 0, 4.4, 0, '#3f6a2c', 0, 0, 0, 1.1, 0.95, 1.1));
    parts.push(part(ico, 0.9, 5.4, 0.3, '#4b7a33', 0, 0, 0, 0.85, 0.8, 0.85));
    parts.push(part(ico, -0.7, 5.6, -0.5, '#365e26', 0, 0, 0, 0.8, 0.75, 0.8));
  } else {
    const branch = new THREE.CylinderGeometry(0.05, 0.09, 1.8, 6);
    parts.push(part(branch, 0.5, 3.8, 0, '#1a1612', 0, 0, -0.7));
    parts.push(part(branch, -0.4, 4.0, 0.2, '#1a1612', 0.4, 0, 0.8));
    parts.push(part(new THREE.IcosahedronGeometry(0.9, 0), 0.2, 4.6, 0, '#2a2a1c', 0, 0, 0, 1, 0.6, 1));
  }
  return mergeGeometries(parts);
}

function benchGeometry() {
  const parts = [];
  parts.push(part(new THREE.BoxGeometry(1.8, 0.06, 0.45), 0, 0.45, 0, '#6b4a2e'));
  parts.push(part(new THREE.BoxGeometry(1.8, 0.4, 0.05), 0, 0.72, 0.21, '#6b4a2e'));
  for (const x of [-0.75, 0.75]) parts.push(part(new THREE.BoxGeometry(0.06, 0.45, 0.45), x, 0.22, 0, '#2a2a2a'));
  return mergeGeometries(parts);
}

function binGeometry() {
  return mergeGeometries([
    part(new THREE.CylinderGeometry(0.25, 0.22, 0.85, 10), 0, 0.42, 0, '#d65a14'),
    part(new THREE.CylinderGeometry(0.04, 0.04, 1.0, 6), 0, 0.5, 0.28, '#3c4044'),
  ]);
}

function rockGeometry() {
  return new THREE.DodecahedronGeometry(0.35, 0);
}

function instanced(geo, mat, items, place, { shadow = true, colors = null } = {}) {
  const inst = new THREE.InstancedMesh(geo, mat, Math.max(1, items.length));
  const m = new THREE.Matrix4();
  items.forEach((it, i) => {
    inst.setMatrixAt(i, place(it, m, i));
    if (colors) inst.setColorAt(i, new THREE.Color(colors(it, i)));
  });
  inst.count = items.length;
  inst.castShadow = shadow;
  inst.receiveShadow = true;
  inst.instanceMatrix.needsUpdate = true;
  if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
  inst.computeBoundingSphere();
  return inst;
}

export class Props {
  constructor(group, L, state) {
    this.group = new THREE.Group();
    this.group.name = 'props';
    group.add(this.group);
    this.L = L;
    this.ruined = !!state.ruined;
    this.beacons = [];
    this.waterMeshes = [];
    this.t = 0;
    this.build(state);
  }

  build(state) {
    const L = this.L;
    const rng = makeRng(this.ruined ? 'props-ruined' : 'props');
    const vc = (rough = 0.8, metal = 0) => M.std('#ffffff', rough, metal, { vertexColors: true });
    const g = this.group;

    // Cars.
    const cars = L.props.cars.filter((c) => !c.special);
    const byType = {};
    for (const c of cars) {
      let variant = '';
      if (this.ruined) {
        const r = makeRng(`car${c.x.toFixed(1)}${c.z.toFixed(1)}`)();
        variant = r < 0.35 ? 'burnt' : r < 0.85 ? 'wreck' : '';
      }
      const key = `${c.type || 'sedan'}|${variant}`;
      (byType[key] ||= []).push(c);
    }
    this.carsByKey = byType;
    for (const [key, list] of Object.entries(byType)) {
      const [type, variant] = key.split('|');
      const geo = carGeometry(type, !!variant);
      const mat = variant === 'burnt' ? M.std('#ffffff', 0.95, 0.1, { vertexColors: true, map: null }) : vc(0.45, 0.3);
      const inst = instanced(geo, mat, list, (c, m) => {
        const tilt = variant ? (makeRng(`t${c.x}`)() - 0.5) * 0.12 : 0;
        return m.copy(trs(c.x, c.y || 0, c.z, tilt, c.yaw + (variant ? (makeRng(`y${c.z}`)() - 0.5) * 0.3 : 0), tilt * 0.5));
      }, { colors: (c) => (variant === 'burnt' ? '#2a2420' : variant === 'wreck' ? new THREE.Color(CAR_COLORS[c.color % 8]).multiplyScalar(0.55) : CAR_COLORS[c.color % 8]) });
      g.add(inst);
      if (variant === 'burnt') for (const c of list) this.burningCars = [...(this.burningCars || []), { x: c.x, y: 0.9, z: c.z }];
    }

    // Lamps.
    const lampGeo = lampGeometry();
    const lamps = L.props.lamps;
    this.lampMesh = instanced(lampGeo, vc(0.5, 0.5), lamps, (l, m, i) => {
      if (this.ruined && makeRng(`lamp${i}`)() < 0.22) {
        // Fallen across the sidewalk.
        return m.copy(trs(l.x, 0.12, l.z, Math.PI / 2 - 0.04, l.yaw + 0.6, 0));
      }
      return m.copy(trs(l.x, 0, l.z, 0, l.yaw, 0));
    });
    g.add(this.lampMesh);

    // Trees.
    const trees = L.props.trees;
    const burntSet = new Set();
    if (this.ruined) trees.forEach((t, i) => { if (makeRng(`tree${i}`)() < 0.35) burntSet.add(i); });
    const living = trees.filter((_, i) => !burntSet.has(i));
    const dead = trees.filter((_, i) => burntSet.has(i));
    g.add(instanced(treeGeometry(false), vc(0.9), living, (t, m) => m.copy(trs(t.x, 0, t.z, 0, t.x * 7.1, 0, t.s, t.s, t.s)), {
      colors: (t) => new THREE.Color().setHSL(0.24 + ((t.x * 13) % 1) * 0.06, 0.4, this.ruined ? 0.35 : 0.5),
    }));
    if (dead.length) g.add(instanced(treeGeometry(true), vc(0.95), dead, (t, m) => m.copy(trs(t.x, 0, t.z, 0, t.z, 0, t.s, t.s, t.s))));

    g.add(instanced(benchGeometry(), vc(0.8), L.props.benches, (b, m) => m.copy(trs(b.x, 0, b.z, 0, b.yaw, 0))));
    g.add(instanced(binGeometry(), vc(0.6), L.props.bins, (b, m) => m.copy(trs(b.x, 0, b.z, this.ruined ? 1.4 : 0, b.x, 0))));

    this.buildLandmarks(rng);
    if (this.ruined) this.buildRuins(rng, state);
    g.traverse((o) => { if (o.isMesh && !o.isInstancedMesh) { o.castShadow = true; o.receiveShadow = true; } });
  }

  buildLandmarks(rng) {
    const L = this.L;
    const g = this.group;
    // The bus waiting on Bahnhofstraße.
    if (L.bus) {
      const bus = new THREE.Group();
      const ruined = this.ruined;
      const body = ruined ? M.burnt() : M.std('#e9e2c8', 0.45, 0.2);
      const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); bus.add(m); return m; };
      add(new THREE.BoxGeometry(2.5, 2.4, 12), body, 0, 1.6, 0);
      if (!ruined) {
        add(new THREE.BoxGeometry(2.52, 0.9, 10.5), M.glass(), 0, 2.1, 0.2);
        add(new THREE.BoxGeometry(2.52, 0.2, 12.02), M.std('#b01818', 0.5), 0, 0.85, 0);
        const sign = add(new THREE.PlaneGeometry(1.8, 0.3), M.emissiveText('12 Hauptbahnhof', { w: 512, h: 80, bg: '#111', fg: '#ffb020', font: 'bold 48px monospace' }, 0.9), 0, 2.6, -6.02);
        sign.rotation.y = Math.PI;
      }
      for (const sx of [-1.2, 1.2]) for (const sz of [-4, 4]) {
        const w = add(new THREE.CylinderGeometry(0.5, 0.5, 0.3, 14), M.std('#111', 0.9), sx, ruined ? 0.3 : 0.5, sz);
        w.rotation.z = Math.PI / 2;
      }
      bus.position.set(L.bus.x, 0, L.bus.z);
      bus.rotation.y = L.bus.yaw;
      if (ruined) { bus.rotation.z = 0.06; bus.rotation.y += 0.25; }
      g.add(bus);
      this.bus = bus;
    }
    // Squad vehicle.
    if (L.squadVan) {
      const v = new THREE.Group();
      const mat = this.ruined ? M.burnt() : M.std('#3d4530', 0.6, 0.2);
      const body = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.9, 5.2), mat);
      body.position.y = 1.15;
      v.add(body);
      if (!this.ruined) {
        const w = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.6, 0.05), M.glass());
        w.position.set(0, 1.6, -2.62);
        v.add(w);
      }
      for (const sx of [-0.95, 0.95]) for (const sz of [-1.7, 1.7]) {
        const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.3, 12), M.std('#111', 0.9));
        wh.rotation.z = Math.PI / 2;
        wh.position.set(sx, 0.42, sz);
        v.add(wh);
      }
      v.position.set(L.squadVan.x, 0, L.squadVan.z);
      v.rotation.y = L.squadVan.yaw + (this.ruined ? 0.3 : 0);
      g.add(v);
    }
    // Bus stop with the green "H" sign.
    for (const s of L.props.busStops) {
      const st = new THREE.Group();
      const frame = M.std('#3c4044', 0.5, 0.6);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(4, 0.1, 1.5), frame);
      roof.position.y = 2.5;
      st.add(roof);
      if (!this.ruined) {
        const back = new THREE.Mesh(new THREE.BoxGeometry(4, 2.2, 0.04), M.glass());
        back.position.set(0, 1.3, 0.7);
        st.add(back);
      }
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.8), frame);
      pole.position.set(2.4, 1.4, -0.5);
      st.add(pole);
      const h = new THREE.Mesh(new THREE.CircleGeometry(0.3, 20), M.textPlane('H', { w: 128, h: 128, bg: '#f2c500', fg: '#1a7a2c', font: 'bold 100px Arial' }));
      h.position.set(2.4, 2.9, -0.52);
      h.rotation.y = Math.PI;
      st.add(h);
      st.position.set(s.x, 0, s.z);
      st.rotation.y = s.yaw;
      g.add(st);
    }
    // Fountain on the Marktplatz.
    for (const f of L.props.fountains) {
      const stone = M.std('#b4ab9c', 0.85);
      const basin = new THREE.Mesh(new THREE.CylinderGeometry(f.r, f.r + 0.2, 0.8, 32, 1, true), stone);
      basin.position.set(f.x, 0.4, f.z);
      g.add(basin);
      const water = new THREE.Mesh(new THREE.CircleGeometry(f.r - 0.1, 32), M.std(this.ruined ? '#3a3a2e' : '#4a6a78', 0.05, 0.4));
      water.rotation.x = -Math.PI / 2;
      water.position.set(f.x, 0.62, f.z);
      g.add(water);
      this.waterMeshes.push(water);
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 2.2, 12), stone);
      col.position.set(f.x, 1.1, f.z);
      g.add(col);
      const top = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 0.4, 0.4, 20), stone);
      top.position.set(f.x, 2.2, f.z);
      g.add(top);
    }
    // Litfaßsäulen (advertising columns) around the Marktplatz.
    const posters = ['STADTFEST 14.-16. JUNI', 'KONZERT IM PARK', 'THEATER KREUZHAFEN', 'FLOHMARKT SAMSTAG'];
    [[-26, 26], [26, -26], [-26, -26], [26, 26]].forEach(([x, z], i) => {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 0.65, 2.8, 20), M.textPlane(posters[i], { w: 1024, h: 256, bg: ['#d8c9a0', '#2a4b7a', '#7a2a2a', '#e8e0c0'][i], fg: i === 0 || i === 3 ? '#222' : '#fff', font: 'bold 64px Arial' }));
      col.position.set(x, 1.4, z);
      g.add(col);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.72, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2), M.std('#2d4a30', 0.6, 0.3));
      cap.position.set(x, 2.8, z);
      g.add(cap);
    });
    // Street name signs at intersections near the centre.
    for (const lx of [-30, 30, 90, -90]) {
      for (const lz of [-30, 30, 90]) {
        const name = STREET_NAMES.x[String(lx)];
        const name2 = STREET_NAMES.z[String(lz)];
        const p = new THREE.Group();
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 3), M.std('#5a5f63', 0.5, 0.6));
        pole.position.y = 1.5;
        p.add(pole);
        for (const [n, rot, y] of [[name, 0, 2.85], [name2, Math.PI / 2, 2.55]]) {
          const s = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.24, 0.03), M.textPlane(n, { w: 512, h: 96, bg: '#f4f4f0', fg: '#111', font: 'bold 64px Arial', border: '#111' }));
          s.position.y = y;
          s.rotation.y = rot;
          p.add(s);
        }
        p.position.set(lx + STREET_HALF - 0.6, 0, lz + STREET_HALF - 0.6);
        if (this.ruined && (lx + lz) % 60 === 0) p.rotation.z = 0.5;
        g.add(p);
      }
    }
    // Market stalls (opening only).
    if (!this.ruined) {
      for (const s of L.props.stalls) {
        const st = new THREE.Group();
        const table = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.8, 1.6), M.std('#7a5a3a', 0.8));
        table.position.y = 0.4;
        st.add(table);
        const roof = new THREE.Mesh(new THREE.ConeGeometry(1.9, 0.7, 4), M.std(rng() < 0.5 ? '#c8382c' : '#f0ead8', 0.9));
        roof.position.y = 2.6;
        roof.rotation.y = Math.PI / 4;
        st.add(roof);
        for (const [x, z] of [[-1.1, -0.7], [1.1, -0.7], [-1.1, 0.7], [1.1, 0.7]]) {
          const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.3), M.std('#ddd', 0.5));
          leg.position.set(x, 1.15, z);
          st.add(leg);
        }
        for (let i = 0; i < 8; i++) {
          const fruit = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), M.std(rng.pick(['#c0392b', '#e67e22', '#f1c40f', '#27ae60']), 0.6));
          fruit.position.set(-0.9 + (i % 4) * 0.6, 0.86, -0.3 + Math.floor(i / 4) * 0.5);
          st.add(fruit);
        }
        st.position.set(s.x, 0, s.z);
        g.add(st);
      }
    }
  }

  buildRuins(rng, state) {
    const L = this.L;
    const g = this.group;
    const vc = M.std('#ffffff', 0.9, 0, { vertexColors: true });
    // Rubble chunks along damaged facades and scattered over streets.
    const rocks = [];
    for (const b of L.buildings) {
      if (b.edge || b.damage < 1) continue;
      const n = b.damage * 6;
      const r = makeRng(`rocks${b.id}`);
      for (let i = 0; i < n; i++) {
        let x;
        let z;
        const t = r();
        const off = 0.5 + r() * (1 + b.damage);
        if (b.side === 'n') { x = b.x0 + t * (b.x1 - b.x0); z = b.z0 - off; } else if (b.side === 's') { x = b.x0 + t * (b.x1 - b.x0); z = b.z1 + off; } else if (b.side === 'w') { x = b.x0 - off; z = b.z0 + t * (b.z1 - b.z0); } else { x = b.x1 + off; z = b.z0 + t * (b.z1 - b.z0); }
        rocks.push({ x, z, s: 0.4 + r() * 1.3, r: r() * 6 });
      }
    }
    for (let i = 0; i < 260; i++) {
      const line = rng.pick(LINES);
      const s = rng.range(-150, 150);
      const off = rng.range(-6, 6);
      rocks.push(rng() < 0.5 ? { x: line + off, z: s, s: 0.3 + rng() * 0.6, r: rng() * 6 } : { x: s, z: line + off, s: 0.3 + rng() * 0.6, r: rng() * 6 });
    }
    g.add(instanced(rockGeometry(), M.surface('rubble'), rocks, (k, m) => m.copy(trs(k.x, k.s * 0.12, k.z, k.r, k.r * 2, k.r * 3, k.s, k.s * 0.6, k.s)), { shadow: false }));
    // Abandoned belongings: suitcases, bags, a pram, papers.
    const things = [];
    for (let i = 0; i < 70; i++) {
      const x = rng.range(-40, 60);
      const z = rng.range(-30, 95);
      things.push({ x, z, kind: rng.int(0, 3), r: rng() * 6 });
    }
    const belongingsGeo = [
      mergeGeometries([part(new THREE.BoxGeometry(0.5, 0.7, 0.22), 0, 0.11, 0, '#2b3d5a', Math.PI / 2)]),
      mergeGeometries([part(new THREE.BoxGeometry(0.35, 0.45, 0.2), 0, 0.15, 0, '#3a3a2a', 0.8)]),
      mergeGeometries([part(new THREE.BoxGeometry(0.42, 0.01, 0.3), 0, 0.01, 0, '#e8e4d8')]),
      mergeGeometries([part(new THREE.BoxGeometry(0.5, 0.45, 0.8), 0, 0.55, 0, '#6a2a4a'), part(new THREE.CylinderGeometry(0.14, 0.14, 0.04, 10), 0.28, 0.14, 0.3, '#111', 0, 0, Math.PI / 2), part(new THREE.CylinderGeometry(0.14, 0.14, 0.04, 10), -0.28, 0.14, 0.3, '#111', 0, 0, Math.PI / 2)]),
    ];
    for (let k = 0; k < 4; k++) {
      const list = things.filter((t) => t.kind === k);
      if (list.length) g.add(instanced(belongingsGeo[k], vc, list, (t, m) => m.copy(trs(t.x, 0, t.z, k === 3 ? 1.4 : 0, t.r, 0)), { shadow: false }));
    }
    // Wrecked emergency vehicles with flashing beacons.
    const vehicles = [
      { x: -3, z: -27.5, yaw: 0.4, kind: 'police' }, { x: 26, z: 38, yaw: 1.4, kind: 'ambulance' }, { x: -86, z: 25, yaw: -0.3, kind: 'police' },
      { x: 4, z: 93, yaw: 1.7, kind: 'ambulance' }, { x: 92, z: -26, yaw: 0.2, kind: 'fire' },
    ];
    this.emergency = vehicles;
    for (const v of vehicles) {
      const grp = new THREE.Group();
      const col = v.kind === 'police' ? '#e8eaec' : v.kind === 'fire' ? '#a3121a' : '#f2f2ee';
      const stripe = v.kind === 'police' ? '#1f4ea8' : v.kind === 'fire' ? '#eeeeee' : '#c81e1e';
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, v.kind === 'police' ? 0.7 : 1.9, v.kind === 'police' ? 4.6 : 5.4), M.std(col, 0.5, 0.2));
      body.position.y = v.kind === 'police' ? 0.65 : 1.2;
      grp.add(body);
      const band = new THREE.Mesh(new THREE.BoxGeometry(1.92, 0.18, v.kind === 'police' ? 4.62 : 5.42), M.std(stripe, 0.5));
      band.position.y = v.kind === 'police' ? 0.75 : 1.0;
      grp.add(band);
      if (v.kind === 'police') {
        const cab = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.5, 2.2), M.std('#0b0d0f', 0.2, 0.4));
        cab.position.set(0, 1.25, 0.2);
        grp.add(cab);
      }
      const beaconMat = new THREE.MeshStandardMaterial({ color: v.kind === 'police' ? '#1a4cff' : '#2a5cff', emissive: v.kind === 'fire' ? '#ff3010' : '#2050ff', emissiveIntensity: 0 });
      const y = v.kind === 'police' ? 1.58 : 2.25;
      for (const sx of [-0.45, 0.45]) {
        const bc = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.2), beaconMat);
        bc.position.set(sx, y, v.kind === 'police' ? 0.3 : -2.2);
        grp.add(bc);
      }
      grp.position.set(v.x, 0, v.z);
      grp.rotation.set(0, v.yaw, 0.04);
      g.add(grp);
      this.beacons.push({ mat: beaconMat, phase: rng() * 3, x: v.x, z: v.z });
    }
  }

  update(dt) {
    this.t += dt;
    for (const b of this.beacons) {
      const on = Math.sin((this.t + b.phase) * 9) > 0.2 && Math.sin((this.t + b.phase) * 1.7) > -0.6;
      b.mat.emissiveIntensity = on ? 3 : 0;
    }
  }

  // Indices of lamps near a point (for the destruction sequence).
  lampsNear(x, z, r) {
    return this.L.props.lamps.map((l, i) => ({ l, i })).filter(({ l }) => Math.hypot(l.x - x, l.z - z) < r);
  }

  hideLamp(i) {
    const m = new THREE.Matrix4().makeScale(0, 0, 0);
    this.lampMesh.setMatrixAt(i, m);
    this.lampMesh.instanceMatrix.needsUpdate = true;
  }

  static lampGeometry() { return lampGeometry(); }
}
