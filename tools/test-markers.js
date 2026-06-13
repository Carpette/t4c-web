// Points spéciaux + coffres configurables + téléport admin — test d'intégration :
// 1. coffre personnalisé (overrides `chests`) : l'ouverture honore le butin
//    défini (or de la fourchette + objet certain), pas le pool générique ;
// 2. marqueur 'teleport' (overrides `markers`) : un bot qui marche dessus est
//    téléporté vers la cible (même zone) ;
// 3. marqueur 'spawn' : redéfinit le point d'apparition de la zone (vérifié via
//    la commande admin `zone` qui dépose au spawnPoint) ;
// 4. route HTTP /api/admin/teleport : déplace le perso EN LIGNE de l'admin.
// À lancer sur une base FRAÎCHE (1er compte = admin). Usage : node tools/test-markers.js [url]
import WebSocket from 'ws';
import { PROTOCOL_VERSION, KIND } from '../shared/constants.js';
import { decodeSnapshot, BIN_SNAPSHOT } from '../shared/protocol.js';

const BASE = process.argv[2] || 'http://localhost:8090';
const WS_URL = BASE.replace('http', 'ws');
const checks = [];
const ok = (name, cond) => { checks.push([name, !!cond]); console.log(cond ? '  ✔' : '  ✘', name); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---------- session WebSocket (positions + métas + drops + self) ----------
function session(name) {
  const S = { name, id: null, self: null, zone: null, pos: new Map(), drops: new Map(), loots: [] };
  const ws = new WebSocket(WS_URL);
  ws.on('message', (raw, bin) => {
    if (bin) {
      const ab = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
      if (new DataView(ab).getUint8(0) !== BIN_SNAPSHOT) return;
      const snap = decodeSnapshot(ab);
      for (const e of snap.entities) {
        S.pos.set(e.id, e);
        if (e.kind === KIND.DROP) S.drops.set(e.id, e);
      }
      for (const id of snap.gone) { S.pos.delete(id); S.drops.delete(id); }
      return;
    }
    const m = JSON.parse(raw.toString());
    switch (m.t) {
      case 'create_char': S.send({ t: 'create', stats: { str: 22, end: 18, agi: 14, int: 8, wis: 8 } }); break;
      case 'welcome': S.id = m.id; break;
      case 'self': S.self = m; break;
      case 'zone': S.zone = m; break;
      case 'loot': S.loots.push(m.text); break;
    }
  });
  S.ws = ws;
  S.send = (o) => ws.send(JSON.stringify(o));
  S.waitFor = (fn, timeout = 8000) => new Promise((res) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      const v = fn();
      if (v) { clearInterval(iv); res(v); }
      else if (Date.now() - t0 > timeout) { clearInterval(iv); res(null); }
    }, 40);
  });
  S.open = new Promise(r => ws.on('open', r));
  S.me = () => S.pos.get(S.id);
  return S;
}

const A = session('Marqueur_' + Math.floor(Math.random() * 1e6));
await A.open;
A.send({ t: 'register', v: PROTOCOL_VERSION, name: A.name, pass: 'test1234' });
await A.waitFor(() => A.self && A.zone && A.me());
ok('connexion zone 0', A.zone?.zoneId === 0);

