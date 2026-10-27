// Enemy soldiers: spawning by campaign threat level, perception, movement,
// shooting, takedowns and loot. Decisions come from enemy-brain.js.

import * as THREE from 'three';
import { Character } from '../world/character.js';
import { createEnemyBrain, thinkEnemy, playerVisibility, ALERT_RADIUS } from './enemy-brain.js';
import { applyDamage } from './survival.js';
import { makeRng, dampAngle, yawTo, clamp } from '../core/util.js';
import { doorPoint } from '../world/collision.js';
import { buildHelicopter } from '../world/vehicles.js';
import * as M from '../world/materials.js';

let nextId = 1;
const ENEMY_LOOK = {
  name: 'Hostile', gender: 'male', skin: 3, hair: { style: 'buzz', color: 'black' }, eyes: 'brown', facialHair: 'none',
  face: { shape: 'square', jaw: 0.6 }, uniform: { type: 'field', color: 'grey', camo: 'urban' }, helmet: 'combat', helmetCover: 'plain',
  vest: 'plate', gloves: 'tactical', boots: 'black', backpack: 'assault', kneepads: 'standard', eyewear: 'none', radio: 'handheld',
  loadout: { kit: [] },
};

class Enemy {
  constructor(mgr, opts) {
    this.mgr = mgr;
    this.id = `e${nextId++}`;
    this.tag = opts.tag || 'patrol';
    this.pos = new THREE.Vector3(opts.x, 0, opts.z);
    this.yaw = opts.yaw || 0;
    this.route = opts.route || null;
    this.health = opts.officer ? 120 : 100;
    this.officer = !!opts.officer;
    this.brain = createEnemyBrain({ mode: opts.mode || 'patrol', post: opts.post || null, routeIdx: opts.routeIdx || 0, aggression: opts.aggression || 1 });
    if (opts.target) { this.brain.state = 'investigate'; this.brain.target = { ...opts.target }; this.brain.urgent = true; }
    this.char = new Character(ENEMY_LOOK, { kind: 'enemy', weapon: 'ar' });
    if (opts.officer) {
      const beret = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.12, 0.05, 14), M.std('#5a1414', 0.8));
      beret.position.set(0, 0.11, 0);
      this.char.j.head.add(beret);
    }
    mgr.game.scene.add(this.char.root);
    this.path = null;
    this.pathGoal = null;
    this.repath = 0;
    this.thinkTimer = Math.random() * 0.3;
    this.intent = { move: null, speed: 'walk' };
    this.hurt = false;
    this.dead = false;
    this.subdued = false;
    this.speed = 0;
    this.lastNoise = null;
    this.allyAlert = null;
    this.stuck = 0;
    this.lastPos = this.pos.clone();
  }

  get alive() { return !this.dead; }

  damage(amount, part, fromPos) {
    if (this.dead) return;
    this.health -= amount;
    this.hurt = true;
    if (fromPos) this.brain.lastKnown = { x: fromPos.x, z: fromPos.z };
    if (this.health <= 0) this.die();
    else this.mgr.game.audio.play('shout', { pos: this.pos, gain: 0.8 });
  }

  die(subdued = false) {
    if (this.dead) return;
    this.dead = true;
    this.subdued = subdued;
    this.brain.state = 'dead';
    this.char.setWeapon(null);
    this.mgr.onDeath(this);
  }
}

