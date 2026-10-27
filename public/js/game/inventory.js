// Weight-limited inventory with stacks, quick-use pouch slots and weapon
// magazine state. Pure data; the UI and the game read and mutate it.

import { ITEMS, WEAPONS, AMMO_ITEM } from '../data/items.js';

export const OVERLOAD_MARGIN = 8; // kg above capacity you can still carry (slowly)

export class Inventory {
  constructor(capacity = 20) {
    this.capacity = capacity;
    this.stacks = []; // { id, n, data }
    this.quick = []; // item ids in pouch slots
    this.primary = null; // weapon key, e.g. 'ar'
    this.sidearm = null;
    this.active = 'primary';
    this.mags = {}; // weapon key -> rounds loaded
  }

  count(id) {
    let n = 0;
    for (const s of this.stacks) if (s.id === id) n += s.n;
    return n;
  }

  has(id, n = 1) { return this.count(id) >= n; }

  weight() {
    let w = 0;
    for (const s of this.stacks) w += (ITEMS[s.id]?.weight || 0) * s.n;
    return Math.round(w * 100) / 100;
  }

  load() { return this.weight() / this.capacity; }

  // How many of `id` fit before the hard limit.
  roomFor(id) {
    const w = ITEMS[id].weight;
    if (w <= 0) return Infinity;
    return Math.max(0, Math.floor((this.capacity + OVERLOAD_MARGIN - this.weight()) / w + 1e-9));
  }

  // Adds up to n items; returns how many were added.
  add(id, n = 1, data = null) {
    const def = ITEMS[id];
    if (!def) throw new Error(`Unknown item ${id}`);
    const fit = Math.min(n, this.roomFor(id));
    let left = fit;
    if (data == null) {
      for (const s of this.stacks) {
        if (left <= 0) break;
        if (s.id !== id || s.data != null || s.n >= def.stack) continue;
        const put = Math.min(left, def.stack - s.n);
        s.n += put;
        left -= put;
      }
    }
    while (left > 0) {
      const put = data != null ? 1 : Math.min(left, def.stack);
      this.stacks.push({ id, n: put, data: data != null ? { ...data } : (def.charge != null ? { charge: def.charge } : null) });
      left -= put;
    }
    if (def.weapon) this.autoEquip(def.weapon);
    return fit;
  }

  remove(id, n = 1) {
    let left = n;
    for (let i = this.stacks.length - 1; i >= 0 && left > 0; i--) {
      const s = this.stacks[i];
      if (s.id !== id) continue;
      const take = Math.min(left, s.n);
      s.n -= take;
      left -= take;
      if (s.n <= 0) this.stacks.splice(i, 1);
    }
    const def = ITEMS[id];
    if (def?.weapon && !this.has(id)) {
      if (this.primary === def.weapon) this.primary = null;
      if (this.sidearm === def.weapon) this.sidearm = null;
    }
    if (!this.has(id)) this.quick = this.quick.map((q) => (q === id ? null : q));
    return n - left;
  }

  // First stack of an item that carries data (power bank charge etc.).
  stackOf(id) { return this.stacks.find((s) => s.id === id) || null; }

  autoEquip(weaponKey) {
    const w = WEAPONS[weaponKey];
    if (w.slot === 'primary' && !this.primary) this.primary = weaponKey;
    if (w.slot === 'sidearm' && !this.sidearm) this.sidearm = weaponKey;
    if (this.mags[weaponKey] == null) this.mags[weaponKey] = 0;
  }

  equip(weaponKey) {
    const w = WEAPONS[weaponKey];
    if (!w || !this.has(w.item)) return false;
    this[w.slot] = weaponKey;
    if (this.mags[weaponKey] == null) this.mags[weaponKey] = 0;
    return true;
  }

  activeWeapon() {
    return this.active === 'sidearm' ? this.sidearm : this.primary || this.sidearm;
  }

  reserve(weaponKey) { return this.count(AMMO_ITEM[WEAPONS[weaponKey].ammo]); }

  // Loads the magazine from reserve ammo. Returns rounds loaded.
  reload(weaponKey) {
    const w = WEAPONS[weaponKey];
    const need = w.mag - (this.mags[weaponKey] || 0);
    const got = this.remove(AMMO_ITEM[w.ammo], Math.min(need, this.reserve(weaponKey)));
    this.mags[weaponKey] = (this.mags[weaponKey] || 0) + got;
    return got;
  }

  setQuickSlots(n) {
    while (this.quick.length < n) this.quick.push(null);
    this.quick.length = n;
  }

  assignQuick(slot, id) {
    if (slot < 0 || slot >= this.quick.length) return false;
    this.quick = this.quick.map((q) => (q === id ? null : q));
    this.quick[slot] = id;
    return true;
  }

  grouped() {
    const by = {};
    for (const s of this.stacks) {
      const cat = ITEMS[s.id].cat;
      (by[cat] ||= []).push(s);
    }
    return by;
  }

  toJSON() {
    return { capacity: this.capacity, stacks: this.stacks, quick: this.quick, primary: this.primary, sidearm: this.sidearm, active: this.active, mags: this.mags };
  }

  static fromJSON(o) {
    const inv = new Inventory(o.capacity);
    inv.stacks = (o.stacks || []).filter((s) => ITEMS[s.id]).map((s) => ({ id: s.id, n: s.n, data: s.data || null }));
    inv.quick = o.quick || [];
    inv.primary = o.primary || null;
    inv.sidearm = o.sidearm || null;
    inv.active = o.active || 'primary';
    inv.mags = o.mags || {};
    return inv;
  }
}

// A store of items without a weight limit (shelter stash, containers).
export class Stash {
  constructor(stacks = []) { this.stacks = stacks; }
  count(id) { return this.stacks.filter((s) => s.id === id).reduce((a, s) => a + s.n, 0); }
  add(id, n = 1, data = null) {
    const s = data == null ? this.stacks.find((k) => k.id === id && k.data == null) : null;
    if (s) s.n += n; else this.stacks.push({ id, n, data });
    return n;
  }
  remove(id, n = 1) {
    let left = n;
    for (let i = this.stacks.length - 1; i >= 0 && left > 0; i--) {
      const s = this.stacks[i];
      if (s.id !== id) continue;
      const take = Math.min(left, s.n);
      s.n -= take;
      left -= take;
      if (s.n <= 0) this.stacks.splice(i, 1);
    }
    return n - left;
  }
  ofCategory(cat) { return this.stacks.filter((s) => ITEMS[s.id].cat === cat); }
  toJSON() { return this.stacks; }
}
