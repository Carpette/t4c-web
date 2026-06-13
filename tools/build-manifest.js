// Génère client/assets/manifest.json depuis un clone de flare-game.
// Usage : FLARE_DIR=/chemin/vers/flare-game node tools/build-manifest.js
// (le manifest et les PNG sont déjà fournis dans le repo ; cet outil sert à régénérer)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FLARE = process.env.FLARE_DIR || '/tmp/flare';
const FC = path.join(FLARE, 'mods', 'fantasycore');
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'client', 'assets');

// ---- Tuiles ----
function parseTilesetDef(file) {
  const out = {}; // image -> {id: [x,y,w,h,ox,oy]}
  let img = null;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const l = line.trim();
    if (l.startsWith('img=')) { img = l.slice(4); out[img] = {}; }
    else if (l.startsWith('tile=')) {
      const p = l.slice(5).split(',').map(Number);
      out[img][p[0]] = p.slice(1);
    }
  }
  return out;
}

// ---- Animations (ennemis, avatar, butin) ----
function parseAnim(file) {
  const anims = {};
  let image = null, section = null;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const l = line.trim();
    if (!l || l.startsWith('#')) continue;
    if (l.startsWith('image=')) { image = l.slice(6); continue; }
    const m = l.match(/^\[(\w+)\]$/);
    if (m) { section = m[1]; anims[section] = { frames: 0, duration: 100, type: 'looped', fr: {} }; continue; }
    if (!section) continue;
    const a = anims[section];
    if (l.startsWith('frames=')) a.frames = parseInt(l.slice(7));
    else if (l.startsWith('duration=')) a.duration = parseInt(l.slice(9));
    else if (l.startsWith('type=')) a.type = l.slice(5);
    else if (l.startsWith('frame=')) {
      const p = l.slice(6).split(',').map(Number);
      const [f, d, ...rect] = p;
      (a.fr[d] ||= [])[f] = rect; // [x,y,w,h,ox,oy]
    }
  }
  return { image, anims };
}

