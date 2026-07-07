// Entités du monde en classes (plan de la refonte POO de François, rejoué sur
// le code actuel) : Entity -> Character (combat) -> Player / Mob, plus NPC et
// Drop. Les responsabilités transverses (groupes, butin, zones, réseau) restent
// dans Game : les méthodes reçoivent `game` quand elles en ont besoin.
import * as C from '../../shared/constants.js';
import { ITEMS, SLOTS } from '../../shared/defs.js';
import { itemStats } from './items.js';
import { findPath, lineOfSight } from './pathfind.js';
import { content } from '../content.js';
import { applyResist, formulaContext } from './spells.js';
import * as db from '../db.js';
import { EntityEffects, computeModifiedStats, CANCEL_TRIGGERS, EFFECT_TYPES } from './effects.js';

const XP_NOTIFY_EVERY_TICKS = 5;  // flotteurs d'XP regroupés (2 envois/s au plus)

export class Entity {
  constructor(id, kind, x, z) {
    this.id = id;
    this.kind = kind;
    this.x = x;
    this.z = z;
    this.dir = 0;
    this.state = C.ST.IDLE;
    this.dead = false;
    this.hidden = false;
    this.zi = null; // ZoneInstance de rattachement
    this.path = null;
  }

  // suit le chemin courant à `speed` tuiles/s
  stepAlong(speed, dt, game) {
    if (!this.path || !this.path.length) {
      if (this.state === C.ST.WALK) this.state = C.ST.IDLE;
      return;
    }
    let remaining = speed * dt;
    let moved = false;
    while (remaining > 0 && this.path && this.path.length) {
      const wp = this.path[0];
      const dx = wp.x - this.x, dz = wp.z - this.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.05) { this.path.shift(); continue; }
      const step = Math.min(d, remaining);
      this.x += (dx / d) * step;
      this.z += (dz / d) * step;
      this.dir = Math.atan2(dx, dz);
      remaining -= step;
      moved = true;
    }
    if (this.path && !this.path.length) this.path = null;
    this.state = this.path ? C.ST.WALK : (this.state === C.ST.ATTACK ? C.ST.ATTACK : C.ST.IDLE);
    this.zi.gridMove(this);
    // un joueur qui suit un chemin maintient la zone « chaude » (spawn T4C)
    if (moved) {
      if (this.effects) {
        const cancelled = this.effects.triggerCancel(CANCEL_TRIGGERS.ON_MOVE);
        if (cancelled.length && this.kind === C.KIND.PLAYER) {
          this.recompute(game);
          game.sendSelf(this);
        }
      }
      if (this.kind === C.KIND.PLAYER) game.heatZone(this.zi);
    }
  }
}

// Tout ce qui se bat : joueurs et monstres
export class Character extends Entity {
  constructor(id, kind, x, z, level, hp) {
    super(id, kind, x, z);
    this.level = level;
    this.hp = hp;
    this.maxHp = hp;
    this.mana = 0;
    this.maxMana = 0;
    this.atkCd = 0;
    this.lastCombat = -99;
    this.effects = new EntityEffects(this); // Initialisation du gestionnaire d'effets unifié
    this.curseUntil = 0;
  }

  /**
   * Cycle de mise à jour commun pour tous les personnages (timers d'effets, poisons, etc.)
   */
  tick(game, now, dt) {
    if (this.dead) return;

    // Mise à jour du gestionnaire d'effets unifié
    this.effects.tick(now * 1000, {
      onExpired: (entity, ae) => {
        this.recompute(game);
        if (this.kind === C.KIND.PLAYER) {
          game.sendSelf(this);
        }
      },
      onPeriodicTick: (entity, ae) => {
        if (ae.type === EFFECT_TYPES.DAMAGE) {
          const from = game.players.get(ae.from_id) || game.zones.get(entity.zi?.key)?.entities.get(ae.from_id);
          const min = ae.dot_min || ae.power || 1;
          const max = ae.dot_max || min;
          const dmg = Math.max(1, Math.round(min + Math.random() * (max - min)));
          
          let finalDmg = dmg;
          if (ae.element) {
            const { dmg: resDmg } = applyResist(entity, { element: ae.element }, dmg);
            finalDmg = resDmg;
          }
          
          entity.applyDamage(from || entity, finalDmg, false, null, game);
        } else if (ae.type === EFFECT_TYPES.HEAL) {
          const min = ae.power || 1;
          const max = ae.dot_max || min;
          const healVal = Math.max(1, Math.round(min + Math.random() * (max - min)));
          
          if (!game.isCursed(entity)) {
            const maxHpVal = entity.eff?.maxHp || entity.maxHp || 100;
            entity.hp = Math.min(maxHpVal, entity.hp + healVal);
            game.eventNear(entity, { t: 'fx', kind: 'heal', id: entity.id });
            if (entity.kind === C.KIND.PLAYER) {
              game.send(entity, { t: 'vitals', hp: Math.round(entity.hp), mana: Math.round(entity.mana) });
            }
          }
        }
      }
    });
  }

