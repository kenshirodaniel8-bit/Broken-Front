// The opening: arrival in Kreuzhafen, shopping, the walk to the bus, the
// invasion and the great destruction, the blackout and waking up.

import * as THREE from 'three';
import { PROLOGUE_LINES, teammate } from '../data/teammates.js';
import { pickBlastTargets } from '../world/layout.js';
import { buildJet, buildHelicopter } from '../world/vehicles.js';
import { Props } from '../world/props.js';
import * as M from '../world/materials.js';
import { clamp, lerp, damp, yawTo } from '../core/util.js';

export const BUDGET = 320;
export const SHOPS = {
  supermarket: { name: 'Frischmarkt', items: ['water_small', 'water_large', 'cola', 'juice', 'bread', 'canned_soup', 'canned_beans', 'crackers', 'chocolate', 'energy_bar', 'apple', 'purify_tabs'] },
  pharmacy: { name: 'Löwen-Apotheke', items: ['bandage', 'painkillers', 'antiseptic', 'burn_gel', 'splint', 'tourniquet', 'first_aid_kit', 'purify_tabs'] },
  electronics: { name: 'Elektro Brandt', items: ['drone', 'drone_battery', 'power_bank', 'usb_cable', 'earphones', 'flashlight', 'batteries'] },
  bakery: { name: 'Bäckerei Hofmann', items: ['bread', 'pretzel', 'water_small'] },
  kiosk: { name: 'Kiosk am Eck', items: ['cola', 'water_small', 'chocolate', 'batteries', 'lighter', 'blanket', 'duct_tape'] },
};

const WALK_PATH = [{ x: 24, z: 26 }, { x: 30, z: 34 }, { x: 30, z: 47 }, { x: 30, z: 66 }, { x: 34, z: 82 }];

export class Prologue {
  constructor(game) {
    this.game = game;
    this.phase = 'idle';
    this.t = 0;
    this.lineIdx = 0;
    this.aircraft = [];
    this.looked = new Set();
    this.events = [];
    this.money = BUDGET;
    this.purchases = [];
  }

  line(key, i) {
    const l = PROLOGUE_LINES[key][i];
    const tm = teammate(l.who);
    const m = this.game.squad.get(l.who);
    this.game.audio.say(tm.short, l.t, l.s, tm.voice, { pos: m.pos, shout: l.shout });
  }

  // Run fn at time t (seconds) within the current phase.
  at(t, fn) {
    const key = `${this.phase}:${t}`;
    if (this.t >= t && !this.events.includes(key)) {
      this.events.push(key);
      fn();
    }
  }

  setPhase(p) {
    this.phase = p;
    this.t = 0;
    this.game.debugPhase = p;
  }

  start() {
    const g = this.game;
    const a = g.L.playerArrival;
    g.player.place(a.x, 0, a.z, a.yaw);
    g.squad.setupPrologue(a);
    // Squad gathered by the van, facing the player.
    g.squad.members.forEach((m, i) => {
      m.pos.set(a.x + 2.5 + (i % 2) * 1.4, 0, a.z - 1.8 + i * 1.2);
      m.script = { face: g.player.pos };
    });
    g.civilians.spawn(g.quality.civilians);
    this.cityLoop = g.audio.loop('city', { bus: 'amb', gain: 0.8 });
    this.windLoop = g.audio.loop('wind', { bus: 'amb', gain: 0.25 });
    g.campaign.minutes = 9 * 60 + 31;
    g.ui.fade(1, 0);
    g.ui.fade(0, 2.5);
    g.ui.titleCard('KREUZHAFEN, GERMANY', 'Satgas Elang-7 · Security detail for the Federal President\'s visit · 09:31');
    this.setPhase('arrive');
  }

  objective(text) { this.game.ui.setPrologueObjective(text); }

  update(dt) {
    const g = this.game;
    this.t += dt;
    // A slow clock during the opening.
    if (this.phase !== 'blackout' && this.phase !== 'wake') g.campaign.minutes = Math.min(11 * 60 + 40, g.campaign.minutes + dt / 6);
    this.updateAircraft(dt);
    const fn = this[`phase_${this.phase}`];
    if (fn) fn.call(this, dt);
  }

  phase_arrive() {
    const g = this.game;
    this.at(2.5, () => this.line('arrive', 0));
    this.at(9, () => this.line('arrive', 1));
    this.at(15, () => this.line('arrive', 2));
    this.at(3, () => this.objective('Look around the Marktplatz: the Rathaus, the fountain.'));
    // Looking at landmarks.
    const f = g.player.forward();
    for (const [id, x, z] of [['rathaus', 0, -16], ['fountain', 0, 8]]) {
      const dx = x - g.player.pos.x;
      const dz = z - g.player.pos.z;
      const d = Math.hypot(dx, dz);
      if ((f.x * dx + f.z * dz) / d > 0.92) this.looked.add(id);
    }
    if ((this.looked.size >= 2 && this.t > 10) || this.t > 40) this.setPhase('gear');
  }

