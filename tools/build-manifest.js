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
const ENEMIES = [
  ['antlion_small', 'fantasycore', 'fantasycore'],
  ['fire_ant', 'fantasycore', 'fantasycore'],
  ['goblin', 'fantasycore', 'fantasycore'],
  ['skeleton', 'fantasycore', 'fantasycore'],
  ['zombie', 'fantasycore', 'fantasycore'],
  ['hobgoblin', 'empyrean_campaign', 'fantasycore'],
  ['minotaur', 'minicore', 'minicore'],
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

const tilesets = parseTilesetDef(path.join(FC, 'tilesetdefs', 'tileset_grassland.txt'));
const manifest = {
  tileSize: [192, 96],
  tiles: tilesets['images/tilesets/tileset_grassland.png'],
  waterTiles: tilesets['images/tilesets/tileset_grassland_water.png'],
  enemies: {}, avatar: {}, loot: {},
};

const copies = [
  ['images/tilesets/tileset_grassland.png', 'tilesets/tileset_grassland.png'],
  ['images/tilesets/tileset_grassland_water.png', 'tilesets/tileset_grassland_water.png'],
];

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
console.log('manifest généré :', Object.keys(manifest.tiles).length, 'tuiles,',
  ENEMIES.length, 'ennemis,', AVATAR_LAYERS.length, 'couches avatar,', LOOT.length, 'butins');
