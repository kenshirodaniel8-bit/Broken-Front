// Low-level geometry helpers: world-space quads and boxes with UVs and
// vertex colours, collected into buckets and merged per material and chunk.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const WHITE = [1, 1, 1];

function makeGeo(pos, nrm, uv, col) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

// Vertical wall quad from a to b (left to right seen from outside).
// uv: [u0, v0, u1, v1].
export function wallQuad(ax, az, bx, bz, y0, y1, uv = [0, 0, 1, 1], color = WHITE) {
  const dx = bx - ax;
  const dz = bz - az;
  const len = Math.hypot(dx, dz) || 1;
  // Outward normal for our winding: cross(b - a, up) = (-dz, 0, dx).
  const n = [-dz / len, 0, dx / len];
  const pos = [ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y0, az, bx, y1, bz, ax, y1, az];
  const [u0, v0, u1, v1] = uv;
  const uvs = [u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1];
  const nrm = [];
  const col = [];
  for (let i = 0; i < 6; i++) { nrm.push(...n); col.push(...color); }
  return makeGeo(pos, nrm, uvs, col);
}

// Horizontal quad (floor facing up, or ceiling facing down).
export function flatQuad(x0, z0, x1, z1, y, up = true, uvScale = 1, color = WHITE, uvOffset = [0, 0]) {
  const pos = up
    ? [x0, y, z1, x1, y, z1, x1, y, z0, x0, y, z1, x1, y, z0, x0, y, z0]
    : [x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z0, x1, y, z1, x0, y, z1];
  const uv = [];
  for (let i = 0; i < pos.length; i += 3) uv.push(pos[i] / uvScale + uvOffset[0], -pos[i + 2] / uvScale + uvOffset[1]);
  const nrm = [];
  const col = [];
  for (let i = 0; i < 6; i++) { nrm.push(0, up ? 1 : -1, 0); col.push(...color); }
  return makeGeo(pos, nrm, uv, col);
}

// Axis-aligned box with world-scaled UVs on every face.
export function boxGeo(x0, x1, y0, y1, z0, z1, uvScale = 1, color = WHITE, faces = 'all') {
  const parts = [];
  const u = (a) => a / uvScale;
  const want = (f) => faces === 'all' || faces.includes(f);
  if (want('n')) parts.push(wallQuad(x1, z0, x0, z0, y0, y1, [0, u(y0), u(x1 - x0), u(y1)], color));
  if (want('s')) parts.push(wallQuad(x0, z1, x1, z1, y0, y1, [0, u(y0), u(x1 - x0), u(y1)], color));
  if (want('w')) parts.push(wallQuad(x0, z0, x0, z1, y0, y1, [0, u(y0), u(z1 - z0), u(y1)], color));
  if (want('e')) parts.push(wallQuad(x1, z1, x1, z0, y0, y1, [0, u(y0), u(z1 - z0), u(y1)], color));
  if (want('t')) parts.push(flatQuad(x0, z0, x1, z1, y1, true, uvScale, color));
  if (want('b')) parts.push(flatQuad(x0, z0, x1, z1, y0, false, uvScale, color));
  return parts.length === 1 ? parts[0] : mergeGeometries(parts);
}

// Bakes any three.js geometry into world space with the given transform and
// a flat vertex colour so it can join a merged bucket.
export function bake(geo, matrix, color = WHITE) {
  let g = geo.index ? geo.toNonIndexed() : geo.clone();
  g.applyMatrix4(matrix);
  for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  const col = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < col.length; i += 3) { col[i] = color[0]; col[i + 1] = color[1]; col[i + 2] = color[2]; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
export function trs(x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  _e.set(rx, ry, rz);
  _q.setFromEuler(_e);
  return _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz)).clone();
}

export function colorArray(hex) {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
}

// Collects geometry per (chunk, material) and merges it into meshes.
export class Buckets {
  constructor(chunk = 60) {
    this.chunk = chunk;
    this.map = new Map();
  }

  add(material, geo, x = 0, z = 0, opts = {}) {
    if (!geo) return;
    const cx = Math.floor(x / this.chunk);
    const cz = Math.floor(z / this.chunk);
    const key = `${cx},${cz}|${material.uuid}|${opts.shadow === false ? 0 : 1}`;
    let b = this.map.get(key);
    if (!b) { b = { material, geos: [], shadow: opts.shadow !== false, cx, cz }; this.map.set(key, b); }
    b.geos.push(geo);
  }

  build(parent) {
    const meshes = [];
    for (const b of this.map.values()) {
      const merged = mergeGeometries(b.geos, false);
      for (const g of b.geos) g.dispose();
      if (!merged) continue;
      merged.computeBoundingSphere();
      const m = new THREE.Mesh(merged, b.material);
      m.castShadow = b.shadow;
      m.receiveShadow = true;
      m.matrixAutoUpdate = false;
      m.updateMatrix();
      m.userData.chunk = [b.cx, b.cz];
      parent.add(m);
      meshes.push(m);
    }
    this.map.clear();
    return meshes;
  }
}
