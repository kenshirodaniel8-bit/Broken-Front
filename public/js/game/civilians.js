// Civilians and traffic of the opening scene. Removed when the city falls.

import * as THREE from 'three';
import { Character, civilianConfig, civilianColors } from '../world/character.js';
import { makeCar } from '../world/props.js';
import { makeRng, dampAngle } from '../core/util.js';

const CAR_COLORS = ['#b9bcc0', '#1d1f22', '#e8e8e6', '#7a1d1d', '#1d3557', '#8a8a8a'];

export class Civilians {
  constructor(game) {
    this.game = game;
    this.people = [];
    this.cars = [];
    this.panic = false;
    this.rng = makeRng('civilians');
  }

  // Sidewalk points around the Marktplatz and the walk to the bus.
  sidewalkPoint() {
    const r = this.rng;
    const lines = [-30, 30];
    const line = r.pick(lines);
    const along = r.range(-55, 95);
    const off = r.pick([-6.2, 6.2]);
    return r.chance(0.5) ? { x: line + off, z: along } : { x: along * 0.7, z: line + off };
  }

  spawn(count = 26) {
    const g = this.game;
    for (let i = 0; i < count; i++) {
      const cfg = civilianConfig(this.rng);
      const ch = new Character(cfg, { kind: 'civilian', ...civilianColors(this.rng), height: cfg.gender === 'female' ? 0.94 : 1 });
      ch.setDetailVisible(false);
      const p = i < 8 ? { x: this.rng.range(-18, 18), z: this.rng.range(-5, 20) } : this.sidewalkPoint();
      const person = { ch, pos: new THREE.Vector3(p.x, 0, p.z), yaw: this.rng() * 6.28, target: this.sidewalkPoint(), path: null, speed: this.rng.range(1.0, 1.5), wait: this.rng() * 4 };
      g.scene.add(ch.root);
      this.people.push(person);
    }
    // Traffic loop around the Marktplatz, driving on the right.
    const loop = [[-30, -30], [30, -30], [30, 30], [-30, 30]];
    for (let i = 0; i < 5; i++) {
      const mesh = makeCar(this.rng.pick(['sedan', 'hatch', 'sedan', 'van']), this.rng.pick(CAR_COLORS));
      g.scene.add(mesh);
      this.cars.push({ mesh, loop, seg: i % 4, t: (i * 0.37) % 1, speed: 0, max: 7 + this.rng() * 2 });
    }
  }

  startPanic() {
    this.panic = true;
    for (const p of this.people) {
      // Run away from the street the squad is on.
      const ang = this.rng() * Math.PI * 2;
      p.target = { x: Math.cos(ang) * 140, z: Math.sin(ang) * 140 };
      p.path = null;
      p.speed = this.rng.range(3.6, 5.2);
      p.wait = this.rng() * 0.8;
    }
    for (const c of this.cars) c.max = 0;
  }

  update(dt) {
    const g = this.game;
    const P = g.player.pos;
    for (const p of this.people) {
      if (p.removed) continue;
      p.wait -= dt;
      let moving = false;
      if (p.wait <= 0) {
        if (!p.path) p.path = g.nav.findPath(p.pos.x, p.pos.z, p.target.x, p.target.z, 8000) || [];
        const wp = p.path[0];
        if (!wp) {
          if (this.panic) { p.removed = true; g.scene.remove(p.ch.root); continue; }
          p.target = this.sidewalkPoint();
          p.path = null;
          p.wait = 1 + this.rng() * 5;
        } else {
          const dx = wp.x - p.pos.x;
          const dz = wp.z - p.pos.z;
          const d = Math.hypot(dx, dz);
          if (d < 0.5) p.path.shift();
          else {
            const s = Math.min(d, p.speed * dt);
            p.pos.x += (dx / d) * s;
            p.pos.z += (dz / d) * s;
            p.yaw = dampAngle(p.yaw, Math.atan2(-dx, -dz), 8, dt);
            moving = true;
          }
        }
      }
      // Keep a little distance from the player.
      const px = p.pos.x - P.x;
      const pz = p.pos.z - P.z;
      const pd = Math.hypot(px, pz);
      if (pd < 0.7 && pd > 0.01) { p.pos.x += (px / pd) * (0.7 - pd); p.pos.z += (pz / pd) * (0.7 - pd); }
      if (this.panic && pd > 120) { p.removed = true; g.scene.remove(p.ch.root); continue; }
      p.ch.root.position.copy(p.pos);
      p.ch.root.rotation.y = p.yaw;
      p.ch.root.visible = pd < 160;
      if (p.ch.root.visible) p.ch.animate(dt, { mode: moving ? (this.panic ? 'panic' : 'walk') : 'idle', speed: moving ? p.speed : 0 });
    }
    for (const c of this.cars) {
      const [ax, az] = c.loop[c.seg];
      const [bx, bz] = c.loop[(c.seg + 1) % c.loop.length];
      const len = Math.hypot(bx - ax, bz - az);
      const dirx = (bx - ax) / len;
      const dirz = (bz - az) / len;
      // Lane offset to the right of the direction of travel.
      const x = ax + dirx * len * c.t - dirz * 1.7;
      const z = az + dirz * len * c.t + dirx * 1.7;
      // Brake for the player, other cars, or the alarm.
      let limit = c.max;
      const ahead = Math.hypot(P.x - (x + dirx * 5), P.z - (z + dirz * 5));
      if (ahead < 4.5) limit = 0;
      for (const o of this.cars) {
        if (o === c) continue;
        const ox = o.mesh.position.x - x;
        const oz = o.mesh.position.z - z;
        if (ox * dirx + oz * dirz > 0 && ox * dirx + oz * dirz < 9 && Math.abs(-ox * dirz + oz * dirx) < 2) limit = 0;
      }
      c.speed += Math.sign(limit - c.speed) * Math.min(Math.abs(limit - c.speed), (limit < c.speed ? 9 : 2.5) * dt);
      c.t += (c.speed * dt) / len;
      if (c.t >= 1) { c.t -= 1; c.seg = (c.seg + 1) % c.loop.length; }
      c.mesh.position.set(x, 0, z);
      c.mesh.rotation.y = Math.atan2(-dirx, -dirz);
      // Push the player out of a car body.
      const lx = (P.x - x) * dirx + (P.z - z) * dirz;
      const lz = -(P.x - x) * dirz + (P.z - z) * dirx;
      if (Math.abs(lx) < 2.6 && Math.abs(lz) < 1.3) {
        const push = 1.3 - Math.abs(lz);
        P.x += -dirz * Math.sign(lz || 1) * push;
        P.z += dirx * Math.sign(lz || 1) * push;
      }
    }
  }

  clear() {
    for (const p of this.people) this.game.scene.remove(p.ch.root);
    for (const c of this.cars) this.game.scene.remove(c.mesh);
    this.people = [];
    this.cars = [];
    this.panic = false;
  }
}
