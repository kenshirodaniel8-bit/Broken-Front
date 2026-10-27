// BROKEN FRONT development server: serves the game from ./public and
// three.js from node_modules. No dependencies besides Node itself.
//
//   npm start             -> http://localhost:3000
//   PORT=8080 npm start   -> different port

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const THREE_DIR = path.join(ROOT, 'node_modules', 'three');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

// Resolves a URL path inside a base directory, refusing anything that
// escapes it (../ tricks).
function safeJoin(base, urlPath) {
  const p = path.normalize(path.join(base, decodeURIComponent(urlPath)));
  return p.startsWith(base) ? p : null;
}

export function createServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let file;
    if (url.pathname.startsWith('/lib/three/')) {
      file = safeJoin(THREE_DIR, url.pathname.slice('/lib/three/'.length));
    } else {
      file = safeJoin(PUBLIC_DIR, url.pathname === '/' ? 'index.html' : url.pathname);
    }
    if (!file) { res.writeHead(403); res.end('Forbidden'); return; }
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
      fs.createReadStream(file).pipe(res);
    });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  createServer().listen(port, () => {
    console.log(`BROKEN FRONT running at http://localhost:${port}`);
  });
}
