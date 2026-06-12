// Dialogues à mots-clés des PNJ — la fondation des quêtes, fidèle à T4C :
// le joueur parle en chat local près d'un PNJ ; si son message contient un
// mot-clé défini, le PNJ répond (bulle + chat local) et peut réagir.
//
// Définition par PNJ (champ `dialogues` éditable dans la fiche PNJ de l'admin) :
//   dialogues: [{
//     keywords: ["travail", "quête"],     mots déclencheurs (mots entiers,
//                                         casse et accents ignorés)
//     reponse: "...",                     réplique du PNJ
//     conditions?: {                      toutes requises pour déclencher :
//       flag: 'clef',                       drapeau du personnage requis
//       notFlag: 'clef',                    drapeau ABSENT requis
//       level: n,                           niveau minimal
//       item: 'defId', consume?: true,      objet requis (consommé si demandé)
//     },
//     reactions?: [                       effets appliqués au déclenchement :
//       { type: 'gold', amount },           pièces d'or
//       { type: 'item', defId, n? },        objets remis (posés au sol si trop lourd)
//       { type: 'xp', amount },             expérience
//       { type: 'flag', key },              pose un drapeau persistant (p.flags)
//       { type: 'teleport', zoneId?, x, z } déplacement (zone débloquée au besoin)
//     ],
//     repeatable?: true,                  les récompenses redeviennent disponibles
//   }, ...]
//
// Garde-fou anti-farm : les réactions à récompense (gold/item/xp) d'un dialogue
// ne sont versées qu'UNE fois par personnage — drapeau automatique
// `dlg:<npcId>:<index>` — sauf `repeatable: true` explicite. La réplique, les
// drapeaux et les téléportations, eux, rejouent à chaque déclenchement.
import * as C from '../../shared/constants.js';
import { ITEMS } from '../../shared/defs.js';
import { makeItem, itemLabel, itemWeight, inventoryWeight } from './items.js';

const INVENTORY_MAX = 24;        // taille de l'inventaire (cf. game.js)
const ITEM_REWARD_MAX = 10;      // objets remis par réaction, au plus
const HINT_KEYWORDS_MAX = 4;     // mots-clés racine glissés dans le salut

// minuscules + accents retirés : « Quête » et « quete » se valent
export function normalize(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// le message contient-il le mot-clé en MOT ENTIER ? (« or » ne réagit pas à « mort »)
export function containsKeyword(text, keyword) {
  const k = normalize(keyword).trim();
  if (!k) return false;
  const escaped = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, 'u').test(normalize(text));
}

// toutes les conditions d'un dialogue sont-elles remplies pour ce joueur ?
function conditionsMet(p, dlg) {
  const c = dlg.conditions;
  if (!c) return true;
  if (c.flag && !p.flags[c.flag]) return false;
  if (c.notFlag && p.flags[c.notFlag]) return false;
  if (c.level && p.level < c.level) return false;
  if (c.item && !p.inventory.some(it => it.defId === c.item)) return false;
  return true;
}

// Indice des mots-clés « racine » à glisser dans le salut du PNJ : le premier
// mot-clé de chaque dialogue accessible d'emblée (sans drapeau requis) — le
// reste se découvre en tapant, comme dans T4C.
export function rootKeywordsHint(def) {
  const roots = [];
  for (const dlg of Array.isArray(def?.dialogues) ? def.dialogues : []) {
    if (dlg.conditions?.flag) continue; // réservé : se mérite en jouant
    const k = Array.isArray(dlg.keywords) ? dlg.keywords[0] : null;
    if (k && !roots.includes(k)) roots.push(k);
  }
  if (!roots.length) return null;
  return `(Parlez-moi de ${roots.slice(0, HINT_KEYWORDS_MAX).map(k => `« ${k} »`).join(', ')}.)`;
}

// Point d'entrée : un joueur vient de parler en chat local. Le premier PNJ à
// portée d'oreille dont un dialogue correspond (mot-clé + conditions, dans
// l'ordre de définition) répond — un seul PNJ réagit par message.
export function handleNpcKeywords(game, p, text) {
  for (const npc of p.zi.nearby(p.x, p.z, C.NPC_DIALOGUE_RANGE)) {
    if (npc.kind !== C.KIND.NPC) continue;
    const dialogues = Array.isArray(npc.def?.dialogues) ? npc.def.dialogues : [];
    for (let i = 0; i < dialogues.length; i++) {
      const dlg = dialogues[i];
      if (!Array.isArray(dlg.keywords) || !dlg.keywords.some(k => containsKeyword(text, k))) continue;
      if (!conditionsMet(p, dlg)) continue;
      triggerDialogue(game, p, npc, dlg, i);
      return true;
    }
  }
  return false;
}