  phase_gear() {
    const g = this.game;
    this.at(0, () => this.objective('Check your gear: open the inventory (Tab).'));
    if (g.ui.flags.inventoryOpened || this.t > 35) this.setPhase('shopping');
  }

  phase_shopping() {
    const g = this.game;
    const sq = g.squad;
    this.at(0, () => {
      this.objective(`Buy supplies before the bus: food & water (Frischmarkt), medical (Apotheke), a drone (Elektro Brandt). Budget €${BUDGET}. Then meet Bima at the south-east corner of the Marktplatz.`);
      this.line('shopping', 0);
      const corner = { x: 22, z: 24 };
      sq.get('bima').script = { target: corner, face: { x: 30, z: 60 } };
      sq.get('sari').script = { target: { x: 34.5, z: -5 }, face: { x: 40, z: -5 } };
      sq.get('dimas').script = { target: { x: 2, z: 34.5 }, face: { x: 2, z: 40 } };
      sq.get('rizky').script = { target: { x: -4, z: -34.5 }, face: { x: -4, z: -40 } };
      g.mapState.addMarker({ id: 'meet', x: 22, z: 24, kind: 'objective', label: 'Meet the squad' });
    });
    this.at(10, () => this.line('shopping', 1));
    const bima = sq.get('bima');
    const d = Math.hypot(g.player.pos.x - bima.pos.x, g.player.pos.z - bima.pos.z);
    this.at(240, () => g.audio.say('[Radio] Bima', 'Elang-2, where are you? The bus is waiting. Marktplatz, south-east corner.', null, teammate('bima').voice, { radio: true }));
    if (this.t > 12 && d < 7) {
      for (const m of sq.members) m.script = { target: { x: 24 + m.index, z: 25 + m.index * 0.8 } };
      g.mapState.removeMarker('meet');
      this.setPhase('walk');
    }
  }

  phase_walk() {
    const g = this.game;
    const sq = g.squad;
    this.at(0, () => { this.objective('Walk with the squad to the bus on Bahnhofstraße.'); this.line('walk', 0); this.wp = 0; });
    this.at(9, () => this.line('walk', 1));
    const bima = sq.get('bima');
    const lead = WALK_PATH[Math.min(this.wp, WALK_PATH.length - 1)];
    const playerLag = Math.hypot(g.player.pos.x - bima.pos.x, g.player.pos.z - bima.pos.z);
    if (Math.hypot(bima.pos.x - lead.x, bima.pos.z - lead.z) < 1.2 && playerLag < 16) this.wp++;
    sq.members.forEach((m, i) => {
      const off = [[0, 0], [-1.5, 1.6], [1.4, 2.0], [-0.6, 3.4]][i];
      m.script = playerLag > 20 && m.id === 'bima' ? { face: g.player.pos } : { target: { x: lead.x + off[0], z: lead.z - 1 - off[1] }, speed: 1.35 };
    });
    if (bima.pos.z >= 45.5 || this.t > 90) this.setPhase('stop');
  }

  phase_stop() {
    const g = this.game;
    const sq = g.squad;
    const sky = { x: 300, z: 20 };
    this.at(0, () => {
      for (const m of sq.members) m.script = { mode: 'lookUp', face: sky };
      this.line('lookUp', 0);
      this.objective('');
      this.spawnJets();
    });
    this.at(3.4, () => {
      this.line('run', 0);
      this.sirens = [g.audio.loop('air_siren', { pos: { x: 0, y: 30, z: -16 }, gain: 2.2, ref: 30 }), g.audio.loop('air_siren', { pos: { x: 0, y: 20, z: 115 }, gain: 1.6, ref: 30 })];
      this.panicLoop = g.audio.loop('panic', { pos: { x: 25, y: 1, z: 30 }, gain: 1.2, ref: 10 });
      g.civilians.startPanic();
      for (let i = 0; i < 4; i++) g.audio.play('beep', { pos: { x: 30, y: 1, z: 30 + i * 12 }, freq: 410, len: 0.6, delay: i * 0.3 });
      this.cityLoop?.stop(2);
    });
    this.at(6, () => { this.objective('What are they looking at? Look up.'); g.ui.hint('Look up at the sky (move the mouse)', 6); });
    this.at(8, () => this.line('panic', 0));
    // Reveal: the player looks toward the formation.
    const jet = this.aircraft.find((a) => a.kind === 'jet');
    if (jet && !this.revealed) {
      const f = g.player.forward();
      const dir = jet.mesh.position.clone().sub(g.camera.position).normalize();
      if (f.dot(dir) > 0.82 && g.player.pitch > 0.15) this.reveal();
      else if (this.t > 18) this.reveal();
    }
    if (this.revealed) this.setPhase('run');
  }

