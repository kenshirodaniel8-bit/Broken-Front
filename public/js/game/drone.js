// Recon drone: deploy (G), fly from its camera, spot people, mark points,
// reveal the map. Limited by battery and signal range.

import * as THREE from 'three';
import { buildDrone } from '../world/vehicles.js';
import { clamp, damp, dampAngle } from '../core/util.js';

export const DRONE_FLIGHT_SECONDS = 240;
export const DRONE_RANGE = 140;

export class Drone {
  constructor(game) {
    this.game = game;
    this.mesh = buildDrone();
    this.mesh.visible = false;
    game.scene.add(this.mesh);
    this.battery = 100;
    this.deployed = false;
    this.returning = false;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = -0.5;
    this.hp = 3;
    this.signal = 1;
    this.spotTimer = 0;
    this.marks = [];
    this.sound = null;
    this.camera = new THREE.PerspectiveCamera(75, 1, 0.1, 900);
  }

  get range() { return DRONE_RANGE * this.game.stats.droneRange; }

  canDeploy() {
    const g = this.game;
    if (!g.inv.has('drone')) return g.inv.has('drone_broken') ? 'Your drone is damaged. Repair it from the inventory (duct tape or a multitool).' : 'You have no drone.';
    if (this.battery <= 3) return 'Drone battery is empty. Use a drone battery or charge it at the shelter with a power bank.';
    if (g.player.indoors) return 'You need open sky to launch the drone.';
    return null;
  }

  deploy() {
    const g = this.game;
    const why = this.canDeploy();
    if (why) { g.toast(why, 'warn'); return false; }
    this.deployed = true;
    this.returning = false;
    this.pos.copy(g.player.pos).add(new THREE.Vector3(0, 1.6, 0)).addScaledVector(g.player.forward().setY(0).normalize(), 0.8);
    this.vel.set(0, 2, 0);
    this.yaw = g.player.yaw;
    this.pitch = -0.35;
    this.hp = 3;
    this.mesh.visible = true;
    this.sound = g.audio.loop('drone', { pos: this.pos, gain: 0.9, ref: 2 });
    g.setMode('drone');
    g.toast('Drone airborne. WASD fly, Space/C up/down, Q mark, R return, G land near you.', 'info');
    return true;
  }

  land() {
    const g = this.game;
    this.deployed = false;
    this.mesh.visible = false;
    this.sound?.stop();
    this.sound = null;
    if (g.mode === 'drone') g.setMode('play');
  }

  crash(reason) {
    const g = this.game;
    g.particles.emit('spark', this.pos.x, this.pos.y, this.pos.z, 12);
    g.audio.play('impact', { pos: this.pos, gain: 1 });
    g.inv.remove('drone');
    // It falls where it is; you can go and pick up the wreck.
    const gx = this.pos.x;
    const gz = this.pos.z;
    g.containers.addLoose(`dronewreck${Date.now()}`, gx, gz, 'crashed drone', [{ id: 'drone_broken', n: 1 }]);
    this.land();
    g.toast(`Drone lost: ${reason}. The wreck is marked on your map.`, 'bad');
    g.mapState.addMarker({ x: gx, z: gz, kind: 'drone', label: 'Drone wreck' });
  }

