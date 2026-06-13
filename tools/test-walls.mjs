// Validation des murs IA (assets PROPRES au projet, pas Flare).
// 1. walls.json : chaque pièce de chaque matériau référence un rectangle dans les
//    bornes du PNG du matériau (lecture des dimensions depuis l'en-tête PNG) ;
// 2. manifeste régénéré : 7 entrées « wall_<mat> » × 16 pièces, schéma Flare ;
// 3. resolveTile : un id « wall_pierre:5 » se résout vers la bonne image + rect.
// Usage : node tools/test-walls.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveTile } from '../client/js/render2d/assets.js';
import { WALL_MATERIALS, WALL_PIECES, wallPropId } from '../client/js/render2d/decormap.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = path.join(ROOT, 'client', 'assets');
const checks = [];
const ok = (name, cond) => { checks.push([name, !!cond]); console.log(cond ? '  ✔' : '  ✘', name); };

// dimensions d'un PNG depuis l'en-tête IHDR (octets 16..24 : width, height BE)
function pngSize(file) {
  const buf = fs.readFileSync(file);
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

const walls = JSON.parse(fs.readFileSync(path.join(ASSETS, 'tilesets', 'walls', 'walls.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(ASSETS, 'manifest.json'), 'utf8'));

// --- 1. bornes des rectangles dans chaque PNG ---
let allInBounds = true, totalPieces = 0;
for (const [mat] of WALL_MATERIALS) {
  const pieces = walls[mat];
  if (!pieces) { allInBounds = false; continue; }
  const { w: PW, h: PH } = pngSize(path.join(ASSETS, 'tilesets', 'walls', `${mat}.png`));
  for (const [x, y, w, h] of pieces) {
    totalPieces++;
    if (x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > PW || y + h > PH) {
      allInBounds = false;
      console.log(`    rect hors bornes (${mat}) : [${x},${y},${w},${h}] dans ${PW}×${PH}`);
    }
  }
}
ok(`walls.json : ${totalPieces} pièces, toutes dans les bornes de leur PNG`, allInBounds && totalPieces === 7 * WALL_PIECES);

// --- 2. manifeste : 7 entrées × 16 pièces, schéma Flare [x,y,w,h,ox,oy,imgIndex] ---
let entries = 0, frames = 0, schemaOk = true;
for (const [mat] of WALL_MATERIALS) {
  const ts = manifest.tilesets?.[`wall_${mat}`];
  if (!ts) continue;
  entries++;
  if (!Array.isArray(ts.images) || ts.images[0] !== `tilesets/walls/${mat}.png`) schemaOk = false;
  for (const rect of Object.values(ts.tiles)) {
    frames++;
    if (!Array.isArray(rect) || rect.length !== 7) schemaOk = false;
  }
}
ok('manifeste : 7 entrées wall_<mat> × 16 pièces', entries === 7 && frames === 7 * WALL_PIECES);
ok('manifeste : schéma Flare [x,y,w,h,ox,oy,imgIndex] + image du matériau', schemaOk);

// --- 3. resolveTile : « wall_pierre:5 » -> image + rect attendus ---
{
  const assets = { manifest, images: new Map() };
  // image factice : resolveTile renvoie { img, rect } si l'image est dans la Map
  for (const [mat] of WALL_MATERIALS) assets.images.set(`tilesets/walls/${mat}.png`, { tag: mat });
  const id = wallPropId('wall_pierre', 5); // « wall_pierre:5 »
  const r = resolveTile(assets, id, null, null);
  const expectRect = manifest.tilesets['wall_pierre'].tiles['5'];
  ok('resolveTile : « wall_pierre:5 » -> image pierre + rect du manifeste',
    r && r.img?.tag === 'pierre' && JSON.stringify(r.rect) === JSON.stringify(expectRect));
}

const bad = checks.filter(([, c]) => !c).length;
console.log(bad ? `\n${bad} ÉCHEC(S)` : '\nMURS OK');
process.exit(bad ? 1 : 0);
