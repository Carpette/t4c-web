// Intérieurs de grottes — génération déterministe, même code serveur/client.
// Caverne organique creusée par automate cellulaire : poches arrondies
// reliées entre elles, murs de roche, sol de terre battue, stalagmites,
// coffres dans les recoins les plus profonds, et la SORTIE (retour à la
// surface) posée sur le point d'entrée. La pénombre y est permanente :
// le rendu client assombrit les cavernes, le sort Lumière y prend son sens.
import { TILE, mulberry32 } from './worldgen.js';

// Les monstres d'une grotte ont le niveau de base de la zone parente + ce bonus
export const CAVE_LEVEL_BONUS = 2;

// Registre des intérieurs de grottes d'Arakas. Clé = `caveId` du prop `cave`
// posé par shared/island1.js ; `depth` (1 à 3) règle le nombre de coffres et
// la densité de monstres. `mobs` pioche dans le bestiaire de shared/defs.js,
// fidèle aux occupants T4C de chaque lieu.
export const CAVES = {
  crypte_lh:  { seed: 0xc01f, size: 32, depth: 1, mobs: ['rat', 'rat_caverne'] },        // vermine de la crypte de départ
  cave_a:     { seed: 0xca0a, size: 40, depth: 1, mobs: ['gobelin', 'rat_caverne'] },
  cave_b:     { seed: 0xca0b, size: 40, depth: 1, mobs: ['gobelin', 'rat_caverne'] },
  cave_c:     { seed: 0xca0c, size: 40, depth: 1, mobs: ['araignee_geante', 'tarentule'] },          // les caves aux araignées
  cave_d:     { seed: 0xca0d, size: 40, depth: 1, mobs: ['araignee_geante', 'tarentule', 'squelette'] },
  cave_e:     { seed: 0xca0e, size: 40, depth: 1, mobs: ['tarentule', 'tarentule_geante'] },
  jarko:      { seed: 0x1a8c0, size: 48, depth: 2, mobs: ['squelette', 'zombie', 'goule', 'momie'] }, // l'antre du nécromancien Jarko
  kraanian:   { seed: 0x44aa, size: 48, depth: 2, mobs: ['kraanian', 'mille_pattes'] },               // la fourmilière kraanienne
  brigands:   { seed: 0xb416, size: 48, depth: 2, mobs: ['brigand', 'voleur'] },                      // le repaire des Brigands
  feylor:     { seed: 0xfe70, size: 56, depth: 3, mobs: ['necro_araignee', 'squelette', 'liche_mineure'] },
  feylor_est: { seed: 0xfe7e, size: 56, depth: 3, mobs: ['orc', 'skraug_vert', 'skraug_rouge'] },
};

// Paramètres de l'automate cellulaire (règle « 4-5 » classique)
const ROCK_FILL = 0.46;      // proportion initiale de roche
const SMOOTH_PASSES = 4;     // lissages suffisants pour arrondir les poches
const WALL_THRESHOLD = 5;    // une case devient roche si ≥ 5 voisines le sont
const STALAGMITE_CHANCE = 0.03; // densité au cœur des grandes salles
const MIN_CAVE_AREA = 30;    // garde-fou : en deçà, on creuse une salle de secours

