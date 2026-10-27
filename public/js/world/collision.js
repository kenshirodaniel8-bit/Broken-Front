// Static collision for the district: axis-aligned boxes and vertical
// cylinders in a spatial hash, plus walkable ramps. Used by the player
// controller, AI line of sight, bullets and the navigation grid.

import { GROUND_H, EDGE, blockedRects, STREET_HALF } from './layout.js';

const CELL = 8;
export const STEP = 0.45;

export class CollisionWorld {
  constructor() {
    this.shapes = [];
    this.grid = new Map();
    this.ramps = [];
    this.stamp = 0;
    this.bound = EDGE - 1;
  }

  _keys(x0, z0, x1, z1) {
    const keys = [];
    const cx0 = Math.floor(x0 / CELL);
    const cx1 = Math.floor(x1 / CELL);
    const cz0 = Math.floor(z0 / CELL);
    const cz1 = Math.floor(z1 / CELL);
    for (let cx = cx0; cx <= cx1; cx++) for (let cz = cz0; cz <= cz1; cz++) keys.push(cx * 4096 + cz);
    return keys;
  }

  add(shape) {
    const s = { y0: 0, kind: 'box', _stamp: 0, ...shape };
    if (s.kind === 'circle') { s.x0 = s.x - s.r; s.x1 = s.x + s.r; s.z0 = s.z - s.r; s.z1 = s.z + s.r; }
    s._keys = this._keys(s.x0, s.z0, s.x1, s.z1);
    for (const k of s._keys) {
      if (!this.grid.has(k)) this.grid.set(k, []);
      this.grid.get(k).push(s);
    }
    this.shapes.push(s);
    return s;
  }

  removeTag(tag) {
    const keep = [];
    for (const s of this.shapes) {
      if (s.tag === tag) {
        for (const k of s._keys) {
          const arr = this.grid.get(k);
          const i = arr.indexOf(s);
          if (i >= 0) arr.splice(i, 1);
        }
      } else keep.push(s);
    }
    this.shapes = keep;
  }

  hasTag(tag) { return this.shapes.some((s) => s.tag === tag); }

  query(x0, z0, x1, z1, out = []) {
    const st = ++this.stamp;
    for (const k of this._keys(x0, z0, x1, z1)) {
      const arr = this.grid.get(k);
      if (!arr) continue;
      for (const s of arr) {
        if (s._stamp === st) continue;
        s._stamp = st;
        if (s.x1 >= x0 && s.x0 <= x1 && s.z1 >= z0 && s.z0 <= z1) out.push(s);
      }
    }
    return out;
  }

  // Highest walkable surface under (x, z) that can be reached from feetY.
  groundHeight(x, z, feetY, radius = 0.2) {
    let h = 0;
    for (const s of this.query(x - radius, z - radius, x + radius, z + radius)) {
      if (s.y1 > feetY + STEP || s.noFloor) continue;
      if (s.kind === 'circle') {
        if (Math.hypot(x - s.x, z - s.z) > s.r) continue;
      } else if (x < s.x0 - radius * 0.5 || x > s.x1 + radius * 0.5 || z < s.z0 - radius * 0.5 || z > s.z1 + radius * 0.5) continue;
      if (s.y1 > h) h = s.y1;
    }
    for (const r of this.ramps) {
      if (x < r.x0 || x > r.x1 || z < r.z0 || z > r.z1) continue;
      const t = r.axis === 'z' ? (z - r.z0) / (r.z1 - r.z0) : (x - r.x0) / (r.x1 - r.x0);
      const rh = r.hAtZ0 + (r.hAtZ1 - r.hAtZ0) * t;
      if (rh <= feetY + STEP && rh > h) h = rh;
    }
    return h;
  }

