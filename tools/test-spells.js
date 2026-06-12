// Test d'intégration des sorts T4C (Bible) : prérequis d'achat, sorts "todo"
// non vendus, incantation avec délai (le dégât n'arrive qu'après le cast),
// interruption par mouvement, formules de dégâts vérifiées à stats connues,
// soin et buff de protection.
// À lancer EN PREMIER sur une base FRAÎCHE (1er compte = admin).
// Usage : node tools/test-spells.js [url ws]
import { PROTOCOL_VERSION } from '../shared/constants.js';
import WebSocket from 'ws';
import { decodeSnapshot, BIN_SNAPSHOT } from '../shared/protocol.js';
import { KIND } from '../shared/constants.js';
import { generateWorld } from '../shared/worldgen.js';

// chaque sort s'achète chez SON enseignant : positions de la carte partagée
const NPC_SPOTS = generateWorld(0, 'arakas').npcSpots;
const spotOf = (npcId) => NPC_SPOTS.find(s => s.npcId === npcId);

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
// (pas de 450 ms : sortie au plus tôt, le budget temps de la suite est serré)
async function approach(mobId, range = 7, tries = 26) {
  for (let i = 0; i < tries; i++) {
    const a = me(), b = S.pos.get(mobId);
    if (!a || !b) return false;
    if (Math.hypot(b.x - a.x, b.z - a.z) <= range) return true;
    if (i % 2 === 0) send({ t: 'move', x: b.x, z: b.z });
    await sleep(450);
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
send({ t: 'register', v: PROTOCOL_VERSION, name: 'Mage_' + Math.floor(Math.random() * 1e6), pass: 'test1234' });
await waitFor(() => S.self && S.id != null && me());
ok('connexion', !!S.self);
const home = { x: me().x, z: me().z }; // point de départ (sûr), pour s'y replier

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
// ouvre la boutique d'un enseignant/marchand donné (déplacement + interaction)
async function shopOf(npcId, displayName) {
  const spot = spotOf(npcId);
  await gotoNear(spot.x, spot.z);
  const npc = await waitFor(() =>
    [...S.metas.values()].find(e => e.kind === KIND.NPC && e.name === displayName), 5000);
  if (!npc) return null;
  S.shop = null;
  send({ t: 'interact', id: npc.id });
  return await waitFor(() => S.shop, 10000);
}

// --- enseignants : chacun ne vend QUE ses sorts, jamais les "todo" ---
const iraltok = await shopOf('iraltok', 'Iraltok');
ok('boutique d\'Iraltok ouverte (enseignant du feu)', !!iraltok);
ok('Iraltok ne vend que SES sorts (Dard de feu, Flèche enflammée)',
  iraltok && iraltok.spells.length === 2
  && iraltok.spells.some(s => s.id === 'dard_de_feu')
  && iraltok.spells.some(s => s.id === 'fleche_enflammee'));
const dard = iraltok?.spells.find(s => s.id === 'dard_de_feu');
ok('Dard de feu en vente au prix de la référence (532 or ÷ 5 = 106)', dard?.price === 106);

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
// le mauvais enseignant ne vend rien : Guérison légère s'apprend chez Moonrock
send({ t: 'buy', kind: 'spell', id: 'guerison_legere' });
await sleep(500);
ok('Iraltok refuse d\'enseigner les sorts de Moonrock', !S.self?.spells.includes('guerison_legere'));

// Shovanis (sous-sol du Temple) : Malédiction au juste prix, Mot de rappel (todo) absent
const shovanis = await shopOf('shovanis', 'Shovanis');
ok('Malédiction chez Shovanis à 17200 ÷ 5 = 3440, sans les sorts "todo"',
  shovanis?.spells.find(s => s.id === 'malediction')?.price === 3440
  && shovanis?.spells.every(s => !s.todo && s.id !== 'mot_de_rappel'));

// Uranos puis Moonrock : achats chez le bon maître, prérequis stricts
await gotoNear(spotOf('uranos').x, spotOf('uranos').z);
send({ t: 'buy', kind: 'spell', id: 'eclat_de_pierre' }); // Sag 20, Int 17 : OK
await waitFor(() => S.self?.spells.includes('eclat_de_pierre'));
await gotoNear(spotOf('moonrock').x, spotOf('moonrock').z);
send({ t: 'buy', kind: 'spell', id: 'guerison_legere' }); // Sag 19, Int 15 : OK
send({ t: 'buy', kind: 'spell', id: 'protection' });      // Sag 25 manquant -> refusé
await sleep(500);
ok('chaîne de prérequis stricte (Protection : Sag 25 refusé à 20)',
  S.self?.spells.includes('eclat_de_pierre') && S.self?.spells.includes('guerison_legere')
  && !S.self?.spells.includes('protection'));

// La suite complète dépasse le budget d'un appel sandbox (45 s) : on peut la
// jouer par tiers. Usage : node tools/test-spells.js [url] [A|B|C|D|ABCD]
// A = récupération T4C ; B = formules de dégâts ; C = soin + buff ;
// D = Malédiction, Bouclier de mana, Résistance au feu (DB fraîche requise).
const PART = (process.argv[3] || 'ABC').toUpperCase();

if (PART.includes('A')) {
// --- récupération T4C : l'effet part IMMÉDIATEMENT, le délai s'applique APRÈS ---
// niveau 10 : Dard de Feu = 1000 + (520 - 8x20) = 1360 ms de récupération (Bible)
let mob = await waitFor(() => nearestMob(), 5000);
ok('monstre trouvé', !!mob);
await approach(mob.id, 7);
let r = await castAndMeasure('dard_de_feu', mob.id);
ok('récupération de la Bible annoncée (1360 ms au niveau 10)', r?.start?.ms === 1360);
const delay = r?.hit ? r.hit.at - r.start.at : -1;
ok(`le dégât part immédiatement (${delay} ms, sans attendre la récupération)`,
  r?.hit && delay <= 500);

// --- relance pendant la récupération : refusée, puis acceptée à la fin ---
// (on ne compte que MES dégâts : les monstres frappent aussi pendant le test)
const mine = () => S.dmgEvents.filter(d => d.from === S.id).length;
await sleep(1500); // purge la récupération du cast précédent
mob = await waitFor(() => nearestMob(), 4000);
await approach(mob.id, 7);
const dmgBefore = mine();
send({ t: 'cast', spellId: 'dard_de_feu', target: mob.id }); // 1er : part tout de suite
await waitFor(() => mine() > dmgBefore, 3000);
const early = mine();
send({ t: 'cast', spellId: 'dard_de_feu', target: mob.id }); // 2e : en pleine récupération
await sleep(700); // < 1360 ms : rien ne doit partir
const blocked = mine() === early;
await sleep(900); // la récupération est finie
// la cible a pu mourir entre-temps : on revient à portée d'un monstre vivant
const t3 = await waitFor(() => nearestMob(), 4000);
if (t3) await approach(t3.id, 7);
send({ t: 'cast', spellId: 'dard_de_feu', target: t3?.id ?? mob.id });
const relance = await waitFor(() => mine() > early, 4000);
ok('relance bloquée pendant la récupération puis acceptée ensuite',
  mine() > dmgBefore && blocked && !!relance);
} // fin partie A

if (PART.includes('B')) {
// --- formules de la Bible à stats connues (Int 100, Sag 20, niveau 60) ---
// Dard de Feu  : 1d17 + 6 + Int/23 -> [11..27] sur cible sans résistance au feu
// Éclat de Pierre : 1d9 + 11 + Sag/22 -> [12..21] sur cible sans résistance terre
send({ t: 'admin', cmd: 'stats', int: 100, wis: 20, str: 25, end: 30, agi: 15 });
await sleep(300);
send({ t: 'admin', cmd: 'set', level: 60 });
await sleep(300);
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
await gotoNear(280, 127); // le camp Orc de Roshnak Tul (carte Arakas Classic)
const feu = await sampleSpell('dard_de_feu', 'orc', 2);
console.log('   échantillons Dard de Feu sur Hobgobelin :', feu.join(', '));
ok('formule Dard de Feu respectée (1d17+6+Int/23 -> 11..27)',
  feu.length >= 2 && feu.every(v => v >= 10 && v <= 28));
await gotoNear(219, 81); // la crypte du Nomade et ses squelettes (Arakas Classic)
const terre = await sampleSpell('eclat_de_pierre', 'squelette', 2);
console.log('   échantillons Éclat de Pierre sur Squelette :', terre.join(', '));
ok('formule Éclat de Pierre respectée (1d9+11+Sag/22 -> 12..21)',
  terre.length >= 2 && terre.every(v => v >= 11 && v <= 22));
} // fin partie B

if (PART.includes('C')) {
send({ t: 'admin', cmd: 'stats', int: 100, wis: 20, str: 25, end: 30, agi: 15 });
send({ t: 'admin', cmd: 'set', level: 60, gold: 100000 });
await sleep(400);
// --- soin : Guérison Légère = 1d5 + 8 + Sag/23 -> ~10..14 PV ---
// se faire blesser par le monstre le plus proche, puis se soigner
await gotoNear(280, 127); // au camp Orc : il faut bien se faire taper dessus
const bully = await waitFor(() => nearestMob(), 4000);
if (bully) {
  await approach(bully.id, 2);
  await waitFor(() => S.hp < S.self.maxHp - 12, 8000); // encaisser quelques coups
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
// Protection s'apprend chez Moonrock (parvis du Temple de LH)
const moonrock = spotOf('moonrock');
await gotoNear(moonrock.x, moonrock.z);
send({ t: 'move', x: moonrock.x, z: moonrock.z + 1 });
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
} // fin partie C

if (PART.includes('D')) {
// --- nouveautés : Bouclier de mana, Résistance au feu, Malédiction ---
send({ t: 'admin', cmd: 'stats', int: 200, wis: 200, str: 25, end: 60, agi: 15 });
send({ t: 'admin', cmd: 'set', level: 60, gold: 100000 });
await sleep(400);
for (const id of ['malediction', 'bouclier_de_mana', 'resistance_au_feu']) {
  send({ t: 'admin', cmd: 'learn', spell: id });
}
await waitFor(() => ['malediction', 'bouclier_de_mana', 'resistance_au_feu']
  .every(s => S.self?.spells.includes(s)));
ok('sorts appris (admin learn)', S.self?.spells.includes('resistance_au_feu'));
send({ t: 'unequip', slot: 'armor' }); // CA nulle : dégâts des monstres prévisibles
await sleep(300);

// La Fourmi de feu mord avec l'élément FEU : 3 dégâts pile sur un joueur sans CA.
// On encaisse quelques morsures, puis on mesure l'effet des buffs de résistance.
async function sampleHits(n, timeout = 9000) {
  const out = [];
  let seen = S.dmgEvents.length;
  const t0 = Date.now();
  while (out.length < n && Date.now() - t0 < timeout) {
    await sleep(150);
    for (const d of S.dmgEvents.slice(seen)) if (d.to === S.id) out.push(d.amount);
    seen = S.dmgEvents.length;
  }
  return out;
}
await gotoNear(357, 237); // côte NE : les Fourmis de feu (carte Arakas Classic)
const ant = await waitFor(() => nearestMob('serpent'), 5000);
ok('Fourmi de feu trouvée', !!ant);
if (ant) await approach(ant.id, 1.5);
const temoin = await sampleHits(3);
console.log('   morsures témoin (attendu 3,3,3) :', temoin.join(', '));
ok('morsure de feu témoin = 3 dégâts (CA nulle)', temoin.length >= 2 && temoin.every(v => v === 3));

send({ t: 'cast', spellId: 'bouclier_de_mana' });
await waitFor(() => (S.self?.buffs || []).some(b => b.stat === 'resistAll'), 4000);
const avecBouclier = await sampleHits(3);
console.log('   morsures sous Bouclier de mana (attendu 2,2,2) :', avecBouclier.join(', '));
ok('Bouclier de mana : dégâts magiques réduits de 33 % (3 -> 2)',
  avecBouclier.length >= 2 && avecBouclier.every(v => v === 2));

await sleep(1200); // récupération du sort précédent
send({ t: 'cast', spellId: 'resistance_au_feu' });
await waitFor(() => (S.self?.buffs || []).some(b => b.stat === 'resist_feu'), 4000);
const avecResist = await sampleHits(3);
console.log('   morsures sous Résistance au feu (attendu 0,0,0) :', avecResist.join(', '));
ok('Résistance au feu : le feu est entièrement annulé (0 dégât)',
  avecResist.length >= 2 && avecResist.every(v => v === 0));

// --- Malédiction : sur un monstre, puis sur un joueur (le soin est bloqué) ---
await sleep(1200);
const okBefore = S.castOkCount;
send({ t: 'cast', spellId: 'malediction', target: ant?.id });
await waitFor(() => S.castOkCount > okBefore, 4000);
ok('Malédiction lancée sur un monstre', S.castOkCount > okBefore);

// second joueur : il se fait maudire, sa potion de vie reste alors sans effet
const victim = await new Promise((resolve) => {
  const w = new WebSocket(URL);
  const st = { id: null, self: null, hp: 0, infos: [], pos: new Map() };
  w.on('message', (raw, bin) => {
    if (bin) {
      const ab = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
      if (new DataView(ab).getUint8(0) !== BIN_SNAPSHOT) return;
      const snap = decodeSnapshot(ab);
      for (const e of snap.entities) st.pos.set(e.id, e);
      return;
    }
    const m = JSON.parse(raw.toString());
    if (m.t === 'create_char') w.send(JSON.stringify({ t: 'create', stats: { str: 14, end: 22, agi: 12, int: 11, wis: 11 }, sex: 'male' }));
    else if (m.t === 'welcome') st.id = m.id;
    else if (m.t === 'self') { st.self = m; st.hp = m.hp; }
    else if (m.t === 'vitals') st.hp = m.hp;
    else if (m.t === 'info') st.infos.push(m.text);
  });
  w.on('open', () => w.send(JSON.stringify({ t: 'register', v: PROTOCOL_VERSION, name: 'Maudit_' + Math.floor(Math.random() * 1e6), pass: 'test1234' })));
  const iv = setInterval(() => {
    if (st.id != null && st.self && st.pos.get(st.id)) { clearInterval(iv); resolve({ w, st, send: (o) => w.send(JSON.stringify(o)) }); }
  }, 50);
});
const vpos = victim.st.pos.get(victim.st.id);
await gotoNear(vpos.x, vpos.z); // à portée (9) de la victime
await sleep(1200); // purge la récupération
send({ t: 'cast', spellId: 'malediction', target: victim.st.id });
await waitFor(() => (victim.st.self?.buffs || []).some(b => b.stat === 'maudit'), 5000);
ok('Malédiction lancée sur un joueur (debuff visible)',
  (victim.st.self?.buffs || []).some(b => b.stat === 'maudit'));
const nPotions = victim.st.self.inventory.filter(i => i.defId === 'potion_vie').length;
victim.send({ t: 'use', iid: victim.st.self.inventory.find(i => i.defId === 'potion_vie')?.iid });
const blocked = await waitFor(() => victim.st.infos.some(t => t.includes('malédiction')), 4000);
await sleep(300);
const nApres = victim.st.self.inventory.filter(i => i.defId === 'potion_vie').length;
ok('malédiction : la potion de vie est bloquée (message + potion conservée)',
  !!blocked && nApres === nPotions);
victim.w.close();
} // fin partie D

const failed = checks.filter(([, c]) => !c);
console.log(failed.length === 0 ? '\nTOUT EST OK' : `\n${failed.length} ÉCHEC(S): ${failed.map(([n]) => n).join(', ')}`);
process.exit(failed.length === 0 ? 0 : 1);
