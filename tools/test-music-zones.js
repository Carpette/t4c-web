// Sous-zones musicales dessinées + bascule à HYSTÉRÉSIS — test d'intégration :
//  (a) hors de toute sous-zone -> musique de FOND de la zone (music.json) ;
//  (b) enfoncé profondément (> marge) dans une sous-zone -> bascule sur sa piste ;
//  (c) revenu au ras de la frontière puis reculé d'une tuile -> PAS de rebascule
//      (hystérésis : tant qu'on reste dans la frontière réelle, la piste ne change pas) ;
//  (d) enfoncé dans une 2e sous-zone PRIORITAIRE en chevauchement -> piste prioritaire ;
//  un seul message `music` est émis par FRANCHISSEMENT réel (pas de spam).
//
// À lancer sur une base FRAÎCHE (1er compte = admin) avec T4C_OVERRIDES_DIR isolé.
// Usage : node tools/test-music-zones.js [url]
import WebSocket from 'ws';
import { PROTOCOL_VERSION } from '../shared/constants.js';
import { decodeSnapshot, BIN_SNAPSHOT } from '../shared/protocol.js';

const BASE = process.argv[2] || 'http://localhost:8090';
const WS_URL = BASE.replace('http', 'ws');
const checks = [];
const ok = (name, cond) => { checks.push([name, !!cond]); console.log(cond ? '  ✔' : '  ✘', name); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Zone d'essai : champs très praticables au sud de Lighthaven (même secteur que
// le camp par défaut de la suite camps). Deux sous-zones, dont une prioritaire
// CHEVAUCHANT la première.
const ZONE = 0;
const TRACK_A = { legacy: 'exterieur.mp3', new: 'PisteA.mp3' };
const TRACK_B = { legacy: 'exterieur.mp3', new: 'PisteB.mp3' };
// rectangle A : coin (330, 262), 30×30 -> centre (345, 277)
const ZONE_A = { id: 'zoneA', shape: 'rect', x: 330, z: 262, w: 30, h: 30, track: TRACK_A, priority: 0 };
// cercle B prioritaire : centre (343.5, 275.5) — case praticable au cœur de A —, rayon 8
const ZONE_B = { id: 'zoneB', shape: 'circle', x: 343.5, z: 275.5, r: 8, track: TRACK_B, priority: 5 };

// ---------- session WebSocket : positions + suivi des messages `music` ----------
function session(name) {
  const S = {
    name, id: null, self: null, zone: null,
    pos: new Map(),
    musicLog: [],   // toutes les pistes reçues (zone + music), dans l'ordre
    musicPushes: 0, // nombre de messages `music` (hors message `zone`)
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
      case 'zone': S.zone = m; S.pos.clear(); S.musicLog.push(m.music); break;
      case 'music': S.musicPushes++; S.musicLog.push(m.file); break;
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

const trackEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const lastTrack = (S) => S.musicLog[S.musicLog.length - 1];

// téléport admin (instantané) puis attente d'une fenêtre de réévaluation musicale
async function gotoAndSettle(S, x, z) {
  S.send({ t: 'admin', cmd: 'goto', x, z });
  await sleep(400); // > MUSIC_EVAL_EVERY_TICKS pour laisser passer un musicTick
}

// ---------- bot admin (1er compte de la base fraîche) ----------
const A = session('Mello_' + Math.floor(Math.random() * 1e6));
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
const BG = A.zone.music; // musique de fond de la zone (peut être null)

// PUT des deux sous-zones musicales (B prioritaire chevauche A)
await api(`/api/admin/overrides/${ZONE}`, 'PUT', { ...before, music: [ZONE_A, ZONE_B] });
const got = await api(`/api/admin/overrides/${ZONE}`);
ok('PUT/GET : la section music est restituée',
  JSON.stringify(got.music) === JSON.stringify([ZONE_A, ZONE_B]));

// ---------- (a) hors de toute sous-zone : musique de fond ----------
// (l'édition admin réévalue à chaud sans hystérésis -> on part du fond)
await gotoAndSettle(A, 300, 300); // loin de A et B
ok('(a) hors sous-zone : musique de fond de la zone', trackEq(lastTrack(A), BG));

// ---------- (b) enfoncé profondément dans A : bascule sur la piste A ----------
A.musicPushes = 0;
// (350, 268) : dans A (330..360, 262..292), à >4 tuiles des bords, hors du cercle B (dist ~9.9 > 8)
await gotoAndSettle(A, 350, 268);
ok('(b) enfoncé dans A : bascule sur la piste de la sous-zone A', trackEq(lastTrack(A), TRACK_A));
ok('(b) un seul `music` émis pour ce franchissement', A.musicPushes === 1);

// ---------- (c) hystérésis : retour au ras de la frontière de A, puis recul d'1 tuile ----------
A.musicPushes = 0;
// (331.5, 268) : encore DANS A (bord gauche x=330) mais à ~1.5 tuile du bord -> sous la marge
await gotoAndSettle(A, 331.5, 268);
ok('(c) au ras de la frontière de A : la piste A reste (pas de rebascule)', trackEq(lastTrack(A), TRACK_A));
// recul d'une tuile vers l'intérieur : toujours A, toujours aucun changement
await gotoAndSettle(A, 333, 268);
ok('(c) reculé d\'une tuile : toujours la piste A', trackEq(lastTrack(A), TRACK_A));
ok('(c) aucun message `music` superflu pendant l\'aller-retour au bord', A.musicPushes === 0);

// ---------- (d) enfoncé dans B (prioritaire, chevauche A) : piste B ----------
A.musicPushes = 0;
// (343.5, 275.5) : centre de B (rayon 8) -> enfoncé de 8 > marge ; B.priority > A.priority
await gotoAndSettle(A, 343.5, 275.5);
ok('(d) enfoncé dans la sous-zone prioritaire B : bascule sur la piste B', trackEq(lastTrack(A), TRACK_B));
ok('(d) un seul `music` émis pour ce franchissement', A.musicPushes === 1);

// ---------- sortie de toute sous-zone : retour au fond ----------
A.musicPushes = 0;
await gotoAndSettle(A, 300, 300);
ok('sortie de toute sous-zone : retour à la musique de fond', trackEq(lastTrack(A), BG));
ok('un seul `music` émis pour le retour au fond', A.musicPushes === 1);

// ---------- restauration ----------
await api(`/api/admin/overrides/${ZONE}`, 'PUT', before);
const restored = await api(`/api/admin/overrides/${ZONE}`);
ok('restauration des overrides initiaux', JSON.stringify(restored) === JSON.stringify(before));

A.ws.close();
const bad = checks.filter(([, c]) => !c).length;
console.log(bad ? `\n${bad} ÉCHEC(S)` : '\nTOUT EST OK');
await sleep(100);
process.exit(bad ? 1 : 0);
