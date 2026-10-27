// The four teammates of Elang-7: rescue states, clues, orders, needs and AI.

import * as THREE from 'three';
import { TEAMMATES } from '../data/teammates.js';
import { Character } from '../world/character.js';
import * as M from '../world/materials.js';
import { Props } from '../world/props.js';
import {
  createVitals, addInjury, tickVitals, treat, condition, activeInjuries, hasInjury, movementFactor, consume, usefulTreatments,
} from './survival.js';
import { ITEMS } from '../data/items.js';
import { damp, dampAngle, yawTo, makeRng, clamp } from '../core/util.js';
import { insideInterior } from '../world/collision.js';

const FORMATION = [[-1.6, 2.2], [1.6, 2.4], [-0.6, 3.8], [1.0, 4.4]];

export class Teammate {
  constructor(game, def, index) {
    this.game = game;
    this.def = def;
    this.id = def.id;
    this.index = index;
    this.vitals = createVitals();
    this.status = 'prologue';
    this.order = 'follow';
    this.trapped = null;
    this.pos = new THREE.Vector3();
    this.yaw = 0;
    this.mode = 'idle';
    this.path = null;
    this.pathGoal = null;
    this.repath = 0;
    this.callTimer = 8 + index * 6;
    this.radioTimer = 30 + index * 20;
    this.requestTimer = 60;
    this.lineCooldown = 0;
    this.dangerCooldown = 0;
    this.fireTimer = 1;
    this.knownArea = null;
    this.exact = false;
    this.sheltered = false;
    this.critical = 0;
    this.healTimer = 60;
    this.char = new Character(def.look, { weapon: def.weapon });
    this.char.root.name = def.name;
    game.scene.add(this.char.root);
    this.props = [];
    this.stuck = 0;
    this.lastPos = new THREE.Vector3();
  }

  get name() { return this.def.short; }
  get alive() { return this.status !== 'dead'; }

  canWalk() {
    const v = this.vitals;
    return !this.trapped && !hasInjury(v, 'unconscious') && !hasInjury(v, 'bleeding_severe')
      && !activeInjuries(v).some((i) => i.type === 'fracture');
  }

  seriouslyInjured() {
    return activeInjuries(this.vitals).some((i) => ['bleeding_severe', 'bleeding_minor', 'fracture', 'unconscious', 'infection'].includes(i.type));
  }

  say(kind, opts = {}) {
    const lines = this.def.lines[kind];
    if (!lines || !this.alive) return;
    const line = lines[Math.floor(Math.random() * lines.length)];
    const radio = opts.radio ?? line.radio;
    this.game.audio.say(`${radio ? '[Radio] ' : ''}${this.def.short}`, line.t, line.s, this.def.voice, { pos: radio ? null : this.pos, radio, shout: line.shout });
    this.lineCooldown = 6;
  }

  setPose() {
    if (this.status === 'dead') { this.mode = 'dead'; return; }
    if (this.trapped) { this.mode = 'trapped'; return; }
    if (hasInjury(this.vitals, 'unconscious')) { this.mode = 'lying'; return; }
  }

  serialize() {
    return {
      id: this.id, vitals: this.vitals, status: this.status, order: this.order, trapped: this.trapped, pos: [this.pos.x, this.pos.y, this.pos.z], yaw: this.yaw,
      knownArea: this.knownArea, exact: this.exact, sheltered: this.sheltered, critical: this.critical,
    };
  }

  restore(s) {
    Object.assign(this, { vitals: s.vitals, status: s.status, order: s.order, trapped: s.trapped, yaw: s.yaw, knownArea: s.knownArea, exact: s.exact, sheltered: s.sheltered, critical: s.critical });
    this.pos.set(...s.pos);
  }
}

export class Squad {
  constructor(game) {
    this.game = game;
    this.members = TEAMMATES.map((d, i) => new Teammate(game, d, i));
    this.chatTimer = 40;
    this.rng = makeRng('squad');
  }

  get(id) { return this.members.find((m) => m.id === id); }

  // Opening: everyone healthy, walking with the player.
  setupPrologue(spawn) {
    this.members.forEach((m, i) => {
      m.status = 'prologue';
      m.vitals = createVitals();
      const [ox, oz] = FORMATION[i];
      m.pos.set(spawn.x + ox + 1, 0, spawn.z + oz - 2);
      m.yaw = spawn.yaw;
      m.char.setWeapon(m.def.weapon, 'slung');
    });
  }

