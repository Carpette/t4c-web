// Camps de spawn éditables (overrides `camps`) — test d'intégration :
// 1. PUT d'un camp override (composition multi-monstres) → le spawn par
//    mouvement produit EXACTEMENT ces monstres, dans le rayon du camp ;
// 2. les quotas par monstre sont respectés (jamais plus que la composition) ;
// 3. suppression du camp (camps: []) → les monstres au repos s'effacent et
//    plus AUCUN spawn n'a lieu, à chaud, sans redémarrage.
// À lancer sur une base FRAÎCHE (1er compte = admin) avec T4C_SPAWN_MS ~250.
// Usage : node tools/test-camps.js [url]
import WebSocket from 'ws';
import { PROTOCOL_VERSION, KIND } from '../shared/constants.js';
import { decodeSnapshot, BIN_SNAPSHOT } from '../shared/protocol.js';
import { sleep, visibleMobs, wakeZone, standoffNear } from './test-helpers.js';

const BASE = process.argv[2] || 'http://localhost:8090';
const WS_URL = BASE.replace('http', 'ws');
const checks = [];
const ok = (name, cond) => { checks.push([name, !!cond]); console.log(cond ? '  ✔' : '  ✘', name); };

// Camp de test : au cœur des champs au sud de Lighthaven (zone très praticable,
// même emplacement que le camp de Fourmilions par défaut — mais l'override
// REMPLACE tous les camps : seuls gobelins et zombies doivent apparaître).
const CAMP = { id: 'camp_test', x: 343.5, z: 275.5, r: 5, mobs: { gobelin: 3, zombie: 2 } };
const CAMP_DEFIDS = Object.keys(CAMP.mobs);

// ---------- session WebSocket minimale (positions + métas + premières vues) ----------
function session(name) {
  const S = {
    name, id: null, self: null, zone: null,
    pos: new Map(), metas: new Map(),
    seenMobs: new Map(), // id -> position à la PREMIÈRE apparition
  };
  const ws = new WebSocket(WS_URL);
  ws.on('message', (raw, bin) => {
    if (bin) {
      const ab = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
      if (new DataView(ab).getUint8(0) !== BIN_SNAPSHOT) return;
      const snap = decodeSnapshot(ab);
      for (const e of snap.entities) {
        S.pos.set(e.id, e);
        if (e.kind === KIND.MOB && !S.seenMobs.has(e.id)) S.seenMobs.set(e.id, { x: e.x, z: e.z });
      }
      for (const id of snap.gone) S.pos.delete(id);
      return;
    }
    const m = JSON.parse(raw.toString());
    switch (m.t) {
      case 'create_char': S.send({ t: 'create', stats: { str: 22, end: 18, agi: 14, int: 8, wis: 8 } }); break;
      case 'welcome': S.id = m.id; break;
      case 'self': S.self = m; break;
      case 'zone': S.zone = m; S.pos.clear(); S.metas.clear(); break;
      case 'meta': for (const e of m.list) S.metas.set(e.id, e); break;
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

// ---------- bot admin (1er compte de la base fraîche) ----------
const A = session('Campeur_' + Math.floor(Math.random() * 1e6));
await A.open;
A.send({ t: 'register', v: PROTOCOL_VERSION, name: A.name, pass: 'test1234' });
await A.waitFor(() => A.self && A.zone && A.pos.get(A.id));
ok('connexion zone 0 (Arakas)', A.zone?.zoneId === 0);

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

const before = await api('/api/admin/overrides/0'); // pour restauration finale

// ---------- 1. camp override : seuls SES monstres apparaissent, dans le rayon ----------
await api('/api/admin/overrides/0', 'PUT', { ...before, camps: [CAMP] });
const got = await api('/api/admin/overrides/0');
ok('PUT/GET : la section camps est restituée', JSON.stringify(got.camps) === JSON.stringify([CAMP]));

await standoffNear(A, CAMP.x, CAMP.z, 27);
await wakeZone(A, { count: 3, timeout: 15000 });
await sleep(400);
let mobs = visibleMobs(A);
ok(`des monstres apparaissent au camp édité (${mobs.length} vus)`, mobs.length >= 3);
ok('composition respectée : uniquement gobelins et zombies',
  mobs.length > 0 && mobs.every(m => CAMP_DEFIDS.includes(m.meta.defId)));
const dists = mobs.map(m => {
  const first = A.seenMobs.get(m.id) || m.e;
  return Math.hypot(first.x - CAMP.x, first.z - CAMP.z);
});
ok(`tous apparus dans le rayon du camp (max ${Math.max(...dists).toFixed(1)} ≤ ${CAMP.r + 2})`,
  dists.every(d => d <= CAMP.r + 2)); // marge : un monstre peut errer d'ici le snapshot

// ---------- 2. quotas par monstre : jamais plus que la composition ----------
await wakeZone(A, { count: 5, timeout: 15000 });
await sleep(400);
mobs = visibleMobs(A);
const byDef = {};
for (const m of mobs) byDef[m.meta.defId] = (byDef[m.meta.defId] || 0) + 1;
ok(`population plafonnée à la capacité du camp (${mobs.length} ≤ 5)`, mobs.length <= 5);
ok(`quotas par monstre respectés (gobelins ${byDef.gobelin || 0} ≤ 3, zombies ${byDef.zombie || 0} ≤ 2)`,
  (byDef.gobelin || 0) <= 3 && (byDef.zombie || 0) <= 2
  && Object.keys(byDef).every(d => CAMP_DEFIDS.includes(d)));

// ---------- 3. suppression à chaud : les monstres s'effacent, plus de spawn ----------
await api('/api/admin/overrides/0', 'PUT', { ...before, camps: [] });
await sleep(800); // le respawn des entités et quelques snapshots
ok('camp supprimé : les monstres au repos ont disparu', visibleMobs(A).length === 0);
const seenBefore = A.seenMobs.size;
await wakeZone(A, { count: 99, timeout: 3500 }); // on marche : rien ne doit venir
ok('camp supprimé : plus aucun spawn malgré le mouvement', A.seenMobs.size === seenBefore);

// ---------- restauration ----------
await api('/api/admin/overrides/0', 'PUT', before);
const restored = await api('/api/admin/overrides/0');
ok('restauration des overrides initiaux', JSON.stringify(restored) === JSON.stringify(before));

A.ws.close();
const failed = checks.filter(([, c]) => !c);
console.log(failed.length === 0 ? '\nTOUT EST OK' : `\n${failed.length} ÉCHEC(S): ${failed.map(([n]) => n).join(', ')}`);
process.exit(failed.length === 0 ? 0 : 1);
