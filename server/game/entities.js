import * as C from '../../shared/constants.js';
import { findPath, lineOfSight } from './pathfind.js';
import { ITEMS, SLOTS } from '../../shared/defs.js';
import { itemStats, itemLabel, itemPrice, itemWeight, inventoryWeight } from './items.js';
import { content } from '../content.js';
import * as db from '../db.js';

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

  stepAlong(speed, dt) {
    if (!this.path || !this.path.length) {
      if (this.state === C.ST.WALK) this.state = C.ST.IDLE;
      return;
    }
    let remaining = speed * dt;
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
    }
    if (this.path && !this.path.length) this.path = null;
    this.state = this.path ? C.ST.WALK : (this.state === C.ST.ATTACK ? C.ST.ATTACK : C.ST.IDLE);
    this.zi.gridMove(this);
  }
}

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
    this.hp -= dmg;
    this.lastCombat = game.now();
    game.eventNear(this, { t: 'dmg', from: attacker.id, to: this.id, amount: dmg, crit, mod });
    if (this.hp <= 0) {
      if (this.kind === C.KIND.MOB) game.killMob(this, attacker);
      else game.killPlayer(this, attacker);
    } else if (this.kind === C.KIND.PLAYER) {
      game.send(this, { t: 'vitals', hp: Math.round(this.hp), mana: Math.round(this.mana) });
    }
  }

  attack(defender, game) {
    const aStats = this.kind === C.KIND.PLAYER ? this.eff.stats
      : { str: 0, agi: 10 + this.level * 1.8, end: 0, int: 0, wis: 0 };
    const dStats = defender.kind === C.KIND.PLAYER ? defender.eff.stats
      : { str: 0, agi: 10 + defender.level * 1.8, end: 0, int: 0, wis: 0 };
    this.state = C.ST.ATTACK;
    this.dir = Math.atan2(defender.x - this.x, defender.z - this.z);
    this.lastCombat = game.now();
    defender.lastCombat = game.now();

    let hitC = C.hitChance(aStats, dStats);
    const usesBow = this.kind === C.KIND.PLAYER && this.eff.ranged;
    if (this.kind === C.KIND.PLAYER) {
      hitC = Math.min(0.98, hitC + (usesBow ? (this.skillFx?.rangedHit || 0) : (this.skillFx?.hit || 0)));
    }
    if (defender.kind === C.KIND.PLAYER) hitC = Math.max(0.15, hitC - (defender.skillFx?.dodge || 0));
    if (Math.random() > hitC) {
      game.eventNear(defender, { t: 'dmg', from: this.id, to: defender.id, miss: true });
      return;
    }
    if (defender.kind === C.KIND.PLAYER && Math.random() < (defender.skillFx?.parry || 0)) {
      game.eventNear(defender, { t: 'dmg', from: this.id, to: defender.id, parry: true });
      return;
    }
    if (usesBow) game.eventNear(defender, { t: 'proj', from: this.id, to: defender.id, color: '#d8c8a0' });
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
    if (this.kind === C.KIND.PLAYER) defense *= 1 - (this.skillFx?.piece || 0);
    dmg = C.mitigate(dmg, defense);
    if (this.kind === C.KIND.PLAYER && defender.kind === C.KIND.MOB
        && Math.random() < (this.skillFx?.stun || 0)) {
      defender.stunnedUntil = game.now() + 0.8;
      defender.path = null;
    }
    defender.applyDamage(this, dmg, crit, null, game);
  }
}