  applyDamage(attacker, dmg, crit, mod, game) {
    const hpBefore = this.hp;
    this.hp -= dmg;
    this.lastCombat = game.now();
    game.eventNear(this, { t: 'dmg', from: attacker.id, to: this.id, amount: dmg, crit, mod });
    
    const cancelled = this.effects.triggerCancel(CANCEL_TRIGGERS.ON_DAMAGE_RECEIVED);
    this.effects.triggerCancel(CANCEL_TRIGGERS.ON_COMBAT_ENTERED);
    if (cancelled.length && this.kind === C.KIND.PLAYER) {
      this.recompute(game);
      game.sendSelf(this);
    }

    // XP « par coup » (T4C) : chaque dégât d'un joueur sur un monstre rapporte
    // xpTotale × dégâtsEffectifs / PVmax, bornés aux PV restants (pas d'XP
    // d'overkill). Les PV régénérés redonnent de l'XP : pas de plafond cumulé
    // par monstre — le « milking » de liche est canon.
    if (attacker.kind === C.KIND.PLAYER && this.kind === C.KIND.MOB && dmg > 0) {
      const effective = Math.min(dmg, Math.max(0, hpBefore));
      if (effective > 0) game.shareXpForDamage(attacker, this, effective / this.maxHp);
    }
    if (this.hp <= 0) {
      if (this.kind === C.KIND.MOB) game.killMob(this, attacker);
      else game.killPlayer(this, attacker);
    } else if (this.kind === C.KIND.PLAYER) {
      game.send(this, { t: 'vitals', hp: Math.round(this.hp), mana: Math.round(this.mana) });
    }
  }

  applyHeal(caster, ae, game) {
    if (this.dead) return;
    if (game.isCursed(this)) {
      if (caster.kind === C.KIND.PLAYER) {
        game.send(caster, { t: 'info', text: 'La cible est maudite, le soin échoue.' });
      }
      return;
    }

    let healAmount = ae.power;
    if (ae.element === 'light') {
      const casterPowerLight = caster.eff?.stats?.power_light || 0;
      const targetResistLight = this.eff?.stats?.resist_light || 0;
      healAmount = Math.round(healAmount * (1 + casterPowerLight) * (1 + targetResistLight));
    }

    const maxHpVal = this.eff?.maxHp || this.maxHp || 100;
    this.hp = Math.min(maxHpVal, this.hp + healAmount);
    game.eventNear(this, { t: 'fx', kind: 'heal', id: this.id, fx: ae.fx });
    if (this.kind === C.KIND.PLAYER) {
      game.send(this, { t: 'vitals', hp: Math.round(this.hp), mana: Math.round(this.mana) });
    }
  }

  applySpellDamage(caster, ae, game) {
    if (this.dead) return;

    let dmg = ae.power;

    if (ae.element) {
      const casterPower = caster.eff?.stats?.[`power_${ae.element}`] || 0;
      dmg = dmg * (1 + casterPower);
    }

    if (ae.damageCategory === 'physical') {
      let defense = this.eff?.defense || 0;
      const pierce = caster.eff?.stats?.pierce || 0;
      defense *= 1 - pierce;
      dmg = C.mitigate(dmg, defense);
    }

    if (ae.element) {
      const { dmg: finalDmg } = applyResist(this, { element: ae.element }, dmg);
      dmg = finalDmg;
    }

    this.applyDamage(caster, Math.max(1, Math.round(dmg)), false, ae.element ? 'resist' : null, game);

    if (ae.type === EFFECT_TYPES.DRAIN && !this.def?.undead && !game.isCursed(caster)) {
      const finalDmg = Math.max(1, Math.round(dmg));
      const maxHpVal = caster.eff?.maxHp || caster.maxHp || 100;
      const ratio = ae.drain_ratio !== null ? ae.drain_ratio : 1.0;
      caster.hp = Math.min(maxHpVal, caster.hp + Math.round(finalDmg * ratio));
      game.eventNear(caster, { t: 'proj', from: this.id, to: caster.id, color: '#5a1a6a', element: 'drain' });
      game.eventNear(caster, { t: 'fx', kind: 'heal', id: caster.id });
    }
  }

