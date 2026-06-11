// Habillage de la carte : choix des tuiles Flare et des décors depuis le worldgen partagé
import { TILE, mulberry32 } from '../../../shared/worldgen.js';

const GRASS_IDS = [16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31];
const FOREST_IDS = [20, 21, 24, 25, 28, 29];
const COBBLE_IDS = [32, 33, 34, 35, 36, 37, 38];
const PATH_IDS = [39, 40, 41, 42, 43, 44];
const DIRT_IDS = [45, 46, 47];
const ROCKY_IDS = [34, 37, 38];
const WATER_IDS = [176, 177, 178, 179, 180, 181, 182, 183, 184, 185, 186, 187, 188, 189, 190, 191];

const TUFT_IDS = [114, 115, 122, 123, 124, 125, 126, 127];
const FERN_IDS = [112, 113, 116, 117, 120, 121];
const TREE_IDS = [240, 241, 242, 243, 244];
const DEAD_TREE_IDS = [250, 251, 252, 253, 254];
const GRAVE_IDS = [140, 141, 142, 143];
const ROCKPROP_IDS = [136, 100, 101, 128];
const CLIFF_IDS = [48, 52, 56];
const CAMPFIRE_ID = 102;
const HOUSE_ID = 296;
const WELL_ID = 264; // dalle de pierre circulaire au centre du village

function hash(x, z) {
  let h = (x * 374761393 + z * 668265263) ^ 0x5bf03635;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967296;
}
const pick = (arr, r) => arr[Math.floor(r * arr.length) % arr.length];

