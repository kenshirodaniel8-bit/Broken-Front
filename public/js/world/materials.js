// Shared PBR materials. Everything is cached by key so buildings, props and
// characters reuse the same material objects (fewer shader programs and
// state changes).

import * as THREE from 'three';
import * as T from './textures.js';

const cache = new Map();
const get = (key, make) => {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
};

export function std(color, rough = 0.85, metal = 0, extra = {}) {
  return get(`std:${color}:${rough}:${metal}:${JSON.stringify(extra)}`, () => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra }));
}

export function facade(style, damaged) {
  return get(`facade:${style}:${damaged}`, () => {
    const map = T.facadeTexture(style, damaged);
    return new THREE.MeshStandardMaterial({ map, bumpMap: T.bumpFrom(map), bumpScale: 1.5, roughness: 0.88, vertexColors: true });
  });
}

export function groundFloor(kind, damaged) {
  return get(`gf:${kind}:${damaged}`, () => {
    const map = T.groundTexture(kind, damaged);
    return new THREE.MeshStandardMaterial({ map, bumpMap: T.bumpFrom(map), bumpScale: 1.2, roughness: 0.8, vertexColors: true });
  });
}

export function roof(kind) {
  return get(`roof:${kind}`, () => {
    const map = T.roofTexture(kind);
    return new THREE.MeshStandardMaterial({ map, bumpMap: T.bumpFrom(map), bumpScale: 2, roughness: 0.82 });
  });
}

export function ground(kind, repeat = 1) {
  return get(`ground:${kind}:${repeat}`, () => {
    const map = T.groundMaterialTexture(kind).clone();
    map.needsUpdate = true;
    map.repeat.set(repeat, repeat);
    const bump = T.bumpFrom(T.groundMaterialTexture(kind)).clone();
    bump.needsUpdate = true;
    bump.repeat.set(repeat, repeat);
    return new THREE.MeshStandardMaterial({ map, bumpMap: bump, bumpScale: 1.4, roughness: kind === 'asphalt' ? 0.92 : 0.9 });
  });
}

// World-space-UV materials (the geometry carries UVs in metres / tile size).
export function surface(kind) {
  return get(`surface:${kind}`, () => {
    const map = T.groundMaterialTexture(kind);
    return new THREE.MeshStandardMaterial({ map, bumpMap: T.bumpFrom(map), bumpScale: 1.4, roughness: 0.9 });
  });
}

// Plain painted plaster, tinted per building through vertex colours.
export function plaster() {
  return get('plaster', () => new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, vertexColors: true, map: T.groundMaterialTexture('wall') }));
}

export function camo(pattern, color) {
  return get(`camo:${pattern}:${color}`, () => new THREE.MeshStandardMaterial({
    map: T.camoTexture(pattern, color), normalMap: T.fabricNormal(), normalScale: new THREE.Vector2(0.35, 0.35), roughness: 0.95,
  }));
}

export function skin(color) {
  return get(`skin:${color}`, () => new THREE.MeshStandardMaterial({ color, roughness: 0.62, metalness: 0 }));
}

export function textPlane(text, opts) {
  const key = `text:${text}:${JSON.stringify(opts || {})}`;
  return get(key, () => new THREE.MeshStandardMaterial({ map: T.textTexture(text, opts), roughness: 0.7 }));
}

export function emissiveText(text, opts, intensity = 0.6) {
  return get(`etext:${text}:${JSON.stringify(opts || {})}`, () => {
    const map = T.textTexture(text, opts);
    return new THREE.MeshStandardMaterial({ map, emissive: 0xffffff, emissiveMap: map, emissiveIntensity: intensity, roughness: 0.6 });
  });
}

export function glass() {
  return get('glass', () => new THREE.MeshStandardMaterial({ color: 0x223038, roughness: 0.08, metalness: 0.6, transparent: true, opacity: 0.75 }));
}

export function burnt() {
  return get('burnt', () => new THREE.MeshStandardMaterial({ map: T.burntPaint(), roughness: 0.95, metalness: 0.2 }));
}

export function scorch() {
  return get('scorch', () => new THREE.MeshBasicMaterial({ map: T.scorchTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
}

export function dispose() {
  for (const m of cache.values()) m.dispose?.();
  cache.clear();
}
