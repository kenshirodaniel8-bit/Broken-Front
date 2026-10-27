// Pooled point-sprite particles (one draw call per blend mode) and simple
// ballistic debris chunks. Emitters spawn particles continuously for fires
// and smoke columns.

import * as THREE from 'three';
import { smokeSprite, glowSprite } from './textures.js';

const VERT = /* glsl */`
attribute float size;
attribute vec4 pcolor;
attribute float angle;
varying vec4 vColor;
varying float vAngle;
uniform float uScale;
#include <fog_pars_vertex>
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  gl_PointSize = min(size * uScale / max(0.1, -mvPosition.z), 900.0);
  vColor = pcolor;
  vAngle = angle;
  #include <fog_vertex>
}`;

const FRAG = /* glsl */`
uniform sampler2D map;
varying vec4 vColor;
varying float vAngle;
#include <fog_pars_fragment>
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float s = sin(vAngle), co = cos(vAngle);
  c = vec2(c.x * co - c.y * s, c.x * s + c.y * co) + 0.5;
  vec4 t = texture2D(map, c);
  gl_FragColor = vec4(vColor.rgb, vColor.a * t.a);
  if (gl_FragColor.a < 0.004) discard;
  #include <fog_fragment>
}`;

const PRESETS = {
  smoke: { blend: 'alpha', life: [7, 11], size: [2.5, 11], color: [0.22, 0.21, 0.2], alpha: [0.5, 0], vel: [0.6, 1.6, 0.6], up: 1.4, drag: 0.15, wind: 1 },
  smoke_light: { blend: 'alpha', life: [5, 8], size: [1.5, 6], color: [0.55, 0.52, 0.48], alpha: [0.35, 0], vel: [0.5, 1, 0.5], up: 1.0, drag: 0.2, wind: 1 },
  dust: { blend: 'alpha', life: [4, 9], size: [3, 14], color: [0.55, 0.5, 0.44], alpha: [0.75, 0], vel: [9, 2, 9], up: 0.6, drag: 0.9, wind: 0.6 },
  puff: { blend: 'alpha', life: [0.6, 1.2], size: [0.3, 1.2], color: [0.5, 0.47, 0.42], alpha: [0.6, 0], vel: [0.8, 0.8, 0.8], up: 0.4, drag: 2 },
  fire: { blend: 'add', life: [0.5, 1.1], size: [1.2, 0.3], color: [1.0, 0.45, 0.12], alpha: [0.9, 0], vel: [0.4, 0.4, 0.4], up: 2.4, drag: 0.6 },
  ember: { blend: 'add', life: [1, 2.2], size: [0.12, 0.05], color: [1.0, 0.55, 0.2], alpha: [1, 0], vel: [1, 1.5, 1], up: 2.5, drag: 0.3, wind: 1 },
  spark: { blend: 'add', life: [0.3, 0.9], size: [0.18, 0.05], color: [1.0, 0.8, 0.4], alpha: [1, 0], vel: [9, 9, 9], up: 3, gravity: 9.8, drag: 0.4 },
  flash: { blend: 'add', life: [0.18, 0.3], size: [26, 50], color: [1.0, 0.9, 0.7], alpha: [1, 0], vel: [0, 0, 0] },
  fireball: { blend: 'add', life: [0.7, 1.4], size: [5, 13], color: [1.0, 0.5, 0.15], alpha: [1, 0], vel: [5, 5, 5], up: 3, drag: 1.5 },
  glass: { blend: 'add', life: [1.2, 2.2], size: [0.07, 0.07], color: [0.8, 0.9, 1.0], alpha: [0.9, 0.2], vel: [5, 3, 5], up: 2, gravity: 9.8, drag: 0.1 },
  muzzle: { blend: 'add', life: [0.04, 0.06], size: [0.5, 0.2], color: [1.0, 0.8, 0.45], alpha: [1, 0], vel: [0, 0, 0] },
  signal_red: { blend: 'alpha', life: [5, 8], size: [1, 6], color: [0.85, 0.15, 0.12], alpha: [0.8, 0], vel: [0.4, 1.2, 0.4], up: 2.2, drag: 0.2, wind: 1 },
  flare: { blend: 'add', life: [0.4, 0.7], size: [1.4, 0.4], color: [1.0, 0.2, 0.1], alpha: [1, 0], vel: [0.3, 0.3, 0.3], up: 0.5, drag: 1 },
};