  update(dt, input) {
    if (!this.deployed) return;
    const g = this.game;
    const P = g.player.pos;
    const distH = Math.hypot(this.pos.x - P.x, this.pos.z - P.z);
    this.signal = clamp(1 - (distH - this.range * 0.7) / (this.range * 0.3), 0, 1);
    const boost = input.down('ShiftLeft');
    this.battery -= (100 / DRONE_FLIGHT_SECONDS) * dt * (boost ? 1.5 : 1);
    if (this.battery <= 0) { this.battery = 0; this.crash('battery died'); return; }
    if (this.signal <= 0.02 && !this.returning) { this.returning = true; g.toast('Signal lost - drone returning home.', 'warn'); }
    if (input.hit('KeyR')) { this.returning = !this.returning; g.toast(this.returning ? 'Returning to you.' : 'Manual control.', 'info'); }
    // Controls.
    const look = input.look();
    this.yaw += look.yaw;
    this.pitch = clamp(this.pitch + look.pitch, -1.45, 0.4);
    const acc = new THREE.Vector3();
    if (this.returning) {
      const to = new THREE.Vector3(P.x - this.pos.x, Math.max(0, P.y + 6 - this.pos.y), P.z - this.pos.z);
      if (distH < 3) {
        to.y = P.y + 1.4 - this.pos.y;
        if (Math.abs(to.y) < 0.4) { this.land(); g.toast('Drone landed and packed away.', 'good'); return; }
      }
      acc.copy(to).clampLength(0, 1).multiplyScalar(14);
      this.yaw = dampAngle(this.yaw, Math.atan2(-(P.x - this.pos.x), -(P.z - this.pos.z)), 3, dt);
    } else {
      const lag = this.signal < 0.5 ? 0.4 + this.signal : 1;
      let fx = 0;
      let fz = 0;
      if (input.down('KeyW')) fz -= 1;
      if (input.down('KeyS')) fz += 1;
      if (input.down('KeyA')) fx -= 1;
      if (input.down('KeyD')) fx += 1;
      const s = Math.sin(this.yaw);
      const c = Math.cos(this.yaw);
      acc.set((fx * c + fz * s), 0, (-fx * s + fz * c)).multiplyScalar((boost ? 16 : 10) * lag);
      if (input.down('Space')) acc.y += 7 * lag;
      if (input.down('KeyC') || input.down('ControlLeft')) acc.y -= 7 * lag;
      if (input.hit('KeyQ')) this.mark();
      if (input.hit('KeyG') && distH < 5 && Math.abs(this.pos.y - P.y) < 6) { this.land(); g.toast('Drone landed.', 'good'); return; }
    }
    this.vel.addScaledVector(acc, dt);
    this.vel.multiplyScalar(Math.exp(-2.2 * dt));
    const next = this.pos.clone().addScaledVector(this.vel, dt);
    // Don't fly through buildings.
    const d = this.vel.length() * dt;
    if (d > 0 && g.cw.raycast(this.pos.x, this.pos.y, this.pos.z, this.vel.x, this.vel.y, this.vel.z, d + 0.3) < Infinity) this.vel.multiplyScalar(-0.3);
    else this.pos.copy(next);
    const ground = g.cw.groundHeight(this.pos.x, this.pos.z, this.pos.y);
    this.pos.y = clamp(this.pos.y, ground + 0.4, 90);
    this.pos.x = clamp(this.pos.x, -170, 170);
    this.pos.z = clamp(this.pos.z, -170, 170);
    this.mesh.position.copy(this.pos);
    // The camera sits inside the drone: hide it while flying from its own view.
    this.mesh.visible = g.mode !== 'drone';
    this.mesh.rotation.set(-this.vel.z * 0.03 * Math.cos(this.yaw), this.yaw, this.vel.x * 0.03, 'YXZ');
    this.sound?.setPos(this.pos);
    this.sound?.setRate(1 + this.vel.length() * 0.03);
    // The map below is revealed and people in view are spotted.
    g.mapState.reveal(this.pos.x, this.pos.z, 30 + Math.min(40, this.pos.y));
    this.spotTimer -= dt;
    if (this.spotTimer <= 0) { this.spotTimer = 0.4; this.spot(); }
    // Enemies hear the drone.
    g.noise(this.pos.x, this.pos.z, 22, 0.2, 'drone');
    if (Math.hypot(this.pos.x - g.L.lz.x, this.pos.z - g.L.lz.z) < 45) g.setFlag('lzScouted', 'You scouted the landing zone with the drone.');
    for (const e of g.enemies.alive) {
      if ((e.brain.state === 'combat' || e.brain.state === 'investigate') && Math.hypot(e.pos.x - this.pos.x, e.pos.z - this.pos.z) < 35 && Math.random() < dt * 0.6) {
        if (g.cw.lineOfSight(e.pos.x, 1.6, e.pos.z, this.pos.x, this.pos.y, this.pos.z)) {
          g.audio.play('gunshot', { pos: e.pos, weapon: 'ar' });
          if (Math.random() < 0.35) { this.hp -= 1; g.particles.emit('spark', this.pos.x, this.pos.y, this.pos.z, 5); if (this.hp <= 0) { this.crash('shot down'); return; } }
        }
      }
    }
  }

  // Frustum + line-of-sight check for teammates and enemies.
  spot() {
    const g = this.game;
    this.camera.updateMatrixWorld();
    const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse));
    const v = new THREE.Vector3();
    this.visible = [];
    for (const m of g.squad.members) {
      if (m.status === 'prologue') continue;
      v.set(m.pos.x, 0.7, m.pos.z);
      if (this.pos.distanceTo(v) > 80 || !frustum.containsPoint(v)) continue;
      if (!g.cw.lineOfSight(this.pos.x, this.pos.y, this.pos.z, v.x, v.y + 0.3, v.z)) continue;
      this.visible.push({ kind: 'mate', ref: m, label: m.status === 'dead' ? `${m.name} (KIA)` : m.name });
      if (!m.exact) g.squad.locate(m, 'drone');
    }
    for (const e of g.enemies.list) {
      v.set(e.pos.x, 1, e.pos.z);
      if (this.pos.distanceTo(v) > 90 || !frustum.containsPoint(v)) continue;
      if (!g.cw.lineOfSight(this.pos.x, this.pos.y, this.pos.z, v.x, v.y + 0.4, v.z)) continue;
      this.visible.push({ kind: e.dead ? 'body' : 'enemy', ref: e, label: e.dead ? 'Body' : 'HOSTILE' });
      if (!e.dead) g.mapState.sighting(e.pos.x, e.pos.z);
    }
  }

  mark() {
    const g = this.game;
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    let d = g.cw.raycast(this.pos.x, this.pos.y, this.pos.z, dir.x, dir.y, dir.z, 200);
    if (dir.y < -0.01) d = Math.min(d, (this.pos.y - 0.05) / -dir.y);
    if (!isFinite(d)) { g.toast('Nothing to mark there.', 'warn'); return; }
    const p = this.pos.clone().addScaledVector(dir, d);
    g.mapState.addMarker({ x: p.x, z: p.z, kind: 'poi', label: `Drone mark ${g.mapState.markers.filter((k) => k.kind === 'poi').length + 1}` });
    g.audio.play('beep', { bus: 'ui', freq: 1400 });
    g.toast('Point marked on the map.', 'info');
  }

  applyCamera(cam) {
    cam.position.copy(this.pos);
    cam.position.y -= 0.06;
    cam.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    this.camera.position.copy(cam.position);
    this.camera.quaternion.copy(cam.quaternion);
    this.camera.aspect = cam.aspect;
    this.camera.fov = cam.fov;
    this.camera.updateProjectionMatrix();
  }
}
