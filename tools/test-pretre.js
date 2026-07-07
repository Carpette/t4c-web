// Test d'intégration des services du prêtre (Uranos, Arakas) : soins complets
// contre or, bénédiction temporaire, seuils de richesse, et grammaire de
// dialogue étendue (conditions.gold/consumeGold/notCursed, réactions
// heal/buff). La purification (cleanse) exige un joueur MAUDIT — aucune
// source de malédiction joueur-vers-joueur n'existe : on couvre ici son
// repli « non maudit », le chemin cleanse étant symétrique au heal.
// À lancer sur une base FRAÎCHE (1er compte = super admin, pour goto/set).
// Usage : node tools/test-pretre.js [urlHttp=http://localhost:8090]
import WebSocket from 'ws';
import { PROTOCOL_VERSION } from '../shared/constants.js';

const BASE = process.argv[2] || 'http://localhost:8090';
const checks = [];
const ok = (name, cond) => { checks.push([name, !!cond]); console.log(cond ? '  ✔' : '  ✘', name); };

const ws = new WebSocket(BASE.replace('http', 'ws'));
const inbox = [];
let gold = null;
ws.on('message', (raw, bin) => {
  if (bin) return;
  const m = JSON.parse(raw.toString());
  inbox.push(m);
  if (m.t === 'self' && m.gold != null) gold = m.gold;
});
const send = (m) => ws.send(JSON.stringify(m));
const pause = (ms = 950) => new Promise(r => setTimeout(r, ms));
const texts = (m) => m.t === 'events' ? (m.list || []).map(e => e.text || '') : [m.text || ''];
const wait = (re, ms = 2500) => new Promise(res => {
  const t0 = Date.now();
  const iv = setInterval(() => {
    const hit = inbox.some(m => texts(m).some(t => re.test(t)));
    if (hit || Date.now() - t0 > ms) { clearInterval(iv); res(hit); }
  }, 40);
});
const say = async (t) => { await pause(); inbox.length = 0; send({ t: 'chat', text: t }); };

ws.on('open', () => send({ t: 'register', v: PROTOCOL_VERSION, name: 'Pelerin' + (Math.random() * 1e6 | 0), pass: 'test1234' }));
await new Promise(res => { const iv = setInterval(() => {
  if (inbox.some(m => m.t === 'create_char')) send({ t: 'create', stats: { str: 22, end: 18, agi: 14, int: 8, wis: 8 } });
  if (inbox.some(m => m.t === 'welcome')) { clearInterval(iv); res(); }
}, 50); });

// devant Uranos (327,259 — près du puits sud)
send({ t: 'admin', cmd: 'goto', x: 327, z: 261 });
send({ t: 'admin', cmd: 'set', gold: 500 });
await pause(400);

// ---- 1. soins payés : -30 or, réplique, fx ----
const g0 = gold;
await say('je demande des soins');
ok('soins : réplique du prêtre', await wait(/referme tes plaies/));
ok('soins : 30 pièces prélevées', await wait(/-30 or/) || (gold === g0 - 30));
await pause(400);
ok('soins : solde exact après paiement', gold === 470);

// ---- 2. répétable : deuxième soin, deuxième paiement ----
await say('encore des soins');
ok('soins : service répétable (nouveau paiement)', await wait(/referme tes plaies/));
await pause(400);
ok('soins : solde 440 après le second', gold === 440);

// ---- 3. fauché : entrée payante inaccessible, repli tarifaire ----
send({ t: 'admin', cmd: 'set', gold: 5 });
await pause(300);
await say('des soins ?');
ok('soins : refus du fauché (tarif annoncé, rien prélevé)', await wait(/coûtent 30 pièces/));
await pause(300);
ok('soins : les 5 pièces sont intactes', gold === 5);

// ---- 4. bénédiction : paiement + buff appliqué (fx dédié) ----
send({ t: 'admin', cmd: 'set', gold: 500 });
await pause(300);
inbox.length = 0;
await say('une benediction, mon père');
ok('bénédiction : réplique et paiement', await wait(/durcit ta chair/) && await wait(/-150 or/));
ok('bénédiction : effet visuel sacré diffusé',
  inbox.some(m => m.t === 'events' && (m.list || []).some(e => e.t === 'fx' && e.fx?.self === 'bouclier_sacre')));

// ---- 5. purification : repli « non maudit » (aucun prélèvement) ----
await pause(400);
const g1 = gold;
await say('purification !');
ok('purification : repli quand aucune malédiction ne pèse', await wait(/Aucune malédiction/));
await pause(300);
ok('purification : rien prélevé sans malédiction', gold === g1);

ws.close();
const failed = checks.filter(([, c]) => !c);
console.log(failed.length ? `\n${failed.length} ÉCHEC(S)` : '\nTOUT EST OK');
process.exit(failed.length ? 1 : 0);
