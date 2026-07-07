// Test d'intégration des canaux de discussion personnalisés : création
// (public/privé), routage aux abonnés, invitation sur un privé, quitter,
// persistance des abonnements à la reconnexion, noms réservés, liste.
// À lancer sur une base FRAÎCHE. Usage : node tools/test-canaux.js [urlHttp]
import WebSocket from 'ws';
import { PROTOCOL_VERSION } from '../shared/constants.js';

const BASE = process.argv[2] || 'http://localhost:8090';
const checks = [];
const ok = (name, cond) => { checks.push([name, !!cond]); console.log(cond ? '  ✔' : '  ✘', name); };

function connect(name, mode = 'register') {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(BASE.replace('http', 'ws'));
    const c = { ws, name, inbox: [] };
    ws.on('message', (raw, bin) => { if (!bin) c.inbox.push(JSON.parse(raw.toString())); });
    ws.on('open', () => ws.send(JSON.stringify({ t: mode, v: PROTOCOL_VERSION, name, pass: 'test1234' })));
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
const chat = async (c, text) => { await pause(); send(c, { t: 'chat', text }); };

const fond = await connect('Fondateur' + (Math.random() * 1e6 | 0));
const pass = await connect('Passant' + (Math.random() * 1e6 | 0));

// ---- 1. création publique, refus des réservés ----
await chat(fond, '.canal creer taverne');
ok('création d\u2019un canal public', !!(await waitText(fond, /Canal public \/taverne fondé/)));
await chat(fond, '.canal creer general');
ok('nom réservé refusé', !!(await waitText(fond, /existe déjà/)));

// ---- 2. parler sans avoir rejoint -> refus ; rejoindre -> routage ----
pass.inbox.length = 0;
await chat(pass, '/taverne on sert quoi ici ?');
ok('parler sans abonnement : renvoi vers .canal rejoindre', !!(await waitText(pass, /Rejoins d\u2019abord/)));
await chat(pass, '.canal rejoindre taverne');
ok('rejoindre un canal public', !!(await waitText(pass, /Te voilà sur \/taverne/)));
pass.inbox.length = 0;
await chat(fond, '/taverne bienvenue, étranger');
const msg = await wait(pass, m => m.t === 'chat' && m.channel === 'taverne');
ok('message routé aux abonnés du canal', !!msg && /bienvenue/.test(msg.text));

// ---- 3. canal privé : refus, invitation, routage aux seuls membres ----
await chat(fond, '.canal creer conclave prive');
ok('création d\u2019un canal privé', !!(await waitText(fond, /Canal privé \/conclave fondé/)));
await chat(pass, '.canal rejoindre conclave');
ok('rejoindre un privé sans invitation : refusé', !!(await waitText(pass, /privé — seul/)));
await chat(fond, `.canal inviter ${pass.name} conclave`);
ok('invitation : le convive est prévenu', !!(await waitText(pass, /t\u2019ouvre les portes du canal privé \/conclave/)));
pass.inbox.length = 0;
await chat(fond, '/conclave le mot de passe est raton');
const priv = await wait(pass, m => m.t === 'chat' && m.channel === 'conclave');
ok('message privé routé au membre invité', !!priv && /raton/.test(priv.text));

// ---- 4. quitter : plus rien ne passe ----
await chat(pass, '.canal quitter taverne');
await waitText(pass, /Tu quittes \/taverne/);
pass.inbox.length = 0;
await chat(fond, '/taverne il reste quelqu\u2019un ?');
await pause(800);
ok('après .canal quitter : plus aucun message du canal',
  !pass.inbox.some(m => m.t === 'chat' && m.channel === 'taverne'));

// ---- 5. persistance : reconnexion -> conclave toujours là, messages reçus ----
pass.ws.close();
await pause(600);
const pass2 = await connect(pass.name, 'login');
const chans = await wait(pass2, m => m.t === 'channels');
ok('reconnexion : l\u2019abonnement au privé a survécu',
  !!chans && chans.list.some(c => c.name === 'conclave' && c.joined && c.private));
pass2.inbox.length = 0;
await chat(fond, '/conclave toujours là ?');
ok('le privé fonctionne après reconnexion',
  !!(await wait(pass2, m => m.t === 'chat' && m.channel === 'conclave')));

// ---- 6. liste ----
pass2.inbox.length = 0;
await chat(pass2, '.canal liste');
ok('.canal liste : publics et privés accessibles',
  !!(await waitText(pass2, /\/taverne.*🔒\/conclave|🔒\/conclave.*\/taverne/)));

fond.ws.close(); pass2.ws.close();
const failed = checks.filter(([, c]) => !c);
console.log(failed.length ? `\n${failed.length} ÉCHEC(S)` : '\nTOUT EST OK');
process.exit(failed.length ? 1 : 0);
