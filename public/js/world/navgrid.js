// Ground-level navigation grid (1 m cells) built from the collision world,
// with A* path finding for teammates and enemies.

import { EDGE } from './layout.js';

export class NavGrid {
  constructor(collision, { cell = 1, radius = 0.4, min = -EDGE, max = EDGE } = {}) {
    this.cw = collision;
    this.cell = cell;
    this.radius = radius;
    this.min = min;
    this.n = Math.ceil((max - min) / cell);
    const N = this.n * this.n;
    this.walk = new Uint8Array(N);
    this.g = new Float32Array(N);
    this.from = new Int32Array(N);
    this.seen = new Uint32Array(N);
    this.closed = new Uint32Array(N);
    this.gen = 0;
    this.heap = new Int32Array(N);
    this.f = new Float32Array(N);
    this.rebuild();
  }

  rebuild(x0 = this.min, z0 = this.min, x1 = -this.min, z1 = -this.min) {
    const [ix0, iz0] = this.toCell(x0, z0);
    const [ix1, iz1] = this.toCell(x1, z1);
    for (let iz = Math.max(0, iz0); iz <= Math.min(this.n - 1, iz1); iz++) {
      for (let ix = Math.max(0, ix0); ix <= Math.min(this.n - 1, ix1); ix++) {
        const x = this.min + (ix + 0.5) * this.cell;
        const z = this.min + (iz + 0.5) * this.cell;
        this.walk[iz * this.n + ix] = this.cw.blocked(x, z, 0, this.radius, 1.7) ? 0 : 1;
      }
    }
  }

  toCell(x, z) {
    return [Math.floor((x - this.min) / this.cell), Math.floor((z - this.min) / this.cell)];
  }

  center(i) {
    return { x: this.min + ((i % this.n) + 0.5) * this.cell, z: this.min + (Math.floor(i / this.n) + 0.5) * this.cell };
  }

  walkable(x, z) {
    const [ix, iz] = this.toCell(x, z);
    if (ix < 0 || iz < 0 || ix >= this.n || iz >= this.n) return false;
    return this.walk[iz * this.n + ix] === 1;
  }

  nearestWalkable(x, z, maxR = 12) {
    const [cx, cz] = this.toCell(x, z);
    for (let r = 0; r <= maxR; r++) {
      let best = -1;
      let bd = Infinity;
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const ix = cx + dx;
          const iz = cz + dz;
          if (ix < 0 || iz < 0 || ix >= this.n || iz >= this.n) continue;
          const i = iz * this.n + ix;
          if (!this.walk[i]) continue;
          const d = dx * dx + dz * dz;
          if (d < bd) { bd = d; best = i; }
        }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  // Returns an array of {x, z} waypoints (excluding the start) or null.
  findPath(sx, sz, tx, tz, maxNodes = 60000) {
    const n = this.n;
    const start = this.nearestWalkable(sx, sz, 3);
    const goal = this.nearestWalkable(tx, tz, 8);
    if (start < 0 || goal < 0) return null;
    if (start === goal) return [{ x: tx, z: tz }];
    const gen = ++this.gen;
    const { g, from, seen, closed, heap, f, walk } = this;
    const gx = goal % n;
    const gz = Math.floor(goal / n);
    const h = (i) => {
      const dx = Math.abs((i % n) - gx);
      const dz = Math.abs(Math.floor(i / n) - gz);
      return (dx + dz) + (Math.SQRT2 - 2) * Math.min(dx, dz);
    };
    let size = 0;
    const push = (i) => {
      let k = size++;
      heap[k] = i;
      while (k > 0) {
        const p = (k - 1) >> 1;
        if (f[heap[p]] <= f[heap[k]]) break;
        [heap[p], heap[k]] = [heap[k], heap[p]];
        k = p;
      }
    };
    const pop = () => {
      const top = heap[0];
      heap[0] = heap[--size];
      let k = 0;
      for (;;) {
        const l = 2 * k + 1;
        const r = l + 1;
        let m = k;
        if (l < size && f[heap[l]] < f[heap[m]]) m = l;
        if (r < size && f[heap[r]] < f[heap[m]]) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]];
        k = m;
      }
      return top;
    };
    seen[start] = gen;
    g[start] = 0;
    f[start] = h(start);
    from[start] = -1;
    push(start);
    let expanded = 0;
    let found = false;
    while (size > 0) {
      const cur = pop();
      if (closed[cur] === gen) continue;
      closed[cur] = gen;
      if (cur === goal) { found = true; break; }
      if (++expanded > maxNodes) break;
      const cx = cur % n;
      const cz = Math.floor(cur / n);
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dz) continue;
          const nx = cx + dx;
          const nz = cz + dz;
          if (nx < 0 || nz < 0 || nx >= n || nz >= n) continue;
          const ni = nz * n + nx;
          if (!walk[ni] || closed[ni] === gen) continue;
          if (dx && dz && (!walk[cz * n + nx] || !walk[nz * n + cx])) continue; // no corner cutting
          const ng = g[cur] + (dx && dz ? Math.SQRT2 : 1);
          if (seen[ni] !== gen || ng < g[ni]) {
            seen[ni] = gen;
            g[ni] = ng;
            f[ni] = ng + h(ni) * 1.05;
            from[ni] = cur;
            push(ni);
          }
        }
      }
    }
    if (!found) return null;
    const cells = [];
    for (let i = goal; i !== -1; i = from[i]) cells.push(i);
    cells.reverse();
    return this.smooth(cells, tx, tz);
  }

  // Grid line-of-sight between two cells (all cells on the line walkable).
  clearLine(a, b) {
    const n = this.n;
    let x0 = a % n;
    let z0 = Math.floor(a / n);
    const x1 = b % n;
    const z1 = Math.floor(b / n);
    const dx = Math.abs(x1 - x0);
    const dz = Math.abs(z1 - z0);
    const sx = x0 < x1 ? 1 : -1;
    const sz = z0 < z1 ? 1 : -1;
    let err = dx - dz;
    for (;;) {
      if (!this.walk[z0 * n + x0]) return false;
      if (x0 === x1 && z0 === z1) return true;
      const e2 = 2 * err;
      if (e2 > -dz) { err -= dz; x0 += sx; }
      if (e2 < dx) { err += dx; z0 += sz; }
      // Thicken the line a little so agents don't clip corners.
      if (!this.walk[z0 * n + x0]) return false;
    }
  }

  smooth(cells, tx, tz) {
    const out = [];
    let i = 0;
    while (i < cells.length - 1) {
      let j = cells.length - 1;
      while (j > i + 1 && !this.clearLine(cells[i], cells[j])) j--;
      out.push(this.center(cells[j]));
      i = j;
    }
    if (out.length) {
      const last = out[out.length - 1];
      if (this.walkable(tx, tz)) { last.x = tx; last.z = tz; }
    }
    return out;
  }

  // Number of walkable cells reachable from a point (flood fill), used by tests.
  reachable(x, z) {
    const start = this.nearestWalkable(x, z, 3);
    const mark = new Uint8Array(this.walk.length);
    const stack = [start];
    mark[start] = 1;
    while (stack.length) {
      const c = stack.pop();
      const cx = c % this.n;
      const cz = Math.floor(c / this.n);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx;
        const nz = cz + dz;
        if (nx < 0 || nz < 0 || nx >= this.n || nz >= this.n) continue;
        const ni = nz * this.n + nx;
        if (this.walk[ni] && !mark[ni]) { mark[ni] = 1; stack.push(ni); }
      }
    }
    return mark;
  }
}