  attack(defender, game) {
    // Sanctuaire : la cible est intouchable ; l'attaquant en transe ne frappe pas
    if (game.isUntouchable(defender)) return;
    if (this.kind === C.KIND.PLAYER && game.isPacified(this)) { this.attackTarget = null; return; }
    
    const cancelled = this.effects.triggerCancel(CANCEL_TRIGGERS.ON_ACTION_PERFORMED);
    this.effects.triggerCancel(CANCEL_TRIGGERS.ON_COMBAT_ENTERED);
    if (cancelled.length && this.kind === C.KIND.PLAYER) {
      this.recompute(game);
      game.sendSelf(this);
    }

    const aStats = this.eff.stats;
    const dStats = defender.eff.stats;
    this.state = C.ST.ATTACK;
    this.dir = Math.atan2(defender.x - this.x, defender.z - this.z);
    this.lastCombat = game.now();
    defender.lastCombat = game.now();

    let hitC = C.hitChance(aStats, dStats);
    // T4C : Attaque ne sert qu'en mêlée, Archerie qu'à l'arc — jamais les deux
    const usesBow = this.kind === C.KIND.PLAYER && this.eff.ranged;
    const hitBonus = usesBow ? this.eff.stats.ranged_hit : this.eff.stats.hit;
    hitC = Math.min(0.98, hitC + hitBonus);
    hitC = Math.max(0.15, hitC - defender.eff.stats.dodge);
    if (Math.random() > hitC) {
      game.eventNear(defender, { t: 'dmg', from: this.id, to: defender.id, miss: true });
      return;
    }
    // Parade T4C : annule totalement le coup (bouclier : +50 % d'efficacité)
    if (Math.random() < defender.eff.stats.parry) {
      game.eventNear(defender, { t: 'dmg', from: this.id, to: defender.id, parry: true });
      return;
    }
    // flèche : trace visuelle du tir à chaque coup réussi (système des projectiles de sorts)
    if (usesBow) game.eventNear(defender, { t: 'proj', from: this.id, to: defender.id, color: '#d8c8a0' });
    // joueur : tirage dans la fourchette de l'arme (T4C) ; monstre : variance
    let dmg;
    if (this.kind === C.KIND.PLAYER) {
      const e = this.eff;
      dmg = Math.round((e.dmgMin + Math.random() * (e.dmgMax - e.dmgMin)) * e.dmgMult);
    } else {
      dmg = Math.round(this.sc.dmg * (0.85 + Math.random() * 0.3));
    }
    let crit = false;
    const critChance = C.critChance(aStats) + (this.eff.stats.crit || 0);
    if (Math.random() < critChance) {
      dmg = Math.round(dmg * 1.6); crit = true;
    }
    let defense = defender.eff.defense;
    // Transpercer l'armure : la CA adverse compte moins (0,25 %/pt)
    defense *= 1 - (this.eff.stats.pierce || 0);
    dmg = C.mitigate(dmg, defense);
    // attaque élémentaire d'un monstre (ex. Fourmi de feu) : les résistances
    // du défenseur s'appliquent (Bouclier de mana, Résistance au feu/à la glace...)
    let elemMod = null;
    if (this.kind === C.KIND.MOB && this.def.element) {
      ({ dmg, mod: elemMod } = applyResist(defender, { element: this.def.element }, dmg));
    }
    // Coup assommant : chance d'immobiliser brièvement le monstre
    if (this.kind === C.KIND.PLAYER && defender.kind === C.KIND.MOB
        && Math.random() < (this.eff.stats.stun || 0)) {
      defender.effects.apply({
        type: EFFECT_TYPES.STUN,
        duration: 800,
        category: 'physique'
      }, { type: 'skill', id: 'coup_assommant' }, game.now() * 1000);
      defender.path = null;
    }
    defender.applyDamage(this, dmg, crit, elemMod, game);
    // Boucliers de Feu/Glace/Électrique (T4C) : riposte élémentaire à chaque
    // coup physique encaissé — 1dN + base, modulé par la résistance du monstre
    if (defender.kind === C.KIND.PLAYER && this.kind === C.KIND.MOB && !this.dead) {
      for (const ae of defender.effects.active) {
        if (ae.type === EFFECT_TYPES.RETORT) {
          let raw = ae.power || 0;
          if (ae.expr) {
            try {
              raw = Math.max(1, Math.round(ae.expr.evaluate(formulaContext(defender, { id: ae.source.id }, this))));
            } catch (e) {
              console.error(`Erreur d'évaluation du retort :`, e);
            }
          }
          const { dmg: rDmg, mod } = applyResist(this, { element: ae.element }, raw);
          this.applyDamage(defender, rDmg, false, mod, game);
          if (this.dead) break;
        }
      }
    }
  }
}

export class Player extends Character {
  constructor(id, ws, accountId, isAdmin, data) {
    super(id, C.KIND.PLAYER, data.x, data.z, data.level, 1);
    this.ws = ws;
    this.accountId = accountId;
    this.isAdmin = !!isAdmin;
    this.name = data.name;
    this.sex = data.sex || 'male';
    this.xp = data.xp;
    this.statPoints = data.statPoints;
    this.stats = data.stats;
    this.gold = data.gold;
    this.inventory = data.inventory || [];
    this.equip = data.equip || {};
    this.bank = data.bank ?? []; // coffre personnel (migration : anciens personnages sans banque)
    this.spells = data.spells || [];
    // migration : l'ancien format (tableau d'ids) est abandonné -> {id: points}
    this.skills = (data.skills && !Array.isArray(data.skills)) ? data.skills : {};
    this.unlocked = data.unlocked || [0];
    // drapeaux persistants posés par les dialogues de PNJ (quêtes, accès,
    // récompenses déjà versées `dlg:<npc>:<index>`) — clef -> true
    this.flags = data.flags || {};
    this.moveDir = null;
    this.attackTarget = null;
    this.party = null;
    this.partyInvite = null;
    this.xpNotify = 0;
    this.known = new Set();
    this.events = [];
    this.lastChat = 0;
    this.channels = Array.isArray(data.channels) ? data.channels : ['general', 'aide', 'ventes', 'roleplay'];
    this.pendingPickup = null;
    this.pendingInteract = null;
    this.trialOffer = null;
    this.obeliskUntil = 0;
    // dernier point spécial 'exit'/'teleport' déclenché : évite le rebouclage
    // tant que le joueur n'a pas quitté la case du marqueur (cf. game.js)
    this.lastMarkerId = null;
    // sous-zone musicale active (id) et dernière piste poussée (anti-spam) :
    // pilotent la bascule à hystérésis (cf. game.js evalPlayerMusic)
    this.musicZoneId = null;
    this.lastMusicSent = null;
    // sous-zone d'ambiance active (id) et dernière ambiance poussée (anti-spam) :
    // même bascule à hystérésis que la musique (cf. game.js evalPlayerAmbience)
    this.ambienceZoneId = null;
    this.lastAmbienceSent = null;
    // PV/mana accumulés niveau par niveau (migration : approximation rétroactive)
    this.hpAcc = data.hpAcc ?? C.maxHp(this.stats, this.level);
    this.manaAcc = data.manaAcc ?? C.maxMana(this.stats, this.level);
    
    this.mana = 1; // Initialisation du mana du joueur
    this.spellCds = {};
    this.casting = null;
  }