function triggerDialogue(game, p, npc, dlg, index) {
  // objet exigé ET consommé par la condition (offrande, clé, preuve...)
  if (dlg.conditions?.item && dlg.conditions.consume) {
    const i = p.inventory.findIndex(it => it.defId === dlg.conditions.item);
    if (i >= 0) {
      const item = p.inventory[i];
      for (const [slot, iid] of Object.entries(p.equip)) {
        if (iid === item.iid) delete p.equip[slot];
      }
      p.inventory.splice(i, 1);
      p.recompute(game);
      game.send(p, { t: 'info', text: `Remis : ${itemLabel(item)}` });
    }
  }

  // la réplique : bulle au-dessus du PNJ + chat local pour les joueurs proches
  const reponse = String(dlg.reponse || '...');
  game.eventNear(npc, { t: 'say', id: npc.id, text: reponse, npc: true });
  game.sendLocalChat(npc, reponse);

  // réactions — les récompenses ne tombent qu'une fois par personnage
  const onceKey = `dlg:${npc.npcId}:${index}`;
  const rewardsAllowed = dlg.repeatable === true || !p.flags[onceKey];
  let rewarded = false;
  for (const r of Array.isArray(dlg.reactions) ? dlg.reactions : []) {
    switch (r.type) {
      case 'gold': {
        const amount = Math.max(0, r.amount | 0);
        if (rewardsAllowed && amount) {
          p.gold += amount;
          rewarded = true;
          game.send(p, { t: 'loot', text: `+${amount} or` });
        }
        break;
      }
      case 'item': {
        if (!rewardsAllowed || !ITEMS[r.defId]) break;
        const n = Math.max(1, Math.min(ITEM_REWARD_MAX, r.n | 0 || 1));
        for (let k = 0; k < n; k++) {
          const item = makeItem(r.defId, Math.random, p.zi.zoneId);
          item.q = 0; item.bonus = {}; // un don de PNJ est standard, pas magique
          const fits = p.inventory.length < INVENTORY_MAX
            && inventoryWeight(p.inventory) + itemWeight(item) <= p.eff.capacity;
          if (fits) p.inventory.push(item);
          else game.spawnDrop(p.zi, p.x, p.z, { item }); // trop chargé : posé aux pieds
          game.send(p, { t: 'loot', text: itemLabel(item) });
        }
        rewarded = true;
        break;
      }
      case 'xp': {
        const amount = Math.max(0, +r.amount || 0);
        if (rewardsAllowed && amount) {
          p.grantXp(amount, game);
          rewarded = true;
        }
        break;
      }
      case 'flag': {
        if (r.key) p.flags[String(r.key)] = true;
        break;
      }
      case 'teleport': {
        applyTeleport(game, p, r);
        break;
      }
    }
  }
  if (rewarded) p.flags[onceKey] = true;
  game.sendSelf(p);
}

// Téléportation scénarisée : vers une autre zone (débloquée au passage — le
// PNJ offre l'accès) ou un point praticable de la zone courante.
function applyTeleport(game, p, r) {
  const x = +r.x, z = +r.z;
  if (r.zoneId != null) {
    const dest = game.island(r.zoneId | 0);
    if (!dest) return;
    if (!p.unlocked.includes(dest.zoneId)) p.unlocked.push(dest.zoneId);
    const to = Number.isFinite(x) && Number.isFinite(z) && dest.world.isWalkable(x, z)
      ? { x, z } : dest.world.spawnPoint;
    game.movePlayerToZone(p, dest, to.x, to.z);
    return;
  }
  if (Number.isFinite(x) && Number.isFinite(z) && p.zi.world.isWalkable(x, z)) {
    p.x = x; p.z = z;
    p.path = null; p.moveDir = null; p.attackTarget = null; p.pendingCast = null;
    p.zi.gridMove(p);
    game.heatZone(p.zi); // arriver quelque part est un déplacement réel
  }
}
