// Base graphique des décors : correspondance type/variante de prop -> tuile(s) Flare.
// Module PARTAGÉ entre le rendu joueur (decor.js) et l'éditeur de carte admin
// (palette d'aperçus, rendu fidèle) : une seule source de vérité du mapping.
// Aucune dépendance au DOM : utilisable aussi dans les tests Node.
import { TILE } from '../../../shared/worldgen.js';

// --- tuiles de sol par type de terrain (variante choisie par hachage de la case) ---
export const GRASS_IDS = [16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31];
export const FOREST_IDS = [20, 21, 24, 25, 28, 29];
export const COBBLE_IDS = [32, 33, 34, 35, 36, 37, 38];
export const PATH_IDS = [39, 40, 41, 42, 43, 44];
export const DIRT_IDS = [45, 46, 47];
export const ROCKY_IDS = [34, 37, 38];
export const WATER_IDS = [176, 177, 178, 179, 180, 181, 182, 183, 184, 185, 186, 187, 188, 189, 190, 191];

export const FLOOR_IDS = {
  [TILE.WATER]: WATER_IDS,
  [TILE.SAND]: DIRT_IDS,
  [TILE.GRASS]: GRASS_IDS,
  [TILE.FOREST]: FOREST_IDS,
  [TILE.ROCK]: ROCKY_IDS,
  [TILE.COBBLE]: COBBLE_IDS,
  [TILE.PATH]: PATH_IDS,
  [TILE.GRAVE]: DIRT_IDS,
};

// --- décors ---
export const TUFT_IDS = [114, 115, 122, 123, 124, 125, 126, 127];
export const FERN_IDS = [112, 113, 116, 117, 120, 121];
export const TREE_IDS = [240, 241, 242, 243, 244];
export const DEAD_TREE_IDS = [250, 251, 252, 253, 254];
export const GRAVE_IDS = [140, 141, 142, 143];
export const ROCKPROP_IDS = [136, 100, 101, 128];
export const CLIFF_IDS = [48, 52, 56];
export const RUIN_IDS = [217, 219, 224, 225, 227, 228, 230, 231];
export const CAMPFIRE_ID = 102;
export const HOUSE_ID = 296;
export const WELL_ID = 264; // dalle de pierre circulaire au centre du village
export const GATE_ID = 265;
export const CHEST_ID = 298;
export const BANK_ID = 300;
export const OBELISK_ID = 143;
export const WALL_IDS = { seg1: 208, seg2: 215, corner: 214, gate: 212 };

// --- Bâtiments & murs modulaires du tileset grassland (frames NUMÉRIQUES) ---
// Le tileset grassland recèle bien plus de structures que ce qu'expose la palette
// de base : façades de planches, parois, segments de remparts, pans de toiture,
// plateforme de bois... On les EXPOSE comme variantes des familles « maison » et
// « mur » (libellés explicites) SANS toucher aux variantes historiques (les
// premières restent en tête, donc les cartes déjà éditées sont inchangées).
// Ids relevés visuellement sur tileset_grassland.png (cf. tools/preview).
export const HOUSE_FLARE_IDS = [
  { v: 'cabane_a', id: 224, label: 'cabane / façade planches 1' },
  { v: 'cabane_b', id: 227, label: 'cabane / façade planches 2' },
  { v: 'cabane_c', id: 228, label: 'cabane / façade planches 3' },
  { v: 'cabane_d', id: 231, label: 'cabane / façade planches 4' },
  { v: 'beffroi', id: 219, label: 'beffroi / tour de bois' },
];
export const WALL_FLARE_IDS = [
  { v: 'planche_a', id: 209, label: 'mur de planches haut' },
  { v: 'planche_b', id: 235, label: 'mur de planches large' },
  { v: 'poutre', id: 216, label: 'poutre verticale' },
  { v: 'montant', id: 222, label: 'montant fin' },
  { v: 'toit_petit', id: 232, label: 'pan de toit (petit)' },
  { v: 'toit_moyen', id: 233, label: 'pan de toit (moyen)' },
  { v: 'toit_grand', id: 234, label: 'pan de toit (grand)' },
  { v: 'toit_petit2', id: 238, label: 'pan de toit miroir (petit)' },
  { v: 'toit_moyen2', id: 237, label: 'pan de toit miroir (moyen)' },
  { v: 'toit_grand2', id: 236, label: 'pan de toit miroir (grand)' },
];
export const FENCE_IDS = { x: 104, z: 107, corner: 108, post: 106 };
export const BRIDGE_IDS = { x: 312, z: 313 };

