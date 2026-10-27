// Optional authored 3D models. List GLB files in
// public/assets/models/manifest.json, e.g.
//   { "jet": { "file": "jet.glb", "scale": 1 }, "helicopter": { "file": "heli.glb" } }
// Any key present replaces the procedural model of the same name; anything
// missing keeps the procedural stand-in. Keys: jet, helicopter, rescue_helicopter,
// drone.

import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const models = new Map();

export async function loadModelOverrides() {
  let manifest;
  try {
    const res = await fetch('assets/models/manifest.json', { cache: 'no-cache' });
    if (!res.ok) return 0;
    manifest = await res.json();
  } catch {
    return 0;
  }
  const loader = new GLTFLoader();
  await Promise.all(Object.entries(manifest).map(async ([key, entry]) => {
    const file = typeof entry === 'string' ? entry : entry.file;
    try {
      const gltf = await loader.loadAsync(`assets/models/${file}`);
      const scene = gltf.scene;
      const s = entry.scale || 1;
      scene.scale.setScalar(s);
      scene.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      models.set(key, scene);
    } catch (e) {
      console.warn(`Model override "${key}" failed to load`, e);
    }
  }));
  return models.size;
}

// A fresh copy of an override model, or null to use the procedural one.
export function modelOverride(key) {
  const m = models.get(key);
  return m ? m.clone(true) : null;
}