  reveal() {
    const g = this.game;
    this.revealed = true;
    this.line('panic', 1);
    g.ui.hint('', 0);
    this.spawnHelicopters();
    for (const a of this.aircraft) a.sound?.setGain(a.kind === 'jet' ? 2.6 : 2.0, 1);
    g.player.trauma = Math.max(g.player.trauma, 0.25);
  }

  phase_run() {
    const g = this.game;
    const sq = g.squad;
    this.at(0, () => {
      this.objective('RUN! Follow your squad.');
      sq.members.forEach((m, i) => { m.script = { target: { x: 31 + (i - 1.5) * 1.6, z: 72 + i }, speed: 4.6, run: true }; });
    });
    this.at(4.5, () => {
      // The attackers pull out of the area before the charges go off.
      for (const a of this.aircraft) a.withdraw = true;
      g.audio.say('Rizky', 'Why are they turning back...?', null, teammate('rizky').voice, { pos: sq.get('rizky').pos });
    });
    this.at(8.5, () => this.setPhase('blast'));
  }

  phase_blast(dt) {
    const g = this.game;
    const P = g.player.pos;
    this.at(0, () => {
      this.objective('');
      const targets = pickBlastTargets(g.L, P.x, P.z, g.player.yaw);
      g.world.blast = targets;
      targets.forEach((t, i) => setTimeout(() => this.detonate(t), i * 140));
      g.city.shatterAll();
      g.ui.flash(1, 1.4);
      g.sky.flash = 1;
      g.player.trauma = 1;
      g.audio.muffle(0.88, 0.25);
      setTimeout(() => g.audio.ringing(1, 0.5), 350);
      g.audio.setMuffledVoices(true);
      for (const s of this.sirens || []) s.setGain(0.5, 0.5);
      g.damagePlayer(28, { kind: 'blast', part: 'torso', silent: true });
      this.knock = 0;
      // Glass from every window around.
      for (let i = 0; i < 10; i++) g.particles.emit('glass', P.x + (Math.random() - 0.5) * 30, 4 + Math.random() * 8, P.z + (Math.random() - 0.5) * 30, 14);
      g.audio.play('glass', { pos: { x: P.x + 5, y: 4, z: P.z }, gain: 1.4 });
      g.audio.play('glass', { pos: { x: P.x - 6, y: 6, z: P.z + 4 }, gain: 1.2, delay: 0.2 });
      this.toppleLamps(P);
    });
    // Knocked off your feet.
    g.player.knockdown = clamp(this.t / 0.7, 0, 1);
    g.player.roll = 0.55;
    g.player.frozen = true;
    g.player.lookOnly = false;
    g.sky.flash = Math.max(0, 1 - this.t * 1.5);
    g.ui.setDamageOverlay({ red: clamp(this.t / 2, 0, 0.75), dust: clamp(this.t / 1.5, 0, 0.9), blur: clamp(this.t * 2.5, 0, 6) });
    this.at(0.4, () => g.audio.play('collapse', { pos: { x: P.x + 20, y: 5, z: P.z }, gain: 1.6 }));
    this.at(1.5, () => g.audio.play('collapse', { pos: { x: P.x - 15, y: 5, z: P.z + 10 }, gain: 1.4 }));
    this.at(1.0, () => g.audio.play('debris', { gain: 1.2 }));
    this.at(1.2, () => { for (let i = 0; i < 6; i++) g.particles.emit('dust', P.x + (Math.random() - 0.5) * 20, 1.5, P.z + (Math.random() - 0.5) * 20, 10, { scale: 1.3 }); });
    this.at(3.4, () => g.ui.fade(1, 1.2));
    this.updateCollapses(dt);
    if (this.t > 4.8) this.setPhase('blackout');
  }

