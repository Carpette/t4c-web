// Modifications de carte éditées par l'admin, appliquées par-dessus la génération.
// Format : { tiles: [[x, z, type], ...],
//            props: { add: [{type, x, z}], remove: [[x, z]] } }
import { TILE } from './worldgen.js';

const BLOCKING_PROPS = new Set(['tree', 'rock', 'house', 'well', 'grave', 'obelisk', 'trialgate', 'bank', 'cave']);
const HOUSE_SIZE = { w: 5, d: 4 };

export function applyOverrides(world, ov) {
  if (!ov) return world;
  const N = world.size;
  const idx = (x, z) => z * N + x;

  // 1. tuiles repeintes
  for (const [x, z, t] of ov.tiles || []) {
    if (x < 0 || z < 0 || x >= N || z >= N) continue;
    world.tile[idx(x, z)] = t;
    world.walk[idx(x, z)] = (t === TILE.WATER || t === TILE.ROCK) ? 0 : 1;
  }

  // 2. décors supprimés (et case rendue praticable)
  for (const [x, z] of ov.props?.remove || []) {
    for (let i = world.props.length - 1; i >= 0; i--) {
      const p = world.props[i];
      if (Math.hypot(p.x - x - 0.5, p.z - z - 0.5) < 1.0) {
        world.props.splice(i, 1);
        const tx = Math.floor(p.x), tz = Math.floor(p.z);
        const t = world.tile[idx(tx, tz)];
        if (t !== TILE.WATER && t !== TILE.ROCK) world.walk[idx(tx, tz)] = 1;
      }
    }
  }

  // 3. décors ajoutés
  for (const p of ov.props?.add || []) {
    const x = Math.floor(p.x), z = Math.floor(p.z);
    if (x < 0 || z < 0 || x >= N || z >= N) continue;
    const prop = { type: p.type, x: x + 0.5, z: z + 0.5, rot: 0, s: 1 };
    if (p.type === 'house') { prop.w = HOUSE_SIZE.w; prop.d = HOUSE_SIZE.d; }
    world.props.push(prop);
    if (BLOCKING_PROPS.has(p.type)) {
      if (p.type === 'house') {
        for (let dz = 0; dz < HOUSE_SIZE.d; dz++) for (let dx = 0; dx < HOUSE_SIZE.w; dx++) {
          const X = x - 2 + dx, Z = z - 2 + dz;
          if (X >= 0 && Z >= 0 && X < N && Z < N) world.walk[idx(X, Z)] = 0;
        }
      } else {
        world.walk[idx(x, z)] = 0;
      }
    }
  }
  return world;
}
