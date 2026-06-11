// Test d'intégration des sorts T4C (Bible) : prérequis d'achat, sorts "todo"
// non vendus, incantation avec délai (le dégât n'arrive qu'après le cast),
// interruption par mouvement, formules de dégâts vérifiées à stats connues,
// soin et buff de protection.
// À lancer EN PREMIER sur une base FRAÎCHE (1er compte = admin).
// Usage : node tools/test-spells.js [url ws]
import WebSocket from 'ws';
import { decodeSnapshot, BIN_SNAPSHOT } from '../shared/protocol.js';
import { KIND } from '../shared/constants.js';

const URL = process.argv[2] || 'ws://localhost:8090';
const checks = [];
const ok = (name, cond) => { checks.push([name, !!cond]); console.log(cond ? '  ✔' : '  ✘', name); };

const ws = new WebSocket(URL);
const S = {
  id: null, metas: new Map(), pos: new Map(), self: null, shop: null,
  hp: 0, mana: 0,
  castStart: null,        // { spellId, ms, at }
  castOkCount: 0,
  castBreakCount: 0,
  dmgEvents: [],          // { from, to, amount, at }
};
const send = (o) => ws.send(JSON.stringify(o));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const waitFor = (fn, timeout = 8000) => new Promise((res) => {
  const t0 = Date.now();
  const iv = setInterval(() => {
    const v = fn();
    if (v) { clearInterval(iv); res(v); }
    else if (Date.now() - t0 > timeout) { clearInterval(iv); res(null); }
  }, 40);
});

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
    case 'create_char': // répartition des points : Sag/Int bas, prérequis de sorts non remplis
      send({ t: 'create', stats: { str: 14, end: 22, agi: 12, int: 11, wis: 11 }, sex: 'male' });
      break;
    case 'welcome': S.id = m.id; break;
    case 'self': S.self = m; S.hp = m.hp; S.mana = m.mana; break;
    case 'vitals': S.hp = m.hp; S.mana = m.mana; break;
    case 'meta': for (const e of m.list) S.metas.set(e.id, e); break;
    case 'shop': S.shop = m; break;
    case 'cast_start': S.castStart = { spellId: m.spellId, ms: m.ms, at: Date.now() }; break;
    case 'cast_ok': S.castOkCount++; S.mana = m.mana; break;
    case 'cast_break': S.castBreakCount++; break;
    case 'events':
      for (const ev of m.list) {
        if (ev.t === 'dmg' && !ev.miss && !ev.parry) {
          S.dmgEvents.push({ from: ev.from, to: ev.to, amount: ev.amount, at: Date.now() });
        }
      }
      break;
  }
});

const me = () => S.pos.get(S.id);
// monstre vivant le plus proche, filtrable par defId
function nearestMob(defId = null) {
  let best = null, bestD = 1e9;
  const m0 = me();
  if (!m0) return null;
  for (const [id, e] of S.pos) {
    const meta = S.metas.get(id);
    if (meta?.kind !== KIND.MOB || e.state === 3) continue;
    if (defId && meta.defId !== defId) continue;
    const d = Math.hypot(e.x - m0.x, e.z - m0.z);
    if (d < bestD) { bestD = d; best = { id, e, d }; }
  }
  return best;
}
// marche vers le monstre jusqu'à être à portée `range`
async function approach(mobId, range = 7, tries = 14) {
  for (let i = 0; i < tries; i++) {
    const a = me(), b = S.pos.get(mobId);
    if (!a || !b) return false;
    if (Math.hypot(b.x - a.x, b.z - a.z) <= range) return true;
    send({ t: 'move', x: b.x, z: b.z });
    await sleep(900);
  }
  return false;
}
// lance `spellId` sur le monstre et retourne le premier dégât qui suit (ou null)
async function castAndMeasure(spellId, mobId) {
  S.castStart = null;
  const dmgBefore = S.dmgEvents.length;
  send({ t: 'cast', spellId, target: mobId });
  const start = await waitFor(() => S.castStart, 3000);
  if (!start) return null;
  const hit = await waitFor(() =>
    S.dmgEvents.slice(dmgBefore).find(d => d.from === S.id && d.to === mobId), start.ms + 3000);
  return hit ? { start, hit } : { start, hit: null };
}

await new Promise(r => ws.on('open', r));
send({ t: 'register', name: 'Mage_' + Math.floor(Math.random() * 1e6), pass: 'test1234' });
await waitFor(() => S.self && S.id != null && me());
ok('connexion', !!S.self);
const home = { x: me().x, z: me().z }; // point de départ (sûr), pour s'y replier

