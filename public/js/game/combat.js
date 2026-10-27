// Weapons: first-person viewmodel, firing, reloading, aiming, throwables.

import * as THREE from 'three';
import { WEAPONS, ITEMS } from '../data/items.js';
import { buildWeaponModel } from '../world/character.js';
import * as M from '../world/materials.js';
import { UNIFORM_COLORS, SKIN_TONES } from '../data/customization.js';
import { damp, clamp } from '../core/util.js';
import { pain, disorientation } from './survival.js';
import { crackedGlass } from '../world/textures.js';

export class Combat {
  constructor(game) {
    this.game = game;
    this.scene = new THREE.Scene();
    this.cam = new THREE.PerspectiveCamera(55, 1, 0.01, 10);
    this.scene.add(new THREE.HemisphereLight(0xdfe6ee, 0x3a3530, 2.2));
    this.light = new THREE.DirectionalLight(0xffffff, 1.6);
    this.light.position.set(1, 2, 1);
    this.scene.add(this.light);
    this.flashLight = new THREE.PointLight(0xffb060, 0, 6, 2);
    this.flashLight.position.set(0.2, -0.05, -0.8);
    this.scene.add(this.flashLight);
    this.rig = new THREE.Group();
    this.scene.add(this.rig);
    this.aim = 0;
    this.aiming = false;
    this.cooldown = 0;
    this.reloading = 0;
    this.reloadTotal = 0;
    this.bloom = 0;
    this.kick = 0;
    this.swayX = 0;
    this.swayY = 0;
    this.lowered = 0;
    this.current = null;
    this.tracers = [];
    this.projectiles = [];
    this.phoneOut = 0;
  }

