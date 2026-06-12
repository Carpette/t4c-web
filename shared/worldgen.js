// Génération déterministe du monde — même code côté serveur et client.
// Les zones peuvent désigner une carte FIXE (champ `map` dans zones.json),
// comme Arakas (île 1, fidèle à T4C) ; sinon, génération procédurale par seed.
import { MAP_SIZE, WORLD_SEED } from './constants.js';
import { generateIsland1 } from './island1.js';

export const TILE = { WATER: 0, SAND: 1, GRASS: 2, FOREST: 3, ROCK: 4, COBBLE: 5, PATH: 6, GRAVE: 7 };

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeNoise(rng, gridSize) {
  const g = new Float32Array(gridSize * gridSize);
  for (let i = 0; i < g.length; i++) g[i] = rng();
  return function (x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const sx = xf * xf * (3 - 2 * xf), sy = yf * yf * (3 - 2 * yf);
    const i = (xx, yy) => g[((yy % gridSize + gridSize) % gridSize) * gridSize + ((xx % gridSize + gridSize) % gridSize)];
    const a = i(xi, yi), b = i(xi + 1, yi), c = i(xi, yi + 1), d = i(xi + 1, yi + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}

// Zones d'apparition des monstres des îles procédurales (zones 1+), centres
// en coordonnées tuile. Composition par niveau : la vermine près du village
// (centre 64,70), la difficulté croît en s'en éloignant — bêtes et hors-la-loi
// au sud, arachnides à l'est, morts-vivants au cimetière du NE, peaux-vertes
// et créatures magiques aux confins du nord.
export const SPAWN_ZONES = [
  // proche du village (niveaux de base 1-5)
  { mob: 'rat',              center: [64, 86],  radius: 9,  count: 10 },
  { mob: 'rat_caverne',      center: [70, 90],  radius: 7,  count: 6 },
  { mob: 'araignee_geante',  center: [78, 82],  radius: 7,  count: 6 },
  { mob: 'loup',             center: [52, 80],  radius: 8,  count: 6 },
  { mob: 'rat',              center: [46, 60],  radius: 7,  count: 6 },
  { mob: 'sanglier',         center: [56, 100], radius: 6,  count: 5 },
  // premier cercle (5-11)
  { mob: 'serpent',          center: [84, 96],  radius: 10, count: 7 },
  { mob: 'gobelin',          center: [34, 84],  radius: 11, count: 8 },
  { mob: 'gobelin',          center: [28, 56],  radius: 9,  count: 6 },
  { mob: 'loup_noir',        center: [24, 92],  radius: 6,  count: 5 },
  { mob: 'brigand',          center: [30, 70],  radius: 7,  count: 5 },
  { mob: 'voleur',           center: [28, 74],  radius: 5,  count: 4 },
  { mob: 'ours',             center: [40, 96],  radius: 6,  count: 4 },
  { mob: 'serpent_venimeux', center: [70, 104], radius: 6,  count: 5 },
  // deuxième cercle (10-17)
  { mob: 'goule',            center: [98, 40],  radius: 5,  count: 4 },
  { mob: 'momie',            center: [90, 32],  radius: 5,  count: 4 },
  { mob: 'squelette',        center: [94, 36],  radius: 11, count: 8 },
  { mob: 'zombie',           center: [99, 30],  radius: 6,  count: 5 },
  { mob: 'guepe',            center: [90, 60],  radius: 7,  count: 5 },
  { mob: 'tarentule',        center: [100, 84], radius: 7,  count: 6 },
  { mob: 'tarentule_geante', center: [106, 90], radius: 5,  count: 3 },
  { mob: 'kraanian',         center: [22, 36],  radius: 7,  count: 5 },
  { mob: 'mille_pattes',     center: [18, 42],  radius: 5,  count: 4 },
  { mob: 'fourmilion_geant', center: [74, 18],  radius: 6,  count: 4 },
  // confins (12-24)
  { mob: 'orc',              center: [56, 24],  radius: 10, count: 6 },
  { mob: 'orc_guerrier',     center: [50, 28],  radius: 7,  count: 5 },
  { mob: 'orc_chaman',       center: [48, 22],  radius: 4,  count: 2 },
  { mob: 'orc_eclaireur',    center: [60, 30],  radius: 7,  count: 4 },
  { mob: 'skraug_vert',      center: [86, 16],  radius: 6,  count: 4 },
  { mob: 'skraug_rouge',     center: [88, 12],  radius: 5,  count: 3 },
  { mob: 'necro_araignee',   center: [110, 44], radius: 5,  count: 3 },
  { mob: 'centaure',         center: [30, 20],  radius: 7,  count: 4 },
  { mob: 'elementaire_feu',  center: [14, 60],  radius: 5,  count: 3 },
  { mob: 'golem_pierre',     center: [20, 18],  radius: 5,  count: 2 },
  { mob: 'liche_mineure',    center: [108, 30], radius: 5,  count: 1 },
  { mob: 'troll',            center: [104, 64], radius: 5,  count: 2 },
  { mob: 'ogre',             center: [102, 70], radius: 6,  count: 2 },
];

// Emplacements de PNJ par défaut d'une zone : une carte fixe les fournit
// (npcSpots, cf. island1.js) ; sinon un marchand généraliste près du village,
// décalé jusqu'à la première case praticable. Partagé entre le serveur (spawn)
// et l'éditeur admin (affichage du calque PNJ) pour éviter toute divergence.
export function defaultNpcSpots(world, isWalkable = (x, z) => world.isWalkable(x, z)) {
  if (world.npcSpots) return world.npcSpots;
  const v = world.village;
  let x = v.x - 4.5, z = v.z - 3.5, tries = 0;
  while (!isWalkable(x, z) && tries++ < 30) x += 0.7;
  return [{ npcId: 'merchant', x, z }];
}

export function generateWorld(seed = WORLD_SEED, map = null) {
  if (map === 'arakas') return generateIsland1();
  const N = MAP_SIZE;
  const rng = mulberry32(seed);
  const n1 = makeNoise(rng, 16), n2 = makeNoise(rng, 32), n3 = makeNoise(rng, 64);
  const height = new Float32Array(N * N);
  const tile = new Uint8Array(N * N);
  const walk = new Uint8Array(N * N);
  const props = [];

  const cx = 64, cz = 70; // centre du village
  const idx = (x, z) => z * N + x;

  // --- Altitude : île avec atténuation radiale ---
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      const nx = x / N, nz = z / N;
      let h = n1(nx * 4, nz * 4) * 0.55 + n2(nx * 8, nz * 8) * 0.3 + n3(nx * 16, nz * 16) * 0.15;
      const dx = (nx - 0.5) * 2, dz = (nz - 0.5) * 2;
      const d = Math.sqrt(dx * dx + dz * dz);
      h = h * (1 - Math.pow(Math.min(1, d * 1.12), 2.2)); // île
      // collines au nord
      if (nz < 0.32) h += (0.32 - nz) * 0.9 * (0.6 + 0.4 * n2(nx * 6, nz * 6));
      height[idx(x, z)] = h;
    }
  }

  // --- Aplatir le village ---
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      const d = Math.hypot(x - cx, z - cz);
      if (d < 16) {
        const t = Math.min(1, d / 16);
        const flat = 0.34;
        height[idx(x, z)] = flat * (1 - t * t) + height[idx(x, z)] * t * t;
      }
    }
  }

  // --- Types de tuiles ---
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      const h = height[idx(x, z)];
      const forest = n2(x / N * 10 + 3, z / N * 10 + 7);
      let t;
      if (h < 0.16) t = TILE.WATER;
      else if (h < 0.20) t = TILE.SAND;
      else if (h > 0.62) t = TILE.ROCK;
      else if (forest > 0.62) t = TILE.FOREST;
      else t = TILE.GRASS;
      tile[idx(x, z)] = t;
    }
  }

  // --- Place du village (pavés) + chemins ---
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      if (Math.hypot(x - cx, z - cz) < 9 && tile[idx(x, z)] !== TILE.WATER) tile[idx(x, z)] = TILE.COBBLE;
    }
  }
  const carvePath = (x0, z0, x1, z1) => {
    const steps = Math.ceil(Math.hypot(x1 - x0, z1 - z0) * 2);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const px = Math.round(x0 + (x1 - x0) * t + Math.sin(t * 9) * 1.5);
      const pz = Math.round(z0 + (z1 - z0) * t + Math.cos(t * 7) * 1.5);
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const X = px + dx, Z = pz + dz;
        if (X >= 0 && Z >= 0 && X < N && Z < N) {
          const i2 = idx(X, Z);
          if (tile[i2] !== TILE.WATER && tile[i2] !== TILE.COBBLE && tile[i2] !== TILE.ROCK) tile[i2] = TILE.PATH;
        }
      }
    }
  };
  carvePath(cx, cz - 9, 60, 30);   // vers le nord (orcs)
  carvePath(cx + 9, cz, 96, 42);   // vers le cimetière
  carvePath(cx - 9, cz, 34, 84);   // vers la forêt gobeline
  carvePath(cx, cz + 9, 80, 94);   // vers les marais

  // --- Cimetière (NE) ---
  for (let z = 28; z < 46; z++) {
    for (let x = 86; x < 104; x++) {
      const i2 = idx(x, z);
      if (tile[i2] !== TILE.WATER && tile[i2] !== TILE.ROCK && rng() < 0.7) tile[i2] = TILE.GRAVE;
    }
  }

  // --- Praticabilité de base ---
  for (let i = 0; i < N * N; i++) {
    const t = tile[i];
    walk[i] = (t === TILE.WATER || t === TILE.ROCK) ? 0 : 1;
  }

  const block = (x, z) => { if (x >= 0 && z >= 0 && x < N && z < N) walk[idx(x, z)] = 0; };

  // --- Maisons autour de la place ---
  const houses = [
    { x: 56, z: 62, w: 5, d: 4, rot: 0 },
    { x: 70, z: 61, w: 4, d: 5, rot: 0 },
    { x: 55, z: 76, w: 4, d: 4, rot: 0 },
    { x: 71, z: 77, w: 5, d: 4, rot: 0 },
    { x: 63, z: 58, w: 4, d: 3, rot: 0 },
  ];
  for (const h of houses) {
    props.push({ type: 'house', x: h.x + h.w / 2, z: h.z + h.d / 2, w: h.w, d: h.d, rot: h.rot, s: 1 });
    for (let dz = 0; dz < h.d; dz++) for (let dx = 0; dx < h.w; dx++) block(h.x + dx, h.z + dz);
  }
  // Puits central
  props.push({ type: 'well', x: cx + 0.5, z: cz + 0.5, rot: 0, s: 1 });
  block(cx, cz);

  // Obélisque de téléportation (zones débloquées) à l'entrée est du village
  {
    let ox = cx + 12, oz = cz + 2;
    while (!walk[idx(ox, oz)] && ox < N - 2) ox++;
    props.push({ type: 'obelisk', x: ox + 0.5, z: oz + 0.5, rot: 0, s: 1 });
    block(ox, oz);
  }

  // Coffre personnel (banque) à l'entrée ouest du village, symétrique de l'obélisque
  {
    let bx = cx - 12, bz = cz - 2;
    while (!walk[idx(bx, bz)] && bx > 1) bx--;
    props.push({ type: 'bank', x: bx + 0.5, z: bz + 0.5, rot: 0, s: 1 });
    block(bx, bz);
  }

  // Portail de l'Épreuve (accès à la zone suivante), au bout du chemin nord
  {
    let px = 60, pz = 28;
    let tries = 0;
    while (!walk[idx(px, pz)] && tries++ < 200) { px += (tries % 2 ? tries : -tries) % 5; pz += 1; }
    props.push({ type: 'trialgate', x: px + 0.5, z: pz + 0.5, rot: 0, s: 1 });
    block(px, pz);
  }

  // Coffres au trésor : dispersés loin du village (le déplacement se mérite)
  {
    let placed = 0, tries = 0;
    while (placed < 7 && tries++ < 4000) {
      const x = 4 + Math.floor(rng() * (N - 8));
      const z = 4 + Math.floor(rng() * (N - 8));
      if (!walk[idx(x, z)]) continue;
      if (Math.hypot(x - cx, z - cz) < 28) continue; // pas près du village
      if (props.some(p => p.type === 'chest' && Math.hypot(p.x - x, p.z - z) < 18)) continue;
      props.push({ type: 'chest', x: x + 0.5, z: z + 0.5, rot: 0, s: 1 });
      placed++;
    }
  }

  // --- Torches : place + entrées de chemins ---
  const torches = [
    [cx - 6, cz - 6], [cx + 6, cz - 6], [cx - 6, cz + 6], [cx + 6, cz + 6],
    [cx, cz - 8], [cx, cz + 8], [cx - 8, cz], [cx + 8, cz],
    [60, 32], [96, 44], [36, 82], [80, 92],
  ];
  for (const [tx, tz] of torches) props.push({ type: 'torch', x: tx + 0.5, z: tz + 0.5, rot: 0, s: 1 });

  // --- Arbres, rochers, tombes ---
  for (let z = 1; z < N - 1; z++) {
    for (let x = 1; x < N - 1; x++) {
      const i2 = idx(x, z);
      if (!walk[i2]) continue;
      const t = tile[i2];
      const r = rng();
      if (t === TILE.FOREST && r < 0.16) {
        props.push({ type: 'tree', x: x + 0.5, z: z + 0.5, rot: rng() * Math.PI * 2, s: 0.8 + rng() * 0.7 });
        walk[i2] = 0;
      } else if (t === TILE.GRASS && r < 0.012) {
        props.push({ type: 'tree', x: x + 0.5, z: z + 0.5, rot: rng() * Math.PI * 2, s: 0.8 + rng() * 0.5 });
        walk[i2] = 0;
      } else if ((t === TILE.GRASS || t === TILE.SAND) && r >= 0.012 && r < 0.020) {
        props.push({ type: 'rock', x: x + 0.5, z: z + 0.5, rot: rng() * Math.PI * 2, s: 0.5 + rng() * 0.8 });
        walk[i2] = 0;
      } else if (t === TILE.GRAVE && r < 0.10) {
        props.push({ type: 'grave', x: x + 0.5, z: z + 0.5, rot: (rng() - 0.5) * 0.4, s: 1 });
        walk[i2] = 0;
      }
    }
  }

  return {
    size: N, height, tile, walk, props, kind: 'island',
    spawnPoint: { x: cx + 0.5, z: cz + 3.5 },
    village: { x: cx, z: cz },
    isWalkable(x, z) {
      const X = Math.floor(x), Z = Math.floor(z);
      if (X < 0 || Z < 0 || X >= N || Z >= N) return false;
      return walk[Z * N + X] === 1;
    },
    // altitude continue (pour le rendu)
    heightAt(x, z) {
      const X = Math.min(N - 2, Math.max(0, Math.floor(x)));
      const Z = Math.min(N - 2, Math.max(0, Math.floor(z)));
      const fx = Math.min(1, Math.max(0, x - X)), fz = Math.min(1, Math.max(0, z - Z));
      const h00 = height[Z * N + X], h10 = height[Z * N + X + 1];
      const h01 = height[(Z + 1) * N + X], h11 = height[(Z + 1) * N + X + 1];
      return (h00 * (1 - fx) + h10 * fx) * (1 - fz) + (h01 * (1 - fx) + h11 * fx) * fz;
    },
  };
}

