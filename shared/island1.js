// Arakas — la première île de T4C, reconstituée d'après les vraies cartes du
// jeu (plans Vircom, cartes Yane / Neerya / prophetie.com / l'Héritage des
// Dragons fournies en référence). Géographie encodée en coordonnées
// normalisées (0..1) relevées sur les cartes, rastérisée en 384×384 tuiles :
//   - Monts Righul au NORD-OUEST : grottes A-E, caverne de Jarko (portail de
//     l'Épreuve), repaire du Troll sur l'île d'Orkanis au large.
//   - Nord : Asile, crypte du Nomade, camp de la gitane.
//   - Nord-est : camp des Druides, Cité perdue des nains, camp Orc et son lac,
//     territoire Kobold, île du Vieil Ermite au large (gué de sable).
//   - Centre : crypte d'Arakas, Cercle de transfert (obélisque), Labyrinthe,
//     cratère de la Météorite, lac et cave des Kraaniens à l'ouest.
//   - Sud : Ville des Voleurs, camps des brigands, forteresse souterraine,
//     cave des Brigands sur la côte, Ruines Émergées au sud-est.
//   - Sud-ouest : WINDHOWL, ville fortifiée en damier (temple, hôtel de ville
//     de Lord Sunrock, tour des mages, échoppes, taverne, écuries, port).
//   - Sud-est : LIGHTHAVEN (temple au nord où l'on apparaît, place de la
//     fontaine, mairie, cimetière et crypte à l'ouest, champs au sud-est,
//     village des métiers, quartier résidentiel, tour des mages sur son îlot
//     au nord-est relié par un sentier sinueux).
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
// Côte de l'île principale (sens horaire, relevée sur la carte de référence)
const COAST = [
  [0.195, 0.135], [0.24, 0.085], [0.32, 0.062], [0.42, 0.072], [0.465, 0.105],
  [0.475, 0.135], [0.488, 0.10], [0.52, 0.06], [0.58, 0.042], [0.64, 0.05],
  [0.665, 0.032], [0.72, 0.028], [0.77, 0.05], [0.785, 0.095], [0.74, 0.13],
  [0.705, 0.125], [0.688, 0.155], [0.718, 0.19], [0.728, 0.24], [0.703, 0.27],
  [0.728, 0.31], [0.745, 0.37], [0.72, 0.42], [0.735, 0.47], [0.718, 0.52],
  [0.74, 0.565], [0.728, 0.62], [0.69, 0.66], [0.668, 0.72], [0.62, 0.755],
  [0.585, 0.82], [0.558, 0.90], [0.52, 0.935], [0.47, 0.915], [0.43, 0.855],
  [0.37, 0.815], [0.345, 0.76], [0.30, 0.74], [0.27, 0.77], [0.20, 0.80],
  [0.13, 0.77], [0.10, 0.70], [0.115, 0.62], [0.16, 0.575], [0.21, 0.555],
  [0.178, 0.538], [0.163, 0.502], [0.185, 0.468], [0.215, 0.455],
  [0.245, 0.40], [0.22, 0.34], [0.245, 0.27],
  [0.21, 0.21],
];
// Lighthaven : masse principale + lobes des métiers (sud) et résidentiel (SO)
const LH_COAST = [
  [0.775, 0.60], [0.80, 0.565], [0.85, 0.548], [0.91, 0.558], [0.955, 0.60],
  [0.97, 0.655], [0.95, 0.71], [0.915, 0.74], [0.878, 0.775], [0.875, 0.812],
  [0.845, 0.835], [0.815, 0.80], [0.79, 0.78], [0.762, 0.755], [0.755, 0.715],
  [0.775, 0.685], [0.785, 0.655], [0.768, 0.63],
];
// îles : [u, v, rayon, aplatissement vertical]
const ISLANDS = [
  { name: 'troll',    c: [0.105, 0.135], r: 0.055, sq: 0.85 }, // Orkanis, repaire du Troll
  { name: 'hermit',   c: [0.80, 0.27],   r: 0.055, sq: 0.75 }, // île du Vieil Ermite
  { name: 'mage',     c: [0.935, 0.50],  r: 0.022, sq: 0.9 },  // îlot de la tour des mages (LH)
  { name: 'circleLH', c: [0.952, 0.452], r: 0.014, sq: 1 },    // cercle druidique de LH
  { name: 'circleWH', c: [0.135, 0.475], r: 0.018, sq: 0.9 },  // cercle druidique de WH
  { name: 'ruines1',  c: [0.665, 0.758], r: 0.022, sq: 0.8 },  // Ruines Émergées
  { name: 'ruines2',  c: [0.692, 0.792], r: 0.014, sq: 0.9 },
];
// passages au-dessus de l'eau : [de, à, largeur, style]
// style 'sand' = gué/isthme de sable ; 'bridge' = pont de bois (platelage)
const CAUSEWAYS = [
  [[0.202, 0.158], [0.125, 0.142], 1.6, 'sand'],    // isthme d'Orkanis
  [[0.708, 0.262], [0.768, 0.265], 1.4, 'sand'],    // gué de l'Ermite
  [[0.718, 0.625], [0.795, 0.625], 0.5, 'bridge'],  // le pont Gob (sortie ouest de LH)
  [[0.908, 0.568], [0.926, 0.535], 1.0, 'bridge'],  // pont de la tour des mages…
  [[0.926, 0.535], [0.935, 0.508], 1.0, 'bridge'],
  [[0.938, 0.488], [0.948, 0.462], 1.0, 'bridge'],  // …puis vers le cercle druidique
  [[0.168, 0.498], [0.142, 0.482], 1.0, 'bridge'],  // cercle druidique de WH
  [[0.622, 0.752], [0.655, 0.755], 1.0, 'bridge'],  // Ruines Émergées
  [[0.675, 0.772], [0.688, 0.785], 1.0, 'bridge'],
];
// Monts Righul (roche infranchissable, sauf sentiers taillés)
const MOUNTAINS = [
  [0.205, 0.145], [0.26, 0.095], [0.33, 0.078], [0.42, 0.088], [0.455, 0.13],
  [0.462, 0.21], [0.435, 0.28], [0.37, 0.315], [0.28, 0.31], [0.225, 0.25],
  [0.208, 0.19],
];
// sentiers taillés dans la roche (relient l'entrée SE aux grottes, puis Orkanis)
const MOUNTAIN_PATHS = [
  [[0.445, 0.268], [0.38, 0.232], [0.34, 0.212], [0.305, 0.192]],   // entrée -> C
  [[0.305, 0.192], [0.262, 0.168]],                                  // C -> B
  [[0.262, 0.168], [0.246, 0.128]],                                  // B -> A
  [[0.246, 0.128], [0.296, 0.114]],                                  // A -> Jarko
  [[0.296, 0.114], [0.368, 0.092]],                                  // Jarko -> D
  [[0.368, 0.092], [0.408, 0.106]],                                  // D -> E
  [[0.246, 0.128], [0.208, 0.158]],                                  // A -> sortie ouest (Orkanis)
];
// amas rocheux secondaires : [u, v, r]
const ROCK_CLUSTERS = [
  [0.638, 0.168, 0.028], [0.708, 0.225, 0.022],                     // cité naine, kobolds
  [0.438, 0.578, 0.030], [0.492, 0.628, 0.024],                     // remparts de la Ville des Voleurs
  [0.42, 0.76, 0.026], [0.80, 0.262, 0.026], [0.108, 0.128, 0.022], // sud, Ermite, Orkanis
];
// forêts : [u, v, r]
const FORESTS = [
  [0.55, 0.12, 0.045], [0.625, 0.10, 0.04], [0.73, 0.072, 0.03],
  [0.575, 0.225, 0.045], [0.665, 0.30, 0.05], [0.60, 0.36, 0.05],
  [0.50, 0.50, 0.055], [0.42, 0.52, 0.05], [0.55, 0.55, 0.05],
  [0.33, 0.45, 0.055], [0.30, 0.55, 0.045], [0.26, 0.63, 0.035],
  [0.40, 0.68, 0.055], [0.52, 0.72, 0.055], [0.46, 0.82, 0.045],
  [0.62, 0.645, 0.035], [0.355, 0.36, 0.04], [0.27, 0.38, 0.04],
];
// lacs : [u, v, r]
const LAKES = [
  [0.345, 0.36, 0.025],   // lac Kraanian
  [0.662, 0.19, 0.014],   // lac du camp Orc
  [0.452, 0.378, 0.015],  // étang du Labyrinthe
  [0.50, 0.424, 0.009],   // mare du cratère de la Météorite
  [0.598, 0.142, 0.009],  // étang du camp de la gitane
];
// rivières (polylignes, ~1,5 tuile de large) — les routes y posent des ponts
const RIVERS = [
  [[0.475, 0.125], [0.49, 0.17], [0.505, 0.225], [0.515, 0.27], [0.512, 0.315], [0.49, 0.345], [0.458, 0.372]],
  [[0.458, 0.372], [0.468, 0.43], [0.488, 0.47], [0.51, 0.53], [0.545, 0.60], [0.565, 0.68], [0.578, 0.76], [0.563, 0.845]],
  [[0.688, 0.30], [0.708, 0.38], [0.715, 0.46], [0.72, 0.52], [0.731, 0.578]],
];
// cimetières (tuiles GRAVE) : [u, v, r]
const GRAVEYARDS = [
  [0.515, 0.222, 0.013],  // crypte d'Arakas
  [0.498, 0.108, 0.010],  // crypte du Nomade
  [0.665, 0.758, 0.016],  // Ruines Émergées
];
// routes (polylignes) — suivent le réseau des cartes de référence
const ROADS = [
  // Windhowl (porte est) -> Labyrinthe -> Cercle de transfert
  [[0.262, 0.661], [0.285, 0.635], [0.30, 0.58], [0.33, 0.50], [0.38, 0.44], [0.43, 0.395], [0.458, 0.358], [0.49, 0.33], [0.515, 0.308]],
  // Cercle de transfert -> Lance Silversmith -> camp gobelin -> le pont Gob -> Lighthaven
  [[0.515, 0.305], [0.575, 0.282], [0.625, 0.275], [0.66, 0.30], [0.688, 0.36], [0.705, 0.45], [0.715, 0.52], [0.728, 0.585], [0.734, 0.625], [0.788, 0.625], [0.825, 0.648]],
  // Cercle de transfert -> cryptes -> Asile
  [[0.515, 0.302], [0.518, 0.255], [0.512, 0.222], [0.502, 0.16], [0.498, 0.112], [0.522, 0.085], [0.552, 0.072]],
  // Asile -> camp des Druides
  [[0.552, 0.072], [0.63, 0.058], [0.688, 0.072], [0.718, 0.085]],
  // crypte d'Arakas -> camp de la gitane -> Cité naine -> camp Orc
  [[0.512, 0.222], [0.548, 0.185], [0.585, 0.155], [0.638, 0.162], [0.652, 0.20]],
  // Cercle de transfert -> entrée des monts Righul
  [[0.508, 0.298], [0.472, 0.285], [0.445, 0.268]],
  // Windhowl (porte est) -> Ville des Voleurs -> camps des brigands -> route de Lighthaven
  [[0.262, 0.661], [0.295, 0.672], [0.33, 0.645], [0.40, 0.618], [0.458, 0.605], [0.52, 0.648], [0.60, 0.625], [0.655, 0.598], [0.708, 0.555]],
  // Ville des Voleurs -> forteresse souterraine -> cave des Brigands
  [[0.462, 0.615], [0.472, 0.692], [0.462, 0.722], [0.478, 0.768], [0.49, 0.798]],
  // Windhowl -> camp Kobold -> cercle druidique (sort par la porte est puis remonte)
  [[0.262, 0.661], [0.272, 0.63], [0.235, 0.598], [0.205, 0.555], [0.188, 0.528], [0.183, 0.505], [0.170, 0.498]],
  // route d'Orkanis (depuis la sortie ouest des monts, jusqu'au repaire du Troll)
  [[0.206, 0.16], [0.168, 0.155], [0.128, 0.143], [0.106, 0.139]],
  // gué de l'Ermite, jusqu'au camp
  [[0.703, 0.268], [0.732, 0.258], [0.77, 0.266], [0.80, 0.271]],
  // Lighthaven interne : pont Gob -> place -> temple ; place -> métiers ; place -> champs
  [[0.788, 0.625], [0.825, 0.648], [0.862, 0.655]],
  [[0.862, 0.648], [0.864, 0.612]],
  [[0.858, 0.668], [0.846, 0.74], [0.843, 0.79]],
  [[0.80, 0.745], [0.815, 0.72], [0.83, 0.70], [0.852, 0.672]],
  // sentier de la tour des mages (depuis le nord de LH)
  [[0.885, 0.59], [0.908, 0.568], [0.926, 0.535], [0.935, 0.508]],
  [[0.935, 0.502], [0.938, 0.488], [0.948, 0.462]],
];

