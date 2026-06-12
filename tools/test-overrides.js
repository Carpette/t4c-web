// Validation des overrides de carte (éditeur admin) :
// 1. applyOverrides — rétrocompatibilité de l'ancien format {type, x, z} ;
// 2. format étendu {type, x, z, v, s, rot} : variante, échelle bornée, miroir ;
// 3. habillage (buildDecor/decormap) : la variante explicite donne la bonne tuile ;
// 4. aller-retour serveur : PUT puis GET via l'API admin (1er compte = admin).
// À lancer sur une base FRAÎCHE. Usage : node tools/test-overrides.js [url]
import WebSocket from 'ws';
import { generateWorld, TILE } from '../shared/worldgen.js';
import { applyOverrides } from '../shared/overrides.js';
import { buildDecor } from '../client/js/render2d/decor.js';
import { TREE_IDS, DEAD_TREE_IDS, WALL_IDS } from '../client/js/render2d/decormap.js';
import { PROTOCOL_VERSION } from '../shared/constants.js';

const BASE = process.argv[2] || 'http://localhost:8090';
const checks = [];
const ok = (name, cond) => { checks.push([name, !!cond]); console.log(cond ? '  ✔' : '  ✘', name); };
const clone = (w) => structuredClone({ size: w.size, tile: w.tile, walk: w.walk, props: w.props, height: w.height, kind: w.kind });

const base = generateWorld(424242);
const N = base.size;
const idx = (x, z) => z * N + x;

// --- 1. ancien format : rétrocompatibilité totale ---
{
  const aTree = base.props.find(p => p.type === 'tree');
  const tx = Math.floor(aTree.x), tz = Math.floor(aTree.z);
  const w = applyOverrides(clone(base), {
    tiles: [[10, 10, TILE.WATER], [11, 10, TILE.GRASS]],
    props: { add: [{ type: 'rock', x: 12, z: 12 }], remove: [[tx, tz]] },
  });
  ok('ancien format : tuile repeinte (eau) et praticabilité bloquée',
    w.tile[idx(10, 10)] === TILE.WATER && w.walk[idx(10, 10)] === 0);
  ok('ancien format : tuile repeinte (herbe) praticable',
    w.tile[idx(11, 10)] === TILE.GRASS && w.walk[idx(11, 10)] === 1);
  const added = w.props.find(p => p.type === 'rock' && p.x === 12.5 && p.z === 12.5);
  ok('ancien format : décor ajouté avec défauts (rot 0, s 1, pas de variante)',
    added && added.rot === 0 && added.s === 1 && added.v === undefined);
  ok('ancien format : décor de base supprimé et case praticable',
    !w.props.some(p => p.type === 'tree' && Math.floor(p.x) === tx && Math.floor(p.z) === tz)
    && w.walk[idx(tx, tz)] === 1);
}

// --- 2. format étendu : variante, échelle bornée, rotation/miroir ---
{
  const w = applyOverrides(clone(base), {
    tiles: [],
    props: {
      add: [
        { type: 'tree', x: 20, z: 20, v: 7, s: 1.8, rot: Math.PI }, // arbre mort 3, ×1.8, miroir
        { type: 'tree', x: 24, z: 20, s: 99 },                      // échelle hors borne
        { type: 'wall', x: 26, z: 20, v: 'corner' },                // variante nommée
      ],
      remove: [],
    },
  });
  const t1 = w.props.find(p => p.x === 20.5 && p.z === 20.5);
  ok('étendu : v/s/rot conservés sur le prop', t1 && t1.v === 7 && t1.s === 1.8 && t1.rot === Math.PI);
  const t2 = w.props.find(p => p.x === 24.5 && p.z === 20.5);
  ok('étendu : échelle bornée à 3', t2 && t2.s === 3);
  const t3 = w.props.find(p => p.x === 26.5 && p.z === 20.5);
  ok('étendu : variante nommée conservée (wall corner)', t3 && t3.v === 'corner');

  // --- 3. habillage : la variante explicite donne la bonne tuile Flare ---
  const decor = buildDecor(w);
  const s1 = decor.props.find(p => p.x === 20.5 && p.z === 20.5);
  ok('décor : arbre v=7 -> tuile arbre mort 3, miroir et échelle honorés',
    s1 && s1.tileId === DEAD_TREE_IDS[7 - TREE_IDS.length] && s1.flip === true && s1.s === 1.8);
  const s3 = decor.props.find(p => p.x === 26.5 && p.z === 20.5);
  ok('décor : wall corner -> tuile angle de palissade', s3 && s3.tileId === WALL_IDS.corner);
}

// --- 4. aller-retour serveur : PUT puis GET via l'API admin ---
const NAME = 'AdminOv_' + Math.floor(Math.random() * 1e6);
await new Promise((resolve, reject) => {
  // 1er compte d'une base fraîche = admin ; il faut un personnage pour finir l'inscription
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

{
  const ZONE = 0;
  const before = await api(`/api/admin/overrides/${ZONE}`); // pour restauration
  const sent = {
    tiles: [[30, 31, TILE.COBBLE]],
    props: {
      add: [{ type: 'tree', x: 33, z: 34, v: 2, s: 1.4, rot: Math.PI }, { type: 'fence', x: 35, z: 34, v: 'z' }],
      remove: [[36, 37]],
    },
  };
  await api(`/api/admin/overrides/${ZONE}`, 'PUT', sent);
  const got = await api(`/api/admin/overrides/${ZONE}`);
  ok('aller-retour serveur : PUT puis GET restitue les overrides étendus',
    JSON.stringify(got) === JSON.stringify(sent));
  // le monde de la zone est reconstruit à chaud avec l'override appliqué
  await api(`/api/admin/overrides/${ZONE}`, 'PUT', before); // restaure l'état initial
  const restored = await api(`/api/admin/overrides/${ZONE}`);
  ok('restauration : la zone retrouve ses overrides initiaux',
    JSON.stringify(restored) === JSON.stringify(before));
}

const bad = checks.filter(([, c]) => !c).length;
console.log(bad ? `\n${bad} ÉCHEC(S)` : '\nTOUT EST OK');
process.exit(bad ? 1 : 0);
