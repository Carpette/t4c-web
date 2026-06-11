// Arakas — zone 0, fidèle à la carte officielle « Arakas Classic » (T4C).
// Géographie encodée en coordonnées TUILES (grille 384×384, x vers l'est,
// z vers le sud), relevées sur la carte de référence
// (docs/arakas-classic-reference.md) :
//   - CONTINENT central (~x 80-330, z 50-340) : plateau désertique au NO
//     (grottes A-E, caverne de Jarko et son portail de l'Épreuve, Gorben le
//     Fou), crypte du Nomade et camp de la gitane au nord, camp des Druides
//     et commandant Owain au NE, Cité en Ruines, camp Orc, Lance Silversmith,
//     Temple Ancien, Tablette runique, Labyrinthe de Feylor au centre, cave
//     des Kraaniens à l'ouest, Thieve's Town et cave des Brigands au sud,
//     WINDHOWL (ville fortifiée) au SO, ravisseurs du Grand Prêtre et camps
//     de mercenaires à l'est.
//   - Île de LIGHTHAVEN au SE : la zone de départ. Ses côtes sont
//     intégralement de SABLE jaune ; ses seules sorties à pied sont deux
//     ponts de bois, au NORD et à l'OUEST (directives 1 et 2).
//   - Île du château d'Orkanis au NO (le Troll), reliée par un isthme de
//     sable.
//   - Îles STRICTEMENT INATTEIGNABLES à pied, ceintes d'une douve marine
//     forcée : Olin Haad (téléportation de quête à venir — directive 3),
//     Hermit's Island, Stonehenge, la tour des Sorts, l'îlot Feylor Est.
// Carte FIXE : seul l'habillage (arbres, rochers, touffes) est tiré d'un seed
// constant, identique côté client et serveur.
import { TILE, mulberry32 } from './worldgen.js';

const N = 384;

// ---------------------------------------------------------------- utilitaires
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

