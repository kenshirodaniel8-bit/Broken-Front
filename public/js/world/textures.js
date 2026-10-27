// Procedural textures drawn on canvases. Every texture is generated once and
// cached. These are the stand-ins for authored PBR texture sets: swap any of
// them for an image by changing the loader in materials.js.

import * as THREE from 'three';
import { makeRng } from '../core/util.js';

const cache = new Map();
let maxAniso = 4;
export function setAnisotropy(a) { maxAniso = a; }

function canvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function toTexture(c, { repeat = true, srgb = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = maxAniso;
  t.needsUpdate = true;
  return t;
}

function cached(key, fn) {
  if (!cache.has(key)) cache.set(key, fn());
  return cache.get(key);
}

// Smooth value noise for organic patterns.
function noiseField(seed, size, scale) {
  const rng = makeRng(seed);
  const g = Math.ceil(size / scale) + 2;
  const grid = new Float32Array((g + 1) * (g + 1)).map(() => rng());
  const at = (x, y) => grid[(((y % g) + g) % g) * (g + 1) + (((x % g) + g) % g)];
  return (x, y) => {
    const fx = x / scale;
    const fy = y / scale;
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const tx = fx - ix;
    const ty = fy - iy;
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);
    const a = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * sx;
    const b = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * sx;
    return a + (b - a) * sy;
  };
}

function speckle(ctx, w, h, seed, amount, alpha, colors = ['#000', '#fff']) {
  const rng = makeRng(seed);
  for (let i = 0; i < amount; i++) {
    ctx.globalAlpha = alpha * rng();
    ctx.fillStyle = colors[i % colors.length];
    ctx.fillRect(rng() * w, rng() * h, 1 + rng() * 2, 1 + rng() * 2);
  }
  ctx.globalAlpha = 1;
}

function stains(ctx, w, h, seed, n, color, alpha) {
  const rng = makeRng(seed);
  for (let i = 0; i < n; i++) {
    const x = rng() * w;
    const y = rng() * h;
    const r = 8 + rng() * 40;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = alpha * rng();
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  ctx.globalAlpha = 1;
}

// --- Facades ---------------------------------------------------------------
// One tile = one window bay, 3.4 m wide x 3.2 m tall, drawn on light plaster
// so per-building vertex colours can tint it.

const FACADE_STYLES = 11;
export const FACADE_STYLE_COUNT = FACADE_STYLES;

function drawPlaster(ctx, s, seed, base = '#e9e4da') {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, s, s);
  const n = noiseField(seed, s, 24);
  const img = ctx.getImageData(0, 0, s, s);
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const v = (n(x, y) - 0.5) * 18;
      const i = (y * s + x) * 4;
      img.data[i] += v; img.data[i + 1] += v; img.data[i + 2] += v;
    }
  }
  ctx.putImageData(img, 0, 0);
  speckle(ctx, s, s, seed + 1, 900, 0.08);
}

function windowRect(style, s) {
  // [x, y, w, h] in pixels for the window opening.
  switch (style) {
    case 1: return [0.26 * s, 0.24 * s, 0.48 * s, 0.46 * s];
    case 6: return [0.3 * s, 0.18 * s, 0.4 * s, 0.6 * s];
    case 7: return [0.36 * s, 0.1 * s, 0.28 * s, 0.75 * s];
    case 8: return [0.06 * s, 0.3 * s, 0.88 * s, 0.38 * s];
    case 9: return [0.2 * s, 0.25 * s, 0.6 * s, 0.42 * s];
    case 10: return [0.22 * s, 0.14 * s, 0.56 * s, 0.68 * s];
    default: return [0.3 * s, 0.2 * s, 0.4 * s, 0.56 * s];
  }
}

