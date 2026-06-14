// Système de sorts T4C (formules de la Bible/référence française) : prérequis,
// lancement avec récupération, résolution des effets, résistances élémentaires.
// Les dégâts/soins et la récupération peuvent être pilotés par des EXPRESSIONS
// (champs `effects`/`cooldown` de content/spells.json, évaluées par le
// FormulaEngine — compilées au chargement du contenu). Un sort sans expression
// retombe sur les champs numériques historiques (dmg/heal/cast) : mêmes valeurs.
import * as C from '../../shared/constants.js';
import { findPath, lineOfSight } from './pathfind.js';
import { content } from '../content.js';
import { EFFECT_TYPES } from './effects.js';

// ---------- Contexte d'évaluation des expressions ----------
// self.level / self.stats.* (stats de base) / self.buff_stats.* (stats
// effectives : équipement et buffs compris — c'est elles qu'utilisent les
// formules de la Bible), spell.* (la définition du sort), target.*.
export function formulaContext(p, sp, target = null) {
  const tgt = target || p;
  return {
    self: { level: p.level, stats: p.stats, buff_stats: p.eff?.stats || p.stats },
    spell: sp,
    target: {
      level: tgt.level || 0,
      hp: tgt.hp || 0,
      maxHp: tgt.eff ? tgt.eff.maxHp : (tgt.maxHp || tgt.hp || 100),
    },
  };
}

// Tirage d'un effet (damage/heal) : expression compilée si le sort en a une,
// sinon l'ancienne formule à champs numériques (rétrocompatibilité).
function rollEffect(p, sp, kind, legacyField, target = null) {
  const fx = content.spellFormulas?.get(sp.id);
  const eff = fx && fx.effects.find(e => e.kind === kind);
  if (eff) {
    try { return eff.expr.evaluate(formulaContext(p, sp, target)); }
    catch (e) { console.warn(`sort ${sp.id} : expression ${kind} invalide (${e.message}), repli sur les champs numériques`); }
  }
  return rollSpellOutput(p, legacyField);
}

// ---------- Formules ----------
// Vitesse d'incantation T4C (Bible, Spell Speed) : `cast` secondes au niveau
// du sort, qui diminue de `castStep` (20 ou 40 ms) par niveau au-delà,
// plancher `castMin`. Word of Recall/Gateway/Portal sont fixes (castStep 0).
// Si le sort porte une expression `cooldown` (ms), c'est elle qui décide.
export function castTimeMs(p, sp) {
  const fx = content.spellFormulas?.get(sp.id);
  if (fx?.cooldown) {
    try { return Math.round(fx.cooldown.evaluate(formulaContext(p, sp))); }
    catch (e) { console.warn(`sort ${sp.id} : expression cooldown invalide (${e.message}), repli sur cast/castMin/castStep`); }
  }
  const slow = (sp.cast ?? 1.5) * 1000;
  const fast = (sp.castMin ?? 1) * 1000;
  const step = (sp.castStep ?? 0.02) * 1000;
  return Math.round(Math.max(fast, slow - Math.max(0, p.level - (sp.level || 1)) * step));
}

// Formule de la Bible : 1dN + base + Int/k + Sag/k (puissance élémentaire = 100)
export function rollSpellOutput(p, f) {
  const s = p.eff.stats;
  let v = f.base || 0;
  if (f.dice) v += 1 + Math.floor(Math.random() * f.dice);
  if (f.int) v += s.int / f.int;
  if (f.wis) v += s.wis / f.wis;
  return v;
}

// Multiplicateur de puissance : compétences + Afflux de Mana (+33 %).
// L'Afflux ne s'applique PAS aux sorts d'arcane (réf. t4c.arp.free.fr).
export function spellPowerMul(p, element = null) {
  const stats = p.eff?.stats;
  if (!stats) return 1;
  let m = 1 + stats.spellMul;
  if (element === 'arcane') {
    // Arcane ignore les buffs d'Afflux de mana
    const activeEffects = p.effects?.active || [];
    const affluxPower = activeEffects
      .filter(ae => ae.source?.id === 'poussee_de_mana' || ae.target_parameter === 'spellMul')
      .reduce((sum, ae) => sum + ae.power, 0);
    m = 1 + Math.max(0, stats.spellMul - affluxPower);
  }
  return m;
}

