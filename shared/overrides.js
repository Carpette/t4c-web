// Modifications de carte éditées par l'admin, appliquées par-dessus la génération.
// Format : { tiles: [[x, z, type], ...],
//            props: { add: [{type, x, z, v?, s?, rot?}], remove: [[x, z]] },
//            camps?: [...], npcs?: {...} }
// Champs optionnels d'un ajout (rétrocompatible : absents = comportement historique) :
//   v   — variante explicite (index ou nom, voir PROP_TYPES de decormap.js)
//   s   — échelle du sprite (bornée 0.25..3 ; honorée pour les props redimensionnables)
//   rot — rotation (les sprites iso pré-rendus n'honorent que le miroir : cos(rot) < 0)
//
// Sections appliquées par le SERVEUR DE JEU (game.js), pas par cette fonction
// (elles ne touchent pas à la géométrie du monde) — rétrocompatibles : absentes,
// les défauts du worldgen restent en vigueur.
//   camps — REMPLACE les camps de spawn par mouvement de la zone :
//     [{ id, x, z, r, mobs: { defId: n, ... } }]  (centre + rayon + composition)
//   npcs — retouches des PNJ de la zone :
//     { remove: [npcId, ...],                       PNJ par défaut retirés
//       move:   [{ npcId, x, z }, ...],             PNJ par défaut déplacés
//       edit:   { npcId: { champs... } },           PNJ par défaut retouchés
//       add:    [{ id, x, z, champs... }, ...] }    PNJ créés de toutes pièces
//     champs éditables : name, look, role ('merchant'|'teacher'|'bavard'),
//     greetings (phrases d'ambiance), sells (objets vendus, ids), teaches
//     (sorts enseignés, ids), dialogues (mots-clés, cf. server/game/dialogues.js)
//   chests — BUTIN personnalisé des coffres posés sur la carte (prop 'chest') :
//     [{ id, x, z, gold:[min,max], items:[{defId, n, chance}], reqFlag? }]
//     Repéré par sa case (x, z entiers) ; ABSENT, le coffre garde le butin
//     générique (pool de la zone). `gold` = fourchette d'or, `items` = objets
//     possibles (defId d'ITEMS, n exemplaires, chance 0..1 chacun), `reqFlag` =
//     drapeau de quête requis pour ouvrir (cf. p.flags des dialogues PNJ).
//   markers — POINTS SPÉCIAUX nommés posés sur la carte :
//     [{ id, kind:'spawn'|'exit'|'teleport', x, z, target? }]
//     'spawn'   : remplace le point d'apparition par défaut de la zone ;
//     'exit'/'teleport' : marcher dessus (rayon MARKER_TRIGGER_R) téléporte le
//       joueur vers `target` = { zoneId, x, z } (sert aux quêtes, sous-lieux).
//   music — SOUS-ZONES musicales dessinées sur la carte (formes géométriques) :
//     [{ id, shape:'rect'|'circle', x, z, w, h | r, track:{legacy,new}, priority }]
//     Une sous-zone = une forme (rectangle x/z/w/h OU cercle centre x/z + rayon r,
//     en tuiles) + une piste { legacy, new } (mêmes variantes que music.json).
//     `priority` départage les chevauchements (plus haut = prioritaire).
//     ABSENTE : comportement actuel inchangé (la musique reste celle de la zone
//     entière, music.json). Quand le joueur n'est dans AUCUNE sous-zone, la
//     musique de zone globale reste le FOND par défaut. La bascule entre pistes
//     se fait avec hystérésis côté serveur (cf. game.js, MUSIC_ZONE_HYSTERESIS).
import { TILE } from './worldgen.js';

const BLOCKING_PROPS = new Set(['tree', 'rock', 'house', 'well', 'grave', 'obelisk', 'trialgate', 'bank', 'cave', 'wall', 'fence', 'ruin']);
const HOUSE_SIZE = { w: 5, d: 4 };

export function applyOverrides(world, ov) {
  if (!ov) return world;
  const N = world.size;
  const idx = (x, z) => z * N + x;

  // 1. tuiles repeintes
  for (const [x, z, t] of ov.tiles || []) {
    if (x < 0 || z < 0 || x >= N || z >= N) continue;
    world.tile[idx(x, z)] = t;
    world.walk[idx(x, z)] = (t === TILE.WATER || t === TILE.ROCK) ? 0 : 1;
  }

  // 2. décors supprimés (et case rendue praticable)
  for (const [x, z] of ov.props?.remove || []) {
    for (let i = world.props.length - 1; i >= 0; i--) {
      const p = world.props[i];
      if (Math.hypot(p.x - x - 0.5, p.z - z - 0.5) < 1.0) {
        world.props.splice(i, 1);
        const tx = Math.floor(p.x), tz = Math.floor(p.z);
        const t = world.tile[idx(tx, tz)];
        if (t !== TILE.WATER && t !== TILE.ROCK) world.walk[idx(tx, tz)] = 1;
      }
    }
  }

  // 3. décors ajoutés
  for (const p of ov.props?.add || []) {
    const x = Math.floor(p.x), z = Math.floor(p.z);
    if (x < 0 || z < 0 || x >= N || z >= N) continue;
    const prop = {
      type: p.type, x: x + 0.5, z: z + 0.5,
      rot: Number.isFinite(+p.rot) ? +p.rot : 0,
      s: Number.isFinite(+p.s) ? Math.min(3, Math.max(0.25, +p.s)) : 1,
    };
    if (p.v != null) prop.v = p.v; // variante explicite (sinon : choix par hachage)
    if (p.type === 'house') { prop.w = HOUSE_SIZE.w; prop.d = HOUSE_SIZE.d; }
    world.props.push(prop);
    if (BLOCKING_PROPS.has(p.type)) {
      if (p.type === 'house') {
        for (let dz = 0; dz < HOUSE_SIZE.d; dz++) for (let dx = 0; dx < HOUSE_SIZE.w; dx++) {
          const X = x - 2 + dx, Z = z - 2 + dz;
          if (X >= 0 && Z >= 0 && X < N && Z < N) world.walk[idx(X, Z)] = 0;
        }
      } else {
        world.walk[idx(x, z)] = 0;
      }
    }
  }
  return world;
}
