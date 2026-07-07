// Test d'intégration du groupe (deux joueurs) : invitation par nom, refus,
// acceptation (party_update des deux côtés), PV des membres (party_vitals),
// canal privé /g, commande .groupe, exclusion par le chef.
// À lancer sur une base FRAÎCHE. Usage : node tools/test-groupe.js [urlHttp]
import WebSocket from 'ws';
import { PROTOCOL_VERSION } from '../shared/constants.js';

const BASE = process.argv[2] || 'http://localhost:8090';
const checks = [];
const ok = (name, cond) => { checks.push([name, !!cond]); console.log(cond ? '  ✔' : '  ✘', name); };

function connect(name) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(BASE.replace('http', 'ws'));
    const c = { ws, name, inbox: [] };
    ws.on('message', (raw, bin) => { if (!bin) c.inbox.push(JSON.parse(raw.toString())); });
    ws.on('open', () => ws.send(JSON.stringify({ t: 'register', v: PROTOCOL_VERSION, name, pass: 'test1234' })));
    const iv = setInterval(() => {
      if (c.inbox.some(m => m.t === 'create_char')) ws.send(JSON.stringify({ t: 'create', stats: { str: 22, end: 18, agi: 14, int: 8, wis: 8 } }));
      const w = c.inbox.find(m => m.t === 'welcome');
      if (w) { clearInterval(iv); c.id = w.id; resolve(c); }
    }, 50);
    setTimeout(() => reject(new Error('timeout ' + name)), 8000);
  });
}
const send = (c, m) => c.ws.send(JSON.stringify(m));
const pause = (ms = 950) => new Promise(r => setTimeout(r, ms));
const texts = (m) => m.t === 'events' ? (m.list || []).map(e => e.text || '') : [m.text || ''];
const wait = (c, pred, ms = 2500) => new Promise(res => {
  const t0 = Date.now();
  const iv = setInterval(() => {
    const m = c.inbox.find(pred);
    if (m || Date.now() - t0 > ms) { clearInterval(iv); res(m || null); }
  }, 40);
});
const waitText = (c, re, ms = 2500) => wait(c, m => texts(m).some(t => re.test(t)), ms);

const chef = await connect('Chef' + (Math.random() * 1e6 | 0));
const rec = await connect('Recrue' + (Math.random() * 1e6 | 0));

// ---- 1. invitation par nom, refus, ré-invitation, acceptation ----
send(chef, { t: 'party_invite', name: rec.name });
const inv = await wait(rec, m => m.t === 'party_invite');
ok('invitation reçue (nom de l\u2019inviteur)', !!inv && inv.from === chef.name);
send(rec, { t: 'party_decline' });
ok('refus notifié à l\u2019inviteur', !!(await waitText(chef, /décline votre invitation/)));

send(chef, { t: 'party_invite', name: rec.name });
await wait(rec, m => m.t === 'party_invite' && rec.inbox.filter(x => x.t === 'party_invite').length >= 2);
send(rec, { t: 'party_accept' });
const upChef = await wait(chef, m => m.t === 'party_update' && m.members.length === 2);
const upRec = await wait(rec, m => m.t === 'party_update' && m.members.length === 2);
ok('party_update des deux côtés (2 membres)', !!upChef && !!upRec);
ok('le chef est bien le chef', upChef && upChef.leaderId === chef.id);

// ---- 2. PV des membres diffusés périodiquement ----
rec.inbox.length = 0;
ok('party_vitals reçus (PV des membres)',
  !!(await wait(rec, m => m.t === 'party_vitals' && m.members.length === 2, 4000)));

// ---- 3. canal privé /g ----
rec.inbox.length = 0; chef.inbox.length = 0;
send(chef, { t: 'chat', text: '/g on se retrouve au pont' });
const gmsg = await wait(rec, m => m.t === 'chat' && m.channel === 'groupe');
ok('canal /g : message reçu par le membre', !!gmsg && /au pont/.test(gmsg.text));

// ---- 4. commande .groupe ----
await pause();
rec.inbox.length = 0;
send(rec, { t: 'chat', text: '.groupe' });
ok('.groupe : composition et PV', !!(await waitText(rec, /Groupe 2\/5.*👑.*PV.*\/g/)));

// ---- 5. exclusion par le chef -> la recrue quitte le groupe ----
send(chef, { t: 'party_kick', id: rec.id });
const gone = await wait(rec, m => m.t === 'party_update' && m.members.length === 0, 3000);
ok('exclusion : la recrue voit son groupe vidé', !!gone);
await pause();
rec.inbox.length = 0;
send(rec, { t: 'chat', text: '/g coucou ?' });
ok('canal /g refusé hors groupe', !!(await waitText(rec, /pas de groupe/i)));

chef.ws.close(); rec.ws.close();
const failed = checks.filter(([, c]) => !c);
console.log(failed.length ? `\n${failed.length} ÉCHEC(S)` : '\nTOUT EST OK');
process.exit(failed.length ? 1 : 0);