  // Moves a vertical capsule (circle in XZ between feetY and feetY+height)
  // and pushes it out of anything it overlaps. Mutates and returns pos.
  move(pos, dx, dz, radius, height) {
    const dist = Math.hypot(dx, dz);
    const steps = Math.max(1, Math.ceil(dist / (radius * 0.8)));
    let hit = false;
    for (let i = 0; i < steps; i++) {
      pos.x += dx / steps;
      pos.z += dz / steps;
      for (let iter = 0; iter < 3; iter++) {
        let pushed = false;
        const cands = this.query(pos.x - radius, pos.z - radius, pos.x + radius, pos.z + radius);
        for (const s of cands) {
          if (s.y1 <= pos.y + STEP || s.y0 >= pos.y + height) continue;
          if (s.kind === 'circle') {
            const ox = pos.x - s.x;
            const oz = pos.z - s.z;
            const d = Math.hypot(ox, oz);
            const min = radius + s.r;
            if (d < min) {
              const nx = d > 1e-6 ? ox / d : 1;
              const nz = d > 1e-6 ? oz / d : 0;
              pos.x = s.x + nx * min;
              pos.z = s.z + nz * min;
              pushed = hit = true;
            }
            continue;
          }
          const cx = Math.max(s.x0, Math.min(pos.x, s.x1));
          const cz = Math.max(s.z0, Math.min(pos.z, s.z1));
          const ox = pos.x - cx;
          const oz = pos.z - cz;
          const d2 = ox * ox + oz * oz;
          if (d2 >= radius * radius) continue;
          if (d2 > 1e-10) {
            const d = Math.sqrt(d2);
            pos.x = cx + (ox / d) * radius;
            pos.z = cz + (oz / d) * radius;
          } else {
            // Centre inside the box: leave by the shortest way.
            const pen = [pos.x - s.x0, s.x1 - pos.x, pos.z - s.z0, s.z1 - pos.z];
            const m = Math.min(...pen);
            if (m === pen[0]) pos.x = s.x0 - radius;
            else if (m === pen[1]) pos.x = s.x1 + radius;
            else if (m === pen[2]) pos.z = s.z0 - radius;
            else pos.z = s.z1 + radius;
          }
          pushed = hit = true;
        }
        if (!pushed) break;
      }
    }
    pos.x = Math.max(-this.bound, Math.min(this.bound, pos.x));
    pos.z = Math.max(-this.bound, Math.min(this.bound, pos.z));
    return hit;
  }

  // True if a capsule at (x, z) would overlap something.
  blocked(x, z, y, radius, height) {
    for (const s of this.query(x - radius, z - radius, x + radius, z + radius)) {
      if (s.y1 <= y + STEP || s.y0 >= y + height) continue;
      if (s.kind === 'circle') { if (Math.hypot(x - s.x, z - s.z) < radius + s.r) return true; continue; }
      const cx = Math.max(s.x0, Math.min(x, s.x1));
      const cz = Math.max(s.z0, Math.min(z, s.z1));
      if ((x - cx) ** 2 + (z - cz) ** 2 < radius * radius) return true;
    }
    return false;
  }

  // Ray against boxes (cylinders are ignored: trees and lamp posts should not
  // stop bullets or sight lines). Returns the distance to the first hit or
  // Infinity.
  raycast(ox, oy, oz, dx, dy, dz, maxDist, ignoreTag = null) {
    const len = Math.hypot(dx, dy, dz) || 1;
    dx /= len; dy /= len; dz /= len;
    const ex = ox + dx * maxDist;
    const ez = oz + dz * maxDist;
    // Walk the grid cells the ray crosses.
    let best = maxDist;
    let bestShape = null;
    const st = ++this.stamp;
    let cx = Math.floor(ox / CELL);
    let cz = Math.floor(oz / CELL);
    const tcx = Math.floor(ex / CELL);
    const tcz = Math.floor(ez / CELL);
    const stepX = dx > 0 ? 1 : -1;
    const stepZ = dz > 0 ? 1 : -1;
    const tDeltaX = dx !== 0 ? Math.abs(CELL / dx) : Infinity;
    const tDeltaZ = dz !== 0 ? Math.abs(CELL / dz) : Infinity;
    let tMaxX = dx !== 0 ? ((dx > 0 ? (cx + 1) * CELL : cx * CELL) - ox) / dx : Infinity;
    let tMaxZ = dz !== 0 ? ((dz > 0 ? (cz + 1) * CELL : cz * CELL) - oz) / dz : Infinity;
    for (let guard = 0; guard < 400; guard++) {
      const arr = this.grid.get(cx * 4096 + cz);
      if (arr) {
        for (const s of arr) {
          if (s._stamp === st || s.kind === 'circle' || s.noRay || (ignoreTag && s.tag === ignoreTag)) continue;
          s._stamp = st;
          const t = rayBox(ox, oy, oz, dx, dy, dz, s);
          if (t >= 0 && t < best) { best = t; bestShape = s; }
        }
      }
      const tNext = Math.min(tMaxX, tMaxZ);
      if (tNext > best || (cx === tcx && cz === tcz)) break;
      if (tMaxX < tMaxZ) { cx += stepX; tMaxX += tDeltaX; } else { cz += stepZ; tMaxZ += tDeltaZ; }
    }
    this.lastHit = bestShape;
    return bestShape ? best : Infinity;
  }

  lineOfSight(ax, ay, az, bx, by, bz) {
    const d = Math.hypot(bx - ax, by - ay, bz - az);
    return this.raycast(ax, ay, az, bx - ax, by - ay, bz - az, d) >= d - 0.05;
  }
}

function rayBox(ox, oy, oz, dx, dy, dz, b) {
  let tmin = 0;
  let tmax = Infinity;
  const axes = [[ox, dx, b.x0, b.x1], [oy, dy, b.y0, b.y1], [oz, dz, b.z0, b.z1]];
  for (const [o, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return -1;
    } else {
      let t1 = (lo - o) / d;
      let t2 = (hi - o) / d;
      if (t1 > t2) [t1, t2] = [t2, t1];
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return -1;
    }
  }
  return tmin;
}

