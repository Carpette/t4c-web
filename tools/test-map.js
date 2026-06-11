// Validation de la carte Arakas Classic (sans serveur) : connexité à pied,
// îles strictement inatteignables, côtes de sable de Lighthaven, ponts N/O
// comme seules sorties de l'île, lieux clés posés sur terre praticable.
// Usage : node tools/test-map.js
import { generateWorld, TILE } from '../shared/worldgen.js';
import { ARAKAS } from '../shared/island1.js';

const checks = [];
const ok = (name, cond) => { checks.push([name, !!cond]); console.log(cond ? '  ✔' : '  ✘', name); };

const world = generateWorld(0, 'arakas');
const N = world.size;
const idx = (x, z) => z * N + x;
const inMap = (x, z) => x >= 0 && z >= 0 && x < N && z < N;

// remplissage (4-connexité) depuis un point, sur une grille de praticabilité
function flood(walk, sx, sz) {
  const seen = new Uint8Array(N * N);
  if (!walk[idx(sx, sz)]) return seen;
  const stack = [idx(sx, sz)];
  seen[stack[0]] = 1;
  while (stack.length) {
    const i = stack.pop();
    const x = i % N, z = (i / N) | 0;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const X = x + dx, Z = z + dz;
      if (!inMap(X, Z)) continue;
      const j = idx(X, Z);
      if (seen[j] || !walk[j]) continue;
      seen[j] = 1; stack.push(j);
    }
  }
  return seen;
}
// une case praticable ET atteinte existe-t-elle à moins de r (euclidien) du point ?
function reachableNear(seen, p, r = 5) {
  for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
    if (dx * dx + dz * dz > r * r) continue;
    const X = p.x + dx, Z = p.z + dz;
    if (inMap(X, Z) && seen[idx(X, Z)]) return true;
  }
  return false;
}

// --- 1. point d'apparition praticable, sur l'île de Lighthaven ---
const spawn = { x: Math.floor(world.spawnPoint.x), z: Math.floor(world.spawnPoint.z) };
ok('apparition praticable (parvis du temple de Lighthaven)', world.walk[idx(spawn.x, spawn.z)] === 1);
const seen = flood(world.walk, spawn.x, spawn.z);

// --- 2. tout ce qui doit être atteignable à pied depuis le village ---
const MUST_REACH = [
  ['obélisque de Lighthaven', { x: 345, z: 254 }, 3],
  ['banque de Lighthaven', { x: 340, z: 259 }, 3],
  ['marchand de Lighthaven (Maître Aldric)', { x: 324, z: 240 }, 2],
  ['fontaine de Windhowl', ARAKAS.WH, 4],
  ['obélisque de Windhowl', { x: 95, z: 275 }, 3],
  ['marchand de Windhowl (Ttayh Mark)', { x: 73, z: 273 }, 2],
  ['portail de l\'Épreuve (caverne de Jarko)', ARAKAS.JARKO, 4],
  ['camp Orc (Roshnak Tul)', ARAKAS.CAMP_ORC, 5],
  ['crypte du Nomade (squelettes)', ARAKAS.NOMADE, 5],
  ['Thieve\'s Town', ARAKAS.VOLEURS, 5],
  ['cave des Brigands', ARAKAS.BRIGANDS, 5],
  ['cave des Kraanians', ARAKAS.KRAANIAN, 5],
  ['Temple Ancien', ARAKAS.ANCIENT, 5],
  ['Tablette de pierre runique', ARAKAS.TABLET, 4],
  ['Labyrinthe de Feylor', ARAKAS.LABYRINTHE, 5],
  ['Cité en Ruines', ARAKAS.RUINED, 5],
  ['camp des Druides', ARAKAS.DRUIDES, 5],
  ['commandant Owain', ARAKAS.OWAIN, 5],
  ['Labyrinthe de Feylor Est', ARAKAS.FEYLOR_LAB_E, 5],
  ['chef des mercenaires', ARAKAS.MERC_LEAD, 5],
  ['ravisseurs du Grand Prêtre', ARAKAS.HP_CAPTORS, 5],
  ['château d\'Orkanis (le Troll, via l\'isthme)', ARAKAS.TROLL, 5],
  ['grotte A', ARAKAS.CAVE_A, 5], ['grotte E', ARAKAS.CAVE_E, 5],
];
for (const [name, p, r] of MUST_REACH) ok(`atteignable : ${name}`, reachableNear(seen, p, r));