function drawWindow(ctx, style, s, damaged, rng) {
  const [x, y, w, h] = windowRect(style, s);
  const arched = style === 6 || style === 7 || style === 10;
  // Stone surround / reveal shadow.
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(x - 3, y - 3, w + 6, h + 8);
  if (style === 0 || style === 4) {
    // Gründerzeit lintel with a small pediment.
    ctx.fillStyle = '#f6f2ea';
    ctx.fillRect(x - 10, y - 18, w + 20, 12);
    ctx.beginPath();
    ctx.moveTo(x - 12, y - 18); ctx.lineTo(x + w / 2, y - 34); ctx.lineTo(x + w + 12, y - 18); ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(x - 10, y - 7, w + 20, 2);
  }
  if (style === 5 || style === 9) {
    ctx.fillStyle = style === 9 ? '#f1ece2' : '#9a4c34';
    for (let i = -2; i < h + 6; i += 9) { ctx.fillRect(x - 9, y + i, 7, 7); ctx.fillRect(x + w + 2, y + i, 7, 7); }
  }
  // Window sill.
  ctx.fillStyle = '#f4f0e8';
  ctx.fillRect(x - 8, y + h, w + 16, 7);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(x - 8, y + h + 7, w + 16, 3);
  // Glass.
  const clip = () => {
    ctx.beginPath();
    if (arched) {
      ctx.moveTo(x, y + h);
      ctx.lineTo(x, y + w / 2);
      ctx.arc(x + w / 2, y + w / 2, w / 2, Math.PI, 0);
      ctx.lineTo(x + w, y + h);
      ctx.closePath();
    } else ctx.rect(x, y, w, h);
  };
  ctx.save();
  clip();
  ctx.clip();
  if (damaged) {
    ctx.fillStyle = '#07080a';
    ctx.fillRect(x, y, w, h);
    // Jagged shards left in the frame.
    ctx.fillStyle = 'rgba(150,170,180,0.55)';
    for (let i = 0; i < 4; i++) {
      const ex = rng() < 0.5 ? x : x + w;
      const ey = y + rng() * h;
      ctx.beginPath();
      ctx.moveTo(ex, ey - 10); ctx.lineTo(ex + (ex === x ? 1 : -1) * (6 + rng() * 16), ey + rng() * 8); ctx.lineTo(ex, ey + 12);
      ctx.fill();
    }
    // Curtain remnant.
    if (rng() < 0.4) { ctx.fillStyle = 'rgba(120,90,70,0.6)'; ctx.fillRect(x + w * 0.6, y, w * 0.25, h * 0.7); }
  } else {
    const g = ctx.createLinearGradient(x, y, x + w, y + h);
    g.addColorStop(0, '#5f7383');
    g.addColorStop(0.45, '#2c3a46');
    g.addColorStop(1, '#4b5d6b');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    // Sky reflection streak and curtains.
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.beginPath(); ctx.moveTo(x, y + h * 0.3); ctx.lineTo(x + w * 0.4, y); ctx.lineTo(x + w * 0.6, y); ctx.lineTo(x, y + h * 0.6); ctx.fill();
    if (rng() < 0.6) {
      ctx.fillStyle = rng() < 0.5 ? 'rgba(235,228,210,0.55)' : 'rgba(170,140,110,0.5)';
      ctx.fillRect(x, y, w * 0.22, h);
      ctx.fillRect(x + w * 0.78, y, w * 0.22, h);
    }
  }
  ctx.restore();
  // Frames and mullions.
  ctx.strokeStyle = damaged ? '#3a3a38' : '#f7f5f0';
  ctx.lineWidth = 5;
  clip();
  ctx.stroke();
  ctx.lineWidth = 4;
  if (style !== 8) {
    ctx.beginPath();
    ctx.moveTo(x + w / 2, y + (arched ? w / 2 : 0)); ctx.lineTo(x + w / 2, y + h);
    ctx.moveTo(x, y + h * 0.32); ctx.lineTo(x + w, y + h * 0.32);
    ctx.stroke();
  } else {
    for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(x + (w * i) / 4, y); ctx.lineTo(x + (w * i) / 4, y + h); ctx.stroke(); }
  }
  if (style === 3) {
    // French balcony railing.
    ctx.strokeStyle = '#2b2b2b';
    ctx.lineWidth = 2;
    ctx.strokeRect(x - 4, y + h * 0.62, w + 8, h * 0.38);
    for (let i = 0; i <= 10; i++) { ctx.beginPath(); ctx.moveTo(x - 4 + ((w + 8) * i) / 10, y + h * 0.62); ctx.lineTo(x - 4 + ((w + 8) * i) / 10, y + h); ctx.stroke(); }
  }
  if (style === 2 && !damaged) {
    // Shutters.
    ctx.fillStyle = '#3f5a44';
    for (const sx of [x - w * 0.42, x + w + 2]) {
      ctx.fillRect(sx, y, w * 0.4, h);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      for (let i = 4; i < h; i += 7) ctx.fillRect(sx, y + i, w * 0.4, 2);
      ctx.fillStyle = '#3f5a44';
    }
  }
}

