// Test d'intégration des commandes joueur « . » (mode expert) : réponses
// privées, jamais diffusées, hors anti-spam. Couvre .pos, .zone, .xpstat
// (gain réel via la récompense de quête d'Aldric), .xpreset, .boss, .qui,
// .pantheon (vide), et l'inconnue.
// À lancer sur une base FRAÎCHE (1er compte = super admin pour goto).
// Usage : node tools/test-commandes.js [urlHttp=http://localhost:8090]
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
      if (c.inbox.some(m => m.t === 'welcome')) { clearInterval(iv); resolve(c); }
    }, 50);
    setTimeout(() => reject(new Error('timeout ' + name)), 8000);
  });
}
const send = (c, m) => c.ws.send(JSON.stringify(m));
const pause = (ms = 950) => new Promise(r => setTimeout(r, ms));
const texts = (m) => m.t === 'events' ? (m.list || []).map(e => e.text || '') : [m.text || ''];
const wait = (c, re, ms = 2000) => new Promise(res => {
  const t0 = Date.now();
  const iv = setInterval(() => {
    const hit = c.inbox.some(m => texts(m).some(t => re.test(t)));
    if (hit || Date.now() - t0 > ms) { clearInterval(iv); res(hit); }
  }, 40);
});
const cmd = async (c, text) => { c.inbox.length = 0; send(c, { t: 'chat', text }); };

const a = await connect('Expert' + (Math.random() * 1e6 | 0));
const b = await connect('Temoin' + (Math.random() * 1e6 | 0)); // à portée (même spawn)

// ---- .pos / .zone ----
await cmd(a, '.pos');
ok('.pos : coordonnées et lieu', await wait(a, /Position : \d+\.\d : \d+\.\d — Arakas/));
await cmd(a, '.zone');
ok('.zone : nom et tranche de niveaux', await wait(a, /Arakas — niveaux 1 à \d+/));

// ---- privé et hors diffusion : le témoin n'entend RIEN ----
ok('commandes jamais diffusées aux joueurs proches',
  !b.inbox.some(m => texts(m).some(t => /Position :/.test(t))));

// ---- hors anti-spam : deux commandes coup sur coup passent ----
await cmd(a, '.pos');
const fast = await wait(a, /Position :/, 800);
ok('hors anti-spam (enchaînement immédiat)', fast);

// ---- .xpstat : zéro, puis gain réel via la quête d'Aldric ----
await cmd(a, '.xpstat');
ok('.xpstat : session vierge (0 XP)', await wait(a, /\+0 XP en \d+ min — 0 XP\/h/));
send(a, { t: 'admin', cmd: 'goto', x: 326, z: 242 });
await pause(400);
await pause(); a.inbox.length = 0; send(a, { t: 'chat', text: 'du travail ?' }); // +50 xp (mq1)
await wait(a, /Cathbad/);
await cmd(a, '.xpstat');
ok('.xpstat : le gain de la session est compté', await wait(a, /\+50 XP en .* — \d+ XP\/h/));

// ---- .xpreset ----
await cmd(a, '.xpreset');
ok('.xpreset : confirmation', await wait(a, /remis à zéro/));
await cmd(a, '.xpstat');
ok('.xpstat : repart de zéro après reset', await wait(a, /\+0 XP/));

// ---- .boss : Gro'Mak debout (base fraîche) ----
await cmd(a, '.boss');
ok('.boss : le rendez-vous de la zone', await wait(a, /Gro'Mak.*se dresse/));

// ---- .qui : les deux âmes en ligne ----
await cmd(a, '.qui');
ok('.qui : liste les aventuriers', await wait(a, /2 aventuriers en ligne : .*Expert.*Temoin|2 aventuriers en ligne : .*Temoin.*Expert/));

// ---- .pantheon vide + commande inconnue ----
await cmd(a, '.pantheon');
ok('.pantheon : vide sur base fraîche', await wait(a, /Panthéon est vide/));
await cmd(a, '.abracadabra');
ok('commande inconnue : renvoi vers .aide', await wait(a, /\.abracadabra inconnue.*\.aide/));

a.ws.close(); b.ws.close();
const failed = checks.filter(([, c]) => !c);
console.log(failed.length ? `\n${failed.length} ÉCHEC(S)` : '\nTOUT EST OK');
process.exit(failed.length ? 1 : 0);
