// Sky dome, sun/moon lighting, fog and the day-night cycle. After the strike
// the palette shifts to a dusty, smoke-filtered brown.

import * as THREE from 'three';
import { clamp, lerp, smoothstep } from '../core/util.js';

const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * p;
  gl_Position.z = gl_Position.w; // always at the far plane
}`;

const SKY_FRAG = /* glsl */`
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uStars;
uniform float uHaze;
varying vec3 vDir;
float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453); }
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHorizon, uTop, pow(clamp(h, 0.0, 1.0), 0.55));
  col = mix(col, uGround, smoothstep(0.0, -0.25, h));
  float sd = max(dot(d, normalize(uSunDir)), 0.0);
  col += uSunColor * (pow(sd, 900.0) * 3.0 + pow(sd, 12.0) * 0.35 * (1.0 - uHaze * 0.5));
  // Haze band at the horizon.
  col = mix(col, uHorizon, uHaze * (1.0 - smoothstep(0.0, 0.35, abs(h))));
  if (uStars > 0.0 && h > 0.0) {
    vec3 g = floor(d * 380.0);
    float s = step(0.9975, hash(g));
    col += vec3(s) * uStars * smoothstep(0.0, 0.3, h);
  }
  gl_FragColor = vec4(col, 1.0);
}`;

export class Sky {
  constructor(scene, quality) {
    this.scene = scene;
    this.uniforms = {
      uTop: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uGround: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: new THREE.Color() }, uStars: { value: 0 }, uHaze: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({ vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, uniforms: this.uniforms, side: THREE.BackSide, depthWrite: false, fog: false });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), mat);
    this.dome.renderOrder = -1;
    this.dome.frustumCulled = false;
    scene.add(this.dome);
    this.sun = new THREE.DirectionalLight(0xffffff, 2.5);
    this.sun.castShadow = quality.shadows > 0;
    const size = quality.shadows >= 2 ? 2048 : 1024;
    this.sun.shadow.mapSize.set(size, size);
    const r = quality.shadows >= 2 ? 70 : 50;
    Object.assign(this.sun.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 1, far: 400 });
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun);
    scene.add(this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xbcd4ec, 0x4a4238, 2.5);
    scene.add(this.hemi);
    scene.fog = new THREE.FogExp2(0xc8d4e0, 0.004);
    this.ruined = false;
    this.flash = 0;
    this.darkness = 0;
  }

  setRuined(r) { this.ruined = r; }

  // minutes: time of day. Returns darkness 0 (noon) .. 1 (night).
  update(minutes, focus, fogDensity = 1) {
    const t = minutes / 1440;
    // Sun rises ~05:30 and sets ~21:00 (German summer).
    const dayFrac = (minutes - 330) / (1260 - 330);
    const elev = Math.sin(clamp(dayFrac, -0.15, 1.15) * Math.PI);
    // Azimuth clockwise from north: east in the morning, south at noon, west at dusk.
    const az = lerp(1.2, 5.1, clamp(dayFrac, 0, 1));
    const horiz = Math.sqrt(Math.max(0.05, 1 - elev * elev));
    const sunDir = new THREE.Vector3(Math.sin(az) * horiz, elev, -Math.cos(az) * horiz).normalize();
    const day = smoothstep(-0.12, 0.25, elev);
    const golden = smoothstep(0.35, 0.05, elev) * day;
    this.darkness = 1 - day;
    const U = this.uniforms;
    const r = this.ruined;
    const top = new THREE.Color(r ? '#7d8288' : '#3d6fb0').lerp(new THREE.Color('#05070d'), 1 - day);
    const hor = new THREE.Color(r ? '#c2b094' : '#c7d9ea').lerp(new THREE.Color(r ? '#c47a48' : '#f0a060'), golden * 0.7).lerp(new THREE.Color(r ? '#1c1410' : '#0b1020'), 1 - day);
    U.uTop.value.copy(top);
    U.uHorizon.value.copy(hor);
    U.uGround.value.copy(hor).multiplyScalar(0.55);
    U.uSunDir.value.copy(sunDir);
    U.uSunColor.value.set(r ? '#ffb070' : '#fff2d8').multiplyScalar(day);
    U.uStars.value = r ? (1 - day) * 0.35 : (1 - day) * 0.9;
    U.uHaze.value = r ? 0.8 : 0.25;

    const sunPos = sunDir.clone().multiplyScalar(elev > -0.05 ? 160 : -160);
    if (elev < -0.05) sunPos.set(-60, 120, 80); // moonlight
    this.sun.position.copy(focus).add(sunPos);
    this.sun.target.position.copy(focus);
    this.sun.color.set(elev > -0.05 ? (r ? '#ffc690' : '#fff1dc') : '#8ea6d8').lerp(new THREE.Color('#ff9a50'), golden * 0.6);
    this.sun.intensity = elev > -0.05 ? (r ? 2.2 : 3.2) * day + 0.05 : 0.35;
    this.hemi.color.set(r ? '#b4a690' : '#bcd4ec').lerp(new THREE.Color('#1a2238'), 1 - day);
    this.hemi.groundColor.set(r ? '#4a3c30' : '#4a4238').lerp(new THREE.Color('#0a0a0e'), 1 - day);
    this.hemi.intensity = lerp(0.45, r ? 2.3 : 2.8, day) + this.flash * 10;
    this.scene.environmentIntensity = lerp(0.04, r ? 0.22 : 0.35, day);
    const fogCol = new THREE.Color(r ? '#9a8c78' : '#c8d4e0').lerp(new THREE.Color(r ? '#140f0c' : '#0a0e16'), 1 - day);
    this.scene.fog.color.copy(fogCol);
    this.scene.fog.density = (r ? 0.0085 : 0.0032) * fogDensity * (1 + (1 - day) * 0.5);
    this.dome.position.copy(focus);
    if (this.flash > 0) this.sun.intensity += this.flash * 8;
    return this.darkness;
  }
}
