// Planche contact de l'atelier 3D : rend un catalogue de modèles CC0 avec
// bake3d.js (même caméra / lumière que l'atelier) dans un Chromium headless,
// à côté de sprites Flare de référence, et écrit les PNG.
//
// Usage :
//   python3 -I tools/atelier3d/extraire.py            # une fois : zips -> _extrait/
//   node tools/atelier3d/planche.mjs [sortie=tools/atelier3d/sortie] [--sonde]
//
// --sonde : liste les clips d'animation de chaque modèle du catalogue.
// Dépendance d'outillage (non installée par défaut) : playwright, résolu via
// PLAYWRIGHT_DIR (dossier contenant node_modules/playwright) ou le projet.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const RACINE = path.resolve(ICI, '../..');
const SRC3D = process.env.T4C_SRC3D || path.join(os.homedir(), 't4c-assets-sources', '_extrait');
const args = process.argv.slice(2);
const SONDE = args.includes('--sonde');
const SORTIE = path.resolve(args.find(a => !a.startsWith('--')) || path.join(ICI, 'sortie'));

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gltf': 'model/gltf+json', '.glb': 'model/gltf-binary',
  '.bin': 'application/octet-stream', '.fbx': 'application/octet-stream' };

// /js/* et /assets/* -> client/ ; /src3d/* -> modèles extraits ; / -> page
function servir(req, res) {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let base, rel;
  if (url.startsWith('/src3d/')) { base = SRC3D; rel = url.slice(7); }
  else if (url.startsWith('/outil/')) { base = ICI; rel = url.slice(7); }
  else if (url === '/') { base = ICI; rel = 'planche.html'; }
  else { base = path.join(RACINE, 'client'); rel = url.slice(1); }
  const f = path.resolve(base, rel);
  if (!f.startsWith(base + path.sep) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f).toLowerCase()] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
}

const require = createRequire(path.join(process.env.PLAYWRIGHT_DIR || RACINE, 'x.js'));
const { chromium } = require('playwright');

const serveur = http.createServer(servir).listen(0, '127.0.0.1');
await new Promise(r => serveur.once('listening', r));
const port = serveur.address().port;

const nav = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await nav.newPage();
page.on('console', m => console.log('[page]', m.text()));
page.on('response', r => { if (r.status() >= 400) console.log('[page] HTTP', r.status(), decodeURIComponent(r.url())); });
page.on('pageerror', e => console.error('[page] ERREUR', e.message));
await page.goto(`http://127.0.0.1:${port}/${SONDE ? '?sonde' : ''}`);
await page.waitForFunction(() => window.__fini, null, { timeout: 15 * 60 * 1000, polling: 500 });
const resultat = await page.evaluate(() => window.__fini);
await nav.close();
serveur.close();

if (resultat.erreur) { console.error('✘', resultat.erreur); process.exit(1); }
fs.mkdirSync(SORTIE, { recursive: true });
for (const [nom, dataUrl] of Object.entries(resultat.images || {})) {
  const f = path.join(SORTIE, nom + '.png');
  fs.writeFileSync(f, Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log('✔', path.relative(RACINE, f));
}
if (resultat.sonde) console.log(JSON.stringify(resultat.sonde, null, 1));
