// Test d'intégration : spawn déclenché par le MOUVEMENT, XP versée PAR COUP
// (au prorata des dégâts), et système de GROUPE (invitation, partage d'XP).
//
// À lancer sur une base FRAÎCHE (1er compte = admin), avec un serveur démarré
// avec T4C_SPAWN_MS bas (~250 ms) pour des spawns rapides.
// Usage : node tools/test-spawn-xp.js [url] [SPAWN|XP|GROUPE|TOUT]
//   SPAWN  = (a) zone froide sans spawn (b) spawns progressifs hors champ
//            (c) immobile -> plus aucun spawn
//   XP     = (d) XP par coup = xpTotale x dégâts / PVmax (e) overkill borné
//   GROUPE = (f) invitation/refus/accept, partage avec bonus, hors portée, quitter
import WebSocket from 'ws';
import {
  PROTOCOL_VERSION, KIND, ST, mobXpReward, xpForLevel, scaleMob,
  SPAWN_MIN_PLAYER_DIST, GROUP_XP_BONUS_PER_MEMBER,
} from '../shared/constants.js';
import { decodeSnapshot, BIN_SNAPSHOT } from '../shared/protocol.js';
import { MOBS } from '../shared/defs.js';
import { sleep, wakeZone, nearestVisibleMob, standoffNear } from './test-helpers.js';

const URL = process.argv[2] || 'ws://localhost:8090';
const PART = (process.argv[3] || 'TOUT').toUpperCase();
const has = (p) => PART === 'TOUT' || PART.includes(p);
const checks = [];
const ok = (name, cond) => { checks.push([name, !!cond]); console.log(cond ? '  ✔' : '  ✘', name); };

// camps de la carte Arakas (shared/island1.js) utilisés par le scénario
const CAMP_SERPENT = { x: 357.5, z: 237.5 }; // Fourmis de feu, côte NE de LH
const CAMP_ORC = { x: 280.5, z: 127.5 };     // Hobgobelins (Roshnak Tul), loin de LH

// ---------- session WebSocket : état + suivi des spawns/XP/dégâts ----------
function session(name) {
  const S = {
    name, id: null, self: null, zone: null,
    pos: new Map(), metas: new Map(),
    seenMobs: new Map(),  // id -> { at, dist (à ma position), x, z } à la 1re vue
    xpEvents: [],         // { gain, xp, at }
    dmgEvents: [],        // { from, to, amount, at }
    infos: [], party: null, invite: null,
  };
  const ws = new WebSocket(URL);
  ws.on('message', (raw, bin) => {
    if (bin) {
      const ab = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
      if (new DataView(ab).getUint8(0) !== BIN_SNAPSHOT) return;
      const snap = decodeSnapshot(ab);
      for (const e of snap.entities) S.pos.set(e.id, e);
      for (const id of snap.gone) S.pos.delete(id);
      // chaque monstre est noté à sa PREMIÈRE apparition : distance au joueur
      const me = S.id != null ? S.pos.get(S.id) : null;
      for (const e of snap.entities) {
        if (e.kind === KIND.MOB && !S.seenMobs.has(e.id)) {
          S.seenMobs.set(e.id, {
            at: Date.now(), x: e.x, z: e.z,
            dist: me ? Math.hypot(e.x - me.x, e.z - me.z) : null,
          });
        }
      }
      return;
    }
    const m = JSON.parse(raw.toString());
    switch (m.t) {
      case 'create_char': S.send({ t: 'create', stats: { str: 22, end: 18, agi: 14, int: 8, wis: 8 } }); break;
      case 'welcome': S.id = m.id; break;
      case 'self': S.self = m; break;
      case 'zone': S.zone = m; S.pos.clear(); S.metas.clear(); break;
      case 'meta': for (const e of m.list) S.metas.set(e.id, e); break;
      case 'xp': S.xpEvents.push({ gain: m.gain, xp: m.xp, at: Date.now() }); break;
      case 'info': S.infos.push(m.text); break;
      case 'party_update': S.party = m; break;
      case 'party_invite': S.invite = m; break;
      case 'events':
        for (const ev of m.list) {
          if (ev.t === 'dmg' && !ev.miss && !ev.parry) {
            S.dmgEvents.push({ from: ev.from, to: ev.to, amount: ev.amount, at: Date.now() });
          }
        }
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
    }, 40);
  });
  S.open = new Promise(r => ws.on('open', r));
  return S;
}

