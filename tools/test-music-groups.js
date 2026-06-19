// Groupes de musique (listes nommées réutilisables) — test d'intégration de la
// RÉSOLUTION serveur via l'API admin /api/admin/music :
//  (a) une zone qui RÉFÉRENCE un groupe { group:"id" } -> le serveur pousse l'OBJET
//      groupe complet { new:[...], legacy } (la LISTE, pas un fichier seul) ;
//  (b) une zone à l'ANCIEN format { legacy, new } -> poussée telle quelle (compat) ;
//  (c) une zone qui référence un groupe INEXISTANT -> repli silence (null) ;
//  (d) une sous-zone musicale (override) qui référence un groupe -> liste poussée ;
// Les changements de zone se font par la commande admin { cmd:'zone', zoneId }.
//  PUT/GET : la section `groups` et les références `{group}` sont bien restituées.
//
// Le mapping `music` est GLOBAL : on téléporte un bot admin dans chaque zone et on
// observe l'emplacement reçu (message `zone` à l'arrivée + push `music` à chaud).
// À lancer sur une base FRAÎCHE (1er compte = admin) avec T4C_OVERRIDES_DIR isolé.
// Usage : node tools/test-music-groups.js [url]
import WebSocket from 'ws';
import { PROTOCOL_VERSION } from '../shared/constants.js';
import { decodeSnapshot, BIN_SNAPSHOT } from '../shared/protocol.js';

