// Test d'intégration des cavernes : entrée par un prop `cave`, intérieur
// instancié et PARTAGÉ (deux bots s'y voient), monstres au niveau de la zone
// parente +2, combat, coffre, sortie -> retour au point d'entrée sur Arakas.
// Vérifie aussi les enseignants T4C : Iraltok vend Dard de feu mais PAS
// Guérison légère, Moonrock l'inverse, et Maître Aldric ne vend plus de sorts.
// À lancer sur une base FRAÎCHE (1er compte = admin).
// Usage : node tools/test-caves.js [url ws]
import { PROTOCOL_VERSION, KIND } from '../shared/constants.js';
import WebSocket from 'ws';
import { decodeSnapshot, BIN_SNAPSHOT } from '../shared/protocol.js';
import { generateWorld } from '../shared/worldgen.js';
import { generateCave, CAVES, CAVE_LEVEL_BONUS } from '../shared/cave.js';
import { wakeZone } from './test-helpers.js';

const URL = process.argv[2] || 'ws://localhost:8090';
const checks = [];
const ok = (name, cond) => { checks.push([name, !!cond]); console.log(cond ? '  ✔' : '  ✘', name); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// la carte partagée donne les positions exactes des props et des PNJ
const island = generateWorld(0, 'arakas');
const caveProp = island.props.find(p => p.type === 'cave' && p.caveId === 'crypte_lh');
const caveWorld = generateCave(CAVES.crypte_lh.seed, CAVES.crypte_lh.size, CAVES.crypte_lh.depth);
const chestProp = caveWorld.props.find(p => p.type === 'chest');
const exitProp = caveWorld.props.find(p => p.type === 'exitgate');
const npcSpot = (npcId) => island.npcSpots.find(s => s.npcId === npcId);

// petite session WebSocket : état + helpers (même style que test-banque)
function session(name) {
  const S = {
    id: null, self: null, zone: null, shop: null, name,
    metas: new Map(), pos: new Map(), infos: [], loots: [], myHits: 0,
  };
  const ws = new WebSocket(URL);
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
      case 'zone': S.zone = m; S.pos.clear(); S.metas.clear(); break;
      case 'meta': for (const e of m.list) S.metas.set(e.id, e); break;
      case 'shop': S.shop = m; break;
      case 'info': S.infos.push(m.text); break;
      case 'loot': S.loots.push(m.text); break;
      case 'events':
        for (const ev of m.list) if (ev.t === 'dmg' && ev.from === S.id && !ev.miss) S.myHits++;
        break;
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
    }, 50);
  });
  S.open = new Promise(r => ws.on('open', r));
  return S;
}

// téléportation admin près d'un point (essaie quelques cases praticables)
async function gotoNear(S, x, z) {
  for (const [dx, dz] of [[0, 0], [0, 1], [1, 0], [-1, 0], [0, -1], [1, 1], [-2, 1], [2, -1], [0, 3]]) {
    S.send({ t: 'admin', cmd: 'goto', x: x + dx, z: z + dz });
    await sleep(250);
    const p = S.pos.get(S.id);
    if (p && Math.hypot(p.x - x, p.z - z) < 4) return true;
  }
  return false;
}

// ---------- bot A (admin) : entre dans la crypte de Lighthaven ----------
const A = session('Mineur_' + Math.floor(Math.random() * 1e6)); // 16 caractères max
await A.open;
A.send({ t: 'register', v: PROTOCOL_VERSION, name: A.name, pass: 'test1234' });
await A.waitFor(() => A.self && A.zone && A.pos.get(A.id));
ok('connexion zone 0', A.zone?.zoneId === 0 && A.zone?.kind === 'island');
ok('prop de la crypte trouvé sur la carte', !!caveProp && !!chestProp && !!exitProp);

A.send({ t: 'admin', cmd: 'set', level: 25 }); // survivre sans peine à la vermine
await sleep(300);
await gotoNear(A, caveProp.x, caveProp.z + 1);
A.send({ t: 'interact', prop: 'cave', x: caveProp.x, z: caveProp.z });
await A.waitFor(() => A.zone?.kind === 'cave', 12000);
ok('entrée : zone caverne reçue', A.zone?.kind === 'cave');
ok('bannière au nom de la carte (Crypte de Lighthaven)', A.zone?.name === 'Crypte de Lighthaven');
ok('paramètres partagés client/serveur (seed/size/depth)',
  A.zone?.cave?.seed === CAVES.crypte_lh.seed && A.zone?.cave?.size === CAVES.crypte_lh.size);
const aPos = A.pos.get(A.id);
ok('apparu près de la sortie de la caverne',
  aPos && Math.hypot(aPos.x - exitProp.x, aPos.z - exitProp.z) < 3);

// --- monstres : ils apparaissent au MOUVEMENT (spawn T4C), au niveau de la
// zone parente +2 — la caverne démarre vide, on la réveille en bougeant ---
await wakeZone({ send: A.send, pos: A.pos, metas: A.metas, get id() { return A.id; } },
  { count: 3, timeout: 10000 });
