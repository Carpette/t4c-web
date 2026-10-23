// Test d'intégration des effets visuels de sorts : bibliothèque de particules
// servie au client, sorts habillés (fx) publiés, et diffusion de l'id de
// preset dans l'événement de lancer (proj) reçu par un client en jeu.
// À lancer sur une base FRAÎCHE (1er compte = admin), serveur lancé à part.
// Usage : node tools/test-fx.js [urlHttp=http://localhost:8090]
import WebSocket from 'ws';
import { PROTOCOL_VERSION } from '../shared/constants.js';

const BASE = process.argv[2] || 'http://localhost:8090';
const checks = [];
const ok = (name, cond) => { checks.push([name, !!cond]); console.log(cond ? '  ✔' : '  ✘', name); };

// ---- 1. la bibliothèque de particules est servie, ids uniques ----
const lib = await (await fetch(`${BASE}/content/particles.json`)).json();
const ids = (lib.particles || []).map(p => p.id);
ok('bibliothèque de particules servie (60+ presets)', ids.length >= 60);
ok('ids de presets uniques', new Set(ids).size === ids.length);
ok('familles présentes (proj_/imp_/sol_/event_)',
  ['proj_feu', 'imp_glace', 'sol_geyser', 'event_levelup'].every(id => ids.includes(id)));

// ---- 2. les sorts habillés publient leurs fx, et ils existent ----
const spells = (await (await fetch(`${BASE}/content/spells.json`)).json()).spells;
const habilles = spells.filter(s => s.fx);
ok('des sorts sont habillés (fx)', habilles.length >= 10);
const idset = new Set(ids);
ok('tous les fx assignés pointent vers des presets existants',
  habilles.every(s => Object.values(s.fx).every(id => idset.has(id))));
const dard = spells.find(s => s.id === 'dard_de_feu');
ok('dard_de_feu : traînée + impact', dard?.fx?.trail === 'proj_feu' && dard?.fx?.impact === 'imp_feu');

// ---- 3. aller-retour éditeur : la sauvegarde admin préserve les fx ----
// (chemin exact du Spells Editor : login admin puis POST /api/admin/content/spells)
const NAME = 'Fx_' + Math.floor(Math.random() * 1e6);
await new Promise((resolve, reject) => {
  const ws = new WebSocket(BASE.replace('http', 'ws'));
  ws.on('open', () => ws.send(JSON.stringify({ t: 'register', v: PROTOCOL_VERSION, name: NAME, pass: 'test1234' })));
  ws.on('message', (raw, bin) => {
    if (bin) return;
    const m = JSON.parse(raw.toString());
    if (m.t === 'create_char') ws.send(JSON.stringify({ t: 'create', stats: { str: 22, end: 18, agi: 14, int: 8, wis: 8 } }));
    if (m.t === 'welcome') { ws.close(); resolve(); }
    if (m.t === 'auth_error') reject(new Error(m.error));
  });
  setTimeout(() => reject(new Error('timeout création compte')), 8000);
});
const login = await (await fetch(`${BASE}/api/admin/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: NAME, pass: 'test1234' }),
})).json();
ok('login admin', !!login.token);
const H = { Authorization: `Bearer ${login.token}`, 'Content-Type': 'application/json' };
const api = (url, method = 'GET', body = null) =>
  fetch(BASE + url, { method, headers: H, body: body ? JSON.stringify(body) : null }).then(r => r.json());
const raw = await api('/api/admin/content/spells');
const r = await api('/api/admin/content/spells', 'POST', raw);
ok('sauvegarde admin des sorts acceptée', r.ok);
const relu = (await (await fetch(`${BASE}/content/spells.json`)).json()).spells.find(s => s.id === 'dard_de_feu');
ok('fx préservés après un aller-retour éditeur', relu?.fx?.trail === 'proj_feu' && relu?.fx?.impact === 'imp_feu');

// ---- 4. auras : un sort de bouclier montre son effet persistant aux voisins ----
// (fx.aura de bouclier_de_glace : bulle tant que l'effet dure ; diffusée par
// un événement `aura`, puis dans la fiche `meta` pour qui arrive après)
ok('bouclier_de_glace porte une aura existante', idset.has(spells.find(s => s.id === 'bouclier_de_glace')?.fx?.aura));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function connecter(nom, type) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(BASE.replace('http', 'ws'));
    const c = { ws, id: null, auras: [], metas: new Map(), send: (o) => ws.send(JSON.stringify(o)) };
    ws.on('open', () => c.send({ t: type, v: PROTOCOL_VERSION, name: nom, pass: 'test1234' }));
    ws.on('message', (raw, bin) => {
      if (bin) return;
      const m = JSON.parse(raw.toString());
      if (m.t === 'create_char') c.send({ t: 'create', stats: { str: 22, end: 18, agi: 14, int: 8, wis: 8 } });
      if (m.t === 'welcome') { c.id = m.id; resolve(c); }
      if (m.t === 'meta') for (const e of m.list) c.metas.set(e.id, e);
      if (m.t === 'events') for (const ev of m.list) if (ev.t === 'aura') c.auras.push(ev);
      if (m.t === 'auth_error') reject(new Error(m.error));
    });
    setTimeout(() => reject(new Error('timeout connexion ' + nom)), 8000);
  });
}
const mage = await connecter(NAME, 'login');
const voisin = await connecter('Vu_' + Math.floor(Math.random() * 1e6), 'register');
// le voisin rejoint le mage (même zone de départ, puis téléportation admin du mage sur lui)
await sleep(600);
mage.send({ t: 'admin', cmd: 'stats', wis: 40, int: 40 });
mage.send({ t: 'admin', cmd: 'set', level: 30 });
mage.send({ t: 'admin', cmd: 'learn', spell: 'bouclier_de_glace' });
await sleep(500);
mage.send({ t: 'cast', spellId: 'bouclier_de_glace', target: mage.id });
const attendre = async (fn, ms = 6000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(100); } return null; };
const ev = await attendre(() => voisin.auras.find(a => a.id === mage.id && a.list.some(([fx]) => fx === 'aura_bulle_glace')));
ok('le voisin reçoit l\'aura du bouclier (événement aura)', !!ev);
ok('l\'aura dure le temps de l\'effet (≈ 300 s)', ev && ev.list[0][1] > 290000 && ev.list[0][1] <= 300000);
// un joueur qui arrive après le lancer la reçoit avec la fiche du mage
const tardif = await connecter('Ta_' + Math.floor(Math.random() * 1e6), 'register');
const meta = await attendre(() => tardif.metas.get(mage.id));
ok('un arrivant voit l\'aura dans la fiche du mage (meta)', meta?.auras?.some(([fx]) => fx === 'aura_bulle_glace'));
for (const c of [mage, voisin, tardif]) c.ws.close();

const failed = checks.filter(([, c]) => !c);
console.log(failed.length ? `\n${failed.length} ÉCHEC(S)` : '\nTOUT EST OK');
process.exit(failed.length ? 1 : 0);
