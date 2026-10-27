// Small shared helpers: seeded randomness, math, and an event emitter.
// Nothing in here touches the DOM or three.js, so the game logic built on it
// can run (and be tested) in Node.

export function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// mulberry32: tiny, fast, good enough for gameplay randomness.
export function makeRng(seed) {
  let a = (typeof seed === 'string' ? hashString(seed) : seed >>> 0) || 1;
  const rng = () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rng.range = (lo, hi) => lo + rng() * (hi - lo);
  rng.int = (lo, hi) => Math.floor(lo + rng() * (hi - lo + 1));
  rng.pick = (arr) => arr[Math.floor(rng() * arr.length)];
  rng.chance = (p) => rng() < p;
  rng.shuffle = (arr) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };
  return rng;
}

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
// Frame-rate independent exponential approach.
export const damp = (cur, target, rate, dt) => lerp(cur, target, 1 - Math.exp(-rate * dt));
export const dist2 = (ax, az, bx, bz) => Math.hypot(bx - ax, bz - az);

export function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function dampAngle(cur, target, rate, dt) {
  return cur + wrapAngle(target - cur) * (1 - Math.exp(-rate * dt));
}

// Yaw convention used everywhere: yaw 0 looks toward -Z (north), positive
// yaw turns left (counter-clockwise seen from above), same as three.js.
export function yawTo(fromX, fromZ, toX, toZ) {
  return Math.atan2(-(toX - fromX), -(toZ - fromZ));
}

// Compass bearing in degrees (0 = north, 90 = east).
export function bearingDeg(yaw) {
  let d = (-yaw * 180) / Math.PI;
  d %= 360;
  if (d < 0) d += 360;
  return d;
}

export function formatClock(minutes) {
  const m = ((Math.floor(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export class Emitter {
  constructor() { this._h = new Map(); }
  on(type, fn) {
    if (!this._h.has(type)) this._h.set(type, new Set());
    this._h.get(type).add(fn);
    return () => this._h.get(type)?.delete(fn);
  }
  emit(type, data) {
    const set = this._h.get(type);
    if (set) for (const fn of [...set]) fn(data);
    const any = this._h.get('*');
    if (any) for (const fn of [...any]) fn(type, data);
  }
}

export function deepClone(v) {
  return v === undefined ? v : JSON.parse(JSON.stringify(v));
}

let _uid = 0;
export const uid = (prefix = 'id') => `${prefix}${++_uid}`;