// somme des gains d'XP reçus depuis l'index `from`
const xpGainedSince = (S, from) => S.xpEvents.slice(from).reduce((s, e) => s + e.gain, 0);

// un coup porté à `mobId`, puis on cesse aussitôt d'attaquer ; retourne les
// dégâts du coup (le serveur a déjà versé l'XP correspondante)
async function singleHit(S, mobId) {
  const from = S.dmgEvents.length;
  S.send({ t: 'attack', id: mobId });
  const hit = await S.waitFor(() =>
    S.dmgEvents.slice(from).find(d => d.from === S.id && d.to === mobId), 8000);
  const me = S.pos.get(S.id);
  if (me) S.send({ t: 'move', x: me.x, z: me.z }); // stoppe l'attaque sans bouger
  return hit;
}

// ---------- connexion du bot principal (admin : 1er compte) ----------
const A = session('Spawn_' + Math.floor(Math.random() * 1e6));
await A.open;
A.send({ t: 'register', v: PROTOCOL_VERSION, name: A.name, pass: 'test1234' });
await A.waitFor(() => A.self && A.zone && A.pos.get(A.id));
ok('connexion zone 0 (Arakas)', A.zone?.zoneId === 0);

if (has('SPAWN')) {
  // --- (a) zone fraîche, bot IMMOBILE : aucun monstre n'apparaît ---
  await sleep(2200);
  ok('(a) zone fraîche + joueur immobile : aucun spawn', A.seenMobs.size === 0);

  // --- (b) le bot MARCHE : spawns progressifs, tous hors champ ---
  const t0 = Date.now();
  await wakeZone(A, { count: 3, timeout: 6000 });
  await sleep(400); // dernier snapshot
  const elapsed = Date.now() - t0;
  const spawned = [...A.seenMobs.values()];
  ok(`(b) le mouvement déclenche des spawns (${spawned.length} monstres vus)`, spawned.length >= 3);
  // progressif : jamais plus d'un spawn par intervalle (T4C_SPAWN_MS=250 en test)
  ok('(b) spawns progressifs, jamais massifs',
    spawned.length <= Math.ceil(elapsed / 250) + 2);
  const minSeen = Math.min(...spawned.map(s => s.dist ?? Infinity));
  ok(`(b) tous apparus à >= ${SPAWN_MIN_PLAYER_DIST} tuiles du joueur (min vu : ${minSeen.toFixed(1)})`,
    minSeen >= SPAWN_MIN_PLAYER_DIST - 3); // marge : le joueur bouge entre spawn et snapshot

  // --- (c) le bot s'arrête : la « chaleur » retombe, plus aucun spawn ---
  // (même nettoyée, une zone où personne ne bouge reste nettoyée)
  await sleep(4600); // > SPAWN_HEAT_DURATION : la zone refroidit
  const frozen = A.seenMobs.size;
  await sleep(2500);
  ok('(c) immobile : plus aucun spawn une fois la zone refroidie',
    A.seenMobs.size === frozen);
}

