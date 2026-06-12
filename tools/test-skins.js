// Test d'intégration de l'onglet Skins : téléversement d'une image d'objet,
// import d'une planche de créature, assignations, fichiers servis au client.
// À lancer sur une base FRAÎCHE (1er compte = admin), serveur lancé à part.
// Usage : node tools/test-skins.js [urlHttp=http://localhost:8090]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { PROTOCOL_VERSION } from '../shared/constants.js';

const BASE = process.argv[2] || 'http://localhost:8090';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const checks = [];
const ok = (name, cond) => { checks.push([name, !!cond]); console.log(cond ? '  ✔' : '  ✘', name); };

// PNG 1x1 transparent (en-tête IHDR valide)
const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

// ---- compte admin (1er de la base fraîche) ----
const NAME = 'Skineur_' + Math.floor(Math.random() * 1e6);
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

// ---- 1. téléversement d'une image d'objet ----
const up = await api('/api/admin/skins/upload', 'POST', { name: 'test épée!.png', data: TINY_PNG });
ok('upload image objet (nom assaini)', up.ok && up.file === 'skins/test_p_e.png' || /^skins\/[a-zA-Z0-9_-]+\.png$/.test(up.file || ''));
const served = await fetch(`${BASE}/assets/${up.file}`);
ok('image servie au client (PNG)', served.status === 200 && served.headers.get('content-type') === 'image/png');

// un faux PNG est refusé
const bad = await api('/api/admin/skins/upload', 'POST', { name: 'pasunpng', data: Buffer.from('coucou').toString('base64') });
ok('fichier non-PNG refusé', !!bad.error);

// ---- 2. import d'une planche de créature (fixture : une planche existante) ----
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'client/assets/manifest.json'), 'utf8'));
const fixtureRel = Object.values(manifest.enemies)[0].image;
const fixture = fs.readFileSync(path.join(ROOT, 'client/assets', fixtureRel));
const w = fixture.readUInt32BE(16), h = fixture.readUInt32BE(20);
const cell = [Math.floor(w / 4), Math.floor(h / 8)];
const cfg = {
  name: 'test_skin_creature', cell, anchor: [Math.floor(cell[0] / 2), cell[1] - 2],
  anims: {
    stance: { from: 0, to: 1, duration: 800 },
    run: { from: 0, to: 1, duration: 600 },
    swing: { from: 2, to: 3, duration: 480, type: 'play_once' },
    die: { from: 2, to: 3, duration: 900, type: 'play_once' },
  },
};
const imp = await api('/api/admin/skins/enemy', 'POST', { cfg, data: fixture.toString('base64') });
ok('planche importée (4 animations)', imp.ok && imp.anims?.length === 4);
const m2 = JSON.parse(fs.readFileSync(path.join(ROOT, 'client/assets/manifest.json'), 'utf8'));
ok('sprite présent dans le manifest', !!m2.enemies.test_skin_creature
  && m2.enemies.test_skin_creature.anims.stance.fr['7'].length === 2);

// une planche trop courte (8 lignes impossibles) est refusée
const badCfg = { ...cfg, name: 'test_trop_court', cell: [cell[0], h] };
const imp2 = await api('/api/admin/skins/enemy', 'POST', { cfg: badCfg, data: fixture.toString('base64') });
ok('planche sans 8 lignes refusée', !!imp2.error);

// ---- 3. assignations ----
const before = await api('/api/admin/skins');
ok('GET skins (fichiers + sprites + mapping)', Array.isArray(before.files) && before.sprites.includes('test_skin_creature'));
const put = await api('/api/admin/skins', 'PUT', {
  items: { potion_vie: up.file },
  mobs: { rat: 'test_skin_creature' },
});
ok('assignations enregistrées', put.ok);
const after = await api('/api/admin/skins');
ok('mapping relu (objet + créature)',
  after.map.items.potion_vie === up.file && after.map.mobs.rat === 'test_skin_creature');
const pub = await (await fetch(`${BASE}/content/skins.json`)).json();
ok('skins.json servi aux joueurs', pub.items.potion_vie === up.file && pub.mobs.rat === 'test_skin_creature');

// un sprite inconnu est refusé
const putBad = await api('/api/admin/skins', 'PUT', { items: {}, mobs: { rat: 'sprite_inexistant' } });
ok('sprite inconnu refusé', !!putBad.error);

// ---- nettoyage : assignations, sprite et fichiers de test (même machine) ----
await api('/api/admin/skins', 'PUT', { items: {}, mobs: {} });
try {
  const m3 = JSON.parse(fs.readFileSync(path.join(ROOT, 'client/assets/manifest.json'), 'utf8'));
  delete m3.enemies.test_skin_creature;
  fs.writeFileSync(path.join(ROOT, 'client/assets/manifest.json'), JSON.stringify(m3));
  fs.rmSync(path.join(ROOT, 'client/assets/enemies/test_skin_creature.png'), { force: true });
  fs.rmSync(path.join(ROOT, 'client/assets', up.file), { force: true });
} catch { /* nettoyage best-effort */ }

const failed = checks.filter(([, c]) => !c);
console.log(failed.length ? `\n${failed.length} ÉCHEC(S): ${failed.map(([n]) => n).join(', ')}` : '\nTOUT EST OK');
process.exit(failed.length ? 1 : 0);