// --- boutique : sorts "todo" jamais vendus, prérequis d'achat ---
const npc = await waitFor(() => [...S.metas.values()].find(e => e.kind === KIND.NPC));
send({ t: 'interact', id: npc.id });
await waitFor(() => S.shop, 15000);
ok('boutique ouverte', !!S.shop);
const npcPos = { ...(S.pos.get(npc.id) || home) }; // pour revenir au marchand plus tard
ok('aucun sort "todo" en vente (Mot de Rappel, Malédiction, Guérison des Poisons...)',
  S.shop && S.shop.spells.length >= 10 && S.shop.spells.every(s => !s.todo
    && !['mot_de_rappel', 'malediction', 'guerison_des_poisons'].includes(s.id)));
const dard = S.shop?.spells.find(s => s.id === 'dard_de_feu');
ok('Dard de Feu en vente au prix de la Bible (532 or ÷ 5 = 106)', dard?.price === 106);

// achat refusé sous prérequis (stats de départ : Int 11 < 21)
send({ t: 'buy', kind: 'spell', id: 'dard_de_feu' });
await sleep(500);
ok('achat refusé sans les prérequis (Int 21)', !S.self?.spells.includes('dard_de_feu'));

// stats connues pour la suite : Sag 20, Int 25, niveau 10, bourse pleine
// (End 40 pour survivre aux représailles des monstres pendant les mesures)
send({ t: 'admin', cmd: 'stats', wis: 20, int: 25, end: 40 });
await sleep(300);
send({ t: 'admin', cmd: 'set', level: 10, gold: 100000 });
await sleep(300);
send({ t: 'buy', kind: 'spell', id: 'dard_de_feu' });
await waitFor(() => S.self?.spells.includes('dard_de_feu'));
ok('achat OK une fois les prérequis remplis', S.self?.spells.includes('dard_de_feu'));
send({ t: 'buy', kind: 'spell', id: 'eclat_de_pierre' }); // Sag 20, Int 17 : OK
send({ t: 'buy', kind: 'spell', id: 'guerison_legere' }); // Sag 19, Int 15 : OK
send({ t: 'buy', kind: 'spell', id: 'protection' });      // Sag 25 manquant -> refusé
await sleep(500);
ok('chaîne de prérequis stricte (Protection : Sag 25 refusé à 20)',
  S.self?.spells.includes('eclat_de_pierre') && S.self?.spells.includes('guerison_legere')
  && !S.self?.spells.includes('protection'));

// --- incantation : le dégât n'arrive qu'après le temps de cast ---
// niveau 10 : Dard de Feu = 1000 + (520 - 8x20) = 1360 ms (Bible)
let mob = await waitFor(() => nearestMob(), 5000);
ok('monstre trouvé', !!mob);
await approach(mob.id, 7);
let r = await castAndMeasure('dard_de_feu', mob.id);
ok('vitesse d\'incantation de la Bible (1360 ms au niveau 10)', r?.start?.ms === 1360);
const delay = r?.hit ? r.hit.at - r.start.at : -1;
ok(`le dégât n'arrive qu'après l'incantation (${delay} ms >= ~1360)`,
  r?.hit && delay >= r.start.ms - 250);

// --- interruption par mouvement volontaire ---
mob = nearestMob();
await approach(mob.id, 7);
S.castStart = null;
const okBefore = S.castOkCount, dmgBefore = S.dmgEvents.length;
send({ t: 'cast', spellId: 'dard_de_feu', target: mob.id });
await waitFor(() => S.castStart, 3000);
send({ t: 'movedir', x: 1, z: 0 }); // bouger volontairement = interrompre
await waitFor(() => S.castBreakCount > 0, 2000);
send({ t: 'movedir', x: 0, z: 0 });
await sleep(1800);
ok('incantation interrompue par le mouvement (cast_break, pas de dégât, pas de mana dépensé)',
  S.castBreakCount > 0 && S.castOkCount === okBefore
  && !S.dmgEvents.slice(dmgBefore).some(d => d.from === S.id));