// --- Tuiles des tilesets Flare additionnels (cave, dungeon, ruins, neige) ---
// Posées comme des décors « libres » : un prop dont le type est le préfixe du
// tileset (flare_cave...) et la variante `v` le numéro de frame. L'id de tuile
// rendu est la chaîne « tileset:frame » résolue par le manifeste généralisé.
// Aucune dépendance au manifeste ici : la palette énumère les frames disponibles.
// [type de prop, préfixe d'id de tileset, libellé groupe, glyphe de repli]
export const TILESET_PROP_FAMILIES = [
  ['flare_cave', 'cave', 'Caverne (Flare)', ['◓', '#9a8']],
  ['flare_dungeon', 'dungeon', 'Donjon (Flare)', ['▤', '#aa8']],
  ['flare_ruins', 'ruins', 'Ruines (Flare)', ['⌂', '#cb9']],
  ['flare_snow', 'snow', 'Neige / Glace (Flare)', ['❄', '#cdf']],
];
// type de prop -> préfixe de tileset (pour propSprites)
export const TILESET_PROP_PREFIX = Object.fromEntries(
  TILESET_PROP_FAMILIES.map(([type, prefix]) => [type, prefix]),
);
// id de tuile rendu pour un prop de tileset Flare (type + frame `v`)
export function tilesetPropId(type, v) {
  const prefix = TILESET_PROP_PREFIX[type];
  return prefix != null && v != null ? `${prefix}:${v}` : null;
}

// --- Murs IA (assets PROPRES au projet, pas Flare) : un tileset par matériau ---
// Chaque matériau a son atlas PNG (manifest.tilesets["wall_<mat>"]) et 16 pièces
// (frames 0..15 : segments /, \, coins, T, croix, embouts, portes, pilier,
// créneaux, ruine). Posés comme des props « libres » exactement comme les tilesets
// Flare : le type de prop est `wall_<mat>` et la variante `v` le numéro de pièce ;
// l'id de tuile rendu est la chaîne « wall_<mat>:frame » résolue par le manifeste.
// Scalables ET flippables (cf. SCALABLE_PROPS / FLIPPABLE_PROPS plus bas).
// [clé de matériau (= suffixe de tileset), libellé affiché]
export const WALL_MATERIALS = [
  ['rondins', 'Rondins'],
  ['brique_rouge', 'Brique rouge'],
  ['colombage', 'Colombage'],
  ['terre', 'Terre'],
  ['planches', 'Planches'],
  ['pierre', 'Pierre médiévale'],
  ['brique_grise', 'Brique grise'],
];
export const WALL_PIECES = 16; // nombre de pièces par matériau (walls.json)
// type de prop d'un matériau de mur : « wall_rondins », « wall_pierre », etc.
// (le type EST déjà le nom du tileset : pas de table de préfixe séparée).
export const WALL_PROP_TYPES = WALL_MATERIALS.map(([mat]) => `wall_${mat}`);
const WALL_PROP_SET = new Set(WALL_PROP_TYPES);
// id de tuile rendu pour une pièce de mur (type `wall_<mat>` + frame `v`)
export function wallPropId(type, v) {
  return WALL_PROP_SET.has(type) && v != null ? `${type}:${v}` : null;
}