function drawFacadeDecor(ctx, style, s) {
  if (style === 4 || style === 6) {
    // Stucco string course at floor level.
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillRect(0, s - 14, s, 10);
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fillRect(0, s - 4, s, 3);
  }
  if (style === 7 || style === 10 || style === 6) {
    // Ashlar stone courses.
    ctx.strokeStyle = 'rgba(0,0,0,0.13)';
    ctx.lineWidth = 1.5;
    for (let y = 0; y < s; y += 22) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(s, y); ctx.stroke();
      for (let x = (y / 22) % 2 ? 0 : 30; x < s; x += 60) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + 22); ctx.stroke(); }
    }
  }
  if (style === 9) {
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillRect(0, s - 18, s, 8);
  }
}

function drawDamage(ctx, s, rng, heavy) {
  // Soot plumes above windows, cracks, chipped plaster showing brick.
  const g = ctx.createLinearGradient(0, s * 0.75, 0, 0);
  g.addColorStop(0, 'rgba(10,8,6,0.75)');
  g.addColorStop(1, 'rgba(10,8,6,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(s * 0.32, s * 0.25);
  ctx.bezierCurveTo(s * 0.2, s * 0.1, s * 0.55, s * 0.05, s * 0.4, 0);
  ctx.lineTo(s * 0.75, 0);
  ctx.bezierCurveTo(s * 0.8, s * 0.1, s * 0.75, s * 0.15, s * 0.68, s * 0.25);
  ctx.fill();
  for (let i = 0; i < (heavy ? 4 : 2); i++) {
    const x = rng() * s;
    const y = rng() * s;
    const w = 20 + rng() * 50;
    const h = 14 + rng() * 30;
    ctx.fillStyle = '#8f5a44';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(60,35,25,0.6)';
    ctx.lineWidth = 1;
    for (let by = y; by < y + h; by += 6) { ctx.beginPath(); ctx.moveTo(x, by); ctx.lineTo(x + w, by); ctx.stroke(); }
  }
  ctx.strokeStyle = 'rgba(25,20,18,0.7)';
  ctx.lineWidth = 1.4;
  for (let i = 0; i < (heavy ? 5 : 2); i++) {
    let x = rng() * s;
    let y = rng() * s;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let k = 0; k < 6; k++) { x += (rng() - 0.5) * 30; y += rng() * 20; ctx.lineTo(x, y); }
    ctx.stroke();
  }
  stains(ctx, s, s, Math.floor(rng() * 1e6), heavy ? 10 : 5, 'rgba(30,25,20,1)', 0.35);
}

export function facadeTexture(style, damaged = 0) {
  return cached(`facade:${style}:${damaged}`, () => {
    const s = 256;
    const c = canvas(s);
    const ctx = c.getContext('2d');
    const rng = makeRng(style * 31 + damaged * 7 + 3);
    drawPlaster(ctx, s, style * 13 + 1, style === 9 ? '#c8c2ba' : '#ebe6dc');
    if (style === 9) {
      ctx.fillStyle = '#b34a33';
      ctx.fillRect(0, 0, s, s);
      ctx.strokeStyle = 'rgba(60,20,10,0.35)';
      for (let y = 0; y < s; y += 8) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(s, y); ctx.stroke(); }
    }
    drawFacadeDecor(ctx, style, s);
    drawWindow(ctx, style, s, damaged > 0, rng);
    if (damaged) drawDamage(ctx, s, rng, damaged > 1);
    return toTexture(c);
  });
}