const mobs = await A.waitFor(() => {
  const list = [...A.metas.values()].filter(m => m.kind === KIND.MOB);
  return list.length >= 3 ? list : null;
}, 6000);
ok('monstres apparus dans la caverne (réveillée en bougeant)', !!mobs);
ok(`vermine au niveau zone parente +${CAVE_LEVEL_BONUS} (Fourmilion niv 3)`,
  mobs && mobs.every(m => m.level === 1 + CAVE_LEVEL_BONUS));

// ---------- bot B (non admin) : rejoint la MÊME instance à pied ----------
const B = session('Suiveur_' + Math.floor(Math.random() * 1e6));
await B.open;
B.send({ t: 'register', v: PROTOCOL_VERSION, name: B.name, pass: 'test1234' });
await B.waitFor(() => B.self && B.zone && B.pos.get(B.id));
B.send({ t: 'interact', prop: 'cave', x: caveProp.x, z: caveProp.z }); // marche automatique
await B.waitFor(() => B.zone?.kind === 'cave', 20000);
ok('second joueur entré dans la caverne (à pied, sans admin)', B.zone?.kind === 'cave');
const bSeenByA = await A.waitFor(() =>
  [...A.metas.values()].find(m => m.kind === KIND.PLAYER && m.name === B.name), 5000);
const aSeenByB = await B.waitFor(() =>
  [...B.metas.values()].find(m => m.kind === KIND.PLAYER && m.name === A.name), 5000);
ok('instance PARTAGÉE : les deux joueurs se voient', !!bSeenByA && !!aSeenByB);
B.ws.close();

// --- combat : approcher le monstre le plus proche et le tuer ---
const target = await A.waitFor(() => {
  let best = null, bestD = Infinity;
  const me = A.pos.get(A.id);
  if (!me) return null;
  for (const [id, e] of A.pos) {
    if (A.metas.get(id)?.kind !== KIND.MOB || e.state === 3) continue;
    const d = Math.hypot(e.x - me.x, e.z - me.z);
    if (d < bestD) { bestD = d; best = { id, e }; }
  }
  return best;
}, 5000);
ok('monstre ciblé', !!target);
if (target) {
  A.send({ t: 'attack', id: target.id }); // le serveur s'approche et frappe
  await A.waitFor(() => A.myHits > 0, 12000);
}
ok('coup porté à un monstre de la caverne', A.myHits > 0);

// --- coffre : s'y téléporter, l'ouvrir ---
await gotoNear(A, chestProp.x, chestProp.z);
A.send({ t: 'interact', prop: 'chest', x: chestProp.x, z: chestProp.z });
const opened = await A.waitFor(() => A.loots.some(t => t.startsWith('Vous ouvrez le coffre')), 10000);
ok('coffre de la caverne ouvert', !!opened);

// --- sortie : retour sur Arakas, au point d'entrée de la grotte ---
await gotoNear(A, exitProp.x, exitProp.z);
A.send({ t: 'interact', prop: 'exitgate', x: exitProp.x, z: exitProp.z });
await A.waitFor(() => A.zone?.kind === 'island', 10000);
const backPos = A.pos.get(A.id) || { x: A.zone?.x, z: A.zone?.z };
ok('sortie : retour sur Arakas', A.zone?.kind === 'island' && A.zone?.zoneId === 0);
ok('réapparu devant l\'entrée de la grotte',
  backPos && Math.hypot(backPos.x - caveProp.x, backPos.z - caveProp.z) < 4);

// ---------- enseignants : chacun ne vend QUE ses sorts ----------
async function shopOfNpc(npcId, displayName) {
  const spot = npcSpot(npcId);
  await gotoNear(A, spot.x, spot.z);
  const npc = await A.waitFor(() =>
    [...A.metas.values()].find(m => m.kind === KIND.NPC && m.name === displayName), 5000);
  if (!npc) return null;
  A.shop = null;
  A.send({ t: 'interact', id: npc.id });
  return await A.waitFor(() => A.shop, 10000);
}
const iraltok = await shopOfNpc('iraltok', 'Iraltok');
ok('Iraltok vend Dard de feu mais PAS Guérison légère',
  iraltok && iraltok.spells.some(s => s.id === 'dard_de_feu')
  && !iraltok.spells.some(s => s.id === 'guerison_legere'));
ok('un enseignant ne vend ni objets ni compétences',
  iraltok && iraltok.items.length === 0 && iraltok.skills.length === 0);
const moonrock = await shopOfNpc('moonrock', 'Moonrock');
ok('Moonrock vend Guérison légère mais PAS Dard de feu',
  moonrock && moonrock.spells.some(s => s.id === 'guerison_legere')
  && !moonrock.spells.some(s => s.id === 'dard_de_feu'));
const aldric = await shopOfNpc('merchant', 'Maître Aldric');
ok('Maître Aldric garde objets et compétences, mais plus aucun sort',
  aldric && aldric.items.length > 5 && aldric.skills.length >= 2 && aldric.spells.length === 0);

const failed = checks.filter(([, c]) => !c);
console.log(failed.length === 0 ? '\nTOUT EST OK' : `\n${failed.length} ÉCHEC(S): ${failed.map(([n]) => n).join(', ')}`);
process.exit(failed.length === 0 ? 0 : 1);
