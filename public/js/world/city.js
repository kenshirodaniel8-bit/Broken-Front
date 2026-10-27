// Builds the meshes of Kreuzhafen from the layout, either intact (opening)
// or ruined (after the strike). Static geometry is merged per 60 m chunk and
// material; the buildings along the opening walk stay separate so the
// destruction sequence can animate them.

import * as THREE from 'three';
import { Buckets, wallQuad, flatQuad, boxGeo, bake, trs, colorArray } from './geometry.js';
import * as M from './materials.js';
import { LINES, ROAD_HALF, STREET_HALF, GROUND_H, FLOOR_H, EDGE, blockedRects, STREET_NAMES } from './layout.js';
import { rubbleShapes } from './collision.js';
import { makeRng } from '../core/util.js';
import { textTexture } from './textures.js';

const TILE_W = 3.4;
const SIGN_COLORS = {
  APOTHEKE: ['#c8102e', '#ffffff'], POLIZEI: ['#123c78', '#ffffff'], 'BÄCKEREI': ['#5a3a1e', '#f0c870'], FRISCHMARKT: ['#1f6b34', '#ffffff'],
  'ELEKTRO BRANDT': ['#152a52', '#ffd23f'], KIOSK: ['#f2f0ea', '#c8102e'], BAUMARKT: ['#e36b12', '#ffffff'], 'HOTEL KREUZHOF': ['#1c1a17', '#d9b25a'],
  RATHAUS: ['#cdb79a', '#3a2c1e'], HAUPTBAHNHOF: ['#1a3e7a', '#ffffff'], FEUERWEHR: ['#b3121a', '#ffffff'], 'SCHILLER-SCHULE': ['#e8e2d4', '#2a2a2a'],
};
const AWNING = ['#8a1c1c', '#1d4d2b', '#24406e', '#7a5a1c'];

// The opening walk: buildings here are built separately so the strike can
// animate them.
const DYNAMIC_ZONE = { x0: 0, x1: 62, z0: 26, z1: 100 };

export class City {
  constructor(scene, layout) {
    this.scene = scene;
    this.L = layout;
    this.group = new THREE.Group();
    this.group.name = 'city';
    scene.add(this.group);
    this.dynamic = new Map();
    this.debris = new Map();
    this.fires = [];
    this.smokes = [];
    this.beacons = [];
    this.facadeMeshes = [];
  }

  dispose() {
    this.group.traverse((o) => { if (o.isMesh || o.isInstancedMesh) o.geometry.dispose(); });
    this.scene.remove(this.group);
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.dynamic.clear();
    this.debris.clear();
    this.fires = [];
    this.smokes = [];
    this.facadeMeshes = [];
  }

  // state: { ruined, collapsed: Set, clearedDebris: Set, blast: [{x,z}] }
  build(state) {
    this.dispose();
    this.ruined = !!state.ruined;
    this.state = state;
    const B = new Buckets(60);
    this.buildGround(B, state);
    for (const b of this.L.buildings) {
      const dyn = !this.ruined && !b.edge && rectOverlap(b, DYNAMIC_ZONE);
      if (dyn) {
        const own = new Buckets(10000);
        this.buildBuilding(own, b, state);
        const pivot = new THREE.Group();
        const cx = (b.x0 + b.x1) / 2;
        const cz = (b.z0 + b.z1) / 2;
        pivot.position.set(cx, 0, cz);
        const inner = new THREE.Group();
        inner.position.set(-cx, 0, -cz);
        pivot.add(inner);
        const meshes = own.build(inner);
        this.facadeMeshes.push(...meshes.filter((m) => m.material.userData.facade));
        this.group.add(pivot);
        this.dynamic.set(b.id, pivot);
      } else if (this.ruined && state.collapsed.has(b.id)) {
        this.buildCollapsed(B, b);
      } else {
        this.buildBuilding(B, b, state);
      }
    }
    this.buildInteriors(B, state);
    this.buildSolids(B);
    if (this.ruined) this.buildStreetRubble(B, state);
    const meshes = B.build(this.group);
    this.facadeMeshes.push(...meshes.filter((m) => m.material.userData.facade));
    this.chunkMeshes = meshes;
    this.pickFireSpots(state);
  }

  // --- Ground ---------------------------------------------------------------