// Ground floor: shop window + door, or a plain base with a solid plinth.
export function groundTexture(kind, damaged = 0) {
  return cached(`ground:${kind}:${damaged}`, () => {
    const s = 256;
    const c = canvas(s);
    const ctx = c.getContext('2d');
    const rng = makeRng(kind.length * 17 + damaged);
    drawPlaster(ctx, s, 99, '#e6e0d4');
    // Plinth.
    ctx.fillStyle = '#9a958c';
    ctx.fillRect(0, s * 0.86, s, s * 0.14);
    speckle(ctx, s, s, 5, 300, 0.15);
    if (kind === 'shop') {
      const x = s * 0.08; const y = s * 0.26; const w = s * 0.84; const h = s * 0.62;
      ctx.fillStyle = '#2a2d2f';
      ctx.fillRect(x - 5, y - 5, w + 10, h + 8);
      if (damaged) {
        ctx.fillStyle = '#0b0b0c';
        ctx.fillRect(x, y, w, h);
        ctx.fillStyle = 'rgba(160,180,190,0.5)';
        for (let i = 0; i < 6; i++) {
          ctx.beginPath();
          const bx = x + rng() * w;
          ctx.moveTo(bx, y + h); ctx.lineTo(bx + 8 + rng() * 14, y + h - 10 - rng() * 30); ctx.lineTo(bx + 20, y + h);
          ctx.fill();
        }
      } else {
        const g = ctx.createLinearGradient(x, y, x, y + h);
        g.addColorStop(0, '#6b8191');
        g.addColorStop(1, '#2f3b44');
        ctx.fillStyle = g;
        ctx.fillRect(x, y, w, h);
        // Goods on display.
        for (let i = 0; i < 9; i++) {
          ctx.fillStyle = `hsl(${rng() * 360},35%,${35 + rng() * 25}%)`;
          ctx.fillRect(x + 8 + rng() * (w - 30), y + h * 0.55 + rng() * h * 0.3, 10 + rng() * 14, 10 + rng() * 18);
        }
        ctx.fillStyle = 'rgba(255,255,255,0.14)';
        ctx.beginPath(); ctx.moveTo(x, y + h * 0.5); ctx.lineTo(x + w * 0.3, y); ctx.lineTo(x + w * 0.45, y); ctx.lineTo(x, y + h * 0.75); ctx.fill();
      }
      ctx.strokeStyle = '#3b3e40';
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(x + w / 2, y); ctx.lineTo(x + w / 2, y + h); ctx.stroke();
      // Awning band.
      ctx.fillStyle = '#26292b';
      ctx.fillRect(0, s * 0.08, s, s * 0.13);
    } else {
      const x = s * 0.32; const y = s * 0.3; const w = s * 0.36; const h = s * 0.4;
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(x - 3, y - 3, w + 6, h + 6);
      ctx.fillStyle = damaged ? '#08090a' : '#33424d';
      ctx.fillRect(x, y, w, h);
      // Iron bars on ground floor windows.
      ctx.strokeStyle = '#2a2a2a';
      ctx.lineWidth = 2;
      for (let i = 1; i < 6; i++) { ctx.beginPath(); ctx.moveTo(x + (w * i) / 6, y); ctx.lineTo(x + (w * i) / 6, y + h); ctx.stroke(); }
      // Rusticated base.
      ctx.strokeStyle = 'rgba(0,0,0,0.12)';
      for (let yy = 12; yy < s * 0.86; yy += 24) { ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(s, yy); ctx.stroke(); }
    }
    if (damaged) drawDamage(ctx, s, rng, damaged > 1);
    return toTexture(c);
  });
}

export function doorTexture(damaged) {
  return cached(`door:${damaged}`, () => {
    const c = canvas(128, 256);
    const ctx = c.getContext('2d');
    ctx.fillStyle = damaged ? '#1d1712' : '#4b3424';
    ctx.fillRect(0, 0, 128, 256);
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.lineWidth = 4;
    ctx.strokeRect(14, 14, 100, 100);
    ctx.strokeRect(14, 130, 100, 112);
    ctx.fillStyle = '#c9a54a';
    ctx.fillRect(100, 128, 10, 6);
    return toTexture(c, { repeat: false });
  });
}

