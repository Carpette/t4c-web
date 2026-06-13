// Contrôle : liste les frames du tileset grassland classées par type de palette
// (sol / mur / bâtiment / objet), telles qu'exposées dans le thème
// « Plaines / Bâtiments (Flare) » de l'éditeur (cf. classifyGrasslandFrame).
// Sert à juger la pertinence du classement géométrique. Usage : node tools/grassland-frames.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyGrasslandFrame } from '../client/js/render2d/decormap.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'client/assets/manifest.json'), 'utf8'));

// mêmes frames de berge écartées que la palette (autotiling, pas posable seul)
const SKIP = new Set();
for (let i = 144; i <= 191; i++) SKIP.add(String(i));

const LABELS = { sol: 'Sols', mur: 'Murs & falaises', bati: 'Bâtiments', objet: 'Mobilier & objets' };
const cats = { sol: [], mur: [], bati: [], objet: [] };
for (const [f, r] of Object.entries(m.tiles)) {
  if (!/^\d+$/.test(f) || SKIP.has(f)) continue;
  cats[classifyGrasslandFrame(r)].push([f, r[2], r[3]]);
}

let total = 0;
for (const key of ['sol', 'mur', 'bati', 'objet']) {
  const arr = cats[key].sort((a, b) => Number(a[0]) - Number(b[0]));
  total += arr.length;
  console.log(`\n=== ${LABELS[key]} (${arr.length}) ===`);
  console.log(arr.map(([f, w, h]) => `${f}(${w}x${h})`).join('  '));
}
console.log(`\nTotal frames grassland posables (hors berges d'autotiling) : ${total}`);
console.log('Récap :', ['sol', 'mur', 'bati', 'objet'].map(k => `${k}=${cats[k].length}`).join('  '));
