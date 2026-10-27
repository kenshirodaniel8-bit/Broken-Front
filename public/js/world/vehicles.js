// Aircraft and the recon drone. Procedural stand-ins that a GLB listed in
// assets/models/manifest.json replaces automatically.

import * as THREE from 'three';
import * as M from './materials.js';
import { modelOverride } from '../core/assets.js';

function m(geo, mat, x, y, z, parent) {
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}

// Fighter jet, nose toward -Z.
export function buildJet() {
  const o = modelOverride('jet');
  if (o) return o;
  const g = new THREE.Group();
  const grey = M.std('#5a5f66', 0.5, 0.6);
  const dark = M.std('#2a2d31', 0.4, 0.5);
  const body = m(new THREE.CylinderGeometry(0.55, 0.8, 14, 10), grey, 0, 0, 0, g);
  body.rotation.x = Math.PI / 2;
  const nose = m(new THREE.ConeGeometry(0.55, 4, 10), grey, 0, 0, -9, g);
  nose.rotation.x = -Math.PI / 2;
  const canopy = m(new THREE.SphereGeometry(0.55, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), M.std('#1a2a33', 0.1, 0.8), 0, 0.45, -4.5, g);
  canopy.scale.set(0.8, 0.8, 2.4);
  const wing = new THREE.BufferGeometry();
  wing.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -3, 6.5, 0, 3, 0, 0, 4, 0, 0, -3, 0, 0, 4, -6.5, 0, 3], 3));
  wing.computeVertexNormals();
  const w = m(wing, M.std('#555a61', 0.5, 0.6, { side: THREE.DoubleSide }), 0, -0.1, 0, g);
  w.castShadow = true;
  const tail = m(new THREE.BoxGeometry(0.15, 2.6, 2.4), grey, 0, 1.4, 6, g);
  tail.rotation.x = -0.35;
  m(new THREE.BoxGeometry(5.5, 0.12, 1.6), grey, 0, 0, 6.2, g);
  const exhaust = m(new THREE.CylinderGeometry(0.6, 0.5, 0.6, 10), dark, 0, 0, 7.2, g);
  exhaust.rotation.x = Math.PI / 2;
  const glow = m(new THREE.CircleGeometry(0.5, 12), new THREE.MeshBasicMaterial({ color: '#ff8a3a' }), 0, 0, 7.55, g);
  glow.rotation.y = Math.PI;
  return g;
}

// Helicopter, nose toward -Z. kind: 'attack' (enemy) or 'rescue'.
export function buildHelicopter(kind = 'attack') {
  const o = modelOverride(kind === 'rescue' ? 'rescue_helicopter' : 'helicopter');
  if (o) { o.userData.rotor = null; return o; }
  const g = new THREE.Group();
  const col = kind === 'rescue' ? M.std('#3f4a3a', 0.55, 0.3) : M.std('#2f3236', 0.55, 0.4);
  const body = m(new THREE.SphereGeometry(1.6, 14, 10), col, 0, 0, -0.5, g);
  body.scale.set(kind === 'rescue' ? 1.1 : 0.75, 0.95, kind === 'rescue' ? 2.6 : 2.2);
  const boom = m(new THREE.CylinderGeometry(0.22, 0.4, 7, 8), col, 0, 0.4, 5, g);
  boom.rotation.x = Math.PI / 2;
  m(new THREE.BoxGeometry(0.12, 1.6, 1), col, 0, 1.0, 8.4, g);
  const glass = m(new THREE.SphereGeometry(0.95, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), M.std('#121c22', 0.1, 0.8), 0, 0.25, -2.6, g);
  glass.scale.set(kind === 'rescue' ? 1.3 : 0.8, 0.9, 1.4);
  glass.rotation.x = -0.4;
  if (kind === 'attack') {
    for (const s of [-1, 1]) {
      m(new THREE.BoxGeometry(1.6, 0.1, 0.5), col, s * 1.6, -0.2, -0.4, g);
      const pod = m(new THREE.CylinderGeometry(0.22, 0.22, 1.4, 8), M.std('#1d1f22', 0.6), s * 2.2, -0.35, -0.4, g);
      pod.rotation.x = Math.PI / 2;
    }
  } else {
    for (const s of [-1, 1]) m(new THREE.BoxGeometry(0.1, 0.1, 3.4), M.std('#222', 0.6), s * 1.1, -1.65, -0.5, g);
    // Door open, with a red cross marking.
    m(new THREE.BoxGeometry(0.02, 0.7, 0.7), M.textPlane('+', { w: 64, h: 64, bg: '#f2f2f2', fg: '#c01a1a', font: 'bold 60px Arial' }), 1.78, 0.2, 1.2, g);
  }
  const mast = m(new THREE.CylinderGeometry(0.12, 0.12, 0.6, 8), M.std('#1a1a1a', 0.6), 0, 1.75, -0.6, g);
  mast.castShadow = false;
  const rotor = new THREE.Group();
  rotor.position.set(0, 2.05, -0.6);
  const bladeMat = M.std('#1a1b1c', 0.6);
  for (let i = 0; i < 4; i++) {
    const b = m(new THREE.BoxGeometry(0.28, 0.04, 6.8), bladeMat, 0, 0, 0, rotor);
    b.position.z = 0;
    b.rotation.y = (i * Math.PI) / 2;
    b.geometry.translate(0, 0, 3.3);
  }
  g.add(rotor);
  const tailRotor = new THREE.Group();
  tailRotor.position.set(0.18, 1.0, 8.6);
  for (let i = 0; i < 2; i++) {
    const b = m(new THREE.BoxGeometry(0.03, 1.5, 0.12), bladeMat, 0, 0, 0, tailRotor);
    b.rotation.x = (i * Math.PI) / 2;
  }
  g.add(tailRotor);
  g.userData.rotor = rotor;
  g.userData.tailRotor = tailRotor;
  return g;
}

export function buildDrone() {
  const o = modelOverride('drone');
  if (o) return o;
  const g = new THREE.Group();
  const dark = M.std('#2a2d30', 0.5, 0.3);
  m(new THREE.BoxGeometry(0.18, 0.07, 0.26), dark, 0, 0, 0, g);
  const cam = m(new THREE.SphereGeometry(0.04, 10, 8), M.std('#0a0a0a', 0.2, 0.6), 0, -0.05, -0.12, g);
  cam.castShadow = false;
  const props = [];
  for (const [x, z] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) {
    const arm = m(new THREE.BoxGeometry(0.03, 0.02, 0.3), dark, x / 2, 0, z / 2, g);
    arm.rotation.y = Math.atan2(x, z);
    const p = m(new THREE.CylinderGeometry(0.12, 0.12, 0.005, 16), M.std('#6a6e72', 0.5, 0, { transparent: true, opacity: 0.45 }), x, 0.04, z, g);
    p.castShadow = false;
    props.push(p);
  }
  const led = m(new THREE.SphereGeometry(0.012, 6, 4), new THREE.MeshBasicMaterial({ color: '#ff2020' }), 0, 0.04, 0.13, g);
  led.castShadow = false;
  g.userData.led = led;
  return g;
}