// [nom, mod des animations, mod de l'image]
// Toutes les planches d'ennemis Flare exploitables chez nous : une image
// dédiée + animations 8 directions (stance/run/swing/die). Les planches de
// boss de fin de campagne (skeleton_knight_boss, antlion_armored...) pèsent
// 8-12 Mo chacune : on les laissera de côté tant qu'aucun monstre ne les porte.
const ENEMIES = [
  ['antlion', 'fantasycore', 'fantasycore'],            // araignées, tarentules, fourmilion géant (teintes)
  ['antlion_small', 'fantasycore', 'fantasycore'],
  ['fire_ant', 'fantasycore', 'fantasycore'],
  ['ice_ant', 'fantasycore', 'fantasycore'],            // kraanians
  ['goblin', 'fantasycore', 'fantasycore'],
  ['goblin_elite', 'fantasycore', 'fantasycore'],       // vrais orcs, troll (teintes)
  ['skeleton', 'fantasycore', 'fantasycore'],
  ['skeleton_mage', 'fantasycore', 'fantasycore'],      // liche mineure
  ['zombie', 'fantasycore', 'fantasycore'],
  ['zombie_dark', 'empyrean_campaign', 'empyrean_campaign'], // goule
  ['hobgoblin', 'empyrean_campaign', 'fantasycore'],
  ['hobgoblin_archer', 'empyrean_campaign', 'fantasycore'], // brigands, voleurs (teintes)
  ['minotaur', 'minicore', 'minicore'],
  ['wyvern', 'minicore', 'minicore'],                   // serpents (teinte)
  ['wyvern_adult', 'minicore', 'minicore'],             // guêpe géante (teinte)
  ['wyvern_air', 'minicore', 'minicore'],
  ['wyvern_fire', 'minicore', 'minicore'],
  ['wyvern_water', 'minicore', 'minicore'],
  ['boulder', 'empyrean_campaign', 'empyrean_campaign'],
  ['goblin_minecart', 'empyrean_campaign', 'empyrean_campaign'],
  ['grisbon', 'alpha_demo', 'alpha_demo'],              // bêtes : loups, ours, sanglier, rat (teintes)
  ['necromancer', 'alpha_demo', 'alpha_demo'],          // chaman orc (teinte)
  ['scathelocke', 'alpha_demo', 'alpha_demo'],
  ['vesuvvio', 'alpha_demo', 'alpha_demo'],             // élémentaire de feu
];
const AVATAR_LAYERS = [
  'default_chest', 'default_feet', 'default_hands', 'default_legs', 'head_short', 'head_long',
  'cloth_shirt', 'cloth_pants', 'leather_chest', 'leather_hood',
  'chain_cuirass', 'plate_cuirass', 'plate_helm',
  'buckler', 'kite_shield', 'shield', 'iron_buckler',
  'shortbow', 'longbow', 'greatbow',
  'dagger', 'shortsword', 'hand_axe', 'mace', 'longsword', 'greatsword',
  'mage_vest', 'mage_hood', 'staff', 'greatstaff',
  'leather_boots', 'plate_boots', 'mage_boots', 'chain_boots',
  'club', 'reinforced_club', 'war_hammer', 'maul', 'battle_axe',
  'cloth_gloves', 'cloth_sandals', 'leather_pants', 'leather_gloves',
  'chain_greaves', 'chain_gloves', 'chain_coif', 'plate_greaves', 'plate_gauntlets',
];
const SEXES = ['male', 'female'];
const LOOT = ['coins5', 'coins25', 'coins100', 'hp_potion', 'mp_potion', 'dagger', 'shortsword',
  'hand_axe', 'mace', 'longsword', 'greatsword', 'buckler', 'shield', 'clothes',
  'leather_armor', 'steel_armor', 'boots', 'ring',
  'club', 'reinforced_club', 'war_hammer', 'maul', 'battle_axe', 'staff', 'greatstaff',
  'shortbow', 'longbow', 'greatbow'];

const grass = parseTilesetDef(path.join(FC, 'tilesetdefs', 'tileset_grassland.txt'));
const manifest = {
  tileSize: [192, 96],
  // --- Sol historique d'Arakas : ids NUMÉRIQUES inchangés (rétrocompatibilité) ---
  // Le rendu/éditeur/decor connaissent ces ids tels quels (drawTile(16), etc.).
  tiles: grass['images/tilesets/tileset_grassland.png'],
  waterTiles: grass['images/tilesets/tileset_grassland_water.png'],
  // --- Nouveaux tilesets Flare : indexés par NOM, ids de frame propres au tileset ---
  // Schéma anti-collision : dans le jeu, ces tuiles sont référencées par une
  // chaîne « tileset:frame » (ex. "cave:42"). Les ids numériques restent
  // exclusivement grassland/water, donc aucune collision possible.
  // Chaque tileset : { images:[chemins], tiles:{ frame:[x,y,w,h,ox,oy,imgIndex] } }.
  tilesets: {},
  enemies: {}, avatar: {}, loot: {},
};

const copies = [
  ['images/tilesets/tileset_grassland.png', 'tilesets/tileset_grassland.png'],
  ['images/tilesets/tileset_grassland_water.png', 'tilesets/tileset_grassland_water.png'],
];

// Tilesets Flare additionnels : [nom logique, mod source, fichier de définition,
// liste ordonnée des images (chemins relatifs au mod) — l'index dans cette liste
// est l'imgIndex stocké pour chaque frame].
const EXTRA_TILESETS = [
  ['cave', 'fantasycore', 'tileset_cave.txt', ['images/tilesets/tileset_cave.png']],
  ['dungeon', 'fantasycore', 'tileset_dungeon.txt', ['images/tilesets/tileset_dungeon.png']],
  ['snow', 'fantasycore', 'tileset_snowplains.txt', [
    'images/tilesets/tileset_snowplains.png',
    'images/tilesets/tileset_snowplains_water.png',
    'images/tilesets/tileset_snowplains_ice.png',
    'images/tilesets/tileset_snowplains_other.png',
  ]],
  ['ruins', 'empyrean_campaign', 'tileset_ruins.txt', ['images/tilesets/tileset_ruins.png']],
];