export class Enemies {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.noises = [];
    this.rng = makeRng('enemies');
    this.smokes = [];
    this.level = -1;
    this.heli = null;
    this.spawned = new Set();
  }

  clear() {
    for (const e of this.list) this.game.scene.remove(e.char.root);
    this.list = [];
    if (this.heli) { this.game.scene.remove(this.heli.mesh); this.heli.sound?.stop(); this.heli.light.intensity = 0; this.heli = null; }
    this.spawned.clear();
    this.level = -1;
  }

  get alive() { return this.list.filter((e) => !e.dead); }

  noise(x, z, radius, loud, source) {
    this.noises.push({ x, z, radius, loud, source, t: 0.6 });
  }

  spawn(opts) {
    const e = new Enemy(this, opts);
    this.list.push(e);
    return e;
  }

  // Spawns a patrol of `n` soldiers on a named route, away from the player.
  spawnPatrol(routeName, n, tag = 'patrol') {
    const route = this.game.L.patrolRoutes[routeName];
    if (!route) return;
    const P = this.game.player.pos;
    let start = 0;
    let best = -1;
    route.forEach((p, i) => { const d = Math.hypot(p.x - P.x, p.z - P.z); if (d > best) { best = d; start = i; } });
    for (let i = 0; i < n; i++) {
      const p = route[start];
      this.spawn({ x: p.x + i * 1.5, z: p.z + i * 1.2, route: routeName, routeIdx: (start + 1) % route.length, tag });
    }
  }

  spawnGuards(points, tag) {
    for (const p of points) this.spawn({ x: p.x, z: p.z, mode: 'guard', post: { x: p.x, z: p.z }, tag });
  }

  // Keeps the population in line with the campaign's threat level.
  setThreat(level) {
    if (level <= this.level) return;
    this.level = level;
    const want = { 1: ['plaza', 'north'], 2: ['plaza', 'north', 'bahnhof', 'west', 'east'], 3: ['plaza', 'north', 'bahnhof', 'west', 'east', 'southwest', 'park'] }[Math.min(3, level)] || [];
    for (const r of want) {
      if (this.spawned.has(r)) continue;
      this.spawned.add(r);
      this.spawnPatrol(r, 2);
    }
    if (level >= 2 && !this.spawned.has('rathaus')) {
      this.spawned.add('rathaus');
      this.spawnGuards([{ x: -4, z: -5 }, { x: 6, z: -4 }], 'rathaus');
    }
  }

  // --- Special events -----------------------------------------------------------
  spawnOfficer() {
    const e = this.spawn({ x: -30, z: 30, route: 'plaza', routeIdx: 0, officer: true, tag: 'officer' });
    this.spawn({ x: -31.5, z: 31.5, route: 'plaza', routeIdx: 0, tag: 'officer' });
    return e;
  }

  spawnCheckpoint(near) {
    const pts = [{ x: near.x + 6, z: near.z + 4 }, { x: near.x - 5, z: near.z + 5 }, { x: near.x + 2, z: near.z - 6 }];
    this.spawnGuards(pts, 'checkpoint');
    this.spawnPatrol(near.route, 2, 'checkpoint');
  }

  spawnDepotGuards() {
    this.spawnGuards([{ x: -8, z: 96 }, { x: 8, z: 96 }, { x: 0, z: 112 }, { x: -12, z: 115 }], 'depot');
  }

  spawnRoadblock() {
    this.spawnGuards([{ x: -6, z: -92 }, { x: 6, z: -92 }, { x: 0, z: -86 }, { x: 14, z: -90 }], 'roadblock');
  }

  spawnRaid(target, count = 6) {
    const out = [];
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      let x = target.x + Math.cos(a) * 110;
      let z = target.z + Math.sin(a) * 110;
      const k = this.game.nav.nearestWalkable(x, z, 20);
      if (k >= 0) ({ x, z } = this.game.nav.center(k));
      out.push(this.spawn({ x, z, target: { x: target.x + (Math.random() - 0.5) * 6, z: target.z + (Math.random() - 0.5) * 6 }, tag: 'raid', aggression: 1.3, route: 'plaza' }));
    }
    return out;
  }

  startHelicopterPatrol() {
    if (this.heli) return;
    const mesh = buildHelicopter('attack');
    const light = this.game.heliSpot;
    this.game.scene.add(mesh);
    this.heli = { mesh, light, t: 0, sound: this.game.audio.loop('heli', { pos: { x: 0, y: 70, z: 0 }, gain: 1.4, ref: 20 }) };
  }

  // --- Queries ----------------------------------------------------------------------
  // Bullet ray vs enemy hitboxes. Returns { enemy, dist, part } or null.
  raycast(origin, dir, maxDist) {
    let best = null;
    for (const e of this.list) {
      if (e.dead) continue;
      const cx = e.pos.x;
      const cz = e.pos.z;
      const crouch = e.brain.crouched ? 0.45 : 0;
      // Head sphere.
      const head = rayCylinder(origin, dir, cx, cz, 0.13, e.pos.y + 1.5 - crouch, e.pos.y + 1.78 - crouch);
      if (head != null && head < maxDist && (!best || head < best.dist)) best = { enemy: e, dist: head, part: 'head' };
      const body = rayCylinder(origin, dir, cx, cz, 0.26, e.pos.y + 0.9 - crouch, e.pos.y + 1.5 - crouch);
      if (body != null && body < maxDist && (!best || body < best.dist)) best = { enemy: e, dist: body, part: 'torso' };
      const legs = rayCylinder(origin, dir, cx, cz, 0.2, e.pos.y, e.pos.y + 0.9 - crouch);
      if (legs != null && legs < maxDist && (!best || legs < best.dist)) best = { enemy: e, dist: legs, part: 'limb' };
    }
    return best;
  }

  // The most dangerous enemy near a point (for teammates).
  threatNear(pos, r) {
    let best = null;
    for (const e of this.list) {
      if (e.dead) continue;
      const d = Math.hypot(e.pos.x - pos.x, e.pos.z - pos.z);
      if (d > r) continue;
      if (e.brain.state !== 'combat' && e.brain.state !== 'cover' && !(e.brain.state === 'investigate' && e.brain.urgent)) continue;
      const visible = this.game.cw.lineOfSight(pos.x, 1.4, pos.z, e.pos.x, 1.4, e.pos.z);
      if (!best || (visible && !best.visible) || d < best.d) best = { enemy: e, d, visible };
    }
    return best;
  }

  teammateShoots(m, e) {
    const g = this.game;
    const d = Math.hypot(e.pos.x - m.pos.x, e.pos.z - m.pos.z);
    g.audio.play('gunshot', { pos: m.pos, weapon: m.def.weapon, gain: 0.9 });
    g.particles.emit('muzzle', m.pos.x - Math.sin(m.yaw) * 0.7, 1.3, m.pos.z - Math.cos(m.yaw) * 0.7, 1, { exact: true });
    this.noise(m.pos.x, m.pos.z, 80, 1, 'teammate');
    const chance = clamp(0.45 - d / 90, 0.06, 0.4) * (e.brain.crouched ? 0.6 : 1);
    if (Math.random() < chance) e.damage(22 + Math.random() * 12, 'torso', m.pos);
    else g.particles.emit('puff', e.pos.x + (Math.random() - 0.5) * 2, 1 + Math.random(), e.pos.z + (Math.random() - 0.5) * 2, 2);
  }

  onDeath(e) {
    const g = this.game;
    g.stats.enemiesDown = (g.stats.enemiesDown || 0) + 1;
    g.containers.registerBody(e);
    if (e.tag === 'raid' && !this.list.some((k) => k.tag === 'raid' && !k.dead)) g.onRaidDefeated();
  }

  // Line segment through any active smoke cloud?
  smokeBlocks(ax, az, bx, bz) {
    for (const s of this.game.smokes) {
      const dx = bx - ax;
      const dz = bz - az;
      const L2 = dx * dx + dz * dz || 1;
      const t = clamp(((s.x - ax) * dx + (s.z - az) * dz) / L2, 0, 1);
      if (Math.hypot(ax + dx * t - s.x, az + dz * t - s.z) < s.r) return true;
    }
    return false;
  }

  // --- Update -----------------------------------------------------------------------
  update(dt) {
    const g = this.game;
    const P = g.player.pos;
    this.noises = this.noises.filter((n) => (n.t -= dt) > 0);
    for (const e of this.list) {
      const dist = Math.hypot(e.pos.x - P.x, e.pos.z - P.z);
      e.char.root.visible = dist < 200;
      e.char.setDetailVisible(dist < 25);
      if (e.dead) {
        e.char.animate(dt, { mode: 'dead' });
        e.char.root.position.copy(e.pos);
        e.char.root.rotation.y = e.yaw;
        continue;
      }
      // Distant soldiers think less often.
      e.thinkTimer -= dt;
      if (e.thinkTimer <= 0) {
        const step = dist < 60 ? 0.12 : dist < 120 ? 0.35 : 0.9;
        e.thinkTimer = step;
        this.think(e, step, dist);
      }
      this.move(e, dt);
      e.char.root.position.copy(e.pos);
      e.char.root.rotation.y = e.yaw;
      if (e.char.root.visible) {
        const moving = e.speed > 0.1;
        const mode = moving ? (e.intent.speed === 'run' ? 'run' : 'walk') : e.intent.crouch ? 'crouch' : 'idle';
        e.char.animate(dt, { mode, speed: e.speed, aiming: e.brain.state === 'combat' || e.brain.state === 'cover' });
      }
    }
    this.updateHeli(dt);
    // Bodies are cleaned up when far away and old.
    if (this.list.length > 40) {
      const old = this.list.filter((e) => e.dead && Math.hypot(e.pos.x - P.x, e.pos.z - P.z) > 120);
      for (const e of old.slice(0, this.list.length - 40)) { g.scene.remove(e.char.root); this.list.splice(this.list.indexOf(e), 1); }
    }
  }

  perceive(e) {
    const g = this.game;
    const pl = g.player;
    const P = pl.pos;
    const eyeY = e.pos.y + (e.brain.crouched ? 1.1 : 1.6);
    const dx = P.x - e.pos.x;
    const dz = P.z - e.pos.z;
    const dist = Math.hypot(dx, dz);
    const fwdX = -Math.sin(e.yaw);
    const fwdZ = -Math.cos(e.yaw);
    const cos = (dx * fwdX + dz * fwdZ) / (dist || 1);
    const range = g.darkness > 0.6 ? (pl.flashlightOn ? 95 : 32) : 75;
    let see = false;
    let vis = 0;
    const hiding = g.mode !== 'play' && g.mode !== 'drone';
    if (!hiding && g.playerAlive && dist < range && (cos > 0.5 || dist < 3.5)) {
      const ty = P.y + pl.eye - 0.25;
      if (g.cw.lineOfSight(e.pos.x, eyeY, e.pos.z, P.x, ty, P.z) && !this.smokeBlocks(e.pos.x, e.pos.z, P.x, P.z)) {
        see = true;
        vis = playerVisibility({
          dist, crouched: pl.crouched, moving: pl.moving, sprinting: pl.sprinting, darkness: g.darkness, flashlight: pl.flashlightOn && g.darkness > 0.4,
          indoorsDark: !!pl.indoors,
        });
        if (cos < 0.85 && dist > 6) vis *= 0.6; // peripheral vision
      }
    }
    // Teammates are targets too.
    let mate = null;
    if (!see) {
      for (const m of g.squad.members) {
        if (m.status !== 'rescued') continue;
        const d = Math.hypot(m.pos.x - e.pos.x, m.pos.z - e.pos.z);
        if (d > range * 0.8) continue;
        const c2 = ((m.pos.x - e.pos.x) * fwdX + (m.pos.z - e.pos.z) * fwdZ) / (d || 1);
        if (c2 < 0.5 && d > 3) continue;
        if (g.cw.lineOfSight(e.pos.x, eyeY, e.pos.z, m.pos.x, 1.2, m.pos.z)) { mate = { m, d }; break; }
      }
    }
    // Loudest noise heard.
    let noise = null;
    for (const n of this.noises) {
      const d = Math.hypot(n.x - e.pos.x, n.z - e.pos.z);
      if (d < n.radius && (!noise || n.loud > noise.loud)) noise = { x: n.x, z: n.z, loud: n.loud };
    }
    return { see, vis, dist, mate, noise };
  }

  think(e, dt, distToPlayer) {
    const g = this.game;
    const per = this.perceive(e);
    const route = e.route ? g.L.patrolRoutes[e.route] : null;
    const target = per.see ? { x: g.player.pos.x, z: g.player.pos.z } : per.mate ? { x: per.mate.m.pos.x, z: per.mate.m.pos.z } : null;
    const arrived = !e.intent.move || Math.hypot(e.intent.move.x - e.pos.x, e.intent.move.z - e.pos.z) < 1.6;
    const p = {
      pos: e.pos, seePlayer: per.see || !!per.mate, visibility: per.see ? per.vis : per.mate ? 0.8 : 0,
      playerPos: target, playerDist: per.see ? per.dist : per.mate ? per.mate.d : 999, noise: per.noise, allyAlert: e.allyAlert,
      hurt: e.hurt, healthFrac: e.health / 100, arrived, cover: this.coverFor(e, target), searchSpots: e.brain.state === 'investigate' || e.brain.state === 'combat' ? this.searchSpots(e) : [],
      routePoint: (i) => (route ? route[i % route.length] : e.brain.post || { x: e.pos.x, z: e.pos.z }), routeLen: route ? route.length : 1, rng: this.rng, range: 70,
    };
    const prev = e.brain.state;
    const out = thinkEnemy(e.brain, p, dt);
    e.hurt = false;
    e.allyAlert = null;
    e.intent = out;
    if (out.say) {
      if (distToPlayer < 50) g.audio.play('shout', { pos: e.pos, gain: out.say === 'contact' ? 1.3 : 0.7 });
      if ((out.say === 'contact' || out.say === 'suspicious') && distToPlayer < 60) g.enemyAlerted(e, out.say);
    }
    if (out.alert) {
      for (const o of this.list) {
        if (o !== e && !o.dead && Math.hypot(o.pos.x - e.pos.x, o.pos.z - e.pos.z) < ALERT_RADIUS) o.allyAlert = out.alert;
      }
    }
    if (prev !== 'combat' && e.brain.state === 'combat' && per.see) g.onSpotted(e);
    if (out.look) e.lookAt = out.look; else e.lookAt = null;
    if (out.fire) this.shoot(e, per);
  }

  coverFor(e, threat) {
    if (!threat) return null;
    let best = null;
    let bd = Infinity;
    for (const c of this.game.L.coverPoints) {
      const d = Math.hypot(c.x - e.pos.x, c.z - e.pos.z);
      if (d > 18 || d > bd) continue;
      // Cover should be roughly away from the threat.
      const away = Math.hypot(c.x - threat.x, c.z - threat.z) > Math.hypot(e.pos.x - threat.x, e.pos.z - threat.z) - 2;
      if (away) { bd = d; best = c; }
    }
    return best;
  }

  searchSpots(e) {
    const g = this.game;
    const base = e.brain.lastKnown || e.brain.target || e.pos;
    const out = [];
    // Look inside nearby buildings: the enemy searches doorways and rooms.
    for (const b of g.L.buildings) {
      if (!b.enterable) continue;
      const dp = doorPoint(b, 1.5);
      if (Math.hypot(dp.x - base.x, dp.z - base.z) < 35) out.push({ x: dp.inX + (Math.random() - 0.5), z: dp.inZ + (Math.random() - 0.5) });
    }
    for (let i = 0; i < 4; i++) {
      const k = g.nav.nearestWalkable(base.x + (Math.random() - 0.5) * 24, base.z + (Math.random() - 0.5) * 24, 6);
      if (k >= 0) out.push(g.nav.center(k));
    }
    return out.sort(() => Math.random() - 0.5);
  }

  shoot(e, per) {
    const g = this.game;
    const P = g.player.pos;
    g.audio.play('gunshot', { pos: e.pos, weapon: 'ar', gain: 1 });
    const mz = { x: e.pos.x - Math.sin(e.yaw) * 0.8, y: e.pos.y + 1.4, z: e.pos.z - Math.cos(e.yaw) * 0.8 };
    g.particles.emit('muzzle', mz.x, mz.y, mz.z, 1, { exact: true });
    this.noise(e.pos.x, e.pos.z, 90, 1, 'enemy');
    if (per.see) {
      const pl = g.player;
      let chance = 0.42 * clamp(1.15 - per.dist / 70, 0.15, 1);
      if (pl.crouched) chance *= 0.65;
      if (pl.moving) chance *= pl.sprinting ? 0.55 : 0.8;
      chance *= 1 - g.darkness * 0.45;
      chance *= e.brain.aggression;
      if (Math.random() < chance) {
        const r = Math.random();
        const part = r < 0.1 ? 'head' : r < 0.45 ? 'limb' : 'torso';
        g.damagePlayer(12 + Math.random() * 12, { kind: 'bullet', part: part === 'limb' ? (Math.random() < 0.5 ? 'leg' : 'arm') : part, from: e.pos });
      } else if (per.dist < 30) {
        g.audio.play('whizz', { gain: 0.8 });
        const off = new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 1.5, (Math.random() - 0.5) * 3);
        g.particles.emit('puff', P.x + off.x, P.y + off.y, P.z + off.z, 2);
      }
    } else if (per.mate) {
      const m = per.mate.m;
      if (Math.random() < 0.22) {
        applyDamage(m.vitals, 15 + Math.random() * 10, { kind: 'bullet', part: Math.random() < 0.6 ? 'torso' : 'leg', armor: 0.3 });
        if (m.vitals.health <= 0) g.squad.kill(m);
        else if (m.lineCooldown <= 0) m.say('pain');
      }
    }
  }

  move(e, dt) {
    const g = this.game;
    const tgt = e.intent.move;
    if (e.lookAt) e.yaw = dampAngle(e.yaw, Math.atan2(-(e.lookAt.x - e.pos.x), -(e.lookAt.z - e.pos.z)), 6, dt);
    if (!tgt) { e.speed = 0; return; }
    const dToGoal = Math.hypot(tgt.x - e.pos.x, tgt.z - e.pos.z);
    if (dToGoal < 1.2) { e.speed = 0; return; }
    e.repath -= dt;
    if (!e.path || e.repath <= 0 || !e.pathGoal || Math.hypot(e.pathGoal.x - tgt.x, e.pathGoal.z - tgt.z) > 3) {
      e.repath = 1.5 + Math.random();
      e.pathGoal = { x: tgt.x, z: tgt.z };
      e.path = g.nav.findPath(e.pos.x, e.pos.z, tgt.x, tgt.z, 20000) || [{ x: tgt.x, z: tgt.z }];
    }
    let wp = e.path[0];
    while (wp && Math.hypot(wp.x - e.pos.x, wp.z - e.pos.z) < 0.6 && e.path.length > 1) { e.path.shift(); wp = e.path[0]; }
    if (!wp) return;
    const sp = e.intent.speed === 'run' ? 3.9 : 1.5;
    const wx = wp.x - e.pos.x;
    const wz = wp.z - e.pos.z;
    const wd = Math.hypot(wx, wz) || 1;
    const step = Math.min(wd, sp * dt);
    const p = { x: e.pos.x + (wx / wd) * step, y: 0, z: e.pos.z + (wz / wd) * step };
    g.cw.move(p, 0, 0, 0.3, 1.7);
    e.pos.x = p.x;
    e.pos.z = p.z;
    if (!e.lookAt) e.yaw = dampAngle(e.yaw, Math.atan2(-wx, -wz), 6, dt);
    e.speed = sp;
    if (e.pos.distanceTo(e.lastPos) < sp * dt * 0.1) e.stuck += dt; else e.stuck = 0;
    e.lastPos.copy(e.pos);
    if (e.stuck > 3) { e.stuck = 0; e.path = null; const k = g.nav.nearestWalkable(e.pos.x, e.pos.z, 4); if (k >= 0) { const c = g.nav.center(k); e.pos.x = c.x; e.pos.z = c.z; } }
  }

  updateHeli(dt) {
    const h = this.heli;
    if (!h) return;
    const g = this.game;
    h.t += dt;
    const night = g.darkness > 0.55;
    const a = h.t * 0.05;
    const x = Math.cos(a) * 110 + Math.sin(a * 2.3) * 30;
    const z = Math.sin(a) * 110;
    h.mesh.position.set(x, 65, z);
    h.mesh.rotation.y = -a + Math.PI;
    // Searchlight hangs under the nose and sweeps ahead and below.
    const fwd = new THREE.Vector3(-Math.sin(h.mesh.rotation.y), 0, -Math.cos(h.mesh.rotation.y));
    h.light.position.set(x + fwd.x * 2, 63, z + fwd.z * 2);
    h.light.target.position.set(x + fwd.x * 25 + Math.sin(h.t * 0.7) * 12, 0, z + fwd.z * 25 + Math.cos(h.t * 0.5) * 12);
    if (h.mesh.userData.rotor) h.mesh.userData.rotor.rotation.y += dt * 30;
    if (h.mesh.userData.tailRotor) h.mesh.userData.tailRotor.rotation.x += dt * 40;
    h.light.intensity = night ? 800 : 0;
    h.sound.setPos({ x, y: 65, z });
    // Searchlight sweep: spots the player in the open at night.
    if (night) {
      const lp = h.light.target.position;
      const P = g.player.pos;
      if (Math.hypot(lp.x - P.x, lp.z - P.z) < 9 && !g.player.indoors && g.cw.lineOfSight(x, 63, z, P.x, P.y + 1.4, P.z)) {
        h.cooldown = (h.cooldown || 0) - dt;
        if (h.cooldown <= 0) {
          h.cooldown = 20;
          g.toast('The helicopter searchlight found you! Patrols are coming.', 'bad');
          for (const e of this.list) if (!e.dead && Math.hypot(e.pos.x - P.x, e.pos.z - P.z) < 150) e.allyAlert = { x: P.x, z: P.z };
        }
      }
    }
  }

  serialize() {
    return { level: this.level, spawned: [...this.spawned], list: this.list.filter((e) => !e.dead || Math.hypot(e.pos.x, e.pos.z) < 999).map((e) => ({ x: e.pos.x, z: e.pos.z, yaw: e.yaw, route: e.route, tag: e.tag, dead: e.dead, officer: e.officer, mode: e.brain.home, post: e.brain.post, health: e.health })), heli: !!this.heli };
  }

  restore(s) {
    this.clear();
    if (!s) return;
    this.level = s.level;
    this.spawned = new Set(s.spawned);
    for (const k of s.list) {
      const e = this.spawn({ x: k.x, z: k.z, yaw: k.yaw, route: k.route, tag: k.tag, officer: k.officer, mode: k.mode, post: k.post });
      e.health = k.health;
      if (k.dead) e.die();
    }
    if (s.heli) this.startHelicopterPatrol();
  }
}

// Ray vs vertical cylinder; returns distance or null.
function rayCylinder(o, d, cx, cz, r, y0, y1) {
  const ox = o.x - cx;
  const oz = o.z - cz;
  const a = d.x * d.x + d.z * d.z;
  if (a < 1e-9) return null;
  const b = 2 * (ox * d.x + oz * d.z);
  const c = ox * ox + oz * oz - r * r;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const s = Math.sqrt(disc);
  for (const t of [(-b - s) / (2 * a), (-b + s) / (2 * a)]) {
    if (t < 0) continue;
    const y = o.y + d.y * t;
    if (y >= y0 && y <= y1) return t;
  }
  return null;
}