class PointPool {
  constructor(scene, capacity, additive) {
    this.cap = capacity;
    this.n = 0;
    this.pos = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 4);
    this.size = new Float32Array(capacity);
    this.angle = new Float32Array(capacity);
    this.p = []; // particle state objects
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('pcolor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('angle', new THREE.BufferAttribute(this.angle, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo = geo;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { map: { value: null }, uScale: { value: 500 } }]),
      transparent: true,
      depthWrite: false,
      fog: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mat.uniforms.map.value = additive ? glowSprite() : smokeSprite();
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 3 : 2;
    scene.add(this.points);
  }

  spawn(o) {
    if (this.p.length >= this.cap) this.p.shift();
    this.p.push(o);
  }

  update(dt, wind) {
    const live = [];
    for (const q of this.p) {
      q.age += dt;
      if (q.age >= q.life) continue;
      const k = Math.exp(-q.drag * dt);
      q.vx = q.vx * k + wind.x * q.wind * dt * 0.5;
      q.vz = q.vz * k + wind.z * q.wind * dt * 0.5;
      q.vy = q.vy * k + (q.up - q.gravity) * dt;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.z += q.vz * dt;
      if (q.y < 0.05 && q.gravity) { q.y = 0.05; q.vy *= -0.3; q.vx *= 0.5; q.vz *= 0.5; }
      q.rot += q.spin * dt;
      live.push(q);
    }
    this.p = live;
    const n = Math.min(live.length, this.cap);
    for (let i = 0; i < n; i++) {
      const q = live[i];
      const t = q.age / q.life;
      this.pos[i * 3] = q.x; this.pos[i * 3 + 1] = q.y; this.pos[i * 3 + 2] = q.z;
      const fadeIn = Math.min(1, q.age / Math.max(0.05, q.life * 0.08));
      this.col[i * 4] = q.r; this.col[i * 4 + 1] = q.g; this.col[i * 4 + 2] = q.b;
      this.col[i * 4 + 3] = (q.a0 + (q.a1 - q.a0) * t) * fadeIn;
      this.size[i] = q.s0 + (q.s1 - q.s0) * Math.sqrt(t);
      this.angle[i] = q.rot;
    }
    this.geo.setDrawRange(0, n);
    for (const a of ['position', 'pcolor', 'size', 'angle']) this.geo.attributes[a].needsUpdate = true;
  }
}

export class Particles {
  constructor(scene, quality) {
    this.scene = scene;
    this.mult = quality.particles ?? 1;
    this.alpha = new PointPool(scene, Math.round(2600 * this.mult), false);
    this.add = new PointPool(scene, Math.round(1800 * this.mult), true);
    this.emitters = new Set();
    this.wind = new THREE.Vector3(0.9, 0, 0.35);
    this.debris = new Debris(scene, Math.round(260 * this.mult));
  }

  setViewport(height, fov) {
    const s = height / (2 * Math.tan((fov * Math.PI) / 360));
    this.alpha.mat.uniforms.uScale.value = s;
    this.add.mat.uniforms.uScale.value = s;
  }

  emit(type, x, y, z, count = 1, opts = {}) {
    const P = PRESETS[type];
    const pool = P.blend === 'add' ? this.add : this.alpha;
    const n = Math.max(1, Math.round(count * (opts.exact ? 1 : this.mult)));
    const sc = opts.scale || 1;
    for (let i = 0; i < n; i++) {
      const life = P.life[0] + Math.random() * (P.life[1] - P.life[0]);
      const v = P.vel;
      const dir = opts.dir;
      const shade = opts.color || P.color;
      const jitter = 0.9 + Math.random() * 0.2;
      pool.spawn({
        x: x + (Math.random() - 0.5) * (opts.spread || 0), y: y + (Math.random() - 0.5) * (opts.spreadY ?? opts.spread ?? 0), z: z + (Math.random() - 0.5) * (opts.spread || 0),
        vx: (Math.random() - 0.5) * 2 * v[0] * sc + (dir ? dir.x : 0), vy: (Math.random() - 0.3) * v[1] * sc + (dir ? dir.y : 0), vz: (Math.random() - 0.5) * 2 * v[2] * sc + (dir ? dir.z : 0),
        age: 0, life: life * (opts.lifeMult || 1), s0: P.size[0] * sc, s1: P.size[1] * sc, a0: P.alpha[0] * (opts.alpha ?? 1), a1: P.alpha[1],
        r: shade[0] * jitter, g: shade[1] * jitter, b: shade[2] * jitter,
        drag: P.drag || 0, up: P.up || 0, gravity: P.gravity || 0, wind: P.wind || 0, rot: Math.random() * 6.28, spin: (Math.random() - 0.5) * 0.6,
      });
    }
  }