for (const [name, mod, def, imgs] of EXTRA_TILESETS) {
  const modDir = path.join(FLARE, 'mods', mod);
  const parsed = parseTilesetDef(path.join(modDir, 'tilesetdefs', def));
  // map chemin source -> index dans la liste d'images du tileset
  const imgIndex = new Map(imgs.map((p, i) => [p, i]));
  const tiles = {};
  for (const [src, frames] of Object.entries(parsed)) {
    const idx = imgIndex.get(src);
    if (idx == null) continue; // image non retenue (ex. variante ignorée)
    for (const [frame, rect] of Object.entries(frames)) {
      tiles[frame] = [...rect.slice(0, 6), idx]; // [x,y,w,h,ox,oy,imgIndex]
    }
  }
  // chemins de DESTINATION (sous client/assets/tilesets/), conservant le nom de fichier
  const destImages = imgs.map(p => 'tilesets/' + path.basename(p));
  manifest.tilesets[name] = { images: destImages, tiles };
  imgs.forEach((src, i) => copies.push([path.join('..', mod, src), destImages[i]]));
}

for (const [e, animMod, imgMod] of ENEMIES) {
  const { anims } = parseAnim(path.join(FLARE, 'mods', animMod, 'animations', 'enemies', `${e}.txt`));
  manifest.enemies[e] = { image: `enemies/${e}.png`, anims };
  fs.mkdirSync(path.join(OUT, 'enemies'), { recursive: true });
  fs.copyFileSync(path.join(FLARE, 'mods', imgMod, 'images', 'enemies', `${e}.png`), path.join(OUT, 'enemies', `${e}.png`));
}
manifest.avatar = {};
for (const sex of SEXES) {
  manifest.avatar[sex] = {};
  for (const l of AVATAR_LAYERS) {
    const animFile = path.join(FC, 'animations', 'avatar', sex, `${l}.txt`);
    const imgFile = path.join(FC, 'images', 'avatar', sex, `${l}.png`);
    if (!fs.existsSync(animFile) || !fs.existsSync(imgFile)) {
      console.warn(`  (absent : ${sex}/${l})`);
      continue;
    }
    const { anims } = parseAnim(animFile);
    manifest.avatar[sex][l] = { image: `avatar/${sex}/${l}.png`, anims };
    copies.push([`images/avatar/${sex}/${l}.png`, `avatar/${sex}/${l}.png`]);
  }
}
for (const l of LOOT) {
  const { anims } = parseAnim(path.join(FC, 'animations', 'loot', `${l}.txt`));
  // image de repos : dernière frame de l'anim "power", direction 0
  const a = anims.power;
  const last = a.fr[0][a.frames - 1];
  manifest.loot[l] = { image: `loot/${l}.png`, frame: last };
  copies.push([`images/loot/${l}.png`, `loot/${l}.png`]);
}

for (const [src, dst] of copies) {
  const d = path.join(OUT, dst);
  fs.mkdirSync(path.dirname(d), { recursive: true });
  fs.copyFileSync(path.join(FC, src), d);
}
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest));
const extraTiles = Object.values(manifest.tilesets).reduce((n, ts) => n + Object.keys(ts.tiles).length, 0);
console.log('manifest généré :', Object.keys(manifest.tiles).length, 'tuiles grassland,',
  extraTiles, 'tuiles', `(${Object.keys(manifest.tilesets).join('/')}),`,
  ENEMIES.length, 'ennemis,', AVATAR_LAYERS.length, 'couches avatar,', LOOT.length, 'butins');