// --- L'Épreuve : labyrinthe solo vers la zone suivante ---
// Couloir sinueux taillé dans la roche, du sud-ouest au nord-est.
// Seule issue : la sortie (ou la mort). Les monstres les plus puissants de la zone y rôdent.
export function generateTrial(seed) {
  const N = 64;
  const rng = mulberry32((seed ^ 0x71a1) >>> 0);
  const height = new Float32Array(N * N).fill(0.4);
  const tile = new Uint8Array(N * N).fill(TILE.ROCK);
  const walk = new Uint8Array(N * N); // tout bloqué par défaut
  const idx = (x, z) => z * N + x;

  // chemin par points de passage en zigzag
  const waypoints = [[6, 57]];
  let x = 6, z = 57;
  while (x < 54 || z > 10) {
    if (rng() < 0.5 && x < 54) x += 6 + Math.floor(rng() * 8);
    else if (z > 10) z -= 6 + Math.floor(rng() * 8);
    else x += 6;
    x = Math.min(56, x); z = Math.max(7, z);
    waypoints.push([x, z]);
  }
  waypoints.push([57, 6]);

  const carve = (x0, z0, x1, z1) => {
    const steps = Math.ceil(Math.hypot(x1 - x0, z1 - z0) * 2) + 1;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const px = Math.round(x0 + (x1 - x0) * t);
      const pz = Math.round(z0 + (z1 - z0) * t);
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const X = px + dx, Z = pz + dz;
        if (X > 0 && Z > 0 && X < N - 1 && Z < N - 1) {
          tile[idx(X, Z)] = TILE.PATH;
          walk[idx(X, Z)] = 1;
        }
      }
    }
  };
  for (let i = 1; i < waypoints.length; i++) {
    carve(waypoints[i - 1][0], waypoints[i - 1][1], waypoints[i][0], waypoints[i][1]);
  }

  // emplacements des monstres le long du chemin (hors entrée/sortie)
  const mobSpots = [];
  for (let i = 2; i < waypoints.length - 1; i++) {
    const [wx, wz] = waypoints[i];
    const count = 2 + Math.floor(rng() * 2);
    for (let j = 0; j < count; j++) {
      const mx = wx + Math.floor(rng() * 3) - 1, mz = wz + Math.floor(rng() * 3) - 1;
      if (walk[idx(mx, mz)]) mobSpots.push({ x: mx + 0.5, z: mz + 0.5 });
    }
  }

  const exitPoint = { x: 57.5, z: 6.5 };
  const props = [{ type: 'exitgate', x: exitPoint.x, z: exitPoint.z, rot: 0, s: 1 }];
  // torches le long du chemin
  for (let i = 1; i < waypoints.length; i += 2) {
    props.push({ type: 'torch', x: waypoints[i][0] + 0.5, z: waypoints[i][1] + 0.5, rot: 0, s: 1 });
  }

  return {
    size: N, height, tile, walk, props, kind: 'trial',
    spawnPoint: { x: 6.5, z: 57.5 },
    exitPoint,
    mobSpots,
    village: { x: 6, z: 57 },
    isWalkable(X, Z) {
      const tx = Math.floor(X), tz = Math.floor(Z);
      if (tx < 0 || tz < 0 || tx >= N || tz >= N) return false;
      return walk[tz * N + tx] === 1;
    },
    heightAt() { return 0.4; },
  };
}
