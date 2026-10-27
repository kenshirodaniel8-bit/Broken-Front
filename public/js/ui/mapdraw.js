// Draws the district map: a pre-rendered base layer, fog of war over unseen
// areas, and live markers. Used by the minimap, the map screen and the phone.

import { blockedRects, LINES, STREET_NAMES } from '../world/layout.js';
import { MAP_CELL, MAP_MIN, MAP_N } from '../game/mapstate.js';

const PX = 2; // pixels per metre in the base layer
const SIZE = 360 * PX;

export class MapRenderer {
  constructor(game) {
    this.game = game;
    this.base = document.createElement('canvas');
    this.base.width = this.base.height = SIZE;
    this.fog = document.createElement('canvas');
    this.fog.width = this.fog.height = SIZE;
    this.baseKey = '';
    this.fogTimer = 0;
  }

  toPx(x, z) { return [(x - MAP_MIN) * PX, (z - MAP_MIN) * PX]; }

  // Re-render the static layer when the world changes (strike, aftershock).
  ensureBase() {
    const g = this.game;
    const key = `${g.world.ruined}:${g.world.blast.length}:${g.world.extraCollapsed.length}:${g.world.clearedDebris.length}`;
    if (key === this.baseKey) return;
    this.baseKey = key;
    const ctx = this.base.getContext('2d');
    const L = g.L;
    ctx.fillStyle = '#1b1e1f';
    ctx.fillRect(0, 0, SIZE, SIZE);
    // Streets.
    ctx.fillStyle = '#3a3f40';
    for (const l of LINES) {
      const [a] = this.toPx(l - 7.5, 0);
      ctx.fillRect(a, this.toPx(0, -157.5)[1], 15 * PX, 315 * PX);
      const [, b] = this.toPx(0, l - 7.5);
      ctx.fillRect(this.toPx(-157.5, 0)[0], b, 315 * PX, 15 * PX);
    }
    // Blocks.
    for (const bl of L.blocks) {
      const [x, z] = this.toPx(bl.x0, bl.z0);
      ctx.fillStyle = bl.kind === 'park' ? '#2b3b25' : bl.kind === 'plaza' ? '#4a4640' : '#2c2f30';
      ctx.fillRect(x, z, (bl.x1 - bl.x0) * PX, (bl.z1 - bl.z0) * PX);
    }
    const collapsed = new Set([...(g.world.ruined ? L.buildings.filter((b) => b.collapse).map((b) => b.id) : []), ...g.world.blast.map((t) => t.building), ...g.world.extraCollapsed]);
    for (const b of L.buildings) {
      const [x, z] = this.toPx(b.x0, b.z0);
      const w = (b.x1 - b.x0) * PX;
      const h = (b.z1 - b.z0) * PX;
      if (collapsed.has(b.id)) {
        ctx.fillStyle = '#4d3f36';
        ctx.fillRect(x, z, w, h);
        // Hatched: rubble.
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, z, w, h);
        ctx.clip();
        ctx.strokeStyle = '#7a6656';
        ctx.lineWidth = 1;
        for (let i = -h; i < w; i += 6) { ctx.beginPath(); ctx.moveTo(x + i, z); ctx.lineTo(x + i + h, z + h); ctx.stroke(); }
        ctx.restore();
      } else {
        ctx.fillStyle = b.enterable ? '#6d6a5e' : b.edge ? '#26292a' : '#555a5c';
        ctx.fillRect(x, z, w, h);
        ctx.strokeStyle = '#1b1e1f';
        ctx.strokeRect(x + 0.5, z + 0.5, w - 1, h - 1);
      }
    }
    // Parking structure and LZ.
    const pk = L.parking;
    const [px, pz] = this.toPx(pk.x0, pk.z0);
    ctx.fillStyle = '#5b5e60';
    ctx.fillRect(px, pz, (pk.x1 - pk.x0) * PX, (pk.z1 - pk.z0) * PX);
    if (g.world.ruined) {
      ctx.strokeStyle = '#c0392b';
      ctx.lineWidth = 3;
      for (const r of blockedRects()) {
        const [x0, z0] = this.toPx(r.x0, r.z0);
        const [x1, z1] = this.toPx(r.x1, r.z1);
        ctx.beginPath(); ctx.moveTo(x0, z0); ctx.lineTo(x1, z1); ctx.moveTo(x1, z0); ctx.lineTo(x0, z1); ctx.stroke();
      }
      for (const d of L.debrisSites) {
        if (g.world.clearedDebris.includes(d.id)) continue;
        const [x, z] = this.toPx(d.x, d.z);
        ctx.fillStyle = '#c0392b';
        ctx.fillRect(x - 4, z - 2, 8, 4);
      }
    }
    // Street names.
    ctx.fillStyle = 'rgba(220,220,210,0.55)';
    ctx.font = 'bold 13px "Rajdhani", Arial, sans-serif';
    for (const l of LINES) {
      const [x] = this.toPx(l, 0);
      ctx.save(); ctx.translate(x + 4, this.toPx(0, -60)[1]); ctx.rotate(Math.PI / 2); ctx.fillText(STREET_NAMES.x[String(l)], 0, 0); ctx.restore();
      const [, z] = this.toPx(0, l);
      ctx.fillText(STREET_NAMES.z[String(l)], this.toPx(-125, 0)[0], z + 4);
    }
    this.fogTimer = 0;
  }

  updateFog(dt) {
    this.fogTimer -= dt;
    if (this.fogTimer > 0) return;
    this.fogTimer = 0.5;
    const ms = this.game.mapState;
    const ctx = this.fog.getContext('2d');
    ctx.clearRect(0, 0, SIZE, SIZE);
    if (ms.fullMap) {
      ctx.fillStyle = 'rgba(8,10,10,0.35)';
      for (let j = 0; j < MAP_N; j++) for (let i = 0; i < MAP_N; i++) if (!ms.seen[j * MAP_N + i]) ctx.fillRect(i * MAP_CELL * PX, j * MAP_CELL * PX, MAP_CELL * PX, MAP_CELL * PX);
      return;
    }
    ctx.fillStyle = '#0b0d0d';
    for (let j = 0; j < MAP_N; j++) {
      let run = -1;
      for (let i = 0; i <= MAP_N; i++) {
        const unseen = i < MAP_N && !ms.seen[j * MAP_N + i];
        if (unseen && run < 0) run = i;
        if (!unseen && run >= 0) { ctx.fillRect(run * MAP_CELL * PX, j * MAP_CELL * PX, (i - run) * MAP_CELL * PX, MAP_CELL * PX + 0.5); run = -1; }
      }
    }
  }

  // Draws the map centred on (cx, cz). scale: screen pixels per metre.
  draw(ctx, w, h, { cx, cz, scale, rotate = 0, labels = true, round = false }) {
    const g = this.game;
    this.ensureBase();
    ctx.save();
    ctx.clearRect(0, 0, w, h);
    if (round) { ctx.beginPath(); ctx.arc(w / 2, h / 2, w / 2, 0, Math.PI * 2); ctx.clip(); }
    ctx.fillStyle = '#0b0d0d';
    ctx.fillRect(0, 0, w, h);
    ctx.translate(w / 2, h / 2);
    ctx.rotate(rotate);
    const k = scale / PX;
    ctx.scale(k, k);
    const [ox, oz] = this.toPx(cx, cz);
    ctx.translate(-ox, -oz);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.base, 0, 0);
    ctx.drawImage(this.fog, 0, 0);
    // Markers in base-pixel space.
    const ms = g.mapState;
    const dot = (x, z, r, color, stroke) => {
      const [px, pz] = this.toPx(x, z);
      ctx.beginPath(); ctx.arc(px, pz, r / k, 0, Math.PI * 2);
      ctx.fillStyle = color; ctx.fill();
      if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1.5 / k; ctx.stroke(); }
    };
    const text = (x, z, t, color = '#e8e2cc', dy = -10) => {
      if (!labels) return;
      const [px, pz] = this.toPx(x, z);
      ctx.save(); ctx.translate(px, pz); ctx.rotate(-rotate); ctx.scale(1 / k, 1 / k);
      ctx.font = 'bold 12px "Rajdhani", Arial, sans-serif'; ctx.textAlign = 'center';
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.strokeText(t, 0, dy); ctx.fillStyle = color; ctx.fillText(t, 0, dy);
      ctx.restore();
    };
    // Points of interest you have seen.
    if (labels) for (const p of g.L.poi) if (ms.isSeen(p.x, p.z)) text(p.x, p.z, p.name, '#bfb79e', 4);
    // Teammate clues and positions.
    for (const m of g.squad?.members || []) {
      if (m.status === 'prologue') continue;
      if (m.exact) {
        dot(m.pos.x, m.pos.z, 5, m.status === 'dead' ? '#555' : m.status === 'rescued' ? '#4fc36a' : '#f2c14e', '#000');
        text(m.pos.x, m.pos.z, m.status === 'dead' ? `${m.name} †` : m.name);
      } else if (m.knownArea && m.status !== 'dead') {
        const [px, pz] = this.toPx(m.knownArea.x, m.knownArea.z);
        ctx.beginPath(); ctx.arc(px, pz, m.knownArea.r * PX, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(242,193,78,0.14)'; ctx.fill();
        ctx.setLineDash([4 / k, 4 / k]); ctx.strokeStyle = 'rgba(242,193,78,0.8)'; ctx.lineWidth = 1.5 / k; ctx.stroke(); ctx.setLineDash([]);
        text(m.knownArea.x, m.knownArea.z, `${m.name}?`, '#f2c14e', 4);
      }
    }
    for (const mk of ms.markers) {
      if (mk.hidden) continue;
      const col = { shelter: '#4fa3e0', lz: '#7be07b', poi: '#e0e0e0', danger: '#e05a4f', objective: '#f2c14e', drone: '#bbbbbb' }[mk.kind] || '#fff';
      dot(mk.x, mk.z, mk.kind === 'lz' ? 7 : 5, col, '#000');
      text(mk.x, mk.z, mk.label, col);
    }
    for (const s of ms.recentSightings()) dot(s.x, s.z, 4, 'rgba(224,70,60,0.85)');
    if (ms.waypoint) { dot(ms.waypoint.x, ms.waypoint.z, 6, 'rgba(0,0,0,0)', '#f2c14e'); text(ms.waypoint.x, ms.waypoint.z, 'Waypoint', '#f2c14e'); }
    if (g.drone?.deployed) dot(g.drone.pos.x, g.drone.pos.z, 4, '#6fd3ff', '#000');
    // Player arrow.
    const P = g.player.pos;
    const [px, pz] = this.toPx(P.x, P.z);
    ctx.save();
    ctx.translate(px, pz);
    ctx.rotate(-g.player.yaw);
    ctx.scale(1 / k, 1 / k);
    ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(6, 7); ctx.lineTo(0, 3); ctx.lineTo(-6, 7); ctx.closePath();
    ctx.fillStyle = '#ffffff'; ctx.fill(); ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.restore();
    ctx.restore();
  }

  // Screen point -> world (for placing a waypoint on the map screen).
  screenToWorld(sx, sy, w, h, { cx, cz, scale }) {
    return { x: cx + (sx - w / 2) / scale, z: cz + (sy - h / 2) / scale };
  }
}
