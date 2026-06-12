// Test d'intégration roguelike : marchand, achat, équipement, sort, obélisque,
// Épreuve (confirmation + entrée), permadeath, panthéon, nouveau personnage.
// Usage : node tools/test-roguelike.js [url]
import { PROTOCOL_VERSION } from '../shared/constants.js';
import WebSocket from 'ws';
import { decodeSnapshot, BIN_SNAPSHOT } from '../shared/protocol.js';
import { KIND } from '../shared/constants.js';
import { wakeZone } from './test-helpers.js';

const URL = process.argv[2] || 'ws://localhost:8080';
const checks = [];
const ok = (name, cond) => { checks.push([name, !!cond]); console.log(cond ? '  ✔' : '  ✘', name); };

const ws = new WebSocket(URL);
const S = {
  id: null, metas: new Map(), pos: new Map(), self: null,
  shop: null, obelisk: null, trial: null, died: null, zone: null, looks: new Map(),
};
const send = (o) => ws.send(JSON.stringify(o));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const waitFor = (fn, timeout = 8000) => new Promise((res, rej) => {
  const t0 = Date.now();
  const iv = setInterval(() => {
    const v = fn();
    if (v) { clearInterval(iv); res(v); }
    else if (Date.now() - t0 > timeout) { clearInterval(iv); res(null); }
  }, 50);
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
    case 'create_char':
      send({ t: 'create', stats: { str: 22, end: 18, agi: 14, int: 8, wis: 8 } });
      break;
    case 'welcome': S.id = m.id; break;
    case 'self': S.self = m; break;
    case 'zone': S.zone = m; S.pos.clear(); break;
    case 'meta': for (const e of m.list) S.metas.set(e.id, e); break;
    case 'shop': S.shop = m; break;
    case 'obelisk': S.obelisk = m; break;
    case 'confirm_trial': S.trial = m; break;
    case 'died': S.died = m; break;
    case 'events':
      for (const ev of m.list) if (ev.t === 'look') S.looks.set(ev.id, ev.look);
      break;
  }
});

await new Promise(r => ws.on('open', r));
send({ t: 'register', v: PROTOCOL_VERSION, name: 'Rogue_' + Math.floor(Math.random() * 1e6), pass: 'test1234' });

await waitFor(() => S.self && S.zone);
ok('connexion + zone reçue', S.zone?.zoneId === 0 && S.zone?.kind === 'island');
ok('or de départ (env)', S.self?.gold >= 500);

// --- marchand : parler, acheter, vérifier l'apparence ---
// (plusieurs PNJ entourent le temple désormais : on vise Maître Aldric par son nom)
const npc = await waitFor(() => [...S.metas.values()].find(e => e.kind === KIND.NPC && e.name === 'Maître Aldric'));
ok('PNJ marchand visible (Maître Aldric)', !!npc);
send({ t: 'interact', id: npc.id });
await waitFor(() => S.shop, 12000); // marche automatique vers le PNJ
ok('boutique ouverte (objets/compétences ; les sorts sont chez les enseignants)',
  S.shop && S.shop.items.length > 5 && S.shop.spells.length === 0 && S.shop.skills.length >= 2);

send({ t: 'buy', kind: 'item', id: 'epee_courte_rouillee' });
await waitFor(() => S.self?.inventory.some(i => i.defId === 'epee_courte_rouillee'));
const sword = S.self.inventory.find(i => i.defId === 'epee_courte_rouillee');
ok('épée rouillée achetée', !!sword);
send({ t: 'equip', iid: sword.iid });
await waitFor(() => S.self?.equip?.weapon === sword.iid);
ok('épée équipée', S.self?.equip?.weapon === sword.iid);

// téléportation admin à proximité d'un point (évite de longues marches qui
// font dépasser le budget de temps du test ; les interactions restent réelles)
async function jumpNear(x, z) {
  for (const [dx, dz] of [[0, 0], [1.5, 1], [-1.5, 1.5], [2.5, -1], [-2.5, -2], [0, 3]]) {
    send({ t: 'admin', cmd: 'goto', x: x + dx, z: z + dz });
    await sleep(250);
    const p = S.pos.get(S.id);
    if (p && Math.hypot(p.x - x, p.z - z) < 4) return true;
  }
  return false;
}