  // After the strike: scattered, injured, some trapped or unconscious.
  scatter() {
    const L = this.game.L;
    for (const m of this.members) {
      const spot = L.teammateSpots[m.id];
      const st = m.def.start;
      m.status = 'missing';
      m.order = 'follow';
      m.vitals = createVitals({ health: st.health, hunger: 20, thirst: 25 });
      for (const [type, part] of st.injuries) addInjury(m.vitals, type, part);
      if (st.unconscious) addInjury(m.vitals, 'unconscious', 'head');
      m.trapped = st.trapped;
      m.critical = st.critical;
      m.pos.set(spot.x, 0, spot.z);
      m.yaw = this.rng() * Math.PI * 2;
      m.knownArea = null;
      m.exact = false;
      m.sheltered = false;
      m.char.setWeapon(m.def.weapon, 'slung');
    }
    this.buildTrapProps();
  }

  buildTrapProps() {
    for (const m of this.members) {
      for (const p of m.props) this.game.scene.remove(p);
      m.props = [];
      if (m.trapped === 'lamp') {
        const lamp = new THREE.Mesh(Props.lampGeometry(), M.std('#ffffff', 0.5, 0.5, { vertexColors: true }));
        lamp.position.set(m.pos.x - 3.2, 0.25, m.pos.z + 0.3);
        lamp.rotation.set(0, Math.PI / 2 + 0.15, Math.PI / 2 - 0.05);
        this.game.scene.add(lamp);
        m.props.push(lamp);
      } else if (m.trapped === 'slab') {
        const slab = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.35, 2.2), M.surface('concrete'));
        slab.position.set(m.pos.x, 0.42, m.pos.z - 0.4);
        slab.rotation.set(0.12, m.yaw, 0.08);
        slab.castShadow = true;
        this.game.scene.add(slab);
        const chunk = new THREE.Mesh(new THREE.DodecahedronGeometry(0.6, 0), M.surface('rubble'));
        chunk.position.set(m.pos.x + 1.3, 0.3, m.pos.z - 0.8);
        this.game.scene.add(chunk);
        m.props.push(slab, chunk);
      }
    }
  }

  // Learning roughly where someone is.
  hint(m, r, text) {
    if (m.status !== 'missing' || m.exact) return;
    const off = m.knownArea && m.knownArea.r <= r ? null : { x: m.pos.x + (this.rng() - 0.5) * r, z: m.pos.z + (this.rng() - 0.5) * r };
    if (off) m.knownArea = { x: off.x, z: off.z, r };
    if (text) this.game.toast(text, 'clue');
    this.game.journal(text || `Clue: ${m.name} is somewhere near the marked area.`, 'clue');
  }

  locate(m, how = 'found') {
    if (m.exact || !m.alive) return;
    m.exact = true;
    m.knownArea = { x: m.pos.x, z: m.pos.z, r: 4 };
    if (m.status === 'missing') m.status = 'located';
    const g = this.game;
    if (how === 'found') {
      if (hasInjury(m.vitals, 'unconscious')) g.toast(`${m.name} is unconscious. A first aid kit could revive them.`, 'info');
      else m.say('found');
      g.playerSay('found');
    } else if (how === 'drone') g.toast(`Drone spotted ${m.name}. Location marked on the map.`, 'clue');
    g.journal(`Found ${m.def.rank} ${m.def.name} (${g.L.teammateSpots[m.id].label}).`, 'milestone');
  }

  // --- Interactions ---------------------------------------------------------------
  interactables() {
    const out = [];
    const g = this.game;
    for (const m of this.members) {
      if (m.status === 'prologue') continue;
      const base = { x: m.pos.x, y: 0.6, z: m.pos.z, r: 2.4, owner: m };
      if (m.status === 'dead') continue;
      if (m.trapped) {
        const slab = m.trapped === 'slab';
        const tool = slab ? (g.inv.has('car_jack') ? 'car_jack' : g.inv.has('crowbar') ? 'crowbar' : null) : 'hands';
        out.push({
          ...base, id: `free:${m.id}`,
          label: tool ? `Free ${m.name}${slab ? ` with the ${tool === 'car_jack' ? 'hydraulic jack' : 'crowbar'}` : ''}` : `${m.name} is pinned under a concrete slab - you need a jack or a crowbar`,
          disabled: !tool,
          hold: tool ? (slab ? (tool === 'car_jack' ? 5 : 9) : 3) / g.stats.debrisSpeed : 0,
          noise: slab ? 10 : 6,
          action: () => this.free(m),
        });
        continue;
      }
      if (m.status === 'missing' || m.status === 'located') {
        out.push({ ...base, id: `treat:${m.id}`, label: `Treat ${m.name}${hasInjury(m.vitals, 'unconscious') ? ' (unconscious)' : ''}`, hold: 0, action: () => g.ui.openTreat(m) });
        continue;
      }
      if (m.status === 'rescued') out.push({ ...base, id: `talk:${m.id}`, label: `Talk to ${m.name}`, hold: 0, action: () => g.ui.openTeammate(m) });
    }
    return out;
  }

  free(m) {
    const g = this.game;
    m.trapped = null;
    for (const p of m.props) g.scene.remove(p);
    m.props = [];
    if (!m.exact) this.locate(m);
    m.say('freed');
    g.audio.play('scrape', { pos: m.pos });
    g.journal(`Freed ${m.name} from the wreckage.`, 'milestone');
    this.checkRescued(m);
  }

  // Applies a treatment item from the player's inventory.
  applyTreatment(m, itemId) {
    const g = this.game;
    if (itemId === 'improvised_splint') {
      g.inv.remove('plank');
      g.inv.remove(g.inv.has('duct_tape') ? 'duct_tape' : 'bandage');
    } else g.inv.remove(itemId);
    const treated = treat(m.vitals, itemId, g.stats.healBonus);
    g.audio.play('bandage', { pos: m.pos });
    if (treated === 'unconscious') {
      g.journal(`${m.name} regained consciousness.`, 'milestone');
      setTimeout(() => m.say('found'), 1500);
    }
    this.checkRescued(m);
    return treated;
  }

  checkRescued(m) {
    const g = this.game;
    if (m.status === 'rescued' || m.status === 'dead') return;
    if (!m.canWalk()) return;
    m.status = 'rescued';
    m.order = 'follow';
    m.exact = true;
    m.char.setWeapon(m.def.weapon, 'ready');
    setTimeout(() => m.say('treated'), 600);
    g.journal(`${m.def.rank} ${m.def.name} is rescued and can move with you.`, 'milestone');
    g.toast(`${m.name} rescued`, 'good');
    g.stats.rescued = (g.stats.rescued || 0) + 1;
    if (m.id === 'bima' && !g.inv.has('emergency_card')) {
      g.inv.add('emergency_card');
      g.toast('Bima hands you the unit\'s emergency contact card.', 'clue');
    }
    if (m.id === 'dimas') g.toast('Dimas knows the Central Command number by heart.', 'clue');
  }

  give(m, itemId) {
    const g = this.game;
    if (!g.inv.has(itemId)) return null;
    g.inv.remove(itemId);
    const r = consume(m.vitals, ITEMS[itemId]);
    g.audio.play(ITEMS[itemId].cat === 'water' ? 'drink' : 'eat', { pos: m.pos });
    setTimeout(() => m.say('thanks'), 900);
    return r;
  }

  setOrder(m, order) {
    m.order = order;
    m.sheltered = false;
    m.path = null;
    m.say(order);
    this.game.playerSay(order);
  }

  // --- Update -----------------------------------------------------------------
  update(dt) {
    const g = this.game;
    const P = g.player.pos;
    this.chatTimer -= dt;
    for (const m of this.members) {
      m.lineCooldown -= dt;
      m.dangerCooldown -= dt;
      const dist = Math.hypot(m.pos.x - P.x, m.pos.z - P.z);
      if (m.status === 'prologue') this.updateScripted(m, dt);
      else if (m.status === 'missing' || m.status === 'located') this.updateWaitingForRescue(m, dt, dist);
      else if (m.status === 'rescued') this.updateRescued(m, dt, dist);
      m.setPose();
      // Visibility LOD.
      m.char.root.visible = dist < 220;
      m.char.setDetailVisible(dist < 30);
      m.char.root.position.copy(m.pos);
      m.char.root.rotation.y = m.yaw;
      if (m.char.root.visible) m.char.animate(dt, { mode: m.mode, speed: m.speed || 0, aiming: m.aiming, lookPitch: m.lookPitch || 0, wave: m.wave || 0 });
    }
    this.chatter();
  }

  updateScripted(m, dt) {
    const s = m.script || {};
    if (s.target) {
      const moved = this.moveToward(m, s.target, s.speed || 1.4, dt, s.run ? 'run' : 'walk');
      if (!moved) m.mode = s.mode || 'idle';
    } else {
      m.mode = s.mode || 'idle';
      m.speed = 0;
    }
    if (s.face) m.yaw = dampAngle(m.yaw, yawTo(m.pos.x, m.pos.z, s.face.x, s.face.z) + Math.PI, 4, dt);
    m.lookPitch = s.mode === 'lookUp' ? 0.6 : 0;
  }

  updateWaitingForRescue(m, dt, dist) {
    const g = this.game;
    const v = m.vitals;
    m.speed = 0;
    m.wave = m.trapped && dist < 40 ? 1 : 0;
    if (!m.trapped && !hasInjury(v, 'unconscious')) m.mode = 'sitting';
    // Found by seeing them up close.
    if (!m.exact && dist < 9 && g.canSee(m.pos.x, 0.8, m.pos.z)) this.locate(m);
    const conscious = !hasInjury(v, 'unconscious');
    // Calling for help.
    m.callTimer -= dt;
    if (conscious && m.callTimer <= 0) {
      m.callTimer = 22 + this.rng() * 22;
      if (dist < 60) {
        const line = m.def.lines.help.find((l) => !l.radio) || m.def.lines.help[0];
        g.audio.say(m.def.short, line.t, line.s, m.def.voice, { pos: m.pos, shout: true });
        if (!m.exact) this.hint(m, dist < 25 ? 14 : 26, dist < 25 ? null : `Someone is shouting for help to the ${g.directionTo(m.pos)}.`);
      }
    }
    // Radio transmissions reach you if you carry a radio.
    m.radioTimer -= dt;
    const radioRange = g.stats.radioRange;
    if (m.radioTimer <= 0) {
      m.radioTimer = 70 + this.rng() * 50;
      const radioLine = m.def.lines.help.find((l) => l.radio);
      if (radioLine && m.def.look.radio !== 'none' && radioRange > 0 && dist < radioRange && !m.exact) {
        g.audio.say(`[Radio] ${m.def.short}`, radioLine.t, radioLine.s, m.def.voice, { radio: true });
        this.hint(m, dist < radioRange * 0.5 ? 30 : 45, `Radio: ${m.name}'s transmission came from the ${g.directionTo(m.pos)}.`);
      }
    }
  }

  updateRescued(m, dt, dist) {
    const g = this.game;
    const P = g.player.pos;
    const threat = g.enemies.threatNear(m.pos, 40);
    m.aiming = false;
    if (threat && m.dangerCooldown <= 0 && m.lineCooldown <= 0) { m.say('danger'); m.dangerCooldown = 25; }
    // Engage visible enemies when following or holding.
    if (threat && m.order !== 'shelter' && threat.visible) {
      m.yaw = dampAngle(m.yaw, yawTo(m.pos.x, m.pos.z, threat.enemy.pos.x, threat.enemy.pos.z) + Math.PI, 8, dt);
      m.mode = 'crouch';
      m.speed = 0;
      m.aiming = true;
      m.fireTimer -= dt;
      if (m.fireTimer <= 0) {
        m.fireTimer = 1.4 + this.rng() * 1.8;
        g.enemies.teammateShoots(m, threat.enemy);
      }
      return;
    }
    if (m.order === 'follow') {
      const [ox, oz] = FORMATION[m.index];
      const s = Math.sin(g.player.yaw);
      const c = Math.cos(g.player.yaw);
      const target = { x: P.x + ox * c + oz * s, z: P.z - ox * s + oz * c };
      const far = dist > 3.2;
      if (far) this.moveToward(m, target, dist > 10 ? 4.4 : 2.8, dt, dist > 10 ? 'run' : 'walk');
      else {
        m.speed = 0;
        m.mode = threat ? 'crouch' : 'idle';
        m.yaw = dampAngle(m.yaw, g.player.yaw, 2, dt);
      }
      // Teleport catch-up if hopelessly far (e.g. you climbed the tower).
      if (dist > 90 && !g.canSee(m.pos.x, 1.2, m.pos.z)) m.order = 'wait';
    } else if (m.order === 'shelter') {
      const sh = g.shelterSpot(m.index);
      if (!sh) { m.order = 'wait'; return; }
      const d = Math.hypot(sh.x - m.pos.x, sh.z - m.pos.z);
      if (d > 1.2) { this.moveToward(m, sh, 2.6, dt, 'walk'); m.sheltered = false; } else {
        m.sheltered = true;
        m.speed = 0;
        m.mode = movementFactor(m.vitals) < 0.9 || m.vitals.health < 60 || g.darkness > 0.6 ? 'sitting' : 'idle';
        this.shelterCare(m, dt);
      }
    } else {
      m.speed = 0;
      m.mode = threat ? 'crouch' : 'idle';
    }
    // Asking for things.
    m.requestTimer -= dt;
    if (m.requestTimer <= 0 && dist < 15 && m.lineCooldown <= 0) {
      m.requestTimer = 90 + this.rng() * 60;
      const v = m.vitals;
      if (activeInjuries(v).length) m.say('pain');
      else if (v.thirst > 70) m.say('thirsty');
      else if (v.hunger > 70) m.say('hungry');
    }
  }

  // At the shelter teammates eat and drink from the stash, and the medic treats people.
  shelterCare(m, dt) {
    const g = this.game;
    m.healTimer -= dt;
    if (m.healTimer > 0) return;
    m.healTimer = 30;
    const stash = g.stash;
    const v = m.vitals;
    if (v.thirst > 45) {
      const drink = ['water_large', 'water_small', 'juice', 'cola'].find((id) => stash.count(id) > 0);
      if (drink) { stash.remove(drink); consume(v, ITEMS[drink]); }
    }
    if (v.hunger > 45) {
      const food = ['mre', 'canned_soup', 'canned_beans', 'bread', 'crackers', 'energy_bar', 'pretzel', 'chocolate', 'apple'].find((id) => stash.count(id) > 0);
      if (food) { stash.remove(food); consume(v, ITEMS[food]); }
    }
    const sari = this.get('sari');
    if (m.id === 'sari' && sari.status === 'rescued' && sari.sheltered) {
      // The medic treats the worst injury in the shelter with stash supplies.
      for (const other of this.members) {
        if (other.status !== 'rescued' || !other.sheltered) continue;
        const available = stash.stacks.map((s) => s.id).filter((id) => ITEMS[id].cat === 'medical');
        const use = usefulTreatments(other.vitals, available)[0];
        if (use) {
          stash.remove(use);
          treat(other.vitals, use, 1.5);
          g.journal(`Sari treated ${other.id === 'sari' ? 'herself' : other.name} with a ${ITEMS[use].name.toLowerCase()} from the stash.`, 'note');
          break;
        }
      }
    }
  }

  // Path-following movement. Returns false when arrived.
  moveToward(m, target, speed, dt, gait) {
    const g = this.game;
    const dx = target.x - m.pos.x;
    const dz = target.z - m.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.6) { m.speed = 0; return false; }
    m.repath -= dt;
    if (!m.path || m.repath <= 0 || !m.pathGoal || Math.hypot(m.pathGoal.x - target.x, m.pathGoal.z - target.z) > 2.5) {
      m.repath = 1.2 + Math.random() * 0.5;
      m.pathGoal = { x: target.x, z: target.z };
      m.path = g.nav.findPath(m.pos.x, m.pos.z, target.x, target.z, 25000) || [{ x: target.x, z: target.z }];
    }
    let wp = m.path[0];
    while (wp && Math.hypot(wp.x - m.pos.x, wp.z - m.pos.z) < 0.5 && m.path.length > 1) { m.path.shift(); wp = m.path[0]; }
    if (!wp) wp = target;
    const mf = movementFactor(m.vitals);
    const sp = speed * Math.max(0.35, mf);
    const wx = wp.x - m.pos.x;
    const wz = wp.z - m.pos.z;
    const wd = Math.hypot(wx, wz) || 1;
    const step = Math.min(wd, sp * dt);
    const p = { x: m.pos.x + (wx / wd) * step, y: 0, z: m.pos.z + (wz / wd) * step };
    // Separation from the other teammates and the player.
    for (const o of this.members) {
      if (o === m) continue;
      const ox = p.x - o.pos.x;
      const oz = p.z - o.pos.z;
      const od = Math.hypot(ox, oz);
      if (od < 0.8 && od > 0.001) { p.x += (ox / od) * (0.8 - od) * 0.5; p.z += (oz / od) * (0.8 - od) * 0.5; }
    }
    g.cw.move(p, 0, 0, 0.3, 1.7);
    m.pos.x = p.x;
    m.pos.z = p.z;
    m.pos.y = g.cw.groundHeight(m.pos.x, m.pos.z, m.pos.y + 0.3);
    m.yaw = dampAngle(m.yaw, Math.atan2(-wx, -wz), 8, dt);
    m.speed = sp;
    m.mode = mf < 0.7 ? 'limp' : gait;
    // Unstick.
    if (m.pos.distanceTo(m.lastPos) < sp * dt * 0.1) m.stuck += dt; else m.stuck = 0;
    m.lastPos.copy(m.pos);
    if (m.stuck > 2.5) {
      m.stuck = 0;
      const i = g.nav.nearestWalkable(m.pos.x + (Math.random() - 0.5) * 2, m.pos.z + (Math.random() - 0.5) * 2, 4);
      if (i >= 0) { const c = g.nav.center(i); m.pos.x = c.x; m.pos.z = c.z; }
      m.path = null;
    }
    return true;
  }

  // Slow in-game clock effects (minutes of game time).
  tickNeeds(minutes, sleeping) {
    const g = this.game;
    for (const m of this.members) {
      if (m.status === 'prologue' || m.status === 'dead') continue;
      const v = m.vitals;
      if (m.status === 'rescued') {
        const before = v.health;
        const ev = tickVitals(v, minutes, { activity: sleeping ? 'sleep' : m.speed > 0 ? 'walk' : 'idle', sheltered: m.sheltered });
        // Teammates keep pressure on their own wounds: bleeding is slower.
        if (v.health < before && v.health > 0) v.health = before - (before - v.health) * 0.45;
        if (ev.includes('infection')) { g.toast(`${m.name}'s wound looks infected.`, 'warn'); g.journal(`${m.name} has an infected wound. Antibiotics needed.`, 'warn'); }
      } else {
        // Waiting for rescue: needs grow, condition slowly deteriorates.
        v.hunger = clamp(v.hunger + minutes * 0.06, 0, 100);
        v.thirst = clamp(v.thirst + minutes * 0.085, 0, 100);
        if (m.critical > 0) v.health -= (m.def.start.health / (m.critical * 60)) * minutes;
        if (v.thirst >= 100) v.health -= 0.1 * minutes;
      }
      if (v.health <= 0) this.kill(m);
    }
  }

  kill(m) {
    const g = this.game;
    if (m.status === 'dead') return;
    m.status = 'dead';
    m.vitals.health = 0;
    m.trapped = null;
    m.char.setWeapon(null);
    g.journal(`${m.def.rank} ${m.def.name} has died.`, 'death');
    g.toast(`${m.name} has died`, 'bad');
  }

  // Teammates talk to each other at the shelter.
  chatter() {
    if (this.chatTimer > 0) return;
    this.chatTimer = 50 + this.rng() * 50;
    const g = this.game;
    const near = this.members.filter((m) => m.status === 'rescued' && Math.hypot(m.pos.x - g.player.pos.x, m.pos.z - g.player.pos.z) < 14);
    if (near.length < 1) return;
    const a = near[Math.floor(this.rng() * near.length)];
    a.say(g.darkness > 0.6 ? 'night' : 'idle');
    const b = near.find((n) => n !== a);
    if (b) setTimeout(() => b.lineCooldown <= 0 && b.say('idle'), 5500);
  }

  facts() {
    const tm = {};
    for (const m of this.members) {
      tm[m.id] = {
        status: m.status === 'prologue' ? 'missing' : m.status, following: m.status === 'rescued' && m.order === 'follow', sheltered: m.sheltered,
        health: m.vitals.health, seriouslyInjured: m.seriouslyInjured(), condition: condition(m.vitals).label,
      };
    }
    return tm;
  }

  serialize() { return this.members.map((m) => m.serialize()); }

  restore(list) {
    for (const s of list || []) {
      const m = this.get(s.id);
      if (!m) continue;
      m.restore(s);
      m.char.setWeapon(m.status === 'dead' ? null : m.def.weapon, m.status === 'rescued' ? 'ready' : 'slung');
    }
    this.buildTrapProps();
  }

  insideShelter(m) {
    return insideInterior(this.game.L, m.pos.x, m.pos.z);
  }
}