  // Rebuild the viewmodel (weapon change, uniform change).
  rebuild() {
    this.rig.clear();
    const g = this.game;
    const key = g.inv.activeWeapon();
    this.current = key;
    const cfg = g.config;
    const sleeve = M.camo(cfg.uniform.camo, UNIFORM_COLORS[cfg.uniform.color]);
    const handMat = cfg.gloves !== 'none' ? M.std(cfg.gloves === 'tactical' ? '#1d1f1c' : '#2a2c26', 0.7) : M.skin(SKIN_TONES[cfg.skin]);
    const skinMat = M.skin(SKIN_TONES[cfg.skin]);
    const rolled = cfg.uniform.type === 'rolled';
    const arm = (x, y, z, rx, ry) => {
      const g2 = new THREE.Group();
      const fore = new THREE.Mesh(new THREE.CapsuleGeometry(0.04, 0.32, 4, 8), rolled ? skinMat : sleeve);
      fore.rotation.x = Math.PI / 2;
      fore.position.z = 0.2;
      g2.add(fore);
      const hand = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.05, 0.11), handMat);
      g2.add(hand);
      g2.position.set(x, y, z);
      g2.rotation.set(rx, ry, 0);
      this.rig.add(g2);
      return g2;
    };
    if (key) {
      const w = buildWeaponModel(key);
      w.scale.setScalar(0.9);
      w.traverse((o) => { if (o.isMesh) o.castShadow = false; });
      this.weaponMesh = w;
      this.rig.add(w);
      const long = key === 'pistol' ? 0.12 : 0.3;
      this.handR = arm(0.0, -0.045, 0.02, 0.15, -0.1);
      this.handL = arm(-0.02, -0.02, -long, 0.1, 0.25);
      this.muzzleZ = key === 'pistol' ? -0.18 : key === 'smg' ? -0.38 : key === 'shotgun' ? -0.7 : key === 'dmr' ? -0.85 : key === 'carbine' ? -0.6 : -0.7;
    } else {
      this.weaponMesh = null;
      this.handR = arm(0.05, -0.05, 0, 0.3, 0);
    }
    // The damaged phone (shown when the phone is out).
    const phone = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.15, 0.009), M.std('#1a1b1d', 0.4, 0.4));
    phone.add(body);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.068, 0.14), new THREE.MeshBasicMaterial({ color: g.phone?.battery > 0 ? '#2b4a66' : '#050608' }));
    screen.position.z = 0.0051;
    phone.add(screen);
    const crack = new THREE.Mesh(new THREE.PlaneGeometry(0.068, 0.14), new THREE.MeshBasicMaterial({ map: crackedGlass(), transparent: true }));
    crack.position.z = 0.0053;
    crack.visible = g.phone?.screen !== 'ok';
    phone.add(crack);
    phone.position.set(0.02, -0.12, -0.28);
    phone.rotation.set(-0.25, 0.05, 0);
    this.phoneMesh = phone;
    this.phoneScreen = screen;
    this.scene.add(phone);
    phone.visible = false;
  }

  setAspect(a) {
    this.cam.aspect = a;
    this.cam.updateProjectionMatrix();
  }

  switchTo(slot) {
    const inv = this.game.inv;
    if (slot === 'sidearm' && !inv.sidearm) return;
    if (slot === 'primary' && !inv.primary) return;
    if (inv.active === slot && this.current === inv.activeWeapon()) return;
    inv.active = slot;
    this.reloading = 0;
    this.lowered = 1;
    this.rebuild();
    this.game.audio.play('reload', { gain: 0.4 });
  }

  update(dt, input, canAct) {
    const g = this.game;
    const inv = g.inv;
    if (this.current !== inv.activeWeapon()) this.rebuild();
    const key = this.current;
    const W = key ? WEAPONS[key] : null;
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.bloom = Math.max(0, this.bloom - dt * 3);
    this.kick = damp(this.kick, 0, 12, dt);
    if (canAct) {
      if (input.hit('Digit1')) this.switchTo('primary');
      if (input.hit('Digit2')) this.switchTo('sidearm');
      if (input.mouse.wheel) this.switchTo(inv.active === 'primary' ? 'sidearm' : 'primary');
    }
    const sprinting = g.player.sprinting;
    this.aiming = canAct && !!W && input.button(2) && !sprinting && this.reloading <= 0;
    this.aim = damp(this.aim, this.aiming ? 1 : 0, 14, dt);
    const lowerTarget = !canAct || sprinting ? 1 : 0;
    this.lowered = damp(this.lowered, lowerTarget, 8, dt);

    // Reload.
    if (W && canAct && input.hit('KeyR') && this.reloading <= 0 && (inv.mags[key] || 0) < W.mag && inv.reserve(key) > 0) {
      this.reloadTotal = this.reloading = key === 'shotgun' ? 0.55 * Math.min(W.mag - (inv.mags[key] || 0), inv.reserve(key)) : key === 'dmr' ? 2.4 : 1.9;
      g.audio.play('reload', { gain: 0.7 });
    }
    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) { inv.reload(key); this.reloading = 0; }
    }
    // Fire.
    if (W && canAct && this.reloading <= 0 && this.lowered < 0.3) {
      const trigger = W.auto ? input.button(0) : input.clicked(0);
      if (trigger && this.cooldown <= 0) {
        if ((inv.mags[key] || 0) > 0) this.fire(key, W);
        else if (input.clicked(0)) { g.audio.play('empty', { gain: 0.8 }); this.cooldown = 0.25; g.toast('Empty - press R to reload', 'warn'); }
      }
    }
    // Throwables.
    if (canAct && input.hit('KeyT')) this.throwSmoke();
    this.updateProjectiles(dt);
    this.updateTracers(dt);
    this.updateViewmodel(dt, input);
  }

  fire(key, W) {
    const g = this.game;
    const inv = g.inv;
    inv.mags[key] -= 1;
    this.cooldown = 60 / W.rpm;
    const cam = g.camera;
    const origin = cam.position.clone();
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    const v = g.vitals;
    let spread = W.spread * (1 - this.aim * 0.75) + this.bloom * 1.2;
    if (g.player.moving) spread *= g.player.sprinting ? 2.5 : 1.5;
    if (g.player.crouched) spread *= 0.7;
    spread *= g.stats.aimSteady * (1 + pain(v) * 0.8 + disorientation(v) * 1.2);
    const pellets = W.pellets || 1;
    const muzzle = origin.clone().addScaledVector(fwd, 0.7).addScaledVector(right, 0.12 * (1 - this.aim)).addScaledVector(up, -0.08);
    for (let i = 0; i < pellets; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = (Math.random() ** 0.7) * (spread * Math.PI) / 180;
      const dir = fwd.clone().addScaledVector(right, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r).normalize();
      this.trace(origin, dir, W, muzzle, i === 0);
    }
    this.bloom = Math.min(3, this.bloom + 0.35 * W.recoil);
    this.kick = Math.min(1, this.kick + 0.5 * W.recoil);
    g.player.pitch += 0.012 * W.recoil * (1 - this.aim * 0.4);
    g.player.yaw += (Math.random() - 0.5) * 0.006 * W.recoil;
    g.particles.emit('muzzle', muzzle.x, muzzle.y, muzzle.z, 2, { exact: true });
    this.flashLight.intensity = 3;
    g.muzzleFlash(muzzle);
    g.audio.play('gunshot', { weapon: key, gain: 1, noDelay: true });
    g.noise(g.player.pos.x, g.player.pos.z, W.noise, 1, 'gunshot');
    g.stats.shotsFired = (g.stats.shotsFired || 0) + 1;
  }

  trace(origin, dir, W, muzzle, tracer) {
    const g = this.game;
    const dWorld = g.cw.raycast(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, W.range);
    const hit = g.enemies.raycast(origin, dir, Math.min(W.range, dWorld));
    let end;
    if (hit) {
      end = origin.clone().addScaledVector(dir, hit.dist);
      const mult = hit.part === 'head' ? 3 : hit.part === 'limb' ? 0.7 : 1;
      hit.enemy.damage(W.damage * mult, hit.part, g.player.pos);
      g.particles.emit('puff', end.x, end.y, end.z, 3, { color: [0.35, 0.1, 0.08] });
      g.hitMarker(hit.part === 'head');
    } else if (dWorld < W.range) {
      end = origin.clone().addScaledVector(dir, dWorld);
      g.particles.emit('puff', end.x, end.y, end.z, 4);
      g.particles.emit('spark', end.x, end.y, end.z, 2, { scale: 0.25 });
      g.audio.play('impact', { pos: end, gain: 0.6 });
    } else end = origin.clone().addScaledVector(dir, W.range);
    if (tracer && Math.random() < 0.5) this.addTracer(muzzle, end);
  }

  addTracer(a, b) {
    const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.8 }));
    this.game.scene.add(line);
    this.tracers.push({ line, life: 0.06 });
  }

  updateTracers(dt) {
    this.flashLight.intensity = damp(this.flashLight.intensity, 0, 30, dt);
    this.tracers = this.tracers.filter((t) => {
      t.life -= dt;
      if (t.life > 0) return true;
      this.game.scene.remove(t.line);
      t.line.geometry.dispose();
      t.line.material.dispose();
      return false;
    });
  }

  throwSmoke() {
    const g = this.game;
    if (!g.inv.has('smoke_grenade')) { g.toast('No smoke grenades', 'warn'); return; }
    g.inv.remove('smoke_grenade');
    const cam = g.camera;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.12, 8), M.std('#3a4a2a', 0.6));
    mesh.position.copy(cam.position).addScaledVector(fwd, 0.5);
    g.scene.add(mesh);
    this.projectiles.push({ kind: 'smoke', mesh, vel: fwd.multiplyScalar(14).add(new THREE.Vector3(0, 4, 0)), t: 0 });
    g.audio.play('pickup', { gain: 0.6 });
  }

  // Signal flare fired straight up from (x, z). The game moves its pooled
  // flare light along with it.
  fireFlare(x = this.game.player.pos.x, z = this.game.player.pos.z) {
    const g = this.game;
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 6), new THREE.MeshBasicMaterial({ color: '#ff3a20' }));
    mesh.position.set(x, g.player.pos.y + 1.8, z);
    g.scene.add(mesh);
    this.projectiles.push({ kind: 'flare', mesh, vel: new THREE.Vector3((Math.random() - 0.5) * 2, 38, (Math.random() - 0.5) * 2), t: 0 });
    g.audio.play('flare', { gain: 1 });
  }

  updateProjectiles(dt) {
    const g = this.game;
    this.projectiles = this.projectiles.filter((p) => {
      p.t += dt;
      const m = p.mesh;
      if (p.kind === 'smoke') {
        if (!p.landed) {
          p.vel.y -= 9.8 * dt;
          const next = m.position.clone().addScaledVector(p.vel, dt);
          const d = g.cw.raycast(m.position.x, m.position.y, m.position.z, p.vel.x, p.vel.y, p.vel.z, p.vel.length() * dt);
          if (d < Infinity) p.vel.multiplyScalar(-0.3);
          else m.position.copy(next);
          const ground = g.cw.groundHeight(m.position.x, m.position.z, m.position.y + 0.3);
          if (m.position.y <= ground + 0.04) {
            m.position.y = ground + 0.04;
            p.vel.multiplyScalar(0.3);
            p.vel.y = Math.abs(p.vel.y) * 0.2;
            if (p.vel.length() < 0.6) {
              p.landed = true;
              g.addSmoke(m.position.x, m.position.z, ground);
            }
          }
        }
        if (p.t > 50) { g.scene.remove(m); return false; }
        return true;
      }
      if (p.kind === 'flare') {
        if (p.t < 1.6) {
          p.vel.y -= 9.8 * dt * 0.5;
          m.position.addScaledVector(p.vel, dt);
        } else {
          // Hangs under its parachute, drifting down.
          m.position.y -= dt * 2.2;
          m.position.x += g.particles.wind.x * dt;
          m.position.z += g.particles.wind.z * dt;
        }
        if (Math.random() < 0.6) g.particles.emit('flare', m.position.x, m.position.y, m.position.z, 1, { exact: true });
        if (p.t > 22 || m.position.y < 1) { g.scene.remove(m); return false; }
        return true;
      }
      return false;
    });
  }

  updateViewmodel(dt, input) {
    const g = this.game;
    const look = input.look();
    this.swayX = damp(this.swayX, clamp(-look.yaw * 3, -0.06, 0.06), 8, dt);
    this.swayY = damp(this.swayY, clamp(look.pitch * 3, -0.06, 0.06), 8, dt);
    const p = g.player;
    const bob = p.moving ? Math.sin(p.bob * 2) * (p.sprinting ? 0.022 : 0.01) : Math.sin(p.t * 1.6) * 0.002;
    const bobX = p.moving ? Math.cos(p.bob) * (p.sprinting ? 0.03 : 0.012) : 0;
    const hip = new THREE.Vector3(0.2, -0.21, -0.62);
    const ads = new THREE.Vector3(0, key2SightDrop(this.current), -0.5);
    const pos = hip.lerp(ads, this.aim);
    const r = this.rig;
    const rl = this.reloading > 0 ? Math.sin((1 - this.reloading / this.reloadTotal) * Math.PI) : 0;
    r.position.set(pos.x + this.swayX + bobX * (1 - this.aim), pos.y + this.swayY + bob * (1 - this.aim * 0.8) - this.lowered * 0.25 - rl * 0.08, pos.z + this.kick * 0.06);
    r.rotation.set(this.kick * 0.12 + this.lowered * -0.5 + rl * -0.6, this.lowered * 0.6 + rl * 0.3, this.lowered * 0.3 + rl * 0.4);
    // FOV zoom when aiming.
    const zoom = this.current === 'dmr' ? 32 : 52;
    const base = g.settings.fov;
    g.camera.fov = damp(g.camera.fov, base + (zoom - base) * this.aim, 14, dt);
    g.camera.updateProjectionMatrix();
    this.phoneOut = damp(this.phoneOut, g.ui.phoneOpen ? 1 : 0, 10, dt);
    this.phoneMesh.visible = this.phoneOut > 0.02;
    this.phoneMesh.position.y = -0.12 - (1 - this.phoneOut) * 0.3;
    r.visible = this.phoneOut < 0.6;
    this.light.intensity = 0.6 + (1 - g.darkness) * 1.4;
  }
}

function key2SightDrop(key) {
  return key === 'pistol' ? -0.075 : key === 'dmr' ? -0.115 : -0.098;
}

export function itemIsThrowable(id) { return ITEMS[id]?.id === 'smoke_grenade'; }
