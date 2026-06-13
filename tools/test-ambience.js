// Sous-zones d'AMBIANCE (teinte/obscurité) + bascule à HYSTÉRÉSIS + sources de
// lumière — test d'intégration, calqué sur test-music-zones :
//  (a) hors de toute sous-zone -> aucune ambiance (cycle jour/nuit seul) ;
//  (b) enfoncé profondément (> marge) dans une zone -> le client reçoit sa teinte/obscurité ;
//  (c) revenu au ras de la frontière puis reculé -> PAS de rebascule (hystérésis,
//      MÊMES seuils que la musique) ;
//  (d) enfoncé dans une 2e zone PRIORITAIRE en chevauchement -> son effet prime ;
//  un seul message `ambience` est émis par FRANCHISSEMENT réel (pas de spam) ;
//  (e) les sources de lumière posées (overrides `lights`) sont présentes et
//      validées dans les données de zone (PUT/GET).
//
// À lancer sur une base FRAÎCHE (1er compte = admin) avec T4C_OVERRIDES_DIR isolé.
// Usage : node tools/test-ambience.js [url]
import WebSocket from 'ws';
import { PROTOCOL_VERSION } from '../shared/constants.js';
import { decodeSnapshot, BIN_SNAPSHOT } from '../shared/protocol.js';