if (has('XP')) {
  // --- (d) XP par coup : un coup retirant X PV rapporte xpTotale*X/PVmax ---
  // stats/niveau contrôlés : End 150 (survivre aux morsures pendant la mesure,
  // sans toucher à la Force : les coups restent partiels), niveau 7
  A.send({ t: 'admin', cmd: 'stats', end: 150 });
  await sleep(250);
  A.send({ t: 'admin', cmd: 'set', level: 7 });
  await A.waitFor(() => A.self?.level === 7);
  // une Fourmi de feu (hp 22 en zone 0) : 2-3 coups à mains nues -> mesures partielles
  let prey = nearestVisibleMob(A, 'serpent');
  if (!prey) {
    // pas de fourmi en vue : on se poste près de leur camp et on les réveille
    await standoffNear(A, CAMP_SERPENT.x, CAMP_SERPENT.z, 28);
    await wakeZone(A, { defId: 'serpent', count: 1, timeout: 12000 });
    prey = nearestVisibleMob(A, 'serpent');
  }
  ok('(d) Fourmi de feu disponible', !!prey);
  const mobMaxHp = scaleMob(MOBS.serpent, 0).hp;
  const mobLevel = A.metas.get(prey.id)?.level ?? MOBS.serpent.level;
  const xpTotal = mobXpReward(mobLevel, A.self.level);
  // se placer au contact (téléport admin à côté, pas dessus)
  A.send({ t: 'admin', cmd: 'goto', x: prey.e.x + 1.2, z: prey.e.z });
  await sleep(300);
  ok('(d) cible à pleine vie', (A.pos.get(prey.id)?.hpPct ?? 0) === 100);

  const xpFrom = A.xpEvents.length;
  const hit1 = await singleHit(A, prey.id);
  ok('(d) premier coup porté', !!hit1);
  await sleep(1200); // le flush d'XP regroupé arrive (toutes les ~0,5 s)
  const gained1 = xpGainedSince(A, xpFrom);
  const expected1 = xpTotal * Math.min(hit1?.amount ?? 0, mobMaxHp) / mobMaxHp;
  ok(`(d) XP du coup = xpTotale x dégâts / PVmax (${gained1} ~ ${expected1.toFixed(1)})`,
    hit1 && Math.abs(gained1 - expected1) <= 1.5);

  // --- (e) on achève le monstre : XP totale = xpTotale, l'overkill ne paie pas
  // et il n'y a AUCUNE XP supplémentaire à la mort ---
  const dmgFrom = A.dmgEvents.length;
  A.send({ t: 'attack', id: prey.id });
  await A.waitFor(() => (A.pos.get(prey.id)?.state ?? ST.DEAD) === ST.DEAD, 12000);
  await sleep(1200); // dernier flush d'XP
  const rawSum = (hit1?.amount ?? 0) + A.dmgEvents.slice(dmgFrom)
    .filter(d => d.from === A.id && d.to === prey.id)
    .reduce((s, d) => s + d.amount, 0);
  const totalGained = xpGainedSince(A, xpFrom);
  ok(`(e) dégâts bruts > PVmax (${rawSum} > ${mobMaxHp}) : il y a bien overkill`, rawSum > mobMaxHp);
  ok(`(e) XP totale bornée aux PV du monstre (${totalGained} ~ ${xpTotal}, pas d'XP de mort en plus)`,
    Math.abs(totalGained - xpTotal) <= 2);
}

