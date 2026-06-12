// Import d'une planche de monstre FOURNIE PAR L'UTILISATEUR vers le manifest.
//
// Convention attendue (bien plus simple que l'atlas Flare compacté) :
//   - un PNG en GRILLE RÉGULIÈRE : 8 lignes = 8 directions (ordre Flare :
//     0=O, 1=NO, 2=N, 3=NE, 4=E, 5=SE, 6=S face caméra, 7=SO),
//     colonnes = frames, toutes les cases de la même taille ;
//   - un JSON de description à côté (même nom, extension .json) :
//     {
//       "name": "dragonnet",          // id du sprite (MOBS[..].sprite)
//       "cell": [128, 128],            // taille d'une case [largeur, hauteur]
//       "anchor": [64, 110],           // point au sol DANS la case (pieds)
//       "anims": {                     // colonnes par animation (incluses)
//         "stance": { "from": 0, "to": 3, "duration": 800 },
//         "run":    { "from": 4, "to": 11, "duration": 660 },
//         "swing":  { "from": 12, "to": 15, "duration": 480, "type": "play_once" },
//         "hit":    { "from": 16, "to": 16, "duration": 200, "type": "play_once" },
//         "die":    { "from": 17, "to": 22, "duration": 900, "type": "play_once" }
//       }
//     }
//   stance/run/swing/die sont obligatoires (le moteur s'en sert) ; les autres
//   (cast, shoot, hit...) sont optionnelles. "type" : looped (défaut),
//   back_forth, play_once.
//
// Usage : node tools/import-enemy.js chemin/vers/dragonnet.png
//   -> copie le PNG dans client/assets/enemies/ et fusionne l'entrée dans
//      client/assets/manifest.json (remplace si l'id existe déjà).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const REQUIRED_ANIMS = ['stance', 'run', 'swing', 'die'];
const DIRECTIONS = 8;

const pngPath = process.argv[2];
if (!pngPath) {
  console.error('Usage : node tools/import-enemy.js <planche.png> (avec <planche>.json à côté)');
  process.exit(1);
}
const cfgPath = pngPath.replace(/\.png$/i, '.json');
if (!fs.existsSync(pngPath) || !fs.existsSync(cfgPath)) {
  console.error(`Introuvable : ${pngPath} et/ou ${cfgPath}`);
  process.exit(1);
}

// dimensions du PNG sans dépendance (en-tête IHDR)
function pngSize(file) {
  const d = fs.readFileSync(file);
  if (d.readUInt32BE(12) !== 0x49484452) throw new Error('PNG invalide (IHDR manquant)');
  return { w: d.readUInt32BE(16), h: d.readUInt32BE(20) };
}

const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
for (const k of ['name', 'cell', 'anchor', 'anims']) {
  if (!cfg[k]) { console.error(`Champ manquant dans le JSON : "${k}"`); process.exit(1); }
}
for (const a of REQUIRED_ANIMS) {
  if (!cfg.anims[a]) { console.error(`Animation obligatoire manquante : "${a}"`); process.exit(1); }
}

const { w: imgW, h: imgH } = pngSize(pngPath);
const [cw, ch] = cfg.cell;
const [ox, oy] = cfg.anchor;
const cols = Math.floor(imgW / cw);
if (imgH < ch * DIRECTIONS) {
  console.error(`Le PNG fait ${imgH}px de haut : il faut 8 lignes de ${ch}px (${ch * DIRECTIONS}px).`);
  process.exit(1);
}
if (ox < 0 || ox > cw || oy < 0 || oy > ch) {
  console.error(`Ancrage (${ox}, ${oy}) hors de la case ${cw}x${ch}.`);
  process.exit(1);
}

// construit l'entrée manifest : pour chaque animation, 8 directions de frames
// [x, y, w, h, ox, oy] découpées dans la grille
const anims = {};
for (const [name, a] of Object.entries(cfg.anims)) {
  if (!(a.from >= 0) || !(a.to >= a.from) || a.to >= cols) {
    console.error(`Animation "${name}" : colonnes ${a.from}..${a.to} hors de la grille (${cols} colonnes).`);
    process.exit(1);
  }
  const fr = {};
  for (let d = 0; d < DIRECTIONS; d++) {
    fr[String(d)] = [];
    for (let c = a.from; c <= a.to; c++) {
      fr[String(d)].push([c * cw, d * ch, cw, ch, ox, oy]);
    }
  }
  anims[name] = {
    frames: a.to - a.from + 1,
    duration: a.duration || 800,
    type: a.type || 'looped',
    fr,
  };
}

// copie du PNG + fusion dans le manifest
const destRel = `enemies/${cfg.name}.png`;
fs.copyFileSync(pngPath, path.join(ROOT, 'client/assets', destRel));
const manifestPath = path.join(ROOT, 'client/assets/manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const existed = !!manifest.enemies[cfg.name];
manifest.enemies[cfg.name] = { image: destRel, anims };
fs.writeFileSync(manifestPath, JSON.stringify(manifest));

console.log(`✔ ${cfg.name} ${existed ? 'remplacé' : 'ajouté'} : ${cols} colonnes, `
  + `${Object.keys(anims).length} animations (${Object.keys(anims).join(', ')})`);
console.log(`  Utilisation : sprite: '${cfg.name}' dans shared/defs.js (MOBS), `
  + 'puis rechargez le client (Ctrl+Shift+R).');