// --- 3. directive 3 : îles STRICTEMENT inatteignables à pied ---
const MUST_NOT_REACH = [
  ['Olin Haad', ARAKAS.OLIN, 12],
  ['Hermit\'s Island', ARAKAS.HERMIT, 15],
  ['Stonehenge', ARAKAS.STONEHENGE, 8],
  ['la tour des Sorts', ARAKAS.SPELLTOWER, 8],
  ['îlot Feylor Est', ARAKAS.FEYLOR_ISLE, 9],
];
for (const [name, p, r] of MUST_NOT_REACH) ok(`inatteignable à pied : ${name}`, !reachableNear(seen, p, r));
// ... mais ces îles existent bien (de la terre s'y trouve)
for (const [name, p] of MUST_NOT_REACH) {
  let land = 0;
  for (let dz = -4; dz <= 4; dz++) for (let dx = -4; dx <= 4; dx++) {
    if (inMap(p.x + dx, p.z + dz) && world.tile[idx(p.x + dx, p.z + dz)] !== TILE.WATER) land++;
  }
  ok(`l'île existe : ${name}`, land >= 20);
}

// --- 4. directive 2 : les ponts N et O sont les SEULES sorties de Lighthaven ---
const bridges = world.props.filter(p => p.type === 'bridge');
ok('des ponts de bois existent', bridges.length >= 10);
// ponts de l'île : un au nord (z<235), un à l'ouest (x<310) du village
const lhBridgeN = bridges.filter(p => Math.abs(p.x - 320.5) < 3 && p.z > 210 && p.z < 236);
const lhBridgeW = bridges.filter(p => Math.abs(p.z - 251.5) < 3 && p.x > 286 && p.x < 308);
ok('pont NORD de Lighthaven présent', lhBridgeN.length >= 5);
ok('pont OUEST de Lighthaven présent', lhBridgeW.length >= 5);
// sans les ponts, l'île est isolée : Windhowl et le camp Orc deviennent injoignables
{
  const cut = Uint8Array.from(world.walk);
  for (const b of bridges) cut[idx(Math.floor(b.x), Math.floor(b.z))] = 0;
  const seenCut = flood(cut, spawn.x, spawn.z);
  ok('sans les ponts, Lighthaven est une île close (Windhowl injoignable)',
    !reachableNear(seenCut, ARAKAS.WH, 4) && !reachableNear(seenCut, ARAKAS.CAMP_ORC, 5));
  ok('sans les ponts, le village reste praticable', reachableNear(seenCut, { x: 345, z: 254 }, 3));
}

// --- 5. directive 1 : la côte de l'île de Lighthaven est en SABLE (≥ 80 %) ---
{
  // masse de terre de LH : remplissage sur les tuiles non-eau, sans traverser les ponts
  const bridgeSet = new Set(bridges.map(b => idx(Math.floor(b.x), Math.floor(b.z))));
  const landWalk = new Uint8Array(N * N);
  for (let i = 0; i < N * N; i++) landWalk[i] = world.tile[i] !== TILE.WATER && !bridgeSet.has(i) ? 1 : 0;
  const lh = flood(landWalk, ARAKAS.LH.x, ARAKAS.LH.z);
  const isSea = (x, z) => !inMap(x, z) || world.tile[idx(x, z)] === TILE.WATER;
  let coast = 0, sand = 0;
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      if (!lh[idx(x, z)]) continue;
      let edge = false;
      for (let dz = -1; dz <= 1 && !edge; dz++) for (let dx = -1; dx <= 1; dx++) {
        if (isSea(x + dx, z + dz)) { edge = true; break; }
      }
      if (!edge) continue;
      coast++;
      if (world.tile[idx(x, z)] === TILE.SAND) sand++;
    }
  }
  const pct = coast ? (100 * sand / coast) : 0;
  ok(`côte de Lighthaven en sable (${pct.toFixed(1)} % ≥ 80 %)`, pct >= 80);
  ok('la masse de Lighthaven est bien une île (taille raisonnable)', lh.reduce((a, b) => a + b, 0) < 4500);
}

// --- 6. props clés aux coordonnées attendues par les autres suites ---
const propAt = (type, x, z) => world.props.some(p => p.type === type && Math.abs(p.x - x) < 0.01 && Math.abs(p.z - z) < 0.01);
ok('obélisque de Lighthaven à (345.5, 254.5)', propAt('obelisk', 345.5, 254.5));
ok('portail de l\'Épreuve à (107.5, 77.5)', propAt('trialgate', 107.5, 77.5));
ok('coffre-banque de Lighthaven à (340.5, 259.5)', propAt('bank', 340.5, 259.5));

// --- 7. les camps de monstres ont de la place praticable et atteignable ---
for (const zone of world.spawnZones) {
  let free = 0;
  const [cx, cz] = zone.center;
  for (let dz = -zone.radius; dz <= zone.radius; dz++) for (let dx = -zone.radius; dx <= zone.radius; dx++) {
    const X = cx + dx, Z = cz + dz;
    if (inMap(X, Z) && seen[idx(X, Z)]) free++;
  }
  ok(`camp ${zone.mob} (${cx},${cz}) : ${free} cases atteignables`, free >= zone.count * 2);
}

const failed = checks.filter(([, c]) => !c);
console.log(failed.length === 0 ? '\nTOUT EST OK' : `\n${failed.length} ÉCHEC(S): ${failed.map(([n]) => n).join(', ')}`);
process.exit(failed.length === 0 ? 0 : 1);
