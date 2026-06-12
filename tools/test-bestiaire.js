// Bestiaire — suite de validation :
//   A. statique : chaque monstre de MOBS a un sprite résolu dans le manifest
//      (animations stance/run/swing/die + PNG présent), des stats complètes
//      et bornées, des drops valides (ids d'ITEMS existants), un niveau
//      compatible avec sa zone ; les répartitions (camps d'Arakas, camps
//      procéduraux, grottes, compositions de zones.json) ne référencent que
//      des monstres existants.
//   B. intégration : un override de camps fait APPARAÎTRE de nouvelles
//      créatures (loup, brigand, tarentule) près de Lighthaven, et l'une
//      d'elles meurt au combat (XP à la clé).
// À lancer sur une base FRAÎCHE (1er compte = admin) avec T4C_SPAWN_MS ~250.
// Usage : node tools/test-bestiaire.js [url]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { PROTOCOL_VERSION, KIND, ST, mobXpReward } from '../shared/constants.js';
import { decodeSnapshot, BIN_SNAPSHOT } from '../shared/protocol.js';
import { MOBS, ITEMS } from '../shared/defs.js';
import { SPAWN_ZONES, generateWorld } from '../shared/worldgen.js';
import { CAVES } from '../shared/cave.js';
import { sleep, wakeZone, standoffNear, visibleMobs } from './test-helpers.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.argv[2] || 'http://localhost:8090';
const WS_URL = BASE.replace('http', 'ws');
const checks = [];
const ok = (name, cond) => { checks.push([name, !!cond]); console.log(cond ? '  ✔' : '  ✘', name); };

// ====================== A. validation statique ======================
console.log('— A. bestiaire statique —');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'client', 'assets', 'manifest.json'), 'utf8'));
const zones = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'zones.json'), 'utf8')).zones;
const ELEMENTS = ['feu', 'eau', 'terre', 'air', 'lumiere', 'arcane'];
const NEEDED_ANIMS = ['stance', 'run', 'swing', 'die'];

// 1. sprites résolus : manifest + animations indispensables + PNG sur disque
{
  const bad = [];
  for (const [id, d] of Object.entries(MOBS)) {
    const e = manifest.enemies[d.sprite];
    if (!e) { bad.push(`${id}: sprite « ${d.sprite} » absent du manifest`); continue; }
    for (const a of NEEDED_ANIMS) if (!e.anims[a]) bad.push(`${id}: ${d.sprite} sans anim « ${a} »`);
    if (!fs.existsSync(path.join(ROOT, 'client', 'assets', e.image))) bad.push(`${id}: image ${e.image} absente`);
  }
  ok(`sprites résolus pour les ${Object.keys(MOBS).length} monstres`, bad.length === 0);
  for (const b of bad) console.log('     ✘', b);
}

