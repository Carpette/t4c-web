// Test d'intégration des boss de zone : réveil annoncé au boot, mise à mort
// (butin, annonce de défaite avec délai), respawn après le délai persisté.
// À lancer sur une base FRAÎCHE, serveur lancé à part AVEC
// T4C_BOSS_RESPAWN_MS=4000 (sinon le respawn réel est de plusieurs heures).
// Usage : node tools/test-boss.js [urlHttp=http://localhost:8090]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { PROTOCOL_VERSION } from '../shared/constants.js';

const BASE = process.argv[2] || 'http://localhost:8090';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const boss0 = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'zones.json'), 'utf8')).zones[0].boss;
const checks = [];
const ok = (name, cond) => { checks.push([name, !!cond]); console.log(cond ? '  ✔' : '  ✘', name); };

const ws = new WebSocket(BASE.replace('http', 'ws'));
const inbox = [];
ws.on('message', (raw, bin) => { if (!bin) inbox.push(JSON.parse(raw.toString())); });
const send = (m) => ws.send(JSON.stringify(m));
const wait = (pred, ms = 4000) => new Promise((res) => {
  const t0 = Date.now();
  const iv = setInterval(() => {
    const m = inbox.find(pred);
    if (m || Date.now() - t0 > ms) { clearInterval(iv); res(m || null); }
  }, 50);
});
const texts = (m) => m.t === 'events' ? (m.list || []).map(e => JSON.stringify(e)) : [m.text || ''];

ws.on('open', () => send({ t: 'register', v: PROTOCOL_VERSION, name: 'Chasseur' + (Math.random() * 1e6 | 0), pass: 'test1234' }));
await new Promise((res) => { const iv = setInterval(() => {
  if (inbox.some(m => m.t === 'create_char')) send({ t: 'create', stats: { str: 22, end: 18, agi: 14, int: 8, wis: 8 } });
  if (inbox.some(m => m.t === 'welcome')) { clearInterval(iv); res(); }
}, 50); });

// ---- 1. le boss d'Arakas se dresse déjà (base fraîche : dû au boot) ----
ok('définition du boss d\u2019Arakas (zones.json)', boss0?.name?.includes("Gro'Mak"));
// au boot il apparaît en silencieux ; on le vérifie sur le terrain

// ---- 2. rendez-vous au pont, mise à mort par foudre (super admin) ----
// le point déclaré peut être non praticable (le spawn cherche la case la
// plus proche) : on approche par plusieurs angles et on foudroie à chaque halte
inbox.length = 0;
let slain = null;
for (const [dx, dz] of [[0, 0], [0, 1], [0, 2], [2, 0], [-2, 0], [0, -2], [2, 2]]) {
  send({ t: 'admin', cmd: 'goto', x: boss0.x + dx, z: boss0.z + dz });
  await new Promise(r => setTimeout(r, 350));
  send({ t: 'admin', cmd: 'smite' });
  slain = await wait(m => m.t === 'announce' && /terrassé/.test(m.text), 1200);
  if (slain) break;
}
ok('mise à mort annoncée à tout le serveur', !!slain && slain.text.includes("Gro'Mak"));
ok('l\u2019annonce donne le délai de retour', !!slain && /reviendra dans environ/.test(slain.text));
ok('le vainqueur est nommé', !!slain && /Chasseur/.test(slain.text));
// le butin apparaît en entités DROP : leurs métadonnées (or, objets)
// arrivent par messages 'meta' au joueur adjacent
const loot = await wait(m => m.t === 'meta'
  && (m.list || []).some(e => (e.gold | 0) > 0 || (e.defId && e.q !== undefined)), 2500);
ok('butin au sol (trésor d\u2019or garanti + tables de drop)',
  !!loot || inbox.some(m => m.t === 'meta' && (m.list || []).some(e => (e.gold | 0) > 0)));

// ---- 3. respawn après le délai court (T4C_BOSS_RESPAWN_MS=4000) ----
inbox.length = 0;
const back = await wait(m => m.t === 'announce' && /s'éveille/.test(m.text), 12000);
ok('réveil annoncé après le délai (persistance + tick de contrôle)',
  !!back && back.text.includes("Gro'Mak") && /Arakas/.test(back.text));

ws.close();
const failed = checks.filter(([, c]) => !c);
console.log(failed.length ? `\n${failed.length} ÉCHEC(S)` : '\nTOUT EST OK');
process.exit(failed.length ? 1 : 0);
