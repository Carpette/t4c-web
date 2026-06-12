// Une zone = un monde isolé (île, grotte ou instance d'Épreuve) : entités,
// grille spatiale (recherches de voisinage) et camps de spawn par mouvement.
const CELL = 16;

export class ZoneInstance {
  constructor(key, world, zoneId, isTrial = false, owner = null) {
    this.key = key;
    this.world = world;
    this.zoneId = zoneId;       // index de la zone (pour le scaling des mobs)
    this.isTrial = isTrial;
    this.owner = owner;          // accountId si instance personnelle
    this.entities = new Map();
    this.grid = new Map();
    this.players = 0;
    // spawn par le mouvement : camps (budgets de population) + « chaleur »
    this.camps = [];
    this.hotUntil = 0;       // la zone est chaude tant que now <= hotUntil
    this.nextSpawnAt = 0;    // prochain tick de spawn autorisé
  }
  cellKey(x, z) { return (Math.floor(x / CELL) << 8) | (Math.floor(z / CELL) & 0xff); }
  gridAdd(e) {
    const k = this.cellKey(e.x, e.z);
    let s = this.grid.get(k);
    if (!s) { s = new Set(); this.grid.set(k, s); }
    s.add(e); e._cell = k;
  }
  gridMove(e) {
    const k = this.cellKey(e.x, e.z);
    if (k !== e._cell) { this.grid.get(e._cell)?.delete(e); this.gridAdd(e); }
  }
  gridRemove(e) { this.grid.get(e._cell)?.delete(e); }
  *nearby(x, z, r) {
    const c0x = Math.floor((x - r) / CELL), c1x = Math.floor((x + r) / CELL);
    const c0z = Math.floor((z - r) / CELL), c1z = Math.floor((z + r) / CELL);
    for (let cz = c0z; cz <= c1z; cz++) {
      for (let cx = c0x; cx <= c1x; cx++) {
        const s = this.grid.get((cx << 8) | (cz & 0xff));
        if (!s) continue;
        for (const e of s) {
          if (e.hidden) continue;
          const dx = e.x - x, dz = e.z - z;
          if (dx * dx + dz * dz <= r * r) yield e;
        }
      }
    }
  }
  add(e) { this.entities.set(e.id, e); this.gridAdd(e); e.zi = this; }
  remove(e) { this.entities.delete(e.id); this.gridRemove(e); }
}

// Première case praticable en spirale autour de (x, z) — pour déposer un
// joueur au pied d'un prop bloquant (obélisque...) sans l'enfermer dedans.
export function walkableNear(world, x, z, maxR = 4) {
  for (let r = 0; r <= maxR; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue; // anneau seulement
        if (world.isWalkable(x + dx, z + dz)) return { x: x + dx, z: z + dz };
      }
    }
  }
  return { x: world.spawnPoint.x, z: world.spawnPoint.z };
}