export function roofTexture(kind) {
  return cached(`roof:${kind}`, () => {
    const s = 256;
    const c = canvas(s);
    const ctx = c.getContext('2d');
    const rng = makeRng(kind === 'slate' ? 11 : 12);
    const base = kind === 'slate' ? [70, 74, 80] : kind === 'flat' ? [90, 88, 84] : [146, 70, 48];
    ctx.fillStyle = `rgb(${base})`;
    ctx.fillRect(0, 0, s, s);
    if (kind === 'flat') {
      speckle(ctx, s, s, 3, 3000, 0.25);
      stains(ctx, s, s, 4, 12, 'rgba(0,0,0,1)', 0.2);
    } else {
      const rows = 16;
      const rh = s / rows;
      for (let r = 0; r < rows; r++) {
        const off = (r % 2) * rh * 0.6;
        for (let x = -rh; x < s + rh; x += rh * 1.2) {
          const v = (rng() - 0.5) * 30;
          ctx.fillStyle = `rgb(${base[0] + v},${base[1] + v * 0.6},${base[2] + v * 0.5})`;
          ctx.fillRect(x + off, r * rh, rh * 1.15, rh - 2);
          ctx.fillStyle = 'rgba(0,0,0,0.35)';
          ctx.fillRect(x + off, r * rh + rh - 3, rh * 1.15, 3);
        }
      }
      stains(ctx, s, s, 9, 10, 'rgba(30,40,20,1)', 0.25);
    }
    return toTexture(c);
  });
}