// Style visuel/sonore d'un sort pour le client : poison (vert), drain (sombre)
// ou simplement son élément
export function spellStyle(sp) {
  if (sp.leech) return 'drain';
  if (sp.dot) return 'poison';
  return sp.element || null;
}

// Résistances élémentaires T4C : réduction (ou amplification si faiblesse).
// Pour un joueur, les buffs s'ajoutent : Bouclier de mana (+33 % contre toutes
// les magies SAUF arcanes) et Résistance au feu / à la glace (+100 % à l'élément).
// À 100 % ou plus, le sort est entièrement annulé (0 dégât).
export function applyResist(target, sp, dmg) {
  if (!sp.element) return { dmg, mod: null };
  
  let resist = 0;
  if (target.eff?.stats) {
    resist = target.eff.stats[`resist_${sp.element}`] || 0;
  } else {
    resist = target.def?.resist?.[sp.element] || 0;
    if (target.effects) {
      for (const ae of target.effects.active) {
        if (ae.type === 'resist_boost' && ae.target_parameter === sp.element) {
          resist += ae.power;
        }
      }
    }
  }
  const resistValue = Math.max(0.01, 1 + resist);
  return {
    dmg: Math.max(1, Math.round(dmg / resistValue)),
    mod: resist > 0.05 ? 'resist' : (resist < -0.05 ? 'weak' : null),
  };
}

// ---------- Prérequis ----------
// Prérequis T4C d'un sort : niveau, Sagesse, Intelligence, sort(s) précédent(s).
// Retourne true, ou le message expliquant ce qui manque.
export function spellReqMet(p, sp) {
  const wis = p.eff.stats.wis, intel = p.eff.stats.int;
  if (sp.level && p.level < sp.level) return `Niveau ${sp.level} requis.`;
  if (sp.wis && wis < sp.wis) return `${sp.wis} de Sagesse requis (vous : ${wis}).`;
  if (sp.int && intel < sp.int) return `${sp.int} d'Intelligence requis (vous : ${intel}).`;
  // la Bible admet plusieurs prérequis (ex : Météorite = Tempête de Feu ET Inferno)
  for (const req of (Array.isArray(sp.requires) ? sp.requires : sp.requires ? [sp.requires] : [])) {
    if (!p.spells.includes(req)) {
      const r = content.spellById[req];
      return `Sort prérequis : ${r ? r.name : req}.`;
    }
  }
  return true;
}

export function spellReqText(sp) {
  const parts = [];
  if (sp.level) parts.push(`niv. ${sp.level}`);
  if (sp.wis) parts.push(`Sag ${sp.wis}`);
  if (sp.int) parts.push(`Int ${sp.int}`);
  for (const req of (Array.isArray(sp.requires) ? sp.requires : sp.requires ? [sp.requires] : [])) {
    parts.push(content.spellById[req]?.name || req);
  }
  return parts.join(', ');
}

