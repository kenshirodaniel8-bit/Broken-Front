// First-person player controller: movement, collision, stamina, injuries,
// head bob, footsteps (which make noise the enemy can hear), camera shake.

import * as THREE from 'three';
import { clamp, damp, lerp } from '../core/util.js';
import { STEP } from '../world/collision.js';
import { insideInterior } from '../world/collision.js';
import { canSprint, movementFactor, disorientation, pain, tickStamina } from './survival.js';

const EYE = 1.62;
const EYE_CROUCH = 1.05;
const RADIUS = 0.32;

export class Player {
  constructor(game) {
    this.game = game;
    this.pos = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.vy = 0;
    this.onGround = true;
    this.crouch = 0; // 0..1 blend
    this.crouched = false;
    this.sprinting = false;
    this.moving = false;
    this.speed = 0;
    this.bob = 0;
    this.stepDist = 0;
    this.trauma = 0; // camera shake 0..1
    this.knockdown = 0; // 0 standing .. 1 on the ground
    this.roll = 0;
    this.flashlightOn = false;
    this.indoors = null;
    this.frozen = false;
    this.lookOnly = false;
    this.fallStartY = 0;
    this.surface = 'concrete';
    this.t = 0;
    this.camOffset = new THREE.Vector3();
  }

  get height() { return lerp(1.75, 1.2, this.crouch); }
  get eye() { return lerp(EYE, EYE_CROUCH, this.crouch); }

  place(x, y, z, yaw = this.yaw) {
    this.pos.set(x, y, z);
    this.yaw = yaw;
    this.pitch = 0;
    this.vy = 0;
  }