export function groundMaterialTexture(kind) {
  return cached(`groundmat:${kind}`, () => {
    const s = 512;
    const c = canvas(s);
    const ctx = c.getContext('2d');
    const rng = makeRng(kind.length * 101);
    switch (kind) {
      case 'asphalt': {
        ctx.fillStyle = '#3c3d3f';
        ctx.fillRect(0, 0, s, s);
        speckle(ctx, s, s, 1, 16000, 0.35, ['#1d1e20', '#6a6a6a', '#55524c']);
        stains(ctx, s, s, 2, 14, 'rgba(15,15,15,1)', 0.25);
        ctx.strokeStyle = 'rgba(20,20,20,0.5)';
        ctx.lineWidth = 2;
        for (let i = 0; i < 3; i++) { let x = rng() * s; let y = rng() * s; ctx.beginPath(); ctx.moveTo(x, y); for (let k = 0; k < 8; k++) { x += (rng() - 0.5) * 60; y += (rng() - 0.5) * 60; ctx.lineTo(x, y); } ctx.stroke(); }
        break;
      }
      case 'sidewalk': {
        ctx.fillStyle = '#9b9893';
        ctx.fillRect(0, 0, s, s);
        const t = s / 8;
        for (let y = 0; y < 8; y++) {
          for (let x = 0; x < 8; x++) {
            const v = (rng() - 0.5) * 16;
            ctx.fillStyle = `rgb(${158 + v},${154 + v},${148 + v})`;
            ctx.fillRect(x * t + 1, y * t + 1, t - 2, t - 2);
          }
        }
        speckle(ctx, s, s, 7, 6000, 0.2);
        stains(ctx, s, s, 8, 10, 'rgba(40,40,35,1)', 0.15);
        break;
      }
      case 'cobble': {
        ctx.fillStyle = '#4a4744';
        ctx.fillRect(0, 0, s, s);
        const t = s / 16;
        for (let y = 0; y < 16; y++) {
          for (let x = 0; x < 16; x++) {
            const v = (rng() - 0.5) * 40;
            const ox = (y % 2) * t * 0.5;
            ctx.fillStyle = `rgb(${120 + v},${114 + v},${106 + v})`;
            ctx.beginPath();
            ctx.ellipse(x * t + ox + t / 2, y * t + t / 2, t * 0.44, t * 0.4, rng(), 0, Math.PI * 2);
            ctx.fill();
          }
        }
        speckle(ctx, s, s, 9, 4000, 0.2);
        break;
      }
      case 'grass': {
        ctx.fillStyle = '#4b6331';
        ctx.fillRect(0, 0, s, s);
        speckle(ctx, s, s, 10, 30000, 0.4, ['#3a5225', '#6b8a44', '#566f36', '#7d8f4a']);
        stains(ctx, s, s, 11, 20, 'rgba(90,80,40,1)', 0.2);
        break;
      }
      case 'gravel': {
        ctx.fillStyle = '#a49a86';
        ctx.fillRect(0, 0, s, s);
        speckle(ctx, s, s, 12, 20000, 0.5, ['#7c7464', '#c9bfa8', '#8d8370']);
        break;
      }
      case 'concrete': {
        ctx.fillStyle = '#8c8a86';
        ctx.fillRect(0, 0, s, s);
        speckle(ctx, s, s, 13, 9000, 0.25);
        stains(ctx, s, s, 14, 18, 'rgba(50,50,48,1)', 0.25);
        ctx.strokeStyle = 'rgba(0,0,0,0.2)';
        ctx.strokeRect(0, 0, s, s);
        break;
      }
      case 'rubble': {
        ctx.fillStyle = '#6d6560';
        ctx.fillRect(0, 0, s, s);
        for (let i = 0; i < 700; i++) {
          const v = rng();
          const grey = 90 + rng() * 80;
          ctx.fillStyle = v < 0.16 ? `rgb(${105 + rng() * 30},${68 + rng() * 15},${56 + rng() * 12})` : `rgb(${grey},${grey * 0.97},${grey * 0.93})`;
          const x = rng() * s;
          const y = rng() * s;
          const r = 3 + rng() * 14;
          ctx.beginPath();
          ctx.moveTo(x + r, y);
          for (let k = 1; k < 6; k++) ctx.lineTo(x + Math.cos(k * 1.2) * r * (0.6 + rng() * 0.6), y + Math.sin(k * 1.2) * r * (0.6 + rng() * 0.6));
          ctx.fill();
          ctx.fillStyle = 'rgba(0,0,0,0.3)';
          ctx.fillRect(x, y + r * 0.5, r, 2);
        }
        stains(ctx, s, s, 15, 20, 'rgba(20,18,16,1)', 0.35);
        break;
      }
      case 'tiles': {
        ctx.fillStyle = '#c9c4ba';
        ctx.fillRect(0, 0, s, s);
        const t = s / 8;
        for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { const v = (rng() - 0.5) * 10; ctx.fillStyle = (x + y) % 2 ? `rgb(${205 + v},${200 + v},${190 + v})` : `rgb(${185 + v},${180 + v},${172 + v})`; ctx.fillRect(x * t + 1, y * t + 1, t - 2, t - 2); }
        stains(ctx, s, s, 16, 12, 'rgba(60,55,50,1)', 0.2);
        break;
      }
      case 'wood': {
        ctx.fillStyle = '#7a5434';
        ctx.fillRect(0, 0, s, s);
        const t = s / 6;
        for (let i = 0; i < 6; i++) {
          const v = (rng() - 0.5) * 30;
          ctx.fillStyle = `rgb(${125 + v},${86 + v * 0.7},${54 + v * 0.5})`;
          ctx.fillRect(0, i * t + 1, s, t - 2);
          ctx.strokeStyle = 'rgba(50,30,15,0.25)';
          for (let k = 0; k < 6; k++) { ctx.beginPath(); ctx.moveTo(0, i * t + rng() * t); ctx.bezierCurveTo(s * 0.3, i * t + rng() * t, s * 0.6, i * t + rng() * t, s, i * t + rng() * t); ctx.stroke(); }
        }
        break;
      }
      case 'wall': {
        ctx.fillStyle = '#d9d4ca';
        ctx.fillRect(0, 0, s, s);
        speckle(ctx, s, s, 17, 3000, 0.08);
        stains(ctx, s, s, 18, 10, 'rgba(90,80,70,1)', 0.12);
        break;
      }
      default: ctx.fillStyle = '#888'; ctx.fillRect(0, 0, s, s);
    }
    return toTexture(c);
  });
}

// Bump map from any colour texture (luminance = height).
export function bumpFrom(tex) {
  return cached(`bump:${tex.uuid}`, () => {
    const src = tex.image;
    const c = canvas(src.width, src.height);
    const ctx = c.getContext('2d');
    ctx.filter = 'grayscale(1) contrast(1.4)';
    ctx.drawImage(src, 0, 0);
    return toTexture(c, { srgb: false });
  });
}