// ---------- Lancement ----------
// Validation + lancement. L'effet part IMMÉDIATEMENT (resolveCast) — la
// « vitesse du sort » de la Bible est le délai de RÉCUPÉRATION avant de pouvoir
// relancer, pas une incantation préalable. L'approche automatique hors combat
// passe toujours par pendingCast : le sort part une fois à portée.
export function castSpell(game, p, msg) {
  const sp = content.spellById[msg.spellId];
  if (!sp || !p.spells.includes(sp.id) || sp.todo) return;
  const now = game.now();
  if (game.isPacified(p)) {
    game.send(p, { t: 'info', text: 'La transe du Sanctuaire vous empêche de lancer le moindre sort.' });
    return;
  }
  if (p.casting) return; // déjà en train d'incanter
  if ((p.spellCds[sp.id] || 0) > now) return;
  if (p.mana < sp.mana) { game.send(p, { t: 'info', text: 'Mana insuffisant.' }); return; }

  const cast = { spellId: sp.id };
  if (sp.type === 'bolt') {
    const target = p.zi.entities.get(msg.target | 0);
    // les sorts purement maudissants (Malédiction) peuvent viser un joueur (T4C)
    const curseOnly = sp.curse && !sp.dmg;
    const validTarget = target && !target.dead && !target.hidden
      && (target.kind === C.KIND.MOB
        || (curseOnly && target.kind === C.KIND.PLAYER && target.id !== p.id && !game.isUntouchable(target)));
    if (!validTarget) return;
    if (sp.undeadOnly && !target.def?.undead) {
      game.send(p, { t: 'info', text: `${sp.name} n'affecte que les morts-vivants.` });
      return;
    }
    if (Math.hypot(target.x - p.x, target.z - p.z) > sp.range) {
      // hors mode combat : on s'approche puis on lance (à la T4C)
      if (msg.approach) { startApproachCast(p, msg, target.x, target.z); return; }
      game.send(p, { t: 'info', text: 'Trop loin.' });
      return;
    }
    if (!lineOfSight(p.zi.world, p, target)) return;
    cast.target = target.id;
    p.dir = Math.atan2(target.x - p.x, target.z - p.z);
  } else if (sp.type === 'aoe' && !sp.centered) {
    const cx = +msg.x, cz = +msg.z;
    if (!Number.isFinite(cx) || !Number.isFinite(cz)) return;
    if (Math.hypot(cx - p.x, cz - p.z) > sp.range) {
      if (msg.approach) { startApproachCast(p, msg, cx, cz); return; }
      game.send(p, { t: 'info', text: 'Trop loin.' });
      return;
    }
    cast.x = cx; cast.z = cz;
    p.dir = Math.atan2(cx - p.x, cz - p.z);
  }

  // T4C : l'effet du sort part IMMÉDIATEMENT — la « vitesse du sort » de la
  // Bible est le délai de RÉCUPÉRATION avant de pouvoir relancer, pas une
  // incantation préalable (corrigé d'après l'expérience de jeu de Quentin)
  if ((p.spellReadyAt || 0) > now) {
    game.send(p, { t: 'cast_cd', ms: Math.max(0, Math.round((p.spellReadyAt - now) * 1000)) });
    return;
  }
  p.casting = cast;
  if (resolveCast(game, p)) {
    const ms = castTimeMs(p, sp);
    p.spellCds[sp.id] = now + ms / 1000; // cooldown spécifique au sort
    p.spellReadyAt = now + 1.0; // Global Cooldown (GCD) de 1.0s
    p.state = C.ST.ATTACK; // posture de lancement
    game.send(p, { t: 'cast_start', spellId: sp.id, name: sp.name, ms }); // barre de récupération
  }
}

function applySpellDamage(p, target, eff, rawValue, game, sp) {
  if (!target || target.dead) return;
  
  let dmg = rawValue;
  
  // Boost de puissance élémentaire du lanceur
  if (eff.element) {
    const casterPower = p.eff?.stats?.[`power_${eff.element}`] || 0;
    dmg = dmg * (1 + casterPower);
  }
  
  // Absorption de Classe d'Armure (CA) si dégâts physiques
  if (eff.damageCategory === 'physical') {
    let defense = target.kind === C.KIND.PLAYER ? (target.eff?.defense || 0) : (target.sc?.def || 0);
    const pierce = p.eff?.stats?.pierce || 0;
    defense *= 1 - pierce;
    dmg = C.mitigate(dmg, defense);
  }
  
  // Résistance élémentaire de la cible : dmg / (1 + resist)
  if (eff.element) {
    const targetResist = target.eff?.stats?.[`resist_${eff.element}`] || target.def?.resist?.[eff.element] || 0;
    const resistValue = Math.max(0.01, 1 + targetResist);
    dmg = Math.max(1, Math.round(dmg / resistValue));
  }
  
  // Renvoi des morts-vivants (Wisdom scaling)
  if (sp.turnUndead && target.def?.undead) {
    const wis = p.eff?.stats?.wis || p.stats?.wis || 10;
    dmg *= wis / (20 + 2 * p.level);
  }
  
  target.applyDamage(p, Math.max(1, Math.round(dmg)), false, eff.element ? 'resist' : null, game);
  
  // Drain de vie (Leech)
  if (sp.leech && !target.def?.undead && !game.isCursed(p)) {
    const finalDmg = Math.max(1, Math.round(dmg));
    const maxHpVal = p.eff?.maxHp || p.maxHp || 100;
    p.hp = Math.min(maxHpVal, p.hp + Math.round(finalDmg * sp.leech));
    game.eventNear(p, { t: 'proj', from: target.id, to: p.id, color: '#5a1a6a', element: 'drain' });
    game.eventNear(p, { t: 'fx', kind: 'heal', id: p.id });
  }
}