// --- Famille générique « frame grassland » (ids NUMÉRIQUES) ---
// Le tileset grassland (sol historique d'Arakas) est référencé par des ids
// NUMÉRIQUES directs dans manifest.tiles (≠ les ids texte « cave:42 »). Pour
// rendre TOUTES ses frames (maisons, cabanes, tentes, murs, remparts, props…)
// pickables individuellement dans la palette, on définit un type de prop
// dédié `flare_grass` dont la variante `v` EST le numéro de frame, et dont l'id
// de tuile rendu est ce même nombre. Le rendu (resolveTile) sait déjà dessiner
// un id numérique via manifest.tiles : aucune autre plomberie n'est requise.
export const GRASS_PROP_TYPE = 'flare_grass';
export const GRASS_PROP_LABEL = 'Plaines / Bâtiments (Flare)';
// id de tuile rendu pour un prop « frame grassland » : la frame elle-même.
export function grasslandPropId(v) {
  return Number.isInteger(v) ? v : null;
}

// Classement géométrique d'une frame grassland en TYPE de palette
// ('sol' | 'mur' | 'objet' | 'bati'). MÊME logique que build-manifest.js pour
// les tilesets additionnels, AVEC un type « bâtiment » distinct pour les très
// grandes structures (maisons/tours), afin de les regrouper à part dans la
// palette. Heuristique sur le rectangle source [x, y, w, h, …] (base iso 192×96).
//   sol  : h ≤ 100 ET w ≥ 160 (dalle de sol pleine posée à plat) ;
//   mur  : 100 < h ≤ 190 (parois, segments de rempart, pans de toiture bas) ;
//   bati : h > 280 ET w ≥ 150 (maisons, cabanes, tours, grosses structures) ;
//   objet: le reste (props isolés, mobilier, débris, arbres…).
const GRASS_H_SOL = 100, GRASS_H_MUR = 190, GRASS_W_SOL = 160;
const GRASS_H_BATI = 280, GRASS_W_BATI = 150;
export function classifyGrasslandFrame(rect) {
  const [, , w, h] = rect;
  if (h <= GRASS_H_SOL) return w >= GRASS_W_SOL ? 'sol' : 'objet';
  if (h <= GRASS_H_MUR) return 'mur';
  if (h > GRASS_H_BATI && w >= GRASS_W_BATI) return 'bati';
  return 'objet';
}

// hachage déterministe d'une case : variantes stables d'une génération à l'autre
export function hash(x, z) {
  let h = (x * 374761393 + z * 668265263) ^ 0x5bf03635;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967296;
}
export const pick = (arr, r) => arr[Math.floor(r * arr.length) % arr.length];

