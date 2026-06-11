// Test d'intégration de la banque (coffre personnel) : ouverture, dépôt
// (avec déséquipement), retrait, refus à distance, inventaire plein,
// persistance après reconnexion. À lancer sur une base FRAÎCHE (1er compte = admin).
// Usage : node tools/test-banque.js [url]
import WebSocket from 'ws';

const URL = process.argv[2] || 'ws://localhost:8090';
const checks = [];
const ok = (name, cond) => { checks.push([name, !!cond]); console.log(cond ? '  ✔' : '  ✘', name); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const NAME = 'Banquier_' + Math.floor(Math.random() * 1e6);
const PASS = 'test1234';
const BANK = { x: 52.5, z: 68.5 };       // position du coffre (worldgen zone 0)
const NEAR_BANK = { x: 53.5, z: 68.5 };  // case praticable adjacente
const NPC_POS = { x: 59.5, z: 66.5 };    // marchand du village

// petite session WebSocket : état + helpers
function session() {
  const S = { self: null, zone: null, bank: null, id: null };
  const ws = new WebSocket(URL);
  ws.on('message', (raw, bin) => {
    if (bin) return;
    const m = JSON.parse(raw.toString());
    if (m.t === 'create_char') S.send({ t: 'create', stats: { str: 22, end: 18, agi: 14, int: 8, wis: 8 } });
    else if (m.t === 'welcome') S.id = m.id;
    else if (m.t === 'self') S.self = m;
    else if (m.t === 'zone') S.zone = m;
    else if (m.t === 'bank_open') S.bank = m;
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

const A = session();
await A.open;
A.send({ t: 'register', name: NAME, pass: PASS });
await A.waitFor(() => A.self && A.zone);
ok('connexion zone 0', A.zone?.zoneId === 0);

// --- ouverture : se téléporter près du coffre (admin = 1er compte) ---
A.send({ t: 'admin', cmd: 'goto', x: NEAR_BANK.x, z: NEAR_BANK.z });
await sleep(400);
A.send({ t: 'interact', prop: 'bank', x: BANK.x, z: BANK.z });
await A.waitFor(() => A.bank);
ok('banque ouverte, vide, plafond 30', A.bank && A.bank.items.length === 0 && A.bank.max === 30);

// --- dépôt de l'arme équipée : déséquipe + sort de l'inventaire + entre en banque ---
const weapon = A.self.inventory.find(i => i.defId === 'poignard_rouille');
ok('poignard équipé au départ', weapon && A.self.equip.weapon === weapon.iid);
const weightBefore = A.self.weight;
A.send({ t: 'bank_deposit', iid: weapon.iid });
await A.waitFor(() => A.bank?.items.some(i => i.iid === weapon.iid));
ok('poignard déposé en banque', A.bank.items.some(i => i.iid === weapon.iid));
ok('poignard retiré de l\'inventaire', !A.self.inventory.some(i => i.iid === weapon.iid));
ok('poignard déséquipé', A.self.equip.weapon == null);
ok('les objets en banque ne pèsent plus', A.self.weight < weightBefore);
ok('label/slot transmis', A.bank.items[0].label === 'Poignard rouillé' && A.bank.items[0].slot === 'weapon');

// --- retrait ---
A.send({ t: 'bank_withdraw', iid: weapon.iid });
await A.waitFor(() => A.self?.inventory.some(i => i.iid === weapon.iid));
ok('poignard retiré de la banque', A.bank.items.length === 0 && A.self.inventory.some(i => i.iid === weapon.iid));

// --- refus à distance (proximité du coffre obligatoire) ---
A.send({ t: 'admin', cmd: 'goto', x: 64.5, z: 73.5 }); // place du village, loin du coffre
await sleep(400);
const invCount = A.self.inventory.length;
A.send({ t: 'bank_deposit', iid: weapon.iid });
await sleep(800);
ok('dépôt refusé loin du coffre', A.self.inventory.length === invCount && A.bank.items.length === 0);

// --- dépôt d'une potion puis inventaire plein : retrait refusé ---
A.send({ t: 'admin', cmd: 'goto', x: NEAR_BANK.x, z: NEAR_BANK.z });
await sleep(400);
const potion = A.self.inventory.find(i => i.defId === 'potion_vie');
A.send({ t: 'bank_deposit', iid: potion.iid });
await A.waitFor(() => A.bank?.items.some(i => i.iid === potion.iid));
ok('potion déposée', A.bank.items.some(i => i.iid === potion.iid));
// remplir l'inventaire à 24 chez le marchand
A.send({ t: 'admin', cmd: 'goto', x: NPC_POS.x, z: NPC_POS.z });
await sleep(400);
while (A.self.inventory.length < 24) {
  const n = A.self.inventory.length;
  A.send({ t: 'buy', kind: 'item', id: 'veste_toile' });
  const grew = await A.waitFor(() => A.self.inventory.length > n, 3000);
  if (!grew) break;
}
ok('inventaire rempli à 24', A.self.inventory.length === 24);
A.send({ t: 'admin', cmd: 'goto', x: NEAR_BANK.x, z: NEAR_BANK.z });
await sleep(400);
A.send({ t: 'bank_withdraw', iid: potion.iid });
await sleep(800);
ok('retrait refusé inventaire plein', A.self.inventory.length === 24 && A.bank.items.some(i => i.iid === potion.iid));

// --- persistance : reconnexion, la banque survit ---
const B = session();
await B.open;
B.send({ t: 'login', name: NAME, pass: PASS });
await B.waitFor(() => B.self && B.zone);
B.send({ t: 'admin', cmd: 'goto', x: NEAR_BANK.x, z: NEAR_BANK.z });
await sleep(400);
B.send({ t: 'interact', prop: 'bank', x: BANK.x, z: BANK.z });
await B.waitFor(() => B.bank);
ok('banque persistée après reconnexion', B.bank?.items.some(i => i.defId === 'potion_vie'));

const failed = checks.filter(([, c]) => !c);
console.log(failed.length === 0 ? '\nTOUT EST OK' : `\n${failed.length} ÉCHEC(S): ${failed.map(([n]) => n).join(', ')}`);
process.exit(failed.length === 0 ? 0 : 1);