// Points d'intérêt (coordonnées tuiles, calculées depuis les cartes)
const T = (u, v) => ({ x: Math.round(u * N), z: Math.round(v * N) });
export const ARAKAS = {
  LH: T(0.865, 0.655),          // place de la fontaine de Lighthaven
  WH: T(0.205, 0.665),          // place de la fontaine de Windhowl
  RST: T(0.518, 0.308),         // Cercle de transfert runique
  JARKO: T(0.298, 0.118),       // caverne de Jarko (portail de l'Épreuve)
  LABYRINTHE: T(0.452, 0.352),
  CRYPTE: T(0.515, 0.218),      // crypte d'Arakas
  NOMADE: T(0.498, 0.106),      // crypte du Nomade
  ASILE: T(0.553, 0.068),
  GITANE: T(0.585, 0.148),
  CITE_NAINE: T(0.64, 0.162),
  CAMP_ORC: T(0.655, 0.215),
  CAMP_GOB: T(0.652, 0.282),
  LANCE: T(0.578, 0.272),
  MANOIR: T(0.625, 0.305),
  NILHEM: T(0.722, 0.488),
  DRUIDES: T(0.72, 0.085),
  ERMITE: T(0.80, 0.27),
  TROLL: T(0.105, 0.138),
  KRAANIAN: T(0.302, 0.345),    // cave des Kraaniens
  VOLEURS: T(0.46, 0.605),      // Ville des Voleurs
  BRIGANDS: T(0.52, 0.652),     // camps des brigands
  CAVE_BRIGANDS: T(0.49, 0.802),
  FORTERESSE: T(0.462, 0.722),
  CAVE_VOLEURS: T(0.38, 0.712),
  MERCENAIRES: T(0.652, 0.595),
  KOBOLD_WH: T(0.183, 0.502),   // camp Kobold au nord de WH
  CORROMPUS: T(0.345, 0.548),   // gobelins corrompus
  CRATERE: T(0.50, 0.42),
  METIERS: T(0.845, 0.795),     // village des métiers (LH)
  RESIDENTIEL: T(0.788, 0.748), // quartier résidentiel (LH)
  MAGE_LH: T(0.935, 0.50),      // tour des mages (îlot)
};