export function generateCave(seed, size = 40, depth = 1) {
  const N = size;
  const rng = mulberry32((seed ^ 0x5eed1) >>> 0);
  const idx = (x, z) => z * N + x;

  // --- 1. automate cellulaire : bruit initial, puis lissages successifs ---
  // (le bord reste toujours en roche : la caverne est close)
  let rock = new Uint8Array(N * N).fill(1);
  for (let z = 1; z < N - 1; z++) {
    for (let x = 1; x < N - 1; x++) rock[idx(x, z)] = rng() < ROCK_FILL ? 1 : 0;
  }
  for (let pass = 0; pass < SMOOTH_PASSES; pass++) {
    const next = new Uint8Array(N * N).fill(1);
    for (let z = 1; z < N - 1; z++) {
      for (let x = 1; x < N - 1; x++) {
        let walls = 0;
        for (let dz = -1; dz <= 1; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx || dz) walls += rock[idx(x + dx, z + dz)];
          }
        }
        next[idx(x, z)] = walls >= WALL_THRESHOLD ? 1 : 0;
      }
    }
    rock = next;
  }

  // --- 2. ne garder que la plus grande poche (les bulles isolées sont murées) ---
  const comp = new Int32Array(N * N).fill(-1);
  let bestComp = -1, bestArea = 0, nComp = 0;
  for (let start = 0; start < N * N; start++) {
    if (rock[start] || comp[start] >= 0) continue;
    const stack = [start];
    comp[start] = nComp;
    let area = 0;
    while (stack.length) {
      const i = stack.pop();
      area++;
      const x = i % N, z = (i / N) | 0;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const j = idx(x + dx, z + dz);
        if (!rock[j] && comp[j] < 0) { comp[j] = nComp; stack.push(j); }
      }
    }
    if (area > bestArea) { bestArea = area; bestComp = nComp; }
    nComp++;
  }
  for (let i = 0; i < N * N; i++) if (!rock[i] && comp[i] !== bestComp) rock[i] = 1;
  if (bestArea < MIN_CAVE_AREA) {
    // seed pathologique : une salle simple au centre vaut mieux qu'un mur plein
    for (let z = (N >> 1) - 4; z <= (N >> 1) + 4; z++) {
      for (let x = (N >> 1) - 4; x <= (N >> 1) + 4; x++) rock[idx(x, z)] = 0;
    }
  }

  // --- 3. entrée : la case ouverte la plus proche du coin sud-ouest ---
  let entrance = { x: N >> 1, z: N >> 1 };
  let bestD = Infinity;
  for (let z = 1; z < N - 1; z++) {
    for (let x = 1; x < N - 1; x++) {
      if (rock[idx(x, z)]) continue;
      const d = x * x + (N - 1 - z) * (N - 1 - z);
      if (d < bestD) { bestD = d; entrance = { x, z }; }
    }
  }

  // --- 4. distances à pied depuis l'entrée (pour pousser coffres et monstres au fond) ---
  const dist = new Int32Array(N * N).fill(-1);
  {
    const queue = [idx(entrance.x, entrance.z)];
    dist[queue[0]] = 0;
    for (let h = 0; h < queue.length; h++) {
      const i = queue[h];
      const x = i % N, z = (i / N) | 0;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const j = idx(x + dx, z + dz);
        if (!rock[j] && dist[j] < 0) { dist[j] = dist[i] + 1; queue.push(j); }
      }
    }
  }

  // --- 5. tuiles et praticabilité : sol de terre battue entre les parois ---
  const tile = new Uint8Array(N * N);
  const walk = new Uint8Array(N * N);
  const height = new Float32Array(N * N).fill(0.38);
  for (let i = 0; i < N * N; i++) {
    tile[i] = rock[i] ? TILE.ROCK : TILE.SAND;
    walk[i] = rock[i] ? 0 : 1;
  }

  const props = [];
  // la sortie, posée sur l'entrée : un pas en arrière et l'on revoit le ciel
  props.push({ type: 'exitgate', x: entrance.x + 0.5, z: entrance.z + 0.5, rot: 0, s: 1 });

  // --- 6. stalagmites : uniquement là où les 8 voisines restent praticables,
  // pour qu'elles ne puissent jamais couper le chemin (et jamais à l'entrée) ---
  const surroundedByFloor = (x, z) => {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!walk[idx(x + dx, z + dz)]) return false;
      }
    }
    return true;
  };
  for (let z = 2; z < N - 2; z++) {
    for (let x = 2; x < N - 2; x++) {
      if (rng() >= STALAGMITE_CHANCE) continue;
      if (dist[idx(x, z)] < 4 || !surroundedByFloor(x, z)) continue;
      props.push({ type: 'rock', x: x + 0.5, z: z + 0.5, rot: rng() * Math.PI * 2, s: 0.6 + rng() * 0.6 });
      walk[idx(x, z)] = 0;
    }
  }

  // --- 7. coffres (1 à 3 selon la profondeur) dans les recoins les plus lointains,
  // espacés entre eux ; torches rares réparties le long de la caverne ---
  const floorCells = [];
  for (let z = 1; z < N - 1; z++) {
    for (let x = 1; x < N - 1; x++) {
      const i = idx(x, z);
      if (walk[i] && dist[i] >= 0) floorCells.push({ x, z, d: dist[i] });
    }
  }
  floorCells.sort((a, b) => b.d - a.d); // du plus profond au plus proche
  const chestCount = Math.max(1, Math.min(3, depth));
  const chests = [];
  for (const c of floorCells) {
    if (chests.length >= chestCount) break;
    if (chests.some(o => Math.hypot(o.x - c.x, o.z - c.z) < 8)) continue;
    chests.push(c);
    props.push({ type: 'chest', x: c.x + 0.5, z: c.z + 0.5, rot: 0, s: 1 });
  }
  const torchCount = 2 + depth;
  const stride = Math.max(1, Math.floor(floorCells.length / (torchCount + 1)));
  for (let k = 1; k <= torchCount; k++) {
    const c = floorCells[k * stride];
    if (c) props.push({ type: 'torch', x: c.x + 0.5, z: c.z + 0.5, rot: 0, s: 1 });
  }

  // --- 8. emplacements de monstres : dispersés, jamais collés à l'entrée ---
  const mobSpots = [];
  const mobCount = 6 + depth * 3;
  for (let guard = 0; guard < mobCount * 20 && mobSpots.length < mobCount; guard++) {
    const x = 1 + Math.floor(rng() * (N - 2));
    const z = 1 + Math.floor(rng() * (N - 2));
    const i = idx(x, z);
    if (!walk[i] || dist[i] < 7) continue;
    mobSpots.push({ x: x + 0.5, z: z + 0.5 });
  }

  // --- 9. apparition : la case ouverte adjacente à la sortie ---
  let spawnPoint = { x: entrance.x + 0.5, z: entrance.z + 0.5 };
  for (const [dx, dz] of [[0, -1], [1, 0], [-1, 0], [0, 1]]) {
    if (walk[idx(entrance.x + dx, entrance.z + dz)]) {
      spawnPoint = { x: entrance.x + dx + 0.5, z: entrance.z + dz + 0.5 };
      break;
    }
  }

  return {
    size: N, height, tile, walk, props, kind: 'cave',
    spawnPoint,
    mobSpots,
    village: { x: entrance.x, z: entrance.z },
    isWalkable(X, Z) {
      const tx = Math.floor(X), tz = Math.floor(Z);
      if (tx < 0 || tz < 0 || tx >= N || tz >= N) return false;
      return walk[tz * N + tx] === 1;
    },
    heightAt() { return 0.38; },
  };
}