// --- Catalogue complet des types de props, avec leurs variantes EXPLICITES ---
// `v` est la valeur à stocker dans un override pour figer la variante
// (index numérique pour les types à variantes aléatoires, nom pour les autres).
// `random: true` = le type accepte aussi une variante aléatoire (v absent).
export const PROP_TYPES = {
  tree: {
    label: 'arbre', random: true,
    variants: [
      ...TREE_IDS.map((id, i) => ({ v: i, id, label: `arbre ${i + 1}` })),
      ...DEAD_TREE_IDS.map((id, i) => ({ v: TREE_IDS.length + i, id, label: `arbre mort ${i + 1}` })),
    ],
  },
  rock: { label: 'rocher', random: true, variants: ROCKPROP_IDS.map((id, i) => ({ v: i, id, label: `rocher ${i + 1}` })) },
  grave: { label: 'tombe', random: true, variants: GRAVE_IDS.map((id, i) => ({ v: i, id, label: `tombe ${i + 1}` })) },
  ruin: { label: 'ruine', random: true, variants: RUIN_IDS.map((id, i) => ({ v: i, id, label: `ruine ${i + 1}` })) },
  cave: { label: 'entrée de grotte', random: true, variants: CLIFF_IDS.map((id, i) => ({ v: i, id, label: `falaise ${i + 1}` })) },
  wall: {
    label: 'mur', random: true,
    variants: [
      // variantes HISTORIQUES de palissade (ids/`v` inchangés : rétrocompatibilité)
      { v: 'seg1', id: WALL_IDS.seg1, label: 'palissade — pan plein 1' },
      { v: 'seg2', id: WALL_IDS.seg2, label: 'palissade — pan plein 2' },
      { v: 'corner', id: WALL_IDS.corner, label: 'palissade — angle (toit)' },
      { v: 'gate', id: WALL_IDS.gate, label: 'palissade — montant de porte' },
      // nouvelles variantes : murs de planches, poutres et pans de toiture grassland
      ...WALL_FLARE_IDS,
    ],
  },
  fence: {
    label: 'barrière',
    variants: [
      { v: 'x', id: FENCE_IDS.x, label: 'barrière —' },
      { v: 'z', id: FENCE_IDS.z, label: 'barrière |' },
      { v: 'corner', id: FENCE_IDS.corner, label: 'angle' },
      { v: 'post', id: FENCE_IDS.post, label: 'poteau' },
    ],
  },
  bridge: {
    label: 'pont',
    variants: [
      { v: 'x', id: BRIDGE_IDS.x, label: 'pont —' },
      { v: 'z', id: BRIDGE_IDS.z, label: 'pont |' },
    ],
  },
  torch: { label: 'feu de camp', variants: [{ v: 0, id: CAMPFIRE_ID, label: 'feu de camp' }] },
  house: {
    label: 'maison',
    variants: [
      // variante HISTORIQUE (v:0, ancrage calibré) : rétrocompatibilité totale
      { v: 0, id: HOUSE_ID, label: 'grande maison' },
      // cabanes / façades / beffroi du tileset grassland (ancrage centré simple)
      ...HOUSE_FLARE_IDS,
    ],
  },
  well: { label: 'dalle centrale', variants: [{ v: 0, id: WELL_ID, label: 'dalle' }] },
  obelisk: { label: 'obélisque', variants: [{ v: 0, id: OBELISK_ID, label: 'obélisque' }] },
  trialgate: { label: "portail d'Épreuve", variants: [{ v: 0, id: GATE_ID, label: 'portail' }] },
  exitgate: { label: 'portail de sortie', variants: [{ v: 0, id: GATE_ID, label: 'portail' }] },
  chest: { label: 'coffre au trésor', variants: [{ v: 0, id: CHEST_ID, label: 'coffre' }] },
  bank: { label: 'banque', variants: [{ v: 0, id: BANK_ID, label: 'banque' }] },
};

// Props acceptant une échelle (s) et/ou un miroir horizontal (via rot) :
// uniquement les décors « organiques » dont l'ancrage reste correct une fois
// transformés. Les éléments qui s'emboîtent (murs, ponts...) ou dont l'ancrage
// est calibré (maison, portails) gardent leur taille d'origine.
const TILESET_PROP_TYPES = TILESET_PROP_FAMILIES.map(([type]) => type);
export const SCALABLE_PROPS = new Set(['tree', 'rock', 'grave', 'ruin', 'cave', 'torch', GRASS_PROP_TYPE, ...TILESET_PROP_TYPES, ...WALL_PROP_TYPES]);
export const FLIPPABLE_PROPS = new Set(['tree', 'rock', 'grave', 'ruin', GRASS_PROP_TYPE, ...TILESET_PROP_TYPES, ...WALL_PROP_TYPES]);

// échelle effective d'un prop (bornée, 1 pour les types non redimensionnables)
export function propScale(p) {
  if (!SCALABLE_PROPS.has(p.type) || !Number.isFinite(p.s)) return 1;
  return Math.min(3, Math.max(0.25, p.s));
}
// miroir horizontal : la rotation (les sprites Flare étant pré-rendus en iso,
// seule la symétrie a un sens) bascule le sprite quand elle « regarde » à gauche
export function propFlip(p) {
  return FLIPPABLE_PROPS.has(p.type) && Math.cos(p.rot || 0) < 0;
}

