// Exporte la scène (sols, props, lumières) en JSON pour la prévisualisation Python
import fs from 'node:fs';
import { generateWorld } from '../shared/worldgen.js';
import { buildDecor } from '../client/js/render2d/decor.js';

const world = generateWorld();
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