// --- Building the collision world from the layout ---------------------------

// Wall boxes of an enterable building's ground floor, with the door gap.
export function buildingWalls(b, interior) {
  const t = 0.35;
  const walls = [];
  const top = interior ? interior.height + 0.01 : GROUND_H;
  const door = b.door;
  const W = (x0, x1, z0, z1) => walls.push({ x0, x1, z0, z1, y0: 0, y1: top });
  const sideBox = {
    n: [b.x0, b.x1, b.z0, b.z0 + t], s: [b.x0, b.x1, b.z1 - t, b.z1], w: [b.x0, b.x0 + t, b.z0, b.z1], e: [b.x1 - t, b.x1, b.z0, b.z1],
  };
  for (const side of ['n', 's', 'w', 'e']) {
    const [x0, x1, z0, z1] = sideBox[side];
    if (door && door.side === side) {
      const half = door.width / 2;
      if (side === 'n' || side === 's') {
        const c = (b.x0 + b.x1) / 2 + door.at;
        W(x0, c - half, z0, z1);
        W(c + half, x1, z0, z1);
        walls.push({ x0: c - half, x1: c + half, z0, z1, y0: 2.5, y1: top, noFloor: true });
      } else {
        const c = (b.z0 + b.z1) / 2 + door.at;
        W(x0, x1, z0, c - half);
        W(x0, x1, c + half, z1);
        walls.push({ x0, x1, z0: c - half, z1: c + half, y0: 2.5, y1: top, noFloor: true });
      }
    } else W(x0, x1, z0, z1);
  }
  return walls;
}

export function doorPoint(b, outside = 1.2) {
  const d = b.door;
  if (!d) return null;
  const cx = (b.x0 + b.x1) / 2;
  const cz = (b.z0 + b.z1) / 2;
  switch (d.side) {
    case 'n': return { x: cx + d.at, z: b.z0 - outside, inX: cx + d.at, inZ: b.z0 + outside };
    case 's': return { x: cx + d.at, z: b.z1 + outside, inX: cx + d.at, inZ: b.z1 - outside };
    case 'w': return { x: b.x0 - outside, z: cz + d.at, inX: b.x0 + outside, inZ: cz + d.at };
    default: return { x: b.x1 + outside, z: cz + d.at, inX: b.x1 - outside, inZ: cz + d.at };
  }
}

// Footprint of the rubble left by a collapsed building: the base plus a
// spill into the street on its street-facing side.
export function rubbleShapes(b) {
  const out = [{ x0: b.x0 - 0.5, x1: b.x1 + 0.5, z0: b.z0 - 0.5, z1: b.z1 + 0.5, y0: 0, y1: 4.5, rubble: true }];
  const spill = 3.2;
  const side = b.side || 'n';
  if (side === 'n') out.push({ x0: b.x0 + 1, x1: b.x1 - 1, z0: b.z0 - spill, z1: b.z0, y0: 0, y1: 1.3, rubble: true });
  if (side === 's') out.push({ x0: b.x0 + 1, x1: b.x1 - 1, z0: b.z1, z1: b.z1 + spill, y0: 0, y1: 1.3, rubble: true });
  if (side === 'w') out.push({ x0: b.x0 - spill, x1: b.x0, z0: b.z0 + 1, z1: b.z1 - 1, y0: 0, y1: 1.3, rubble: true });
  if (side === 'e') out.push({ x0: b.x1, x1: b.x1 + spill, z0: b.z0 + 1, z1: b.z1 - 1, y0: 0, y1: 1.3, rubble: true });
  return out;
}