// id de tuile pour une variante explicite (index dans PROP_TYPES[type].variants)
function explicitId(type, v) {
  if (!Number.isInteger(v)) return null;
  return PROP_TYPES[type]?.variants[v]?.id ?? null;
}
// id de tuile pour une variante repérée par sa VALEUR `v` (nombre ou nom) :
// cherche dans PROP_TYPES[type].variants la variante dont `v` correspond.
// Sert aux familles à variantes nommées (maison, mur) enrichies de frames Flare.
function explicitNamedId(type, v) {
  if (v == null) return null;
  return PROP_TYPES[type]?.variants.find(va => va.v === v)?.id ?? null;
}

// Sprites + lumières produits par UN prop du worldgen (ou d'un override).
// `inCemetery` : les arbres plantés sur des tuiles de cimetière deviennent morts.
// Retour : { sprites: [{tileId, x, z, big?, interact?, name?}], lights: [...] }
export function propSprites(p, { inCemetery = false } = {}) {
  const sprites = [], lights = [];
  const r = hash(Math.floor(p.x * 7), Math.floor(p.z * 7));
  // décors issus des tilesets Flare additionnels (cave/dungeon/ruins/snow)
  if (TILESET_PROP_PREFIX[p.type]) {
    const id = tilesetPropId(p.type, p.v);
    if (id) sprites.push({ tileId: id, x: p.x, z: p.z });
    return { sprites, lights };
  }
  // pièce de mur IA (un tileset par matériau) : id « wall_<mat>:frame »
  if (WALL_PROP_SET.has(p.type)) {
    const id = wallPropId(p.type, p.v);
    if (id) sprites.push({ tileId: id, x: p.x, z: p.z });
    return { sprites, lights };
  }
  // frame grassland posée individuellement (id NUMÉRIQUE, cf. grasslandPropId)
  if (p.type === GRASS_PROP_TYPE) {
    const id = grasslandPropId(p.v);
    if (id != null) sprites.push({ tileId: id, x: p.x, z: p.z });
    return { sprites, lights };
  }
  switch (p.type) {
    case 'tree':
      sprites.push({ tileId: explicitId('tree', p.v) ?? pick(inCemetery ? DEAD_TREE_IDS : TREE_IDS, r), x: p.x, z: p.z });
      break;
    case 'rock':
      sprites.push({ tileId: explicitId('rock', p.v) ?? pick(ROCKPROP_IDS, r), x: p.x, z: p.z });
      break;
    case 'grave':
      sprites.push({ tileId: explicitId('grave', p.v) ?? pick(GRAVE_IDS, r), x: p.x, z: p.z });
      break;
    case 'torch':
      sprites.push({ tileId: CAMPFIRE_ID, x: p.x, z: p.z });
      lights.push({ x: p.x, z: p.z, r: 330, flicker: true });
      break;
    case 'house': {
      // v:0 (ou absent) = grande maison HISTORIQUE : ancrage calibré (la base
      // visuelle couvre l'empreinte 5×4 bloquée). Variantes Flare (v texte) :
      // cabanes/façades/beffroi, posées à l'ancrage simple de la case.
      const id = explicitNamedId('house', p.v);
      if (id != null && p.v !== 0) sprites.push({ tileId: id, x: p.x, z: p.z });
      else sprites.push({ tileId: HOUSE_ID, x: p.x - 1.5, z: p.z + 2.5, big: true });
      break;
    }
    case 'well':
      sprites.push({ tileId: WELL_ID, x: p.x, z: p.z });
      break;
    case 'obelisk':
      sprites.push({ tileId: OBELISK_ID, x: p.x, z: p.z, interact: 'obelisk' });
      lights.push({ x: p.x, z: p.z, r: 240, flicker: false, color: 'rgba(120, 160, 255, 0.14)' });
      break;
    case 'trialgate':
      sprites.push({ tileId: GATE_ID, x: p.x, z: p.z + 1, interact: 'trialgate' });
      lights.push({ x: p.x, z: p.z, r: 300, flicker: true, color: 'rgba(160, 120, 255, 0.16)' });
      break;
    case 'exitgate':
      sprites.push({ tileId: GATE_ID, x: p.x, z: p.z + 1, interact: 'exitgate' });
      lights.push({ x: p.x, z: p.z, r: 320, flicker: true, color: 'rgba(120, 200, 255, 0.18)' });
      break;
    case 'chest':
      sprites.push({ tileId: CHEST_ID, x: p.x, z: p.z, interact: 'chest' });
      break;
    case 'bank':
      // coffre clouté du tileset : la banque personnelle du village
      sprites.push({ tileId: BANK_ID, x: p.x, z: p.z, interact: 'bank' });
      lights.push({ x: p.x, z: p.z, r: 200, flicker: false, color: 'rgba(255, 200, 120, 0.10)' });
      break;
    case 'cave':
      // entrée de grotte : pan de falaise sombre (intérieurs instanciés)
      sprites.push({ tileId: explicitId('cave', p.v) ?? pick(CLIFF_IDS, r), x: p.x, z: p.z, interact: 'cave', name: p.name });
      break;
    case 'wall': {
      // palissade de bois (remparts de Windhowl) : pans pleins, angles coiffés
      // d'un toit, montants de porte ; + variantes Flare (planches, poutres, toits).
      // v explicite (nom de variante) sinon pan de palissade aléatoire (legacy 'seg').
      // On essaie d'abord WALL_IDS (rétrocompat des noms historiques), puis la
      // table des variantes (pour les nouvelles frames Flare comme 'planche_a').
      const id = WALL_IDS[p.v] ?? explicitNamedId('wall', p.v)
        ?? (hash(p.x * 3, p.z * 3) < 0.5 ? WALL_IDS.seg2 : WALL_IDS.seg1);
      sprites.push({ tileId: id, x: p.x, z: p.z });
      break;
    }
    case 'fence': {
      // barrières de bois (enclos de Darkfang, champs, pâtures)
      const id = FENCE_IDS[p.v] ?? FENCE_IDS.x;
      sprites.push({ tileId: id, x: p.x, z: p.z });
      break;
    }
    case 'ruin':
      // pan de mur effondré (Cité naine, Ruines Émergées...)
      sprites.push({ tileId: explicitId('ruin', p.v) ?? pick(RUIN_IDS, r), x: p.x, z: p.z });
      break;
    case 'bridge': {
      // pont de bois : tuile de planches pleine (312 : pont le long de x,
      // 313 : le long de z) + poteaux espacés côté eau
      const alongX = p.v === 'x' ? true : p.v === 'z' ? false
        : (p.rails?.n || p.rails?.s) && !(p.rails?.w || p.rails?.e) ? true
          : (p.rails?.w || p.rails?.e) && !(p.rails?.n || p.rails?.s) ? false : true;
      sprites.push({ tileId: alongX ? BRIDGE_IDS.x : BRIDGE_IDS.z, x: p.x, z: p.z });
      if ((Math.floor(p.x) + Math.floor(p.z)) % 2 === 0) {
        if (p.rails?.n) sprites.push({ tileId: FENCE_IDS.post, x: p.x + 0.3, z: p.z - 0.38 });
        if (p.rails?.s) sprites.push({ tileId: FENCE_IDS.post, x: p.x - 0.3, z: p.z + 0.38 });
        if (p.rails?.w) sprites.push({ tileId: FENCE_IDS.post, x: p.x - 0.38, z: p.z + 0.3 });
        if (p.rails?.e) sprites.push({ tileId: FENCE_IDS.post, x: p.x + 0.38, z: p.z - 0.3 });
      }
      break;
    }
  }
  return { sprites, lights };
}