  buildGround(B, state) {
    const asphalt = M.surface('asphalt');
    const side = M.surface('sidewalk');
    const curb = M.std('#a7a39c', 0.85);
    const span = EDGE;
    // Asphalt everywhere (cut into chunk-sized tiles for culling).
    for (let x = -span; x < span; x += 60) {
      for (let z = -span; z < span; z += 60) {
        B.add(asphalt, flatQuad(x, z, Math.min(span, x + 60), Math.min(span, z + 60), 0, true, 6), x + 1, z + 1, { shadow: false });
      }
    }
    const sw = STREET_HALF - ROAD_HALF;
    const ring = (r, y = 0.015) => {
      const o = { x0: r.x0 - sw, x1: r.x1 + sw, z0: r.z0 - sw, z1: r.z1 + sw };
      const strips = [[o.x0, o.z0, o.x1, r.z0], [o.x0, r.z1, o.x1, o.z1], [o.x0, r.z0, r.x0, r.z1], [r.x1, r.z0, o.x1, r.z1]];
      for (const [a, b, c, d] of strips) B.add(side, flatQuad(a, b, c, d, y, true, 3), (a + c) / 2, (b + d) / 2, { shadow: false });
      // Curb stones at the road edge.
      const t = 0.18;
      for (const [a, b, c, d] of [[o.x0, o.z0, o.x1, o.z0 + t], [o.x0, o.z1 - t, o.x1, o.z1], [o.x0, o.z0, o.x0 + t, o.z1], [o.x1 - t, o.z0, o.x1, o.z1]]) {
        B.add(curb, boxGeo(a, c, 0, 0.13, b, d, 1, undefined, 'nsewt'), (a + c) / 2, (b + d) / 2, { shadow: false });
      }
    };
    const grounds = { plaza: 'cobble', park: 'grass', parking: 'concrete', church: 'cobble', gym: 'concrete', firestation: 'concrete', station: 'cobble', residential: 'gravel' };
    for (const bl of this.L.blocks) {
      ring(bl);
      const mat = M.surface(grounds[bl.kind] || 'gravel');
      B.add(mat, flatQuad(bl.x0, bl.z0, bl.x1, bl.z1, 0.012, true, bl.kind === 'park' ? 8 : 4), (bl.x0 + bl.x1) / 2, (bl.z0 + bl.z1) / 2, { shadow: false });
      if (bl.kind === 'park') {
        const gravel = M.surface('gravel');
        B.add(gravel, flatQuad(-1.6, bl.z0, 1.6, bl.z1, 0.018, true, 4), 0, (bl.z0 + bl.z1) / 2, { shadow: false });
        B.add(gravel, flatQuad(bl.x0, -121.6, bl.x1, -118.4, 0.018, true, 4), 0, -120, { shadow: false });
        // Landing zone circle (paved, for events in the park).
        const lz = new THREE.CircleGeometry(9, 32);
        lz.rotateX(-Math.PI / 2);
        B.add(gravel, bake(lz, trs(this.L.lz.x, 0.02, this.L.lz.z)), this.L.lz.x, this.L.lz.z, { shadow: false });
      }
    }
    // Outer sidewalk ring, facing the edge buildings.
    const inner = LINES[5] + ROAD_HALF;
    const outer = LINES[5] + STREET_HALF;
    for (const [a, b, c, d] of [[-outer, -outer, outer, -inner], [-outer, inner, outer, outer], [-outer, -inner, -inner, inner], [inner, -inner, outer, inner]]) {
      B.add(side, flatQuad(a, b, c, d, 0.015, true, 3), (a + c) / 2, (b + d) / 2, { shadow: false });
    }
    // Lane markings and zebra crossings.
    const paint = M.std('#e9e6dc', 0.7);
    for (const line of LINES) {
      for (let s = LINES[0]; s < LINES[5]; s += 6) {
        if (LINES.some((c) => Math.abs(s + 1.5 - c) < STREET_HALF + 1)) continue;
        B.add(paint, flatQuad(line - 0.07, s, line + 0.07, s + 3, 0.02, true, 1), line, s, { shadow: false });
        B.add(paint, flatQuad(s, line - 0.07, s + 3, line + 0.07, 0.02, true, 1), s, line, { shadow: false });
      }
    }
    for (const [cx, cz, axis] of [[0, -30, 'z'], [0, 30, 'z'], [-30, 0, 'x'], [30, 0, 'x'], [30, 60, 'x'], [45, 90, 'z']]) {
      for (let i = -4; i <= 4; i++) {
        if (axis === 'z') B.add(paint, flatQuad(cx + i * 0.9 - 0.25, cz - ROAD_HALF, cx + i * 0.9 + 0.25, cz + ROAD_HALF, 0.021, true, 1), cx, cz, { shadow: false });
        else B.add(paint, flatQuad(cx - ROAD_HALF, cz + i * 0.9 - 0.25, cx + ROAD_HALF, cz + i * 0.9 + 0.25, 0.021, true, 1), cx, cz, { shadow: false });
      }
    }
    if (this.ruined) {
      // Scorched craters where the strike landed, and debris along damaged facades.
      for (const p of state.blast || []) {
        const r = 7;
        B.add(M.scorch(), flatQuad(p.x - r, p.z - r, p.x + r, p.z + r, 0.03, true, r * 2, undefined, [0.5 - p.x / (r * 2), 0.5 + p.z / (r * 2)]), p.x, p.z, { shadow: false });
      }
      const rub = M.surface('rubble');
      for (const b of this.L.buildings) {
        if (b.edge || b.damage < 1 || state.collapsed.has(b.id)) continue;
        const w = 1.0 + b.damage * 0.5;
        const r = sideStrip(b, w);
        if (r) B.add(rub, flatQuad(r.x0, r.z0, r.x1, r.z1, 0.025, true, 3), (r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2, { shadow: false });
      }
    }
  }

  // --- Buildings ---------------------------------------------------------------

  buildBuilding(B, b, state) {
    const ruined = this.ruined;
    const dmg = ruined ? Math.min(2, b.damage) : 0;
    const tint = colorArray(b.color);
    const cx = (b.x0 + b.x1) / 2;
    const cz = (b.z0 + b.z1) / 2;
    const add = (mat, geo) => B.add(mat, geo, cx, cz);
    let h = b.h;
    if (ruined && b.damage >= 3) h = GROUND_H + FLOOR_H * 1.4;
    const facadeMat = M.facade(b.style || 0, dmg);
    facadeMat.userData.facade = { style: b.style || 0 };
    const gfKind = b.shopFront ? 'shop' : 'plain';
    const gfMat = M.groundFloor(gfKind, dmg);
    gfMat.userData.facade = { ground: gfKind };
    const plaster = M.plaster();
    const sides = {
      n: [b.x1, b.z0, b.x0, b.z0], s: [b.x0, b.z1, b.x1, b.z1], w: [b.x0, b.z0, b.x0, b.z1], e: [b.x1, b.z1, b.x1, b.z0],
    };
    const door = b.enterable ? b.door : null;
    for (const [side, [ax, az, bx, bz]] of Object.entries(sides)) {
      const len = Math.hypot(bx - ax, bz - az);
      const reps = Math.max(1, Math.round(len / TILE_W));
      // Upper floors.
      if (h > GROUND_H) add(facadeMat, wallQuad(ax, az, bx, bz, GROUND_H, h, [0, 0, reps, (h - GROUND_H) / FLOOR_H], tint));
      // Ground floor, with a door or archway gap where needed.
      const gaps = [];
      if (door && door.side === side) gaps.push({ c: doorCenterAlong(b, side), w: door.width, h: 2.5 });
      if (b.passage && ((side === 'n' || side === 's') === (b.side === 'n' || b.side === 's'))) {
        gaps.push({ c: len / 2, w: b.passage.width, h: b.passage.height });
      }
      const gh = Math.min(GROUND_H, h);
      if (!gaps.length) add(gfMat, wallQuad(ax, az, bx, bz, 0, gh, [0, 0, reps, 1], tint));
      else {
        const dirx = (bx - ax) / len;
        const dirz = (bz - az) / len;
        let s0 = 0;
        for (const g of gaps.sort((p, q) => p.c - q.c)) {
          const g0 = g.c - g.w / 2;
          const g1 = g.c + g.w / 2;
          const P = (s) => [ax + dirx * s, az + dirz * s];
          if (g0 > s0) add(gfMat, wallQuad(...P(s0), ...P(g0), 0, gh, [s0 / TILE_W, 0, g0 / TILE_W, 1], tint));
          add(plaster, wallQuad(...P(g0), ...P(g1), g.h, gh, [0, g.h, g.w / 2, gh / 2], tint));
          // Reveals (the thickness of the wall) on both sides and the top.
          const inx = -dirz * -0.35;
          const inz = dirx * -0.35;
          const [p0x, p0z] = P(g0);
          const [p1x, p1z] = P(g1);
          add(plaster, wallQuad(p0x, p0z, p0x + inx, p0z + inz, 0, g.h, [0, 0, 0.2, 1], tint));
          add(plaster, wallQuad(p1x + inx, p1z + inz, p1x, p1z, 0, g.h, [0, 0, 0.2, 1], tint));
          s0 = g1;
        }
        if (s0 < len) add(gfMat, wallQuad(ax + dirx * s0, az + dirz * s0, bx, bz, 0, gh, [s0 / TILE_W, 0, len / TILE_W, 1], tint));
      }
      // Shop sign and awning on the street side.
      if (b.sign && door && door.side === side) this.addSign(B, b, side, ax, az, bx, bz, len, ruined);
    }
    if (b.passage) this.addPassage(B, b, tint);
    // Roof.
    if (ruined && b.damage >= 2) {
      add(M.surface('rubble'), flatQuad(b.x0, b.z0, b.x1, b.z1, h - 0.4, true, 4));
      // Charred roof beams.
      const rng = makeRng(b.id);
      const beam = M.burnt();
      for (let i = 0; i < 4; i++) {
        const x = b.x0 + rng() * (b.x1 - b.x0);
        add(beam, bake(new THREE.BoxGeometry(0.2, 0.2, Math.min(6, b.z1 - b.z0)), trs(x, h + 0.4, cz, rng() * 0.6 - 0.3, 0, rng() * 0.4)));
      }
    } else this.addRoof(B, b, h, tint, add);
    if (b.tower && !(ruined && b.damage >= 2 && b.id === 'rathaus' && false)) this.addTower(B, b, add);
  }

  addSign(B, b, side, ax, az, bx, bz, len, ruined) {
    const [bg, fg] = SIGN_COLORS[b.sign] || ['#222', '#fff'];
    const mat = M.textPlane(b.sign, { w: 512, h: 96, bg, fg, font: 'bold 60px Arial' });
    const dirx = (bx - ax) / len;
    const dirz = (bz - az) / len;
    const c = doorCenterAlong(b, side);
    const w = Math.min(len - 1, Math.max(5, b.sign.length * 0.45));
    const nx = -dirz;
    const nz = dirx;
    const off = 0.06;
    const s0x = ax + dirx * (c - w / 2) - nx * -off;
    const s0z = az + dirz * (c - w / 2) - nz * -off;
    const s1x = ax + dirx * (c + w / 2) - nx * -off;
    const s1z = az + dirz * (c + w / 2) - nz * -off;
    const tilt = ruined && b.damage > 0;
    B.add(mat, wallQuad(s0x, s0z, s1x, s1z, tilt ? 3.0 : 3.2, tilt ? 3.75 : 3.95, [0, 0, 1, 1]), (b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2);
    if (!ruined && b.type !== 'townhall' && b.type !== 'station' && b.type !== 'gym' && b.type !== 'firestation' && b.type !== 'church') {
      // Awning sloping out over the sidewalk.
      const col = AWNING[(b.sign.length) % AWNING.length];
      const awn = M.std(col, 0.9, 0, { side: THREE.DoubleSide });
      const d = 1.3;
      const pos = [];
      const p = (x, y, z) => pos.push(x, y, z);
      const ox = nx * d;
      const oz = nz * d;
      const x0 = ax + dirx * 0.3; const z0 = az + dirz * 0.3; const x1 = bx - dirx * 0.3; const z1 = bz - dirz * 0.3;
      p(x0, 3.05, z0); p(x1, 3.05, z1); p(x1 + ox, 2.55, z1 + oz);
      p(x0, 3.05, z0); p(x1 + ox, 2.55, z1 + oz); p(x0 + ox, 2.55, z0 + oz);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.computeVertexNormals();
      g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(12).fill(0), 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(18).fill(1), 3));
      B.add(awn, g, (b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2);
    }
  }

  addPassage(B, b, tint) {
    const dark = M.std('#5c5750', 0.95);
    const pw = b.passage.width / 2;
    const ph = b.passage.height;
    if (b.side === 'n' || b.side === 's') {
      const c = (b.x0 + b.x1) / 2;
      B.add(dark, wallQuad(c - pw, b.z1, c - pw, b.z0, 0, ph, [0, 0, 3, 1], tint), c, b.z0);
      B.add(dark, wallQuad(c + pw, b.z0, c + pw, b.z1, 0, ph, [0, 0, 3, 1], tint), c, b.z0);
      B.add(dark, flatQuad(c - pw, b.z0, c + pw, b.z1, ph, false, 2, tint), c, b.z0);
    } else {
      const c = (b.z0 + b.z1) / 2;
      B.add(dark, wallQuad(b.x0, c - pw, b.x1, c - pw, 0, ph, [0, 0, 3, 1], tint), b.x0, c);
      B.add(dark, wallQuad(b.x1, c + pw, b.x0, c + pw, 0, ph, [0, 0, 3, 1], tint), b.x0, c);
      B.add(dark, flatQuad(b.x0, c - pw, b.x1, c + pw, ph, false, 2, tint), b.x0, c);
    }
  }

  addRoof(B, b, h, tint, add) {
    const w = b.x1 - b.x0;
    const d = b.z1 - b.z0;
    const plaster = M.plaster();
    const kind = b.roof;
    if (kind === 'flat' || kind === 'belfry') {
      add(M.roof('flat'), flatQuad(b.x0, b.z0, b.x1, b.z1, h, true, 4));
      const t = 0.3;
      for (const [x0, x1, z0, z1] of [[b.x0, b.x1, b.z0, b.z0 + t], [b.x0, b.x1, b.z1 - t, b.z1], [b.x0, b.x0 + t, b.z0, b.z1], [b.x1 - t, b.x1, b.z0, b.z1]]) {
        add(plaster, boxGeo(x0, x1, h, h + (kind === 'belfry' ? 1.1 : 0.7), z0, z1, 2, tint, 'nsewt'));
      }
      if (kind === 'belfry') {
        const stone = M.std('#a39784', 0.9);
        for (const [x, z] of [[b.x0 + 0.4, b.z0 + 0.4], [b.x1 - 0.4, b.z0 + 0.4], [b.x0 + 0.4, b.z1 - 0.4], [b.x1 - 0.4, b.z1 - 0.4]]) {
          add(stone, boxGeo(x - 0.4, x + 0.4, h, h + 3.6, z - 0.4, z + 0.4, 2));
        }
        const cone = new THREE.ConeGeometry(Math.max(w, d) * 0.78, 8, 4, 1, true);
        add(M.roof('slate'), bake(cone, trs((b.x0 + b.x1) / 2, h + 3.6 + 4, (b.z0 + b.z1) / 2, 0, Math.PI / 4)));
        const bell = new THREE.CylinderGeometry(0.5, 0.9, 1.2, 12);
        add(M.std('#7a5a2a', 0.4, 0.8), bake(bell, trs((b.x0 + b.x1) / 2, h + 2.4, (b.z0 + b.z1) / 2)));
      }
      return;
    }
    if (kind === 'barrel') {
      const cyl = new THREE.CylinderGeometry(d / 2, d / 2, w, 20, 1, true, 0, Math.PI);
      add(M.roof('slate'), bake(cyl, trs((b.x0 + b.x1) / 2, h, (b.z0 + b.z1) / 2, 0, 0, Math.PI / 2, 1, 1, 0.45)));
      add(plaster, wallQuad(b.x0, b.z0, b.x0, b.z1, h, h + 0.6, [0, 0, 2, 1], tint));
      add(plaster, wallQuad(b.x1, b.z1, b.x1, b.z0, h, h + 0.6, [0, 0, 2, 1], tint));
      return;
    }
    // Pitched or mansard, ridge along the long side unless specified.
    const alongX = b.ridge ? b.ridge === 'x' : w >= d;
    const span = alongX ? d : w;
    const rh = kind === 'mansard' ? Math.min(3.6, span * 0.32) : Math.min(5.5, span * 0.42);
    const mat = M.roof(kind === 'mansard' ? 'slate' : 'tile');
    const pos = [];
    const uvs = [];
    const tri = (a, bb, c, ua, ub, uc) => { pos.push(...a, ...bb, ...c); uvs.push(...ua, ...ub, ...uc); };
    const quad = (a, bb, c, dd, len, wid) => { tri(a, bb, c, [0, 0], [len, 0], [len, wid]); tri(a, c, dd, [0, 0], [len, wid], [0, wid]); };
    const s = 4;
    if (alongX) {
      const zm = (b.z0 + b.z1) / 2;
      if (kind === 'mansard') {
        const i = span * 0.18;
        quad([b.x0, h, b.z1], [b.x1, h, b.z1], [b.x1 - 0.3, h + rh * 0.75, b.z1 - i], [b.x0 + 0.3, h + rh * 0.75, b.z1 - i], w / s, 1);
        quad([b.x1, h, b.z0], [b.x0, h, b.z0], [b.x0 + 0.3, h + rh * 0.75, b.z0 + i], [b.x1 - 0.3, h + rh * 0.75, b.z0 + i], w / s, 1);
        quad([b.x0 + 0.3, h + rh * 0.75, b.z1 - i], [b.x1 - 0.3, h + rh * 0.75, b.z1 - i], [b.x1 - 0.3, h + rh, zm], [b.x0 + 0.3, h + rh, zm], w / s, 1);
        quad([b.x1 - 0.3, h + rh * 0.75, b.z0 + i], [b.x0 + 0.3, h + rh * 0.75, b.z0 + i], [b.x0 + 0.3, h + rh, zm], [b.x1 - 0.3, h + rh, zm], w / s, 1);
        // Ends.
        tri([b.x0, h, b.z0], [b.x0, h, b.z1], [b.x0 + 0.3, h + rh, zm], [0, 0], [d / s, 0], [d / s / 2, 1]);
        tri([b.x1, h, b.z1], [b.x1, h, b.z0], [b.x1 - 0.3, h + rh, zm], [0, 0], [d / s, 0], [d / s / 2, 1]);
      } else {
        quad([b.x0 - 0.3, h - 0.2, b.z1 + 0.3], [b.x1 + 0.3, h - 0.2, b.z1 + 0.3], [b.x1 + 0.3, h + rh, zm], [b.x0 - 0.3, h + rh, zm], w / s, span / s);
        quad([b.x1 + 0.3, h - 0.2, b.z0 - 0.3], [b.x0 - 0.3, h - 0.2, b.z0 - 0.3], [b.x0 - 0.3, h + rh, zm], [b.x1 + 0.3, h + rh, zm], w / s, span / s);
        // Gables in plaster.
        const gp = [b.x0, h, b.z0, b.x0, h, b.z1, b.x0, h + rh, zm, b.x1, h, b.z1, b.x1, h, b.z0, b.x1, h + rh, zm];
        add(plaster, rawGeo(gp, tint));
      }
    } else {
      const xm = (b.x0 + b.x1) / 2;
      if (kind === 'mansard') {
        const i = span * 0.18;
        quad([b.x0, h, b.z0], [b.x0, h, b.z1], [b.x0 + i, h + rh * 0.75, b.z1 - 0.3], [b.x0 + i, h + rh * 0.75, b.z0 + 0.3], d / s, 1);
        quad([b.x1, h, b.z1], [b.x1, h, b.z0], [b.x1 - i, h + rh * 0.75, b.z0 + 0.3], [b.x1 - i, h + rh * 0.75, b.z1 - 0.3], d / s, 1);
        quad([b.x0 + i, h + rh * 0.75, b.z0 + 0.3], [b.x0 + i, h + rh * 0.75, b.z1 - 0.3], [xm, h + rh, b.z1 - 0.3], [xm, h + rh, b.z0 + 0.3], d / s, 1);
        quad([b.x1 - i, h + rh * 0.75, b.z1 - 0.3], [b.x1 - i, h + rh * 0.75, b.z0 + 0.3], [xm, h + rh, b.z0 + 0.3], [xm, h + rh, b.z1 - 0.3], d / s, 1);
        tri([b.x1, h, b.z0], [b.x0, h, b.z0], [xm, h + rh, b.z0 + 0.3], [0, 0], [w / s, 0], [w / s / 2, 1]);
        tri([b.x0, h, b.z1], [b.x1, h, b.z1], [xm, h + rh, b.z1 - 0.3], [0, 0], [w / s, 0], [w / s / 2, 1]);
      } else {
        quad([b.x0 - 0.3, h - 0.2, b.z0 - 0.3], [b.x0 - 0.3, h - 0.2, b.z1 + 0.3], [xm, h + rh, b.z1 + 0.3], [xm, h + rh, b.z0 - 0.3], d / s, span / s);
        quad([b.x1 + 0.3, h - 0.2, b.z1 + 0.3], [b.x1 + 0.3, h - 0.2, b.z0 - 0.3], [xm, h + rh, b.z0 - 0.3], [xm, h + rh, b.z1 + 0.3], d / s, span / s);
        const gp = [b.x1, h, b.z0, b.x0, h, b.z0, xm, h + rh, b.z0, b.x0, h, b.z1, b.x1, h, b.z1, xm, h + rh, b.z1];
        add(plaster, rawGeo(gp, tint));
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.computeVertexNormals();
    g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(pos.length).fill(1), 3));
    add(mat, g);
    // Chimneys.
    const rng = makeRng(`${b.id}chim`);
    if (rng() < 0.7) {
      const x = b.x0 + w * (0.2 + rng() * 0.6);
      const z = b.z0 + d * (0.3 + rng() * 0.4);
      add(M.std('#7d4a38', 0.9), boxGeo(x - 0.35, x + 0.35, h, h + rh + 1.0, z - 0.35, z + 0.35, 1));
    }
  }

  addTower(B, b, add) {
    const t = b.tower;
    const x0 = t.x - t.w / 2;
    const x1 = t.x + t.w / 2;
    const z0 = t.z - t.w / 2;
    const z1 = t.z + t.w / 2;
    const tint = colorArray(b.color);
    const mat = M.facade(b.style || 6, this.ruined ? 1 : 0);
    const reps = Math.max(1, Math.round(t.w / TILE_W));
    const top = this.ruined && b.id === 'rathaus' ? t.h - 6 : t.h;
    for (const [ax, az, bx, bz] of [[x1, z0, x0, z0], [x0, z1, x1, z1], [x0, z0, x0, z1], [x1, z1, x1, z0]]) {
      add(mat, wallQuad(ax, az, bx, bz, b.h - 0.5, top, [0, 0, reps, (top - b.h) / FLOOR_H], tint));
    }
    if (b.id === 'rathaus') {
      const clock = clockMaterial();
      const y = top - 3.5;
      add(clock, wallQuad(t.x - 1.2, z1 + 0.05, t.x + 1.2, z1 + 0.05, y - 1.2, y + 1.2, [0, 0, 1, 1]));
      add(clock, wallQuad(t.x + 1.2, z0 - 0.05, t.x - 1.2, z0 - 0.05, y - 1.2, y + 1.2, [0, 0, 1, 1]));
    }
    if (!this.ruined || b.id !== 'rathaus') {
      const cone = new THREE.ConeGeometry(t.w * 0.75, b.id === 'rathaus' ? 7 : 3, 4, 1, true);
      add(M.roof('slate'), bake(cone, trs(t.x, top + (b.id === 'rathaus' ? 3.5 : 1.5), t.z, 0, Math.PI / 4)));
    } else {
      add(M.surface('rubble'), flatQuad(x0, z0, x1, z1, top, true, 3));
    }
  }

  buildCollapsed(B, b) {
    const rng = makeRng(`collapse:${b.id}`);
    const rub = M.surface('rubble');
    const shapes = rubbleShapes(b);
    const main = shapes[0];
    const mh = Math.min(6.5, 3 + b.h * 0.15);
    B.add(rub, moundGeo(main.x0 - 0.6, main.x1 + 0.6, main.z0 - 0.6, main.z1 + 0.6, mh, `${b.id}m`), (b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2);
    if (shapes[1]) B.add(rub, moundGeo(shapes[1].x0 - 0.5, shapes[1].x1 + 0.5, shapes[1].z0 - 0.5, shapes[1].z1 + 0.5, 1.6, `${b.id}s`), (b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2);
    // Standing wall fragments with jagged tops.
    const tint = colorArray(b.color);
    const fmat = M.facade(b.style || 0, 2);
    fmat.userData.facade = { style: b.style || 0 };
    const sides = { n: [b.x1, b.z0, b.x0, b.z0], s: [b.x0, b.z1, b.x1, b.z1], w: [b.x0, b.z0, b.x0, b.z1], e: [b.x1, b.z1, b.x1, b.z0] };
    const pick = rng.shuffle(Object.keys(sides)).slice(0, 2);
    for (const sd of pick) {
      const [ax, az, bx, bz] = sides[sd];
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.max(2, Math.floor(len / 2.2));
      const piece = len / n;
      const dx = (bx - ax) / len;
      const dz = (bz - az) / len;
      const start = rng.int(0, Math.max(0, n - 3));
      const count = rng.int(2, Math.min(5, n - start));
      for (let i = start; i < start + count; i++) {
        const top = GROUND_H + rng() * FLOOR_H * Math.min(3, b.floors - 1) * (1 - Math.abs(i - start - count / 2) / count);
        const s0 = i * piece;
        const s1 = s0 + piece;
        const geo = wallQuad(ax + dx * s0, az + dz * s0, ax + dx * s1, az + dz * s1, 0, top, [s0 / TILE_W, -GROUND_H / FLOOR_H, s1 / TILE_W, (top - GROUND_H) / FLOOR_H], tint);
        B.add(fmat, geo, ax, az);
        const back = wallQuad(ax + dx * s1 - dz * 0.01, az + dz * s1 + dx * 0.01, ax + dx * s0 - dz * 0.01, az + dz * s0 + dx * 0.01, 0, top, [0, 0, 1, top / 3], tint);
        B.add(M.plaster(), back, ax, az);
      }
    }
    // Concrete slabs and beams sticking out of the heap.
    const slab = M.surface('concrete');
    for (let i = 0; i < 5; i++) {
      const x = main.x0 + rng() * (main.x1 - main.x0);
      const z = main.z0 + rng() * (main.z1 - main.z0);
      B.add(slab, bake(new THREE.BoxGeometry(2 + rng() * 3, 0.25, 1.5 + rng() * 2.5), trs(x, mh * (0.4 + rng() * 0.4), z, rng() - 0.5, rng() * 3, rng() - 0.5)), x, z);
    }
    this.smokes.push({ x: (b.x0 + b.x1) / 2, y: mh, z: (b.z0 + b.z1) / 2, size: 1 });
  }

  buildStreetRubble(B, state) {
    const rub = M.surface('rubble');
    for (const r of blockedRects()) {
      B.add(rub, moundGeo(r.x0 - 1, r.x1 + 1, r.z0 - 1, r.z1 + 1, 3.8, `blk${r.x0}${r.z0}`), (r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2);
      const rng = makeRng(`blk${r.x0}`);
      for (let i = 0; i < 4; i++) {
        const x = r.x0 + rng() * (r.x1 - r.x0);
        const z = r.z0 + rng() * (r.z1 - r.z0);
        B.add(M.surface('concrete'), bake(new THREE.BoxGeometry(3, 0.3, 2), trs(x, 2.5 + rng(), z, rng() - 0.5, rng() * 3, rng() - 0.5)), x, z);
      }
    }
    for (const d of this.L.debrisSites) {
      if (state.clearedDebris?.has(d.id)) continue;
      const g = new THREE.Group();
      const own = new Buckets(10000);
      own.add(rub, moundGeo(d.x - d.w / 2 - 0.4, d.x + d.w / 2 + 0.4, d.z - d.d / 2 - 0.4, d.z + d.d / 2 + 0.4, 2.4, d.id), d.x, d.z);
      own.add(M.surface('concrete'), bake(new THREE.BoxGeometry(3.2, 0.3, 1.2), trs(d.x, 1.8, d.z, 0.4, 0.2, 0.3)), d.x, d.z);
      own.build(g);
      this.group.add(g);
      this.debris.set(d.id, g);
    }
  }

  removeDebris(id) {
    const g = this.debris.get(id);
    if (!g) return;
    g.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
    this.group.remove(g);
    this.debris.delete(id);
  }

  // --- Interiors -------------------------------------------------------------------

  buildInteriors(B, state) {
    const floorKind = { supermarket: 'tiles', pharmacy: 'tiles', electronics: 'tiles', kiosk: 'tiles', bakery: 'tiles', hardware: 'concrete', police: 'tiles', apartment: 'wood', hotel: 'wood', townhall: 'wood', church: 'cobble', gym: 'wood', firestation: 'concrete', station: 'tiles', parking_office: 'concrete' };
    const wallMat = M.surface('wall');
    const shelfMat = M.std('#8e939a', 0.5, 0.5);
    const goods = M.std('#ffffff', 0.8, 0, { vertexColors: true });
    const wood = M.surface('wood');
    const rng = makeRng('interiors');
    for (const it of this.L.interiors) {
      const b = this.L.buildings.find((k) => k.id === it.building);
      const cx = (it.x0 + it.x1) / 2;
      const cz = (it.z0 + it.z1) / 2;
      const add = (mat, geo) => B.add(mat, geo, cx, cz);
      const H = it.height || 3.8;
      add(M.surface(floorKind[it.type] || 'tiles'), flatQuad(it.x0, it.z0, it.x1, it.z1, 0.03, true, 2.5));
      add(wallMat, flatQuad(it.x0, it.z0, it.x1, it.z1, H, false, 3));
      if (b) {
        // Inner walls facing into the room, with the door gap.
        const inner = { n: [it.x0, it.z0, it.x1, it.z0], s: [it.x1, it.z1, it.x0, it.z1], w: [it.x0, it.z1, it.x0, it.z0], e: [it.x1, it.z0, it.x1, it.z1] };
        for (const [side, [ax, az, bx, bz]] of Object.entries(inner)) {
          const len = Math.hypot(bx - ax, bz - az);
          if (b.door.side !== side) { add(wallMat, wallQuad(ax, az, bx, bz, 0, H, [0, 0, len / 3, H / 3])); continue; }
          // Door centre measured from this wall's start point.
          const outerC = doorCenterAlong(b, side);
          const outerLen = side === 'n' || side === 's' ? b.x1 - b.x0 : b.z1 - b.z0;
          const c = len - (outerC - (outerLen - len) / 2);
          const g0 = c - b.door.width / 2;
          const g1 = c + b.door.width / 2;
          const dx = (bx - ax) / len;
          const dz = (bz - az) / len;
          add(wallMat, wallQuad(ax, az, ax + dx * g0, az + dz * g0, 0, H, [0, 0, g0 / 3, H / 3]));
          add(wallMat, wallQuad(ax + dx * g1, az + dz * g1, bx, bz, 0, H, [g1 / 3, 0, len / 3, H / 3]));
          add(wallMat, wallQuad(ax + dx * g0, az + dz * g0, ax + dx * g1, az + dz * g1, 2.5, H, [0, 0, 1, 0.5]));
        }
      }
      for (const f of it.furniture) this.addFurniture(add, f, { shelfMat, goods, wood, rng, ruined: this.ruined });
      if (this.ruined) {
        // Fallen plaster and ceiling debris.
        const rub = M.surface('rubble');
        for (let i = 0; i < 3; i++) {
          const x = it.x0 + 1 + rng() * (it.x1 - it.x0 - 2);
          const z = it.z0 + 1 + rng() * (it.z1 - it.z0 - 2);
          add(rub, bake(new THREE.DodecahedronGeometry(0.5 + rng() * 0.4, 0), trs(x, 0.1, z, rng(), rng(), rng(), 1, 0.35, 1)));
        }
      }
    }
    // Container props that aren't furniture.
    const crate = M.std('#8a6a44', 0.85);
    const suitcase = [M.std('#2b3d5a', 0.6), M.std('#7a2420', 0.6), M.std('#2e2e2e', 0.6)];
    for (const c of this.L.containers) {
      if (c.kind === 'crate') add2(B, crate, boxGeo(c.x - 0.45, c.x + 0.45, c.y, c.y + 0.7, c.z - 0.4, c.z + 0.4, 1), c);
      if (c.kind === 'luggage') add2(B, suitcase[Math.abs(c.id.length) % 3], bake(new THREE.BoxGeometry(0.5, 0.7, 0.24), trs(c.x, c.y + 0.35, c.z, 0, rng() * 3, 0)), c);
      if (c.kind === 'vending') add2(B, M.std('#b31d22', 0.5, 0.2), boxGeo(c.x - 0.45, c.x + 0.45, 0, 1.9, c.z - 0.45, c.z + 0.45, 1), c);
    }
  }

  addFurniture(add, f, { shelfMat, goods, wood, rng, ruined }) {
    const x0 = f.x - f.sx / 2;
    const x1 = f.x + f.sx / 2;
    const z0 = f.z - f.sz / 2;
    const z1 = f.z + f.sz / 2;
    const color = (h, s, l) => colorArray(new THREE.Color().setHSL(h, s, l).getHex());
    switch (f.kind) {
      case 'shelf':
      case 'display': {
        const levels = f.kind === 'shelf' ? 4 : 1;
        add(shelfMat, boxGeo(x0, x1, 0, f.h, z0 + (f.sz > f.sx ? 0 : f.sz * 0.35), z1 - (f.sz > f.sx ? 0 : f.sz * 0.35), 1, undefined, 'nsewt'));
        for (let l = 0; l < levels; l++) {
          const y = 0.15 + (l * (f.h - 0.2)) / levels;
          add(shelfMat, boxGeo(x0 - 0.02, x1 + 0.02, y, y + 0.03, z0 - 0.02, z1 + 0.02, 1));
          const along = f.sx > f.sz;
          const n = Math.floor((along ? f.sx : f.sz) / 0.28);
          for (let i = 0; i < n; i++) {
            if (ruined && rng() < 0.55) continue;
            const t = (i + 0.5) / n;
            const px = along ? x0 + t * f.sx : f.x;
            const pz = along ? f.z : z0 + t * f.sz;
            const hh = 0.12 + rng() * 0.2;
            const col = color(rng(), 0.45 + rng() * 0.3, 0.35 + rng() * 0.3);
            for (const s of [-1, 1]) {
              const ox = along ? 0 : s * (f.sx / 2 - 0.12);
              const oz = along ? s * (f.sz / 2 - 0.12) : 0;
              add(goods, boxGeo(px + ox - 0.1, px + ox + 0.1, y + 0.03, y + 0.03 + hh, pz + oz - 0.09, pz + oz + 0.09, 1, col));
            }
          }
        }
        break;
      }
      case 'fridge':
        add(M.std('#d9dcdf', 0.4, 0.2), boxGeo(x0, x1, 0, f.h, z0, z1, 1));
        break;
      case 'counter':
      case 'kitchen':
        add(M.std('#e7e2d8', 0.6), boxGeo(x0, x1, 0, f.h - 0.05, z0, z1, 1));
        add(M.std('#3a3632', 0.4), boxGeo(x0 - 0.03, x1 + 0.03, f.h - 0.05, f.h, z0 - 0.03, z1 + 0.03, 1));
        break;
      case 'desk':
      case 'table':
        add(wood, boxGeo(x0, x1, f.h - 0.05, f.h, z0, z1, 1));
        for (const [lx, lz] of [[x0 + 0.05, z0 + 0.05], [x1 - 0.1, z0 + 0.05], [x0 + 0.05, z1 - 0.1], [x1 - 0.1, z1 - 0.1]]) add(M.std('#3a3a3a', 0.5, 0.5), boxGeo(lx, lx + 0.05, 0, f.h - 0.05, lz, lz + 0.05, 1));
        break;
      case 'locker':
        add(M.std('#6d7a72', 0.5, 0.5), boxGeo(x0, x1, 0, f.h, z0, z1, 1));
        break;
      case 'wardrobe':
        add(wood, boxGeo(x0, x1, 0, f.h, z0, z1, 1));
        break;
      case 'pew':
        add(wood, boxGeo(x0, x1, 0.4, 0.46, z0, z1, 1));
        add(wood, boxGeo(f.sx > f.sz ? x0 : x1 - 0.06, f.sx > f.sz ? x1 : x1, 0, 0.9, f.sx > f.sz ? z1 - 0.06 : z0, z1, 1));
        break;
      case 'altar':
        add(M.std('#cfc6b4', 0.8), boxGeo(x0, x1, 0, f.h, z0, z1, 1));
        add(M.std('#a78a3a', 0.3, 0.8), boxGeo(f.x - 0.04, f.x + 0.04, f.h, f.h + 0.6, f.z - 0.04, f.z + 0.04, 1));
        add(M.std('#a78a3a', 0.3, 0.8), boxGeo(f.x - 0.04, f.x + 0.04, f.h + 0.35, f.h + 0.43, f.z - 0.22, f.z + 0.22, 1));
        break;
      case 'mats':
        add(M.std('#2c4f8a', 0.9), boxGeo(x0, x1, 0, f.h, z0, z1, 1));
        break;
      case 'truck':
        add(M.std(ruined ? '#5a1612' : '#b3121a', 0.45, 0.3), boxGeo(x0, x1, 0.6, f.h, z0, z1 - 2, 1));
        add(M.std(ruined ? '#5a1612' : '#b3121a', 0.45, 0.3), boxGeo(x0, x1, 0.6, f.h * 0.85, z1 - 2, z1, 1));
        add(M.glass(), boxGeo(x0 + 0.05, x1 - 0.05, f.h * 0.5, f.h * 0.8, z1 - 0.05, z1 + 0.01, 1));
        for (const [wx, wz] of [[x0, z0 + 1.2], [x1, z0 + 1.2], [x0, z1 - 1.2], [x1, z1 - 1.2]]) {
          add(M.std('#151515', 0.9), bake(new THREE.CylinderGeometry(0.5, 0.5, 0.35, 14), trs(wx, 0.5, wz, 0, 0, Math.PI / 2)));
        }
        break;
      case 'bench':
        add(wood, boxGeo(x0, x1, 0.42, 0.47, z0, z1, 1));
        break;
      default:
        add(M.std('#777', 0.8), boxGeo(x0, x1, 0, f.h, z0, z1, 1));
    }
  }

  buildSolids(B) {
    const concrete = M.surface('concrete');
    for (const s of this.L.solids) {
      const mat = s.mat === 'stone' ? M.std('#a39784', 0.9) : concrete;
      B.add(mat, boxGeo(s.x0, s.x1, s.y0, s.y1, s.z0, s.z1, 3), (s.x0 + s.x1) / 2, (s.z0 + s.z1) / 2);
    }
    for (const r of this.L.ramps) {
      const len = r.z1 - r.z0;
      const rise = r.hAtZ1 - r.hAtZ0;
      const ang = Math.atan2(rise, len);
      const geo = new THREE.BoxGeometry(r.x1 - r.x0, 0.3, Math.hypot(len, rise));
      B.add(concrete, bake(geo, trs((r.x0 + r.x1) / 2, (r.hAtZ0 + r.hAtZ1) / 2 - 0.15, (r.z0 + r.z1) / 2, -ang, 0, 0)), (r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2);
    }
    // Parking bay lines on each deck.
    const paint = M.std('#e9e6dc', 0.7);
    const pk = this.L.parking;
    for (const y of [0.03, 4.02, 8.02]) {
      for (let x = pk.x0 + 9; x < pk.x1 - 8; x += 2.75) {
        B.add(paint, flatQuad(x - 0.06, -73, x + 0.06, -67, y, true, 1), x, -70, { shadow: false });
        B.add(paint, flatQuad(x - 0.06, -53, x + 0.06, -47, y, true, 1), x, -50, { shadow: false });
      }
    }
    B.add(M.textPlane('P', { w: 128, h: 128, bg: '#1d4ea0', fg: '#ffffff', font: 'bold 110px Arial' }), wallQuad(pk.x0 + 14, pk.z1 + 0.02, pk.x0 + 17, pk.z1 + 0.02, 5, 8, [0, 0, 1, 1]), pk.x0, pk.z1);
  }

  pickFireSpots(state) {
    if (!this.ruined) return;
    const rng = makeRng('fires');
    for (const b of this.L.buildings) {
      if (b.edge) continue;
      if (state.collapsed.has(b.id)) {
        if (rng() < 0.5) this.fires.push({ x: (b.x0 + b.x1) / 2 + rng() * 3, y: 1.5, z: (b.z0 + b.z1) / 2, size: 1.2 });
      } else if (b.damage >= 2 && rng() < 0.3) {
        // Fire inside an upper window, on the street side.
        const r = sideStrip(b, -0.3);
        if (r) this.fires.push({ x: (r.x0 + r.x1) / 2, y: GROUND_H + FLOOR_H * rng.int(0, Math.max(0, b.floors - 2)) + 1.4, z: (r.z0 + r.z1) / 2, size: 0.8 });
      }
    }
    for (const p of state.blast || []) this.smokes.push({ x: p.x, y: 2, z: p.z, size: 1.4 });
  }

  // Swap every facade to its damaged texture at the moment of the blast.
  shatterAll() {
    for (const m of this.facadeMeshes) {
      const f = m.material.userData.facade;
      if (!f) continue;
      const next = f.ground ? M.groundFloor(f.ground, 1) : M.facade(f.style, 1);
      next.userData.facade = f;
      m.material = next;
    }
  }

  // Distance culling: hide chunks well beyond the fog.
  cull(camPos, maxDist) {
    if (!this.chunkMeshes) return;
    for (const m of this.chunkMeshes) {
      const [cx, cz] = m.userData.chunk;
      const dx = (cx + 0.5) * 60 - camPos.x;
      const dz = (cz + 0.5) * 60 - camPos.z;
      m.visible = dx * dx + dz * dz < (maxDist + 45) ** 2;
    }
  }
}

function add2(B, mat, geo, c) { B.add(mat, geo, c.x, c.z); }

function rectOverlap(a, b) {
  return a.x0 < b.x1 && a.x1 > b.x0 && a.z0 < b.z1 && a.z1 > b.z0;
}

// Distance along the outside wall (left to right seen from the street) to the door centre.
function doorCenterAlong(b, side) {
  const d = b.door;
  const w = b.x1 - b.x0;
  const dep = b.z1 - b.z0;
  switch (side) {
    case 'n': return w / 2 - d.at; // runs from x1 to x0
    case 's': return w / 2 + d.at;
    case 'w': return dep / 2 + d.at;
    default: return dep / 2 - d.at; // runs from z1 to z0
  }
}

// Strip of ground (or wall, with negative width) along the street-facing side.
function sideStrip(b, w) {
  switch (b.side) {
    case 'n': return { x0: b.x0, x1: b.x1, z0: b.z0 - Math.max(0, w), z1: b.z0 - Math.min(0, w) };
    case 's': return { x0: b.x0, x1: b.x1, z0: b.z1 + Math.min(0, w), z1: b.z1 + Math.max(0, w) };
    case 'w': return { x0: b.x0 - Math.max(0, w), x1: b.x0 - Math.min(0, w), z0: b.z0, z1: b.z1 };
    case 'e': return { x0: b.x1 + Math.min(0, w), x1: b.x1 + Math.max(0, w), z0: b.z0, z1: b.z1 };
    default: return null;
  }
}

function rawGeo(pos, tint) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  const uv = [];
  for (let i = 0; i < pos.length; i += 3) uv.push((pos[i] + pos[i + 2]) / 3, pos[i + 1] / 3);
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  const col = [];
  for (let i = 0; i < pos.length / 3; i++) col.push(...tint);
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

// Heightfield heap of rubble over a rectangle.
export function moundGeo(x0, x1, z0, z1, maxH, seed) {
  const rng = makeRng(seed);
  const nx = Math.max(4, Math.min(16, Math.round((x1 - x0) / 1.5)));
  const nz = Math.max(4, Math.min(16, Math.round((z1 - z0) / 1.5)));
  const pos = [];
  const heights = [];
  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) {
      const u = i / nx;
      const v = j / nz;
      const bump = (Math.sin(Math.PI * u) * Math.sin(Math.PI * v)) ** 0.55;
      const edge = i === 0 || j === 0 || i === nx || j === nz;
      heights.push(edge ? 0 : maxH * bump * (0.65 + rng() * 0.5));
    }
  }
  const idx = (i, j) => j * (nx + 1) + i;
  const P = (i, j) => [x0 + ((x1 - x0) * i) / nx, heights[idx(i, j)], z0 + ((z1 - z0) * j) / nz];
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const a = P(i, j); const b = P(i + 1, j); const c = P(i + 1, j + 1); const d = P(i, j + 1);
      pos.push(...a, ...d, ...c, ...a, ...c, ...b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  const uv = [];
  for (let i = 0; i < pos.length; i += 3) uv.push(pos[i] / 3, -pos[i + 2] / 3);
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(pos.length).fill(1), 3));
  return g;
}

let clockMat = null;
function clockMaterial() {
  if (clockMat) return clockMat;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = '#efe8d6'; x.beginPath(); x.arc(64, 64, 60, 0, Math.PI * 2); x.fill();
  x.strokeStyle = '#2a2420'; x.lineWidth = 6; x.stroke();
  for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; x.fillStyle = '#2a2420'; x.fillRect(64 + Math.cos(a) * 48 - 3, 64 + Math.sin(a) * 48 - 3, 6, 6); }
  x.lineWidth = 5; x.beginPath(); x.moveTo(64, 64); x.lineTo(64 + 28 * Math.cos(-0.9), 64 + 28 * Math.sin(-0.9)); x.stroke();
  x.lineWidth = 3; x.beginPath(); x.moveTo(64, 64); x.lineTo(64, 18); x.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  clockMat = new THREE.MeshStandardMaterial({ map: t, roughness: 0.6 });
  return clockMat;
}

export { textTexture, STREET_NAMES };