  // ---------- Stats effectives ----------
  recompute(game) {
    const stats = { ...this.stats };
    let wMin = 0, wMax = 0, weaponSpeed = null, defense = 0, dodgeMalus = 0;
    let wRanged = false, wRange = 0, attBonus = 0;
    for (const slot of SLOTS) {
      const iid = this.equip[slot];
      if (!iid) continue;
      const item = this.inventory.find(i => i.iid === iid);
      if (!item) { delete this.equip[slot]; continue; }
      const s = itemStats(item);
      if (slot === 'weapon') {
        wMin = s.dmgMin; wMax = s.dmgMax; weaponSpeed = s.speed;
        // arc T4C : l'attaque normale porte à `range` tuiles (avec ligne de vue)
        const wDef = ITEMS[item.defId];
        wRanged = !!wDef.ranged; wRange = wDef.range || 0;
      }
      defense += s.def;
      dodgeMalus += s.malus || 0; // malus d'esquive des armures lourdes (T4C) — négatif = bonus
      attBonus += ITEMS[item.defId].att || 0; // points d'Attaque offerts (Écu de Drachen : +50 Att)
      for (const [st, v] of Object.entries(s.bonus)) stats[st] = (stats[st] || 0) + v;
    }

    // Nettoyage des anciens effets passifs de compétences
    this.effects.clearBySourceCondition(src => src.type === 'skill');

    // Nettoyage des anciens effets passifs d'objets (équipés ou inventaire)
    this.effects.clearBySourceCondition(src => src.type === 'item_equipped' || src.type === 'item_inventory');

    // Application des effets passifs d'objets
    for (const item of this.inventory) {
      const def = ITEMS[item.defId];
      if (!def || !def.effects) continue; // Si l'objet n'a pas d'effets définis, on passe

      const isEquipped = Object.values(this.equip).includes(item.iid);

      for (const eff of def.effects) {
        const applyOn = eff.apply_on || 'equipped';
        if (applyOn === 'equipped' && !isEquipped) continue;
        if (applyOn === 'inventory' && isEquipped) continue; // Ne pas appliquer les effets d'inventaire si l'objet est équipé

        const sourceType = applyOn === 'equipped' ? 'item_equipped' : 'item_inventory';

        this.effects.apply({
          ...eff,
          duration: Infinity
        }, {
          type: sourceType,
          id: item.defId,
          iid: item.iid
        }, game.now() * 1000);
      }
    }

    // Application des effets passifs de compétences
    for (const [skillId, pts] of Object.entries(this.skills)) {
      if (!pts) continue;
      const skEntry = content.skillFormulas.get(skillId);
      if (!skEntry || !skEntry.effects) continue;

      for (const eff of skEntry.effects) {
        const power = eff.expr ? eff.expr.evaluate({ pts: pts }) : (eff.power || 0);
        this.effects.apply({
          type: eff.type,
          target_parameter: eff.target_parameter,
          power: power,
          duration: Infinity,
          category: eff.category || 'systeme'
        }, {
          type: 'skill',
          id: skillId
        }, game.now() * 1000);
      }
    }
    // un bouclier équipé améliore la parade de moitié (T4C)
    if (this.equip.shield) {
      this.effects.apply({
        type: EFFECT_TYPES.STATS_BOOST,
        target_parameter: 'parry',
        power: 0.5, // 50% bonus
        duration: Infinity,
        category: 'systeme'
      }, {
        type: 'item_equipped',
        id: 'shield_bonus', // Unique ID for this specific bonus
        iid: 'shield_bonus'
      }, game.now() * 1000);
    }
    // bonus d'Attaque d'objets (+50 Att = +5 % de toucher en mêlée, comme la compétence)
    // This needs to come from item effects directly, not hardcoded here.
    // For now, let's assume item effects will handle this.

    // Préparation d'une entité virtuelle de base (attributs + équipements + passifs de compétences)
    const baseEntity = {
      stats,
      skills: this.skills,
      // These will be calculated by EntityStats based on active effects
      hit: 0, // Initialiser à 0, sera modifié par les effets
      ranged_hit: 0, // Initialiser à 0, sera modifié par les effets
      dodge: 0, // Initialiser à 0, sera modifié par les effets
      parry: 0, // Initialiser à 0, sera modifié par les effets
      dmgMul: 0, // Initialiser à 0, sera modifié par les effets
      crit: 0, // Initialiser à 0, sera modifié par les effets
      pierce: 0, // Initialiser à 0, sera modifié par les effets
      hpRegenMul: 0, // Initialiser à 0, sera modifié par les effets
      manaRegenMul: 0, // Initialiser à 0, sera modifié par les effets
      discount: 0, // Initialiser à 0, sera modifié par les effets
      loot: 0, // Initialiser à 0, sera modifié par les effets
      stun: 0, // Initialiser à 0, sera modifié par les effets
      maxHp: Math.floor((this.hpAcc ?? C.maxHp(stats, this.level))), // hpMul sera appliqué par les effets
      maxMana: Math.floor(this.manaAcc ?? C.maxMana(stats, this.level)),
      defense: defense, // def sera appliqué par les effets
      effects: this.effects,
    };

    // Calcul des statistiques finales via le système d'effets
    const modStats = computeModifiedStats(baseEntity);

    // skillFx est maintenant entièrement dérivé de modStats pour l'affichage/compatibilité
    this.skillFx = {
      dmgMul: modStats.dmgMul,
      def: modStats.defense - defense, // Calculer la contribution de la compétence à la défense
      hpMul: modStats.maxHp / Math.floor((this.hpAcc ?? C.maxHp(stats, this.level))) - 1, // Calculer la contribution de la compétence au HP max
      speed: modStats.speed / C.moveSpeed(modStats) - 1, // Calculer la contribution de la compétence à la vitesse
      hit: modStats.hit,
      rangedHit: modStats.ranged_hit,
      crit: modStats.crit,
      dodge: modStats.dodge,
      parry: modStats.parry,
      stun: modStats.stun,
      pierce: modStats.pierce,
      manaRegenMul: modStats.manaRegenMul,
      hpRegenMul: modStats.hpRegenMul,
      discount: modStats.discount,
      loot: modStats.loot,
      spellMul: 0 // spellMul est obsolète, géré par les puissances élémentaires individuelles
    };

    const strBonus = Math.floor(modStats.str / 3);
    
    const hpRegenBoost = this.effects.active
      .filter(ae => ae.type === EFFECT_TYPES.HP_REGEN_BOOST)
      .reduce((sum, ae) => sum + ae.power, 0);

    this.eff = {
      stats: modStats,
      maxHp: modStats.maxHp,
      maxMana: modStats.maxMana,
      dmgMin: ((wMin || 2) + strBonus),
      dmgMax: ((wMax || 3) + strBonus),
      dmgMult: 1 + modStats.dmgMul, // dmgMul est maintenant directement dans modStats
      dmg: Math.floor(((wMin || 2) + (wMax || 3)) / 2 + strBonus), // affichage
      atkCd: C.attackCooldown(modStats, weaponSpeed),
      defense: modStats.defense,
      // La vitesse de déplacement prend désormais en compte le multiplicateur d'effets lents (slow)
      speed: Math.min(7.5, (C.moveSpeed(modStats)) * this.effects.getSpeedMultiplier()),
      // arc équipé : portée de l'arme (tuiles), sinon mêlée
      atkRange: wRanged ? Math.max(1.8, wRange || 8) : 1.8,
      ranged: wRanged,
      buffRegen: hpRegenBoost,
      capacity: modStats.encombrementMax,
    };
    this.hp = Math.min(this.hp, this.eff.maxHp);
    this.mana = Math.min(this.mana, this.eff.maxMana);

    // apparence (couches Flare)
    const layerOf = (slot) => {
      const iid = this.equip[slot];
      const item = iid && this.inventory.find(i => i.iid === iid);
      return item ? (ITEMS[item.defId].layer || null) : null;
    };
    const look = {
      sex: this.sex,
      chest: layerOf('armor'), head: layerOf('helmet'),
      legs: layerOf('legs'), hands: layerOf('gloves'),
      main: layerOf('weapon'), off: layerOf('shield'), feet: layerOf('boots'),
    };
    const changed = JSON.stringify(look) !== JSON.stringify(this.look || null);
    this.look = look;
    if (changed && game && game.players.has(this.id)) {
      game.eventNear(this, { t: 'look', id: this.id, look });
    }
  }

