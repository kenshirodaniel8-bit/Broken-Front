// BROKEN FRONT - the game orchestrator. Owns the renderer, the world and
// every system, runs the main loop and connects the systems to the UI.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { generateLayout, streetNameAt, pickBlastTargets } from '../world/layout.js';
import { buildCollision, insideInterior, doorPoint } from '../world/collision.js';
import { NavGrid } from '../world/navgrid.js';
import { City } from '../world/city.js';
import { Props } from '../world/props.js';
import { Sky } from '../world/sky.js';
import { Particles } from '../world/particles.js';
import { Character, civilianConfig, civilianColors } from '../world/character.js';
import { setAnisotropy } from '../world/textures.js';
import * as M from '../world/materials.js';
import { buildHelicopter } from '../world/vehicles.js';
import { Input } from '../core/input.js';
import { makeRng, clamp, damp, formatClock, bearingDeg, yawTo } from '../core/util.js';
import { deriveStats, startingItems, sanitizeConfig, PLAYER_LINES, VOICE_PRESETS, VOICE_STYLES, VESTS } from '../data/customization.js';
import { ITEMS, WEAPONS } from '../data/items.js';
import { Inventory, Stash } from './inventory.js';
import {
  createVitals, tickVitals, applyDamage, consume, treat, addInjury, hasInjury, activeInjuries, condition, disorientation,
} from './survival.js';
import {
  createCampaign, advanceTime, updateObjectives, objectiveText, confirmRescue, computeEnding, extractionOpen, logEntry, DAYS, DISASTER_TIME,
} from './campaign.js';
import { createPhone, signalBars, devices, audioOk, drainPhone } from './phone.js';
import { Player } from './player.js';
import { Combat } from './combat.js';
import { Squad } from './squad.js';
import { Enemies } from './enemies.js';
import { Civilians } from './civilians.js';
import { Drone } from './drone.js';
import { Prologue } from './prologue.js';
import { Containers } from './containers.js';
import { MapState } from './mapstate.js';
import { SAVE_VERSION, writeSave, readSave } from './save.js';

export const QUALITY = {
  low: { pixelRatio: 0.7, shadows: 0, particles: 0.45, civilians: 12, viewDist: 150, antialias: false },
  medium: { pixelRatio: 1, shadows: 1, particles: 0.75, civilians: 20, viewDist: 220, antialias: true },
  high: { pixelRatio: 1.5, shadows: 2, particles: 1, civilians: 28, viewDist: 300, antialias: true },
};
export const DAY_SPEED = { short: 2.5, normal: 1.5, long: 1.0 };

export const DEFAULT_SETTINGS = {
  quality: 'medium', fov: 72, sensitivity: 1, invertY: false, master: 0.8, sfx: 0.9, voice: 1, ambience: 0.7,
  subtitles: true, tts: true, dayLength: 'normal', hints: true,
};