export function buildDecor(world) {
  const N = world.size;
  const voidMode = world.kind === 'trial'; // l'Épreuve : un chemin suspendu au-dessus du vide
  // --- id de tuile de sol par case ---
  const floor = new Int16Array(N * N);
  const isWater = new Uint8Array(N * N);
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      const i = z * N + x;
      const t = world.tile[i];
      const r = hash(x, z);
      let id;
      switch (t) {
        case TILE.WATER: id = pick(WATER_IDS, r); isWater[i] = 1; break;
        case TILE.SAND: id = pick(DIRT_IDS, r); break;
        case TILE.GRASS: id = pick(GRASS_IDS, r); break;
        case TILE.FOREST: id = pick(FOREST_IDS, r); break;
        case TILE.ROCK:
          if (voidMode) { id = pick(WATER_IDS, r); isWater[i] = 1; }
          else id = pick(ROCKY_IDS, r);
          break;
        case TILE.COBBLE: id = pick(COBBLE_IDS, r); break;
        case TILE.PATH: id = pick(PATH_IDS, r); break;
        case TILE.GRAVE: id = pick(DIRT_IDS, r); break;
        default: id = 16;
      }
      floor[i] = id;
    }
  }

  // --- Berges : falaises de transition terre/eau (autotiling appris des cartes Flare) ---
  // L'eau Flare est « enfoncée » (oy=-48) ; la dernière tuile de terre devient une falaise
  // dont le haut est herbeux et la paroi descend au niveau de l'eau.
  const wat = (x, z) => {
    if (x < 0 || z < 0 || x >= N || z >= N) return 1; // hors carte = eau
    return isWater[z * N + x];
  };
  const cliffFloor = new Int16Array(N * N);
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      const i = z * N + x;
      if (isWater[i]) continue;
      const E = wat(x + 1, z), S = wat(x, z + 1), W = wat(x - 1, z), Nn = wat(x, z - 1);
      const SE = wat(x + 1, z + 1), NW = wat(x - 1, z - 1), NE = wat(x + 1, z - 1), SW = wat(x - 1, z + 1);
      const r = hash(x + 7, z + 13) < 0.5 ? 0 : 4; // deux variantes par orientation
      let id = 0;
      if (E && S) id = 160 + r;
      else if (S && W) id = 161 + r;
      else if (W && Nn) id = 162 + r;
      else if (Nn && E) id = 163 + r;
      else if (E) id = 144 + r;
      else if (S) id = 145 + r;
      else if (W) id = 146 + r;
      else if (Nn) id = 147 + r;
      else if (SE) id = 152 + r;
      else if (SW) id = 153 + r;
      else if (NW) id = 154 + r;
      else if (NE) id = 155 + r;
      if (id) cliffFloor[i] = id;
    }
  }
  for (let i = 0; i < N * N; i++) if (cliffFloor[i]) floor[i] = cliffFloor[i];

  // --- décors (props worldgen -> tuiles Flare) + lumières ---
  const props = [];   // {tileId, x, z}
  const lights = [];  // {x, z, r, flicker}
  // arbres morts sur les tuiles de cimetière (quel que soit le tracé de la carte)
  const inCemetery = (x, z) => world.tile[Math.floor(z) * N + Math.floor(x)] === TILE.GRAVE;

  for (const p of world.props) {
    const r = hash(Math.floor(p.x * 7), Math.floor(p.z * 7));
    switch (p.type) {
      case 'tree':
        props.push({ tileId: inCemetery(p.x, p.z) ? pick(DEAD_TREE_IDS, r) : pick(TREE_IDS, r), x: p.x, z: p.z });
        break;
      case 'rock':
        props.push({ tileId: pick(ROCKPROP_IDS, r), x: p.x, z: p.z });
        break;
      case 'grave':
        props.push({ tileId: pick(GRAVE_IDS, r), x: p.x, z: p.z });
        break;
      case 'torch':
        props.push({ tileId: CAMPFIRE_ID, x: p.x, z: p.z });
        lights.push({ x: p.x, z: p.z, r: 330, flicker: true });
        break;
      case 'house':
        // ancrage calibré : la base visuelle couvre l'empreinte bloquée
        props.push({ tileId: HOUSE_ID, x: p.x - 1.5, z: p.z + 2.5, big: true });
        break;
      case 'well':
        props.push({ tileId: WELL_ID, x: p.x, z: p.z });
        break;
      case 'obelisk':
        props.push({ tileId: 143, x: p.x, z: p.z, interact: 'obelisk' });
        lights.push({ x: p.x, z: p.z, r: 240, flicker: false, color: 'rgba(120, 160, 255, 0.14)' });
        break;
      case 'trialgate':
        props.push({ tileId: 265, x: p.x, z: p.z + 1, interact: 'trialgate' });
        lights.push({ x: p.x, z: p.z, r: 300, flicker: true, color: 'rgba(160, 120, 255, 0.16)' });
        break;
      case 'exitgate':
        props.push({ tileId: 265, x: p.x, z: p.z + 1, interact: 'exitgate' });
        lights.push({ x: p.x, z: p.z, r: 320, flicker: true, color: 'rgba(120, 200, 255, 0.18)' });
        break;
      case 'chest':
        props.push({ tileId: 298, x: p.x, z: p.z, interact: 'chest' });
        break;
      case 'bank':
        // coffre clouté du tileset : la banque personnelle du village
        props.push({ tileId: 300, x: p.x, z: p.z, interact: 'bank' });
        lights.push({ x: p.x, z: p.z, r: 200, flicker: false, color: 'rgba(255, 200, 120, 0.10)' });
        break;
      case 'cave':
        // entrée de grotte : pan de falaise sombre (intérieurs à venir)
        props.push({ tileId: pick(CLIFF_IDS, r), x: p.x, z: p.z, interact: 'cave', name: p.name });
        break;
    }
  }

  // falaises décoratives dans les montagnes (pas dans le vide de l'Épreuve)
  if (!voidMode) {
    for (let z = 2; z < N - 2; z++) {
      for (let x = 2; x < N - 2; x++) {
        const i = z * N + x;
        if (world.tile[i] === TILE.ROCK && hash(x + 31, z + 17) < 0.06) {
          props.push({ tileId: pick(CLIFF_IDS, hash(x, z + 5)), x: x + 0.5, z: z + 0.5 });
        }
      }
    }
  }

  // touffes d'herbe et fougères (purement décoratif)
  const smallProps = [];
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      const i = z * N + x;
      if (!world.walk[i]) continue;
      const t = world.tile[i];
      const r = hash(x + 101, z + 57);
      if (t === TILE.GRASS && r < 0.055) smallProps.push({ tileId: pick(TUFT_IDS, r * 18), x: x + 0.5, z: z + 0.5 });
      else if (t === TILE.FOREST && r < 0.13) smallProps.push({ tileId: pick(FERN_IDS, r * 8), x: x + 0.5, z: z + 0.5 });
    }
  }

  return { floor, isWater, props: props.concat(smallProps), lights };
}
