// Test d'intégration de l'atelier terrains : POST /api/admin/tiles
// (upload PNG + rects -> écrit le fichier + fusionne le manifeste en tileset user_).
// À lancer sur une base FRAÎCHE (1er compte = admin), serveur lancé à part.
// Usage : node tools/test-tiles.js [urlHttp=http://localhost:8090]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { PROTOCOL_VERSION } from '../shared/constants.js';

const BASE = process.argv[2] || 'http://localhost:8090';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = path.join(ROOT, 'client/assets/manifest.json');
const ORIG_MANIFEST = fs.readFileSync(MANIFEST); // octets d'origine (restaurés en fin de test)
const checks = [];
const ok = (name, cond) => { checks.push([name, !!cond]); console.log(cond ? '  ✔' : '  ✘', name); };

// PNG 1x1 transparent (en-tête IHDR valide -> accepté par pngSize)
const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

// ---- compte admin (1er de la base fraîche) ----
const NAME = 'Terr_' + Math.floor(Math.random() * 1e5);
await new Promise((resolve, reject) => {
  const ws = new WebSocket(BASE.replace('http', 'ws'));
  ws.on('open', () => ws.send(JSON.stringify({ t: 'register', v: PROTOCOL_VERSION, name: NAME, pass: 'test1234' })));
  ws.on('message', (raw, bin) => {
    if (bin) return;
    const m = JSON.parse(raw.toString());
    if (m.t === 'create_char') ws.send(JSON.stringify({ t: 'create', stats: { str: 22, end: 18, agi: 14, int: 8, wis: 8 } }));
    if (m.t === 'welcome') { ws.close(); resolve(); }
    if (m.t === 'auth_error') reject(new Error(m.error));
  });
  setTimeout(() => reject(new Error('timeout création compte')), 8000);
});
const login = await (await fetch(`${BASE}/api/admin/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: NAME, pass: 'test1234' }),
})).json();
ok('login admin', !!login.token);
const H = { Authorization: `Bearer ${login.token}`, 'Content-Type': 'application/json' };
const api = (url, method = 'GET', body = null) =>
  fetch(BASE + url, { method, headers: H, body: body ? JSON.stringify(body) : null }).then(r => r.json());

// ---- 1. enregistrement d'un matériau de MUR (nom assaini, 3 pièces) ----
const wallTiles = { 0: [0, 0, 64, 96, 32, 80], 1: [64, 0, 64, 96, 32, 80], 2: [128, 0, 64, 96, 32, 80] };
const w = await api('/api/admin/tiles', 'POST', { name: 'poc mur!', kind: 'mur', data: TINY_PNG, tiles: wallTiles, names: ['Mur ↘ (arête)', 'Mur ↙ (arête)', 'Poteau'] });
ok('POST mur : nom assaini -> wall_u_poc_mur_ + 3 frames', w.ok && w.tileset === 'wall_u_poc_mur_' && w.frames === 3);

const served = await fetch(`${BASE}/assets/tilesets/user/poc_mur_.png`);
ok('PNG servi au client', served.status === 200 && served.headers.get('content-type') === 'image/png');

const m1 = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const ent = m1.tilesets.wall_u_poc_mur_;
ok('entrée manifeste : images + tiles', !!ent && ent.images[0] === 'tilesets/user/poc_mur_.png' && Object.keys(ent.tiles).length === 3);
ok('rect au schéma [x,y,w,h,ox,oy,imgIndex=0]', !!ent && Array.isArray(ent.tiles['0']) && ent.tiles['0'].length === 7 && ent.tiles['0'][6] === 0);
ok('mur : edgekit + names + label (outil de tracé + palette)', !!ent && ent.edgekit === true
  && Array.isArray(ent.names) && ent.names[0].includes('Mur') && ent.family === 'mur' && ent.user === true && ent.label === 'poc mur!');

// ---- 2. sol / toit : préfixes floor_u_ / roof_u_ ----
const s = await api('/api/admin/tiles', 'POST', { name: 'poc_sol', kind: 'sol', data: TINY_PNG, tiles: { 0: [0, 0, 192, 96, 96, 48] } });
const r = await api('/api/admin/tiles', 'POST', { name: 'poc_toit', kind: 'toit', data: TINY_PNG, tiles: { 0: [0, 0, 220, 160, 110, 200] } });
const m2 = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
ok('POST sol : tileset floor_u_ + type sol', s.ok && s.tileset === 'floor_u_poc_sol' && m2.tilesets.floor_u_poc_sol.types['0'] === 'sol');
ok('POST toit : tileset roof_u_ + famille toit', r.ok && r.tileset === 'roof_u_poc_toit' && m2.tilesets.roof_u_poc_toit.family === 'toit');

// ---- 3. validations ----
const bad1 = await api('/api/admin/tiles', 'POST', { name: 'x', kind: 'sol', data: Buffer.from('nope').toString('base64'), tiles: { 0: [0, 0, 1, 1, 0, 0] } });
ok('PNG invalide refusé', !!bad1.error);
const bad2 = await api('/api/admin/tiles', 'POST', { name: 'y', kind: 'sol', data: TINY_PNG, tiles: {} });
ok('rects manquants refusés', !!bad2.error);
const bad3 = await api('/api/admin/tiles', 'POST', { name: 'z', kind: 'sol', data: TINY_PNG, tiles: { 0: [0, 0, 1] } });
ok('rect trop court refusé', !!bad3.error);

// ---- nettoyage (best-effort, même machine) ----
try {
  fs.writeFileSync(MANIFEST, ORIG_MANIFEST); // restaure les octets exacts (aucune trace)
  fs.rmSync(path.join(ROOT, 'client/assets/tilesets/user/poc_mur_.png'), { force: true });
  fs.rmSync(path.join(ROOT, 'client/assets/tilesets/user/poc_sol.png'), { force: true });
  fs.rmSync(path.join(ROOT, 'client/assets/tilesets/user/poc_toit.png'), { force: true });
} catch { /* best-effort */ }

const failed = checks.filter(([, c]) => !c);
console.log(failed.length ? `\n${failed.length} ÉCHEC(S): ${failed.map(([n]) => n).join(', ')}` : '\nTOUT EST OK');
process.exit(failed.length ? 1 : 0);
