// Test d'intégration de la pose d'objets au sol (échanges entre joueurs) :
// A pose un objet et de l'or, B les voit apparaître et les ramasse.
// Usage : node tools/test-drop.js [url]  (serveur lancé à part)
import WebSocket from 'ws';
import { decodeSnapshot, BIN_SNAPSHOT } from '../shared/protocol.js';
import { KIND } from '../shared/constants.js';

const URL = process.argv[2] || 'ws://localhost:8090';
const checks = [];
const ok = (name, cond) => { checks.push([name, !!cond]); console.log(cond ? '  ✔' : '  ✘', name); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function session(name) {
  const S = { self: null, zone: null, id: null, drops: new Map(), loots: [] };
  const ws = new WebSocket(URL);
  ws.on('message', (raw, bin) => {
    if (bin) {
      const ab = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
      if (new DataView(ab).getUint8(0) !== BIN_SNAPSHOT) return;
      const snap = decodeSnapshot(ab);
      for (const e of snap.entities) if (e.kind === KIND.DROP) S.drops.set(e.id, e);
      for (const id of snap.gone) S.drops.delete(id);
      return;
    }
    const m = JSON.parse(raw.toString());
    if (m.t === 'create_char') S.send({ t: 'create', stats: { str: 22, end: 18, agi: 14, int: 8, wis: 8 } });
    else if (m.t === 'welcome') S.id = m.id;
    else if (m.t === 'self') S.self = m;
    else if (m.t === 'zone') S.zone = m;
    else if (m.t === 'loot') S.loots.push(m.text);
  });
  S.ws = ws;
  S.send = (o) => ws.send(JSON.stringify(o));
  S.waitFor = (fn, timeout = 8000) => new Promise((res) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      const v = fn();
      if (v) { clearInterval(iv); res(v); }
      else if (Date.now() - t0 > timeout) { clearInterval(iv); res(null); }
    }, 50);
  });
  S.open = new Promise(r => ws.on('open', r));
  S.register = async () => {
    await S.open;
    S.send({ t: 'register', name, pass: 'test1234' });
    await S.waitFor(() => S.self && S.zone);
  };
  return S;
}

const suffix = Math.floor(Math.random() * 1e6);
const A = session('Donneur_' + suffix);
const B = session('Receveur_' + suffix);
await A.register();
await B.register();
ok('A et B connectés en zone 0', A.zone?.zoneId === 0 && B.zone?.zoneId === 0);

// --- A pose un objet ---
const invBefore = A.self.inventory.length;
const item = A.self.inventory[0];
A.send({ t: 'drop', iid: item.iid });
await A.waitFor(() => A.self.inventory.length === invBefore - 1);
ok('A : objet retiré de l\'inventaire', A.self.inventory.length === invBefore - 1);
ok('A : message "Posé au sol"', A.loots.some(t => t.startsWith('Posé au sol')));

// --- A pose de l'or ---
const goldBefore = A.self.gold;
A.send({ t: 'drop', gold: 5 });
await A.waitFor(() => A.self.gold === goldBefore - 5);
ok('A : or débité (-5)', A.self.gold === goldBefore - 5);

// poser plus d'or qu'on n'en a : plafonné
A.send({ t: 'drop', gold: 99999 });
await A.waitFor(() => A.self.gold === 0);
ok('A : or surnuméraire plafonné (solde 0)', A.self.gold === 0);

// --- B voit les drops et les ramasse ---
await sleep(500);
const seen = [...B.drops.values()];
ok('B : voit au moins 2 objets au sol', seen.length >= 2);
const bInvBefore = B.self.inventory.length;
const bGoldBefore = B.self.gold;
for (const d of seen) B.send({ t: 'pickup', id: d.id });
await B.waitFor(() => B.self.inventory.length > bInvBefore && B.self.gold > bGoldBefore, 10000);
ok('B : a ramassé l\'objet', B.self.inventory.length > bInvBefore);
ok('B : a ramassé l\'or', B.self.gold > bGoldBefore);

// --- iid invalide : ignoré sans crash ---
A.send({ t: 'drop', iid: 999999 });
await sleep(300);
ok('drop d\'un iid invalide ignoré', A.ws.readyState === 1);

const failed = checks.filter(([, c]) => !c);
console.log(failed.length ? `\n✘ ${failed.length} échec(s)` : '\n✔ Tous les tests passent');
A.ws.close(); B.ws.close();
process.exit(failed.length ? 1 : 0);