  // Crédite de l'XP (flottante : les petits coups s'accumulent sans perte).
  // Le client est notifié par paquets via 'xp' (flush throttlé dans tick).
  grantXp(amount, game) {
    if (!game.players.has(this.id) || this.permadead || amount <= 0) return;
    this.xp += amount;
    this.xpNotify = (this.xpNotify || 0) + amount;
    let leveled = false;
    while (this.level < C.MAX_LEVEL && this.xp >= C.xpForLevel(this.level + 1)) {
      this.level++;
      this.statPoints += C.POINTS_PER_LEVEL;
      // gains de PV/mana figés au passage de niveau, selon les stats DU MOMENT
      // (équipement compris) — fidèle à T4C
      this.hpAcc += C.hpGainPerLevel(this.eff.stats);
      this.manaAcc += C.manaGainPerLevel(this.eff.stats);
      leveled = true;
    }
    if (leveled) {
      this.recompute(game);
      this.hp = this.eff.maxHp; this.mana = this.eff.maxMana;
      game.eventNear(this, { t: 'fx', kind: 'levelup', id: this.id });
      game.broadcastChat('sys', `${this.name} passe niveau ${this.level} !`);
      game.sendSelf(this);
    }
  }

  save() {
    if (this.permadead) return;
    // en caverne, on sauvegarde le point de retour à la surface : les
    // coordonnées de la grotte n'auraient aucun sens sur la carte de l'île
    const pos = this.zi.isCave ? this.zi.returnTo : this;
    db.saveCharacter(this.accountId, {
      name: this.name, level: this.level, xp: this.xp, statPoints: this.statPoints,
      stats: this.stats, hp: this.hp, mana: this.mana, x: pos.x, z: pos.z,
      gold: this.gold, inventory: this.inventory, equip: this.equip,
      bank: this.bank,
      hpAcc: this.hpAcc, manaAcc: this.manaAcc,
      spells: this.spells, skills: this.skills, unlocked: this.unlocked,
      flags: this.flags,
      channels: this.channels,
      sex: this.sex,
      zoneId: this.zi.zoneId, // pour une Épreuve, c'est la zone d'origine
      trialFor: this.zi.isTrial ? this.zi.trialTarget : null,
    });
  }

