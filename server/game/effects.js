/**
 * Système d'Effets Unifié pour T4C Web
 * Implémentation basée sur les spécifications de docs/gameplay.md (Section 6)
 * 
 * Ce module gère l'application, la temporalité (ticks), la dissipation (dispel) 
 * et l'influence des effets actifs sur les statistiques des entités (MOB, NPC, Player).
 */

export const EFFECT_TYPES = {
  DAMAGE: 'damage',
  HEAL: 'heal',
  DRAIN: 'drain',
  STATS_BOOST: 'stats_boost',
  HP_BOOST: 'hp_boost',
  MP_BOOST: 'mp_boost',
  HP_REGEN_BOOST: 'hp_regen_boost',
  MP_REGEN_BOOST: 'mp_regen_boost',
  TELEPORT: 'teleport',
  STUN: 'stun',
  SLOW: 'slow',
  HIDE: 'hide',
  SKILL_BOOST: 'skill_boost',
};

export const EFFECT_CATEGORIES = {
  MAGIQUE: 'magique',
  PHYSIQUE: 'physique',
  SYSTEME: 'systeme',
};

export const CANCEL_TRIGGERS = {
  ON_DEATH: 'on_death',
  ON_DAMAGE_RECEIVED: 'on_damage_received',
  ON_ACTION_PERFORMED: 'on_action_performed',
  ON_COMBAT_ENTERED: 'on_combat_entered',
  ON_MOVE: 'on_move',
};

/**
 * Classe représentant une instance d'effet actif sur une entité.
 */
export class ActiveEffect {
  constructor(effectDef, source, now) {
    this.uid = Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
    this.type = effectDef.type;
    this.target_parameter = effectDef.target_parameter || null; // ex: 'str', 'fire_resist', etc.
    this.power = effectDef.power || effectDef.magnitude || 0;
    this.source = {
      type: source.type, // 'spell', 'item', 'skill', 'potion'
      id: source.id,     // ex: 'dard_de_feu', 'potion_vie'
      iid: source.iid || null // iid optionnel pour cibler des instances d'objets uniques en inventaire
    };
    this.duration = effectDef.duration !== undefined ? effectDef.duration : 0;
    this.ends_at = this.duration === Infinity ? Infinity : now + this.duration;
    this.interval = effectDef.interval || 0;
    this.last_tick_at = this.interval > 0 ? now : null;
    this.category = effectDef.category || EFFECT_CATEGORIES.PHYSIQUE;
    this.cancel_triggers = effectDef.cancel_triggers || [CANCEL_TRIGGERS.ON_DEATH];
  }

  /**
   * Détermine si l'effet est arrivé à expiration.
   */
  isExpired(now) {
    return this.ends_at !== Infinity && now >= this.ends_at;
  }

  /**
   * Détermine si l'effet doit être annulé par un déclencheur particulier.
   */
  shouldCancel(trigger) {
    return this.cancel_triggers && this.cancel_triggers.includes(trigger);
  }
}

/**
 * Classe gérant la collection d'effets actifs d'une entité.
 */
export class EntityEffects {
  constructor(entity) {
    this.entity = entity;
    this.active = []; // Contient la liste des instances ActiveEffect
  }

  /**
   * Ajoute ou rafraîchit un effet. Gère les règles de cumul de même source.
   */
  apply(effectDef, source, now) {
    const newEffect = new ActiveEffect(effectDef, source, now);

    // Règle de cumul : Même Source
    const existingIndex = this.active.findIndex(ae => 
      ae.source.type === newEffect.source.type && 
      ae.source.id === newEffect.source.id
    );

    if (existingIndex !== -1) {
      const existing = this.active[existingIndex];
      if (newEffect.power > existing.power) {
        existing.power = newEffect.power;
        existing.ends_at = newEffect.ends_at;
        existing.last_tick_at = newEffect.last_tick_at;
      } else {
        existing.ends_at = Math.max(existing.ends_at, newEffect.ends_at);
      }
      return existing;
    }

    this.active.push(newEffect);
    return newEffect;
  }

