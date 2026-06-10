// Exporte la scène (sols, props, lumières) en JSON pour la prévisualisation Python
// Usage : node tools/dump-scene.js [sortie.json] [island|trial] [seed]
import fs from 'node:fs';
import { generateWorld, generateTrial } from '../shared/worldgen.js';
import { buildDecor } from '../client/js/render2d/decor.js';

const kind = process.argv[3] || 'island';
const seed = process.argv[4] ? parseInt(process.argv[4], 10) : undefined;
const world = kind === 'trial' ? generateTrial(seed || 8281932) : generateWorld(seed);
const decor = buildDecor(world);
fs.writeFileSync(process.argv[2] || '/tmp/scene.json', JSON.stringify({
  size: world.size,
  spawn: world.spawnPoint,
  floor: Array.from(decor.floor),
  props: decor.props,
  lights: decor.lights,
  walk: Array.from(world.walk),
}));
console.log('scène exportée');
