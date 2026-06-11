// Test : victoire de l'Épreuve → déblocage de la zone suivante.
// Le 1er compte créé est admin : on s'en sert pour accélérer (niveau, téléport local).
import WebSocket from 'ws';
import { decodeSnapshot, BIN_SNAPSHOT } from '../shared/protocol.js';

const URL = process.argv[2] || 'ws://localhost:8080';
const checks = [];
const ok = (name, cond) => { checks.push([name, !!cond]); console.log(cond ? '  ✔' : '  ✘', name); };

const ws = new WebSocket(URL);
const S = { id: null, self: null, zone: null, trial: null, pos: new Map(), obelisk: null };
const send = (o) => ws.send(JSON.stringify(o));
const waitFor = (fn, timeout = 8000) => new Promise((res) => {
  const t0 = Date.now();
  const iv = setInterval(() => {
    const v = fn();
    if (v || Date.now() - t0 > timeout) { clearInterval(iv); res(v); }
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
  if (m.t === 'create_char') send({ t: 'create', stats: { str: 22, end: 18, agi: 14, int: 8, wis: 8 } });
  else if (m.t === 'welcome') { S.id = m.id; S.admin = m.admin; }
  else if (m.t === 'self') S.self = m;
  else if (m.t === 'zone') { S.zone = m; S.pos.clear(); }
  else if (m.t === 'confirm_trial') S.trial = m;
  else if (m.t === 'obelisk') S.obelisk = m;
});

await new Promise(r => ws.on('open', r));
send({ t: 'register', name: 'Champion', pass: 'test1234' });
await waitFor(() => S.self && S.zone);
ok('admin (1er compte)', S.admin === true);

send({ t: 'admin', cmd: 'set', level: 120 });
await waitFor(() => S.self?.level === 120);
ok('niveau 120 via admin', S.self?.level === 120);

// téléport local près du portail de l'Épreuve (monts Righul, carte Arakas)
send({ t: 'admin', cmd: 'goto', x: 114.5, z: 43.5 });
await new Promise(r => setTimeout(r, 400));
send({ t: 'interact', prop: 'trialgate', x: 114.5, z: 45.5 });
await waitFor(() => S.trial, 15000);
ok('confirmation reçue', !!S.trial);
send({ t: 'trial_enter' });
await waitFor(() => S.zone?.kind === 'trial', 5000);
ok('dans l\'Épreuve', S.zone?.kind === 'trial');

// traverse le labyrinthe : marche automatique vers la sortie (combats en route)
send({ t: 'interact', prop: 'exitgate', x: 57.5, z: 7.5 });
const won = await waitFor(() => S.zone?.kind === 'island' && S.zone?.zoneId === 1, 33000);
ok('Épreuve gagnée → Île de Lumière', !!won);
ok('zone 1 débloquée', S.self?.unlocked?.includes(1) || S.zone?.unlocked?.includes(1));

// l'obélisque doit maintenant lister 2 zones
send({ t: 'interact', prop: 'obelisk', x: 77.5, z: 72.5 });
await waitFor(() => S.obelisk, 15000);
ok('obélisque : 2 zones', S.obelisk?.zones?.length === 2);

// monstre scalé en zone 1 ?
const mob = await waitFor(() => {
  for (const [, e] of S.pos) if (e.kind === 1 && e.level >= 26) return e;
  return null;
}, 8000);
ok('monstres niveau 26+ en zone 1', !!mob);

const failed = checks.filter(([, c]) => !c);
console.log(failed.length === 0 ? '\nTOUT EST OK' : `\n${failed.length} ÉCHEC(S)`);
process.exit(failed.length === 0 ? 0 : 1);
