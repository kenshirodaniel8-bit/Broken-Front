// What the player knows about the map: explored cells (fog of war), markers
// and recent enemy sightings.

const CELL = 4;
const MIN = -180;
const N = Math.ceil(360 / CELL);

export class MapState {
  constructor() {
    this.seen = new Uint8Array(N * N);
    this.markers = [];
    this.sightings = [];
    this.fullMap = false;
    this.waypoint = null;
  }

  reveal(x, z, r) {
    const c0 = Math.max(0, Math.floor((x - r - MIN) / CELL));
    const c1 = Math.min(N - 1, Math.floor((x + r - MIN) / CELL));
    const r0 = Math.max(0, Math.floor((z - r - MIN) / CELL));
    const r1 = Math.min(N - 1, Math.floor((z + r - MIN) / CELL));
    for (let j = r0; j <= r1; j++) {
      for (let i = c0; i <= c1; i++) {
        const cx = MIN + (i + 0.5) * CELL;
        const cz = MIN + (j + 0.5) * CELL;
        if ((cx - x) ** 2 + (cz - z) ** 2 <= r * r) this.seen[j * N + i] = 1;
      }
    }
  }

  isSeen(x, z) {
    if (this.fullMap) return true;
    const i = Math.floor((x - MIN) / CELL);
    const j = Math.floor((z - MIN) / CELL);
    if (i < 0 || j < 0 || i >= N || j >= N) return false;
    return this.seen[j * N + i] === 1;
  }

  addMarker(m) {
    if (m.id) this.markers = this.markers.filter((k) => k.id !== m.id);
    this.markers.push(m);
  }

  removeMarker(id) { this.markers = this.markers.filter((k) => k.id !== id); }

  sighting(x, z) {
    this.sightings = this.sightings.filter((s) => Math.hypot(s.x - x, s.z - z) > 6);
    this.sightings.push({ x, z, t: performance.now() });
  }

  recentSightings(maxAgeMs = 60000) {
    const now = performance.now();
    this.sightings = this.sightings.filter((s) => now - s.t < maxAgeMs);
    return this.sightings;
  }

  serialize() {
    let bin = '';
    for (let i = 0; i < this.seen.length; i++) bin += String.fromCharCode(this.seen[i] ? 49 : 48);
    // Run-length encode the 0/1 string.
    const rle = bin.replace(/(.)\1*/g, (m, c) => `${c}${m.length},`);
    return { rle, markers: this.markers, fullMap: this.fullMap, waypoint: this.waypoint };
  }

  restore(s) {
    if (!s) return;
    this.seen.fill(0);
    let k = 0;
    for (const part of (s.rle || '').split(',')) {
      if (!part) continue;
      const v = part[0] === '1' ? 1 : 0;
      const n = parseInt(part.slice(1), 10);
      for (let i = 0; i < n && k < this.seen.length; i++) this.seen[k++] = v;
    }
    this.markers = s.markers || [];
    this.fullMap = !!s.fullMap;
    this.waypoint = s.waypoint || null;
  }
}

export const MAP_CELL = CELL;
export const MAP_MIN = MIN;
export const MAP_N = N;