const BASE = process.argv[2] || 'http://localhost:8090';
const WS_URL = BASE.replace('http', 'ws');
const checks = [];
const ok = (name, cond) => { checks.push([name, !!cond]); console.log(cond ? '  ✔' : '  ✘', name); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Trois zones de test (existantes dans le monde) : 0 (spawn), 1 et 2.
const ZONE_A = 0; // référencera un groupe
const ZONE_B = 1; // restera à l'ancien format { legacy, new }
const ZONE_C = 2; // référencera un groupe INEXISTANT (repli silence)

// Le groupe sous test : LISTE de pistes (pack new) + une piste legacy unique.
const GROUP_ID = 'foret';
const GROUP = { new: ['ForetA.mp3', 'ForetB.mp3', 'ForetC.mp3'], legacy: 'exterieur.mp3' };
// 2e groupe, DISTINCT, pour la sous-zone (afin que le push diffère du fond de zone A).
const GROUP2_ID = 'grotte';
const GROUP2 = { new: ['GrotteA.mp3', 'GrotteB.mp3'], legacy: 'cave.mp3' };
const SLOT_B = { legacy: 'exterieur.mp3', new: 'Velours.mp3' }; // ancien format

// ---------- session WebSocket ----------
function session(name) {
  const S = { name, id: null, self: null, zone: null, pos: new Map(), musicLog: [], musicPushes: 0 };
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

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const lastMusic = (S) => S.musicLog[S.musicLog.length - 1];

// ---------- bot admin (1er compte de la base fraîche) ----------
const A = session('Sylve_' + Math.floor(Math.random() * 1e6));
await A.open;
A.send({ t: 'register', v: PROTOCOL_VERSION, name: A.name, pass: 'test1234' });
await A.waitFor(() => A.self && A.zone && A.pos.get(A.id));
ok('connexion zone 0', A.zone?.zoneId === ZONE_A);

const login = await (await fetch(`${BASE}/api/admin/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: A.name, pass: 'test1234' }),
})).json();
ok('connexion admin', !!login.token);
const api = async (url, method = 'GET', body = null) => {
  const r = await fetch(BASE + url, {
    method, headers: { Authorization: `Bearer ${login.token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : null,
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || r.status);
  return j;
};

// sauvegarde du mapping musique courant (restauration finale)
const beforeMusic = (await api('/api/admin/music')).map;
const beforeOv0 = await api(`/api/admin/overrides/${ZONE_A}`);

// ---------- PUT d'un mapping avec un groupe + des références ----------
// zone A -> groupe ; zone B -> ancien format ; zone C -> groupe inexistant (repli).
const map = {
  login: { legacy: null, new: null },
  trial: { legacy: null, new: null },
  groups: { [GROUP_ID]: GROUP, [GROUP2_ID]: GROUP2 },
  zones: {
    [String(ZONE_A)]: { group: GROUP_ID },
    [String(ZONE_B)]: SLOT_B,
    [String(ZONE_C)]: { group: 'inconnu' }, // référence cassée -> repli silence
  },
};
await api('/api/admin/music', 'PUT', map);
const got = (await api('/api/admin/music')).map;
ok('PUT/GET : la section groups est restituée', eq(got.groups?.[GROUP_ID], GROUP));
ok('PUT/GET : la référence { group } de la zone A est restituée', eq(got.zones?.[String(ZONE_A)], { group: GROUP_ID }));
ok('PUT/GET : l\'ancien format de la zone B est restitué', eq(got.zones?.[String(ZONE_B)], SLOT_B));

// refreshMusic pousse à chaud : on attend un push `music` pour la zone A (le bot y est)
await A.waitFor(() => A.musicPushes > 0, 3000);

// ---------- (a) la zone A référençant un groupe reçoit l'OBJET GROUPE (liste) ----------
ok('(a) zone A : le serveur pousse l\'objet groupe complet (liste new + legacy)',
  eq(lastMusic(A), GROUP));
ok('(a) la piste poussée est bien une LISTE, pas un fichier seul',
  Array.isArray(lastMusic(A)?.new) && lastMusic(A).new.length === GROUP.new.length);

// ---------- (b) la zone B (ancien format) reçoit son slot { legacy, new } ----------
A.send({ t: 'admin', cmd: 'zone', zoneId: ZONE_B });
const inB = await A.waitFor(() => A.zone?.zoneId === ZONE_B, 5000);
ok('téléport vers la zone B', !!inB);
ok('(b) zone B (ancien format) : slot { legacy, new } poussé tel quel (compat)',
  eq(A.zone?.music, SLOT_B));

// ---------- (c) groupe référencé mais INEXISTANT -> silence (repli) ----------
A.send({ t: 'admin', cmd: 'zone', zoneId: ZONE_C });
const inC = await A.waitFor(() => A.zone?.zoneId === ZONE_C, 5000);
ok('téléport vers la zone C', !!inC);
ok('(c) référence de groupe inexistante -> silence (null)', A.zone?.music == null);

// ---------- (d) sous-zone musicale (override) référençant un groupe ----------
// on revient en zone A et on pose une sous-zone couvrant le point d'arrivée, dont la
// piste est { group: GROUP_ID } : le serveur doit y résoudre la LISTE du groupe.
A.send({ t: 'admin', cmd: 'zone', zoneId: ZONE_A });
await A.waitFor(() => A.zone?.zoneId === ZONE_A && A.pos.get(A.id), 5000);
const me = A.pos.get(A.id);
ok('position connue en zone A', !!me);
// sous-zone référençant le 2e groupe (distinct du fond de zone A = GROUP), pour que
// la bascule produise un VRAI changement de piste (sinon l'anti-spam supprime le push).
const SUB = { id: 'sub_grp', shape: 'circle', x: me.x, z: me.z, r: 20, track: { group: GROUP2_ID }, priority: 9 };
// l'édition admin réévalue la musique des joueurs présents SANS hystérésis et pousse
// AVANT de répondre au PUT : on remet le journal à zéro juste avant l'appel.
A.musicLog.length = 0; A.musicPushes = 0;
await api(`/api/admin/overrides/${ZONE_A}`, 'PUT', { ...beforeOv0, music: [SUB] });
const gotOv = await api(`/api/admin/overrides/${ZONE_A}`);
ok('PUT/GET : la sous-zone à référence de groupe est restituée',
  eq(gotOv.music?.[0]?.track, { group: GROUP2_ID }));
await A.waitFor(() => A.musicPushes > 0, 3000);
ok('(d) sous-zone à référence de groupe : la LISTE du 2e groupe est poussée',
  eq(lastMusic(A), GROUP2));

// ---------- restauration ----------
await api(`/api/admin/overrides/${ZONE_A}`, 'PUT', beforeOv0);
await api('/api/admin/music', 'PUT', beforeMusic);

A.ws.close();
const bad = checks.filter(([, c]) => !c).length;
console.log(bad ? `\n${bad} ÉCHEC(S)` : '\nTOUT EST OK');
await sleep(100);
process.exit(bad ? 1 : 0);