// 2. stats complètes et bornées
{
  const bad = [];
  for (const [id, d] of Object.entries(MOBS)) {
    const e = (cond, why) => { if (!cond) bad.push(`${id}: ${why}`); };
    e(typeof d.name === 'string' && d.name.length > 1, 'nom manquant');
    e(Number.isInteger(d.level) && d.level >= 1 && d.level <= 25, `niveau hors bornes (${d.level})`);
    e(Number.isInteger(d.hp) && d.hp >= 5 && d.hp <= 1000, `PV hors bornes (${d.hp})`);
    e(Number.isInteger(d.dmg) && d.dmg >= 1 && d.dmg <= 40, `dégâts hors bornes (${d.dmg})`);
    e(Number.isInteger(d.def) && d.def >= 0 && d.def <= 40, `CA hors bornes (${d.def})`);
    e(d.speed >= 1 && d.speed <= 7, `vitesse hors bornes (${d.speed})`);
    e(d.aggro >= 1 && d.aggro <= 20, `aggro hors bornes (${d.aggro})`);
    e(d.leash >= d.aggro, 'leash < aggro');
    e(d.atkRange >= 1 && d.atkRange <= 3, `portée hors bornes (${d.atkRange})`);
    e(d.atkSpeed >= 0.5 && d.atkSpeed <= 3, `cadence hors bornes (${d.atkSpeed})`);
    e(d.resist && typeof d.resist === 'object', 'résistances manquantes');
    for (const [el, v] of Object.entries(d.resist || {})) {
      e(ELEMENTS.includes(el), `élément inconnu « ${el} »`);
      e(v >= -1 && v <= 1, `résistance ${el} hors bornes (${v})`);
    }
    if (d.element) e(ELEMENTS.includes(d.element), `élément d'attaque inconnu « ${d.element} »`);
    if (d.tint) e(/^#[0-9a-f]{6}$/i.test(d.tint), `tint invalide (${d.tint})`);
    if (d.spriteScale) e(d.spriteScale >= 0.3 && d.spriteScale <= 4, `spriteScale hors bornes (${d.spriteScale})`);
    e(mobXpReward(d.level, d.level) > 0, 'XP nulle');
  }
  ok('stats complètes et bornées (PV, dégâts, CA, vitesse, résistances, tint...)', bad.length === 0);
  for (const b of bad) console.log('     ✘', b);
}

// 3. drops valides : ids existants, probabilités et quantités saines
{
  const bad = [];
  for (const [id, d] of Object.entries(MOBS)) {
    if (!Array.isArray(d.drops) || !d.drops.length) { bad.push(`${id}: aucun drop`); continue; }
    for (const drop of d.drops) {
      const [item, chance, min, max] = drop;
      if (!ITEMS[item]) bad.push(`${id}: drop inconnu « ${item} »`);
      if (!(chance > 0 && chance <= 1)) bad.push(`${id}: proba invalide ${item} (${chance})`);
      if (!(Number.isInteger(min) && Number.isInteger(max) && min >= 1 && max >= min)) {
        bad.push(`${id}: quantités invalides ${item} (${min}-${max})`);
      }
    }
    if (!d.drops.some(([item]) => item === 'or')) bad.push(`${id}: pas de drop d'or`);
  }
  ok('drops valides (ids ITEMS existants, probas/quantités saines, or présent)', bad.length === 0);
  for (const b of bad) console.log('     ✘', b);
}

// 4. répartitions : seules des créatures existantes, niveaux compatibles
{
  const bad = [];
  const arakas = generateWorld(0, 'arakas');
  for (const s of arakas.spawnZones) {
    if (!MOBS[s.mob]) bad.push(`camp d'Arakas (${s.center}) : monstre inconnu « ${s.mob} »`);
  }
  for (const s of SPAWN_ZONES) {
    if (!MOBS[s.mob]) bad.push(`camp procédural (${s.center}) : monstre inconnu « ${s.mob} »`);
  }
  for (const [caveId, def] of Object.entries(CAVES)) {
    for (const m of def.mobs) if (!MOBS[m]) bad.push(`grotte ${caveId} : monstre inconnu « ${m} »`);
  }
  for (const z of zones) {
    for (const m of z.mobs) if (!MOBS[m]) bad.push(`zone ${z.id} : monstre inconnu « ${m} »`);
  }
  // la zone 0 (Arakas, niveaux 1-25) : tous les niveaux de base y tiennent
  const span = zones[0].levels;
  for (const s of arakas.spawnZones) {
    const lv = MOBS[s.mob]?.level ?? 0;
    if (lv < span[0] || lv > span[1]) bad.push(`Arakas : ${s.mob} niveau ${lv} hors [${span}]`);
  }
  ok('répartitions cohérentes (Arakas, zones 1+, grottes, zones.json)', bad.length === 0);
  for (const b of bad) console.log('     ✘', b);
  ok('le troll rôde sur l\'île d\'Orkanis', arakas.spawnZones.some(s =>
    s.mob === 'troll' && Math.hypot(s.center[0] - 38, s.center[1] - 84) < 10));
  ok('kraanians dans la caverne kraanienne, brigands chez les Brigands, araignées en cave C',
    CAVES.kraanian.mobs.includes('kraanian')
    && CAVES.brigands.mobs.includes('brigand')
    && CAVES.cave_c.mobs.some(m => ['araignee_geante', 'tarentule'].includes(m)));
}

// 5. les monstres historiques n'ont pas bougé (contrat des autres suites)
ok('ids historiques intacts (rat, serpent, gobelin, squelette, zombie, orc, ogre)',
  MOBS.rat?.name === 'Fourmilion' && MOBS.serpent?.name === 'Fourmi de feu'
  && MOBS.orc?.name === 'Hobgobelin' && MOBS.ogre?.name === 'Minotaure'
  && !!MOBS.gobelin && !!MOBS.squelette && !!MOBS.zombie);

// ====================== B. intégration : spawn réel + combat ======================
console.log('— B. spawn réel par camps override + combat —');

function session(name) {
  const S = { name, id: null, self: null, zone: null, pos: new Map(), metas: new Map(), xp: 0 };
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
      case 'zone': S.zone = m; S.pos.clear(); S.metas.clear(); break;
      case 'meta': for (const e of m.list) S.metas.set(e.id, e); break;
      case 'xp': S.xp += m.gain ?? 0; break; // gains cumulés observés
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

const A = session('Bestio_' + Math.floor(Math.random() * 1e6));
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
const before = await api('/api/admin/overrides/0'); // restauration finale

// trois NOUVELLES créatures dans les champs au sud de Lighthaven
const NEW_IDS = ['loup', 'brigand', 'tarentule'];
const CAMPS = [
  { id: 'best_loup', x: 343.5, z: 275.5, r: 5, mobs: { loup: 3 } },
  { id: 'best_brigand', x: 336.5, z: 270.5, r: 5, mobs: { brigand: 3 } },
  { id: 'best_tarentule', x: 350.5, z: 268.5, r: 5, mobs: { tarentule: 3 } },
];
try {
  await api('/api/admin/overrides/0', 'PUT', { ...before, camps: CAMPS });
  await standoffNear(A, 343.5, 272.5, 27);
  await wakeZone(A, { count: 5, timeout: 20000 });
  for (const defId of NEW_IDS) {
    if (!visibleMobs(A, defId).length) await wakeZone(A, { defId, count: 1, timeout: 10000 });
    const seen = visibleMobs(A, defId);
    ok(`spawn réel : ${defId} apparaît via camp override`, seen.length >= 1);
    if (seen.length) {
      const meta = seen[0].meta;
      ok(`  méta fidèle : « ${MOBS[defId].name} » niveau ${MOBS[defId].level}`,
        meta.name === MOBS[defId].name && (meta.level ?? seen[0].e.level ?? MOBS[defId].level) === MOBS[defId].level);
    }
  }

  // combat : on abat la créature la plus proche parmi les nouvelles
  A.send({ t: 'admin', cmd: 'set', level: 30 });
  await A.waitFor(() => A.self?.level === 30);
  const all = NEW_IDS.flatMap(d => visibleMobs(A, d));
  ok('au moins une nouvelle créature à portée pour le combat', all.length >= 1);
  if (all.length) {
    const me = A.pos.get(A.id);
    all.sort((a, b) => Math.hypot(a.e.x - me.x, a.e.z - me.z) - Math.hypot(b.e.x - me.x, b.e.z - me.z));
    const prey = all[0];
    A.send({ t: 'admin', cmd: 'goto', x: prey.e.x + 1.2, z: prey.e.z });
    await sleep(300);
    const xp0 = A.xp;
    A.send({ t: 'attack', id: prey.id });
    const dead = await A.waitFor(() => (A.pos.get(prey.id)?.state ?? ST.DEAD) === ST.DEAD, 15000);
    ok(`combat : ${prey.meta.defId} vaincu`, dead !== null);
    await sleep(1200); // flush d'XP groupé
    ok('combat : XP créditée', A.xp > xp0);
  }
} finally {
  await api('/api/admin/overrides/0', 'PUT', before); // remet les camps par défaut
}

const failed = checks.filter(([, c]) => !c);
console.log(failed.length === 0 ? '\nTOUT EST OK' : `\n${failed.length} ÉCHEC(S)`);
process.exit(failed.length === 0 ? 0 : 1);
