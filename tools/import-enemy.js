// Import d'une planche de monstre FOURNIE PAR L'UTILISATEUR vers le manifest.
// (La même chose est possible sans terminal : admin -> onglet 🎨 Skins.)
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
import { buildEnemyEntry, pngSize } from '../server/enemy-import.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

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

const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
const buf = fs.readFileSync(pngPath);
let entry;
try {
  const { w, h } = pngSize(buf);
  entry = buildEnemyEntry(cfg, w, h);
} catch (e) {
  console.error('✘ ' + e.message);
  process.exit(1);
}

// copie du PNG + fusion dans le manifest
fs.copyFileSync(pngPath, path.join(ROOT, 'client/assets', entry.image));
const manifestPath = path.join(ROOT, 'client/assets/manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const existed = !!manifest.enemies[cfg.name];
manifest.enemies[cfg.name] = { image: entry.image, anims: entry.anims };
fs.writeFileSync(manifestPath, JSON.stringify(manifest));

console.log(`✔ ${cfg.name} ${existed ? 'remplacé' : 'ajouté'} : ${entry.cols} colonnes, `
  + `${Object.keys(entry.anims).length} animations (${Object.keys(entry.anims).join(', ')})`);
console.log(`  Utilisation : sprite: '${cfg.name}' dans shared/defs.js (MOBS), ou onglet`
  + ' admin 🎨 Skins -> assigner à une créature, puis rechargez le client (Ctrl+Shift+R).');