  forward(out = new THREE.Vector3()) {
    return out.set(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
  }

  update(dt, input) {
    const g = this.game;
    const v = g.vitals;
    const stats = g.stats;
    this.t += dt;
    // Look.
    const look = input.look();
    if (!this.frozen || this.lookOnly) {
      this.yaw += look.yaw;
      this.pitch = clamp(this.pitch + look.pitch, -1.45, 1.45);
    }
    // Stance.
    if (input.hit('KeyC') || input.hit('ControlLeft')) this.crouched = !this.crouched;
    this.crouch = damp(this.crouch, this.crouched ? 1 : 0, 10, dt);

    let mx = 0;
    let mz = 0;
    if (!this.frozen) {
      if (input.down('KeyW') || input.down('ArrowUp')) mz -= 1;
      if (input.down('KeyS') || input.down('ArrowDown')) mz += 1;
      if (input.down('KeyA') || input.down('ArrowLeft')) mx -= 1;
      if (input.down('KeyD') || input.down('ArrowRight')) mx += 1;
    }
    const len = Math.hypot(mx, mz);
    this.moving = len > 0;
    const load = g.inv.load();
    const wantSprint = (input.down('ShiftLeft') || input.down('ShiftRight')) && mz < 0 && this.moving;
    this.sprinting = wantSprint && canSprint(v) && v.stamina > 2 && load < 1.25 && !this.crouched;
    let speed = this.crouched ? 1.55 * stats.crouchSpeedMult : this.sprinting ? 5.7 : 3.1;
    speed *= stats.speedMult * movementFactor(v);
    if (load > 1) speed *= Math.max(0.42, 1 - (load - 1) * 0.9);
    if (g.combat?.aiming) speed *= 0.6;
    this.speed = this.moving ? speed : 0;
    if (this.moving) {
      mx /= len;
      mz /= len;
      const s = Math.sin(this.yaw);
      const c = Math.cos(this.yaw);
      const dx = (mx * c + mz * s) * speed * dt;
      const dz = (-mx * s + mz * c) * speed * dt;
      const before = this.pos.clone();
      g.cw.move(this.pos, dx, dz, RADIUS, this.height);
      const moved = Math.hypot(this.pos.x - before.x, this.pos.z - before.z);
      this.stepDist += moved;
      this.bob += moved * (this.sprinting ? 1.25 : 1.7);
      const stride = this.sprinting ? 2.0 : this.crouched ? 1.1 : 1.45;
      if (this.stepDist > stride && this.onGround) {
        this.stepDist = 0;
        this.footstep();
      }
    }
    tickStamina(v, dt, { sprinting: this.sprinting, load, drainMult: stats.staminaDrainMult });
    // Gravity, stepping and jumping.
    const ground = g.cw.groundHeight(this.pos.x, this.pos.z, this.pos.y, RADIUS);
    if (this.onGround && input.hit('Space') && !this.frozen && v.stamina > 10 && !this.crouched) {
      this.vy = 4.2;
      this.onGround = false;
      tickStamina(v, 0, { jumping: true });
    }
    if (!this.onGround || this.pos.y > ground + 0.01) {
      if (this.onGround && this.pos.y - ground < STEP + 0.05 && this.vy <= 0) {
        this.pos.y = damp(this.pos.y, ground, 25, dt);
        if (Math.abs(this.pos.y - ground) < 0.01) this.pos.y = ground;
      } else {
        if (this.onGround) this.fallStartY = this.pos.y;
        this.onGround = false;
        this.vy -= 18 * dt;
        this.pos.y += this.vy * dt;
        if (this.pos.y <= ground) {
          const fall = this.fallStartY - ground;
          this.pos.y = ground;
          this.onGround = true;
          const impact = -this.vy;
          this.vy = 0;
          if (fall > 3.2) g.onFall(fall, impact);
          else this.footstep(0.8);
        }
      }
    } else if (this.pos.y < ground) {
      // Stepping up onto a kerb, mat or ramp.
      this.pos.y = damp(this.pos.y, ground, 30, dt);
      if (ground - this.pos.y < 0.005) this.pos.y = ground;
    }
    // Ceiling check.
    if (this.vy > 0 && g.cw.blocked(this.pos.x, this.pos.z, this.pos.y + 0.3, RADIUS * 0.8, this.height)) this.vy = 0;

    this.indoors = insideInterior(g.L, this.pos.x, this.pos.z, this.pos.y);
    this.trauma = Math.max(0, this.trauma - dt * 0.7);
  }

  footstep(gain = 1) {
    const g = this.game;
    this.surface = g.surfaceAt(this.pos.x, this.pos.z, this.indoors);
    const quiet = this.crouched ? g.stats.crouchNoiseMult * 0.35 : 1;
    const radius = (this.sprinting ? 17 : this.crouched ? 2.5 : 7) * g.stats.noiseMult * (this.crouched ? g.stats.crouchNoiseMult : 1);
    g.audio.play('footstep', { surface: this.surface, gain: gain * (this.sprinting ? 1.1 : 0.7) * quiet, noDelay: true });
    g.noise(this.pos.x, this.pos.z, radius, this.sprinting ? 0.35 : 0.15, 'player');
  }

  // Positions the camera: eye height, bob, disorientation, shake, knockdown.
  applyCamera(cam, dt) {
    const g = this.game;
    const v = g.vitals;
    const dis = disorientation(v);
    const p = pain(v);
    const bobAmt = this.moving && this.onGround ? (this.sprinting ? 0.065 : this.crouched ? 0.025 : 0.04) : 0;
    const by = Math.sin(this.bob * 2) * bobAmt;
    const bx = Math.cos(this.bob) * bobAmt * 0.6;
    const limp = movementFactor(v) < 0.6 && this.moving ? Math.abs(Math.sin(this.bob)) * 0.08 : 0;
    const eye = lerp(this.eye, 0.28, this.knockdown);
    cam.position.set(this.pos.x, this.pos.y + eye + by - limp, this.pos.z);
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    cam.position.addScaledVector(right, bx);
    // Disorientation: slow drifting wobble. Shake: fast jitter scaled by trauma^2.
    const t = this.t;
    const wob = dis * 0.05;
    const sh = this.trauma * this.trauma;
    const shake = (f, s) => Math.sin(t * f + s) * Math.sin(t * f * 0.71 + s * 2.3);
    const yaw = this.yaw + Math.sin(t * 0.7) * wob + shake(31, 1) * sh * 0.08 + Math.sin(t * 2.3) * p * 0.004;
    const pitch = this.pitch + Math.sin(t * 0.53 + 1) * wob * 0.7 + shake(27, 4) * sh * 0.07 + Math.sin(t * 3.1) * p * 0.004;
    const roll = Math.sin(t * 0.41) * wob * 0.8 + shake(23, 7) * sh * 0.05 + this.roll * this.knockdown + (this.moving ? -bx * 0.15 : 0);
    cam.rotation.set(0, 0, 0, 'YXZ');
    cam.rotation.y = yaw;
    cam.rotation.x = pitch;
    cam.rotation.z = roll;
    if (sh > 0) cam.position.y += shake(40, 9) * sh * 0.06;
  }
}