const BASE = process.argv[2] || 'http://localhost:8090';
const WS_URL = BASE.replace('http', 'ws');
const checks = [];
const ok = (name, cond) => { checks.push([name, !!cond]); console.log(cond ? '  ✔' : '  ✘', name); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Même secteur praticable que test-music-zones : deux zones d'ambiance, dont une
// prioritaire CHEVAUCHANT la première.
const ZONE = 0;
const TINT_A = 'rgba(40, 80, 50, 0.30)'; // marais verdâtre
const TINT_B = 'rgba(10, 10, 30, 0.50)'; // crypte sombre
// rectangle A : coin (330, 262), 30×30 -> centre (345, 277), teinte + légère obscurité
const ZONE_A = { id: 'ambA', shape: 'rect', x: 330, z: 262, w: 30, h: 30, tint: TINT_A, darkness: 0.2, priority: 0 };
// cercle B prioritaire : centre (343.5, 275.5), rayon 8, plus sombre
const ZONE_B = { id: 'ambB', shape: 'circle', x: 343.5, z: 275.5, r: 8, tint: TINT_B, darkness: 0.5, priority: 5 };
// sources de lumière : une avec couleur+scintillement, une invalide (r<=0, ignorée)
const LIGHTS = [
  { id: 'l1', x: 345, z: 277, r: 320, color: 'rgba(255, 170, 70, 0.2)', flicker: true },
  { id: 'l2', x: 350, z: 270, r: 0 }, // rayon nul : rejetée
];

function session(name) {
  const S = {
    name, id: null, self: null, zone: null,
    pos: new Map(),
    ambLog: [],     // toutes les ambiances reçues (zone + ambience), dans l'ordre
    ambPushes: 0,   // nombre de messages `ambience` (hors message `zone`)
  };
  const ws = new WebSocket(WS_URL);
  ws.on('message', (raw, bin) => {
    if (bin) {
      const ab = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
      if (new DataView(ab).getUint8(0) !== BIN_SNAPSHOT) return;
      const snap = decodeSnapshot(ab);
      for (const e of snap.entities) S.pos.set(e.id, e);
      for (const id of snap.gone) S.pos.delete(id);
      return;
    }
    const m = JSON.parse(raw.toString());
    switch (m.t) {
      case 'create_char': S.send({ t: 'create', stats: { str: 22, end: 18, agi: 14, int: 8, wis: 8 } }); break;
      case 'welcome': S.id = m.id; break;
      case 'self': S.self = m; break;
      case 'zone': S.zone = m; S.pos.clear(); S.ambLog.push(m.ambience ?? null); break;
      case 'ambience': S.ambPushes++; S.ambLog.push(m.ambience ?? null); break;
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
  return S;
}

const ambEq = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const lastAmb = (S) => S.ambLog[S.ambLog.length - 1];
const EFF_A = { tint: TINT_A, darkness: 0.2 };
const EFF_B = { tint: TINT_B, darkness: 0.5 };

async function gotoAndSettle(S, x, z) {
  S.send({ t: 'admin', cmd: 'goto', x, z });
  await sleep(400); // > AMBIENCE_EVAL_EVERY_TICKS pour laisser passer un ambienceTick
}

// ---------- bot admin (1er compte de la base fraîche) ----------
const A = session('Brume_' + Math.floor(Math.random() * 1e6));
await A.open;
A.send({ t: 'register', v: PROTOCOL_VERSION, name: A.name, pass: 'test1234' });
await A.waitFor(() => A.self && A.zone && A.pos.get(A.id));
ok('connexion zone 0', A.zone?.zoneId === ZONE);

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

const before = await api(`/api/admin/overrides/${ZONE}`); // restauration finale

// PUT des deux zones d'ambiance (B prioritaire chevauche A) + des lumières
await api(`/api/admin/overrides/${ZONE}`, 'PUT', { ...before, ambience: [ZONE_A, ZONE_B], lights: LIGHTS });
const got = await api(`/api/admin/overrides/${ZONE}`);
ok('PUT/GET : la section ambience est restituée',
  JSON.stringify(got.ambience) === JSON.stringify([ZONE_A, ZONE_B]));
ok('(e) PUT/GET : la section lights est restituée (source valide + invalide conservées telles quelles)',
  JSON.stringify(got.lights) === JSON.stringify(LIGHTS));

// ---------- (a) hors de toute sous-zone : aucune ambiance ----------
await gotoAndSettle(A, 300, 300); // loin de A et B
ok('(a) hors zone d\'ambiance : aucune ambiance (cycle jour/nuit seul)', ambEq(lastAmb(A), null));

// ---------- (b) enfoncé profondément dans A : teinte/obscurité de A ----------
A.ambPushes = 0;
await gotoAndSettle(A, 350, 268); // dans A, à >4 tuiles des bords, hors du cercle B
ok('(b) enfoncé dans A : le client reçoit la teinte/obscurité de A', ambEq(lastAmb(A), EFF_A));
ok('(b) un seul `ambience` émis pour ce franchissement', A.ambPushes === 1);

// ---------- (c) hystérésis : retour au ras de la frontière de A, puis recul ----------
A.ambPushes = 0;
await gotoAndSettle(A, 331.5, 268); // encore DANS A mais à ~1.5 tuile du bord (< marge)
ok('(c) au ras de la frontière de A : l\'ambiance A reste (pas de rebascule)', ambEq(lastAmb(A), EFF_A));
await gotoAndSettle(A, 333, 268);
ok('(c) reculé d\'une tuile : toujours l\'ambiance A', ambEq(lastAmb(A), EFF_A));
ok('(c) aucun message `ambience` superflu pendant l\'aller-retour au bord', A.ambPushes === 0);

// ---------- (d) enfoncé dans B (prioritaire, chevauche A) : effet de B ----------
A.ambPushes = 0;
await gotoAndSettle(A, 343.5, 275.5); // centre de B (rayon 8) ; B.priority > A.priority
ok('(d) enfoncé dans la zone prioritaire B : bascule sur l\'ambiance B', ambEq(lastAmb(A), EFF_B));
ok('(d) un seul `ambience` émis pour ce franchissement', A.ambPushes === 1);

// ---------- sortie de toute sous-zone : retour à aucune ambiance ----------
A.ambPushes = 0;
await gotoAndSettle(A, 300, 300);
ok('sortie de toute zone d\'ambiance : retour à aucune ambiance', ambEq(lastAmb(A), null));
ok('un seul `ambience` émis pour le retour au fond', A.ambPushes === 1);

// ---------- restauration ----------
await api(`/api/admin/overrides/${ZONE}`, 'PUT', before);
const restored = await api(`/api/admin/overrides/${ZONE}`);
ok('restauration des overrides initiaux', JSON.stringify(restored) === JSON.stringify(before));

A.ws.close();
const bad = checks.filter(([, c]) => !c).length;
console.log(bad ? `\n${bad} ÉCHEC(S)` : '\nTOUT EST OK');
await sleep(100);
process.exit(bad ? 1 : 0);