export class Player extends Character {
  constructor(id, ws, accountId, isAdmin, data, hpAcc, manaAcc) {
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
    this.bank = data.bank ?? [];
    this.spells = data.spells || [];
    this.skills = (data.skills && !Array.isArray(data.skills)) ? data.skills : {};
    this.unlocked = data.unlocked || [0];
    
    this.moveDir = null;
    this.attackTarget = null;
    this.spellCds = {};
    this.buffs = [];
    this.mana = 1;
    this.known = new Set();
    this.events = [];
    this.lastChat = 0;
    this.channels = ['general', 'aide', 'ventes', 'roleplay'];
    this.pendingPickup = null;
    this.pendingInteract = null;
    this.trialOffer = null;
    this.obeliskUntil = 0;
    this.hpAcc = hpAcc;
    this.manaAcc = manaAcc;
  }

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
        const wDef = ITEMS[item.defId];
        wRanged = !!wDef.ranged; wRange = wDef.range || 0;
      }
      defense += s.def;
      dodgeMalus += s.malus || 0;
      attBonus += ITEMS[item.defId].att || 0;
      for (const [st, v] of Object.entries(s.bonus)) stats[st] = (stats[st] || 0) + v;
    }

    const fx = { dmgMul: 0, def: 0, hpMul: 0, speed: 0, hit: 0, rangedHit: 0, crit: 0, dodge: 0, parry: 0, stun: 0, pierce: 0, manaRegenMul: 0, hpRegenMul: 0, discount: 0, loot: 0, spellMul: 0 };
    for (const [id, pts] of Object.entries(this.skills)) {
      const sk = content.skillById[id];
      if (!sk || !pts) continue;
      for (const [k, v] of Object.entries(sk.effect)) fx[k] = (fx[k] || 0) + v * pts;
    }

    if (this.equip.shield) fx.parry *= 1.5;
    fx.hit += attBonus * 0.001;
    fx.dodge = Math.max(0, fx.dodge - dodgeMalus * 0.001);

    let buffDef = 0, buffSpeed = 0, buffDmgMul = 0, buffRegen = 0, buffMaxHp = 0;
    for (const b of this.buffs) {
      if (b.stat === 'def') buffDef += b.power;
      else if (b.stat === 'speed') buffSpeed += b.power;
      else if (b.stat === 'dmg') buffDmgMul += b.power;
      else if (b.stat === 'regen') buffRegen += b.power;
      else if (b.stat === 'maxhp') buffMaxHp += b.power;
      else if (b.stat === 'str') stats.str += b.power;
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
      dmg: Math.floor(((wMin || 2) + (wMax || 3)) / 2 + strBonus),
      atkCd: C.attackCooldown(stats, weaponSpeed),
      defense: defense + fx.def + buffDef,
      speed: Math.min(7.5, C.moveSpeed(stats) + fx.speed + buffSpeed),
      atkRange: wRanged ? Math.max(1.8, wRange || 8) : 1.8,
      ranged: wRanged,
      buffRegen,
      capacity: C.enc(stats),
    };
    this.hp = Math.min(this.hp, this.eff.maxHp);
    this.mana = Math.min(this.mana, this.eff.maxMana);

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

  addXp(amount, game) {
    this.xp += amount;
    let leveled = false;
    while (this.level < C.MAX_LEVEL && this.xp >= C.xpForLevel(this.level + 1)) {
      this.level++;
      this.statPoints += C.POINTS_PER_LEVEL;
      this.hpAcc += C.hpGainPerLevel(this.eff.stats);
      this.manaAcc += C.manaGainPerLevel(this.eff.stats);
      leveled = true;
    }
    if (leveled) {
      this.recompute(game);
      this.hp = this.eff.maxHp;
      this.mana = this.eff.maxMana;
      game.eventNear(this, { t: 'fx', kind: 'levelup', id: this.id });
      game.broadcastChat('sys', `${this.name} passe niveau ${this.level} !`);
    }
    game.sendSelf(this);
  }

  save() {
    if (this.permadead) return;
    db.saveCharacter(this.accountId, {
      name: this.name, level: this.level, xp: this.xp, statPoints: this.statPoints,
      stats: this.stats, hp: this.hp, mana: this.mana, x: this.x, z: this.z,
      gold: this.gold, inventory: this.inventory, equip: this.equip,
      bank: this.bank,
      hpAcc: this.hpAcc, manaAcc: this.manaAcc,
      spells: this.spells, skills: this.skills, unlocked: this.unlocked,
      sex: this.sex,
      zoneId: this.zi.zoneId,
      trialFor: this.zi.isTrial ? this.zi.trialTarget : null,
    });
  }

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
    this.bank = data.bank || [];
    this.spells = []; this.skills = {}; this.unlocked = [0];
    this.buffs = []; this.spellCds = {};
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

    // déplacement direct (flèches / clic maintenu)
    if (this.moveDir) {
      const sp = this.eff.speed * dt;
      const nx = this.x + this.moveDir.x * sp, nz = this.z + this.moveDir.z * sp;
      if (this.zi.world.isWalkable(nx, nz)) { this.x = nx; this.z = nz; }
      else if (this.zi.world.isWalkable(nx, this.z)) { this.x = nx; }
      else if (this.zi.world.isWalkable(this.x, nz)) { this.z = nz; }
      this.dir = Math.atan2(this.moveDir.x, this.moveDir.z);
      this.state = C.ST.WALK;
      this.zi.gridMove(this);
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
    if (!this.moveDir) this.stepAlong(this.eff.speed, dt);

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

  static buildCharacter(spawnPoint, name, stats, sex) {
    if (!C.validateCreationStats(stats)) return null;
    const clean = {};
    for (const st of C.STATS) clean[st] = stats[st] | 0;
    return db.newCharacterData(name, spawnPoint, clean, sex);
  }
}

export class Mob extends Character {
  constructor(id, defId, def, sc, x, z, now, noRespawn = false) {
    super(id, C.KIND.MOB, x, z, sc.level, sc.hp);
    this.defId = defId;
    this.def = def;
    this.sc = sc;
    this.home = { x, z };
    this.target = null;
    this.wanderAt = now + 2 + Math.random() * 6;
    this.respawnAt = 0;
    this.hideAt = 0;
    this.noRespawn = noRespawn;
  }

  tick(game, zi, now, dt) {
    if (this.dead) {
      if (!this.hidden && now >= this.hideAt) this.hidden = true;
      if (now >= this.respawnAt) {
        this.dead = false; this.hidden = false; this.hp = this.maxHp; this.state = C.ST.IDLE;
        this.x = this.home.x; this.z = this.home.z; this.target = null; this.path = null;
        zi.gridMove(this);
      }
      return;
    }
    this.atkCd = Math.max(0, this.atkCd - dt);
    if (this.stunnedUntil && now < this.stunnedUntil) return; // assommé (Coup assommant)

    if (!this.target && (game.tickCount + this.id) % 5 === 0) {
      let best = null, bestD = this.def.aggro;
      for (const e of zi.nearby(this.x, this.z, this.def.aggro)) {
        if (e.kind !== C.KIND.PLAYER || e.dead) continue;
        const d = Math.hypot(e.x - this.x, e.z - this.z);
        if (d < bestD) { bestD = d; best = e; }
      }
      if (best) this.target = best.id;
    }

    if (this.target) {
      const tgt = zi.entities.get(this.target);
      const leashed = Math.hypot(this.x - this.home.x, this.z - this.home.z) > this.def.leash;
      if (!tgt || tgt.dead || leashed || Math.hypot(tgt.x - this.x, tgt.z - this.z) > this.def.leash) {
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

    this.stepAlong(this.def.speed, dt);
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