function pointInPoly(u, v, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if ((yi > v) !== (yj > v) && u < ((xj - xi) * (v - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// ------------------------------------------------------------------ géographie
// Côte du continent principal (sens horaire, en tuiles)
const COAST = [
  [84, 64], [96, 50], [130, 42], [170, 46], [205, 40], [245, 40], [285, 38],
  [320, 44], [352, 50], [372, 62], [376, 80], [368, 92], [352, 96], [344, 112],
  [358, 120], [357, 130], [342, 138], [330, 150], [318, 162], [314, 188],
  [324, 198], [332, 202], [338, 212], [322, 218], [302, 224], [292, 236],
  [290, 250], [292, 262], [296, 282], [300, 300], [290, 322], [262, 336],
  [220, 342], [170, 338], [120, 334], [84, 322], [58, 300], [40, 282],
  [42, 250], [60, 232], [74, 210], [70, 180], [82, 150], [76, 120],
  [84, 100], [78, 80],
];
// Île de Lighthaven (zone de départ, au SE)
const LH_COAST = [
  [303, 249], [306, 240], [315, 234], [322, 228], [340, 227], [352, 232],
  [363, 240], [370, 250], [368, 261], [360, 271], [350, 280], [337, 286],
  [322, 282], [311, 272], [305, 261],
];
// îles : { name, c, rx, rz, iso } — iso = inatteignable à pied (douve forcée)
const ISLANDS = [
  { name: 'orkanis',    c: [38, 84],   rx: 16, rz: 14 },             // château d'Orkanis (le Troll)
  { name: 'hermit',     c: [338, 165], rx: 12, rz: 10, iso: true },  // Hermit's Island
  { name: 'stonehenge', c: [372, 200], rx: 5,  rz: 4,  iso: true },
  { name: 'spelltower', c: [372, 217], rx: 5,  rz: 4,  iso: true },  // la tour des Sorts
  { name: 'olinhaad',   c: [350, 300], rx: 9,  rz: 8,  iso: true },  // Olin Haad (quête/téléport)
  { name: 'feylor_e',   c: [365, 105], rx: 6,  rz: 5,  iso: true },  // îlot Feylor Est
];
const MOAT = 6; // largeur de la douve marine forcée autour des îles « iso »
// Détroits forcés en EAU autour de Lighthaven : les ponts N et O sont les
// SEULES sorties de l'île, quoi que fasse le bruit de côte (directive 2)
const STRAITS = [
  { x0: 292, z0: 227, x1: 302, z1: 282 }, // détroit ouest
  { x0: 303, z0: 218, x1: 348, z1: 226 }, // détroit nord
];
// passages au-dessus de l'eau : [de, à, largeur, style]
// style 'sand' = gué/isthme de sable ; 'bridge' = pont de bois (platelage)
const CAUSEWAYS = [
  [[54, 88], [84, 95], 1.6, 'sand'],       // isthme de sable d'Orkanis
  [[288, 251], [307, 251], 1.0, 'bridge'], // le pont OUEST de Lighthaven
  [[320, 210], [320, 234], 1.0, 'bridge'], // le pont NORD de Lighthaven
];
// Plateau désertique du nord-ouest (sable aride, affleurements et falaises)
const DESERT = [
  [86, 76], [100, 52], [136, 46], [176, 52], [184, 92], [176, 128],
  [152, 146], [112, 150], [88, 132], [80, 102],
];
// amas rocheux : [x, z, r] — adossent les entrées de grottes
const ROCK_CLUSTERS = [
  [80, 83, 4], [107, 75, 4], [88, 102, 4], [111, 102, 4], [134, 59, 4],
  [153, 67, 4],                  // grottes A-E et Jarko (désert)
  [118, 173, 4],                 // cave des Kraaniens
  [219, 79, 3],                  // crypte du Nomade
  [188, 325, 3],                 // cave des Brigands
  [210, 205, 3],                 // Labyrinthe de Feylor
  [353, 121, 3],                 // Labyrinthe de Feylor Est
  [38, 84, 6],                   // le château d'Orkanis
];
// forêts : [x, z, r]
const FORESTS = [
  [250, 70, 14], [300, 75, 12],                  // forêts du nord-est
  [260, 160, 12], [240, 130, 10],                // centre-est
  [160, 200, 14], [140, 230, 12], [100, 240, 10],// centre-ouest
  [230, 230, 14], [200, 250, 10],
  [120, 300, 14], [220, 310, 12], [260, 300, 10],// sud
  [338, 165, 11],                                // Hermit's Island (végétation dense)
  [365, 105, 5],                                 // îlot Feylor Est (sombre)
];
// lacs : [x, z, r]
const LAKES = [
  [173, 124, 7],   // le lac de l'échoppe d'armes n°2
];
// rivières (polylignes, ~1,5 tuile de large) — les routes y posent des ponts
const RIVERS = [
  [[173, 128], [178, 150], [172, 175], [165, 205], [170, 240], [176, 265], [172, 295], [178, 320], [182, 342]],
  [[180, 126], [205, 122], [228, 128], [252, 140], [262, 165], [258, 195], [270, 220], [284, 232], [296, 240]],
];
// cimetières (tuiles GRAVE) : [x, z, r]
const GRAVEYARDS = [
  [219, 81, 5],    // crypte du Nomade
  [300, 108, 5],   // Cité en Ruines
];

// Points d'intérêt (coordonnées tuiles, relevées sur la carte de référence)
export const ARAKAS = {
  // villes
  LH: { x: 332, z: 252 },           // place de la fontaine de Lighthaven (départ)
  WH: { x: 70, z: 276 },            // place de Windhowl
  TEMPLE_WH: { x: 65, z: 251 },     // temple de Windhowl (hors les murs, au nord)
  HEL: { x: 64, z: 241 },           // Hel
  VOLEURS: { x: 186, z: 284 },      // Thieve's Town
  // plateau désertique du nord-ouest
  JARKO: { x: 107, z: 77 },         // caverne de Jarko (portail de l'Épreuve)
  CAVE_A: { x: 80, z: 85 }, CAVE_B: { x: 88, z: 104 }, CAVE_C: { x: 111, z: 104 },
  CAVE_D: { x: 134, z: 61 }, CAVE_E: { x: 153, z: 69 },
  GORBEN: { x: 142, z: 115 },       // Gorben le Fou
  // nord et centre
  NOMADE: { x: 219, z: 81 },        // crypte du Nomade
  GITANE: { x: 227, z: 100 },       // camp de la gitane
  MADS: { x: 250, z: 50 },          // la maison du Fou
  WS1: { x: 207, z: 50 },           // échoppe d'armes n°1
  WS2: { x: 180, z: 135 },          // échoppe d'armes n°2 (au bord du lac)
  DRUIDES: { x: 330, z: 58 },       // camp des Druides
  OWAIN: { x: 369, z: 77 },         // commandant Owain
  ANCIENT: { x: 219, z: 146 },      // le Temple Ancien
  TABLET: { x: 215, z: 173 },       // Tablette de pierre runique (cercle de transfert)
  ANTONIAN: { x: 227, z: 184 },     // l'ermite Antonian
  LABYRINTHE: { x: 210, z: 207 },   // le Labyrinthe de Feylor
  KRAANIAN: { x: 118, z: 175 },     // cave des Kraaniens
  RUINED: { x: 300, z: 108 },       // la Cité en Ruines (Weapon Crafter)
  CAMP_ORC: { x: 280, z: 127 },     // camp Orc (Roshnak Tul, Araf Kul)
  LANCE: { x: 284, z: 169 },        // Lance Silversmith
  FEYLOR_LAB_E: { x: 353, z: 123 }, // Labyrinthe de Feylor Est
  // sud et est
  BRIGANDS: { x: 188, z: 327 },     // cave des Brigands
  HP_CAPTORS: { x: 273, z: 273 },   // ravisseurs du Grand Prêtre
  MERC_LEAD: { x: 300, z: 207 },    // chef des mercenaires
  MERC_1: { x: 316, z: 205 },       // camp de mercenaires (continent)
  MERC_2: { x: 357, z: 237 },       // camp de mercenaires (côte NE de Lighthaven)
  MERC_3: { x: 283, z: 245 },       // camp de mercenaires (tête du pont ouest)
  // îles
  TROLL: { x: 38, z: 84 },          // château d'Orkanis (le Troll)
  HERMIT: { x: 338, z: 165 },       // Hermit's Island (inatteignable)
  STONEHENGE: { x: 372, z: 200 },   // Stonehenge (inatteignable)
  SPELLTOWER: { x: 372, z: 217 },   // la tour des Sorts (inatteignable)
  OLIN: { x: 350, z: 300 },         // Olin Haad (téléportation de quête uniquement)
  FEYLOR_ISLE: { x: 365, z: 105 },  // îlot Feylor Est (inatteignable)
  // quartiers de Lighthaven
  METIERS: { x: 323, z: 273 },      // village des métiers
  RESIDENTIEL: { x: 315, z: 264 },  // quartier résidentiel
};

// routes (polylignes, en tuiles) — suivent le réseau de la carte de référence
const ROADS = [
  // Lighthaven interne : place -> pont ouest ; place -> pont nord
  [[326, 252], [316, 252], [307, 251]],
  [[330, 247], [324, 242], [320, 236], [320, 233]],
  // pont ouest -> ravisseurs du Grand Prêtre -> Thieve's Town -> Windhowl
  [[288, 251], [280, 256], [274, 264], [273, 273], [250, 278], [224, 282], [204, 284], [186, 284], [160, 283], [128, 279], [96, 275]],
  // pont nord -> chef des mercenaires
  [[320, 212], [312, 203], [303, 205], [300, 207]],
  // chef des mercenaires -> Lance Silversmith -> camp Orc -> Cité en Ruines
  [[300, 207], [290, 188], [284, 169]],
  [[284, 169], [281, 148], [280, 127]],
  [[280, 127], [290, 116], [300, 108]],
  // Cité en Ruines -> Labyrinthe de Feylor Est
  [[300, 108], [320, 112], [338, 117], [353, 123]],
  // la grand-route du nord : échoppe n°1 -> maison du Fou -> Druides -> Owain
  [[207, 50], [228, 48], [250, 50]],
  [[250, 50], [285, 52], [312, 55], [330, 58]],
  [[330, 58], [350, 66], [366, 75], [369, 77]],
  // échoppe n°1 -> crypte du Nomade -> camp de la gitane -> camp Orc
  [[207, 50], [212, 64], [219, 79]],
  [[219, 83], [224, 92], [227, 100]],
  [[227, 100], [247, 110], [264, 119], [280, 127]],
  // camp de la gitane -> Temple Ancien -> échoppe n°2 (lac)
  [[227, 100], [222, 124], [219, 146]],
  [[219, 146], [200, 141], [182, 137]],
  // routes du désert : lac -> Gorben -> grottes C, B, A -> Jarko -> D -> E
  [[180, 135], [161, 125], [144, 117]],
  [[142, 115], [128, 110], [113, 105]],
  [[111, 104], [99, 106], [90, 105]],
  [[88, 104], [82, 96], [80, 87]],
  [[80, 85], [93, 80], [104, 77]],
  [[110, 76], [121, 68], [134, 62]],
  [[134, 61], [144, 64], [153, 69]],
  // grotte B -> isthme d'Orkanis, puis la route du Troll sur l'île
  [[88, 104], [86, 98], [84, 95]],
  [[54, 89], [46, 86], [40, 84]],
  // Temple Ancien -> Tablette runique -> Antonian -> Labyrinthe de Feylor
  [[219, 146], [216, 160], [215, 173]],
  [[215, 173], [221, 179], [227, 184]],
  [[227, 184], [217, 196], [210, 207]],
  // Tablette runique -> cave des Kraaniens
  [[215, 173], [190, 170], [160, 172], [135, 174], [118, 175]],
  // cave des Kraaniens -> Windhowl (le long de la côte ouest)
  [[118, 175], [103, 177], [95, 190], [90, 212], [93, 240], [96, 262], [96, 275]],
  // Labyrinthe -> chef des mercenaires ; Labyrinthe -> route du sud
  [[210, 207], [240, 206], [268, 206], [296, 207], [300, 207]],
  [[210, 207], [202, 232], [194, 256], [187, 272], [186, 283]],
  // Thieve's Town -> cave des Brigands
  [[186, 285], [184, 306], [188, 325]],
  // Windhowl -> temple et Hel (hors les murs, au nord)
  [[95, 274], [86, 262], [74, 256], [68, 249], [64, 244]],
  // Lighthaven : place -> métiers ; place -> résidentiel ; place -> champs ;
  // obélisque -> camp de mercenaires de la côte NE
  [[332, 259], [329, 266], [324, 272]],
  [[327, 257], [320, 261], [315, 264]],
  [[338, 257], [343, 263]],
  [[346, 250], [352, 243], [357, 238]],
];

// Spots de monstres, fidèles aux camps de la carte. La progression suit la
// géographie : niveaux 1-5 autour de Lighthaven et des ponts, 5-10 au centre
// et au sud, 12+ au nord, 18+ dans le désert et sur Orkanis.
// (aggro + errance ≈ 12 tuiles : les villes restent hors d'atteinte)
const ARAKAS_SPAWNS = [
  { mob: 'rat',       center: [343, 275], radius: 5,  count: 7 },  // au sud des champs de Lighthaven (hors enclos : ligne de vue dégagée)
  { mob: 'rat',       center: [283, 245], radius: 6,  count: 6 },  // tête du pont ouest
  { mob: 'rat',       center: [320, 205], radius: 5,  count: 5 },  // tête du pont nord
  { mob: 'serpent',   center: [357, 237], radius: 5,  count: 4 },  // côte NE de LH (mercenaires)
  { mob: 'serpent',   center: [273, 279], radius: 6,  count: 5 },  // ravisseurs du Grand Prêtre
  { mob: 'serpent',   center: [296, 290], radius: 6,  count: 4 },  // côte sud-est
  { mob: 'gobelin',   center: [186, 284], radius: 9,  count: 10 }, // Thieve's Town
  { mob: 'gobelin',   center: [188, 320], radius: 6,  count: 5 },  // cave des Brigands
  { mob: 'gobelin',   center: [118, 182], radius: 6,  count: 5 },  // cave des Kraaniens
  { mob: 'squelette', center: [219, 81],  radius: 8,  count: 10 }, // crypte du Nomade
  { mob: 'squelette', center: [219, 146], radius: 7,  count: 6 },  // le Temple Ancien
  { mob: 'zombie',    center: [225, 88],  radius: 6,  count: 5 },  // crypte du Nomade
  { mob: 'zombie',    center: [300, 108], radius: 6,  count: 4 },  // Cité en Ruines
  { mob: 'orc',       center: [280, 127], radius: 9,  count: 10 }, // camp Orc (Roshnak Tul)
  { mob: 'orc',       center: [353, 123], radius: 6,  count: 4 },  // Labyrinthe de Feylor Est
  { mob: 'ogre',      center: [136, 54],  radius: 5,  count: 2 },  // hauts du désert (grotte D)
  { mob: 'ogre',      center: [38, 84],   radius: 5,  count: 2 },  // Orkanis (le Troll)
  { mob: 'ogre',      center: [210, 200], radius: 4,  count: 1 },  // gardien du Labyrinthe
];

// ------------------------------------------------------------------ générateur
export function generateIsland1() {
  const rng = mulberry32(0xa7a4a5);
  const n1 = makeNoise(rng, 32), n2 = makeNoise(rng, 64);
  const height = new Float32Array(N * N);
  const tile = new Uint8Array(N * N);
  const walk = new Uint8Array(N * N);
  const river = new Uint8Array(N * N); // eau douce (les routes y posent des ponts)
  const props = [];
  const idx = (x, z) => z * N + x;
  const inMap = (x, z) => x >= 0 && z >= 0 && x < N && z < N;

  // --- 1. terre / mer (polygones + bruit de côte) ---
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      // léger déplacement par bruit : côtes naturelles (±~2,7 tuiles)
      const u = x + (n1(x * 0.11, z * 0.11) - 0.5) * 5.4;
      const v = z + (n1(x * 0.11 + 40, z * 0.11 + 40) - 0.5) * 5.4;
      let land = pointInPoly(u, v, COAST) || pointInPoly(u, v, LH_COAST);
      if (!land) {
        for (const isl of ISLANDS) {
          const du = (u - isl.c[0]) / isl.rx, dv = (v - isl.c[1]) / isl.rz;
          if (du * du + dv * dv < 1) { land = true; break; }
        }
      }
      tile[idx(x, z)] = land ? TILE.GRASS : TILE.WATER;
    }
  }

  // --- 1 bis. douves marines des îles isolées + détroits de Lighthaven ---
  // (le bruit de côte ne peut JAMAIS créer de passage : l'eau y est forcée)
  for (const isl of ISLANDS) {
    if (!isl.iso) continue;
    const R = Math.max(isl.rx, isl.rz) + MOAT + 2;
    for (let z = Math.max(0, isl.c[1] - R); z <= Math.min(N - 1, isl.c[1] + R); z++) {
      for (let x = Math.max(0, isl.c[0] - R); x <= Math.min(N - 1, isl.c[0] + R); x++) {
        const du = (x - isl.c[0]) / isl.rx, dv = (z - isl.c[1]) / isl.rz;
        const ed = Math.sqrt(du * du + dv * dv);
        if (ed > 1 && (ed - 1) * Math.min(isl.rx, isl.rz) < MOAT) tile[idx(x, z)] = TILE.WATER;
      }
    }
  }
  for (const s of STRAITS) {
    for (let z = s.z0; z <= s.z1; z++) for (let x = s.x0; x <= s.x1; x++) {
      if (inMap(x, z)) tile[idx(x, z)] = TILE.WATER;
    }
  }

  // --- 2. gués de sable et ponts (relient les îles, jamais bloqués) ---
  const stampLine = (pts, w, fn) => {
    for (let i = 1; i < pts.length; i++) {
      const [x0, z0] = pts[i - 1], [x1, z1] = pts[i];
      const steps = Math.ceil(Math.hypot(x1 - x0, z1 - z0) * 1.5);
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const px = x0 + (x1 - x0) * t, pz = z0 + (z1 - z0) * t;
        const r = Math.ceil(w);
        for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dz * dz > w * w + 0.5) continue;
          const X = Math.round(px + dx), Z = Math.round(pz + dz);
          if (inMap(X, Z)) fn(X, Z);
        }
      }
    }
  };
  // sur la terre : sable ; au-dessus de la mer : pont de bois ou gué de sable
  const bridgeTiles = [];
  for (const [a, b, w, style] of CAUSEWAYS) {
    stampLine([a, b], w, (X, Z) => {
      const i = idx(X, Z);
      if (tile[i] === TILE.WATER) {
        if (style === 'bridge') { tile[i] = TILE.PATH; bridgeTiles.push([X, Z]); }
        else tile[i] = TILE.SAND;
      } else if (tile[i] !== TILE.PATH) {
        tile[i] = TILE.SAND;
      }
    });
  }

  // --- 3. lacs et rivières (eau douce) ---
  const stampWater = (X, Z) => {
    if (tile[idx(X, Z)] !== TILE.WATER) { tile[idx(X, Z)] = TILE.WATER; river[idx(X, Z)] = 1; }
  };
  for (const [u, v, r] of LAKES) {
    for (let z = Math.floor(v - r); z <= v + r; z++) for (let x = Math.floor(u - r); x <= u + r; x++) {
      if (inMap(x, z) && Math.hypot(x - u, z - v) < r * (0.82 + n2(x * 0.2, z * 0.2) * 0.35)) stampWater(x, z);
    }
  }
  for (const riv of RIVERS) stampLine(riv, 1.5, stampWater);

  // --- 4. plateau désertique du NO + amas rocheux ---
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      const i = idx(x, z);
      if (tile[i] === TILE.WATER) continue;
      const u = x + (n1(x * 0.15, z * 0.15) - 0.5) * 7;
      const v = z + (n1(x * 0.15 + 9, z * 0.15 + 9) - 0.5) * 7;
      if (pointInPoly(u, v, DESERT)) {
        if (tile[i] === TILE.GRASS) tile[i] = TILE.SAND;
        // affleurements rocheux épars (falaises du plateau)
        if (tile[i] === TILE.SAND && n2(x * 0.07, z * 0.07) > 0.80) tile[i] = TILE.ROCK;
      }
    }
  }
  for (const [cx, cz, rr] of ROCK_CLUSTERS) {
    for (let z = Math.floor(cz - rr * 1.5); z <= cz + rr * 1.5; z++) for (let x = Math.floor(cx - rr * 1.5); x <= cx + rr * 1.5; x++) {
      if (!inMap(x, z) || tile[idx(x, z)] === TILE.WATER) continue;
      if (Math.hypot(x - cx, z - cz) < rr * (0.5 + n2(x * 0.3, z * 0.3) * 0.8)) tile[idx(x, z)] = TILE.ROCK;
    }
  }
  // poche dégagée au cœur d'Orkanis (le repaire du Troll reste accessible)
  {
    const p = ARAKAS.TROLL;
    for (let z = p.z - 6; z <= p.z + 6; z++) for (let x = p.x - 7; x <= p.x + 7; x++) {
      if (inMap(x, z) && Math.hypot(x - p.x, z - p.z) < 6 && tile[idx(x, z)] === TILE.ROCK) {
        tile[idx(x, z)] = TILE.GRASS;
      }
    }
  }
  // cirque de Jarko (poche dégagée autour du portail de l'Épreuve)
  {
    const { x: jx, z: jz } = ARAKAS.JARKO;
    for (let z = jz - 5; z <= jz + 5; z++) for (let x = jx - 6; x <= jx + 6; x++) {
      if (inMap(x, z) && Math.hypot(x - jx, z - jz) < 4.5 && tile[idx(x, z)] === TILE.ROCK) tile[idx(x, z)] = TILE.PATH;
    }
  }

  // --- 5. forêts ---
  for (const [u, v, r] of FORESTS) {
    for (let z = Math.floor(v - r); z <= v + r; z++) for (let x = Math.floor(u - r); x <= u + r; x++) {
      if (!inMap(x, z)) continue;
      const i = idx(x, z);
      if (tile[i] !== TILE.GRASS) continue;
      if (Math.hypot(x - u, z - v) < r * (0.55 + n2(x * 0.13, z * 0.13) * 0.65)) tile[i] = TILE.FOREST;
    }
  }

  // --- 6. cimetières ---
  for (const [u, v, r] of GRAVEYARDS) {
    for (let z = Math.floor(v - r); z <= v + r; z++) for (let x = Math.floor(u - r); x <= u + r; x++) {
      if (!inMap(x, z)) continue;
      const i = idx(x, z);
      if (tile[i] !== TILE.WATER && tile[i] !== TILE.ROCK && Math.hypot(x - u, z - v) < r && rng() < 0.8) tile[i] = TILE.GRAVE;
    }
  }

  // --- 7. les villes (pavage ; les bâtiments suivent en props) ---
  const flatten = []; // zones à aplatir pour le relief
  const plaza = (cx, cz, r) => {
    for (let z = cz - r; z <= cz + r; z++) for (let x = cx - r; x <= cx + r; x++) {
      if (inMap(x, z) && Math.hypot(x - cx, z - cz) < r && tile[idx(x, z)] !== TILE.WATER) tile[idx(x, z)] = TILE.COBBLE;
    }
    flatten.push([cx, cz, r + 5]);
  };
  const cobbleRect = (x0, z0, x1, z1) => {
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      if (inMap(x, z) && tile[idx(x, z)] !== TILE.WATER) tile[idx(x, z)] = TILE.COBBLE;
    }
    flatten.push([(x0 + x1) >> 1, (z0 + z1) >> 1, Math.max(x1 - x0, z1 - z0) / 2 + 6]);
  };
  const { LH, WH } = ARAKAS;
  // Lighthaven : place de la fontaine + parvis du temple
  plaza(LH.x, LH.z, 7);
  cobbleRect(LH.x - 3, LH.z - 14, LH.x + 3, LH.z - 7); // allée du temple
  // Windhowl : ville fortifiée en damier, tout l'intérieur est pavé
  const WHX0 = WH.x - 22, WHZ0 = WH.z - 15, WHX1 = WH.x + 22, WHZ1 = WH.z + 13;
  cobbleRect(WHX0, WHZ0, WHX1, WHZ1);
  // village des métiers et quartier résidentiel (LH)
  plaza(ARAKAS.METIERS.x, ARAKAS.METIERS.z, 4);
  plaza(ARAKAS.RESIDENTIEL.x, ARAKAS.RESIDENTIEL.z, 4);
  // Olin Haad : le parvis du temple carré (visible de loin, jamais foulé)
  cobbleRect(ARAKAS.OLIN.x - 4, ARAKAS.OLIN.z - 4, ARAKAS.OLIN.x + 4, ARAKAS.OLIN.z + 4);

  // --- 8. routes (avec ponts automatiques sur l'eau douce) ---
  for (const road of ROADS) {
    stampLine(road, 1.2, (X, Z) => {
      const i = idx(X, Z);
      if (tile[i] === TILE.COBBLE) return;
      if (tile[i] === TILE.WATER) {
        if (river[i]) { tile[i] = TILE.PATH; river[i] = 0; bridgeTiles.push([X, Z]); } // pont de bois
        return; // jamais de route en mer
      }
      if (tile[i] === TILE.ROCK) { tile[i] = TILE.PATH; return; } // cols taillés
      tile[i] = TILE.PATH;
    });
  }

  // --- 9. plages : sable en bord de mer ---
  const isSea = (x, z) => !inMap(x, z) || (tile[idx(x, z)] === TILE.WATER && !river[idx(x, z)]);
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      const i = idx(x, z);
      if (tile[i] !== TILE.GRASS && tile[i] !== TILE.FOREST) continue;
      if (isSea(x + 1, z) || isSea(x - 1, z) || isSea(x, z + 1) || isSea(x, z - 1)
        || isSea(x + 1, z + 1) || isSea(x - 1, z - 1) || isSea(x + 1, z - 1) || isSea(x - 1, z + 1)) {
        tile[i] = TILE.SAND;
      }
    }
  }

  // --- 9 bis. directive 1 : TOUTE la côte de l'île de Lighthaven est en SABLE ---
  // On isole la masse de terre de LH (remplissage depuis la place, sans
  // traverser les ponts) puis on ensable chaque tuile de terre en bord de mer.
  {
    const bridgeSet = new Set(bridgeTiles.map(([x, z]) => z * N + x));
    const mask = new Uint8Array(N * N);
    const stack = [idx(LH.x, LH.z)];
    mask[stack[0]] = 1;
    while (stack.length) {
      const i = stack.pop();
      const x = i % N, z = (i / N) | 0;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const X = x + dx, Z = z + dz;
        if (!inMap(X, Z)) continue;
        const j = idx(X, Z);
        if (mask[j] || tile[j] === TILE.WATER || bridgeSet.has(j)) continue;
        mask[j] = 1; stack.push(j);
      }
    }
    for (let z = 0; z < N; z++) {
      for (let x = 0; x < N; x++) {
        const i = idx(x, z);
        if (!mask[i]) continue;
        let coast = false;
        for (let dz = -1; dz <= 1 && !coast; dz++) for (let dx = -1; dx <= 1; dx++) {
          if (isSea(x + dx, z + dz)) { coast = true; break; }
        }
        if (coast) tile[i] = TILE.SAND;
      }
    }
  }

  // --- 10. relief ---
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      const i = idx(x, z);
      const t = tile[i];
      if (t === TILE.WATER) { height[i] = river[i] ? 0.14 : 0.10; continue; }
      let h = 0.30 + n2(x * 0.04, z * 0.04) * 0.08;
      if (t === TILE.ROCK) h = 0.52 + n2(x * 0.08, z * 0.08) * 0.30;
      height[i] = h;
    }
  }
  for (const [cx, cz, r] of flatten) {
    for (let z = cz - r; z <= cz + r; z++) for (let x = cx - r; x <= cx + r; x++) {
      if (!inMap(x, z)) continue;
      const d = Math.hypot(x - cx, z - cz);
      if (d < r && tile[idx(x, z)] !== TILE.WATER) {
        const t = Math.min(1, d / r);
        height[idx(x, z)] = 0.32 * (1 - t * t) + height[idx(x, z)] * t * t;
      }
    }
  }

  // --- 11. praticabilité ---
  for (let i = 0; i < N * N; i++) {
    const t = tile[i];
    walk[i] = (t === TILE.WATER || t === TILE.ROCK) ? 0 : 1;
  }
  const block = (x, z) => { if (inMap(x, z)) walk[idx(x, z)] = 0; };

  // --- 12. bâtiments et décors ---
  const house = (x, z, w = 5, d = 4) => {
    props.push({ type: 'house', x: x + w / 2, z: z + d / 2, w, d, rot: 0, s: 1 });
    for (let dz = 0; dz < d; dz++) for (let dx = 0; dx < w; dx++) block(x + dx, z + dz);
  };
  const bigHouse = (x, z) => { house(x, z, 5, 4); house(x + 5, z, 5, 4); }; // temple, etc.
  const torch = (x, z) => props.push({ type: 'torch', x: x + 0.5, z: z + 0.5, rot: 0, s: 1 });
  const bank = (x, z) => { props.push({ type: 'bank', x: x + 0.5, z: z + 0.5, rot: 0, s: 1 }); block(x, z); };
  const obelisk = (x, z) => { props.push({ type: 'obelisk', x: x + 0.5, z: z + 0.5, rot: 0, s: 1 }); block(x, z); };
  const chest = (x, z) => {
    let X = x, Z = z, tries = 0;
    while (!walk[idx(X, Z)] && tries++ < 40) { X += (tries % 2 ? 1 : -1) * tries; if (!inMap(X, Z)) X = x; }
    props.push({ type: 'chest', x: X + 0.5, z: Z + 0.5, rot: 0, s: 1 });
  };
  const cave = (x, z, name) => {
    let X = x, Z = z, tries = 0;
    // l'entrée se pose sur une case praticable (au bord de la roche)
    while (!walk[idx(X, Z)] && tries++ < 40) { Z += 1; if (!inMap(X, Z)) Z = z; }
    props.push({ type: 'cave', x: X + 0.5, z: Z + 0.5, rot: 0, s: 1, name });
    block(X, Z);
  };
  const well = (x, z) => { props.push({ type: 'well', x: x + 0.5, z: z + 0.5, rot: 0, s: 1 }); block(x, z); };
  // remparts (palissade), clôtures et ruines
  const wall = (x, z, v = 'seg') => { props.push({ type: 'wall', x: x + 0.5, z: z + 0.5, v, rot: 0, s: 1 }); block(x, z); };
  const fence = (x, z, v = 'x') => { props.push({ type: 'fence', x: x + 0.5, z: z + 0.5, v, rot: 0, s: 1 }); block(x, z); };
  const ruin = (x, z) => { props.push({ type: 'ruin', x: x + 0.5, z: z + 0.5, rot: 0, s: 1 }); block(x, z); };
  // enclos rectangulaire en barrières, avec une ouverture par côté indiqué
  const paddock = (x0, z0, x1, z1, gates = []) => {
    for (let x = x0; x <= x1; x++) {
      if (!gates.includes('n') || Math.abs(x - (x0 + x1) / 2) > 1) fence(x, z0, 'x');
      if (!gates.includes('s') || Math.abs(x - (x0 + x1) / 2) > 1) fence(x, z1, 'x');
    }
    for (let z = z0 + 1; z < z1; z++) {
      if (!gates.includes('w') || Math.abs(z - (z0 + z1) / 2) > 1) fence(x0, z, 'z');
      if (!gates.includes('e') || Math.abs(z - (z0 + z1) / 2) > 1) fence(x1, z, 'z');
    }
  };

  // ---------- LIGHTHAVEN ----------
  {
    const c = LH;
    bigHouse(c.x - 5, c.z - 19);                  // le temple (l'apparition se fait sur le parvis)
    house(c.x - 13, c.z - 16);                    // échoppe d'armes (Maître Aldric)
    house(c.x - 14, c.z - 9);                     // armures & potions
    house(c.x - 2, c.z - 6, 6, 4);                // salle d'entraînement
    house(c.x + 9, c.z - 6, 5, 4);                // l'hôtel de ville
    house(c.x + 9, c.z + 2, 4, 4);                // la banque
    bank(c.x + 8, c.z + 7);
    house(c.x - 10, c.z + 2, 4, 4);               // maison de Kalastor
    house(c.x - 10, c.z + 8, 4, 4);               // maison d'Edgar
    house(c.x + 1, c.z + 8, 4, 4);                // maison sud
    well(c.x, c.z);                               // la fontaine
    obelisk(c.x + 13, c.z + 2);
    // l'enclos de Darkfang (clôture de bois, ouverture à l'est)
    paddock(c.x - 19, c.z - 12, c.x - 13, c.z - 8, ['e']);
    torch(c.x - 16, c.z - 10);
    // cimetière + crypte à l'ouest
    for (let z = c.z - 6; z <= c.z + 3; z++) for (let x = c.x - 24; x <= c.x - 16; x++) {
      if (inMap(x, z) && tile[idx(x, z)] !== TILE.WATER && rng() < 0.8) tile[idx(x, z)] = TILE.GRAVE;
    }
    cave(c.x - 24, c.z - 3, 'Crypte de Lighthaven');
    // champs au sud-est (terre retournée, clôturés de barrières)
    for (const [fx, fz] of [[c.x + 9, c.z + 10], [c.x + 16, c.z + 13]]) {
      for (let z = fz; z < fz + 5; z++) for (let x = fx; x < fx + 5; x++) {
        if (inMap(x, z) && tile[idx(x, z)] === TILE.GRASS) tile[idx(x, z)] = TILE.SAND;
      }
      paddock(fx - 1, fz - 1, fx + 5, fz + 5, ['n']);
    }
    for (const [tx, tz] of [[c.x - 5, c.z - 5], [c.x + 5, c.z - 5], [c.x - 5, c.z + 5], [c.x + 5, c.z + 5], [c.x, c.z - 13]]) torch(tx, tz);
    // village des métiers + quartier résidentiel
    house(ARAKAS.METIERS.x - 5, ARAKAS.METIERS.z - 3);
    house(ARAKAS.METIERS.x + 1, ARAKAS.METIERS.z + 1);
    torch(ARAKAS.METIERS.x, ARAKAS.METIERS.z);
    house(ARAKAS.RESIDENTIEL.x - 6, ARAKAS.RESIDENTIEL.z - 4);
    house(ARAKAS.RESIDENTIEL.x + 1, ARAKAS.RESIDENTIEL.z - 4);
    house(ARAKAS.RESIDENTIEL.x - 6, ARAKAS.RESIDENTIEL.z + 2);
    house(ARAKAS.RESIDENTIEL.x + 1, ARAKAS.RESIDENTIEL.z + 2);
    torch(ARAKAS.RESIDENTIEL.x - 1, ARAKAS.RESIDENTIEL.z);
    // camp de mercenaires de la côte NE
    torch(ARAKAS.MERC_2.x, ARAKAS.MERC_2.z);
  }

  // ---------- WINDHOWL ----------
  {
    const c = WH;
    // remparts : palissade de bois sur le périmètre, portes est (route) et ouest (port)
    for (let x = WHX0; x <= WHX1; x++) {
      for (const z of [WHZ0, WHZ1]) {
        const corner = (x === WHX0 || x === WHX1);
        wall(x, z, corner ? 'corner' : 'seg');
      }
    }
    for (let z = WHZ0 + 1; z < WHZ1; z++) {
      for (const x of [WHX0, WHX1]) {
        const isGate = Math.abs(z - (c.z - 1)) < 2; // portes est et ouest
        if (isGate) continue;
        const gateEdge = Math.abs(z - (c.z - 1)) === 2; // pans de porte de part et d'autre
        wall(x, z, gateEdge ? 'gate' : 'seg');
      }
    }
    house(c.x - 16, c.z - 13, 5, 4);              // hôtel de ville (Lord Sunrock)
    chest(c.x - 17, c.z - 8);                     // le coffre du bourgmestre (au diamant !)
    house(c.x - 20, c.z - 5, 4, 4);               // tour des mages (Liurn Clar)
    house(c.x - 20, c.z + 2, 4, 4);               // la prison
    house(c.x - 10, c.z - 7, 4, 4);               // magasin d'armures (Gwen)
    house(c.x - 5, c.z - 7, 4, 4);                // magasin de potions (Yolak)
    house(c.x + 1, c.z - 7, 4, 4);                // magasin d'armes (Ttayh Mark)
    house(c.x - 5, c.z - 13, 5, 4);               // guilde des marchands
    house(c.x + 7, c.z - 13, 5, 4);               // maison des guildes
    house(c.x + 14, c.z - 12, 4, 4);              // maison vide
    house(c.x + 13, c.z - 5, 5, 4);               // la taverne (Gouly)
    bank(c.x + 12, c.z);                          // coffres personnels de la taverne
    house(c.x - 2, c.z + 4, 6, 4);                // centre d'entraînement
    house(c.x + 7, c.z + 5, 6, 5);                // les écuries
    house(c.x - 16, c.z + 6, 4, 4);               // maisons vides
    house(c.x - 10, c.z + 6, 4, 4);
    house(c.x + 17, c.z + 6, 4, 4);               // poste de gardes
    well(c.x + 1, c.z - 1);                       // la fontaine (Sarah Meroippi)
    obelisk(WHX1 + 3, c.z - 1);                   // devant la porte est
    for (const [tx, tz] of [[WHX0 + 2, WHZ0 + 2], [WHX1 - 2, WHZ0 + 2], [WHX0 + 2, WHZ1 - 2], [WHX1 - 2, WHZ1 - 2], [c.x - 2, c.z - 1], [c.x + 4, c.z - 1]]) torch(tx, tz);
    // le port à l'ouest : jetée de sable sur la mer
    stampLine([[WHX0 - 14, c.z - 1], [WHX0 + 1, c.z - 1]], 1.4, (X, Z) => {
      tile[idx(X, Z)] = TILE.SAND; walk[idx(X, Z)] = 1;
    });
    torch(WHX0 - 12, c.z);
    // le temple de Windhowl et Hel, hors les murs au nord
    bigHouse(ARAKAS.TEMPLE_WH.x - 4, ARAKAS.TEMPLE_WH.z);
    torch(ARAKAS.TEMPLE_WH.x + 1, ARAKAS.TEMPLE_WH.z + 6);
    house(ARAKAS.HEL.x - 2, ARAKAS.HEL.z - 2, 4, 4);
  }

  // ---------- lieux du continent ----------
  house(ARAKAS.WS1.x - 2, ARAKAS.WS1.z - 2, 4, 4);         // échoppe d'armes n°1
  torch(ARAKAS.WS1.x + 2, ARAKAS.WS1.z + 1);
  house(ARAKAS.WS2.x - 2, ARAKAS.WS2.z - 2, 4, 4);         // échoppe d'armes n°2
  torch(ARAKAS.WS2.x + 2, ARAKAS.WS2.z + 1);
  house(ARAKAS.MADS.x - 2, ARAKAS.MADS.z - 2, 4, 4);       // la maison du Fou
  torch(ARAKAS.MADS.x + 2, ARAKAS.MADS.z + 1);
  house(ARAKAS.GITANE.x - 2, ARAKAS.GITANE.z - 2, 4, 4);   // camp de la gitane
  torch(ARAKAS.GITANE.x + 2, ARAKAS.GITANE.z + 1);
  house(ARAKAS.GORBEN.x - 2, ARAKAS.GORBEN.z - 2, 4, 4);   // Gorben le Fou
  torch(ARAKAS.GORBEN.x + 2, ARAKAS.GORBEN.z + 1);
  bigHouse(ARAKAS.ANCIENT.x - 5, ARAKAS.ANCIENT.z - 2);    // le Temple Ancien
  torch(ARAKAS.ANCIENT.x, ARAKAS.ANCIENT.z + 3);
  house(ARAKAS.ANTONIAN.x - 2, ARAKAS.ANTONIAN.z - 2, 4, 4); // l'ermite Antonian
  house(ARAKAS.LANCE.x - 2, ARAKAS.LANCE.z - 2, 4, 4);     // Lance Silversmith
  torch(ARAKAS.LANCE.x + 2, ARAKAS.LANCE.z);
  house(ARAKAS.OWAIN.x - 2, ARAKAS.OWAIN.z - 2, 4, 4);     // commandant Owain
  torch(ARAKAS.OWAIN.x + 2, ARAKAS.OWAIN.z + 1);
  house(ARAKAS.MERC_LEAD.x + 2, ARAKAS.MERC_LEAD.z - 4, 4, 4); // chef des mercenaires
  torch(ARAKAS.MERC_LEAD.x, ARAKAS.MERC_LEAD.z);
  torch(ARAKAS.MERC_1.x, ARAKAS.MERC_1.z);
  torch(ARAKAS.MERC_3.x, ARAKAS.MERC_3.z);
  house(ARAKAS.HP_CAPTORS.x - 2, ARAKAS.HP_CAPTORS.z + 2, 4, 4); // ravisseurs du Grand Prêtre
  torch(ARAKAS.HP_CAPTORS.x, ARAKAS.HP_CAPTORS.z - 1);
  torch(ARAKAS.HP_CAPTORS.x + 3, ARAKAS.HP_CAPTORS.z + 1);
  // camp des Druides : cercle de feux autour d'un puits sacré
  well(ARAKAS.DRUIDES.x, ARAKAS.DRUIDES.z);
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 4) {
    torch(Math.round(ARAKAS.DRUIDES.x + Math.cos(a) * 4), Math.round(ARAKAS.DRUIDES.z + Math.sin(a) * 3));
  }
  chest(ARAKAS.DRUIDES.x + 6, ARAKAS.DRUIDES.z + 2);
  // la Cité en Ruines : pans de murs effondrés, tombes, et le Weapon Crafter
  for (const [dx, dz] of [[-6, -3], [-3, -5], [1, -5], [4, -2], [3, 3], [-2, 4], [-6, 2]]) {
    ruin(ARAKAS.RUINED.x + dx, ARAKAS.RUINED.z + dz);
  }
  house(ARAKAS.RUINED.x + 5, ARAKAS.RUINED.z + 5, 4, 4);   // le Weapon Crafter
  torch(ARAKAS.RUINED.x + 4, ARAKAS.RUINED.z + 10);
  for (let i = 0; i < 6; i++) {
    props.push({ type: 'grave', x: ARAKAS.RUINED.x - 6 + rng() * 12, z: ARAKAS.RUINED.z - 6 + rng() * 10, rot: (rng() - 0.5) * 0.5, s: 1 });
  }
  // Thieve's Town : repaire des voleurs, cicatrices de rixes
  house(ARAKAS.VOLEURS.x - 6, ARAKAS.VOLEURS.z - 3, 4, 4);
  house(ARAKAS.VOLEURS.x + 2, ARAKAS.VOLEURS.z - 5, 4, 4);
  house(ARAKAS.VOLEURS.x + 1, ARAKAS.VOLEURS.z + 2, 4, 4);
  torch(ARAKAS.VOLEURS.x - 1, ARAKAS.VOLEURS.z);
  chest(ARAKAS.VOLEURS.x + 7, ARAKAS.VOLEURS.z - 1);
  ruin(ARAKAS.VOLEURS.x - 8, ARAKAS.VOLEURS.z + 1);
  ruin(ARAKAS.VOLEURS.x + 6, ARAKAS.VOLEURS.z + 4);
  // camp Orc : feux et palissades sommaires
  torch(ARAKAS.CAMP_ORC.x, ARAKAS.CAMP_ORC.z);
  torch(ARAKAS.CAMP_ORC.x + 5, ARAKAS.CAMP_ORC.z + 3);
  torch(ARAKAS.CAMP_ORC.x - 5, ARAKAS.CAMP_ORC.z - 3);
  // la Tablette de pierre runique : le cercle de transfert historique d'Arakas
  obelisk(ARAKAS.TABLET.x, ARAKAS.TABLET.z);
  torch(ARAKAS.TABLET.x - 2, ARAKAS.TABLET.z + 1);
  torch(ARAKAS.TABLET.x + 2, ARAKAS.TABLET.z + 1);

  // ---------- les îles ----------
  // Orkanis : le repaire du Troll
  chest(ARAKAS.TROLL.x, ARAKAS.TROLL.z + 3);
  torch(ARAKAS.TROLL.x - 3, ARAKAS.TROLL.z);
  // Hermit's Island : la cabane de l'ermite, sous la végétation dense (inatteignable)
  house(ARAKAS.HERMIT.x - 1, ARAKAS.HERMIT.z - 1, 4, 4);
  chest(ARAKAS.HERMIT.x + 4, ARAKAS.HERMIT.z + 3);
  // Stonehenge : le cercle de pierres levées (inatteignable)
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 4) {
    props.push({
      type: 'rock', x: ARAKAS.STONEHENGE.x + 0.5 + Math.cos(a) * 3, z: ARAKAS.STONEHENGE.z + 0.5 + Math.sin(a) * 2.5,
      rot: a, s: 1.2,
    });
  }
  // la tour des Sorts (inatteignable)
  house(ARAKAS.SPELLTOWER.x - 2, ARAKAS.SPELLTOWER.z - 2, 4, 4);
  torch(ARAKAS.SPELLTOWER.x + 1, ARAKAS.SPELLTOWER.z + 2);
  // Olin Haad : le temple carré, qu'on n'atteint que par téléportation de quête
  for (const [dx, dz] of [[-4, -4], [0, -4], [4, -4], [-4, 0], [4, 0], [-4, 4], [0, 4], [4, 4]]) {
    ruin(ARAKAS.OLIN.x + dx, ARAKAS.OLIN.z + dz);
  }
  torch(ARAKAS.OLIN.x, ARAKAS.OLIN.z);
  // îlot Feylor Est : vestiges sombres (inatteignable)
  ruin(ARAKAS.FEYLOR_ISLE.x - 1, ARAKAS.FEYLOR_ISLE.z - 1);
  ruin(ARAKAS.FEYLOR_ISLE.x + 1, ARAKAS.FEYLOR_ISLE.z + 1);

  // autres coffres célèbres
  chest(ARAKAS.JARKO.x - 4, ARAKAS.JARKO.z - 2);             // le trésor de Jarko
  chest(ARAKAS.CAVE_E.x + 2, ARAKAS.CAVE_E.z + 3);           // la cache de la grotte E
  chest(ARAKAS.RUINED.x + 3, ARAKAS.RUINED.z + 2);           // la Cité en Ruines
  chest(ARAKAS.HP_CAPTORS.x + 3, ARAKAS.HP_CAPTORS.z + 3);   // la rançon du Grand Prêtre
  chest(LH.x - 18, LH.z - 15);                               // le coffre surprise de LH

  // entrées de grottes (intérieurs à venir)
  cave(ARAKAS.CAVE_A.x, ARAKAS.CAVE_A.z, 'Grotte A');
  cave(ARAKAS.CAVE_B.x, ARAKAS.CAVE_B.z, 'Grotte B');
  cave(ARAKAS.CAVE_C.x, ARAKAS.CAVE_C.z, 'Grotte C');
  cave(ARAKAS.CAVE_D.x, ARAKAS.CAVE_D.z, 'Grotte D');
  cave(ARAKAS.CAVE_E.x, ARAKAS.CAVE_E.z, 'Grotte E');
  cave(ARAKAS.JARKO.x - 2, ARAKAS.JARKO.z - 3, 'Caverne de Jarko');
  cave(ARAKAS.KRAANIAN.x, ARAKAS.KRAANIAN.z, 'Cave des Kraanians');
  cave(ARAKAS.LABYRINTHE.x, ARAKAS.LABYRINTHE.z, 'Labyrinthe de Feylor');
  cave(ARAKAS.FEYLOR_LAB_E.x, ARAKAS.FEYLOR_LAB_E.z, 'Labyrinthe de Feylor Est');
  cave(ARAKAS.NOMADE.x, ARAKAS.NOMADE.z, 'Crypte du Nomade');
  cave(ARAKAS.BRIGANDS.x, ARAKAS.BRIGANDS.z, 'Cave des Brigands');

  // le portail de l'Épreuve, dans le cirque de Jarko
  props.push({ type: 'trialgate', x: ARAKAS.JARKO.x + 0.5, z: ARAKAS.JARKO.z + 0.5, rot: 0, s: 1 });
  block(ARAKAS.JARKO.x, ARAKAS.JARKO.z);

  // --- 12 bis. ponts de bois : platelage + rambardes sur chaque traversée ---
  const isWet = (x, z) => inMap(x, z) && tile[idx(x, z)] === TILE.WATER;
  for (const [bx, bz] of bridgeTiles) {
    // rambardes uniquement sur les côtés qui donnent sur l'eau
    props.push({
      type: 'bridge', x: bx + 0.5, z: bz + 0.5, rot: 0, s: 1,
      rails: {
        n: isWet(bx, bz - 1), s: isWet(bx, bz + 1),
        w: isWet(bx - 1, bz), e: isWet(bx + 1, bz),
      },
    });
  }

  // --- 13. habillage : arbres, rochers, tombes (seed constant) ---
  for (let z = 1; z < N - 1; z++) {
    for (let x = 1; x < N - 1; x++) {
      const i = idx(x, z);
      if (!walk[i]) continue;
      const t = tile[i];
      const r = rng();
      if (t === TILE.FOREST && r < 0.13) {
        props.push({ type: 'tree', x: x + 0.5, z: z + 0.5, rot: rng() * Math.PI * 2, s: 0.8 + rng() * 0.7 });
        walk[i] = 0;
      } else if (t === TILE.GRASS && r < 0.006) {
        props.push({ type: 'tree', x: x + 0.5, z: z + 0.5, rot: rng() * Math.PI * 2, s: 0.8 + rng() * 0.5 });
        walk[i] = 0;
      } else if ((t === TILE.GRASS || t === TILE.SAND) && r >= 0.006 && r < 0.011) {
        props.push({ type: 'rock', x: x + 0.5, z: z + 0.5, rot: rng() * Math.PI * 2, s: 0.5 + rng() * 0.8 });
        walk[i] = 0;
      } else if (t === TILE.GRAVE && r < 0.09) {
        props.push({ type: 'grave', x: x + 0.5, z: z + 0.5, rot: (rng() - 0.5) * 0.4, s: 1 });
        walk[i] = 0;
      }
    }
  }

  return {
    size: N, height, tile, walk, props, kind: 'island',
    spawnPoint: { x: LH.x + 0.5, z: LH.z - 8.5 },   // le parvis du temple de Lighthaven
    village: { x: LH.x, z: LH.z },
    // les marchands : Maître Aldric à Lighthaven, Ttayh Mark à Windhowl
    npcSpots: [
      { npcId: 'merchant', x: LH.x - 7.5, z: LH.z - 11.5 },
      { npcId: 'merchant_wh', x: WH.x + 3.5, z: WH.z - 2.5 },
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