  // renaissance après la mort définitive (nouveau personnage, même compte)
  reincarnate(game, stats = null, sex = null) {
    const zi0 = game.island(0);
    const data = db.newCharacterData(this.name, zi0.world.spawnPoint, stats, sex || this.sex);
    this.sex = data.sex;
    db.saveCharacter(this.accountId, data);
    this.permadead = false; this.dead = false; this.state = C.ST.IDLE;
    this.level = 1; this.xp = 0; this.statPoints = 0;
    this.stats = { ...data.stats };
    this.hpAcc = C.maxHp(this.stats, 1);
    this.manaAcc = C.maxMana(this.stats, 1);
    this.gold = data.gold;
    this.inventory = data.inventory; this.equip = data.equip;
    this.bank = data.bank || []; // la banque de l'ancien personnage est perdue (permadeath)
    this.spells = []; this.skills = {}; this.unlocked = [0];
    this.flags = {}; this.spellCds = {}; this.casting = null;
    this.curseUntil = 0;
    this.recompute(game);
    this.hp = this.eff.maxHp; this.mana = this.eff.maxMana;
    game.movePlayerToZone(this, zi0, zi0.world.spawnPoint.x, zi0.world.spawnPoint.z);
    game.broadcastChat('sys', `${this.name} renaît sur ${game.zoneDef(0).name}.`);
  }

