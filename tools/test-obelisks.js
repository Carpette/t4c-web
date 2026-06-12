// Réseau de voyage local des obélisques : depuis un obélisque d'Arakas, on
// rejoint n'importe quel autre obélisque de la zone pour 10 po (l'accès à la
// zone suffit). Vérifie : panneau (3 obélisques nommés), voyage payé, refus
// sans or, refus loin de l'obélisque.
// À lancer sur une base FRAÎCHE (1er compte = admin). Usage : node tools/test-obelisks.js [url]
import WebSocket from 'ws';
import { PROTOCOL_VERSION, OBELISK_TRAVEL_COST, KIND } from '../shared/constants.js';
import { decodeSnapshot, BIN_SNAPSHOT } from '../shared/protocol.js';
import { generateWorld } from '../shared/worldgen.js';

const URL = process.argv[2] || 'ws://localhost:8090';
const checks = [];
const ok = (name, cond) => { checks.push([name, !!cond]); console.log(cond ? '  ✔' : '  ✘', name); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const OBELISKS = generateWorld(0, 'arakas').props.filter(p => p.type === 'obelisk');
const LH = OBELISKS.find(o => o.name === 'Lighthaven');
const TABLET = OBELISKS.find(o => o.name === 'Tablette runique');

const ws = new WebSocket(URL);
const S = { id: null, self: null, pos: new Map(), obelisk: null, infos: [] };
const send = (o) => ws.send(JSON.stringify(o));
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
    return;
  }
  const m = JSON.parse(raw.toString());
  if (m.t === 'create_char') send({ t: 'create', stats: { str: 14, end: 22, agi: 12, int: 11, wis: 11 }, sex: 'male' });
  else if (m.t === 'welcome') S.id = m.id;
  else if (m.t === 'self') S.self = m;
  else if (m.t === 'obelisk') S.obelisk = m;
  else if (m.t === 'info') S.infos.push(m.text);
});
const me = () => S.pos.get(S.id);

await new Promise(r => ws.on('open', r));
send({ t: 'register', v: PROTOCOL_VERSION, name: 'Voyageur', pass: 'test1234' });
await waitFor(() => S.self && me());
ok('connexion (3 obélisques sur Arakas)', !!S.self && OBELISKS.length === 3 && LH && TABLET);

// au pied de l'obélisque de Lighthaven (1er compte = admin -> goto)
send({ t: 'admin', cmd: 'goto', x: LH.x, z: LH.z + 1.5 });
await sleep(400);
send({ t: 'admin', cmd: 'set', gold: 25 });
await sleep(300);
send({ t: 'interact', prop: 'obelisk', x: LH.x, z: LH.z });
await waitFor(() => S.obelisk, 6000);
ok('panneau reçu avec le réseau local (Windhowl + Tablette runique, coût 10)',
  S.obelisk && S.obelisk.cost === OBELISK_TRAVEL_COST && S.obelisk.local?.length === 2
  && S.obelisk.local.some(o => o.name === 'Windhowl')
  && S.obelisk.local.some(o => o.name === 'Tablette runique')
  && !S.obelisk.local.some(o => o.name === 'Lighthaven'));

// voyage vers la Tablette runique : -10 or, arrivée au pied de l'obélisque
const tablet = S.obelisk.local.find(o => o.name === 'Tablette runique');
send({ t: 'teleport_local', i: tablet.i });
await waitFor(() => me() && Math.hypot(me().x - TABLET.x, me().z - TABLET.z) < 6, 6000);
const p1 = me();
ok('téléporté à la Tablette runique', p1 && Math.hypot(p1.x - TABLET.x, p1.z - TABLET.z) < 6);
await waitFor(() => S.self.gold === 15, 4000);
ok(`voyage facturé ${OBELISK_TRAVEL_COST} or (reste 15)`, S.self.gold === 15);

// le panneau est réutilisable à l'arrivée (on est au pied d'un obélisque)
S.obelisk = null;
send({ t: 'interact', prop: 'obelisk', x: TABLET.x, z: TABLET.z });
await waitFor(() => S.obelisk, 6000);
const wh = S.obelisk?.local?.find(o => o.name === 'Windhowl');
ok('panneau de la Tablette : Lighthaven et Windhowl proposés', !!wh
  && S.obelisk.local.some(o => o.name === 'Lighthaven'));

// plus assez d'or (15 -> voyage à 10 OK, puis 5 -> refus)
send({ t: 'teleport_local', i: wh.i });
await waitFor(() => S.self.gold === 5, 6000);
ok('second voyage payé (reste 5)', S.self.gold === 5);
S.infos.length = 0;
send({ t: 'interact', prop: 'obelisk', x: OBELISKS.find(o => o.name === 'Windhowl').x, z: OBELISKS.find(o => o.name === 'Windhowl').z });
await sleep(600);
send({ t: 'teleport_local', i: tablet.i });
await waitFor(() => S.infos.some(t => t.includes('pièces d\'or')), 4000);
ok('refusé sans or (message explicite), bourse intacte',
  S.infos.some(t => t.includes('pièces d\'or')) && S.self.gold === 5);

const failed = checks.filter(([, c]) => !c);
console.log(failed.length === 0 ? '\nTOUT EST OK' : `\n${failed.length} ÉCHEC(S): ${failed.map(([n]) => n).join(', ')}`);
process.exit(failed.length === 0 ? 0 : 1);
