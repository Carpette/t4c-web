// Client headless : vérifie que le serveur sert la page, le contenu des
// sorts, et qu'un compte peut s'enregistrer et recevoir le monde complet
// (welcome, self, zone, snapshot binaire). Affiche CLIENT HEADLESS OK.
// Usage : node tools/test-client.mjs http://localhost:8090
import WebSocket from 'ws';
import { decodeSnapshot, BIN_SNAPSHOT } from '../shared/protocol.js';

const base = (process.argv[2] || 'http://localhost:8080').replace(/\/$/, '');
const wsUrl = base.replace(/^http/, 'ws');
const fail = (msg) => { console.error('ÉCHEC :', msg); process.exit(1); };

// --- 1. la page du jeu et le contenu se servent ---
const page = await fetch(base + '/').then(r => r.ok ? r.text() : null).catch(() => null);
if (!page || !page.includes('id="game"') || !page.includes('id="castbar"')) {
  fail('page de jeu absente ou incomplète (canvas/castbar)');
}
const spells = await fetch(base + '/content/spells.json').then(r => r.json()).catch(() => null);
if (!spells || !Array.isArray(spells.spells) || spells.spells.length < 70) {
  fail('contenu des sorts illisible ou incomplet');
}
for (const f of ['/js/main.js', '/js/ui.js', '/css/style.css', '/shared/constants.js']) {
  const r = await fetch(base + f).catch(() => null);
  if (!r || !r.ok) fail(`fichier client manquant : ${f}`);
}

// --- 2. enregistrement + réception du monde ---
const ws = new WebSocket(wsUrl);
const got = { welcome: false, self: false, zone: false, snapshot: false };
ws.on('message', (raw, bin) => {
  if (bin) {
    const ab = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
    if (new DataView(ab).getUint8(0) === BIN_SNAPSHOT && decodeSnapshot(ab)) got.snapshot = true;
    return;
  }
  const m = JSON.parse(raw.toString());
  if (m.t === 'create_char') {
    ws.send(JSON.stringify({ t: 'create', stats: { str: 14, end: 22, agi: 12, int: 11, wis: 11 }, sex: 'male' }));
  }
  if (m.t === 'welcome') got.welcome = true;
  if (m.t === 'self') got.self = true;
  if (m.t === 'zone') got.zone = true;
  if (m.t === 'auth_error') fail('auth_error : ' + m.error);
});
await new Promise(r => ws.on('open', r));
ws.send(JSON.stringify({ t: 'register', name: 'Headless_' + Math.floor(Math.random() * 1e6), pass: 'test1234' }));

const t0 = Date.now();
while (Date.now() - t0 < 8000) {
  if (got.welcome && got.self && got.zone && got.snapshot) {
    console.log('CLIENT HEADLESS OK');
    process.exit(0);
  }
  await new Promise(r => setTimeout(r, 50));
}
fail('monde incomplet : ' + JSON.stringify(got));