if (has('GROUPE')) {
  // --- (f) groupe : invitation/refus, partage à portée, hors portée, quitter ---
  const B = session('Groupie_' + Math.floor(Math.random() * 1e6));
  await B.open;
  B.send({ t: 'register', v: PROTOCOL_VERSION, name: B.name, pass: 'test1234' });
  await B.waitFor(() => B.self && B.zone && B.pos.get(B.id));

  // invitation par la commande de chat, refusée par B
  A.send({ t: 'chat', text: `/inviter ${B.name}` });
  await B.waitFor(() => B.invite, 5000);
  ok('(f) /inviter Nom : invitation reçue', B.invite?.from === A.name);
  const infosFrom = A.infos.length;
  B.send({ t: 'party_decline' });
  await A.waitFor(() => A.infos.slice(infosFrom).some(t => t.includes('décline')), 5000);
  ok('(f) refus notifié à l\'invitant', A.infos.some(t => t.includes('décline')));
  ok('(f) pas de groupe après refus', !B.party?.members?.length);

  // seconde invitation, acceptée : groupe de 2, A chef
  B.invite = null;
  A.send({ t: 'party_invite', name: B.name });
  await B.waitFor(() => B.invite, 5000);
  B.send({ t: 'party_accept' });
  await A.waitFor(() => A.party?.members?.length === 2, 5000);
  await B.waitFor(() => B.party?.members?.length === 2, 5000);
  ok('(f) groupe formé (2 membres, A chef)',
    A.party?.members?.length === 2 && A.party?.leaderId === A.id
    && B.party?.members?.length === 2);

  // -- partage À PORTÉE : B marche vers le camp des Fourmis de feu (en restant
  // hors d'aggro : niveau 1), A frappe UNE fois -> chacun touche sa part --
  // A : End 150 / niveau 8 (survie au cœur du camp pendant la mesure)
  A.send({ t: 'admin', cmd: 'stats', end: 150 });
  await sleep(250);
  A.send({ t: 'admin', cmd: 'set', level: 8 });
  await A.waitFor(() => A.self?.level === 8);
  await standoffNear(A, CAMP_SERPENT.x, CAMP_SERPENT.z, 28);
  await wakeZone(A, { defId: 'serpent', count: 1, timeout: 12000 });
  let target = nearestVisibleMob(A, 'serpent');
  if (!target) { // angle malchanceux : on retente d'un autre côté du camp
    await standoffNear(A, CAMP_SERPENT.x, CAMP_SERPENT.z, 26);
    await wakeZone(A, { defId: 'serpent', count: 1, timeout: 8000 });
    target = nearestVisibleMob(A, 'serpent');
  }
  ok('(f) Fourmi de feu disponible pour le test de partage', !!target);
  // B se poste à ~20 tuiles du camp : à portée de partage (30) du frappeur,
  // mais hors d'atteinte des Fourmis (aggro + errance), car B est niveau 1
  B.send({ t: 'move', x: CAMP_SERPENT.x - 19.5, z: CAMP_SERPENT.z + 4.5 });
  await B.waitFor(() => {
    const p = B.pos.get(B.id);
    return p && Math.hypot(p.x - CAMP_SERPENT.x, p.z - CAMP_SERPENT.z) < 22;
  }, 12000);
  A.send({ t: 'admin', cmd: 'goto', x: target.e.x + 1.2, z: target.e.z });
  await sleep(300);
  const aLevel = A.self.level, mobMaxHp = scaleMob(MOBS.serpent, 0).hp;
  const aFrom = A.xpEvents.length, bFrom = B.xpEvents.length;
  const hit = await singleHit(A, target.id);
  await sleep(1300);
  const f = Math.min(hit?.amount ?? 0, mobMaxHp) / mobMaxHp;
  const bonus = 1 + GROUP_XP_BONUS_PER_MEMBER; // 2 membres -> total x1,10, réparti /2
  const expA = mobXpReward(MOBS.serpent.level, aLevel) * f * bonus / 2;
  const expB = mobXpReward(MOBS.serpent.level, B.self.level) * f * bonus / 2;
  const gotA = xpGainedSince(A, aFrom), gotB = xpGainedSince(B, bFrom);
  ok(`(f) part du frappeur avec bonus (${gotA} ~ ${expA.toFixed(1)})`,
    hit && Math.abs(gotA - expA) <= 1.5);
  ok(`(f) part du membre à portée, à SON niveau (${gotB} ~ ${expB.toFixed(1)})`,
    hit && gotB > 0 && Math.abs(gotB - expB) <= 1.5);

  // -- HORS PORTÉE : A part frapper au camp Orc (~120 tuiles) -> B ne touche rien --
  A.send({ t: 'admin', cmd: 'set', level: 30 }); // survivre aux Hobgobelins
  await A.waitFor(() => A.self?.level === 30);
  await standoffNear(A, CAMP_ORC.x, CAMP_ORC.z, 28);
  await wakeZone(A, { defId: 'orc', count: 1, timeout: 8000 });
  const orc = nearestVisibleMob(A, 'orc');
  ok('(f) Hobgobelin disponible pour le test hors portée', !!orc);
  A.send({ t: 'admin', cmd: 'goto', x: orc.e.x + 1.4, z: orc.e.z });
  await sleep(300);
  const aFrom2 = A.xpEvents.length, bFrom2 = B.xpEvents.length;
  const hit2 = await singleHit(A, orc.id);
  await sleep(1300);
  ok('(f) hors portée : le frappeur gagne son XP', hit2 && xpGainedSince(A, aFrom2) > 0);
  ok('(f) hors portée : aucun partage pour le membre éloigné', xpGainedSince(B, bFrom2) === 0);

  // -- quitter : le groupe de 2 se dissout, les deux panneaux se vident --
  B.send({ t: 'party_leave' });
  await A.waitFor(() => A.party && A.party.members.length === 0, 5000);
  await B.waitFor(() => B.party && B.party.members.length === 0, 5000);
  ok('(f) départ -> dissolution notifiée aux deux joueurs',
    A.party?.members?.length === 0 && B.party?.members?.length === 0);
  B.ws.close();
}

const failed = checks.filter(([, c]) => !c);
console.log(failed.length === 0 ? '\nTOUT EST OK' : `\n${failed.length} ÉCHEC(S): ${failed.map(([n]) => n).join(', ')}`);
process.exit(failed.length === 0 ? 0 : 1);