// Spots de monstres, fidèles aux camps des cartes. La progression suit la
// géographie : niveaux 1-5 autour de Lighthaven, 5-10 au centre, 12+ au nord
// et dans la Ville des Voleurs, 18+ dans les monts Righul et sur Orkanis.
// (aggro + errance ≈ 12 tuiles : les villes restent hors d'atteinte)
const S = (u, v) => [Math.round(u * N), Math.round(v * N)];
const ARAKAS_SPAWNS = [
  { mob: 'rat',       center: S(0.722, 0.572), radius: 7,  count: 8 },  // abords du pont de LH
  { mob: 'rat',       center: S(0.895, 0.722), radius: 6,  count: 6 },  // champs de LH
  { mob: 'rat',       center: S(0.70, 0.50),   radius: 7,  count: 6 },  // route du nord de LH
  { mob: 'serpent',   center: S(0.652, 0.595), radius: 9,  count: 8 },  // camp des mercenaires
  { mob: 'serpent',   center: S(0.622, 0.652), radius: 7,  count: 5 },
  { mob: 'serpent',   center: S(0.665, 0.758), radius: 5,  count: 4 },  // Ruines Émergées
  { mob: 'gobelin',   center: S(0.652, 0.282), radius: 11, count: 12 }, // camp gobelin
  { mob: 'gobelin',   center: S(0.345, 0.548), radius: 9,  count: 8 },  // gobelins corrompus
  { mob: 'gobelin',   center: S(0.183, 0.502), radius: 7,  count: 6 },  // camp Kobold
  { mob: 'squelette', center: S(0.498, 0.108), radius: 7,  count: 8 },  // crypte du Nomade
  { mob: 'squelette', center: S(0.515, 0.222), radius: 8,  count: 8 },  // crypte d'Arakas
  { mob: 'zombie',    center: S(0.553, 0.075), radius: 7,  count: 6 },  // l'Asile
  { mob: 'zombie',    center: S(0.528, 0.208), radius: 6,  count: 4 },  // crypte d'Arakas
  { mob: 'orc',       center: S(0.655, 0.215), radius: 9,  count: 10 }, // camp Orc
  { mob: 'orc',       center: S(0.708, 0.242), radius: 7,  count: 5 },  // territoire Kobold
  { mob: 'orc',       center: S(0.458, 0.602), radius: 9,  count: 8 },  // Ville des Voleurs
  { mob: 'orc',       center: S(0.52, 0.655),  radius: 7,  count: 5 },  // camps des brigands
  { mob: 'ogre',      center: S(0.388, 0.098), radius: 7,  count: 2 },  // fond des monts Righul
  { mob: 'ogre',      center: S(0.105, 0.135), radius: 6,  count: 2 },  // Orkanis (le Troll)
  { mob: 'ogre',      center: S(0.452, 0.342), radius: 4,  count: 1 },  // gardien du Labyrinthe
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
      // léger déplacement par bruit : côtes naturelles
      const ju = (n1(x * 0.11, z * 0.11) - 0.5) * 0.012;
      const jv = (n1(x * 0.11 + 40, z * 0.11 + 40) - 0.5) * 0.012;
      const u = x / N + ju, v = z / N + jv;
      let land = pointInPoly(u, v, COAST) || pointInPoly(u, v, LH_COAST);
      if (!land) {
        for (const isl of ISLANDS) {
          const du = (u - isl.c[0]) / isl.r, dv = (v - isl.c[1]) / (isl.r * isl.sq);
          if (du * du + dv * dv < 1) { land = true; break; }
        }
      }
      tile[idx(x, z)] = land ? TILE.GRASS : TILE.WATER;
    }
  }

  // --- 2. gués de sable (relient les îles, jamais bloqués) ---
  const stampLine = (pts, w, fn) => {
    for (let i = 1; i < pts.length; i++) {
      const [u0, v0] = pts[i - 1], [u1, v1] = pts[i];
      const x0 = u0 * N, z0 = v0 * N, x1 = u1 * N, z1 = v1 * N;
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
    const cx = u * N, cz = v * N, rr = r * N;
    for (let z = Math.floor(cz - rr); z <= cz + rr; z++) for (let x = Math.floor(cx - rr); x <= cx + rr; x++) {
      if (inMap(x, z) && Math.hypot(x - cx, z - cz) < rr * (0.82 + n2(x * 0.2, z * 0.2) * 0.35)) stampWater(x, z);
    }
  }
  for (const riv of RIVERS) stampLine(riv, 1.5, stampWater);

  // --- 4. monts Righul + amas rocheux ---
  const mountain = new Uint8Array(N * N); // le massif Righul : infranchissable aux routes
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      const i = idx(x, z);
      if (tile[i] === TILE.WATER) continue;
      const u = x / N, v = z / N;
      if (pointInPoly(u + (n1(x * 0.15, z * 0.15) - 0.5) * 0.02, v + (n1(x * 0.15 + 9, z * 0.15 + 9) - 0.5) * 0.02, MOUNTAINS)) {
        tile[i] = TILE.ROCK;
        mountain[i] = 1;
      }
    }
  }
  for (const [u, v, r] of ROCK_CLUSTERS) {
    const cx = u * N, cz = v * N, rr = r * N;
    for (let z = Math.floor(cz - rr); z <= cz + rr; z++) for (let x = Math.floor(cx - rr); x <= cx + rr; x++) {
      if (!inMap(x, z) || tile[idx(x, z)] === TILE.WATER) continue;
      if (Math.hypot(x - cx, z - cz) < rr * (0.5 + n2(x * 0.3, z * 0.3) * 0.8)) tile[idx(x, z)] = TILE.ROCK;
    }
  }
  // poches dégagées au cœur des amas (camps accessibles : Troll, Ermite, Cité naine)
  for (const p of [ARAKAS.TROLL, ARAKAS.ERMITE, ARAKAS.CITE_NAINE, ARAKAS.VOLEURS]) {
    for (let z = p.z - 6; z <= p.z + 6; z++) for (let x = p.x - 7; x <= p.x + 7; x++) {
      if (inMap(x, z) && Math.hypot(x - p.x, z - p.z) < 6 && tile[idx(x, z)] === TILE.ROCK && !mountain[idx(x, z)]) {
        tile[idx(x, z)] = TILE.GRASS;
      }
    }
  }
  // sentiers taillés dans la roche (praticables, posés après les monts)
  for (const p of MOUNTAIN_PATHS) {
    stampLine(p, 1.4, (X, Z) => { if (tile[idx(X, Z)] === TILE.ROCK) tile[idx(X, Z)] = TILE.PATH; });
  }
  // cirque de Jarko (poche dégagée autour du portail de l'Épreuve)
  {
    const { x: jx, z: jz } = ARAKAS.JARKO;
    for (let z = jz - 5; z <= jz + 5; z++) for (let x = jx - 6; x <= jx + 6; x++) {
      if (inMap(x, z) && Math.hypot(x - jx, z - jz) < 5.5 && tile[idx(x, z)] === TILE.ROCK) tile[idx(x, z)] = TILE.PATH;
    }
  }
  // anneau du cratère de la Météorite (roche), mare au centre déjà posée
  {
    const { x: cx, z: cz } = ARAKAS.CRATERE;
    const rr = 0.020 * N;
    for (let a = 0; a < Math.PI * 2; a += 0.05) {
      if (a > 5.0 && a < 5.8) continue; // brèche d'accès au nord-ouest
      const x = Math.round(cx + Math.cos(a) * rr), z = Math.round(cz + Math.sin(a) * rr * 0.85);
      if (inMap(x, z) && tile[idx(x, z)] !== TILE.WATER) tile[idx(x, z)] = TILE.ROCK;
    }
  }

  // --- 5. forêts ---
  for (const [u, v, r] of FORESTS) {
    const cx = u * N, cz = v * N, rr = r * N;
    for (let z = Math.floor(cz - rr); z <= cz + rr; z++) for (let x = Math.floor(cx - rr); x <= cx + rr; x++) {
      if (!inMap(x, z)) continue;
      const i = idx(x, z);
      if (tile[i] !== TILE.GRASS) continue;
      if (Math.hypot(x - cx, z - cz) < rr * (0.55 + n2(x * 0.13, z * 0.13) * 0.65)) tile[i] = TILE.FOREST;
    }
  }

  // --- 6. cimetières ---
  for (const [u, v, r] of GRAVEYARDS) {
    const cx = u * N, cz = v * N, rr = r * N;
    for (let z = Math.floor(cz - rr); z <= cz + rr; z++) for (let x = Math.floor(cx - rr); x <= cx + rr; x++) {
      if (!inMap(x, z)) continue;
      const i = idx(x, z);
      if (tile[i] !== TILE.WATER && tile[i] !== TILE.ROCK && Math.hypot(x - cx, z - cz) < rr && rng() < 0.8) tile[i] = TILE.GRAVE;
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
  plaza(ARAKAS.METIERS.x, ARAKAS.METIERS.z, 5);
  plaza(ARAKAS.RESIDENTIEL.x, ARAKAS.RESIDENTIEL.z, 6);

  // --- 8. routes (avec ponts automatiques sur l'eau douce) ---
  for (const road of ROADS) {
    stampLine(road, 1.2, (X, Z) => {
      const i = idx(X, Z);
      if (tile[i] === TILE.COBBLE) return;
      if (tile[i] === TILE.WATER) {
        if (river[i]) { tile[i] = TILE.PATH; river[i] = 0; bridgeTiles.push([X, Z]); } // pont de bois
        return; // jamais de route en mer
      }
      // le massif Righul a ses propres sentiers ; les amas rocheux isolés
      // se laissent traverser (cols vers la Cité naine, Orkanis, l'Ermite...)
      if (tile[i] === TILE.ROCK) {
        if (!mountain[i]) tile[i] = TILE.PATH;
        return;
      }
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
    house(c.x - 13, c.z - 16);                    // échoppe d'armes (Sigfried -> Maître Aldric)
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
    // la tour des mages sur son îlot, et le cercle druidique au-delà
    house(ARAKAS.MAGE_LH.x - 2, ARAKAS.MAGE_LH.z - 2, 4, 4);
    torch(ARAKAS.MAGE_LH.x + 2, ARAKAS.MAGE_LH.z + 2);
    const cd = T(0.952, 0.452);
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 3) torch(Math.round(cd.x + Math.cos(a) * 3), Math.round(cd.z + Math.sin(a) * 2.4));
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
    bigHouse(c.x - 5, c.z - 13);                  // le temple
    house(c.x - 16, c.z - 13, 5, 4);              // hôtel de ville (Lord Sunrock)
    chest(c.x - 17, c.z - 8);                     // le coffre du bourgmestre (au diamant !)
    house(c.x - 20, c.z - 5, 4, 4);               // tour des mages (Liurn Clar)
    house(c.x - 20, c.z + 2, 4, 4);               // la prison
    house(c.x - 10, c.z - 7, 4, 4);               // magasin d'armures (Gwen)
    house(c.x - 5, c.z - 7, 4, 4);                // magasin de potions (Yolak)
    house(c.x + 1, c.z - 7, 4, 4);                // magasin d'armes (Ttayh Mark)
    house(c.x + 7, c.z - 13, 5, 4);               // guilde des marchands
    house(c.x + 14, c.z - 12, 4, 4);              // maison des guildes
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
    // le port à l'ouest : jetée de sable + capitainerie
    stampLine([[(WHX0 - 8) / N, (c.z - 1) / N], [(WHX0 + 1) / N, (c.z - 1) / N]], 1.4, (X, Z) => {
      tile[idx(X, Z)] = TILE.SAND; walk[idx(X, Z)] = 1;
    });
    house(WHX0 - 7, c.z - 7, 4, 4);
    torch(WHX0 - 6, c.z + 1);
  }

  // ---------- lieux du monde ----------
  house(ARAKAS.LANCE.x - 2, ARAKAS.LANCE.z - 2, 4, 4);     // Lance Silversmith
  torch(ARAKAS.LANCE.x + 2, ARAKAS.LANCE.z);
  house(ARAKAS.NILHEM.x - 2, ARAKAS.NILHEM.z - 2, 4, 4);   // Nilhem
  bigHouse(ARAKAS.MANOIR.x - 5, ARAKAS.MANOIR.z - 2);      // le Manoir / Citadelle
  bigHouse(ARAKAS.ASILE.x - 5, ARAKAS.ASILE.z - 2);        // l'Asile
  torch(ARAKAS.ASILE.x, ARAKAS.ASILE.z + 3);
  house(ARAKAS.GITANE.x - 2, ARAKAS.GITANE.z - 2, 4, 4);   // camp de la gitane
  torch(ARAKAS.GITANE.x + 2, ARAKAS.GITANE.z + 1);
  // Cité perdue des nains : pans de murs effondrés et tombes
  for (const [dx, dz] of [[-6, -3], [-3, -5], [1, -5], [4, -2], [3, 3], [-2, 4], [-6, 2], [0, -1]]) {
    ruin(ARAKAS.CITE_NAINE.x + dx, ARAKAS.CITE_NAINE.z + dz);
  }
  for (let i = 0; i < 6; i++) {
    props.push({ type: 'grave', x: ARAKAS.CITE_NAINE.x - 6 + rng() * 12, z: ARAKAS.CITE_NAINE.z - 6 + rng() * 10, rot: (rng() - 0.5) * 0.5, s: 1 });
  }
  // camp des Druides : cercle de feux autour d'un puits sacré
  well(ARAKAS.DRUIDES.x, ARAKAS.DRUIDES.z);
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 4) {
    torch(Math.round(ARAKAS.DRUIDES.x + Math.cos(a) * 4), Math.round(ARAKAS.DRUIDES.z + Math.sin(a) * 3));
  }
  chest(ARAKAS.DRUIDES.x + 6, ARAKAS.DRUIDES.z + 2);
  // cercle druidique de WH
  {
    const cd = T(0.135, 0.475);
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 3) torch(Math.round(cd.x + Math.cos(a) * 3), Math.round(cd.z + Math.sin(a) * 2.4));
  }
  // Ville des Voleurs : repaire entre les rochers
  house(ARAKAS.VOLEURS.x - 6, ARAKAS.VOLEURS.z - 3, 4, 4);
  house(ARAKAS.VOLEURS.x + 2, ARAKAS.VOLEURS.z - 5, 4, 4);
  house(ARAKAS.VOLEURS.x + 1, ARAKAS.VOLEURS.z + 2, 4, 4);
  torch(ARAKAS.VOLEURS.x - 1, ARAKAS.VOLEURS.z);
  chest(ARAKAS.VOLEURS.x + 7, ARAKAS.VOLEURS.z - 1);
  // camps des brigands
  torch(ARAKAS.BRIGANDS.x, ARAKAS.BRIGANDS.z);
  torch(ARAKAS.BRIGANDS.x + 4, ARAKAS.BRIGANDS.z + 3);
  // camp des mercenaires
  torch(ARAKAS.MERCENAIRES.x, ARAKAS.MERCENAIRES.z);
  house(ARAKAS.MERCENAIRES.x + 2, ARAKAS.MERCENAIRES.z - 4, 4, 4);
  // Orkanis : le repaire du Troll
  chest(ARAKAS.TROLL.x, ARAKAS.TROLL.z + 3);
  torch(ARAKAS.TROLL.x - 3, ARAKAS.TROLL.z);
  // l'île du Vieil Ermite
  house(ARAKAS.ERMITE.x - 1, ARAKAS.ERMITE.z - 1, 4, 4);
  chest(ARAKAS.ERMITE.x + 4, ARAKAS.ERMITE.z + 3);
  // les Ruines Émergées : vestiges engloutis
  for (const [dx, dz] of [[-3, -2], [1, -4], [3, 1], [-1, 3], [-5, 1]]) {
    ruin(T(0.665, 0.758).x + dx, T(0.665, 0.758).z + dz);
  }
  ruin(T(0.692, 0.792).x, T(0.692, 0.792).z - 1);
  // la Ville des Voleurs porte les cicatrices de ses rixes
  ruin(ARAKAS.VOLEURS.x - 8, ARAKAS.VOLEURS.z + 1);
  ruin(ARAKAS.VOLEURS.x + 6, ARAKAS.VOLEURS.z + 4);
  // autres coffres célèbres
  chest(ARAKAS.JARKO.x - 4, ARAKAS.JARKO.z - 2);           // le trésor de Jarko
  chest(ARAKAS.CRYPTE.x + 5, ARAKAS.CRYPTE.z + 2);         // la crypte d'Arakas
  chest(ARAKAS.CRATERE.x, ARAKAS.CRATERE.z - 1);           // le cratère de la Météorite
  chest(LH.x - 18, LH.z - 15);                             // le coffre surprise de LH
  chest(ARAKAS.KOBOLD_WH.x + 3, ARAKAS.KOBOLD_WH.z - 2);   // camp Kobold

  // entrées de grottes (intérieurs à venir)
  cave(T(0.246, 0.128).x, T(0.246, 0.128).z, 'Grotte A');
  cave(T(0.262, 0.168).x, T(0.262, 0.168).z, 'Grotte B');
  cave(T(0.305, 0.192).x, T(0.305, 0.192).z, 'Grotte C');
  cave(T(0.368, 0.092).x, T(0.368, 0.092).z, 'Grotte D');
  cave(T(0.408, 0.106).x, T(0.408, 0.106).z, 'Grotte E');
  cave(ARAKAS.JARKO.x - 2, ARAKAS.JARKO.z - 3, 'Caverne de Jarko');
  cave(ARAKAS.KRAANIAN.x, ARAKAS.KRAANIAN.z, 'Cave des Kraanians');
  cave(ARAKAS.LABYRINTHE.x, ARAKAS.LABYRINTHE.z, 'Le Labyrinthe');
  cave(ARAKAS.CRYPTE.x, ARAKAS.CRYPTE.z, "Crypte d'Arakas");
  cave(ARAKAS.NOMADE.x, ARAKAS.NOMADE.z, 'Crypte du Nomade');
  cave(ARAKAS.CAVE_BRIGANDS.x, ARAKAS.CAVE_BRIGANDS.z, 'Cave des Brigands');
  cave(ARAKAS.FORTERESSE.x, ARAKAS.FORTERESSE.z, 'Forteresse souterraine');
  cave(ARAKAS.CAVE_VOLEURS.x, ARAKAS.CAVE_VOLEURS.z, 'Cave des Voleurs');

  // le portail de l'Épreuve, dans le cirque de Jarko
  props.push({ type: 'trialgate', x: ARAKAS.JARKO.x + 0.5, z: ARAKAS.JARKO.z + 0.5, rot: 0, s: 1 });
  block(ARAKAS.JARKO.x, ARAKAS.JARKO.z);
  // le Cercle de transfert runique : l'obélisque historique d'Arakas
  obelisk(ARAKAS.RST.x, ARAKAS.RST.z);
  torch(ARAKAS.RST.x - 2, ARAKAS.RST.z + 1);
  torch(ARAKAS.RST.x + 2, ARAKAS.RST.z + 1);

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