  // A continuous source. Returns the emitter so it can be removed.
  emitter(type, x, y, z, rate, opts = {}) {
    const e = { type, x, y, z, rate, acc: Math.random(), opts, active: true, maxDist: opts.maxDist || 220 };
    this.emitters.add(e);
    return e;
  }

  remove(e) { this.emitters.delete(e); }

  clearEmitters() { this.emitters.clear(); }

  explosion(x, y, z, scale = 1) {
    this.emit('flash', x, y + 1, z, 2, { exact: true, scale });
    this.emit('fireball', x, y + 1.5, z, 14, { spread: 3 * scale, scale });
    this.emit('spark', x, y + 1, z, 40, { scale: scale * 1.2 });
    this.emit('dust', x, y + 1, z, 34, { spread: 4 * scale, scale });
    this.emit('smoke', x, y + 3, z, 16, { spread: 6 * scale, scale: scale * 1.3 });
    this.debris.burst(x, y + 1.5, z, Math.round(40 * scale), 14 * scale);
  }

  update(dt, camPos) {
    for (const e of this.emitters) {
      if (!e.active) continue;
      if (camPos && Math.hypot(e.x - camPos.x, e.z - camPos.z) > e.maxDist) continue;
      e.acc += e.rate * dt;
      while (e.acc >= 1) {
        e.acc -= 1;
        this.emit(e.type, e.x, e.y, e.z, 1, { exact: true, ...e.opts });
      }
    }
    this.alpha.update(dt, this.wind);
    this.add.update(dt, this.wind);
    this.debris.update(dt);
  }
}

// Concrete and brick chunks thrown by explosions.
class Debris {
  constructor(scene, cap) {
    this.cap = cap;
    const geo = new THREE.DodecahedronGeometry(0.22, 0);
    const mat = new THREE.MeshStandardMaterial({ color: '#8a8178', roughness: 0.95 });
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.count = 0;
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    scene.add(this.mesh);
    this.items = [];
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.e = new THREE.Euler();
    this.v = new THREE.Vector3();
    this.s = new THREE.Vector3();
  }

  burst(x, y, z, n, speed) {
    for (let i = 0; i < n; i++) {
      if (this.items.length >= this.cap) this.items.shift();
      const a = Math.random() * Math.PI * 2;
      const up = 0.3 + Math.random() * 0.9;
      const sp = speed * (0.3 + Math.random() * 0.7);
      this.items.push({
        x, y, z, vx: Math.cos(a) * sp, vy: up * sp, vz: Math.sin(a) * sp, rx: 0, ry: 0, rz: 0, wx: (Math.random() - 0.5) * 12, wy: (Math.random() - 0.5) * 12, wz: (Math.random() - 0.5) * 12,
        s: 0.4 + Math.random() * 1.6, rest: false, age: 0, brick: Math.random() < 0.35,
      });
    }
  }

  update(dt) {
    const items = this.items;
    for (const d of items) {
      d.age += dt;
      if (d.rest) continue;
      d.vy -= 9.8 * dt;
      d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
      d.rx += d.wx * dt; d.ry += d.wy * dt; d.rz += d.wz * dt;
      if (d.y < 0.08 * d.s) {
        d.y = 0.08 * d.s;
        d.vy *= -0.3; d.vx *= 0.55; d.vz *= 0.55; d.wx *= 0.5; d.wy *= 0.5; d.wz *= 0.5;
        if (Math.abs(d.vy) < 0.6 && Math.hypot(d.vx, d.vz) < 0.4) d.rest = true;
      }
    }
    // Old debris fades out to keep the pool small.
    this.items = items.filter((d) => d.age < 90);
    const n = Math.min(this.items.length, this.cap);
    for (let i = 0; i < n; i++) {
      const d = this.items[i];
      this.e.set(d.rx, d.ry, d.rz);
      this.q.setFromEuler(this.e);
      this.mesh.setMatrixAt(i, this.m.compose(this.v.set(d.x, d.y, d.z), this.q, this.s.set(d.s, d.s * 0.7, d.s)));
      const c = d.brick ? [0.55, 0.3, 0.22] : [0.6, 0.57, 0.53];
      this.mesh.instanceColor.setXYZ(i, c[0], c[1], c[2]);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
  }
}
