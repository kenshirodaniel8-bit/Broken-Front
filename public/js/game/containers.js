// What is inside every searchable place. Contents are rolled when first
// opened and kept in the save, so searched places stay searched.

import { generateContents } from './loot.js';
import { ITEMS } from '../data/items.js';

export class Containers {
  constructor(game) {
    this.game = game;
    this.state = {};
    this.dynamic = [];
  }

  all() { return this.game.L.containers.concat(this.dynamic); }

  find(id) { return this.all().find((c) => c.id === id); }

  contents(c) {
    let s = this.state[c.id];
    if (!s) {
      const items = c.items ? c.items.map((i) => ({ ...i })) : generateContents(c, this.game.L.seed, this.game.campaign.day);
      s = this.state[c.id] = { items, opened: true };
    }
    return s.items;
  }

  isEmpty(c) {
    const s = this.state[c.id];
    return !!s && s.items.length === 0;
  }

  // Moves up to n of an item into the player's inventory. Returns moved count.
  take(c, index, n = Infinity) {
    const g = this.game;
    const items = this.contents(c);
    const it = items[index];
    if (!it) return 0;
    const moved = g.inv.add(it.id, Math.min(n, it.n), it.data || null);
    it.n -= moved;
    if (it.n <= 0) items.splice(index, 1);
    if (moved) g.onItemGained(it.id, moved);
    return moved;
  }

  takeAll(c) {
    let any = 0;
    const items = this.contents(c);
    for (let i = items.length - 1; i >= 0; i--) any += this.take(c, i);
    return any;
  }

  // Puts an item from the inventory into a container (e.g. the shelter stash).
  put(c, id, n = 1) {
    const g = this.game;
    const st = g.inv.stackOf(id);
    const data = ITEMS[id].charge != null ? st?.data : null;
    const moved = g.inv.remove(id, n);
    if (!moved) return 0;
    const items = this.contents(c);
    const e = data ? null : items.find((k) => k.id === id && !k.data);
    if (e) e.n += moved; else items.push({ id, n: moved, data });
    return moved;
  }

  addLoose(id, x, z, name, items, kind = 'bag') {
    if (this.find(id)) return;
    const c = { id, x, z, y: 0, kind, name, table: 'car', items };
    this.dynamic.push(c);
    this.state[id] = { items: items.map((i) => ({ ...i })), opened: false };
    return c;
  }

  registerBody(e) {
    const c = { id: `body:${e.id}`, x: e.pos.x, z: e.pos.z, y: 0, kind: 'body', name: e.officer ? "officer's body" : "soldier's body", table: e.officer ? 'enemy' : 'enemy', fixed: e.officer ? [['intel_orders', 1]] : null };
    this.dynamic.push(c);
  }

  interactables() {
    const g = this.game;
    const P = g.player.pos;
    const out = [];
    for (const c of this.all()) {
      if (Math.abs(c.x - P.x) > 6 || Math.abs(c.z - P.z) > 6 || Math.abs((c.y || 0) - P.y) > 2.5) continue;
      if (c.ruinedOnly && !g.ruined) continue;
      const s = this.state[c.id];
      const empty = s && s.items.length === 0;
      const name = c.name || c.kind;
      out.push({
        id: `c:${c.id}`, x: c.x, y: (c.y || 0) + 0.8, z: c.z, r: 1.9,
        label: s?.opened ? (empty ? `${cap(name)} (empty)` : `Open ${name}`) : `Search ${name}`,
        hold: s?.opened ? 0 : c.kind === 'body' ? 1.6 : 1.1, noise: 3, dim: empty,
        action: () => { this.contents(c); this.state[c.id].opened = true; g.ui.openLoot(c); },
      });
    }
    return out;
  }

  serialize() {
    return { state: this.state, dynamic: this.dynamic };
  }

  restore(s) {
    this.state = s?.state || {};
    this.dynamic = s?.dynamic || [];
  }
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
