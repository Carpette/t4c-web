// Habillage de la carte : choix des tuiles Flare et des décors depuis le worldgen partagé.
// Le mapping type/variante -> tuile vit dans decormap.js (partagé avec l'éditeur admin).
import { TILE } from '../../../shared/worldgen.js';
import {
  FLOOR_IDS, WATER_IDS, TUFT_IDS, FERN_IDS, CLIFF_IDS,
  hash, pick, propSprites, propScale, propFlip,
} from './decormap.js';

export function buildDecor(world) {
  const N = world.size;
  const voidMode = world.kind === 'trial'; // l'Épreuve : un chemin suspendu au-dessus du vide
  const caveMode = world.kind === 'cave';  // caverne : parois rocheuses denses
  // --- id de tuile de sol par case ---
  const floor = new Int16Array(N * N);
  const isWater = new Uint8Array(N * N);
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      const i = z * N + x;
      const t = world.tile[i];
      const r = hash(x, z);
      // en mode « vide » (Épreuve), la roche devient l'abîme aquatique
      const ids = (voidMode && t === TILE.ROCK) ? WATER_IDS : (FLOOR_IDS[t] || FLOOR_IDS[TILE.GRASS]);
      floor[i] = pick(ids, r);
      if (t === TILE.WATER || (voidMode && t === TILE.ROCK)) isWater[i] = 1;
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
  const props = [];   // {tileId, x, z, s?, flip?}
  const lights = [];  // {x, z, r, flicker}
  // arbres morts sur les tuiles de cimetière (quel que soit le tracé de la carte)
  const inCemetery = (x, z) => world.tile[Math.floor(z) * N + Math.floor(x)] === TILE.GRAVE;

  for (const p of world.props) {
    const { sprites, lights: ls } = propSprites(p, { inCemetery: inCemetery(p.x, p.z) });
    // échelle et miroir du prop (posés par le worldgen ou un override d'admin)
    const s = propScale(p), flip = propFlip(p);
    for (const sp of sprites) props.push((s !== 1 || flip) ? { ...sp, s, flip } : sp);
    lights.push(...ls);
  }

  // falaises décoratives dans les montagnes (pas dans le vide de l'Épreuve) ;
  // en caverne elles sont bien plus denses : ce sont les parois elles-mêmes
  if (!voidMode) {
    const cliffChance = caveMode ? 0.30 : 0.06;
    for (let z = 2; z < N - 2; z++) {
      for (let x = 2; x < N - 2; x++) {
        const i = z * N + x;
        if (world.tile[i] === TILE.ROCK && hash(x + 31, z + 17) < cliffChance) {
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

  // sources de lumière posées par l'admin (overrides `lights` -> world.lights) :
  // fusionnées aux halos des décors, rendues à l'identique par le renderer
  // (rayon r, couleur, scintillement). Champ absent : aucune lumière ajoutée.
  for (const li of Array.isArray(world.lights) ? world.lights : []) {
    if (!Number.isFinite(li.x) || !Number.isFinite(li.z) || !(li.r > 0)) continue;
    lights.push({ x: li.x, z: li.z, r: li.r, flicker: !!li.flicker, color: li.color || null });
  }

  return { floor, isWater, props: props.concat(smallProps), lights };
}