  tick(game, now, dt) {
    if (this.dead) return;
    super.tick(game, now, dt);
    if (this.dead) return; // Peut mourir suite à un DoT lors du tick parent

    // régénération
    if (now - this.lastCombat > 5 || this.eff.buffRegen) {
      const oldHp = this.hp, oldMana = this.mana;
      const inCombat = now - this.lastCombat <= 5;
      if (!inCombat) {
        this.hp = Math.min(this.eff.maxHp, this.hp + C.hpRegenPerSec(this.eff.stats) * (1 + (this.skillFx?.hpRegenMul || 0)) * dt);
        this.mana = Math.min(this.eff.maxMana, this.mana + C.manaRegenPerSec(this.eff.stats) * (1 + (this.skillFx?.manaRegenMul || 0)) * dt);
      }
      if (this.eff.buffRegen) this.hp = Math.min(this.eff.maxHp, this.hp + this.eff.buffRegen * dt);
      if ((Math.floor(this.hp) !== Math.floor(oldHp) || Math.floor(this.mana) !== Math.floor(oldMana)) && game.tickCount % 10 === 0) {
        game.send(this, { t: 'vitals', hp: Math.round(this.hp), mana: Math.round(this.mana) });
      }
    }
    this.atkCd = Math.max(0, this.atkCd - dt);

    // XP accumulée depuis le dernier envoi : un seul message regroupé
    // (le client affiche un flotteur lisible, pas un par tick de DoT)
    if ((this.xpNotify || 0) >= 1 && game.tickCount % XP_NOTIFY_EVERY_TICKS === 0) {
      game.send(this, { t: 'xp', gain: Math.round(this.xpNotify), xp: Math.floor(this.xp) });
      this.xpNotify = 0;
    }

    // déplacement direct (flèches / clic maintenu)
    if (this.moveDir) {
      const sp = this.eff.speed * dt;
      const ox = this.x, oz = this.z;
      const nx = this.x + this.moveDir.x * sp, nz = this.z + this.moveDir.z * sp;
      if (this.zi.world.isWalkable(nx, nz)) { this.x = nx; this.z = nz; }
      else if (this.zi.world.isWalkable(nx, this.z)) { this.x = nx; }
      else if (this.zi.world.isWalkable(this.x, nz)) { this.z = nz; }
      this.dir = Math.atan2(this.moveDir.x, this.moveDir.z);
      this.state = C.ST.WALK;
      this.zi.gridMove(this);
      if (this.x !== ox || this.z !== oz) {
        const cancelled = this.effects.triggerCancel(CANCEL_TRIGGERS.ON_MOVE);
        if (cancelled.length) {
          this.recompute(game);
          game.sendSelf(this);
        }
        game.heatZone(this.zi); // mouvement réel
      }
    }

    // poursuite/attaque
    if (this.attackTarget != null) {
      const tgt = this.zi.entities.get(this.attackTarget);
      if (!tgt || tgt.dead || tgt.hidden) { this.attackTarget = null; this.state = C.ST.IDLE; }
      else {
        const dist = Math.hypot(tgt.x - this.x, tgt.z - this.z);
        if (dist <= this.eff.atkRange && lineOfSight(this.zi.world, this, tgt)) {
          this.path = null;
          if (this.atkCd <= 0) { this.atkCd = this.eff.atkCd; this.attack(tgt, game); }
          else if (this.state !== C.ST.ATTACK) this.state = C.ST.IDLE;
        } else if (!this.path || game.tickCount % 5 === 0) {
          this.path = findPath(this.zi.world, this.x, this.z, tgt.x, tgt.z);
        }
      }
    }
    if (!this.moveDir) this.stepAlong(this.eff.speed, dt, game);

    // ramassage / interaction en attente
    if (this.pendingPickup != null) {
      const d = this.zi.entities.get(this.pendingPickup);
      if (!d || d.kind !== C.KIND.DROP) this.pendingPickup = null;
      else if (Math.hypot(d.x - this.x, d.z - this.z) <= C.PICKUP_RANGE) {
        game.doPickup(this, d);
        this.pendingPickup = null;
      }
    }
    // sort en attente d'approche : lance dès qu'on est à portée
    if (this.pendingCast) {
      const pc = this.pendingCast;
      const spc = content.spellById[pc.spellId];
      const tgt = pc.target != null ? this.zi.entities.get(pc.target) : null;
      if (!spc || (pc.target != null && (!tgt || tgt.dead || tgt.hidden))) {
        this.pendingCast = null;
      } else {
        const tx = tgt ? tgt.x : pc.x, tz = tgt ? tgt.z : pc.z;
        // à portée ET en ligne de vue : sinon on continue d'avancer
        if (Math.hypot(tx - this.x, tz - this.z) <= spc.range
            && lineOfSight(this.zi.world, this, { x: tx, z: tz })) {
          if ((this.spellCds[spc.id] || 0) <= now) {
            this.pendingCast = null;
            this.path = null;
            game.castSpell(this, pc);
          }
        } else if (!this.path || game.tickCount % 5 === 0) {
          this.path = findPath(this.zi.world, this.x, this.z, tx, tz);
        }
      }
    }
    if (this.pendingInteract) {
      const pi = this.pendingInteract;
      const tx = pi.id != null ? this.zi.entities.get(pi.id)?.x : pi.px;
      const tz = pi.id != null ? this.zi.entities.get(pi.id)?.z : pi.pz;
      if (tx == null) this.pendingInteract = null;
      else if (Math.hypot(tx - this.x, tz - this.z) <= C.INTERACT_RANGE) {
        this.pendingInteract = null;
        if (pi.id != null) {
          const npc = this.zi.entities.get(pi.id);
          if (npc?.kind === C.KIND.NPC) game.openShop(this, npc);
        } else {
          const prop = (this.zi.world.props || []).find(pr => pr.type === pi.prop && Math.hypot(pr.x - pi.px, pr.z - pi.pz) < 0.1);
          if (prop) game.interactProp(this, prop);
        }
      }
    }
  }
}

export class Mob extends Character {
  constructor(id, defId, def, sc, x, z, now) {
    super(id, C.KIND.MOB, x, z, sc.level, sc.hp);
    this.defId = defId;
    this.def = def;
    this.sc = sc;
    this.home = { x, z };
    this.target = null;
    this.wanderAt = now + 2 + Math.random() * 6;
    this.hideAt = 0;
    this.camp = null; // camp de spawn par mouvement (budget de population)
    this.recompute();
  }

  recompute(game) {
    const stats = {
      str: this.def?.stats?.str || 0,
      end: this.def?.stats?.end || 0,
      agi: Math.round(this.def?.stats?.agi || (10 + this.level * 1.8)),
      int: this.def?.stats?.int || 0,
      wis: this.def?.stats?.wis || 0,
    };

    const baseEntity = {
      stats,
      power: this.def?.power || {},
      resist: this.def?.resist || {},
      maxHp: this.sc?.hp || this.maxHp,
      maxMana: this.def?.maxMana || 0,
      defense: this.sc?.def || 0,
      effects: this.effects,
    };

    const modStats = computeModifiedStats(baseEntity);

    this.eff = {
      stats: modStats,
      maxHp: modStats.maxHp,
      maxMana: modStats.maxMana,
      defense: modStats.defense,
      speed: (this.def?.speed || 4.0) * this.effects.getSpeedMultiplier(),
    };
    
    this.maxHp = this.eff.maxHp;
    this.maxMana = this.eff.maxMana;
    this.hp = Math.min(this.hp, this.eff.maxHp);
  }

