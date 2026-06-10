// Test d'intégration roguelike : marchand, achat, équipement, sort, obélisque,
// Épreuve (confirmation + entrée), permadeath, panthéon, nouveau personnage.
// Usage : node tools/test-roguelike.js [url]
import WebSocket from 'ws';
import { decodeSnapshot, BIN_SNAPSHOT } from '../shared/protocol.js';
import { KIND } from '../shared/constants.js';

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
send({ t: 'register', name: 'Rogue_' + Math.floor(Math.random() * 1e6), pass: 'test1234' });

await waitFor(() => S.self && S.zone);
ok('connexion + zone reçue', S.zone?.zoneId === 0 && S.zone?.kind === 'island');
ok('or de départ (env)', S.self?.gold >= 500);

// --- marchand : parler, acheter, vérifier l'apparence ---
const npc = await waitFor(() => [...S.metas.values()].find(e => e.kind === KIND.NPC));
ok('PNJ marchand visible', !!npc);
send({ t: 'interact', id: npc.id });
await waitFor(() => S.shop, 12000); // marche automatique vers le PNJ
ok('boutique ouverte (objets/sorts/compétences)',
  S.shop && S.shop.items.length > 5 && S.shop.spells.length >= 3 && S.shop.skills.length >= 2);

send({ t: 'buy', kind: 'item', id: 'epee_courte' });
await waitFor(() => S.self?.inventory.some(i => i.defId === 'epee_courte'));
const sword = S.self.inventory.find(i => i.defId === 'epee_courte');
ok('épée achetée', !!sword);
send({ t: 'equip', iid: sword.iid });
await waitFor(() => S.self?.equip?.weapon === sword.iid);
ok('épée équipée', S.self?.equip?.weapon === sword.iid);

send({ t: 'buy', kind: 'spell', id: 'eclair_mineur' });
await waitFor(() => S.self?.spells.includes('eclair_mineur'));
ok('sort appris', S.self?.spells.includes('eclair_mineur'));
send({ t: 'buy', kind: 'skill', id: 'peau_de_fer' });
await waitFor(() => S.self?.skills.includes('peau_de_fer'));
ok('compétence apprise', S.self?.skills.includes('peau_de_fer'));

// --- sort sur un monstre ---
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
    send({ t: 'cast', spellId: 'eclair_mineur', target: mob.id });
    await sleep(1200);
    const after = S.pos.get(mob.id)?.hpPct ?? before;
    castWorked = after < before || !S.pos.has(mob.id); // blessé ou tué
  }
}
ok('éclair mineur a blessé un monstre', castWorked);

// --- mouvement clavier (movedir) ---
const p0 = { ...(S.pos.get(S.id) || { x: 0, z: 0 }) };
send({ t: 'movedir', x: 1, z: 0 });
await sleep(800);
send({ t: 'movedir', x: 0, z: 0 });
const p1 = S.pos.get(S.id);
ok('déplacement direct (flèches)', p1 && Math.abs(p1.x - p0.x) > 1);

// --- obélisque ---
send({ t: 'interact', prop: 'obelisk', x: 77.5, z: 72.5 });
await waitFor(() => S.obelisk, 15000);
ok('obélisque : liste des zones', S.obelisk?.zones?.length === 1 && S.obelisk.zones[0].id === 0);

// --- Épreuve : confirmation puis entrée ---
send({ t: 'interact', prop: 'trialgate', x: 60.5, z: 28.5 });
await waitFor(() => S.trial, 25000); // longue marche vers le nord
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

// --- nouveau personnage ---
S.zone = null;
send({ t: 'newchar' });
await waitFor(() => S.zone && S.self?.level === 1 && S.self?.gold <= 600, 5000);
ok('réincarnation niveau 1 zone 0', S.zone?.zoneId === 0 && S.self?.level === 1 && (S.self?.spells || []).length === 0);

const failed = checks.filter(([, c]) => !c);
console.log(failed.length === 0 ? '\nTOUT EST OK' : `\n${failed.length} ÉCHEC(S): ${failed.map(([n]) => n).join(', ')}`);
process.exit(failed.length === 0 ? 0 : 1);