const login = await (await fetch(`${BASE}/api/admin/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: A.name, pass: 'test1234' }),
})).json();
ok('connexion admin', !!login.token);
const api = async (url, method = 'GET', body = null) => {
  const r = await fetch(BASE + url, {
    method,
    headers: { Authorization: `Bearer ${login.token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : null,
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || r.status);
  return j;
};

const before0 = await api('/api/admin/overrides/0'); // restauration finale

// téléporte l'admin sur une case et attend qu'il y soit
async function gotoTile(x, z) {
  A.send({ t: 'admin', cmd: 'goto', x: x + 0.5, z: z + 0.5 });
  await A.waitFor(() => { const me = A.me(); return me && Math.hypot(me.x - (x + 0.5), me.z - (z + 0.5)) < 0.6; }, 4000);
}

// ---------- 1. coffre personnalisé : butin défini honoré ----------
// case praticable au sud de Lighthaven (zone 0, même secteur que test-camps)
const CX = 343, CZ = 275;
await api('/api/admin/overrides/0', 'PUT', {
  ...before0,
  props: { add: [...(before0.props?.add || []), { type: 'chest', x: CX, z: CZ }], remove: before0.props?.remove || [] },
  chests: [{ x: CX, z: CZ, gold: [777, 777], items: [{ defId: 'potion_vie', n: 1, chance: 1 }] }],
});
const got = await api('/api/admin/overrides/0');
ok('PUT/GET : la section chests est restituée', got.chests?.[0]?.gold?.[0] === 777);

// se placer à portée d'interaction du coffre puis l'ouvrir
await gotoTile(CX + 1, CZ);
A.drops.clear(); A.loots = [];
A.send({ t: 'interact', prop: 'chest', x: CX + 0.5, z: CZ + 0.5 });
await A.waitFor(() => A.drops.size >= 2, 4000); // or 777 + potion (chance 1)
const drops = [...A.drops.values()];
ok(`coffre personnalisé : butin déposé (${drops.length} objets au sol)`, drops.length >= 2);
ok('coffre personnalisé : ouverture signalée', A.loots.some(t => /coffre/i.test(t)));

// ---------- 2. marqueur 'teleport' : marcher dessus téléporte ----------
// déclencheur en (TX,TZ), cible plus loin dans la même zone
const TX = 343, TZ = 270, DEST_X = 343.5, DEST_Z = 285.5;
await api('/api/admin/overrides/0', 'PUT', {
  ...before0,
  markers: [{ id: 'tp1', kind: 'teleport', x: TX + 0.5, z: TZ + 0.5, target: { zoneId: 0, x: DEST_X, z: DEST_Z } }],
});
await gotoTile(TX, TZ); // marche sur le déclencheur via la commande admin
const tp = await A.waitFor(() => { const me = A.me(); return me && Math.hypot(me.x - DEST_X, me.z - DEST_Z) < 1.5; }, 4000);
ok('marqueur teleport : le joueur est transporté vers la cible', !!tp);

// ---------- 3. marqueur 'spawn' : redéfinit le point d'apparition ----------
const SX = 343.5, SZ = 280.5;
await api('/api/admin/overrides/0', 'PUT', {
  ...before0,
  markers: [{ id: 'sp1', kind: 'spawn', x: SX, z: SZ }],
});
// la commande admin `zone` dépose au spawnPoint de la zone : doit être le marqueur
A.send({ t: 'admin', cmd: 'zone', zoneId: 1 }); // sortir...
await A.waitFor(() => A.zone?.zoneId === 1, 4000);
A.send({ t: 'admin', cmd: 'zone', zoneId: 0 }); // ...puis revenir : dépose au spawnPoint
const sp = await A.waitFor(() => A.zone?.zoneId === 0 && (() => { const me = A.me(); return me && Math.hypot(me.x - SX, me.z - SZ) < 1.5; })(), 4000);
ok('marqueur spawn : on réapparaît au point d\'apparition redéfini', !!sp);

// ---------- 4. route HTTP /api/admin/teleport ----------
const HX = 345.5, HZ = 272.5; // case praticable du même secteur
const r = await api('/api/admin/teleport', 'POST', { zoneId: 0, x: HX, z: HZ });
ok('route teleport : succès', r.ok === true);
const arrived = await A.waitFor(() => { const me = A.me(); return me && Math.hypot(me.x - HX, me.z - HZ) < 1.5; }, 4000);
ok('route teleport : le perso en ligne est déplacé', !!arrived);

// ---------- restauration ----------
await api('/api/admin/overrides/0', 'PUT', before0);
A.ws.close();

const bad = checks.filter(([, c]) => !c).length;
console.log(bad ? `\n${bad} ÉCHEC(S)` : '\nMARQUEURS / COFFRES OK');
process.exit(bad ? 1 : 0);