// --- Uniform fabric ------------------------------------------------------------

const CAMO_SETS = {
  loreng: (base) => [base, '#2f3a22', '#6b5a3a', '#161a12'],
  woodland: (base) => [base, '#2c3d24', '#6a5636', '#1a1a16'],
  multi: (base) => ['#a49274', '#7c6e50', '#5a6340', '#c3b48f'],
  desert: () => ['#c8b089', '#a68b62', '#8a7350', '#d9c7a2'],
  urban: () => ['#8a8d90', '#5d6064', '#b8b9ba', '#3a3c3f'],
  solid: (base) => [base, base, base, base],
};

function shade(hex, f) {
  const c = new THREE.Color(hex);
  c.multiplyScalar(f);
  return `#${c.getHexString()}`;
}

export function camoTexture(pattern, baseColor) {
  return cached(`camo:${pattern}:${baseColor}`, () => {
    const s = 512;
    const c = canvas(s);
    const ctx = c.getContext('2d');
    const cols = (CAMO_SETS[pattern] || CAMO_SETS.solid)(baseColor);
    ctx.fillStyle = cols[0];
    ctx.fillRect(0, 0, s, s);
    const rng = makeRng(`${pattern}${baseColor}`);
    if (pattern === 'loreng') {
      // Horizontal tiger stripes.
      for (let i = 0; i < 70; i++) {
        ctx.fillStyle = cols[1 + (i % 3)];
        const y = rng() * s;
        const x = rng() * s;
        const len = 60 + rng() * 140;
        ctx.beginPath();
        ctx.moveTo(x, y);
        for (let k = 0; k <= 10; k++) ctx.lineTo(x + (len * k) / 10, y + Math.sin(k * 0.9 + i) * 6 - 4 - rng() * 4);
        for (let k = 10; k >= 0; k--) ctx.lineTo(x + (len * k) / 10, y + Math.sin(k * 0.9 + i) * 6 + 4 + rng() * 5);
        ctx.fill();
      }
    } else if (pattern !== 'solid') {
      const n1 = noiseField(`${pattern}a`, s, 64);
      const n2 = noiseField(`${pattern}b`, s, 40);
      const n3 = noiseField(`${pattern}c`, s, 26);
      const img = ctx.getImageData(0, 0, s, s);
      // Canvas pixels are sRGB: parse the hex directly (THREE.Color would linearise it).
      const rgb = cols.map((h) => ({ r: parseInt(h.slice(1, 3), 16) / 255, g: parseInt(h.slice(3, 5), 16) / 255, b: parseInt(h.slice(5, 7), 16) / 255 }));
      for (let y = 0; y < s; y++) {
        for (let x = 0; x < s; x++) {
          let k = 0;
          if (n1(x, y) > 0.56) k = 1;
          if (n2(x + 99, y) > 0.62) k = 2;
          if (n3(x, y + 77) > 0.7) k = 3;
          const col = rgb[k];
          const i = (y * s + x) * 4;
          img.data[i] = col.r * 255; img.data[i + 1] = col.g * 255; img.data[i + 2] = col.b * 255;
        }
      }
      ctx.putImageData(img, 0, 0);
    }
    // Fabric weave, fold shading and seams with stitching.
    speckle(ctx, s, s, 21, 14000, 0.12);
    for (let i = 0; i < 26; i++) {
      const x = rng() * s;
      const y = rng() * s;
      const g = ctx.createLinearGradient(x, y, x + 30, y + 10);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(0.5, 'rgba(0,0,0,0.22)');
      g.addColorStop(1, 'rgba(255,255,255,0.06)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(x, y, 60 + rng() * 60, 4 + rng() * 5, (rng() - 0.5) * 0.8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = shade(cols[0], 0.55);
    ctx.lineWidth = 2;
    for (const x of [s * 0.25, s * 0.75]) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, s); ctx.stroke(); }
    ctx.setLineDash([3, 4]);
    ctx.strokeStyle = 'rgba(20,20,15,0.55)';
    ctx.lineWidth = 1;
    for (const x of [s * 0.25 + 4, s * 0.75 - 4]) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, s); ctx.stroke(); }
    ctx.setLineDash([]);
    return toTexture(c);
  });
}