export class Game {
  constructor({ canvas, ui, audio, settings }) {
    this.canvas = canvas;
    this.ui = ui;
    this.audio = audio;
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
    this.quality = QUALITY[this.settings.quality] || QUALITY.medium;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: this.quality.antialias, powerPreference: 'high-performance' });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    setAnisotropy(Math.min(8, this.renderer.capabilities.getMaxAnisotropy()));
    this.scene = new THREE.Scene();
    this.scene.environment = new THREE.PMREMGenerator(this.renderer).fromScene(new RoomEnvironment(), 0.04).texture;
    this.camera = new THREE.PerspectiveCamera(this.settings.fov, 1, 0.05, 900);
    this.scene.add(this.camera);
    this.L = generateLayout();
    this.input = new Input(canvas);
    this.mode = 'menu';
    this.running = false;
    this.darkness = 0;
    this.smokes = [];
    this.world = { ruined: false, blast: [], collapsed: [], clearedDebris: [], extraCollapsed: [] };
    this.stats = deriveStats(sanitizeConfig({}));
    this.mapState = new MapState();
    this.applySettings();
    this.setupLights();
    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.input.onUnlock = () => { if (this.mode === 'play' && !this.ui.anyOpen()) this.ui.openPause(); };
  }

  // --- Setup --------------------------------------------------------------------
  setupLights() {
    this.flashlight = new THREE.SpotLight(0xfff3dd, 0, 45, 0.42, 0.45, 1.2);
    this.flashlight.position.set(0.15, -0.15, 0);
    this.flashlight.target.position.set(0, -0.6, -6);
    this.camera.add(this.flashlight);
    this.camera.add(this.flashlight.target);
    this.fireLights = [];
    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight(0xff7a2a, 0, 26, 1.6);
      this.scene.add(l);
      this.fireLights.push(l);
    }
    this.flareLight = new THREE.PointLight(0xff2a14, 0, 140, 1.4);
    this.scene.add(this.flareLight);
    this.muzzleLight = new THREE.PointLight(0xffb060, 0, 14, 2);
    this.scene.add(this.muzzleLight);
    // Lights used later in the campaign exist from the start (adding lights
    // at runtime would recompile every shader).
    this.heliSpot = new THREE.SpotLight(0xffffff, 0, 160, 0.22, 0.4, 1);
    this.scene.add(this.heliSpot);
    this.scene.add(this.heliSpot.target);
    this.shelterLight = new THREE.PointLight(0xffb070, 0, 9, 2);
    this.scene.add(this.shelterLight);
  }

  applySettings() {
    const s = this.settings;
    this.quality = QUALITY[s.quality] || QUALITY.medium;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.quality.pixelRatio));
    this.renderer.shadowMap.enabled = this.quality.shadows > 0;
    this.camera.fov = s.fov;
    this.camera.far = this.quality.viewDist + 200;
    this.camera.updateProjectionMatrix();
    this.input.sensitivity = s.sensitivity;
    this.input.invertY = s.invertY;
    this.audio.setVolumes({ master: s.master, sfx: s.sfx, voice: s.voice, ambience: s.ambience });
    this.audio.ttsEnabled = s.tts;
    this.audio.quality = s.quality === 'low' ? 'low' : 'high';
    if (this.sky) {
      this.sky.sun.castShadow = this.quality.shadows > 0;
    }
    this.resize();
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.combat?.setAspect(w / h);
    this.particles?.setViewport(h * this.renderer.getPixelRatio(), this.camera.fov);
  }

  // Builds (or rebuilds) the city for the current world state.
  buildWorld() {
    const ruined = this.world.ruined;
    const collapsed = new Set([
      ...(ruined ? this.L.buildings.filter((b) => b.collapse).map((b) => b.id) : []),
      ...this.world.blast.map((t) => t.building).filter(Boolean),
      ...this.world.extraCollapsed,
    ]);
    const state = { ruined, collapsed, clearedDebris: new Set(this.world.clearedDebris), blast: this.world.blast };
    if (!this.city) this.city = new City(this.scene, this.L);
    this.city.build(state);
    this.props = new Props(this.city.group, this.L, state);
    this.cw = buildCollision(this.L, state);
    for (const s of this.extraColliders || []) this.cw.add(s);
    this.nav = new NavGrid(this.cw);
    if (!this.sky) this.sky = new Sky(this.scene, this.quality);
    this.sky.setRuined(ruined);
    if (!this.particles) {
      this.particles = new Particles(this.scene, this.quality);
      this.resize();
    }
    this.particles.clearEmitters();
    this.fires = [];
    if (ruined) {
      for (const f of this.city.fires.concat((this.props.burningCars || []).filter((_, i) => i % 2 === 0))) {
        const e1 = this.particles.emitter('fire', f.x, f.y, f.z, 14 * (f.size || 1), { spread: 0.8, maxDist: 160 });
        const e2 = this.particles.emitter('smoke', f.x, f.y + 1, f.z, 2.2, { spread: 1, maxDist: 300 });
        const e3 = this.particles.emitter('ember', f.x, f.y + 0.5, f.z, 3, { spread: 1, maxDist: 60 });
        this.fires.push({ ...f, emitters: [e1, e2, e3] });
      }
      for (const s of this.city.smokes) this.particles.emitter('smoke', s.x, s.y, s.z, 1.6 * s.size, { spread: 3, maxDist: 420, scale: 1.4 });
    }
    this.ruined = ruined;
  }

  // --- New game / load ----------------------------------------------------------------
  // Leave to the main menu: stop the loop and clear everything dynamic.
  toMenu() {
    this.stop();
    this.cleanupDynamic();
    this.mode = 'menu';
    this.campaignStarted = false;
    this.ui.showHud(false);
    this.ui.setDamageOverlay({ red: 0, dust: 0, blur: 0 });
    this.ui.fade(0, 0);
    this.input.releaseLock();
  }

  cleanupDynamic() {
    for (const a of this.prologue?.aircraft || []) { this.scene.remove(a.mesh); a.sound?.stop(0.2); }
    for (const p of this.combat?.projectiles || []) this.scene.remove(p.mesh);
    for (const m of [this.hotelSheet, this.roadblockMesh, this.shelterProps, this.rescueHeli?.mesh]) if (m) this.scene.remove(m);
    for (const ch of this.hotelPeople || []) this.scene.remove(ch.root);
    this.rescueHeli?.sound?.stop();
    Object.assign(this, { hotelPeople: null, hotelSheet: null, roadblockMesh: null, shelterProps: null, rescueHeli: null });
    if (this.shelterLight) this.shelterLight.intensity = 0;
    if (this.flareLight) this.flareLight.intensity = 0;
    if (this.heliSpot) this.heliSpot.intensity = 0;
    this.drone?.land();
  }

  resetSystems(config) {
    this.cleanupDynamic();
    Object.assign(this, { ending: null, campaignStarted: false, raid: null, missions: {}, shelter: null, sleeping: false, phoneTorch: false, flashlightBattery: 100 });
    this.config = sanitizeConfig(config);
    this.stats = deriveStats(this.config);
    this.inv = new Inventory(this.stats.capacity);
    this.inv.setQuickSlots(Math.min(6, this.stats.kitSlots));
    this.vitals = createVitals();
    this.campaign = createCampaign();
    this.phone = createPhone();
    this.stash = new Stash();
    this.containers = new Containers(this);
    this.mapState = new MapState();
    this.smokes = [];
    this.extraColliders = [];
    this.flagsSeen = new Set();
    this.money = 0;
    this.playerAlive = true;
    this.lastHint = {};
    if (!this.player) this.player = new Player(this);
    this.player.frozen = false;
    this.player.knockdown = 0;
    if (this.squad) for (const m of this.squad.members) { this.scene.remove(m.char.root); for (const p of m.props) this.scene.remove(p); }
    this.squad = new Squad(this);
    if (this.enemies) this.enemies.clear();
    this.enemies = new Enemies(this);
    if (this.civilians) this.civilians.clear();
    this.civilians = new Civilians(this);
    if (this.drone) { this.drone.land(); this.scene.remove(this.drone.mesh); }
    this.drone = new Drone(this);
    this.combat = new Combat(this);
    this.combat.setAspect(this.camera.aspect);
    if (this.playerChar) this.scene.remove(this.playerChar.root);
    this.playerChar = new Character(this.config, { weapon: this.config.loadout.primary });
    this.playerChar.root.visible = false;
    this.scene.add(this.playerChar.root);
    this.prologue = new Prologue(this);
    this.rescueHeli = null;
    this.raid = null;
    this.audio.stopAll();
    this.ambience = [];
  }

  newGame(config, { skipPrologue = false } = {}) {
    this.resetSystems(config);
    for (const [id, n] of startingItems(this.config)) this.inv.add(id, n);
    const kit = this.config.loadout.kit;
    kit.slice(0, this.inv.quick.length).forEach((k, i) => { if (this.inv.has(k)) this.inv.quick[i] = k; });
    for (const w of [this.inv.primary, this.inv.sidearm]) if (w) this.inv.reload(w);
    this.combat.rebuild();
    this.money = 320;
    this.world = { ruined: false, blast: [], collapsed: [], clearedDebris: [], extraCollapsed: [] };
    if (skipPrologue) {
      // Default purchases for players who skip the opening.
      for (const [id, n] of [['water_small', 3], ['energy_bar', 2], ['bandage', 2], ['painkillers', 2], ['drone', 1], ['power_bank', 1]]) this.inv.add(id, n);
      this.world.ruined = true;
      const p = this.L.playerAfterBlast;
      this.world.blast = pickBlastTargets(this.L, p.x, p.z, p.yaw);
      this.buildWorld();
      this.mode = 'play';
      this.player.place(p.x, 0, p.z, p.yaw);
      this.enterRuins(false);
      this.prologue.setPhase('wake');
      this.prologue.t = 0;
      this.ui.fade(1, 0);
      this.audio.muffle(0.8, 0.01);
      this.audio.ringing(0.8, 0.01);
    } else {
      this.buildWorld();
      this.mode = 'play';
      this.prologue.start();
    }
    this.ui.showHud(true);
    this.start();
  }

  // After the strike (from the prologue or a skipped start).
  enterRuins(fromPrologue) {
    if (fromPrologue) {
      this.world.ruined = true;
      this.buildWorld();
    }
    const L = this.L;
    // Wake where you fell, unless that's far from the squad's street.
    const P = this.player.pos;
    const ref = L.playerAfterBlast;
    if (!fromPrologue || Math.hypot(P.x - ref.x, P.z - ref.z) > 45) this.player.place(ref.x, 0, ref.z, ref.yaw);
    const k = this.nav.nearestWalkable(this.player.pos.x, this.player.pos.z, 8);
    if (k >= 0 && !this.nav.walkable(this.player.pos.x, this.player.pos.z)) { const c = this.nav.center(k); this.player.pos.x = c.x; this.player.pos.z = c.z; }
    this.player.pos.y = this.cw.groundHeight(this.player.pos.x, this.player.pos.z, 2);
    this.player.knockdown = 1;
    this.player.roll = 0.55;
    this.squad.scatter();
    this.campaign.minutes = DISASTER_TIME;
    this.campaign.day = 1;
    // Wounds from the blast.
    this.vitals.health = Math.min(this.vitals.health, 68);
    addInjury(this.vitals, 'concussion', 'head');
    addInjury(this.vitals, 'bleeding_minor', 'arm');
    addInjury(this.vitals, 'laceration', 'leg');
    this.vitals.disorient = 0.8;
    // Belongings scattered: some purchases end up in your torn backpack nearby.
    const rng = makeRng(this.config.name);
    const lost = [];
    for (const s of [...this.inv.stacks]) {
      const def = ITEMS[s.id];
      if (['food', 'water', 'medical', 'power', 'comms'].includes(def.cat) && rng() < 0.45) {
        const n = Math.ceil(s.n * 0.6);
        this.inv.remove(s.id, n);
        lost.push({ id: s.id, n, data: s.data });
      }
    }
    if (this.inv.has('emergency_card')) this.inv.remove('emergency_card');
    if (this.inv.has('drone')) {
      this.inv.remove('drone');
      lost.push({ id: rng() < 0.5 ? 'drone' : 'drone_broken', n: 1 });
    }
    this.containers.addLoose('torn_backpack', this.player.pos.x + 2.2, this.player.pos.z + 1.5, 'your torn backpack', lost, 'bag');
    this.containers.addLoose('pickup_note_sari', 6, 31.5, 'torn notebook page', [{ id: 'note_sari', n: 1 }], 'paper');
    this.containers.addLoose('pickup_note_bima', 52, 85.5, 'blood-stained notebook', [{ id: 'note_bima', n: 1 }], 'paper');
    const police = this.L.containers.find((c) => c.interior === 'police' && c.kind === 'desk');
    if (police) police.fixed = [['note_dimas', 1]];
    logEntry(this.campaign, 'The strike. Kreuzhafen is in ruins. Your squad is scattered.', 'milestone');
    this.journal('Your phone took the brunt of the fall: the screen is cracked and it will not turn on.', 'note');
    this.mapState.addMarker({ id: 'lz', x: L.lz.x, z: L.lz.z, kind: 'lz', label: 'Stadtpark', hidden: true });
  }

  prologueFinished() {
    this.mode = 'play';
    this.campaignStarted = true;
    this.ui.setPrologueObjective(null);
    this.updateCampaign(0);
    this.save('auto', 'Day 1 - after the strike');
    this.ui.hint('Your phone is broken. Find your squad first. (Tab: inventory, M: map, J: journal)', 9);
  }

  snapshot(label = '') {
    return {
      label, config: this.config, campaign: this.campaign, vitals: this.vitals, inv: this.inv.toJSON(), phone: this.phone, stash: this.stash.toJSON(),
      player: { x: this.player.pos.x, y: this.player.pos.y, z: this.player.pos.z, yaw: this.player.yaw, flashlight: this.flashlightBattery ?? 100 },
      squad: this.squad.serialize(), enemies: this.enemies.serialize(), containers: this.containers.serialize(), map: this.mapState.serialize(),
      world: this.world, drone: { battery: this.drone.battery }, shelter: this.shelter || null, stats: { shotsFired: this.stats.shotsFired, enemiesDown: this.stats.enemiesDown },
      extra: { extraColliders: this.extraColliders, missions: this.missions || {} },
    };
  }

  save(slot, label) {
    if (!this.campaignStarted || !this.playerAlive || this.ending) return { ok: false, error: 'You cannot save right now.' };
    const res = writeSave(slot, this.snapshot(label || `Day ${this.campaign.day}, ${formatClock(this.campaign.minutes)}`));
    if (res.ok && slot !== 'auto') this.toast('Game saved.', 'good');
    return res;
  }

  load(slot) {
    const s = readSave(slot);
    if (!s) { this.toast('That save could not be loaded.', 'bad'); return false; }
    this.loadSnapshot(s);
    return true;
  }

  loadSnapshot(s) {
    this.loadCount = (this.loadCount || 0) + 1;
    this.resetSystems(s.config);
    this.world = { extraCollapsed: [], clearedDebris: [], ...s.world };
    this.extraColliders = s.extra?.extraColliders || [];
    this.missions = s.extra?.missions || {};
    this.buildWorld();
    this.campaign = s.campaign;
    this.vitals = s.vitals;
    this.inv = Inventory.fromJSON(s.inv);
    this.phone = s.phone;
    this.stash = new Stash(s.stash || []);
    this.containers.restore(s.containers);
    this.mapState.restore(s.map);
    this.shelter = s.shelter;
    this.drone.battery = s.drone?.battery ?? 100;
    this.flashlightBattery = s.player.flashlight ?? 100;
    Object.assign(this.stats, s.stats || {});
    this.player.place(s.player.x, s.player.y, s.player.z, s.player.yaw);
    this.squad.restore(s.squad);
    this.enemies.restore(s.enemies);
    this.combat.rebuild();
    this.campaignStarted = true;
    this.prologue.setPhase('done');
    this.mode = 'play';
    this.ui.fade(1, 0);
    this.ui.fade(0, 1.5);
    this.ui.showHud(true);
    this.restoreMissions();
    this.startAmbience();
    this.updateCampaign(0);
    this.start();
  }

  // --- Main loop ----------------------------------------------------------------------
  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const loop = (now) => {
      if (!this.running) return;
      requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.frame(dt);
    };
    requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    this.audio.stopAll();
  }

  // Advances the simulation without rendering (automated tests, debugging).
  simulate(seconds, dt = 1 / 30) {
    const n = Math.ceil(seconds / dt);
    for (let i = 0; i < n; i++) {
      this.update(dt);
      this.input.endFrame();
      if (this.mode !== 'play' && this.mode !== 'drone') break;
    }
  }

  setMode(m) {
    this.mode = m;
    this.playerChar.root.visible = m === 'drone';
  }

  frame(dt) {
    const paused = this.ui.blocksWorld() || this.mode === 'menu' || this.mode === 'dead' || this.mode === 'ending';
    if (!paused) this.update(dt);
    else if (this.mode === 'drone' || this.mode === 'play') this.player.applyCamera(this.camera, 0);
    this.render(dt);
    this.ui.update(dt);
    this.input.endFrame();
  }

  update(dt) {
    const input = this.input;
    const inPrologue = this.prologue.phase !== 'done';
    this.input.enabled = !this.ui.capturesInput();
    if (this.mode === 'drone') {
      this.drone.update(dt, input);
      this.player.update(dt, { ...input, look: () => ({ yaw: 0, pitch: 0 }), down: () => false, hit: () => false });
    } else {
      this.player.update(dt, input);
      // Weapons stay lowered during the opening.
      this.combat.update(dt, input, this.campaignStarted && !this.player.frozen && !this.ui.phoneOpen);
      this.handleKeys(input, inPrologue);
      this.updateInteraction(dt, input);
    }
    if (inPrologue) this.prologue.update(dt);
    // Clock.
    if (this.campaignStarted && !inPrologue) {
      const gm = dt * (DAY_SPEED[this.settings.dayLength] || 1.5);
      this.updateCampaign(gm);
    }
    this.squad.update(dt);
    if (this.campaignStarted) this.enemies.update(dt);
    if (inPrologue) this.civilians.update(dt);
    this.updateEnvironment(dt);
    this.particles.update(dt, this.camera.position);
    this.props.update(dt);
    this.updateRescueHeli(dt);
    this.updateMissions(dt);
    if (this.mode !== 'drone') this.player.applyCamera(this.camera, dt);
    else this.drone.applyCamera(this.camera);
    this.playerChar.root.position.copy(this.player.pos);
    this.playerChar.root.rotation.y = this.player.yaw;
    if (this.mode === 'drone') this.playerChar.animate(dt, { mode: this.player.crouched ? 'crouch' : 'idle' });
    // Audio listener.
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
    this.audio.setListener(this.camera.position, fwd, up);
    this.audio.setIndoor(!!this.player.indoors && this.mode !== 'drone');
    // Map discovery.
    this.revealTimer = (this.revealTimer || 0) - dt;
    if (this.revealTimer <= 0 && this.campaignStarted) {
      this.revealTimer = 0.4;
      this.mapState.reveal(this.player.pos.x, this.player.pos.z, 24 + this.player.pos.y * 3);
    }
  }

  handleKeys(input, inPrologue) {
    if (this.player.frozen) return;
    if (input.hit('KeyF')) this.toggleFlashlight();
    if (input.hit('KeyG') && !inPrologue) this.drone.deploy();
    if (input.hit('KeyP') && !inPrologue) this.ui.openPhone();
    for (let i = 0; i < 6; i++) {
      if (input.hit(`Digit${i + 3}`)) {
        const id = this.inv.quick[i];
        if (id) this.useItem(id);
      }
    }
  }

  toggleFlashlight() {
    if (!this.inv.has('flashlight')) { this.toast('You have no flashlight.', 'warn'); return; }
    if ((this.flashlightBattery ?? 100) <= 0) {
      if (this.inv.has('batteries')) { this.inv.remove('batteries'); this.flashlightBattery = 100; this.toast('Fresh batteries in the flashlight.', 'info'); } else { this.toast('Flashlight batteries are dead. Find AA batteries.', 'warn'); return; }
    }
    this.player.flashlightOn = !this.player.flashlightOn;
    this.audio.play('click', { bus: 'ui' });
  }

  // --- Interaction ---------------------------------------------------------------------
  gatherInteractables() {
    const list = this.containers.interactables().concat(this.squad.interactables(), this.worldInteractables(), this.takedownTargets());
    return list;
  }

  worldInteractables() {
    const out = [];
    const L = this.L;
    const P = this.player.pos;
    const inPrologue = this.prologue.phase !== 'done';
    const near = (x, z, r = 30) => Math.abs(x - P.x) < r && Math.abs(z - P.z) < r;
    if (inPrologue) {
      if (this.prologue.phase === 'shopping' || this.prologue.phase === 'gear' || this.prologue.phase === 'arrive') {
        const it = this.player.indoors;
        const shop = it && this.prologue.shopAt(it.id);
        if (shop) out.push({ id: `shop:${it.id}`, x: P.x, y: P.y + 1, z: P.z, r: 99, label: `Buy at ${shop.name} (€${this.money.toFixed(2)} left)`, hold: 0, action: () => this.ui.openShop(shop) });
      }
      return out;
    }
    for (const sh of L.shelters) {
      if (!near(sh.setup.x, sh.setup.z)) continue;
      if (!this.shelter || this.shelter.id !== sh.id) {
        out.push({ id: `shelter:${sh.id}`, x: sh.setup.x, y: 0.8, z: sh.setup.z, r: 2.5, label: this.shelter ? `Move the shelter here (${sh.name})` : `Set up a temporary shelter here (${sh.name})`, hold: 0, action: () => this.ui.confirmShelter(sh) });
      } else {
        out.push({ id: 'sleep', x: sh.setup.x + 1.5, y: 0.5, z: sh.setup.z, r: 2.2, label: 'Rest / sleep (bedroll)', hold: 0, action: () => this.ui.openSleep() });
        out.push({ id: 'stash', x: sh.setup.x - 1.2, y: 0.6, z: sh.setup.z, r: 2.2, label: 'Shelter stash', hold: 0, action: () => this.ui.openStash() });
        if (this.campaign.day >= 8 && !this.campaign.flags.shelterFortified) {
          out.push({ id: 'fortify', x: sh.setup.x, y: 1, z: sh.setup.z + 2, r: 2.4, label: 'Barricade the shelter (rope, duct tape or planks)', hold: 6, noise: 12, disabled: !this.canFortify(), action: () => this.fortify() });
        }
      }
    }
    for (const c of L.climbs) {
      if (near(c.bottom.x, c.bottom.z)) out.push({ id: `climb:${c.id}`, x: c.bottom.x, y: 1, z: c.bottom.z, r: 2, label: `Climb the ${c.name}`, hold: 2, action: () => this.climb(c, true) });
      if (P.y > c.top.y - 2 && near(c.top.x, c.top.z, 10)) out.push({ id: `down:${c.id}`, x: c.top.x, y: c.top.y + 1, z: c.top.z, r: 3.5, label: `Climb down the ${c.name}`, hold: 2, action: () => this.climb(c, false) });
    }
    for (const w of L.waterSources) {
      if (near(w.x, w.z)) out.push({ id: `water:${w.id}`, x: w.x, y: 0.7, z: w.z, r: w.r + 0.8, label: `Fill a bottle at the ${w.name} (unsafe)`, hold: 2.5, action: () => { if (this.inv.add('dirty_water', 1)) this.toast('Filled a bottle. Purify it before drinking.', 'info'); else this.toast('No room to carry more.', 'warn'); } });
    }
    for (const c of L.chargeSpots) {
      if (near(c.x, c.z) && Math.abs((c.y || 0) - P.y) < 2) out.push({ id: `charge:${c.id}`, x: c.x, y: (c.y || 0) + 1, z: c.z, r: 2.5, label: `Use the ${c.name} (open phone to charge)`, hold: 0, action: () => this.ui.openPhone() });
    }
    for (const d of L.debrisSites) {
      if (this.world.clearedDebris.includes(d.id) || !near(d.x, d.z)) continue;
      const crowbar = this.inv.has('crowbar');
      out.push({ id: `debris:${d.id}`, x: d.x, y: 1, z: d.z, r: 3.2, label: `Clear the ${d.name}${crowbar ? ' with the crowbar' : ' by hand (slow)'}`, hold: (crowbar ? d.time * 0.5 : d.time) / this.stats.debrisSpeed, noise: 18, action: () => this.clearDebris(d) });
    }
    for (const x of this.missionInteractables()) out.push(x);
    return out;
  }

  takedownTargets() {
    const out = [];
    const P = this.player.pos;
    for (const e of this.enemies.list) {
      if (e.dead) continue;
      const d = Math.hypot(e.pos.x - P.x, e.pos.z - P.z);
      if (d > 2) continue;
      const st = e.brain.state;
      if (st === 'combat' || st === 'cover') continue;
      const fx = -Math.sin(e.yaw);
      const fz = -Math.cos(e.yaw);
      const behind = ((P.x - e.pos.x) * fx + (P.z - e.pos.z) * fz) / d < -0.3;
      if (!behind) continue;
      out.push({ id: `takedown:${e.id}`, x: e.pos.x, y: 1.2, z: e.pos.z, r: 2, label: 'Silent takedown', hold: 1.1, enemy: e, action: () => { if (!e.dead && e.brain.state !== 'combat') { e.die(true); this.audio.play('impact', { gain: 0.4 }); this.toast('Enemy subdued silently.', 'good'); } } });
    }
    return out;
  }

  updateInteraction(dt, input) {
    const P = this.player.pos;
    const eye = this.camera.position;
    const f = this.player.forward();
    let best = null;
    let bestScore = Infinity;
    if (!this.player.frozen && this.mode === 'play') {
      for (const it of this.gatherInteractables()) {
        const dx = it.x - P.x;
        const dz = it.z - P.z;
        const d = Math.hypot(dx, dz);
        if (d > it.r || Math.abs((it.y ?? 1) - (P.y + 1)) > 2.6) continue;
        const dy = (it.y ?? 1) - eye.y;
        const len = Math.hypot(dx, dy, dz) || 1;
        const cos = (dx * f.x + dy * f.y + dz * f.z) / len;
        if (cos < 0.55 && d > 1.1) continue;
        if (it.r < 50 && d > 1.2 && !this.cw.lineOfSight(eye.x, eye.y, eye.z, it.x, it.y ?? 1, it.z)) continue;
        const score = d * 0.5 + (1 - cos) * 6 + (it.dim ? 2 : 0);
        if (score < bestScore) { bestScore = score; best = it; }
      }
    }
    if (!best || (this.holding && this.holding.id !== best.id)) this.holding = null;
    if (best && !best.disabled && input.hit('KeyE') && !best.hold) best.action();
    if (best && best.hold && !best.disabled) {
      if (input.down('KeyE')) {
        if (!this.holding) this.holding = { id: best.id, p: 0, noiseT: 0 };
        this.holding.p += dt / best.hold;
        this.holding.noiseT -= dt;
        if (best.noise && this.holding.noiseT <= 0) { this.holding.noiseT = 1; this.noise(P.x, P.z, best.noise, 0.3, 'work'); this.audio.play('rustle', { gain: 0.5 }); }
        if (this.holding.p >= 1) { this.holding = null; best.action(); }
      } else this.holding = null;
    }
    this.ui.setPrompt(best ? { label: best.label, hold: best.hold, progress: this.holding?.p || 0, disabled: best.disabled, dim: best.dim } : null);
  }

  // --- Clock and campaign ----------------------------------------------------------------
  facts() {
    const tm = this.squad.facts();
    const vals = Object.values(tm);
    const foodIds = Object.values(ITEMS).filter((i) => i.cat === 'food').map((i) => i.id);
    const waterIds = Object.values(ITEMS).filter((i) => i.cat === 'water' && i.id !== 'dirty_water').map((i) => i.id);
    const stashFood = foodIds.reduce((a, id) => a + this.stash.count(id), 0);
    const stashWater = waterIds.reduce((a, id) => a + this.stash.count(id), 0);
    const invFood = foodIds.reduce((a, id) => a + this.inv.count(id), 0);
    const invWater = waterIds.reduce((a, id) => a + this.inv.count(id), 0);
    const ctx = this.commsContext();
    const devs = devices(this.phone, ctx);
    const sat = this.inv.stackOf('sat_phone');
    return {
      day: this.campaign.day, tm,
      located: vals.filter((t) => t.status === 'located' || t.status === 'rescued' || (t.status === 'dead' && this.squad.members.find((m) => tm[m.id] === t)?.exact)).length,
      rescued: vals.filter((t) => t.status === 'rescued').length,
      shelter: this.shelter?.id || null,
      playerBleeding: hasInjury(this.vitals, 'bleeding_minor') || hasInjury(this.vitals, 'bleeding_severe'),
      flags: this.campaign.flags, rescueConfirmed: this.campaign.rescue.confirmed, rescueDay: this.campaign.rescue.day,
      stash: { food: stashFood, water: stashWater }, supplies: { food: stashFood + invFood, water: stashWater + invWater },
      comms: {
        inspected: this.phone.inspected,
        powered: this.phone.battery >= 20 || (sat && (sat.data?.charge ?? 0) >= 10) || ((this.inv.has('field_radio') || this.phone.manpackFixed) && this.inv.count('batteries') >= 2),
        audio: audioOk(this.phone, this.inv) || this.inv.has('sat_phone') || this.inv.has('field_radio') || this.phone.manpackFixed,
        contact: this.phone.contactKnown || this.inv.has('emergency_card') || this.inv.has('freq_card') || this.squad.get('dimas').status === 'rescued' || this.inv.has('sat_phone'),
        anyUsable: devs.some((d) => d.usable),
      },
      inv: (id) => this.inv.count(id),
    };
  }

  commsContext() {
    return {
      inv: this.inv, bars: this.signalHere(), outdoors: !this.player.indoors, elevation: this.player.pos.y, daylight: this.darkness < 0.4,
      atChargeSpot: this.L.chargeSpots.some((c) => Math.hypot(c.x - this.player.pos.x, c.z - this.player.pos.z) < 3.5 && Math.abs((c.y || 0) - this.player.pos.y) < 2),
      dimasRescued: this.squad.get('dimas').status === 'rescued', dimasKnowsNumber: this.squad.get('dimas').status === 'rescued',
      hasManpack: this.config.radio === 'manpack',
    };
  }

  signalHere() {
    const P = this.player.pos;
    const open = P.y > 6 || Math.hypot(P.x, P.z - 5) < 22 || (Math.abs(P.x) < 22 && P.z < -95 && P.z > -145);
    return signalBars({ x: P.x, y: P.y + 1.5, z: P.z }, { indoors: !!this.player.indoors, open, antenna: this.phone.antenna === 'boosted', bonus: this.stats.signalBonus, t: performance.now() / 1000 });
  }

  updateCampaign(gameMinutes) {
    const c = this.campaign;
    const f = this.facts();
    if (gameMinutes > 0) {
      const ev = advanceTime(c, gameMinutes, f);
      const sleeping = this.sleeping;
      const act = sleeping ? 'sleep' : this.player.sprinting ? 'sprint' : this.player.moving ? 'walk' : 'idle';
      const events = tickVitals(this.vitals, gameMinutes, { activity: act, sheltered: !!this.shelter && this.inShelter(), healMult: this.stats.healBonus });
      for (const e of events) this.onVitalEvent(e);
      this.squad.tickNeeds(gameMinutes, sleeping);
      drainPhone(this.phone, gameMinutes, this.ui.phoneOpen || this.phoneTorch);
      if (this.player.flashlightOn) {
        this.flashlightBattery = Math.max(0, (this.flashlightBattery ?? 100) - gameMinutes * 0.12);
        if (this.flashlightBattery <= 0) { this.player.flashlightOn = false; this.toast('Flashlight batteries died.', 'warn'); }
      }
      const sat = this.inv.stackOf('sat_phone');
      if (sat && !sat.data) sat.data = { charge: 4 };
      for (const e of ev) this.onCampaignEvent(e);
    }
    this.objTimer = (this.objTimer || 0) - Math.max(gameMinutes, 0.01);
    if (this.objTimer <= 0 || gameMinutes === 0) {
      this.objTimer = 2;
      const r = updateObjectives(c, this.facts());
      for (const id of r.added) { this.toast(`New objective: ${objectiveText(id, this.facts())}`, 'objective'); logEntry(c, `Objective: ${objectiveText(id, this.facts())}`, 'objective'); }
      for (const id of r.completed) { this.toast(`Objective complete: ${objectiveText(id, this.facts())}`, 'good'); logEntry(c, `Completed: ${objectiveText(id, this.facts())}`, 'done'); this.audio.play('beep', { bus: 'ui', freq: 660, len: 0.18 }); }
      for (const id of r.failed) logEntry(c, `Failed: ${objectiveText(id, this.facts())}`, 'fail');
    }
  }

  onVitalEvent(e) {
    if (e === 'death') this.playerDied('Your wounds and the city finally took you.');
    else if (e === 'hungry') this.toast('You are hungry. Eat something (Tab).', 'warn');
    else if (e === 'thirsty') this.toast('You are thirsty. Drink something (Tab).', 'warn');
    else if (e === 'infection') { this.toast('Your wound is infected. You need antibiotics.', 'bad'); this.journal('Your untreated cut became infected.', 'warn'); }
  }

  onCampaignEvent(e) {
    const g = this;
    const c = this.campaign;
    if (e.type === 'newDay') {
      const d = DAYS[Math.min(e.day, 12)];
      this.ui.dayCard(e.day, d ? d.title : 'Overtime', d ? d.brief : 'The rescue team is coming. Hold on.');
      if (!this.sleeping) this.save('auto', `Day ${e.day} begins`);
      return;
    }
    if (e.type === 'missedExtraction') { this.finish({ extracted: false }); return; }
    if (e.type === 'noRescue') { this.finish({ extracted: false }); return; }
    const sq = this.squad;
    switch (e.id) {
      case 'sari_radio': {
        const m = sq.get('sari');
        if (this.stats.radioRange > 0) { m.say('help', { radio: true }); sq.hint(m, 40, 'Sari is on the radio: injured, near a pharmacy.'); } else this.journal('You heard nothing on the radio - you are not carrying one.', 'note');
        break;
      }
      case 'enemy_arrival':
        c.threat = 1;
        this.enemies.setThreat(1);
        this.toast('Enemy soldiers have entered the district. Stay out of sight.', 'bad');
        this.journal('Enemy patrols are sweeping the streets. They react to noise and gunfire.', 'warn');
        this.audio.play('radio_static', { bus: 'ui' });
        break;
      case 'dimas_ping':
        if (this.stats.radioRange > 0) { const m = sq.get('dimas'); m.say('help', { radio: true }); sq.hint(m, 45, 'A radio beacon is pinging near St. Marien church.'); }
        break;
      case 'bima_radio':
        if (this.stats.radioRange > 0) { const m = sq.get('bima'); m.say('help', { radio: true }); sq.hint(m, 50, 'Bima is alive - he is pinned somewhere in the south-west.'); }
        break;
      case 'bima_flare': {
        const m = sq.get('bima');
        this.launchFlare(m.pos.x, m.pos.z);
        sq.hint(m, 32, 'A red flare climbs over the south-west - near the Feuerwache!');
        break;
      }
      case 'broadcast':
        this.phone.messages.unshift({ from: 'Warn-App', text: 'EXTREME GEFAHR / EXTREME DANGER: Kreuzhafen-Mitte. Stay indoors. Avoid armed personnel. Do not use main roads.', day: c.day, time: formatClock(c.minutes) });
        if (this.phone.battery > 0) { this.toast('Your phone buzzed: emergency broadcast.', 'info'); this.audio.play('phone_buzz', { bus: 'ui' }); }
        break;
      case 'threat2':
        c.threat = 2;
        this.enemies.setThreat(2);
        this.toast('More patrols are moving through the district. Soldiers now guard the Rathaus.', 'bad');
        break;
      case 'heli_patrol':
        this.enemies.startHelicopterPatrol();
        this.journal('An enemy helicopter now sweeps the district at night with a searchlight.', 'warn');
        break;
      case 'scarcity': {
        let lost = 0;
        for (const id of ['bread', 'canned_soup', 'water_small', 'water_large']) lost += this.stash.remove(id, 1);
        this.toast('Resource crisis: other survivors have stripped most shops.', 'bad');
        this.journal(`Supplies are running short across the city.${lost ? ` Rats and spoilage cost the stash ${lost} items.` : ''}`, 'warn');
        break;
      }
      case 'midpoint': this.startMidpoint(); break;
      case 'aftershock': this.aftershock(); break;
      case 'threat3': this.startNewDanger(); break;
      case 'civilians': this.startCiviliansMission(); break;
      case 'depot': this.startDepotMission(); break;
      case 'prep': this.toast('Two days left. Prepare the squad and the route to the park.', 'objective'); break;
      case 'roadblock': this.startRoadblock(); break;
      case 'raid': this.startRaid(); break;
      case 'extraction_window': this.startExtraction(); break;
      default: break;
    }
  }

  // --- Missions and world events ----------------------------------------------------------
  startMidpoint() {
    const c = this.campaign;
    this.audio.play('radio_static', { bus: 'ui' });
    this.journal('Intercepted transmission: "...ASHEN SKY phase two... officer\'s convoy at the Marktplatz... sweep the residential blocks tomorrow..." The strike on the President\'s visit was planned weeks in advance.', 'milestone');
    this.toast('Intercepted: an enemy officer with the operation orders is near the Marktplatz.', 'clue');
    const officer = this.enemies.spawnOfficer();
    this.missions = { ...(this.missions || {}), officer: officer.id };
    // Sickness in the squad.
    const cands = this.squad.members.filter((m) => m.status === 'rescued');
    const who = cands.find((m) => activeInjuries(m.vitals).length) || cands[0];
    if (who) {
      addInjury(who.vitals, 'infection', 'arm');
      c.flags.infected = who.id;
      this.toast(`${who.name} has a fever: an infected wound.`, 'bad');
    }
  }

  aftershock() {
    const P = this.player.pos;
    this.player.trauma = 0.8;
    this.audio.play('collapse', { pos: { x: P.x + 30, y: 5, z: P.z }, gain: 1.5 });
    this.audio.play('explosion', { pos: { x: P.x + 60, y: 5, z: P.z - 40 }, gain: 1 });
    // A weakened building near the shelter (or the player) comes down.
    const ref = this.shelter ? this.L.shelters.find((s) => s.id === this.shelter.id) : P;
    const cand = this.L.buildings.filter((b) => !b.enterable && !b.edge && !b.collapse && !this.world.extraCollapsed.includes(b.id) && !this.world.blast.some((t) => t.building === b.id)
      && Math.hypot((b.x0 + b.x1) / 2 - ref.x, (b.z0 + b.z1) / 2 - ref.z) < 70 && Math.hypot((b.x0 + b.x1) / 2 - P.x, (b.z0 + b.z1) / 2 - P.z) > 18);
    if (cand.length) {
      const b = cand[Math.floor(Math.random() * cand.length)];
      this.world.extraCollapsed.push(b.id);
      this.ui.setDamageOverlay({ dust: 0.5, blur: 2 });
      setTimeout(() => this.ui.setDamageOverlay({ dust: 0, blur: 0 }), 2500);
      this.rebuildPreserving();
      this.particles.emit('dust', (b.x0 + b.x1) / 2, 2, (b.z0 + b.z1) / 2, 40, { spread: 14, scale: 1.5 });
      this.journal(`An aftershock brought down a damaged building near ${streetNameAt((b.x0 + b.x1) / 2 + 8, (b.z0 + b.z1) / 2) || 'your area'}. Routes may have changed.`, 'warn');
    }
    this.toast('The ground shakes - another building collapses.', 'bad');
  }

  startNewDanger() {
    const c = this.campaign;
    c.threat = 3;
    this.enemies.setThreat(3);
    const sh = this.shelter ? this.L.shelters.find((s) => s.id === this.shelter.id) : null;
    const near = sh ? { x: sh.id === 'gym' ? -60 : 95, z: sh.id === 'gym' ? 32 : -32, route: sh.id === 'gym' ? 'gym' : 'parking' } : { x: 0, z: 30, route: 'plaza' };
    this.enemies.spawnCheckpoint(near);
    this.mapState.addMarker({ id: 'checkpoint', x: near.x, z: near.z, kind: 'danger', label: 'Enemy checkpoint' });
    this.toast(sh ? 'The enemy set up a checkpoint near your shelter and is searching buildings.' : 'The enemy set up a checkpoint and is searching buildings.', 'bad');
  }

  startCiviliansMission() {
    const it = this.L.interiors.find((i) => i.type === 'hotel');
    const g = this;
    this.missions = { ...(this.missions || {}), civilians: true };
    this.spawnHotelCivilians(it);
    this.mapState.addMarker({ id: 'hotel', x: (it.x0 + it.x1) / 2, z: (it.z0 + it.z1) / 2, kind: 'objective', label: 'Civilians (HILFE)' });
    this.toast('A bedsheet with "HILFE" hangs from the Hotel Kreuzhof. Civilians are trapped there.', 'clue');
    g.journal('Civilians signal for help from the Hotel Kreuzhof. Helping them costs water and medicine you may need yourselves.', 'note');
  }

  spawnHotelCivilians(it) {
    if (this.hotelPeople) return;
    const rng = makeRng('hotel');
    this.hotelPeople = [];
    for (let i = 0; i < 3; i++) {
      const ch = new Character(civilianConfig(rng), { kind: 'civilian', ...civilianColors(rng) });
      ch.root.position.set((it.x0 + it.x1) / 2 - 2 + i * 2, 0, it.z1 - 2);
      ch.root.rotation.y = Math.PI;
      ch.state.mode = 'sitting';
      this.scene.add(ch.root);
      this.hotelPeople.push(ch);
    }
    const sheet = new THREE.Mesh(new THREE.PlaneGeometry(3, 2.2), M.textPlane('HILFE', { w: 256, h: 192, bg: '#efece4', fg: '#b01818', font: 'bold 90px Arial' }));
    const b = this.L.buildings.find((k) => k.type === 'hotel');
    sheet.position.set((b.x0 + b.x1) / 2 + 3, 7.5, b.z0 - 0.05);
    sheet.rotation.y = Math.PI;
    this.scene.add(sheet);
    this.hotelSheet = sheet;
  }

  startDepotMission() {
    this.missions = { ...(this.missions || {}), depot: true };
    this.enemies.spawnDepotGuards();
    const it = this.L.interiors.find((i) => i.type === 'station');
    this.containers.addLoose('depot_crate', (it.x0 + it.x1) / 2, (it.z0 + it.z1) / 2 + 3, 'enemy supply crates', [{ id: 'mre', n: 4 }, { id: 'water_large', n: 3 }, { id: 'antibiotics', n: 2 }, { id: 'first_aid_kit', n: 1 }, { id: 'ammo_556', n: 60 }, { id: 'flare', n: 1 }, { id: 'drone_battery', n: 1 }], 'crate');
    this.mapState.addMarker({ id: 'depot', x: 0, z: 108, kind: 'danger', label: 'Enemy supply depot' });
    this.toast('The enemy turned the Hauptbahnhof into a supply depot.', 'clue');
  }

  startRoadblock() {
    this.enemies.spawnRoadblock();
    this.missions = { ...(this.missions || {}), roadblock: true };
    this.addRoadblockBarrier();
    this.mapState.addMarker({ id: 'roadblock', x: 0, z: -92, kind: 'danger', label: 'Roadblock' });
    this.toast('Enemy roadblock on Kirchstraße, south of the park. Find another way in.', 'bad');
  }

  addRoadblockBarrier() {
    if (this.cw.hasTag('roadblock')) return;
    const box = { x0: -22, x1: 22, z0: -98.2, z1: -97.4, y0: 0, y1: 1.3, tag: 'roadblock' };
    this.extraColliders.push(box);
    this.cw.add(box);
    this.nav.rebuild(-30, -104, 30, -90);
    const mat = M.std('#7d7356', 0.95);
    const g = new THREE.Group();
    for (let x = -21; x <= 21; x += 1.4) {
      const bag = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.45, 0.7), mat);
      bag.position.set(x, 0.25 + ((x * 7) % 2 ? 0 : 0.45), -97.8);
      bag.castShadow = true;
      g.add(bag);
    }
    this.scene.add(g);
    this.roadblockMesh = g;
  }

  startRaid() {
    const sh = this.shelter ? this.L.shelters.find((s) => s.id === this.shelter.id) : null;
    const target = sh ? sh.setup : { x: this.player.pos.x, z: this.player.pos.z };
    this.raid = { enemies: this.enemies.spawnRaid(target, this.campaign.flags.shelterFortified ? 5 : 6), target, t: 0 };
    this.campaign.flags.raidStarted = true;
    this.toast(sh ? 'Gunfire! An enemy squad is moving on the shelter!' : 'Gunfire! An enemy squad is hunting you!', 'bad');
    this.audio.play('explosion', { pos: { x: target.x + 60, y: 3, z: target.z }, gain: 1 });
    if (this.sleeping) this.wakeUp('You wake to shouting and gunfire!');
  }

  onRaidDefeated() {
    if (!this.raid) return;
    this.campaign.flags.raidOver = true;
    this.raid = null;
    this.toast('The raid is over.', 'good');
    this.journal('You fought off the raid on the shelter.', 'milestone');
  }

  startExtraction() {
    this.mapState.addMarker({ id: 'lz', x: this.L.lz.x, z: this.L.lz.z, kind: 'lz', label: 'Stadtpark LZ' });
    this.toast('The rescue helicopter is inbound. Reach the Stadtpark LZ and mark it with a flare or smoke.', 'objective');
    this.audio.say('[Radio] Command', 'Elang-2, Rescue One is airborne. Mark the LZ when you are ready.', null, { pitch: 0.9, rate: 1 }, { radio: true });
  }

  missionInteractables() {
    const out = [];
    const P = this.player.pos;
    const c = this.campaign;
    if (this.missions?.civilians && !c.flags.civiliansHelped) {
      const it = this.L.interiors.find((i) => i.type === 'hotel');
      const x = (it.x0 + it.x1) / 2;
      const z = it.z1 - 2;
      if (Math.hypot(x - P.x, z - P.z) < 6) {
        const water = ['water_large', 'water_small'].filter((id) => this.inv.has(id));
        const med = ['first_aid_kit', 'bandage', 'antibiotics', 'painkillers', 'antiseptic'].find((id) => this.inv.has(id));
        const waterCount = this.inv.count('water_large') + this.inv.count('water_small');
        const ok = waterCount >= 2 && med;
        out.push({
          id: 'civilians', x, y: 0.8, z, r: 3, label: ok ? 'Give the civilians 2 water and a medical item' : 'The civilians need 2 water and 1 medical item', disabled: !ok, hold: 0,
          action: () => {
            let need = 2;
            for (const id of water) { const n = Math.min(need, this.inv.count(id)); this.inv.remove(id, n); need -= n; }
            this.inv.remove(med);
            c.flags.civiliansHelped = true;
            this.toast('The civilians thank you, in tears. "Danke... danke."', 'good');
            this.journal('You gave the civilians at the Hotel Kreuzhof water and medicine.', 'milestone');
            this.mapState.removeMarker('hotel');
          },
        });
      }
    }
    // Landing zone.
    if (extractionOpen(c) && !c.flags.lzMarked && Math.hypot(P.x - this.L.lz.x, P.z - this.L.lz.z) < this.L.lz.r + 4) {
      const flare = this.inv.has('flare');
      const smoke = this.inv.has('smoke_grenade');
      out.push({
        id: 'mark_lz', x: this.L.lz.x, y: 1, z: this.L.lz.z, r: 30, label: flare ? 'Fire a signal flare for the helicopter' : smoke ? 'Pop smoke to mark the LZ' : 'You need a flare or a smoke grenade to mark the LZ', disabled: !flare && !smoke, hold: 0,
          action: () => this.markLZ(flare ? 'flare' : 'smoke'),
      });
    }
    if (this.rescueHeli?.landed) {
      const h = this.rescueHeli.mesh.position;
      if (Math.hypot(h.x - P.x, h.z - P.z) < 9) out.push({ id: 'board', x: h.x, y: 1.5, z: h.z, r: 9, label: 'Board the helicopter', hold: 1.5, action: () => this.board() });
    }
    return out;
  }

  restoreMissions() {
    const m = this.missions || {};
    if (m.civilians && !this.campaign.flags.civiliansHelped) this.spawnHotelCivilians(this.L.interiors.find((i) => i.type === 'hotel'));
    if (m.roadblock && !this.roadblockMesh) {
      const g = new THREE.Group();
      const mat = M.std('#7d7356', 0.95);
      for (let x = -21; x <= 21; x += 1.4) { const bag = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.45, 0.7), mat); bag.position.set(x, 0.25, -97.8); g.add(bag); }
      this.scene.add(g);
      this.roadblockMesh = g;
    }
    if (this.shelter) this.placeShelterProps();
  }

  updateMissions(dt) {
    const c = this.campaign;
    const P = this.player.pos;
    if (!this.campaignStarted) return;
    // Scouting objectives.
    if (!c.flags.lzScouted && Math.hypot(P.x - this.L.lz.x, P.z - this.L.lz.z) < 30) this.setFlag('lzScouted', 'You scouted the Stadtpark landing zone.');
    if (this.missions?.roadblock && !c.flags.roadblockScouted && (Math.hypot(P.x, P.z + 92) < 60 || (this.mode === 'drone' && Math.hypot(this.drone.pos.x, this.drone.pos.z + 92) < 60))) this.setFlag('roadblockScouted', 'Roadblock scouted. Approach the park from Lindenstraße, Mozartstraße or Parkstraße instead.');
    if (extractionOpen(c) && Math.hypot(P.x - this.L.lz.x, P.z - this.L.lz.z) < this.L.lz.r + 8) c.flags.atLZ = true;
    if (c.flags.infected && !c.flags.infectionCured) {
      const m = this.squad.get(c.flags.infected);
      if (m && !hasInjury(m.vitals, 'infection')) c.flags.infectionCured = true;
    }
    // The raid: if nobody defends the shelter, the people inside get hurt.
    if (this.raid) {
      this.raid.t += dt;
      const t = this.raid.target;
      const atShelter = this.raid.enemies.filter((e) => !e.dead && Math.hypot(e.pos.x - t.x, e.pos.z - t.z) < 10);
      if (atShelter.length && Math.hypot(P.x - t.x, P.z - t.z) > 40 && !this.raid.harmed) {
        this.raid.harmed = true;
        for (const m of this.squad.members) {
          if (m.status === 'rescued' && m.sheltered) {
            applyDamage(m.vitals, this.campaign.flags.shelterFortified ? 18 : 40, { kind: 'bullet', part: 'torso', armor: 0.2 });
            if (m.vitals.health <= 0) this.squad.kill(m);
          }
        }
        this.toast('The raiders reached the shelter while you were away!', 'bad');
      }
      if (this.raid.t > 240) { this.campaign.flags.raidOver = true; this.raid = null; this.journal('The raiders withdrew before dawn.', 'note'); }
    }
    if (this.missions?.depot && !c.flags.depotRaided && this.containers.state.depot_crate?.opened) this.setFlag('depotRaided', 'You raided the enemy supply depot.');
    if (this.inv.has('intel_orders') && !c.flags.intelRecovered) { c.flags.intelRecovered = true; this.journal('You recovered the ASHEN SKY operation orders.', 'milestone'); }
  }

  markLZ(kind) {
    const c = this.campaign;
    if (kind === 'flare') { this.inv.remove('flare'); this.launchFlare(this.player.pos.x, this.player.pos.z); } else {
      this.inv.remove('smoke_grenade');
      this.addSmoke(this.L.lz.x + 2, this.L.lz.z, 0, 'signal_red');
    }
    c.flags.lzMarked = true;
    this.toast('LZ marked. Rescue One is two minutes out. Hold the park!', 'objective');
    this.audio.say('[Radio] Rescue One', 'Rescue One, I see your mark. Inbound, two minutes. Keep that LZ clear.', null, { pitch: 1.05, rate: 1 }, { radio: true });
    // The enemy sees the flare too.
    const raid = this.enemies.spawnRaid({ x: this.L.lz.x, z: this.L.lz.z }, 5);
    for (const e of raid) e.tag = 'lz';
    this.rescueHeli = { t: 0, mesh: buildHelicopter('rescue'), landed: false, sound: null };
    const m = this.rescueHeli.mesh;
    m.position.set(260, 120, -380);
    this.scene.add(m);
    this.rescueHeli.sound = this.audio.loop('heli', { pos: m.position, gain: 2, ref: 30 });
  }

  updateRescueHeli(dt) {
    const h = this.rescueHeli;
    if (!h) return;
    h.t += dt;
    const m = h.mesh;
    const lz = new THREE.Vector3(this.L.lz.x, 0, this.L.lz.z);
    const arrive = 75;
    if (h.t < arrive) {
      const k = h.t / arrive;
      const start = new THREE.Vector3(260, 120, -380);
      const hover = new THREE.Vector3(lz.x + 8, 25, lz.z - 10);
      m.position.lerpVectors(start, hover, k * k * (3 - 2 * k));
      m.rotation.y = Math.atan2(-(hover.x - start.x), -(hover.z - start.z));
    } else if (!h.landed) {
      m.position.y = damp(m.position.y, 0.2, 0.6, dt);
      m.position.x = damp(m.position.x, lz.x, 0.8, dt);
      m.position.z = damp(m.position.z, lz.z, 0.8, dt);
      if (m.position.y < 0.5) {
        h.landed = true;
        this.toast('Rescue One is on the ground. Get everyone aboard!', 'objective');
        this.audio.say('[Radio] Rescue One', 'We are down! Move, move, move!', null, { pitch: 1.05, rate: 1.1 }, { radio: true });
        for (const t of this.squad.members) if (t.status === 'rescued') { t.order = 'follow'; }
      }
    }
    if (m.userData.rotor) m.userData.rotor.rotation.y += dt * 30;
    if (m.userData.tailRotor) m.userData.tailRotor.rotation.x += dt * 40;
    h.sound?.setPos(m.position);
    if (m.position.y < 12) this.particles.emit('dust', m.position.x + (Math.random() - 0.5) * 12, 0.5, m.position.z + (Math.random() - 0.5) * 12, 1, { exact: true, scale: 0.8 });
  }

  board() {
    const h = this.rescueHeli.mesh.position;
    const aboard = this.squad.members.filter((m) => m.status === 'rescued' && Math.hypot(m.pos.x - h.x, m.pos.z - h.z) < 30).map((m) => m.id);
    this.campaign.flags.extracted = true;
    this.finish({ extracted: true, aboard });
  }

  finish({ extracted, aboard = [] }) {
    if (this.ending) return;
    const sq = this.squad;
    const ending = computeEnding({
      playerAlive: this.playerAlive, extracted, rescueConfirmed: this.campaign.rescue.confirmed, aboard,
      dead: sq.members.filter((m) => m.status === 'dead').map((m) => m.id),
      civiliansHelped: !!this.campaign.flags.civiliansHelped, intel: this.inv.has('intel_orders'), depotRaided: !!this.campaign.flags.depotRaided,
    });
    this.ending = ending;
    this.mode = 'ending';
    this.input.releaseLock();
    for (const t of aboard) sq.get(t).say('extract');
    this.ui.showEnding(ending, {
      days: this.campaign.day, rescued: sq.members.filter((m) => m.status === 'rescued').length, aboard: aboard.length,
      enemiesDown: this.stats.enemiesDown || 0, shots: this.stats.shotsFired || 0,
    });
  }

  // --- Player events ---------------------------------------------------------------------
  damagePlayer(amount, opts = {}) {
    if (!this.playerAlive || this.godMode) return; // godMode: automated tests only
    const s = this.stats;
    const res = applyDamage(this.vitals, amount, { ...opts, armor: s.armor, headArmor: s.headArmor, concussionResist: s.concussionResist });
    if (!opts.silent) {
      this.ui.damageFlash(res.dealt / 30, opts.from ? yawTo(this.player.pos.x, this.player.pos.z, opts.from.x, opts.from.z) - this.player.yaw : null);
      this.player.trauma = Math.min(1, this.player.trauma + res.dealt / 40);
      this.audio.play('impact', { gain: 1.2, bus: 'ui' });
      for (const i of res.injuries) this.toast(`Injury: ${i.type.replace('_', ' ')} (${i.part})`, 'bad');
    }
    if (this.vitals.health <= 0) this.playerDied(opts.kind === 'bullet' ? 'You were shot.' : 'Your injuries were fatal.');
  }

  onFall(height, impact) {
    const dmg = (height - 3) * 9;
    this.audio.play('footstep', { surface: 'rubble', gain: 1.5 });
    if (dmg > 2) this.damagePlayer(dmg, { kind: 'fall', part: 'leg' });
  }

  playerDied(reason) {
    if (!this.playerAlive) return;
    this.playerAlive = false;
    this.mode = 'dead';
    this.input.releaseLock();
    this.drone.land();
    this.audio.muffle(0.9, 1);
    this.ui.showDeath(reason);
  }

  // A noise the enemy might hear.
  noise(x, z, radius, loud, source) {
    this.enemies?.noise(x, z, radius, loud, source);
  }

  muzzleFlash(p) {
    this.muzzleLight.position.copy(p);
    this.muzzleLight.intensity = 25;
  }

  hitMarker(head) { this.ui.hitMarker(head); }

  addSmoke(x, z, y = 0, type = 'smoke_light') {
    const e = this.particles.emitter(type, x, y + 0.5, z, 10, { spread: 2.5, maxDist: 300, scale: 1.4 });
    const s = { x, z, r: 6, t: 0, e };
    this.smokes.push(s);
    this.noise(x, z, 12, 0.3, 'smoke');
    const loop = this.audio.loop('hiss', { pos: { x, y: 0.5, z }, gain: 0.6 });
    setTimeout(() => { loop.stop(); this.particles.remove(e); this.smokes = this.smokes.filter((k) => k !== s); }, 45000);
  }

  launchFlare(x, z) {
    this.combat.fireFlare(x, z);
    this.flareTimer = 22;
  }

  enemyAlerted(e, kind) {
    this.ui.alert(kind === 'contact' ? 2 : 1, yawTo(this.player.pos.x, this.player.pos.z, e.pos.x, e.pos.z) - this.player.yaw);
  }

  onSpotted(e) {
    if (this.campaign.day === 5) this.campaign.flags.spottedDay5 = true;
    this.mapState.sighting(e.pos.x, e.pos.z);
  }

  onItemGained(id) {
    const sq = this.squad;
    if (id === 'note_sari') sq.hint(sq.get('sari'), 24, 'The note mentions the Apotheke (pharmacy). Sari could be there.');
    if (id === 'note_dimas') sq.hint(sq.get('dimas'), 30, 'Radio log: Dimas was last near St. Marien church.');
    if (id === 'note_bima') sq.hint(sq.get('bima'), 26, 'Bima is pinned near the Feuerwache - bring a jack or crowbar.');
    if (id === 'city_map' && !this.mapState.fullMap) { this.mapState.fullMap = true; this.toast('Tourist map: the whole district is now on your map.', 'clue'); }
    if (id === 'drone' && this.drone.battery <= 0) this.drone.battery = 60;
  }

  setFlag(name, message) {
    if (this.campaign.flags[name]) return;
    this.campaign.flags[name] = true;
    if (message) { this.toast(message, 'clue'); this.journal(message, 'note'); }
  }

  playerSay(kind) {
    const style = this.config.voice.style;
    const text = PLAYER_LINES[kind]?.[style];
    if (!text) return;
    const preset = VOICE_PRESETS[this.config.voice.preset];
    this.audio.say(this.config.name.split(' ')[0], text, null, { pitch: preset.pitch * this.config.voice.pitch, rate: preset.rate * VOICE_STYLES[style].rate, voiceURI: this.config.voice.voiceURI }, { queue: true });
  }

  // --- Items -----------------------------------------------------------------------------
  useItem(id) {
    const def = ITEMS[id];
    if (!def || !this.inv.has(id)) return false;
    const v = this.vitals;
    if (def.cat === 'food' || def.cat === 'water') {
      if (id === 'dirty_water' && this.inv.has('purify_tabs')) {
        this.inv.remove('dirty_water');
        this.inv.remove('purify_tabs');
        this.inv.add('water_large');
        this.toast('Purified the water.', 'good');
        return true;
      }
      this.inv.remove(id);
      const r = consume(v, def);
      this.audio.play(def.cat === 'water' ? 'drink' : 'eat', { bus: 'ui' });
      this.toast(`${def.name}: ${r}`, 'info');
      return true;
    }
    if (def.cat === 'medical') {
      const treated = treat(v, id, this.stats.healBonus);
      if (!treated && id !== 'first_aid_kit' && id !== 'painkillers') { this.toast(`${def.name} would not help right now.`, 'warn'); return false; }
      this.inv.remove(id);
      this.audio.play('bandage', { bus: 'ui' });
      this.toast(treated ? `Treated: ${treated.replace('_', ' ')}` : `${def.name} used`, 'good');
      return true;
    }
    if (id === 'splint' || id === 'plank') return false;
    if (id === 'drone') return this.drone.deploy();
    if (id === 'drone_battery') { this.inv.remove(id); this.drone.battery = 100; this.toast('Drone battery replaced: 100%.', 'good'); return true; }
    if (id === 'drone_broken') {
      if (this.inv.has('duct_tape') || this.inv.has('multitool')) {
        if (this.inv.has('duct_tape')) this.inv.remove('duct_tape');
        this.inv.remove('drone_broken');
        this.inv.add('drone');
        this.drone.battery = Math.max(this.drone.battery, 50);
        this.toast('Drone repaired. It flies - just about.', 'good');
        return true;
      }
      this.toast('You need duct tape or a multitool to fix the drone.', 'warn');
      return false;
    }
    if (id === 'flare') { this.inv.remove(id); if (extractionOpen(this.campaign) && Math.hypot(this.player.pos.x - this.L.lz.x, this.player.pos.z - this.L.lz.z) < this.L.lz.r + 6) { this.inv.add('flare'); this.markLZ('flare'); } else this.launchFlare(this.player.pos.x, this.player.pos.z); return true; }
    if (id === 'smoke_grenade') { this.combat.throwSmoke(); return true; }
    if (id === 'batteries' && this.inv.has('flashlight')) { this.inv.remove(id); this.flashlightBattery = 100; this.toast('Flashlight batteries replaced.', 'good'); return true; }
    if (def.cat === 'gear') return this.equipGear(id);
    if (def.cat === 'document') { this.ui.readDocument(id); return true; }
    if (id === 'flashlight') { this.toggleFlashlight(); return true; }
    if (def.weapon) { this.inv.equip(def.weapon); this.combat.rebuild(); return true; }
    return false;
  }

  equipGear(id) {
    const def = ITEMS[id];
    const c = this.config;
    const prev = c[def.slot];
    c[def.slot] = def.gear;
    this.inv.remove(id);
    // The old item goes into the inventory where it exists as an item.
    const back = Object.values(ITEMS).find((i) => i.slot === def.slot && i.gear === prev);
    if (back) this.inv.add(back.id);
    this.stats = { ...deriveStats(c), shotsFired: this.stats.shotsFired, enemiesDown: this.stats.enemiesDown };
    this.inv.capacity = this.stats.capacity;
    this.inv.setQuickSlots(Math.min(6, this.stats.kitSlots));
    this.scene.remove(this.playerChar.root);
    this.playerChar = new Character(c, { weapon: this.inv.primary });
    this.playerChar.root.visible = false;
    this.scene.add(this.playerChar.root);
    this.toast(`Equipped: ${def.name}`, 'good');
    return true;
  }

  // --- Shelter, sleep, world actions ---------------------------------------------------------
  setShelter(sh) {
    const moving = !!this.shelter;
    this.shelter = { id: sh.id };
    if (moving && this.campaign.day >= 8) this.campaign.flags.shelterSecured = true;
    this.placeShelterProps();
    this.mapState.addMarker({ id: 'shelter', x: sh.setup.x, z: sh.setup.z, kind: 'shelter', label: 'Shelter' });
    this.toast(`Shelter set up: ${sh.name}. Send teammates here, store supplies, sleep.`, 'good');
    this.journal(`Set up a temporary shelter at the ${sh.name}.`, 'milestone');
    for (const m of this.squad.members) if (m.status === 'rescued' && m.order === 'shelter') m.path = null;
  }

  placeShelterProps() {
    if (this.shelterProps) this.scene.remove(this.shelterProps);
    const sh = this.L.shelters.find((s) => s.id === this.shelter.id);
    const g = new THREE.Group();
    const bed = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.12, 2), M.std('#3e4a36', 0.9));
    bed.position.set(sh.setup.x + 1.5, 0.06, sh.setup.z);
    g.add(bed);
    const crate = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.6, 0.6), M.std('#6a5a3c', 0.85));
    crate.position.set(sh.setup.x - 1.2, 0.3, sh.setup.z);
    g.add(crate);
    this.shelterLight.position.set(sh.setup.x, 1.4, sh.setup.z + 0.5);
    this.shelterLight.intensity = 3;
    this.scene.add(g);
    this.shelterProps = g;
  }

  // Positions inside the shelter for teammates.
  shelterSpot(i) {
    if (!this.shelter) return null;
    const sh = this.L.shelters.find((s) => s.id === this.shelter.id);
    const it = this.L.interiors.find((k) => k.id === sh.interior);
    const cx = (it.x0 + it.x1) / 2;
    const cz = (it.z0 + it.z1) / 2;
    return { x: cx - 1.5 + (i % 2) * 3, z: cz - 1 + Math.floor(i / 2) * 2 };
  }

  inShelter() {
    if (!this.shelter) return false;
    const sh = this.L.shelters.find((s) => s.id === this.shelter.id);
    return this.player.indoors?.id === sh.interior;
  }

  canFortify() {
    return this.inv.has('rope') || this.inv.has('duct_tape') || this.inv.count('plank') >= 2;
  }

  fortify() {
    if (this.inv.has('rope')) this.inv.remove('rope');
    else if (this.inv.has('duct_tape')) this.inv.remove('duct_tape');
    else this.inv.remove('plank', 2);
    this.campaign.flags.shelterFortified = true;
    this.campaign.flags.shelterSecured = true;
    this.toast('Shelter barricaded. Raiders will have a harder time.', 'good');
    this.journal('You barricaded the shelter entrance.', 'milestone');
  }

  // Sleep or rest for `hours` (or until 06:00 when hours is 'morning').
  sleep(hours) {
    const c = this.campaign;
    let minutes = hours === 'morning' ? ((6 * 60 - c.minutes + 1440) % 1440 || 1440) : hours * 60;
    minutes = Math.min(minutes, 12 * 60);
    this.sleeping = true;
    this.ui.fade(1, 0.6);
    const blanket = this.inv.has('blanket') ? 1.2 : 1;
    let done = 0;
    const step = () => {
      if (!this.sleeping) return;
      const chunk = Math.min(20, minutes - done);
      this.updateCampaign(chunk);
      this.vitals.fatigue = Math.max(0, this.vitals.fatigue - chunk * 0.05 * blanket);
      this.vitals.stamina = 100;
      done += chunk;
      if (!this.playerAlive) return;
      if (done >= minutes || !this.sleeping) this.wakeUp();
      else setTimeout(step, 20);
    };
    setTimeout(step, 700);
  }

  wakeUp(message) {
    if (!this.sleeping) return;
    this.sleeping = false;
    this.ui.fade(0, 1.2);
    if (message) this.toast(message, 'bad');
    else this.toast(`You wake at ${formatClock(this.campaign.minutes)}.`, 'info');
  }

  climb(c, up) {
    this.ui.fade(1, 0.3);
    setTimeout(() => {
      const p = up ? c.top : c.bottom;
      this.player.place(p.x, p.y, p.z, this.player.yaw);
      this.ui.fade(0, 0.5);
      if (up) this.toast('From up here you can see the whole district. Try your phone.', 'info');
    }, 350);
  }

  clearDebris(d) {
    this.world.clearedDebris.push(d.id);
    this.cw.removeTag(`debris:${d.id}`);
    this.city.removeDebris(d.id);
    this.nav.rebuild(d.x - 6, d.z - 6, d.x + 6, d.z + 6);
    this.audio.play('scrape', { pos: { x: d.x, y: 1, z: d.z }, gain: 1.2 });
    if ((this.stats.handCutChance || 0) > Math.random()) { addInjury(this.vitals, 'laceration', 'arm'); this.toast('You cut your hand on the debris. Gloves would have helped.', 'warn'); }
    this.toast('The way is clear.', 'good');
  }

  // Rebuild the city (aftershock) keeping everything else.
  rebuildPreserving() {
    this.buildWorld();
    for (const m of this.squad.members) {
      if (!this.nav.walkable(m.pos.x, m.pos.z)) { const k = this.nav.nearestWalkable(m.pos.x, m.pos.z, 10); if (k >= 0) { const c = this.nav.center(k); m.pos.x = c.x; m.pos.z = c.z; } }
    }
    if (this.cw.blocked(this.player.pos.x, this.player.pos.z, this.player.pos.y, 0.3, 1.7)) {
      const k = this.nav.nearestWalkable(this.player.pos.x, this.player.pos.z, 10);
      if (k >= 0) { const c = this.nav.center(k); this.player.pos.x = c.x; this.player.pos.z = c.z; }
    }
    this.startAmbience();
  }

  // --- Environment ------------------------------------------------------------------------
  startAmbience() {
    for (const a of this.ambience || []) a.stop(1);
    this.ambience = [];
    if (!this.ruined) return;
    this.ambience.push(this.audio.loop('wind', { bus: 'amb', gain: 0.45 }));
    this.ambience.push(this.audio.loop('rumble', { bus: 'amb', gain: 0.25 }));
    this.fireSound = this.audio.loop('fire', { pos: { x: 0, y: 2, z: 0 }, gain: 0.8 });
    this.ambience.push(this.fireSound);
  }

  updateEnvironment(dt) {
    const c = this.campaign;
    this.darkness = this.sky.update(c.minutes, this.player.pos, this.player.indoors ? 0.6 : 1);
    this.sky.flash = Math.max(0, this.sky.flash - dt * 1.5);
    // Flashlight.
    if (this.phoneTorch && this.phone.battery <= 0) this.phoneTorch = false;
    this.flashlight.intensity = this.player.flashlightOn ? 60 : this.phoneTorch ? 22 : 0;
    // Fire lights: the nearest fires get the four pooled lights.
    const P = this.camera.position;
    if (this.fires?.length) {
      const near = this.fires.map((f) => ({ f, d: (f.x - P.x) ** 2 + (f.z - P.z) ** 2 })).sort((a, b) => a.d - b.d).slice(0, 4);
      this.fireLights.forEach((l, i) => {
        const n = near[i];
        if (!n || n.d > 80 * 80) { l.intensity = 0; return; }
        l.position.set(n.f.x, n.f.y + 1, n.f.z);
        l.intensity = (25 + Math.sin(performance.now() * 0.013 + i * 3) * 6 + Math.random() * 6) * (n.f.size || 1);
      });
      if (this.fireSound) { const f = near[0].f; this.fireSound.setPos({ x: f.x, y: f.y, z: f.z }); }
    }
    this.flareTimer = Math.max(0, (this.flareTimer || 0) - dt);
    const fl = this.combat.projectiles.find((p) => p.kind === 'flare');
    this.flareLight.intensity = fl ? 400 : 0;
    if (fl) this.flareLight.position.copy(fl.mesh.position);
    this.muzzleLight.intensity = damp(this.muzzleLight.intensity, 0, 40, dt);
    this.city.cull(this.camera.position, this.quality.viewDist);
    // Ambient one-shots after the strike: distant sirens, explosions, collapses.
    if (this.ruined && this.campaignStarted) {
      this.ambTimer = (this.ambTimer || 10) - dt;
      if (this.ambTimer <= 0) {
        this.ambTimer = 12 + Math.random() * 25;
        const a = Math.random() * Math.PI * 2;
        const pos = { x: P.x + Math.cos(a) * 220, y: 10, z: P.z + Math.sin(a) * 220 };
        const r = Math.random();
        if (r < 0.35) this.audio.play('explosion', { pos, gain: 0.7, ref: 60 });
        else if (r < 0.6) this.audio.play('collapse', { pos, gain: 0.5, ref: 40 });
        else if (r < 0.8) this.audio.play('gunshot', { pos, gain: 0.5, ref: 50, weapon: 'ar' });
        else this.audio.play('radio_static', { pos: { x: P.x + 4, y: 1, z: P.z }, gain: 0.3 });
      }
    }
  }

  // --- Helpers used by the systems ------------------------------------------------------------
  surfaceAt(x, z, interior) {
    if (interior) return ['apartment', 'hotel', 'townhall', 'gym'].includes(interior.type) ? 'wood' : 'concrete';
    const bl = this.L.blocks.find((b) => x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1);
    if (bl?.kind === 'park') return 'grass';
    if (this.player.pos.y > 3) return 'concrete';
    if (this.ruined) {
      const r = (Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1;
      if (Math.abs(r) < 0.25) return 'glass';
      if (Math.abs(r) < 0.6) return 'rubble';
    }
    return 'concrete';
  }

  canSee(x, y, z) {
    const e = this.camera.position;
    return this.cw.lineOfSight(e.x, e.y, e.z, x, y, z);
  }

  directionTo(pos) {
    const deg = bearingDeg(yawTo(this.player.pos.x, this.player.pos.z, pos.x, pos.z));
    return ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'][Math.round(deg / 45) % 8];
  }

  toast(text, kind = 'info') { this.ui.toast(text, kind); }

  journal(text, kind = 'note') { logEntry(this.campaign, text, kind); }

  // --- Rendering -------------------------------------------------------------------------
  render() {
    const r = this.renderer;
    r.autoClear = true;
    r.render(this.scene, this.camera);
    if (this.mode === 'play' && this.player.knockdown < 0.3 && this.combat) {
      r.autoClear = false;
      r.clearDepth();
      r.render(this.combat.scene, this.combat.cam);
    }
  }
}