  detonate(t) {
    const g = this.game;
    const b = t.building ? g.L.buildings.find((k) => k.id === t.building) : null;
    const P = g.player.pos;
    let x = t.x;
    let z = t.z;
    let y = 1.2;
    if (b) {
      // Blast at the facade facing the player.
      x = clamp(P.x, b.x0, b.x1);
      z = clamp(P.z, b.z0, b.z1);
      y = 5 + Math.random() * 6;
      const pivot = g.city.dynamic.get(b.id);
      if (pivot) this.collapses = [...(this.collapses || []), { pivot, t: 0, h: b.h, dir: Math.random() < 0.5 ? -1 : 1, axis: b.side === 'n' || b.side === 's' ? 'x' : 'z', x, z }];
    }
    g.particles.explosion(x, y, z, 1.6);
    g.particles.emit('dust', x, 1, z, 30, { spread: 10, scale: 1.4 });
    g.particles.emitter('smoke', x, y, z, 6, { spread: 4, maxDist: 400 });
    g.audio.play('explosion', { pos: { x, y, z }, gain: 2.2, big: true, ref: 25, noDelay: true });
    this.shockwave(x, y, z);
    g.particles.debris.burst(x, y, z, 50, 18);
  }

  shockwave(x, y, z) {
    const g = this.game;
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12), new THREE.MeshBasicMaterial({ color: '#fff3d8', transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide }));
    mesh.position.set(x, y, z);
    g.scene.add(mesh);
    this.waves = [...(this.waves || []), { mesh, t: 0 }];
  }

  toppleLamps(P) {
    const g = this.game;
    this.falling = [];
    for (const { l, i } of g.props.lampsNear(P.x, P.z, 28).slice(0, 4)) {
      g.props.hideLamp(i);
      const mesh = new THREE.Mesh(Props.lampGeometry(), M.std('#ffffff', 0.5, 0.5, { vertexColors: true }));
      mesh.position.set(l.x, 0, l.z);
      mesh.rotation.y = l.yaw;
      g.scene.add(mesh);
      this.falling.push({ mesh, t: -Math.random() * 0.5, dir: Math.random() < 0.5 ? -1 : 1 });
    }
  }

  updateCollapses(dt) {
    for (const c of this.collapses || []) {
      c.t += dt;
      if (c.t < 0.6) {
        c.pivot.position.x += (Math.random() - 0.5) * 0.08;
        c.pivot.position.z += (Math.random() - 0.5) * 0.08;
      } else {
        const k = Math.min(1, (c.t - 0.6) / 3);
        c.pivot.position.y = -c.h * 0.7 * k * k;
        c.pivot.rotation[c.axis] = c.dir * 0.22 * k;
        if (Math.random() < 0.3) this.game.particles.emit('dust', c.x + (Math.random() - 0.5) * 8, 1, c.z + (Math.random() - 0.5) * 8, 2, { scale: 1.2 });
      }
    }
    for (const f of this.falling || []) {
      f.t += dt;
      if (f.t > 0) f.mesh.rotation.z = f.dir * Math.min(Math.PI / 2 - 0.05, (f.t * f.t) * 2.2);
    }
    for (const w of this.waves || []) {
      w.t += dt;
      w.mesh.scale.setScalar(1 + w.t * 90);
      w.mesh.material.opacity = Math.max(0, 0.35 - w.t * 0.7);
      w.mesh.visible = w.mesh.material.opacity > 0;
    }
  }

  phase_blackout() {
    const g = this.game;
    this.at(0, () => {
      g.player.frozen = true;
      g.ui.fade(1, 0);
      g.ui.setDamageOverlay({ red: 0.25, dust: 0, blur: 0 });
    });
    this.at(0.4, () => {
      // Rebuild the world as it is after the strike, out of sight.
      for (const w of this.waves || []) g.scene.remove(w.mesh);
      for (const f of this.falling || []) g.scene.remove(f.mesh);
      for (const a of this.aircraft) { g.scene.remove(a.mesh); a.sound?.stop(1); }
      this.aircraft = [];
      this.panicLoop?.stop(2);
      this.windLoop?.stop(2);
      g.civilians.clear();
      g.enterRuins(true);
    });
    for (let k = 0; k < 12; k++) this.at(1 + k * 1.1, () => g.audio.play('heartbeat', { bus: 'ui', gain: 0.9 }));
    this.at(2.5, () => g.audio.play('collapse', { pos: { x: g.player.pos.x + 40, y: 4, z: g.player.pos.z - 20 }, gain: 1 }));
    this.at(3, () => this.line('blackout', 0));
    this.at(6.5, () => this.line('blackout', 1));
    this.at(8, () => { this.sirenFar = g.audio.loop('martinshorn', { pos: { x: g.player.pos.x - 120, y: 3, z: g.player.pos.z + 60 }, gain: 1.4, ref: 30 }); });
    this.at(10, () => this.line('blackout', 2));
    this.at(11.5, () => g.audio.play('debris', { pos: { x: g.player.pos.x + 12, y: 3, z: g.player.pos.z }, gain: 0.8 }));
    if (this.t > 13.5) this.setPhase('wake');
  }

  phase_wake() {
    const g = this.game;
    this.at(0, () => {
      g.ui.fade(0, 6);
      g.audio.muffle(0, 12);
      g.audio.ringing(0, 7);
      g.audio.setMuffledVoices(false);
      for (const s of this.sirens || []) s.stop(1);
      this.sirenFar?.setGain(0.5, 10);
      this.ruinWind = g.audio.loop('wind', { bus: 'amb', gain: 0.45 });
      g.startAmbience();
      g.ui.titleCard('DAY 1 — THE DISASTER', '11:47 · Kreuzhafen is in ruins.');
    });
    const k = clamp((this.t - 3) / 3.5, 0, 1);
    g.player.knockdown = 1 - k * k * (3 - 2 * k);
    g.player.roll = 0.55 * (1 - k);
    g.ui.setDamageOverlay({ red: lerp(0.45, 0, clamp(this.t / 9, 0, 1)), dust: lerp(0.5, 0, clamp(this.t / 7, 0, 1)), blur: lerp(5, 0, clamp(this.t / 8, 0, 1)) });
    if (this.t > 1.5) { g.player.frozen = true; g.player.lookOnly = true; }
    if (this.t > 6.5) {
      g.ui.setDamageOverlay({ red: 0, dust: 0, blur: 0 });
      g.player.frozen = false;
      g.player.lookOnly = false;
      g.player.knockdown = 0;
      this.sirenFar?.stop(8);
      this.setPhase('done');
      g.prologueFinished();
    }
  }

  // --- Aircraft --------------------------------------------------------------------
  spawnJets() {
    const g = this.game;
    const V = [[0, 0], [-25, 18], [25, 18], [-50, 36], [50, 36], [-75, 54], [75, 54], [0, 60]];
    V.forEach(([ox, oz], i) => {
      const mesh = buildJet();
      // Flying west (-X) at 170 m altitude, starting far to the east.
      mesh.position.set(900 + oz * 2, 170 + (i % 3) * 8, 40 + ox);
      mesh.rotation.y = Math.PI / 2;
      g.scene.add(mesh);
      const sound = i === 0 ? g.audio.loop('jet', { pos: mesh.position, gain: 0.8, ref: 60, rolloff: 0.8 }) : null;
      this.aircraft.push({ kind: 'jet', mesh, vel: new THREE.Vector3(-65, 0, 0), sound });
    });
  }

  spawnHelicopters() {
    const g = this.game;
    for (let i = 0; i < 5; i++) {
      const mesh = buildHelicopter('attack');
      mesh.position.set(380 + i * 30, 85 + i * 6, -260 + i * 40);
      g.scene.add(mesh);
      const dir = new THREE.Vector3(-1, 0, 0.9).normalize();
      mesh.rotation.y = Math.atan2(-dir.x, -dir.z);
      const sound = i < 2 ? g.audio.loop('heli', { pos: mesh.position, gain: 1.5, ref: 30 }) : null;
      this.aircraft.push({ kind: 'heli', mesh, vel: dir.multiplyScalar(42), sound });
    }
  }

  updateAircraft(dt) {
    for (const a of this.aircraft) {
      if (a.withdraw) {
        // Bank away and climb out of the strike zone.
        const target = a.kind === 'jet' ? new THREE.Vector3(-30, 25, -60) : new THREE.Vector3(30, 4, -40);
        a.vel.lerp(target, dt * 0.6);
      }
      a.mesh.position.addScaledVector(a.vel, dt);
      const yaw = Math.atan2(-a.vel.x, -a.vel.z);
      a.mesh.rotation.y = damp(a.mesh.rotation.y, yaw, 2, dt);
      if (a.withdraw) a.mesh.rotation.z = damp(a.mesh.rotation.z, a.kind === 'jet' ? 0.7 : 0.25, 2, dt);
      if (a.mesh.userData.rotor) a.mesh.userData.rotor.rotation.y += dt * 28;
      if (a.mesh.userData.tailRotor) a.mesh.userData.tailRotor.rotation.x += dt * 40;
      a.sound?.setPos(a.mesh.position);
    }
  }

  // --- Shops ------------------------------------------------------------------------
  shopAt(interiorId) {
    const it = this.game.L.interiors.find((i) => i.id === interiorId);
    return it && SHOPS[it.type] ? { key: it.type, ...SHOPS[it.type] } : null;
  }
}