export function fabricNormal() {
  return cached('fabricNormal', () => {
    const s = 128;
    const c = canvas(s);
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(s, s);
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const i = (y * s + x) * 4;
        const wx = Math.sin((x / s) * Math.PI * 32) * 0.35;
        const wy = Math.sin((y / s) * Math.PI * 32 + (x % 8 < 4 ? 0 : Math.PI)) * 0.35;
        img.data[i] = 128 + wx * 127;
        img.data[i + 1] = 128 + wy * 127;
        img.data[i + 2] = 255;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return toTexture(c, { srgb: false });
  });
}

// --- Text: shop signs, name patches, street signs ---------------------------------

export function textTexture(text, { w = 512, h = 96, bg = '#1c1f22', fg = '#f2efe6', font = 'bold 56px Arial, sans-serif', border = null } = {}) {
  return cached(`text:${text}:${w}:${h}:${bg}:${fg}:${font}`, () => {
    const c = canvas(w, h);
    const ctx = c.getContext('2d');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    if (border) { ctx.strokeStyle = border; ctx.lineWidth = 6; ctx.strokeRect(3, 3, w - 6, h - 6); }
    ctx.fillStyle = fg;
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let size = parseInt(font.match(/(\d+)px/)[1], 10);
    while (ctx.measureText(text).width > w * 0.9 && size > 10) {
      size -= 2;
      ctx.font = font.replace(/\d+px/, `${size}px`);
    }
    ctx.fillText(text, w / 2, h / 2 + 2);
    return toTexture(c, { repeat: false });
  });
}

// --- Particles -------------------------------------------------------------------

export function smokeSprite() {
  return cached('smoke', () => {
    const s = 128;
    const c = canvas(s);
    const ctx = c.getContext('2d');
    const n = noiseField(5, s, 16);
    const img = ctx.createImageData(s, s);
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const d = Math.hypot(x - s / 2, y - s / 2) / (s / 2);
        const a = Math.max(0, 1 - d) ** 1.6 * (0.55 + n(x, y) * 0.6);
        const i = (y * s + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
        img.data[i + 3] = Math.min(255, a * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
    return toTexture(c, { repeat: false });
  });
}

export function glowSprite() {
  return cached('glow', () => {
    const s = 64;
    const c = canvas(s);
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.7)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    return toTexture(c, { repeat: false });
  });
}

export function scorchTexture() {
  return cached('scorch', () => {
    const s = 256;
    const c = canvas(s);
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(5,4,3,0.95)');
    g.addColorStop(0.5, 'rgba(15,12,10,0.7)');
    g.addColorStop(1, 'rgba(20,18,15,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    speckle(ctx, s, s, 31, 2500, 0.5, ['#000', '#3a332c']);
    return toTexture(c, { repeat: false });
  });
}

export function burntPaint() {
  return cached('burnt', () => {
    const s = 256;
    const c = canvas(s);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#1b1816';
    ctx.fillRect(0, 0, s, s);
    stains(ctx, s, s, 41, 30, 'rgba(120,60,30,1)', 0.55);
    speckle(ctx, s, s, 42, 8000, 0.4, ['#000', '#5a3a22', '#777']);
    return toTexture(c);
  });
}

export function crackedGlass() {
  return cached('crackedGlass', () => {
    const w = 256;
    const h = 512;
    const c = canvas(w, h);
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    const rng = makeRng(77);
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 1.3;
    const cx = w * 0.72;
    const cy = h * 0.78;
    for (let i = 0; i < 16; i++) {
      let x = cx;
      let y = cy;
      const a = rng() * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let k = 0; k < 8; k++) { x += Math.cos(a + (rng() - 0.5) * 0.6) * 30; y += Math.sin(a + (rng() - 0.5) * 0.6) * 30; ctx.lineTo(x, y); }
      ctx.stroke();
    }
    for (let r = 14; r < 80; r += 22) { ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke(); }
    return toTexture(c, { repeat: false });
  });
}
