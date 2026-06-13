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
    label: 'palissade', random: true,
    variants: [
      { v: 'seg1', id: WALL_IDS.seg1, label: 'pan plein 1' },
      { v: 'seg2', id: WALL_IDS.seg2, label: 'pan plein 2' },
      { v: 'corner', id: WALL_IDS.corner, label: 'angle (toit)' },
      { v: 'gate', id: WALL_IDS.gate, label: 'montant de porte' },
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
  house: { label: 'maison', variants: [{ v: 0, id: HOUSE_ID, label: 'maison' }] },
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
export const SCALABLE_PROPS = new Set(['tree', 'rock', 'grave', 'ruin', 'cave', 'torch', ...TILESET_PROP_TYPES]);
export const FLIPPABLE_PROPS = new Set(['tree', 'rock', 'grave', 'ruin', ...TILESET_PROP_TYPES]);

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
    case 'house':
      // ancrage calibré : la base visuelle couvre l'empreinte bloquée
      sprites.push({ tileId: HOUSE_ID, x: p.x - 1.5, z: p.z + 2.5, big: true });
      break;
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
      // palissade de bois (remparts de Windhowl) : pans pleins, angles
      // coiffés d'un toit, montants de porte de part et d'autre des accès.
      // v explicite ('seg1'/'seg2'/'corner'/'gate') sinon pan aléatoire (legacy 'seg')
      const id = WALL_IDS[p.v] ?? (p.v === 'corner' ? WALL_IDS.corner : p.v === 'gate' ? WALL_IDS.gate
        : (hash(p.x * 3, p.z * 3) < 0.5 ? WALL_IDS.seg2 : WALL_IDS.seg1));
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