  /**
   * Met à jour les timers des effets (ticks d'intervalle) et nettoie ceux expirés.
   */
  tick(now, callbacks = {}) {
    if (this.active.length === 0) return;

    const remaining = [];
    const expired = [];

    for (const ae of this.active) {
      if (ae.isExpired(now)) {
        expired.push(ae);
        continue;
      }

      // Gestion périodique
      if (ae.interval > 0 && ae.last_tick_at !== null) {
        const delta = now - ae.last_tick_at;
        if (delta >= ae.interval) {
          const ticksToRun = Math.floor(delta / ae.interval);
          for (let i = 0; i < ticksToRun; i++) {
            if (callbacks.onPeriodicTick) {
              try {
                callbacks.onPeriodicTick(this.entity, ae);
              } catch (e) {
                console.error('Erreur lors du tick périodique de l\'effet:', e);
              }
            }
          }
          ae.last_tick_at = ae.last_tick_at + (ticksToRun * ae.interval);
        }
      }

      remaining.push(ae);
    }

    this.active = remaining;

    if (callbacks.onExpired) {
      for (const ae of expired) {
        try {
          callbacks.onExpired(this.entity, ae);
        } catch (e) {
          console.error('Erreur lors de l\'expiration de l\'effet:', e);
        }
      }
    }
  }

  /**
   * Déclenche les annulations d'effets basées sur les actions.
   */
  triggerCancel(trigger) {
    if (this.active.length === 0) return [];
    const removed = [];
    const remaining = [];
    for (const ae of this.active) {
      if (ae.shouldCancel(trigger)) removed.push(ae);
      else remaining.push(ae);
    }
    this.active = remaining;
    return removed;
  }

  /**
   * Dissipe tous les effets d'une catégorie.
   */
  dispelCategory(category) {
    if (this.active.length === 0) return [];
    const removed = [];
    const remaining = [];
    for (const ae of this.active) {
      if (ae.category === category) removed.push(ae);
      else remaining.push(ae);
    }
    this.active = remaining;
    return removed;
  }

  /**
   * Vérifie la présence d'un type d'effet (ex: stun, hide).
   */
  hasType(type) {
    return this.active.some(ae => ae.type === type);
  }

  /**
   * Calcule le multiplicateur de vitesse de déplacement appliqué par les ralentissements.
   */
  getSpeedMultiplier() {
    if (this.active.length === 0) return 1.0;
    let multiplier = 1.0;
    for (const ae of this.active) {
      if (ae.type === EFFECT_TYPES.SLOW) {
        multiplier *= Math.max(0, 1.0 - ae.power);
      }
    }
    return multiplier;
  }
}

/**
 * Classe représentant les statistiques finales calculées d'une entité (Player, MOB, NPC).
 */
export class EntityStats {
  constructor(entity) {
    const baseStats = entity?.stats || {};
    const basePower = entity?.power || {};
    const baseResist = entity?.resist || {};

    this.str = baseStats.str || 0;
    this.end = baseStats.end || 0;
    this.agi = baseStats.agi || 0;
    this.int = baseStats.int || 0;
    this.wis = baseStats.wis || 0;
    this.maxHp = entity?.maxHp || 100;
    this.maxMana = entity?.maxMana || 50;
    this.hp_regen = entity?.hp_regen || 0;
    this.mp_regen = entity?.mp_regen || 0;
    this.defense = entity?.defense || 0; // Classe d'Armure / CA
    
    // Puissances magiques élémentaires de base
    this.power_earth = basePower.earth || 0;
    this.power_water = basePower.water || 0;
    this.power_air = basePower.air || 0;
    this.power_fire = basePower.fire || 0;
    this.power_light = basePower.light || 0;
    this.power_dark = basePower.dark || 0;
    this.power_poison = basePower.poison || 0;
    
    // Résistances magiques élémentaires de base
    this.resist_earth = baseResist.earth || 0;
    this.resist_water = baseResist.water || 0;
    this.resist_air = baseResist.air || 0;
    this.resist_fire = baseResist.fire || 0;
    this.resist_light = baseResist.light || 0;
    this.resist_dark = baseResist.dark || 0;
    this.resist_poison = baseResist.poison || 0;
    
    // Chances de combat physiques de base (modifiées par compétences, buffs ou équipements)
    this.hit = entity?.hit || 0;               // Attaque (mêlée) - ex: +0.05 pour +5%
    this.ranged_hit = entity?.ranged_hit || 0; // Archerie (distance)
    this.dodge = entity?.dodge || 0;           // Esquive
    this.parry = entity?.parry || 0;           // Parade
    
    // Compétences copiées depuis l'entité (seules les compétences déjà connues peuvent être buffées)
    this.skills = {};
    if (entity?.skills) {
      for (const [skillId, pts] of Object.entries(entity.skills)) {
        this.skills[skillId] = pts || 0;
      }
    }
    
    // Capacité d'encombrement max
    this.encombrementMax = entity?.encombrementMax || 0;

    // Application ordonnée du pipeline de calcul
    const activeEffects = [
      ...(entity?.effects?.active || entity?.active_effects || []),
      ...(entity?.virtual_effects || [])
    ];
    this.calculatePipeline(activeEffects);
  }

