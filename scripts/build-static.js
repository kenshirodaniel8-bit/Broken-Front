// Builds a fully static copy of BROKEN FRONT (GitHub Pages or any static host).
//
//   node scripts/build-static.js              -> ./dist
//   node scripts/build-static.js --cdn        -> ./dist, three.js loaded from jsDelivr
//   node scripts/build-static.js --embedded   -> ./dist-embedded: no <html>/<head>/<body>
//                                                skeleton (for hosts that wrap the page
//                                                themselves); add --cdn for three.js from jsDelivr
//
// Bare `three` imports are rewritten to relative paths (or the CDN URL) so the
// build does not depend on import maps, and only the add-ons the game uses are copied.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const embedded = process.argv.includes('--embedded');
const cdn = process.argv.includes('--cdn');
const dist = path.join(root, embedded ? 'dist-embedded' : 'dist');
const three = path.join(root, 'node_modules', 'three');
const jsm = path.join(three, 'examples', 'jsm');

if (!fs.existsSync(path.join(three, 'build', 'three.module.js'))) {
  console.error('three.js not found. Run "npm install" first.');
  process.exit(1);
}
const version = JSON.parse(fs.readFileSync(path.join(three, 'package.json'), 'utf8')).version;
const cdnBase = `https://cdn.jsdelivr.net/npm/three@${version}`;

fs.rmSync(dist, { recursive: true, force: true });
fs.cpSync(path.join(root, 'public'), dist, { recursive: true });
fs.rmSync(path.join(dist, 'dev.html'), { force: true });

const IMPORT_RE = /(\bfrom\s*|\bimport\s*\(?\s*)(['"])([^'"]+)\2/g;
const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
};

// Collect the add-on files the game imports, plus their own relative imports.
const addons = new Set();
const addAddon = (rel) => {
  if (addons.has(rel)) return;
  addons.add(rel);
  for (const m of fs.readFileSync(path.join(jsm, rel), 'utf8').matchAll(IMPORT_RE)) {
    if (m[3].startsWith('.')) addAddon(path.posix.normalize(path.posix.join(path.posix.dirname(rel), m[3])));
  }
};
for (const file of walk(path.join(dist, 'js'))) {
  for (const m of fs.readFileSync(file, 'utf8').matchAll(IMPORT_RE)) {
    if (m[3].startsWith('three/addons/')) addAddon(m[3].slice('three/addons/'.length));
  }
}

const libDir = path.join(dist, 'lib', 'three');
if (!cdn) {
  for (const rel of ['build/three.module.js', 'build/three.core.js', 'LICENSE']) {
    fs.mkdirSync(path.dirname(path.join(libDir, rel)), { recursive: true });
    fs.copyFileSync(path.join(three, rel), path.join(libDir, rel));
  }
  for (const rel of addons) {
    const dst = path.join(libDir, 'examples', 'jsm', rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(path.join(jsm, rel), dst);
  }
}

const relSpec = (from, target) => {
  let r = path.relative(path.dirname(from), target).split(path.sep).join('/');
  if (!r.startsWith('.')) r = `./${r}`;
  return r;
};
for (const file of walk(dist)) {
  const src = fs.readFileSync(file, 'utf8');
  const out = src.replace(IMPORT_RE, (all, pre, q, spec) => {
    if (spec === 'three') return pre + q + (cdn ? `${cdnBase}/build/three.module.js` : relSpec(file, path.join(libDir, 'build', 'three.module.js'))) + q;
    if (spec.startsWith('three/addons/')) {
      const rel = spec.slice('three/addons/'.length);
      return pre + q + (cdn ? `${cdnBase}/examples/jsm/${rel}` : relSpec(file, path.join(libDir, 'examples', 'jsm', rel))) + q;
    }
    return all;
  });
  if (out !== src) fs.writeFileSync(file, out);
}

const indexPath = path.join(dist, 'index.html');
let html = fs.readFileSync(indexPath, 'utf8');
html = html.replace(/\s*<script type="importmap">[\s\S]*?<\/script>/, '');
if (embedded) {
  const head = html.match(/<head>([\s\S]*?)<\/head>/)[1].replace(/\s*<meta charset[^>]*>/, '').replace(/\s*<meta name="viewport"[^>]*>/, '');
  const body = html.match(/<body>([\s\S]*?)<\/body>/)[1];
  const title = head.match(/<title>[\s\S]*?<\/title>/)[0];
  html = `${title}\n${head.replace(title, '').trim()}\n${body.trim()}\n`;
}
fs.writeFileSync(indexPath, html);
if (!embedded) fs.writeFileSync(path.join(dist, '.nojekyll'), '');
console.log(`Static build written to ${path.relative(process.cwd(), dist) || dist} (three.js ${cdn ? 'from CDN' : `${version} local`}, ${addons.size} add-on files)`);