// state: { ruined, collapsed: Set of building ids, clearedDebris: Set }
export function buildCollision(L, state = {}) {
  const cw = new CollisionWorld();
  const ruined = !!state.ruined;
  const collapsed = state.collapsed || new Set();
  const cleared = state.clearedDebris || new Set();
  const interiors = new Map(L.interiors.map((i) => [i.building, i]));

  for (const b of L.buildings) {
    if (ruined && collapsed.has(b.id)) {
      for (const r of rubbleShapes(b)) cw.add({ ...r, tag: `rubble:${b.id}`, building: b.id });
      continue;
    }
    const it = interiors.get(b.id);
    if (b.enterable && it) {
      for (const w of buildingWalls(b, it)) cw.add({ ...w, building: b.id });
      cw.add({ x0: b.x0, x1: b.x1, z0: b.z0, z1: b.z1, y0: it.height, y1: b.h, building: b.id, noFloor: true });
      for (const f of it.furniture) {
        cw.add({ x0: f.x - f.sx / 2, x1: f.x + f.sx / 2, z0: f.z - f.sz / 2, z1: f.z + f.sz / 2, y0: 0, y1: f.h, furniture: true });
      }
    } else if (b.passage) {
      // Archway through to the courtyard.
      const pw = b.passage.width / 2;
      if (b.side === 'n' || b.side === 's') {
        const c = (b.x0 + b.x1) / 2;
        cw.add({ x0: b.x0, x1: c - pw, z0: b.z0, z1: b.z1, y1: b.h, building: b.id });
        cw.add({ x0: c + pw, x1: b.x1, z0: b.z0, z1: b.z1, y1: b.h, building: b.id });
        cw.add({ x0: c - pw, x1: c + pw, z0: b.z0, z1: b.z1, y0: b.passage.height, y1: b.h, building: b.id, noFloor: true });
      } else {
        const c = (b.z0 + b.z1) / 2;
        cw.add({ x0: b.x0, x1: b.x1, z0: b.z0, z1: c - pw, y1: b.h, building: b.id });
        cw.add({ x0: b.x0, x1: b.x1, z0: c + pw, z1: b.z1, y1: b.h, building: b.id });
        cw.add({ x0: b.x0, x1: b.x1, z0: c - pw, z1: c + pw, y0: b.passage.height, y1: b.h, building: b.id, noFloor: true });
      }
    } else {
      cw.add({ x0: b.x0, x1: b.x1, z0: b.z0, z1: b.z1, y1: b.h, building: b.id });
    }
  }
  const office = L.interiors.find((i) => i.id === 'parking_office');
  for (const f of office.furniture) cw.add({ x0: f.x - f.sx / 2, x1: f.x + f.sx / 2, z0: f.z - f.sz / 2, z1: f.z + f.sz / 2, y1: f.h, furniture: true });
  for (const s of L.solids) cw.add({ ...s });
  for (const r of L.ramps) cw.ramps.push(r);

  // Street furniture.
  for (const c of L.props.cars) {
    const along = Math.abs(Math.sin(c.yaw)) > 0.5; // car body along X
    const hl = c.type === 'van' ? 2.6 : 2.25;
    const hw = 0.95;
    const y = c.y || 0;
    cw.add({
      x0: c.x - (along ? hl : hw), x1: c.x + (along ? hl : hw), z0: c.z - (along ? hw : hl), z1: c.z + (along ? hw : hl),
      y0: y, y1: y + (c.type === 'van' ? 2.1 : 1.45), car: true, tag: 'car',
    });
  }
  if (L.bus) {
    const b = L.bus;
    cw.add({ x0: b.x - 6, x1: b.x + 6, z0: b.z - 1.3, z1: b.z + 1.3, y1: 3.1, tag: ruined ? 'buswreck' : 'bus' });
  }
  if (L.squadVan) {
    const v = L.squadVan;
    cw.add({ x0: v.x - 1.05, x1: v.x + 1.05, z0: v.z - 2.7, z1: v.z + 2.7, y1: 2.2, tag: 'squadvan' });
  }
  for (const t of L.props.trees) cw.add({ kind: 'circle', x: t.x, z: t.z, r: 0.3 * t.s, y1: 6 });
  for (const l of L.props.lamps) cw.add({ kind: 'circle', x: l.x, z: l.z, r: 0.14, y1: 6 });
  for (const f of L.props.fountains) cw.add({ kind: 'circle', x: f.x, z: f.z, r: f.r, y1: 0.8, noFloor: false });
  for (const s of L.props.busStops) cw.add({ x0: s.x - 2, x1: s.x + 2, z0: s.z - 0.4, z1: s.z + 0.4, y1: 2.5, noFloor: true });
  if (!ruined) for (const s of L.props.stalls) cw.add({ x0: s.x - 1.3, x1: s.x + 1.3, z0: s.z - 1, z1: s.z + 1, y1: 2.4, noFloor: true, tag: 'stall' });

  if (ruined) {
    for (const r of blockedRects()) cw.add({ ...r, y0: 0, y1: 3.5, rubble: true, tag: 'blocked' });
    for (const d of L.debrisSites) {
      if (!cleared.has(d.id)) cw.add({ x0: d.x - d.w / 2, x1: d.x + d.w / 2, z0: d.z - d.d / 2, z1: d.z + d.d / 2, y1: 2.4, tag: `debris:${d.id}`, rubble: true });
    }
  }
  return cw;
}

export function insideInterior(L, x, z, y = 0) {
  for (const it of L.interiors) {
    if (x > it.x0 && x < it.x1 && z > it.z0 && z < it.z1 && y < (it.height || 3.8)) return it;
  }
  return null;
}

export function onStreet(x, z) {
  return [-150, -90, -30, 30, 90, 150].some((l) => Math.abs(x - l) < STREET_HALF || Math.abs(z - l) < STREET_HALF);
}