  /**
   * Pipeline de calcul ordonné :
   * 1. Stats primaires, vitalité (HP/MP) et résistances/puissances élémentaires.
   * 2. Points de compétences (Skill Boosts).
   * 3. Passifs de compétences (basés sur le score de compétences final).
   * 4. Autres effets (Defense / CA, stuns, ralentissements) et Encombrement.
   */
  calculatePipeline(activeEffects) {
    // Étape 1 : Statistiques, Vitalité, Puissances et Résistances magiques
    for (const ae of activeEffects) {
      const power = ae.power;
      switch (ae.type) {
        case EFFECT_TYPES.STATS_BOOST:
          if (ae.target_parameter && ae.target_parameter in this) {
            this[ae.target_parameter] += power;
          }
          break;
        case EFFECT_TYPES.HP_BOOST:
          this.maxHp += power;
          break;
        case EFFECT_TYPES.MP_BOOST:
          this.maxMana += power;
          break;
        case EFFECT_TYPES.HP_REGEN_BOOST:
          this.hp_regen += power;
          break;
        case EFFECT_TYPES.MP_REGEN_BOOST:
          this.mp_regen += power;
          break;
        case 'power_boost': // Puissances élémentaires
          if (ae.target_parameter && `power_${ae.target_parameter}` in this) {
            this[`power_${ae.target_parameter}`] += power;
          }
          break;
        case 'resist_boost': // Résistances élémentaires
          if (ae.target_parameter && `resist_${ae.target_parameter}` in this) {
            this[`resist_${ae.target_parameter}`] += power;
          }
          break;
      }
    }

    // Plancher de sécurité : empêcher les statistiques de tomber sous 1 suite à des débuffs cumulés
    for (const stat of ['str', 'end', 'agi', 'int', 'wis']) {
      this[stat] = Math.max(1, this[stat]);
    }

    // Étape 2 : Points de compétences (Skill Boosts)
    for (const ae of activeEffects) {
      if (ae.type === EFFECT_TYPES.SKILL_BOOST) {
        if (ae.target_parameter && ae.target_parameter in this.skills) {
          this.skills[ae.target_parameter] = Math.max(0, this.skills[ae.target_parameter] + ae.power);
        }
      }
    }

    // Étape 3 : Application des effets passifs des compétences (Skills)
    if (this.skills) {
      for (const [skillId, pts] of Object.entries(this.skills)) {
        if (!pts) continue;
        const sk = content.skillById?.[skillId];
        if (sk && sk.effect) {
          for (const [k, v] of Object.entries(sk.effect)) {
            const targetKey = k === 'rangedHit' ? 'ranged_hit' : k;
            if (targetKey in this) {
              this[targetKey] += v * pts;
            }
          }
        }
      }
    }

    // Étape 4 : Autres effets (Defense / CA, stuns, ralentissements)
    for (const ae of activeEffects) {
      const power = ae.power;
      switch (ae.type) {
        case 'defense_boost': // Boost de classe d'armure / CA
          this.defense += power;
          break;
      }
    }

    // Sécurisation finale des jauges de vitalité max
    this.maxHp = Math.max(1, this.maxHp);
    this.maxMana = Math.max(0, this.maxMana);

    // Recalcul final de l'encombrement basé sur la force potentiellement modifiée
    this.recalculateEncombrement();
  }

  /**
   * Recalcule la capacité d'encombrement maximale à la volée basée sur la Force.
   * Formule issue des specs de gameplay : Math.floor((Force * 500) / (Force + 100))
   */
  recalculateEncombrement() {
    this.encombrementMax = Math.floor((this.str * 500) / (this.str + 100));
  }
}

/**
 * Calcule et applique l'ensemble des modificateurs d'effets actifs sur les caractéristiques 
 * de base d'une entité pour retourner un dictionnaire d'attributs finaux unifiés.
 *
 * @param {Object} entity - L'entité avec ses statistiques et puissances élémentaires de base
 * @returns {EntityStats} Une instance des statistiques finales calculées (modifiées par les buffs/debuffs)
 */
export function computeModifiedStats(entity) {
  return new EntityStats(entity);
}