// --- sorts : ils s'achètent chez leur ENSEIGNANT (Iraltok, tour des mages de LH) ---
await jumpNear(326.5, 255.5); // devant Iraltok (coordonnées de shared/island1.js)
// prérequis T4C : refus tant que Sag/Int insuffisants (stats de départ 10/10)
send({ t: 'buy', kind: 'spell', id: 'dard_de_feu' });
await sleep(600);
ok('sort refusé sans les prérequis (Sag 15 / Int 21)', !S.self?.spells.includes('dard_de_feu'));
// montée des stats via admin (1er compte du serveur de test)
send({ t: 'admin', cmd: 'stats', wis: 20, int: 25 });
await sleep(400);
send({ t: 'admin', cmd: 'set', level: 3 });
await sleep(400);
send({ t: 'buy', kind: 'spell', id: 'dard_de_feu' });
await waitFor(() => S.self?.spells.includes('dard_de_feu'));
ok('Dard de Feu appris une fois les prérequis remplis', S.self?.spells.includes('dard_de_feu'));
// chaîne de prérequis : Flèche Enflammée exige Dard de Feu + Int 44
send({ t: 'buy', kind: 'spell', id: 'fleche_enflammee' });
await sleep(600);
ok('chaîne de prérequis respectée (Int 44 manquant)', !S.self?.spells.includes('fleche_enflammee'));
// compétences T4C : apprentissage (Coup assommant : For 25, Agi 20) puis
// entraînement — chez Maître Aldric, les enseignants n'en vendent pas
send({ t: 'admin', cmd: 'stats', str: 30, agi: 22, wis: 20, int: 25 });
await sleep(400);
await jumpNear(324.5, 242.5); // devant l'échoppe de Maître Aldric
send({ t: 'buy', kind: 'skill', id: 'coup_assommant' });
await waitFor(() => S.self?.skills?.coup_assommant >= 1);
ok('Coup assommant appris', S.self?.skills?.coup_assommant === 1);
send({ t: 'buy', kind: 'train', id: 'coup_assommant' });
send({ t: 'buy', kind: 'train', id: 'attaque' }); // innée : entraînable directement
await waitFor(() => S.self?.skills?.coup_assommant === 2 && S.self?.skills?.attaque === 1);
ok('entraînement par points (assommant 2, attaque 1)',
  S.self?.skills?.coup_assommant === 2 && S.self?.skills?.attaque === 1);

// --- sort sur un monstre (niveau 10 pour survivre à l'approche : ~78 PV) ---
send({ t: 'admin', cmd: 'set', level: 10 });
await sleep(400);
// spawn T4C : la zone est vide tant que personne ne bouge — on la réveille
await wakeZone({ send, pos: S.pos, metas: S.metas, get id() { return S.id; } },
  { count: 1, timeout: 10000 });
const mob = await waitFor(() => {
  for (const [id, e] of S.pos) {
    const meta = S.metas.get(id);
    if (meta?.kind === KIND.MOB && e.state !== 3) return { id, e };
  }
  return null;
});
let castWorked = false;
if (mob) {
  // s'approcher jusqu'à portée (9), puis lancer
  for (let i = 0; i < 12 && !castWorked; i++) {
    const me = S.pos.get(S.id), tgt = S.pos.get(mob.id);
    if (!me || !tgt) break;
    const dist = Math.hypot(tgt.x - me.x, tgt.z - me.z);
    if (dist > 7) { send({ t: 'move', x: tgt.x, z: tgt.z }); await sleep(1000); continue; }
    const before = S.pos.get(mob.id)?.hpPct ?? 100;
    send({ t: 'cast', spellId: 'dard_de_feu', target: mob.id });
    await sleep(1200);
    const after = S.pos.get(mob.id)?.hpPct ?? before;
    castWorked = after < before || !S.pos.has(mob.id); // blessé ou tué
  }
}
ok('Dard de Feu a blessé un monstre', castWorked);

// --- mouvement clavier (movedir) ---
const p0 = { ...(S.pos.get(S.id) || { x: 0, z: 0 }) };
send({ t: 'movedir', x: 1, z: 0 });
await sleep(800);
send({ t: 'movedir', x: 0, z: 0 });
const p1 = S.pos.get(S.id);
ok('déplacement direct (flèches)', p1 && Math.abs(p1.x - p0.x) > 1);

// --- obélisque ---
await jumpNear(345.5, 254.5);
send({ t: 'interact', prop: 'obelisk', x: 345.5, z: 254.5 });
await waitFor(() => S.obelisk, 15000);
ok('obélisque : liste des zones', S.obelisk?.zones?.length === 1 && S.obelisk.zones[0].id === 0);

// --- Épreuve : confirmation puis entrée ---
// niveau 15 pour survivre à la marche vers le portail (les minotaures de
// l'Épreuve, niveau 18, restent largement mortels : le test de mort tient)
send({ t: 'admin', cmd: 'set', level: 15 });
await sleep(400);
await jumpNear(107.5, 75.5);
send({ t: 'interact', prop: 'trialgate', x: 107.5, z: 77.5 });
await waitFor(() => S.trial, 25000); // marche finale vers le portail
ok('avertissement de l\'Épreuve reçu', !!S.trial && S.trial.text.includes('DÉFINITIVE'));
send({ t: 'trial_enter' });
await waitFor(() => S.zone?.kind === 'trial', 5000);
ok('téléporté dans l\'Épreuve', S.zone?.kind === 'trial');

// --- mourir dans l'Épreuve (fonce dans le tas) ---
send({ t: 'movedir', x: 1, z: -0.3 });
await waitFor(() => S.died, 60000);
send({ t: 'movedir', x: 0, z: 0 });
ok('mort définitive déclarée', S.died?.permadeath === true);
ok('panthéon transmis', Array.isArray(S.died?.pantheon) && S.died.pantheon.length >= 1);

// --- nouveau personnage (redistribution des points via create_char) ---
S.zone = null;
send({ t: 'newchar' });
await waitFor(() => S.zone?.zoneId === 0 && S.self?.level === 1, 6000);
ok('réincarnation niveau 1 zone 0', S.zone?.zoneId === 0 && S.self?.level === 1 && (S.self?.spells || []).length === 0);

const failed = checks.filter(([, c]) => !c);
console.log(failed.length === 0 ? '\nTOUT EST OK' : `\n${failed.length} ÉCHEC(S): ${failed.map(([n]) => n).join(', ')}`);
process.exit(failed.length === 0 ? 0 : 1);
