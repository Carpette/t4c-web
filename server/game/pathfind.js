// A* simple sur la grille de tuiles (8 directions), borné pour rester léger.
// Budget épuisé (longs trajets sur les grandes cartes comme Arakas) : on
// renvoie le chemin vers le nœud exploré le plus proche de la cible — le
// joueur progresse, et le serveur recalcule en route.
const MAX_EXPAND = 6000;

export function findPath(world, x0, z0, x1, z1) {
  const sx = Math.floor(x0), sz = Math.floor(z0);
  let tx = Math.floor(x1), tz = Math.floor(z1);
  const N = world.size;
  if (tx < 0 || tz < 0 || tx >= N || tz >= N) return null;

  // si la cible est bloquée, cherche une case praticable proche
  if (!world.walk[tz * N + tx]) {
    let best = null, bestD = Infinity;
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
      const X = tx + dx, Z = tz + dz;
      if (X < 0 || Z < 0 || X >= N || Z >= N || !world.walk[Z * N + X]) continue;
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = [X, Z]; }
    }
    if (!best) return null;
    [tx, tz] = best;
  }
  if (sx === tx && sz === tz) return [{ x: tx + 0.5, z: tz + 0.5 }];

  const key = (x, z) => z * N + x;
  const open = [{ x: sx, z: sz, g: 0, f: 0 }];
  const came = new Map();
  const gScore = new Map([[key(sx, sz), 0]]);
  const closed = new Set();
  let expanded = 0;
  let best = null, bestH = Infinity; // nœud le plus proche de la cible (repli)

  const rebuild = (endX, endZ) => {
    const path = [];
    let k = key(endX, endZ);
    let node = { x: endX, z: endZ };
    while (node) {
      path.push({ x: node.x + 0.5, z: node.z + 0.5 });
      node = came.get(k);
      if (node) k = key(node.x, node.z);
    }
    path.reverse();
    return smooth(world, path);
  };

  while (open.length && expanded < MAX_EXPAND) {
    // extraction du min (tas binaire serait mieux, mais les chemins sont courts)
    let mi = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[mi].f) mi = i;
    const cur = open.splice(mi, 1)[0];
    const ck = key(cur.x, cur.z);
    if (closed.has(ck)) continue;
    closed.add(ck);
    expanded++;
    const curH = Math.hypot(tx - cur.x, tz - cur.z);
    if (curH < bestH) { bestH = curH; best = cur; }

    if (cur.x === tx && cur.z === tz) {
      return rebuild(tx, tz);
    }

    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const X = cur.x + dx, Z = cur.z + dz;
        if (X < 0 || Z < 0 || X >= N || Z >= N) continue;
        if (!world.walk[Z * N + X]) continue;
        // pas de coupe de coin en diagonale
        if (dx && dz && (!world.walk[cur.z * N + X] || !world.walk[Z * N + cur.x])) continue;
        const nk = key(X, Z);
        if (closed.has(nk)) continue;
        const g = cur.g + ((dx && dz) ? 1.41421 : 1);
        if (g < (gScore.get(nk) ?? Infinity)) {
          gScore.set(nk, g);
          came.set(nk, { x: cur.x, z: cur.z });
          const h = Math.hypot(tx - X, tz - Z);
          open.push({ x: X, z: Z, g, f: g + h });
        }
      }
    }
  }
  // budget épuisé : avance vers le nœud exploré le plus proche de la cible
  if (best && (best.x !== sx || best.z !== sz) && bestH < Math.hypot(tx - sx, tz - sz) - 2) {
    return rebuild(best.x, best.z);
  }
  return null; // pas de chemin trouvé
}

// Lissage : supprime les points intermédiaires en ligne de vue
function smooth(world, path) {
  if (path.length <= 2) return path;
  const out = [path[0]];
  let anchor = 0;
  for (let i = 2; i < path.length; i++) {
    if (!lineOfSight(world, path[anchor], path[i])) {
      out.push(path[i - 1]);
      anchor = i - 1;
    }
  }
  out.push(path[path.length - 1]);
  return out;
}

export function lineOfSight(world, a, b) {
  const dist = Math.hypot(b.x - a.x, b.z - a.z);
  const steps = Math.max(1, Math.ceil(dist * 3));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (!world.isWalkable(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)) return false;
  }
  return true;
}
