// Entités du monde en classes (plan de la refonte POO de François, rejoué sur
// le code actuel) : Entity -> Character (combat) -> Player / Mob, plus NPC et
// Drop. Les responsabilités transverses (groupes, butin, zones, réseau) restent
// dans Game : les méthodes reçoivent `game` quand elles en ont besoin.
import * as C from '../../shared/constants.js';
import { ITEMS, SLOTS } from '../../shared/defs.js';
import { itemStats } from './items.js';
import { findPath, lineOfSight } from './pathfind.js';
import { content } from '../content.js';
import { applyResist } from './spells.js';
import * as db from '../db.js';

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
    if (moved && this.kind === C.KIND.PLAYER) game.heatZone(this.zi);
  }
}

// Tout ce qui se bat : joueurs et monstres
export class Character extends Entity {
  constructor(id, kind, x, z, level, hp) {
    super(id, kind, x, z);
    this.level = level;
    this.hp = hp;
    this.maxHp = hp;
    this.atkCd = 0;
    this.lastCombat = -99;
  }

  applyDamage(attacker, dmg, crit, mod, game) {
    const hpBefore = this.hp;
    this.hp -= dmg;
    this.lastCombat = game.now();
    game.eventNear(this, { t: 'dmg', from: attacker.id, to: this.id, amount: dmg, crit, mod });
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

  attack(defender, game) {
    // Sanctuaire : la cible est intouchable ; l'attaquant en transe ne frappe pas
    if (game.isUntouchable(defender)) return;
    if (this.kind === C.KIND.PLAYER && game.isPacified(this)) { this.attackTarget = null; return; }
    const aStats = this.kind === C.KIND.PLAYER ? this.eff.stats
      : { str: 0, agi: 10 + this.level * 1.8, end: 0, int: 0, wis: 0 };
    const dStats = defender.kind === C.KIND.PLAYER ? defender.eff.stats
      : { str: 0, agi: 10 + defender.level * 1.8, end: 0, int: 0, wis: 0 };
    this.state = C.ST.ATTACK;
    this.dir = Math.atan2(defender.x - this.x, defender.z - this.z);
    this.lastCombat = game.now();
    defender.lastCombat = game.now();

    let hitC = C.hitChance(aStats, dStats);
    // T4C : Attaque ne sert qu'en mêlée, Archerie qu'à l'arc — jamais les deux
    const usesBow = this.kind === C.KIND.PLAYER && this.eff.ranged;
    if (this.kind === C.KIND.PLAYER) {
      hitC = Math.min(0.98, hitC + (usesBow ? (this.skillFx?.rangedHit || 0) : (this.skillFx?.hit || 0)));
    }
    if (defender.kind === C.KIND.PLAYER) hitC = Math.max(0.15, hitC - (defender.skillFx?.dodge || 0));
    if (Math.random() > hitC) {
      game.eventNear(defender, { t: 'dmg', from: this.id, to: defender.id, miss: true });
      return;
    }
    // Parade T4C : annule totalement le coup (bouclier : +50 % d'efficacité)
    if (defender.kind === C.KIND.PLAYER && Math.random() < (defender.skillFx?.parry || 0)) {
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
    if (this.kind === C.KIND.PLAYER && Math.random() < C.critChance(aStats) + (this.skillFx?.crit || 0)) {
      dmg = Math.round(dmg * 1.6); crit = true;
    }
    let defense = defender.kind === C.KIND.PLAYER ? defender.eff.defense : defender.sc.def;
    // Transpercer l'armure : la CA adverse compte moins (0,25 %/pt)
    if (this.kind === C.KIND.PLAYER) defense *= 1 - (this.skillFx?.pierce || 0);
    dmg = C.mitigate(dmg, defense);
    // attaque élémentaire d'un monstre (ex. Fourmi de feu) : les résistances
    // du défenseur s'appliquent (Bouclier de mana, Résistance au feu/à la glace...)
    let elemMod = null;
    if (this.kind === C.KIND.MOB && this.def.element) {
      ({ dmg, mod: elemMod } = applyResist(defender, { element: this.def.element }, dmg));
    }
    // Coup assommant : chance d'immobiliser brièvement le monstre
    if (this.kind === C.KIND.PLAYER && defender.kind === C.KIND.MOB
        && Math.random() < (this.skillFx?.stun || 0)) {
      defender.stunnedUntil = game.now() + 0.8;
      defender.path = null;
    }
    defender.applyDamage(this, dmg, crit, elemMod, game);
    // Boucliers de Feu/Glace/Électrique (T4C) : riposte élémentaire à chaque
    // coup physique encaissé — 1dN + base, modulé par la résistance du monstre
    if (defender.kind === C.KIND.PLAYER && this.kind === C.KIND.MOB && !this.dead) {
      for (const b of defender.buffs) {
        if (b.stat !== 'retort') continue;
        const raw = (b.base || 0) + 1 + Math.floor(Math.random() * (b.dice || 1));
        const { dmg: rDmg, mod } = applyResist(this, { element: b.element }, raw);
        this.applyDamage(defender, rDmg, false, mod, game);
        if (this.dead) break;
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
    this.moveDir = null;
    this.attackTarget = null;
    this.spellCds = {};
    this.buffs = [];
    this.mana = 1;
    this.party = null;
    this.partyInvite = null;
    this.xpNotify = 0;
    this.known = new Set();
    this.events = [];
    this.lastChat = 0;
    this.channels = ['general', 'aide', 'ventes', 'roleplay']; // Abonnés par défaut
    this.pendingPickup = null;
    this.pendingInteract = null;
    this.trialOffer = null;
    this.obeliskUntil = 0;
    // PV/mana accumulés niveau par niveau (migration : approximation rétroactive)
    this.hpAcc = data.hpAcc ?? C.maxHp(this.stats, this.level);
    this.manaAcc = data.manaAcc ?? C.maxMana(this.stats, this.level);
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
    // compétences T4C : points entraînés x effet par point
    const fx = { dmgMul: 0, def: 0, hpMul: 0, speed: 0, hit: 0, rangedHit: 0, crit: 0, dodge: 0, parry: 0, stun: 0, pierce: 0, manaRegenMul: 0, hpRegenMul: 0, discount: 0, loot: 0, spellMul: 0 };
    for (const [id, pts] of Object.entries(this.skills)) {
      const sk = content.skillById[id];
      if (!sk || !pts) continue;
      for (const [k, v] of Object.entries(sk.effect)) fx[k] = (fx[k] || 0) + v * pts;
    }
    // un bouclier équipé améliore la parade de moitié (T4C)
    if (this.equip.shield) fx.parry *= 1.5;
    // bonus d'Attaque d'objets (+50 Att = +5 % de toucher en mêlée, comme la compétence)
    fx.hit += attBonus * 0.001;
    // le malus d'esquive de l'armure ronge la compétence Esquive (T4C)
    fx.dodge = Math.max(0, fx.dodge - dodgeMalus * 0.001);
    // buffs temporaires (valeurs calculées au lancement, façon T4C)
    let buffDef = 0, buffSpeed = 0, buffDmgMul = 0, buffRegen = 0, buffMaxHp = 0;
    for (const b of this.buffs) {
      if (b.stat === 'def') buffDef += b.power;
      else if (b.stat === 'speed') buffSpeed += b.power;
      else if (b.stat === 'dmg') buffDmgMul += b.power;
      else if (b.stat === 'regen') buffRegen += b.power;
      else if (b.stat === 'maxhp') buffMaxHp += b.power;       // Bénédiction
      else if (b.stat === 'str') stats.str += b.power;          // Force de la Terre
      else if (b.stat === 'int') stats.int += b.power;          // Pensée Claire
      else if (b.stat === 'wis') stats.wis += b.power;          // Tranquillité
      else if (b.stat === 'agi') stats.agi += b.power;          // Dextérité (Nimbleness)
      // 'spellpow' (Poussée de Mana) est lu au lancer d'un sort,
      // 'retort' (Boucliers de Feu/Glace/Électrique) à la riposte — rien ici.
    }
    this.skillFx = fx;
    const strBonus = Math.floor(stats.str / 3);
    const dmgMult = 1 + fx.dmgMul + buffDmgMul;
    this.eff = {
      stats,
      maxHp: Math.floor((this.hpAcc ?? C.maxHp(stats, this.level)) * (1 + fx.hpMul)) + buffMaxHp,
      maxMana: Math.floor(this.manaAcc ?? C.maxMana(stats, this.level)),
      dmgMin: ((wMin || 2) + strBonus),
      dmgMax: ((wMax || 3) + strBonus),
      dmgMult,
      dmg: Math.floor(((wMin || 2) + (wMax || 3)) / 2 + strBonus), // affichage
      atkCd: C.attackCooldown(stats, weaponSpeed),
      defense: defense + fx.def + buffDef,
      speed: Math.min(7.5, C.moveSpeed(stats) + fx.speed + buffSpeed),
      // arc équipé : portée de l'arme (tuiles), sinon mêlée
      atkRange: wRanged ? Math.max(1.8, wRange || 8) : 1.8,
      ranged: wRanged,
      buffRegen,
      capacity: C.enc(stats),
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
    this.buffs = []; this.spellCds = {}; this.casting = null;
    this.curseUntil = 0; this.sanctuaryUntil = 0; this.pacifiedUntil = 0;
    this.recompute(game);
    this.hp = this.eff.maxHp; this.mana = this.eff.maxMana;
    game.movePlayerToZone(this, zi0, zi0.world.spawnPoint.x, zi0.world.spawnPoint.z);
    game.broadcastChat('sys', `${this.name} renaît sur ${game.zoneDef(0).name}.`);
  }

  tick(game, now, dt) {
    if (this.dead) return;
    // expiration des buffs
    const nb = this.buffs.filter(b => b.until > now);
    if (nb.length !== this.buffs.length) { this.buffs = nb; this.recompute(game); game.sendSelf(this); }

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
      if (this.x !== ox || this.z !== oz) game.heatZone(this.zi); // mouvement réel
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
  }

  tick(game, now, dt) {
    const zi = this.zi;
    if (this.dead) {
      // le cadavre reste visible le temps du râle, puis l'entité disparaît :
      // plus de réapparition par timer (le spawn par mouvement prend le relais)
      if (now >= this.hideAt) zi.remove(this);
      return;
    }
    this.atkCd = Math.max(0, this.atkCd - dt);
    // poisons en cours (Poison, Flèche Empoisonnée) : dégâts sur la durée
    if (this.dots && this.dots.length) {
      for (const d of this.dots) {
        if (now >= d.nextAt && now <= d.until) {
          d.nextAt += d.interval;
          const dmg = Math.max(1, Math.round(d.min + Math.random() * (d.max - d.min)));
          this.applyDamage(d.from, dmg, false, null, game);
          if (this.dead) return;
        }
      }
      this.dots = this.dots.filter(d => now < d.until);
    }
    if (this.stunnedUntil && now < this.stunnedUntil) return; // assommé (Coup assommant)

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

export class NPC extends Entity {
  constructor(id, npcId, def, x, z) {
    super(id, C.KIND.NPC, x, z);
    this.npcId = npcId;
    this.name = def.name;
    this.look = def.look;
    this.dir = Math.PI;
    this.level = 0;
    this.hp = 1;
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
