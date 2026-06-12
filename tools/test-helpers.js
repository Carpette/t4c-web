// Helpers partagés des suites d'intégration.
// Depuis le spawn « par le mouvement » (T4C), les zones démarrent VIDES :
// un test qui attend des monstres doit d'abord RÉVEILLER la zone (bouger),
// puis laisser le serveur les faire apparaître (lancer le serveur de test
// avec T4C_SPAWN_MS bas, ~250 ms, pour que ce soit rapide).
//
// Contrat : `S` est une session de test avec au minimum
//   S.send(obj)   — envoi JSON au serveur
//   S.pos         — Map id -> dernier état binaire { x, z, state, kind... }
//   S.metas       — Map id -> méta { kind, defId, name, level }
//   S.id          — id de l'entité du joueur (après welcome)
import { KIND, ST } from '../shared/constants.js';

export const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// monstres vivants actuellement visibles (filtrables par defId)
export function visibleMobs(S, defId = null) {
  const out = [];
  for (const [id, e] of S.pos) {
    const meta = S.metas.get(id);
    if (meta?.kind !== KIND.MOB || e.state === ST.DEAD) continue;
    if (defId && meta.defId !== defId) continue;
    out.push({ id, e, meta });
  }
  return out;
}

// le plus proche des monstres visibles (ou null)
export function nearestVisibleMob(S, defId = null) {
  const me = S.pos.get(S.id);
  if (!me) return null;
  let best = null, bestD = Infinity;
  for (const m of visibleMobs(S, defId)) {
    const d = Math.hypot(m.e.x - me.x, m.e.z - me.z);
    if (d < bestD) { bestD = d; best = { ...m, d }; }
  }
  return best;
}

// « Réveille » la zone : de petits allers-retours (movedir) la maintiennent
// chaude, le serveur y fait apparaître les monstres hors champ. Retourne dès
// que `count` monstres (du defId voulu) sont visibles, ou à l'expiration.
export async function wakeZone(S, { defId = null, count = 1, timeout = 12000 } = {}) {
  const t0 = Date.now();
  let flip = 1;
  while (Date.now() - t0 < timeout) {
    S.send({ t: 'movedir', x: flip, z: -flip });
    flip = -flip;
    await sleep(220);
    if (visibleMobs(S, defId).length >= count) break;
  }
  S.send({ t: 'movedir', x: 0, z: 0 });
  await sleep(120);
  return visibleMobs(S, defId);
}

// Se poste (téléport admin) à ~`dist` tuiles d'un point : assez LOIN pour que
// le serveur accepte d'y faire apparaître des monstres (SPAWN_MIN_PLAYER_DIST),
// assez près pour les voir (AOI). Essaie plusieurs angles autour du point.
export async function standoffNear(S, x, z, dist = 28) {
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    const gx = x + Math.cos(a) * dist, gz = z + Math.sin(a) * dist;
    S.send({ t: 'admin', cmd: 'goto', x: gx, z: gz });
    await sleep(250);
    const p = S.pos.get(S.id);
    if (p && Math.hypot(p.x - gx, p.z - gz) < 1) return true;
  }
  return false;
}

// Réveille un CAMP précis : poste d'observation à bonne distance, puis
// allers-retours jusqu'à voir `count` monstres du camp. (Le joueur posté AU
// camp empêcherait tout spawn : les monstres n'apparaissent jamais sous ses yeux.)
export async function wakeCampNear(S, x, z, { defId = null, count = 1, timeout = 12000, dist = 28 } = {}) {
  await standoffNear(S, x, z, dist);
  return wakeZone(S, { defId, count, timeout });
}
