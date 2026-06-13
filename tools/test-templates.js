// Validation des templates de l'éditeur de carte (outillage d'édition) :
// aller-retour serveur via l'API admin — PUT d'une liste, GET qui la restitue,
// structure normalisée (id/name/w/h/tiles/props), rejet des entrées invalides.
// À lancer sur une base FRAÎCHE. Usage : node tools/test-templates.js [url]
import WebSocket from 'ws';
import { PROTOCOL_VERSION } from '../shared/constants.js';

const BASE = process.argv[2] || 'http://localhost:8090';
const checks = [];
const ok = (name, cond) => { checks.push([name, !!cond]); console.log(cond ? '  ✔' : '  ✘', name); };

// --- inscription d'un compte admin (1er compte d'une base fraîche = admin) ---
const NAME = 'AdminTpl_' + Math.floor(Math.random() * 1e6);
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
  ws.on('error', reject);
  setTimeout(() => reject(new Error('timeout inscription')), 8000);
});

const login = await (await fetch(`${BASE}/api/admin/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: NAME, pass: 'test1234' }),
})).json();
ok('connexion admin (1er compte de la base)', !!login.token);

const api = async (url, method = 'GET', body = null) => {
  const r = await fetch(BASE + url, {
    method,
    headers: { Authorization: `Bearer ${login.token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : null,
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || r.status);
  return j;
};

// état initial (pour restauration : ne pas polluer content/templates.json)
const before = await api('/api/admin/templates');
ok('GET initial : { templates: [...] }', Array.isArray(before.templates));

// --- aller-retour : PUT d'une liste valide + 2 entrées à rejeter ---
const sent = {
  templates: [
    {
      id: 'tour', name: 'Tour de garde', w: 3, h: 4,
      tiles: [[0, 0, 3], [1, 0, 3], [2, 0, 3], [0, 1, 5]],
      props: [
        { type: 'tree', dx: 1, dz: 1, v: 7, s: 1.8, rot: Math.PI },
        { type: 'wall', dx: 2, dz: 2, v: 'corner' },
      ],
    },
    { name: 'Sans id', w: 2, h: 2, tiles: [[0, 0, 1]], props: [] }, // id généré
    { name: '', w: 1, h: 1, tiles: [[0, 0, 1]], props: [] },        // sans nom -> rejeté
    { name: 'Vide', w: 1, h: 1, tiles: [], props: [] },             // assemblage vide -> rejeté
  ],
};
const putRes = await api('/api/admin/templates', 'PUT', sent);
ok('PUT : 2 templates valides conservés, 2 invalides rejetés', putRes.count === 2);

const got = await api('/api/admin/templates');
ok('GET restitue les templates persistés', got.templates.length === 2);
const tour = got.templates.find(t => t.name === 'Tour de garde');
ok('structure : nom, dimensions et tuiles conservés',
  tour && tour.id === 'tour' && tour.w === 3 && tour.h === 4 && tour.tiles.length === 4);
ok('structure : props relatifs avec variante/échelle/rotation',
  tour && tour.props.length === 2
  && tour.props[0].type === 'tree' && tour.props[0].dx === 1 && tour.props[0].v === 7
  && tour.props[0].s === 1.8 && tour.props[0].rot === Math.PI
  && tour.props[1].v === 'corner');
const auto = got.templates.find(t => t.name === 'Sans id');
ok('normalisation : id généré pour une entrée sans id', auto && typeof auto.id === 'string' && auto.id.length > 0);
ok('rejet : entrée sans nom absente', !got.templates.some(t => t.name === ''));
ok('rejet : assemblage vide absent', !got.templates.some(t => t.name === 'Vide'));

// --- restauration de l'état initial (base propre) ---
await api('/api/admin/templates', 'PUT', { templates: before.templates });
const restored = await api('/api/admin/templates');
ok('restauration : la liste retrouve son état initial',
  JSON.stringify(restored.templates) === JSON.stringify(before.templates));

const bad = checks.filter(([, c]) => !c).length;
console.log(bad ? `\n${bad} ÉCHEC(S)` : '\nTOUT EST OK');
process.exit(bad ? 1 : 0);
