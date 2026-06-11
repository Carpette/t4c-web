// Arakas — la première île de T4C, reconstituée d'après les cartes et
// coordonnées du jeu original (t4cbible.com, wiki Fandom, winternun.blog) :
//   - Lighthaven au sud-est : temple (apparition), fontaine, banque/HDV,
//     village des métiers au sud, tour des mages au nord, cimetière et
//     crypte au nord-est.
//   - Windhowl à l'ouest : temple, maison de Lord Sunrock au nord, tour des
//     mages, taverne (coffre personnel), maison du bourgmestre à l'ouest
//     (et son fameux coffre au diamant).
//   - Entre les deux : la rivière et le pont gob, le camp gobelin,
//     la maison de Nilhem au nord du pont.
//   - Au nord : les monts Righul, les grottes de Jarko (portail de
//     l'Épreuve), la maison isolée de Lance Silversmith.
//   - Au nord de Windhowl : le spot des orcs solitaires, près de la rivière.
//   - Au sud-ouest de Lighthaven : les ogres ignobles.
//   - Au nord-est : l'île de l'Ermite, reliée par un gué de sable
//     (le passage des brigands).
// Carte FIXE : aucune génération aléatoire de structure (seul l'habillage
// — arbres, rochers — est tiré d'un seed constant, identique partout).
import { TILE, mulberry32 } from './worldgen.js';

const N = 128;

// Points d'intérêt (coordonnées tuiles, x vers l'est, z vers le sud)
export const ARAKAS = {
  LH: { x: 94, z: 84 },          // place de Lighthaven
  WH: { x: 28, z: 78 },          // place de Windhowl
  METIERS: { x: 94, z: 102 },    // village des métiers (sud de LH)
  MAGE_LH: { x: 94, z: 66 },     // tour des mages d'Uranos (nord de LH)
  CIMETIERE: { x: 109, z: 57 },  // cimetière (nord-est de LH)
  LANCE: { x: 74, z: 44 },       // maison de Lance Silversmith
  JARKO: { x: 52, z: 16 },       // grottes de Jarko (monts Righul)
  NILHEM: { x: 60, z: 64 },      // maison de Nilhem (nord du pont gob)
  CAMP_GOB: { x: 66, z: 71 },    // camp gobelin (est du pont)
  ORCS: { x: 44, z: 39 },        // orcs solitaires (nord de WH)
  OGRES: { x: 77, z: 105 },      // ogres ignobles (sud-ouest de LH)
  ERMITE: { x: 112, z: 24 },     // île de l'Ermite (nord-est, au large)
  PONT: { z: 80 },               // latitude du pont gob
};

// Zones d'apparition des monstres, fidèles aux spots d'Arakas
const ARAKAS_SPAWNS = [
  { mob: 'rat',       center: [88, 94],   radius: 8,  count: 12 }, // fourmilières au sud de LH
  { mob: 'rat',       center: [100, 72],  radius: 6,  count: 6 },  // route du cimetière
  { mob: 'serpent',   center: [108, 98],  radius: 8,  count: 9 },  // côte sud-est
  { mob: 'gobelin',   center: [66, 71],   radius: 8,  count: 10 }, // camp gobelin
  { mob: 'gobelin',   center: [16, 60],   radius: 7,  count: 7 },  // forêt ouest de WH
  { mob: 'squelette', center: [109, 57],  radius: 8,  count: 10 }, // cimetière
  { mob: 'zombie',    center: [114, 50],  radius: 5,  count: 5 },  // la crypte
  { mob: 'orc',       center: [44, 39],   radius: 9,  count: 8 },  // orcs solitaires (nord de WH)
  { mob: 'ogre',      center: [77, 105],  radius: 6,  count: 2 },  // ogres ignobles (SO de LH)
];

