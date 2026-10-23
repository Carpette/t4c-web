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
//       item: 'defId', n?, consume?: true,  objet requis, n exemplaires (consommés si demandé)
//       chasse: 'clef',                     chasse terminée (monstres tués, cf. réaction chasse)
//       flags: [...], chasses: [...],       listes : toutes requises
//       items: [{ item, n, consume }],      plusieurs objets à rapporter
//     },
//     reactions?: [                       effets appliqués au déclenchement :
//       { type: 'gold', amount },           pièces d'or
//       { type: 'item', defId, n? },        objets remis (posés au sol si trop lourd)
//       { type: 'xp', amount },             expérience
//       { type: 'flag', key },              pose un drapeau persistant (p.flags)
//       { type: 'unflag', key },            le retire (et sa chasse en cours) :
//                                           sert à rejouer une quête répétable
//       { type: 'lieu', key, zoneId, x, z, r, nom? }  objectif « se rendre à » :
//                                           le drapeau `key` se pose quand le
//                                           joueur arrive à moins de r cases
//       { type: 'sort', spellId }           enseigne un sort (récompense)
//       { type: 'teleport', zoneId?, x, z } déplacement (zone débloquée au besoin)
//       { type: 'chasse', key, mob, n }     lance un décompte : tuer n monstres
//                                           `mob` (defId) ; le dialogue qui exige
//                                           conditions.chasse = key le clôt
//     ],
//     repeatable?: true,                  les récompenses redeviennent disponibles
//   }, ...]
//
// Garde-fou anti-farm : les réactions à récompense (gold/item/xp) d'un dialogue
// ne sont versées qu'UNE fois par personnage — drapeau automatique
// `dlg:<npcId>:<index>` — sauf `repeatable: true` explicite. La réplique, les
// drapeaux et les téléportations, eux, rejouent à chaque déclenchement.
import * as C from '../../shared/constants.js';
import { ITEMS, MOBS } from '../../shared/defs.js';
import { content } from '../content.js';

const nomMob = (id) => MOBS[id]?.name || id;
import { makeItem, itemLabel, itemWeight, inventoryWeight } from './items.js';
import { normalize, containsKeyword, conditionBloquante, rootKeywordsHint } from '../../shared/mots-cles.js';

export { normalize, containsKeyword, rootKeywordsHint };

const INVENTORY_MAX = 24;        // taille de l'inventaire (cf. game.js)
const ITEM_REWARD_MAX = 10;      // objets remis par réaction, au plus

// toutes les conditions d'un dialogue sont-elles remplies pour ce joueur ?
function conditionsMet(p, dlg, game) {
  return !conditionBloquante(dlg.conditions, {
    flags: p.flags,
    level: p.level,
    gold: p.gold,
    aObjet: (defId, n = 1) => p.inventory.filter(it => it.defId === defId).length >= n,
    chasse: (key) => p.chasses?.[key] || null,
    maudit: game ? () => game.isCursed(p) : null,
  });
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
      if (!conditionsMet(p, dlg, game)) continue;
      triggerDialogue(game, p, npc, dlg, i);
      return true;
    }
  }
  return false;
}

// n exemplaires d'un objet remis au PNJ (les non équipés d'abord : on garde
// l'arme en main)
function reprendre(game, p, defId, n) {
  const equipes = new Set(Object.values(p.equip));
  const remis = p.inventory.filter(it => it.defId === defId)
    .sort((a, b) => equipes.has(a.iid) - equipes.has(b.iid))
    .slice(0, Math.max(1, n | 0));
  for (const item of remis) {
    for (const [slot, iid] of Object.entries(p.equip)) {
      if (iid === item.iid) delete p.equip[slot];
    }
    p.inventory.splice(p.inventory.indexOf(item), 1);
  }
  if (!remis.length) return;
  p.recompute(game);
  game.send(p, { t: 'info', text: `Remis : ${itemLabel(remis[0])}${remis.length > 1 ? ' ×' + remis.length : ''}` });
}