// --- formules de la Bible à stats connues (Int 100, Sag 20, niveau 60) ---
// Dard de Feu  : 1d17 + 6 + Int/23 -> [11..27] sur cible sans résistance au feu
// Éclat de Pierre : 1d9 + 11 + Sag/22 -> [12..21] sur cible sans résistance terre
send({ t: 'admin', cmd: 'stats', int: 100, wis: 20, str: 25, end: 30, agi: 15 });
await sleep(300);
send({ t: 'admin', cmd: 'set', level: 60 });
await sleep(300);
// téléportation admin près d'un point (essaie quelques cases marchables)
async function gotoNear(x, z) {
  for (const [dx, dz] of [[0, 0], [2, 1], [-2, 2], [4, -2], [-4, -3], [1, 4], [6, 0], [0, -6]]) {
    send({ t: 'admin', cmd: 'goto', x: x + dx, z: z + dz });
    await sleep(350);
    const p = me();
    if (p && Math.hypot(p.x - x, p.z - z) < 9) return true;
  }
  return false;
}
async function sampleSpell(spellId, defId, n) {
  const out = [];
  for (let guard = 0; guard < n * 3 && out.length < n; guard++) {
    const target = nearestMob(defId) || await waitFor(() => nearestMob(defId), 4000);
    if (!target) break;
    if (!(await approach(target.id, 7))) continue;
    const res = await castAndMeasure(spellId, target.id);
    if (res?.hit) out.push(res.hit.amount);
    await sleep(150);
  }
  return out;
}
// Hobgobelin (orc) : aucune résistance au feu ; Squelette : aucune résistance terre
await gotoNear(56, 24); // camp des Hobgobelins
const feu = await sampleSpell('dard_de_feu', 'orc', 3);
console.log('   échantillons Dard de Feu sur Hobgobelin :', feu.join(', '));
ok('formule Dard de Feu respectée (1d17+6+Int/23 -> 11..27)',
  feu.length >= 2 && feu.every(v => v >= 10 && v <= 28));
await gotoNear(94, 36); // champ des Squelettes
const terre = await sampleSpell('eclat_de_pierre', 'squelette', 3);
console.log('   échantillons Éclat de Pierre sur Squelette :', terre.join(', '));
ok('formule Éclat de Pierre respectée (1d9+11+Sag/22 -> 12..21)',
  terre.length >= 2 && terre.every(v => v >= 11 && v <= 22));

// --- soin : Guérison Légère = 1d5 + 8 + Sag/23 -> ~10..14 PV ---
// se faire blesser par le monstre le plus proche, puis se soigner
const bully = nearestMob();
if (bully) {
  await approach(bully.id, 2);
  await waitFor(() => S.hp < S.self.maxHp - 20, 15000); // encaisser quelques coups
}
await gotoNear(home.x, home.z); // se replier à l'abri avant de se soigner
await sleep(400);
const hpBefore = S.hp;
send({ t: 'cast', spellId: 'guerison_legere' });
await waitFor(() => S.castOkCount > 0 && S.hp > hpBefore, 4000);
const healed = S.hp - hpBefore;
ok(`soin reçu conforme (~10-14 PV, mesuré ${healed})`, healed >= 6 && healed <= 20);

// --- buff : Protection = +3 + Int/100 + Sag/50 de CA -> 4.6 à Int 100 / Sag 30 ---
send({ t: 'admin', cmd: 'set', gold: 100000 });
send({ t: 'admin', cmd: 'stats', int: 100, wis: 30, str: 25, end: 30, agi: 15 });
await sleep(300);
await gotoNear(npcPos.x, npcPos.z); // l'achat exige un marchand à proximité
send({ t: 'move', x: npcPos.x, z: npcPos.z });
await sleep(1500);
send({ t: 'buy', kind: 'spell', id: 'protection' });
await waitFor(() => S.self?.spells.includes('protection'));
const defBase = S.self.defense;
send({ t: 'cast', spellId: 'protection' });
await waitFor(() => (S.self?.buffs || []).some(b => b.stat === 'def'), 5000);
const buff = S.self.buffs.find(b => b.stat === 'def');
// Int 100 / Sag 30 : 3 + 1 + 0.6 = 4.6 de CA
ok(`buff Protection conforme (+4.6 CA, mesuré ${buff?.power})`,
  buff && Math.abs(buff.power - 4.6) < 0.05 && S.self.defense >= defBase + 4.5);

const failed = checks.filter(([, c]) => !c);
console.log(failed.length === 0 ? '\nTOUT EST OK' : `\n${failed.length} ÉCHEC(S): ${failed.map(([n]) => n).join(', ')}`);
process.exit(failed.length === 0 ? 0 : 1);