function applySpellHeal(p, target, eff, rawValue, game, sp) {
  if (!target || target.dead) return;
  
  if (game.isCursed(target)) {
    game.send(p, { t: 'info', text: 'La cible est maudite, le soin échoue.' });
    return;
  }
  
  let healAmount = rawValue;
  if (eff.element === 'light') {
    const casterPowerLight = p.eff?.stats?.power_light || 0;
    const casterResistLight = p.eff?.stats?.resist_light || 0;
    healAmount = Math.round(healAmount * (1 + casterPowerLight) * (1 + casterResistLight));
  }
  
  const maxHpVal = target.eff?.maxHp || target.maxHp || 100;
  target.hp = Math.min(maxHpVal, target.hp + healAmount);
  game.eventNear(target, { t: 'fx', kind: 'heal', id: target.id });
}

// Applique l'effet du sort (formules de la Bible). Retourne true si le sort
// est réellement parti (la récupération ne s'applique qu'en cas de succès).
export function resolveCast(game, p) {
  const c = p.casting;
  p.casting = null;
  const sp = content.spellById[c.spellId];
  if (!sp || p.dead) return false;
  const now = game.now();
  if (p.mana < sp.mana) { game.send(p, { t: 'cast_break' }); game.send(p, { t: 'info', text: 'Mana insuffisant.' }); return false; }

  const formulaEntry = content.spellFormulas.get(sp.id);
  const effectsToApply = formulaEntry ? formulaEntry.effects : [];

  if (sp.type === 'bolt') {
    const target = p.zi.entities.get(c.target | 0);
    // la cible est morte ou s'est dérobée pendant l'incantation : le sort échoue sans coûter de mana
    if (!target || target.dead || target.hidden
        || Math.hypot(target.x - p.x, target.z - p.z) > sp.range + 2
        || !lineOfSight(p.zi.world, p, target)) {
      game.send(p, { t: 'cast_break' });
      game.send(p, { t: 'info', text: 'La cible s\'est dérobée.' });
      return false;
    }
    game.eventNear(target, { t: 'proj', from: p.id, to: target.id, color: sp.color, element: spellStyle(sp) });
    
    for (const eff of effectsToApply) {
      const rawValue = eff.expr ? Math.max(0, Math.round(eff.expr.evaluate(formulaContext(p, sp, target)))) : 0;
      
      if (eff.type === 'damage' || eff.kind === 'damage') {
        applySpellDamage(p, target, eff, rawValue, game, sp);
      } else if (eff.type === 'heal' || eff.kind === 'heal') {
        applySpellHeal(p, target, eff, rawValue, game, sp);
      } else {
        const duration = (eff.duration !== undefined ? eff.duration : (sp.duration !== undefined ? sp.duration : 0)) * 1000;
        target.effects.apply({
          type: eff.type || eff.kind,
          target_parameter: eff.target_parameter || eff.stat || null,
          power: rawValue || eff.power || eff.value || 0,
          duration,
          category: eff.category || 'magique',
          dice: eff.dice,
          base: eff.base,
                  element: eff.element || sp.element,
                  expr: eff.expr,
                  formula: eff.formula
        }, { type: 'spell', id: sp.id }, now * 1000);
      }
    }
    p.dir = Math.atan2(target.x - p.x, target.z - p.z);
    p.lastCombat = now;
  } else if (sp.type === 'aoe') {
    // sorts centrés sur le lanceur (Vague de Flamme, Séisme) ou sur un point visé
    const cx = sp.centered ? p.x : +c.x, cz = sp.centered ? p.z : +c.z;
    game.eventNear(p, { t: 'aoe', from: p.id, x: cx, z: cz, radius: sp.radius, color: sp.color, element: spellStyle(sp) });
    const hits = [...p.zi.nearby(cx, cz, sp.radius)].filter(e => e.kind === C.KIND.MOB && !e.dead);
    for (const e of hits) {
      const dist = Math.hypot(e.x - cx, e.z - cz);
      // dégâts pleins au centre, décroissants vers le bord ((20-r)/20 de la Bible)
      const distFactor = 1 - 0.5 * Math.min(1, dist / sp.radius);
      
      for (const eff of effectsToApply) {
        let rawValue = eff.expr ? Math.max(0, Math.round(eff.expr.evaluate(formulaContext(p, sp, e)) * distFactor)) : 0;
        if (hits.length === 1 && (eff.type === 'damage' || eff.kind === 'damage')) {
          rawValue *= 2; // T4C : dégâts doublés sur cible unique
        }
        
        if (eff.type === 'damage' || eff.kind === 'damage') {
          applySpellDamage(p, e, eff, rawValue, game, sp);
        } else if (eff.type === 'heal' || eff.kind === 'heal') {
          applySpellHeal(p, e, eff, rawValue, game, sp);
        } else {
          const duration = (eff.duration !== undefined ? eff.duration : (sp.duration !== undefined ? sp.duration : 0)) * 1000;
          e.effects.apply({
            type: eff.type || eff.kind,
            target_parameter: eff.target_parameter || eff.stat || null,
            power: rawValue || eff.power || eff.value || 0,
            duration,
            category: eff.category || 'magique',
            dice: eff.dice,
            base: eff.base,
                    element: eff.element || sp.element,
                    expr: eff.expr,
                    formula: eff.formula
          }, { type: 'spell', id: sp.id }, now * 1000);
        }
      }
    }
    p.lastCombat = now;
  } else {
    // Soi-même ou sans cible (buffs comme lumière, bénédiction, etc.)
    for (const eff of effectsToApply) {
      const rawValue = eff.expr ? Math.max(0, Math.round(eff.expr.evaluate(formulaContext(p, sp, p)))) : 0;
      
      if (eff.type === 'heal' || eff.kind === 'heal') {
        applySpellHeal(p, p, eff, rawValue, game, sp);
      } else {
        const duration = (eff.duration !== undefined ? eff.duration : (sp.duration !== undefined ? sp.duration : 0)) * 1000;
        p.effects.apply({
          type: eff.type || eff.kind,
          target_parameter: eff.target_parameter || eff.stat || null,
          power: rawValue || eff.power || eff.value || 0,
          duration,
          category: eff.category || 'magique',
          dice: eff.dice,
          base: eff.base,
                  element: eff.element || sp.element,
                  expr: eff.expr,
                  formula: eff.formula
        }, { type: 'spell', id: sp.id }, now * 1000);
      }
    }
    p.recompute(game);
    game.eventNear(p, { t: 'fx', kind: 'buff', id: p.id, color: sp.color, element: sp.element, stat: sp.buff?.stat || 'buff' });
  }

  p.mana -= sp.mana;
  const ms = castTimeMs(p, sp);
  p.state = C.ST.ATTACK;
  game.send(p, { t: 'cast_ok', spellId: sp.id, cd: Math.round(ms) / 1000, mana: Math.round(p.mana) });
  if (sp.type === 'buff') game.sendSelf(p); // maxHp/dégâts/défense ont pu changer
  else game.send(p, { t: 'vitals', hp: Math.round(p.hp), mana: Math.round(p.mana) });
  return true;
}

// Hors mode combat : marche jusqu'à la portée du sort, puis le lance
function startApproachCast(p, msg, tx, tz) {
  p.pendingCast = { ...msg, approach: false }; // une seule approche, pas de boucle
  p.path = findPath(p.zi.world, p.x, p.z, tx, tz);
  p.moveDir = null;
  p.attackTarget = null;
}