function triggerDialogue(game, p, npc, dlg, index) {
  // objet exigé ET consommé par la condition (offrande, clé, preuve...)
  // services payants (prêtre, péages…) : l'or n'est prélevé que si l'entrée
  // déclare consumeGold — sinon conditions.gold n'est qu'un seuil de richesse
  if (dlg.conditions?.gold && dlg.conditions.consumeGold) {
    p.gold -= dlg.conditions.gold;
    game.send(p, { t: 'loot', text: `-${dlg.conditions.gold} or` });
  }
  const c = dlg.conditions;
  if (c?.item && c.consume) reprendre(game, p, c.item, c.n);
  for (const o of Array.isArray(c?.items) ? c.items : []) if (o?.item && o.consume) reprendre(game, p, o.item, o.n);
  // chasses accomplies : décomptes clos (une nouvelle chasse les relancera)
  for (const key of [c?.chasse, ...(Array.isArray(c?.chasses) ? c.chasses : [])]) if (key) delete p.chasses[key];

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
      case 'unflag': {
        const k = String(r.key || '');
        if (k) { delete p.flags[k]; delete p.chasses[k]; delete p.lieux[k]; }
        break;
      }
      case 'lieu': {
        // déjà atteint (drapeau posé) : rien à suivre
        if (r.key && !p.flags[r.key]) {
          p.lieux[r.key] = { zoneId: r.zoneId ?? p.zi.zoneId, x: +r.x, z: +r.z, r: Math.max(1, +r.r || 3), nom: r.nom || '' };
          if (r.nom) game.send(p, { t: 'info', text: `Objectif : se rendre à ${r.nom}` });
        }
        break;
      }
      case 'sort': {
        const sp = content.spellById[r.spellId];
        if (rewardsAllowed && sp && !p.spells.includes(sp.id)) {
          p.spells.push(sp.id);
          rewarded = true;
          game.send(p, { t: 'loot', text: `Sort appris : ${sp.name}` });
        }
        break;
      }
      case 'teleport': {
        applyTeleport(game, p, r);
        break;
      }
      case 'chasse': {
        // relancer une chasse en cours ne remet pas son compteur à zéro
        const n = Math.max(1, r.n | 0);
        // ni une chasse déjà rendue (drapeau de l'étape qui l'exige posé)
        if (r.key && r.mob && !p.chasses[r.key] && !p.flags[r.key]) {
          p.chasses[r.key] = { mob: String(r.mob), n, tues: 0 };
          if (r.silencieux) p.chasses[r.key].silencieux = true;
          else game.send(p, { t: 'info', text: `Chasse : ${nomMob(r.mob)} 0/${n}` });
        }
        break;
      }
      // ---- services (prêtre) : pas des récompenses, rejouables à volonté ----
      case 'heal': {
        // soin complet — la malédiction bloque TOUT soin : l'entrée de contenu
        // doit porter conditions.notCursed pour ne pas encaisser à vide
        if (!game.isCursed(p)) {
          p.hp = p.eff.maxHp;
          game.eventNear(p, { t: 'fx', kind: 'heal', id: p.id, fx: { self: 'soin_majeur' } });
        }
        break;
      }
      case 'cleanse': {
        p.curseUntil = 0;
        game.eventNear(p, { t: 'fx', kind: 'heal', id: p.id, fx: { self: 'sol_benediction' } });
        game.send(p, { t: 'info', text: 'La malédiction se dissipe.' });
        break;
      }
      case 'buff': {
        // bénédiction temporaire, même gestionnaire d'effets que les sorts
        p.effects.apply({
          type: r.effect || 'defense_boost',
          power: Math.max(0, Math.min(50, +r.power || 3)),
          duration: Math.max(1, Math.min(3600, r.duration | 0 || 600)) * 1000,
          category: 'magique',
          from_id: p.id,
        }, { type: 'npc', id: 'benediction' }, game.now() * 1000, game);
        p.recompute(game);
        game.eventNear(p, { t: 'fx', kind: 'buff', id: p.id, color: '#ffd24a', stat: 'def', fx: { self: 'bouclier_sacre' } });
        break;
      }
    }
  }
  if (rewarded) p.flags[onceKey] = true;
  game.sendSelf(p);
}

// Un monstre vient de mourir : avance les chasses de quête des joueurs crédités
export function compterChasse(game, p, mob) {
  for (const ch of Object.values(p.chasses || {})) {
    if (ch.mob !== mob.defId || ch.tues >= ch.n) continue;
    ch.tues++;
    if (ch.silencieux && ch.tues < ch.n) continue; // progression masquée : seule la fin s'annonce
    game.send(p, { t: 'info', text: ch.tues >= ch.n
      ? `Chasse terminée : ${nomMob(ch.mob)} ${ch.tues}/${ch.n}. Retournez voir le commanditaire.`
      : `Chasse : ${nomMob(ch.mob)} ${ch.tues}/${ch.n}` });
  }
}

// Objectifs « se rendre à » : appelé à cadence réduite par la boucle de jeu
export function verifierLieux(game, p) {
  if (p.dead || p.zi.isTrial || p.zi.isCave) return;
  for (const [key, l] of Object.entries(p.lieux || {})) {
    if (l.zoneId !== p.zi.zoneId || Math.hypot(p.x - l.x, p.z - l.z) > l.r) continue;
    delete p.lieux[key];
    p.flags[key] = true;
    game.send(p, { t: 'info', text: `Objectif atteint${l.nom ? ' : ' + l.nom : ''}.` });
  }
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