  tick(game, now, dt) {
    const zi = this.zi;
    if (this.dead) {
      // le cadavre reste visible le temps du râle, puis l'entité disparaît :
      // plus de réapparition par timer (le spawn par mouvement prend le relais)
      if (now >= this.hideAt) zi.remove(this);
      return;
    }
    super.tick(game, now, dt);
    if (this.dead) return; // Peut mourir suite à un DoT lors du tick parent

    this.atkCd = Math.max(0, this.atkCd - dt);
    if (this.effects.hasType(EFFECT_TYPES.STUN)) return; // assommé (Coup assommant)

    if (!this.target && (game.tickCount + this.id) % 5 === 0) {
      let best = null, bestD = this.def.aggro;
      for (const e of zi.nearby(this.x, this.z, this.def.aggro)) {
        if (e.kind !== C.KIND.PLAYER || e.dead || game.isUntouchable(e)) continue;
        const d = Math.hypot(e.x - this.x, e.z - this.z);
        if (d < bestD) { bestD = d; best = e; }
      }
      if (best) this.target = best.id;
    }

    if (this.target) {
      const tgt = zi.entities.get(this.target);
      const leashed = Math.hypot(this.x - this.home.x, this.z - this.home.z) > this.def.leash;
      if (!tgt || tgt.dead || game.isUntouchable(tgt) || leashed || Math.hypot(tgt.x - this.x, tgt.z - this.z) > this.def.leash) {
        this.target = null;
        this.path = findPath(zi.world, this.x, this.z, this.home.x, this.home.z);
      } else {
        const dist = Math.hypot(tgt.x - this.x, tgt.z - this.z);
        if (dist <= this.def.atkRange) {
          this.path = null;
          if (this.atkCd <= 0) { this.atkCd = this.def.atkSpeed; this.attack(tgt, game); }
        } else if (!this.path || (game.tickCount + this.id) % 5 === 0) {
          this.path = findPath(zi.world, this.x, this.z, tgt.x, tgt.z);
        }
      }
    } else if (now >= this.wanderAt) {
      this.wanderAt = now + 4 + Math.random() * 8;
      const a = Math.random() * Math.PI * 2, d = 1 + Math.random() * 4;
      const wx = this.home.x + Math.cos(a) * d, wz = this.home.z + Math.sin(a) * d;
      if (zi.world.isWalkable(wx, wz)) this.path = findPath(zi.world, this.x, this.z, wx, wz);
    }

    // Enchevêtrement : vitesse réduite tant que le ralentissement court
    const speed = (this.slowUntil && now < this.slowUntil) ? this.def.speed * (this.slowFactor ?? 0.5) : this.def.speed;
    this.stepAlong(speed, dt, game);
  }
}

export class NPC extends Character {
  constructor(id, npcId, def, x, z) {
    super(id, C.KIND.NPC, x, z, def.level || 1, def.hp || 100);
    this.npcId = npcId;
    // définition EFFECTIVE (zones.json, éventuellement retouchée ou créée par
    // les overrides de la zone) : rôle, étal, sorts enseignés, dialogues...
    this.def = def;
    this.name = def.name;
    this.dir = Math.PI;

    this.stats = def.stats || { str: 10, end: 10, agi: 10, int: 10, wis: 10 };
    this.equip = def.equip || {};
    this.skills = def.skills || {};
    this.spells = def.spells || [];

    this.recompute();
  }

  computeLook() {
    const layerOf = (slot) => {
      const defId = this.equip[slot];
      const itemDef = defId && ITEMS[defId];
      return itemDef ? (itemDef.layer || null) : null;
    };
    return {
      sex: this.def.sex || 'male',
      chest: layerOf('armor'),
      head: layerOf('helmet'),
      legs: layerOf('legs'),
      hands: layerOf('gloves'),
      main: layerOf('weapon'),
      off: layerOf('shield'),
      feet: layerOf('boots'),
    };
  }

  recompute(game) {
    const stats = { ...this.stats };
    let defense = 0;
    for (const slot of SLOTS) {
      const defId = this.equip[slot];
      if (!defId) continue;
      const d = ITEMS[defId];
      if (!d) continue;
      if (d.def) defense += d.def;
    }

    const baseEntity = {
      stats,
      skills: this.skills,
      maxHp: this.def.hp || 100,
      maxMana: this.def.maxMana || 100,
      defense: defense,
      effects: this.effects,
    };

    const modStats = computeModifiedStats(baseEntity);

    this.eff = {
      stats: modStats,
      maxHp: modStats.maxHp,
      maxMana: modStats.maxMana,
      defense: modStats.defense,
      speed: (this.def.speed || 4.0) * this.effects.getSpeedMultiplier(),
    };

    this.maxHp = this.eff.maxHp;
    this.maxMana = this.eff.maxMana;
    this.hp = Math.min(this.hp, this.eff.maxHp);
    
    // Fallback look (custom skin, e.g. for merchant) or dynamic look calculated from gear
    this.look = this.def.look || this.computeLook();
  }
}

export class Drop extends Entity {
  constructor(id, defId, gold, item, x, z, expiresAt) {
    super(id, C.KIND.DROP, x, z);
    this.defId = defId;
    this.gold = gold || 0;
    this.item = item || null;
    this.expiresAt = expiresAt;
  }
}