export function generateIsland1() {
  const rng = mulberry32(0xa7a4a5); // habillage : MÊME seed partout, toujours
  const height = new Float32Array(N * N);
  const tile = new Uint8Array(N * N);
  const walk = new Uint8Array(N * N);
  const props = [];
  const idx = (x, z) => z * N + x;
  const inMap = (x, z) => x >= 0 && z >= 0 && x < N && z < N;

  // tracé de la rivière : descend des monts Righul jusqu'à la côte sud
  const riverX = (z) => 56 + Math.round(5 * Math.sin(z * 0.07) - (z - 64) * 0.05);

  // --- 1. Altitude et masque de l'île ---
  // Île principale (deux lobes : Windhowl à l'ouest, Lighthaven au sud-est)
  // + île de l'Ermite au nord-est.
  const noise = [];
  for (let i = 0; i < 64; i++) noise.push(rng());
  const edgeNoise = (x, z) => noise[((x >> 3) * 7 + (z >> 3) * 13) % 64] * 0.12;
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      const dx = (x - 62) / 56, dz = (z - 68) / 58;
      const main = dx * dx + dz * dz + edgeNoise(x, z);
      const eh = Math.hypot(x - ARAKAS.ERMITE.x, z - ARAKAS.ERMITE.z);
      const isLand = main < 1 || eh < 7;
      let h = 0.1; // mer
      if (isLand) {
        h = 0.3 + (1 - Math.min(1, main)) * 0.12 + edgeNoise(z, x) * 0.3;
        if (z < 26) h += (26 - z) * 0.028;           // monts Righul au nord
        if (eh < 7) h = 0.32 + (7 - eh) * 0.02;      // île de l'Ermite
      }
      height[idx(x, z)] = h;
      tile[idx(x, z)] = isLand ? (h < 0.27 ? TILE.SAND : TILE.GRASS) : TILE.WATER;
    }
  }

  // gué de sable vers l'île de l'Ermite (le passage des brigands)
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    const gx = Math.round(104 + (ARAKAS.ERMITE.x - 104) * t);
    const gz = Math.round(34 + (ARAKAS.ERMITE.z + 4 - 34) * t);
    for (let d = -1; d <= 1; d++) {
      if (!inMap(gx + d, gz)) continue;
      tile[idx(gx + d, gz)] = TILE.SAND;
      height[idx(gx + d, gz)] = 0.24;
    }
  }

  // --- 2. La rivière (et sa vallée dans les monts) ---
  for (let z = 0; z < N; z++) {
    const rx = riverX(z);
    for (let d = -1; d <= 1; d++) {
      if (!inMap(rx + d, z)) continue;
      if (tile[idx(rx + d, z)] === TILE.WATER && z < 120) continue;
      tile[idx(rx + d, z)] = TILE.WATER;
      height[idx(rx + d, z)] = 0.12;
    }
    // berges de sable
    for (const d of [-2, 2]) {
      const i2 = idx(rx + d, z);
      if (inMap(rx + d, z) && tile[i2] !== TILE.WATER) tile[i2] = TILE.SAND;
    }
  }

  // --- 3. Monts Righul : roche infranchissable, sauf la passe de Jarko ---
  for (let z = 0; z < 24; z++) {
    for (let x = 0; x < N; x++) {
      const i2 = idx(x, z);
      if (tile[i2] === TILE.WATER) continue;
      const inPass = Math.abs(x - ARAKAS.JARKO.x) < 4 && z >= 12;        // passe d'accès
      const inValley = Math.abs(x - riverX(z)) < 5;                      // vallée de la rivière
      const pocket = Math.hypot(x - ARAKAS.JARKO.x, z - (ARAKAS.JARKO.z - 2)) < 5; // cirque de Jarko
      if (!inPass && !inValley && !pocket && z < 18 + edgeNoise(x, z) * 40) tile[i2] = TILE.ROCK;
    }
  }

  // --- 4. Forêts (patchs fixes, densité tirée du seed constant) ---
  const forests = [
    { x: 16, z: 60, r: 10 },  // grande forêt à l'ouest de Windhowl
    { x: 70, z: 96, r: 11 },  // bois entre LH et les ogres
    { x: 76, z: 40, r: 9 },   // bois de Lance Silversmith
    { x: 56, z: 36, r: 8 },   // rive est, au sud des monts
    { x: 36, z: 104, r: 9 },  // forêt côtière du sud-ouest
  ];
  for (const f of forests) {
    for (let z = f.z - f.r; z <= f.z + f.r; z++) {
      for (let x = f.x - f.r; x <= f.x + f.r; x++) {
        if (!inMap(x, z)) continue;
        const i2 = idx(x, z);
        if (tile[i2] !== TILE.GRASS) continue;
        if (Math.hypot(x - f.x, z - f.z) < f.r * (0.7 + rng() * 0.3)) tile[i2] = TILE.FOREST;
      }
    }
  }

  // --- 5. Cimetière de Lighthaven ---
  for (let z = ARAKAS.CIMETIERE.z - 7; z <= ARAKAS.CIMETIERE.z + 7; z++) {
    for (let x = ARAKAS.CIMETIERE.x - 8; x <= ARAKAS.CIMETIERE.x + 8; x++) {
      if (!inMap(x, z)) continue;
      const i2 = idx(x, z);
      if (tile[i2] !== TILE.WATER && tile[i2] !== TILE.ROCK && rng() < 0.75) tile[i2] = TILE.GRAVE;
    }
  }

  // --- 6. Places pavées et aplanissement des villes ---
  const flatten = (cx, cz, r, flat) => {
    for (let z = cz - r - 4; z <= cz + r + 4; z++) {
      for (let x = cx - r - 4; x <= cx + r + 4; x++) {
        if (!inMap(x, z)) continue;
        const d = Math.hypot(x - cx, z - cz);
        if (d < r + 4 && tile[idx(x, z)] !== TILE.WATER) {
          const t = Math.min(1, d / (r + 4));
          height[idx(x, z)] = flat * (1 - t * t) + height[idx(x, z)] * t * t;
        }
        if (d < r && tile[idx(x, z)] !== TILE.WATER) tile[idx(x, z)] = TILE.COBBLE;
      }
    }
  };
  flatten(ARAKAS.LH.x, ARAKAS.LH.z, 8, 0.34);
  flatten(ARAKAS.WH.x, ARAKAS.WH.z, 7, 0.33);
  flatten(ARAKAS.METIERS.x, ARAKAS.METIERS.z, 4, 0.33);

  // --- 7. Routes (et le pont gob sur la rivière) ---
  const road = (x0, z0, x1, z1) => {
    const steps = Math.ceil(Math.hypot(x1 - x0, z1 - z0) * 2);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const px = Math.round(x0 + (x1 - x0) * t + Math.sin(t * 8) * 1.2);
      const pz = Math.round(z0 + (z1 - z0) * t + Math.cos(t * 6) * 1.2);
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const X = px + dx, Z = pz + dz;
        if (!inMap(X, Z)) continue;
        const i2 = idx(X, Z);
        const isRiver = Math.abs(X - riverX(Z)) <= 1;
        if (tile[i2] === TILE.WATER && !isRiver) continue;   // pas de route en mer
        if (tile[i2] === TILE.COBBLE) continue;
        if (tile[i2] === TILE.WATER && isRiver) height[i2] = 0.3; // le pont
        tile[i2] = TILE.PATH;
      }
    }
  };
  road(ARAKAS.LH.x - 8, ARAKAS.LH.z, 60, ARAKAS.PONT.z);                       // LH -> pont gob
  road(60, ARAKAS.PONT.z, ARAKAS.WH.x + 7, ARAKAS.WH.z);                       // pont -> Windhowl
  road(ARAKAS.LH.x, ARAKAS.LH.z - 8, ARAKAS.MAGE_LH.x, ARAKAS.MAGE_LH.z);      // LH -> tour des mages
  road(ARAKAS.MAGE_LH.x, ARAKAS.MAGE_LH.z, ARAKAS.CIMETIERE.x - 4, ARAKAS.CIMETIERE.z + 4); // -> cimetière
  road(ARAKAS.MAGE_LH.x, ARAKAS.MAGE_LH.z, ARAKAS.LANCE.x, ARAKAS.LANCE.z);    // -> Lance Silversmith
  road(ARAKAS.LANCE.x, ARAKAS.LANCE.z, ARAKAS.JARKO.x, ARAKAS.JARKO.z + 2);    // -> grottes de Jarko
  road(ARAKAS.WH.x, ARAKAS.WH.z - 7, ARAKAS.ORCS.x, ARAKAS.ORCS.z + 4);        // WH -> orcs solitaires
  road(ARAKAS.LH.x, ARAKAS.LH.z + 8, ARAKAS.METIERS.x, ARAKAS.METIERS.z - 3);  // LH -> village des métiers
  road(ARAKAS.LH.x - 6, ARAKAS.LH.z + 6, ARAKAS.OGRES.x + 4, ARAKAS.OGRES.z - 4); // LH -> ogres
  road(ARAKAS.MAGE_LH.x + 6, ARAKAS.MAGE_LH.z - 4, 104, 34);                   // -> gué de l'Ermite

  // --- 8. Praticabilité ---
  for (let i = 0; i < N * N; i++) {
    const t = tile[i];
    walk[i] = (t === TILE.WATER || t === TILE.ROCK) ? 0 : 1;
  }
  const block = (x, z) => { if (inMap(x, z)) walk[idx(x, z)] = 0; };

  // --- 9. Bâtiments et décors ---
  const house = (x, z, w = 5, d = 4) => {
    props.push({ type: 'house', x: x + w / 2, z: z + d / 2, w, d, rot: 0, s: 1 });
    for (let dz = 0; dz < d; dz++) for (let dx = 0; dx < w; dx++) block(x + dx, z + dz);
  };
  const { LH, WH } = ARAKAS;

  // Lighthaven
  house(LH.x - 3, LH.z - 10, 6, 5);   // le temple (l'apparition se fait devant)
  house(LH.x + 6, LH.z - 6, 4, 4);    // la banque (à l'est du temple)
  house(LH.x + 7, LH.z + 1, 4, 4);    // l'Hôtel des Ventes (au sud de la banque)
  house(LH.x - 10, LH.z - 5, 4, 4);   // maison de Kalastor
  house(LH.x - 10, LH.z + 3, 4, 4);   // maison d'Edgar
  house(LH.x - 2, LH.z + 7, 5, 4);    // échoppe du marchand
  props.push({ type: 'well', x: LH.x + 0.5, z: LH.z + 0.5, rot: 0, s: 1 }); // la fontaine du dragon
  block(LH.x, LH.z);
  house(ARAKAS.MAGE_LH.x - 2, ARAKAS.MAGE_LH.z - 2, 4, 4);  // tour des mages d'Uranos
  house(ARAKAS.METIERS.x - 4, ARAKAS.METIERS.z - 2, 4, 4);  // village des métiers (Fulika)
  house(ARAKAS.METIERS.x + 1, ARAKAS.METIERS.z + 1, 4, 4);

  // Windhowl
  house(WH.x - 2, WH.z - 9, 5, 4);    // le temple
  house(WH.x - 4, WH.z - 15, 4, 4);   // maison de Lord Sunrock (au nord du temple)
  house(WH.x - 10, WH.z - 4, 4, 4);   // tour des mages (Liurn Clar)
  house(WH.x + 5, WH.z - 3, 5, 4);    // la taverne (coffres personnels)
  house(WH.x - 11, WH.z + 3, 4, 4);   // maison du bourgmestre (à l'ouest)
  house(WH.x + 2, WH.z + 6, 4, 4);    // échoppe de Ttayh Mark
  props.push({ type: 'well', x: WH.x + 0.5, z: WH.z + 0.5, rot: 0, s: 1 });
  block(WH.x, WH.z);

  // Maisons isolées
  house(ARAKAS.LANCE.x - 2, ARAKAS.LANCE.z - 2, 4, 4);   // Lance Silversmith
  house(ARAKAS.NILHEM.x - 2, ARAKAS.NILHEM.z - 2, 4, 4); // Nilhem, au nord du pont gob

  // Banques (coffre personnel) : LH près de l'HDV, WH devant la taverne
  const bank = (x, z) => { props.push({ type: 'bank', x: x + 0.5, z: z + 0.5, rot: 0, s: 1 }); block(x, z); };
  bank(LH.x + 6, LH.z + 6);
  bank(WH.x + 6, WH.z + 2);

  // Obélisques de téléportation : à l'est de chaque place
  const obelisk = (x, z) => { props.push({ type: 'obelisk', x: x + 0.5, z: z + 0.5, rot: 0, s: 1 }); block(x, z); };
  obelisk(LH.x + 12, LH.z + 2);
  obelisk(WH.x + 10, WH.z + 5);

  // Portail de l'Épreuve : devant les grottes de Jarko, dans les monts Righul
  props.push({ type: 'trialgate', x: ARAKAS.JARKO.x + 0.5, z: ARAKAS.JARKO.z + 0.5, rot: 0, s: 1 });
  block(ARAKAS.JARKO.x, ARAKAS.JARKO.z);

  // Coffres au trésor (7) : les caches célèbres d'Arakas
  const chests = [
    [WH.x - 12, WH.z + 8],                          // le coffre au diamant du bourgmestre
    [ARAKAS.ERMITE.x, ARAKAS.ERMITE.z],             // l'île de l'Ermite
    [ARAKAS.JARKO.x - 3, ARAKAS.JARKO.z - 3],       // le trésor de Jarko
    [ARAKAS.CIMETIERE.x + 5, ARAKAS.CIMETIERE.z - 6], // la crypte
    [70, 110],                                      // la cache des brigands (côte sud)
    [ARAKAS.LANCE.x + 5, ARAKAS.LANCE.z - 4],       // près de chez Lance
    [12, 84],                                       // la côte ouest, au-delà de WH
  ];
  for (const [cx, cz] of chests) {
    let x = cx, z = cz, tries = 0;
    while (!walk[idx(x, z)] && tries++ < 30) { x += (tries % 2 ? 1 : -1) * tries; }
    props.push({ type: 'chest', x: x + 0.5, z: z + 0.5, rot: 0, s: 1 });
  }

  // Torches : places, routes, pont
  const torches = [
    [LH.x - 6, LH.z - 6], [LH.x + 6, LH.z - 6], [LH.x - 6, LH.z + 6], [LH.x + 5, LH.z + 5],
    [WH.x - 5, WH.z - 5], [WH.x + 5, WH.z - 5], [WH.x - 5, WH.z + 5], [WH.x + 4, WH.z + 4],
    [60, ARAKAS.PONT.z - 2], [60, ARAKAS.PONT.z + 2],            // le pont gob
    [ARAKAS.MAGE_LH.x + 2, ARAKAS.MAGE_LH.z], [ARAKAS.LANCE.x + 2, ARAKAS.LANCE.z],
    [ARAKAS.JARKO.x + 2, ARAKAS.JARKO.z + 2], [ARAKAS.METIERS.x + 3, ARAKAS.METIERS.z],
  ];
  for (const [tx, tz] of torches) props.push({ type: 'torch', x: tx + 0.5, z: tz + 0.5, rot: 0, s: 1 });

  // --- 10. Arbres, rochers, tombes (habillage, seed constant) ---
  for (let z = 1; z < N - 1; z++) {
    for (let x = 1; x < N - 1; x++) {
      const i2 = idx(x, z);
      if (!walk[i2]) continue;
      const t = tile[i2];
      const r = rng();
      if (t === TILE.FOREST && r < 0.16) {
        props.push({ type: 'tree', x: x + 0.5, z: z + 0.5, rot: rng() * Math.PI * 2, s: 0.8 + rng() * 0.7 });
        walk[i2] = 0;
      } else if (t === TILE.GRASS && r < 0.010) {
        props.push({ type: 'tree', x: x + 0.5, z: z + 0.5, rot: rng() * Math.PI * 2, s: 0.8 + rng() * 0.5 });
        walk[i2] = 0;
      } else if ((t === TILE.GRASS || t === TILE.SAND) && r >= 0.010 && r < 0.018) {
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
    spawnPoint: { x: LH.x + 0.5, z: LH.z - 4.5 },   // devant le temple de Lighthaven
    village: { x: LH.x, z: LH.z },
    // les marchands : Maître Aldric à Lighthaven, Ttayh Mark à Windhowl
    npcSpots: [
      { npcId: 'merchant', x: LH.x - 1.5, z: LH.z + 6.5 },
      { npcId: 'merchant_wh', x: WH.x + 3.5, z: WH.z + 5.5 },
    ],
    spawnZones: ARAKAS_SPAWNS,
    isWalkable(x, z) {
      const X = Math.floor(x), Z = Math.floor(z);
      if (X < 0 || Z < 0 || X >= N || Z >= N) return false;
      return walk[Z * N + X] === 1;
    },
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
