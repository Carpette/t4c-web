// Boucle de jeu autoritative multi-zones : îles, Épreuves solo, PNJ, sorts, permadeath.
import * as C from '../../shared/constants.js';
import { ITEMS, MOBS, SLOTS, CHESTS, chestPool } from '../../shared/defs.js';
import { generateWorld, generateTrial, SPAWN_ZONES, mulberry32 } from '../../shared/worldgen.js';
import { encodeSnapshot } from '../../shared/protocol.js';
import { makeItem, rollDrops, itemStats, itemLabel, itemPrice, itemWeight, inventoryWeight, setNextIid, zoneMult } from './items.js';
import { findPath, lineOfSight } from './pathfind.js';
import { content } from '../content.js';
import { applyOverrides } from '../../shared/overrides.js';
import { loadOverrides } from '../admin.js';
import * as db from '../db.js';

const CELL = 16;

// ---------- Une zone = un monde isolé (île ou instance d'Épreuve) ----------
class ZoneInstance {
  constructor(key, world, zoneId, isTrial = false, owner = null) {
    this.key = key;
    this.world = world;
    this.zoneId = zoneId;       // index de la zone (pour le scaling des mobs)
    this.isTrial = isTrial;
    this.owner = owner;          // accountId si instance personnelle
    this.entities = new Map();
    this.grid = new Map();
    this.players = 0;
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

export class Game {
  constructor() {
    this.zones = new Map();      // key -> ZoneInstance
    this.players = new Map();    // id -> joueur
    this.nextId = 1;
    this.worldTime = C.DAY_LENGTH * 0.3;
    this.tickCount = 0;

    for (const z of content.zones) {
      const world = applyOverrides(generateWorld(z.seed), loadOverrides(z.id));
      const zi = new ZoneInstance(`zone:${z.id}`, world, z.id);
      this.zones.set(zi.key, zi);
      this.populateIsland(zi);
    }
    setInterval(() => this.tick(), 1000 / C.TICK_RATE);
    setInterval(() => this.saveAll(), 60_000);
  }

  zoneDef(id) { return content.zones[id]; }
  island(id) { return this.zones.get(`zone:${id}`); }
  now() { return this.tickCount / C.TICK_RATE; }

  // ---------- Peuplement ----------
  populateIsland(zi) {
    const rng = mulberry32((this.zoneDef(zi.zoneId).seed ^ 0xbeef) >>> 0);
    const base = this.zoneDef(zi.zoneId).levels[0] - 1;
    for (const zone of SPAWN_ZONES) {
      for (let i = 0; i < zone.count; i++) {
        let x, z, tries = 0;
        do {
          const a = rng() * Math.PI * 2, d = rng() * zone.radius;
          x = zone.center[0] + Math.cos(a) * d + 0.5;
          z = zone.center[1] + Math.sin(a) * d + 0.5;
        } while (!zi.world.isWalkable(x, z) && ++tries < 40);
        if (tries >= 40) continue;
        this.spawnMob(zi, zone.mob, x, z, base);
      }
    }
    this.spawnNpc(zi);
  }

  spawnMob(zi, defId, x, z, zoneBase, noRespawn = false) {
    const def = MOBS[defId];
    const sc = C.scaleMob(def, zoneBase);
    const m = {
      id: this.nextId++, kind: C.KIND.MOB, defId, def, sc,
      level: sc.level,
      x, z, dir: 0, state: C.ST.IDLE,
      hp: sc.hp, maxHp: sc.hp,
      home: { x, z }, target: null, atkCd: 0, path: null,
      wanderAt: this.now() + 2 + Math.random() * 6,
      dead: false, hidden: false, respawnAt: 0, hideAt: 0, noRespawn,
    };
    zi.add(m);
    return m;
  }

  spawnNpc(zi) {
    const v = zi.world.village;
    let x = v.x - 4.5, z = v.z - 3.5, tries = 0;
    while (!zi.world.isWalkable(x, z) && tries++ < 30) { x += 0.7; }
    const npc = {
      id: this.nextId++, kind: C.KIND.NPC, npcId: 'merchant',
      name: content.npc.merchant.name,
      look: content.npc.merchant.look,
      x, z, dir: Math.PI, state: C.ST.IDLE, level: 0,
      hp: 1, dead: false, hidden: false,
    };
    zi.add(npc);
    return npc;
  }

  // ---------- Joueurs ----------
  addPlayer(ws, accountId, name, isAdmin) {
    if (this.shuttingDown) return { error: 'Le serveur est en cours d\'arrêt, réessayez dans un instant.' };
    if (this.players.size >= C.MAX_PLAYERS) return { error: 'Serveur plein (256 joueurs max)' };
    for (const p of this.players.values()) {
      if (p.accountId === accountId) this.removePlayer(p, 'Connecté ailleurs');
    }
    let data = db.loadCharacter(accountId);
    if (!data) {
      data = db.newCharacterData(name, this.island(0).world.spawnPoint);
      db.saveCharacter(accountId, data);
    }
    const p = {
      id: this.nextId++, kind: C.KIND.PLAYER, ws, accountId, isAdmin: !!isAdmin,
      name: data.name, sex: data.sex || 'male',
      level: data.level, xp: data.xp, statPoints: data.statPoints,
      stats: data.stats, gold: data.gold,
      inventory: data.inventory || [], equip: data.equip || {},
      spells: data.spells || [], skills: data.skills || [],
      unlocked: data.unlocked || [0],
      x: data.x, z: data.z, dir: 0, state: C.ST.IDLE,
      path: null, moveDir: null, attackTarget: null, atkCd: 0, lastCombat: -99,
      spellCds: {}, buffs: [],
      hp: 1, mana: 1, dead: false, hidden: false,
      known: new Set(), events: [], lastChat: 0,
      pendingPickup: null, pendingInteract: null, trialOffer: null, obeliskUntil: 0,
    };
    for (const it of p.inventory) setNextIid(it.iid + 1);
    // PV/mana accumulés niveau par niveau (migration : approximation rétroactive)
    p.hpAcc = data.hpAcc ?? C.maxHp(p.stats, p.level);
    p.manaAcc = data.manaAcc ?? C.maxMana(p.stats, p.level);

    // zone de départ : Épreuve en cours (recréée) ou île courante
    let zi;
    if (data.trialFor != null && data.trialFor < content.zones.length) {
      zi = this.createTrial(p, data.trialFor);
      p.x = zi.world.spawnPoint.x; p.z = zi.world.spawnPoint.z;
    } else {
      const zid = Math.min(data.zoneId || 0, content.zones.length - 1);
      zi = this.island(zid);
      if (!zi.world.isWalkable(p.x, p.z)) { p.x = zi.world.spawnPoint.x; p.z = zi.world.spawnPoint.z; }
    }
    this.recompute(p);
    p.hp = data.hp == null ? p.eff.maxHp : Math.min(data.hp, p.eff.maxHp);
    p.mana = data.mana == null ? p.eff.maxMana : Math.min(data.mana, p.eff.maxMana);
    if (p.hp <= 0) p.hp = p.eff.maxHp;
    // plancher à la connexion : on ne réapparaît jamais agonisant
    p.hp = Math.max(p.hp, Math.round(p.eff.maxHp * 0.6));
    this.players.set(p.id, p);
    zi.add(p);
    zi.players++;
    this.send(p, { t: 'welcome', id: p.id, time: this.worldTime, admin: p.isAdmin });
    this.sendZone(p);
    this.sendSelf(p);
    this.broadcastChat('sys', `${p.name} entre dans le monde.`);
    return { player: p };
  }

  removePlayer(p, reason) {
    if (!this.players.has(p.id)) return;
    if (!p.permadead) this.savePlayer(p);
    p.zi.players--;
    p.zi.remove(p);
    this.maybeDestroyTrial(p.zi);
    this.players.delete(p.id);
    this.broadcastChat('sys', `${p.name} quitte le monde.`);
    try { p.ws.close(1000, reason || 'bye'); } catch {}
  }

  savePlayer(p) {
    if (p.permadead) return;
    db.saveCharacter(p.accountId, {
      name: p.name, level: p.level, xp: p.xp, statPoints: p.statPoints,
      stats: p.stats, hp: p.hp, mana: p.mana, x: p.x, z: p.z,
      gold: p.gold, inventory: p.inventory, equip: p.equip,
      hpAcc: p.hpAcc, manaAcc: p.manaAcc,
      spells: p.spells, skills: p.skills, unlocked: p.unlocked,
      sex: p.sex,
      zoneId: p.zi.zoneId, // pour une Épreuve, c'est la zone d'origine
      trialFor: p.zi.isTrial ? p.zi.trialTarget : null,
    });
  }
  saveAll() { for (const p of this.players.values()) this.savePlayer(p); }

  sendZone(p) {
    const zi = p.zi;
    const def = zi.isTrial ? this.zoneDef(zi.trialTarget) : this.zoneDef(zi.zoneId);
    this.send(p, {
      t: 'zone',
      kind: zi.isTrial ? 'trial' : 'island',
      zoneId: zi.isTrial ? zi.trialTarget : zi.zoneId,
      name: zi.isTrial ? `L'Épreuve — vers ${def.name}` : def.name,
      seed: def.seed,
      tint: zi.isTrial ? 'rgba(40, 20, 60, 0.18)' : def.tint,
      levels: def.levels,
      x: p.x, z: p.z,
      unlocked: p.unlocked,
    });
    p.known = new Set(); // les entités de l'ancienne zone seront purgées côté client
  }

  movePlayerToZone(p, zi, x, z) {
    p.zi.players--;
    p.zi.remove(p);
    const old = p.zi;
    p.x = x; p.z = z;
    p.path = null; p.moveDir = null; p.attackTarget = null; p.pendingPickup = null; p.pendingInteract = null;
    zi.add(p);
    zi.players++;
    this.maybeDestroyTrial(old);
    this.sendZone(p);
    this.sendSelf(p);
  }

  // ---------- Épreuve ----------
  createTrial(p, targetZoneId) {
    const key = `trial:${targetZoneId}:${p.accountId}`;
    this.zones.get(key) && this.zones.delete(key);
    const def = this.zoneDef(targetZoneId);
    const world = generateTrial(def.seed);
    const fromZone = targetZoneId - 1;
    const zi = new ZoneInstance(key, world, fromZone, true, p.accountId);
    zi.trialTarget = targetZoneId;
    this.zones.set(key, zi);
    // les monstres les plus puissants de la zone actuelle, sans réapparition
    const fromDef = this.zoneDef(fromZone);
    const base = fromDef.levels[0] - 1;
    const strongest = [...fromDef.mobs].sort((a, b) => MOBS[b].level - MOBS[a].level).slice(0, 3);
    const rng = mulberry32((def.seed ^ 0x5eed) >>> 0);
    for (const spot of world.mobSpots) {
      const defId = strongest[Math.floor(rng() * strongest.length)];
      const m = this.spawnMob(zi, defId, spot.x, spot.z, base, true);
      m.def = { ...m.def, aggro: 9, leash: 60 }; // agressifs, pas de retour au bercail
    }
    return zi;
  }

  maybeDestroyTrial(zi) {
    if (zi?.isTrial && zi.players <= 0) this.zones.delete(zi.key);
  }

  startTrial(p) {
    if (p.zi.isTrial) return;
    const target = p.zi.zoneId + 1;
    if (target >= content.zones.length) { this.send(p, { t: 'info', text: 'Il n\'y a plus rien au-delà... pour le moment.' }); return; }
    if (p.unlocked.includes(target)) { this.send(p, { t: 'info', text: 'Vous avez déjà conquis cette Épreuve. Utilisez l\'obélisque.' }); return; }
    const zi = this.createTrial(p, target);
    p.trialFrom = p.zi.zoneId;
    this.movePlayerToZone(p, zi, zi.world.spawnPoint.x, zi.world.spawnPoint.z);
    this.savePlayer(p);
    this.send(p, { t: 'info', text: 'L\'Épreuve commence. Atteignez la sortie... ou mourez.' });
  }

  finishTrial(p) {
    const zi = p.zi;
    if (!zi.isTrial) return;
    const target = zi.trialTarget;
    if (!p.unlocked.includes(target)) p.unlocked.push(target);
    const dest = this.island(target);
    this.broadcastChat('sys', `⚔ ${p.name} a triomphé de l'Épreuve et atteint ${this.zoneDef(target).name} !`);
    this.movePlayerToZone(p, dest, dest.world.spawnPoint.x, dest.world.spawnPoint.z);
    this.savePlayer(p);
  }

  // ---------- Stats effectives ----------
  recompute(p) {
    const stats = { ...p.stats };
    let wMin = 0, wMax = 0, weaponSpeed = null, defense = 0;
    for (const slot of SLOTS) {
      const iid = p.equip[slot];
      if (!iid) continue;
      const item = p.inventory.find(i => i.iid === iid);
      if (!item) { delete p.equip[slot]; continue; }
      const s = itemStats(item);
      if (slot === 'weapon') { wMin = s.dmgMin; wMax = s.dmgMax; weaponSpeed = s.speed; }
      defense += s.def;
      for (const [st, v] of Object.entries(s.bonus)) stats[st] = (stats[st] || 0) + v;
    }
    // compétences passives
    const fx = { dmgMul: 0, def: 0, hpMul: 0, speed: 0, hit: 0, crit: 0, manaRegenMul: 0, hpRegenMul: 0, discount: 0, loot: 0, spellMul: 0 };
    for (const id of p.skills) {
      const sk = content.skillById[id];
      if (!sk) continue;
      for (const [k, v] of Object.entries(sk.effect)) fx[k] = (fx[k] || 0) + v;
    }
    // buffs temporaires (valeurs calculées au lancement, façon T4C)
    let buffDef = 0, buffSpeed = 0, buffDmgMul = 0, buffRegen = 0, buffMaxHp = 0;
    for (const b of p.buffs) {
      if (b.stat === 'def') buffDef += b.power;
      else if (b.stat === 'speed') buffSpeed += b.power;
      else if (b.stat === 'dmg') buffDmgMul += b.power;
      else if (b.stat === 'regen') buffRegen += b.power;
      else if (b.stat === 'maxhp') buffMaxHp += b.power;       // Bénédiction
      else if (b.stat === 'str') stats.str += b.power;          // Force de la Terre
    }
    p.skillFx = fx;
    const strBonus = Math.floor(stats.str / 3);
    const dmgMult = 1 + fx.dmgMul + buffDmgMul;
    p.eff = {
      stats,
      maxHp: Math.floor((p.hpAcc ?? C.maxHp(stats, p.level)) * (1 + fx.hpMul)) + buffMaxHp,
      maxMana: Math.floor(p.manaAcc ?? C.maxMana(stats, p.level)),
      dmgMin: ((wMin || 2) + strBonus),
      dmgMax: ((wMax || 3) + strBonus),
      dmgMult,
      dmg: Math.floor(((wMin || 2) + (wMax || 3)) / 2 + strBonus), // affichage
      atkCd: C.attackCooldown(stats, weaponSpeed),
      defense: defense + fx.def + buffDef,
      speed: Math.min(7.5, C.moveSpeed(stats) + fx.speed + buffSpeed),
      atkRange: 1.8,
      buffRegen,
      capacity: C.enc(stats),
    };
    p.hp = Math.min(p.hp, p.eff.maxHp);
    p.mana = Math.min(p.mana, p.eff.maxMana);

    // apparence (couches Flare)
    const layerOf = (slot) => {
      const iid = p.equip[slot];
      const item = iid && p.inventory.find(i => i.iid === iid);
      return item ? (ITEMS[item.defId].layer || null) : null;
    };
    const look = {
      sex: p.sex,
      chest: layerOf('armor'), head: layerOf('helmet'),
      main: layerOf('weapon'), off: layerOf('shield'), feet: layerOf('boots'),
    };
    const changed = JSON.stringify(look) !== JSON.stringify(p.look || null);
    p.look = look;
    if (changed && this.players.has(p.id)) {
      this.eventNear(p, { t: 'look', id: p.id, look });
    }
  }

  sendSelf(p) {
    this.send(p, {
      t: 'self',
      level: p.level, xp: p.xp,
      xpCur: C.xpForLevel(p.level), xpNext: C.xpForLevel(p.level + 1),
      statPoints: p.statPoints, stats: p.stats, eff: p.eff.stats,
      hp: Math.round(p.hp), maxHp: p.eff.maxHp,
      mana: Math.round(p.mana), maxMana: p.eff.maxMana,
      enc: C.enc(p.stats),
      dmg: p.eff.dmg, dmgMin: p.eff.dmgMin, dmgMax: p.eff.dmgMax, defense: p.eff.defense, gold: p.gold,
      weight: inventoryWeight(p.inventory), capacity: p.eff.capacity,
      look: p.look,
      inventory: p.inventory.map(it => ({
        ...it, label: itemLabel(it), slot: ITEMS[it.defId].slot, price: itemPrice(it),
        weight: itemWeight(it), req: ITEMS[it.defId].req || null,
      })),
      equip: p.equip,
      spells: p.spells, skills: p.skills,
      buffs: p.buffs.map(b => ({ stat: b.stat, power: b.power, left: Math.max(0, Math.round(b.until - this.now())) })),
      zoneId: p.zi.isTrial ? p.zi.trialTarget : p.zi.zoneId,
      inTrial: !!p.zi.isTrial,
      unlocked: p.unlocked,
    });
  }

  send(p, obj) { if (p.ws.readyState === 1) p.ws.send(JSON.stringify(obj)); }
  broadcastChat(from, text) {
    const msg = JSON.stringify({ t: 'chat', from, text });
    for (const p of this.players.values()) if (p.ws.readyState === 1) p.ws.send(msg);
  }
  eventNear(ref, obj) {
    for (const e of ref.zi.nearby(ref.x, ref.z, C.AOI_RADIUS)) {
      if (e.kind === C.KIND.PLAYER) e.events.push(obj);
    }
  }

  // ---------- Messages clients ----------
  onMessage(p, msg) {
    if (p.permadead && msg.t !== 'newchar' && msg.t !== 'create') return;
    switch (msg.t) {
      case 'move': {
        if (p.dead) return;
        const x = +msg.x, z = +msg.z;
        if (!Number.isFinite(x) || !Number.isFinite(z)) return;
        p.attackTarget = null; p.moveDir = null; p.pendingInteract = null;
        p.path = findPath(p.zi.world, p.x, p.z, x, z);
        break;
      }
      case 'movedir': {
        if (p.dead) return;
        const x = +msg.x, z = +msg.z;
        if (!Number.isFinite(x) || !Number.isFinite(z)) return;
        const len = Math.hypot(x, z);
        if (len < 0.01) { p.moveDir = null; if (p.state === C.ST.WALK) p.state = C.ST.IDLE; return; }
        p.moveDir = { x: x / len, z: z / len };
        p.path = null; p.attackTarget = null; p.pendingPickup = null; p.pendingInteract = null;
        break;
      }
      case 'attack': {
        if (p.dead) return;
        const target = p.zi.entities.get(msg.id | 0);
        if (target && target.kind === C.KIND.MOB && !target.dead) {
          p.attackTarget = target.id;
          p.path = null; p.moveDir = null;
        }
        break;
      }
      case 'cast': {
        if (p.dead) return;
        this.castSpell(p, msg);
        break;
      }
      case 'pickup': {
        if (p.dead) return;
        const d = p.zi.entities.get(msg.id | 0);
        if (!d || d.kind !== C.KIND.DROP || d.hidden) return;
        if (Math.hypot(d.x - p.x, d.z - p.z) > C.PICKUP_RANGE) {
          p.path = findPath(p.zi.world, p.x, p.z, d.x, d.z);
          p.moveDir = null;
          p.pendingPickup = d.id;
          return;
        }
        this.doPickup(p, d);
        break;
      }
      case 'interact': {
        if (p.dead) return;
        this.interact(p, msg);
        break;
      }
      case 'buy': {
        if (p.dead) return;
        this.buy(p, msg);
        break;
      }
      case 'sell': {
        if (p.dead) return;
        this.sell(p, msg);
        break;
      }
      case 'teleport': {
        if (p.dead || p.zi.isTrial) return;
        const zid = msg.zoneId | 0;
        if (!p.unlocked.includes(zid) || !this.island(zid)) return;
        if (this.now() > p.obeliskUntil) { this.send(p, { t: 'info', text: 'Approchez-vous de l\'obélisque.' }); return; }
        const dest = this.island(zid);
        this.movePlayerToZone(p, dest, dest.world.spawnPoint.x, dest.world.spawnPoint.z);
        break;
      }
      case 'trial_enter': {
        if (p.dead || p.zi.isTrial) return;
        if (!p.trialOffer || this.now() > p.trialOffer) { this.send(p, { t: 'info', text: 'Retournez au portail de l\'Épreuve.' }); return; }
        p.trialOffer = null;
        this.startTrial(p);
        break;
      }
      case 'equip': {
        const item = p.inventory.find(i => i.iid === (msg.iid | 0));
        if (!item) return;
        const def = ITEMS[item.defId];
        const slot = def.slot;
        if (!SLOTS.includes(slot)) return;
        // prérequis de stats T4C (For/Agi/Int/Sag) pour porter l'objet
        if (def.req) {
          const names = { str: 'Force', agi: 'Agilité', int: 'Intelligence', wis: 'Sagesse' };
          for (const [st, v] of Object.entries(def.req)) {
            if ((p.eff.stats[st] || 0) < v) {
              this.send(p, { t: 'info', text: `${def.name} : ${v} de ${names[st] || st} requis (vous : ${p.eff.stats[st] || 0}).` });
              return;
            }
          }
        }
        p.equip[slot] = item.iid;
        this.recompute(p); this.sendSelf(p);
        break;
      }
      case 'unequip': {
        if (p.equip[msg.slot]) { delete p.equip[msg.slot]; this.recompute(p); this.sendSelf(p); }
        break;
      }
      case 'use': {
        if (p.dead) return;
        const i = p.inventory.findIndex(it => it.iid === (msg.iid | 0));
        if (i < 0) return;
        const st = itemStats(p.inventory[i]);
        if (ITEMS[p.inventory[i].defId].slot !== 'use') return;
        if (st.heal) p.hp = Math.min(p.eff.maxHp, p.hp + st.heal);
        if (st.mana) p.mana = Math.min(p.eff.maxMana, p.mana + st.mana);
        p.inventory.splice(i, 1);
        this.eventNear(p, { t: 'fx', kind: 'heal', id: p.id });
        this.sendSelf(p);
        break;
      }
      case 'alloc': {
        if (p.statPoints > 0 && C.STATS.includes(msg.stat)) {
          p.stats[msg.stat]++;
          p.statPoints--;
          this.recompute(p); this.sendSelf(p);
        }
        break;
      }
      case 'chat': {
        const now = Date.now();
        if (now - p.lastChat < 800) return;
        p.lastChat = now;
        const text = String(msg.text || '').slice(0, C.CHAT_MAX).trim();
        if (!text) return;
        this.broadcastChat(p.name, text);
        this.eventNear(p, { t: 'say', id: p.id, text }); // bulle au-dessus de la tête
        break;
      }
      case 'newchar': {
        if (!p.permadead) return;
        this.send(p, { t: 'create_char', ...this.creationInfo() });
        break;
      }
      case 'create': {
        if (!p.permadead) return;
        if (!C.validateCreationStats(msg.stats)) { this.send(p, { t: 'info', text: 'Répartition invalide.' }); return; }
        this.reincarnate(p, msg.stats, msg.sex === 'female' ? 'female' : 'male');
        break;
      }
      case 'admin': {
        if (!p.isAdmin) return;
        this.adminCommand(p, msg);
        break;
      }
    }
  }

  // ---------- Commandes d'administration (en jeu) ----------
  adminCommand(p, msg) {
    switch (msg.cmd) {
      case 'set': {
        if (Number.isFinite(+msg.level)) {
          p.level = Math.max(1, Math.min(C.MAX_LEVEL, msg.level | 0));
          p.xp = C.xpForLevel(p.level);
          // recalcule l'accumulation PV/mana (approximation avec les stats actuelles)
          p.hpAcc = C.maxHp(p.eff.stats, p.level);
          p.manaAcc = C.maxMana(p.eff.stats, p.level);
        }
        if (Number.isFinite(+msg.gold)) p.gold = Math.max(0, msg.gold | 0);
        if (Number.isFinite(+msg.statPoints)) p.statPoints = Math.max(0, msg.statPoints | 0);
        this.recompute(p);
        p.hp = p.eff.maxHp; p.mana = p.eff.maxMana;
        this.sendSelf(p);
        break;
      }
      case 'stats': {
        for (const st of C.STATS) {
          if (Number.isFinite(+msg[st])) p.stats[st] = Math.max(1, msg[st] | 0);
        }
        this.recompute(p);
        p.hp = p.eff.maxHp; p.mana = p.eff.maxMana;
        this.sendSelf(p);
        break;
      }
      case 'goto': {
        const x = +msg.x, z = +msg.z;
        if (!Number.isFinite(x) || !Number.isFinite(z)) return;
        if (!p.zi.world.isWalkable(x, z)) return;
        p.x = x; p.z = z;
        p.path = null; p.moveDir = null;
        p.zi.gridMove(p);
        break;
      }
      case 'zone': {
        const zid = msg.zoneId | 0;
        const dest = this.island(zid);
        if (!dest) return;
        if (!p.unlocked.includes(zid)) p.unlocked.push(zid);
        this.movePlayerToZone(p, dest, dest.world.spawnPoint.x, dest.world.spawnPoint.z);
        break;
      }
    }
  }

  // ---------- Interactions (PNJ, obélisque, portails) ----------
  interact(p, msg) {
    const goTo = (x, z, what) => {
      p.path = findPath(p.zi.world, p.x, p.z, x, z);
      p.moveDir = null;
      p.pendingInteract = { ...what, x, z };
    };
    if (msg.id != null) {
      const npc = p.zi.entities.get(msg.id | 0);
      if (!npc || npc.kind !== C.KIND.NPC) return;
      if (Math.hypot(npc.x - p.x, npc.z - p.z) > C.INTERACT_RANGE) { goTo(npc.x, npc.z, { id: npc.id }); return; }
      this.openShop(p, npc);
      return;
    }
    // interaction avec un élément du décor : le client envoie sa position
    const prop = (p.zi.world.props || []).find(pr =>
      pr.type === msg.prop && Math.hypot(pr.x - (+msg.x), pr.z - (+msg.z)) < 1.5);
    if (!prop) return;
    if (Math.hypot(prop.x - p.x, prop.z - p.z) > C.INTERACT_RANGE) { goTo(prop.x, prop.z, { prop: msg.prop, px: prop.x, pz: prop.z }); return; }
    this.interactProp(p, prop);
  }

  interactProp(p, prop) {
    if (prop.type === 'obelisk') {
      p.obeliskUntil = this.now() + 30;
      this.send(p, {
        t: 'obelisk',
        zones: p.unlocked.map(id => ({ id, name: this.zoneDef(id).name, levels: this.zoneDef(id).levels }))
          .sort((a, b) => a.id - b.id),
        current: p.zi.zoneId,
      });
    } else if (prop.type === 'trialgate') {
      const target = p.zi.zoneId + 1;
      if (target >= content.zones.length) { this.send(p, { t: 'info', text: 'Il n\'y a plus rien au-delà... pour le moment.' }); return; }
      if (p.unlocked.includes(target)) { this.send(p, { t: 'info', text: 'Épreuve déjà conquise. L\'obélisque vous mènera à ' + this.zoneDef(target).name + '.' }); return; }
      p.trialOffer = this.now() + 30;
      this.send(p, {
        t: 'confirm_trial',
        zone: this.zoneDef(target).name,
        text: `Vous êtes sur le point d'entrer dans l'Épreuve menant à ${this.zoneDef(target).name}. ` +
          `Vous y serez SEUL face aux monstres les plus puissants de cette zone. ` +
          `Une fois entré, il n'existe que deux issues : atteindre la sortie... ou mourir. ` +
          `La mort y est DÉFINITIVE, comme partout. Personne ne pourra vous aider.`,
      });
    } else if (prop.type === 'exitgate' && p.zi.isTrial) {
      this.finishTrial(p);
    } else if (prop.type === 'chest') {
      this.openChest(p, prop);
    }
  }

  // Coffre au trésor : or généreux ou objet rare du palier, puis se referme un moment
  openChest(p, prop) {
    const zi = p.zi;
    if (!zi.chestState) zi.chestState = new Map();
    const key = `${Math.floor(prop.x)},${Math.floor(prop.z)}`;
    const readyAt = zi.chestState.get(key) || 0;
    const now = this.now();
    if (now < readyAt) {
      this.send(p, { t: 'info', text: 'Le coffre est vide. Quelqu\'un est passé avant vous...' });
      return;
    }
    zi.chestState.set(key, now + CHESTS.respawn);
    const zid = zi.zoneId;
    const pool = chestPool(zid);
    if (pool.length && Math.random() < CHESTS.itemChance) {
      const defId = pool[Math.floor(Math.random() * pool.length)];
      this.spawnDrop(zi, prop.x, prop.z, { item: makeItem(defId, Math.random, zid) });
      this.eventNear(p, { t: 'say', id: p.id, text: 'Un trésor !' });
    } else {
      const goldMul = Math.pow(zoneMult(zid), 2.6);
      const gold = Math.round((CHESTS.gold[0] + Math.random() * (CHESTS.gold[1] - CHESTS.gold[0])) * goldMul);
      this.spawnDrop(zi, prop.x, prop.z, { gold });
    }
    this.send(p, { t: 'loot', text: 'Vous ouvrez le coffre...' });
  }

  openShop(p, npc) {
    const zid = p.zi.zoneId;
    const disc = 1 - (p.skillFx?.discount || 0);
    const reqNames = { str: 'For', agi: 'Agi', int: 'Int', wis: 'Sag' };
    const items = Object.entries(ITEMS)
      .filter(([, d]) => d.zone != null && d.zone <= Math.min(zid, 3) && d.slot !== 'gold' && !d.legacy)
      .map(([defId, d]) => {
        const fixed = !!d.fixed;
        return {
          defId,
          name: d.name + (!fixed && zid > 0 ? ` +${zid}` : ''),
          slot: d.slot,
          price: Math.round(d.price * (fixed ? 1 : Math.pow(zoneMult(zid), 2.6)) * disc),
          dmgRange: d.dmgMin != null ? `${d.dmgMin}-${d.dmgMax}` : (d.dmg ? `${Math.round(d.dmg * zoneMult(zid))}` : null),
          def: d.def ? Math.round(d.def * (fixed ? 1 : zoneMult(zid))) : 0,
          heal: d.heal ? Math.round(d.heal * (fixed ? 1 : zoneMult(zid))) : 0,
          mana: d.mana ? Math.round(d.mana * (fixed ? 1 : zoneMult(zid))) : 0,
          weight: d.weight || 0,
          reqText: d.req ? Object.entries(d.req).map(([s, v]) => `${reqNames[s] || s} ${v}`).join(', ') : null,
        };
      });
    const spells = content.spells.filter(s => s.zone <= zid)
      .map(s => ({
        ...s,
        price: Math.round(s.price * disc),
        known: p.spells.includes(s.id),
        reqMet: this.spellReqMet(p, s) === true,
        reqText: this.spellReqText(s),
      }));
    const skills = content.skills.filter(s => s.zone <= zid)
      .map(s => ({ ...s, price: Math.round(s.price * disc), known: p.skills.includes(s.id) }));
    const line = content.npc.merchant.greetings[Math.floor(Math.random() * content.npc.merchant.greetings.length)];
    this.eventNear(p, { t: 'say', id: npc.id, text: line, npc: true });
    this.send(p, { t: 'shop', npcId: npc.id, name: npc.name, items, spells, skills });
  }

  buy(p, msg) {
    // vérifie qu'un marchand est proche
    let npc = null;
    for (const e of p.zi.nearby(p.x, p.z, C.INTERACT_RANGE + 1)) {
      if (e.kind === C.KIND.NPC) { npc = e; break; }
    }
    if (!npc) { this.send(p, { t: 'info', text: 'Aucun marchand à proximité.' }); return; }
    const zid = p.zi.zoneId;
    const disc = 1 - (p.skillFx?.discount || 0);

    if (msg.kind === 'item') {
      const def = ITEMS[msg.id];
      if (!def || def.zone == null || def.zone > Math.min(zid, 3) || def.legacy) return;
      const price = Math.round(def.price * (def.fixed ? 1 : Math.pow(zoneMult(zid), 2.6)) * disc);
      if (p.gold < price) { this.send(p, { t: 'info', text: 'Or insuffisant.' }); return; }
      if (p.inventory.length >= 24) { this.send(p, { t: 'info', text: 'Inventaire plein.' }); return; }
      const w = inventoryWeight(p.inventory) + (def.weight || 0);
      if (w > p.eff.capacity) { this.send(p, { t: 'info', text: `Trop lourd ! (${w.toFixed(1)} / ${p.eff.capacity})` }); return; }
      p.gold -= price;
      const item = makeItem(msg.id, Math.random, zid);
      item.q = 0; item.bonus = {}; // le marchand vend du standard ; le butin, lui, peut être magique
      p.inventory.push(item);
      this.send(p, { t: 'loot', text: `Acheté : ${itemLabel(item)}` });
    } else if (msg.kind === 'spell') {
      const sp = content.spellById[msg.id];
      if (!sp || sp.zone > zid || p.spells.includes(sp.id)) return;
      const req = this.spellReqMet(p, sp);
      if (req !== true) { this.send(p, { t: 'info', text: req }); return; }
      const price = Math.round(sp.price * disc);
      if (p.gold < price) { this.send(p, { t: 'info', text: 'Or insuffisant.' }); return; }
      p.gold -= price;
      p.spells.push(sp.id);
      this.send(p, { t: 'loot', text: `Sort appris : ${sp.name}` });
    } else if (msg.kind === 'skill') {
      const sk = content.skillById[msg.id];
      if (!sk || sk.zone > zid || p.skills.includes(sk.id)) return;
      const price = Math.round(sk.price * disc);
      if (p.gold < price) { this.send(p, { t: 'info', text: 'Or insuffisant.' }); return; }
      p.gold -= price;
      p.skills.push(sk.id);
      this.recompute(p);
      this.send(p, { t: 'loot', text: `Compétence apprise : ${sk.name}` });
    }
    this.sendSelf(p);
  }

  // Vente au marchand : même prix que l'achat (qualité et zone de l'objet comprises)
  sell(p, msg) {
    let npc = null;
    for (const e of p.zi.nearby(p.x, p.z, C.INTERACT_RANGE + 1)) {
      if (e.kind === C.KIND.NPC) { npc = e; break; }
    }
    if (!npc) { this.send(p, { t: 'info', text: 'Aucun marchand à proximité.' }); return; }
    const i = p.inventory.findIndex(it => it.iid === (msg.iid | 0));
    if (i < 0) return;
    const item = p.inventory[i];
    // déséquipe si nécessaire
    for (const [slot, iid] of Object.entries(p.equip)) {
      if (iid === item.iid) delete p.equip[slot];
    }
    // même rabais qu'à l'achat (sinon Marchandage permettrait l'or infini)
    const price = Math.round(itemPrice(item) * (1 - (p.skillFx?.discount || 0)));
    p.inventory.splice(i, 1);
    p.gold += price;
    this.recompute(p);
    this.send(p, { t: 'loot', text: `Vendu : ${itemLabel(item)} (+${price} or)` });
    this.sendSelf(p);
  }

  // Prérequis T4C d'un sort : niveau, Sagesse, Intelligence, sort précédent.
  // Retourne true, ou le message expliquant ce qui manque.
  spellReqMet(p, sp) {
    const wis = p.eff.stats.wis, intel = p.eff.stats.int;
    if (sp.level && p.level < sp.level) return `Niveau ${sp.level} requis.`;
    if (sp.wis && wis < sp.wis) return `${sp.wis} de Sagesse requis (vous : ${wis}).`;
    if (sp.int && intel < sp.int) return `${sp.int} d'Intelligence requis (vous : ${intel}).`;
    if (sp.requires && !p.spells.includes(sp.requires)) {
      const r = content.spellById[sp.requires];
      return `Sort prérequis : ${r ? r.name : sp.requires}.`;
    }
    return true;
  }

  spellReqText(sp) {
    const parts = [];
    if (sp.level) parts.push(`niv. ${sp.level}`);
    if (sp.wis) parts.push(`Sag ${sp.wis}`);
    if (sp.int) parts.push(`Int ${sp.int}`);
    if (sp.requires) parts.push(content.spellById[sp.requires]?.name || sp.requires);
    return parts.join(', ');
  }

  // ---------- Sorts ----------
  castSpell(p, msg) {
    const sp = content.spellById[msg.spellId];
    if (!sp || !p.spells.includes(sp.id)) return;
    const now = this.now();
    if ((p.spellCds[sp.id] || 0) > now) return;
    if (p.mana < sp.mana) { this.send(p, { t: 'info', text: 'Mana insuffisant.' }); return; }

    const spellMul = 1 + (p.skillFx?.spellMul || 0);
    const intel = p.eff.stats.int, wis = p.eff.stats.wis;

    if (sp.type === 'heal') {
      const amount = Math.round(sp.power * (1 + wis * 0.05) * spellMul);
      p.hp = Math.min(p.eff.maxHp, p.hp + amount);
      this.eventNear(p, { t: 'fx', kind: 'heal', id: p.id });
      this.send(p, { t: 'vitals', hp: Math.round(p.hp), mana: Math.round(p.mana - sp.mana) });
    } else if (sp.type === 'buff') {
      // puissance influencée par les stats, fidèle à T4C :
      // Bénédiction ~ 1,2 x Sagesse ; Force de la Terre +25% de Force ;
      // protections (CA) bonifiées par la Sagesse
      let power = sp.power;
      if (sp.stat === 'maxhp') power = Math.round(sp.power * wis);
      else if (sp.stat === 'str') power = Math.max(1, Math.round(p.stats.str * sp.power));
      else if (sp.stat === 'def') power = Math.round(sp.power * (1 + wis * 0.008));
      p.buffs = p.buffs.filter(b => b.stat !== sp.stat);
      p.buffs.push({ stat: sp.stat, power, until: now + sp.duration });
      this.recompute(p);
      this.eventNear(p, { t: 'fx', kind: 'buff', id: p.id, color: sp.color });
    } else if (sp.type === 'bolt') {
      const target = p.zi.entities.get(msg.target | 0);
      if (!target || target.kind !== C.KIND.MOB || target.dead || target.hidden) return;
      if (Math.hypot(target.x - p.x, target.z - p.z) > sp.range) { this.send(p, { t: 'info', text: 'Trop loin.' }); return; }
      if (!lineOfSight(p.zi.world, p, target)) return;
      // les sorts ignorent la CA (T4C : seules les résistances comptaient)
      const dmg = Math.round(sp.power * (1 + intel * 0.045) * spellMul * (0.9 + Math.random() * 0.2));
      this.eventNear(target, { t: 'proj', from: p.id, to: target.id, color: sp.color });
      this.applyDamage(p, target, dmg, false);
      if (sp.leech) {
        p.hp = Math.min(p.eff.maxHp, p.hp + dmg * sp.leech);
        this.eventNear(p, { t: 'fx', kind: 'heal', id: p.id });
      }
      p.dir = Math.atan2(target.x - p.x, target.z - p.z);
      p.lastCombat = now;
    } else if (sp.type === 'aoe') {
      const cx = +msg.x, cz = +msg.z;
      if (!Number.isFinite(cx) || !Number.isFinite(cz)) return;
      if (Math.hypot(cx - p.x, cz - p.z) > sp.range) { this.send(p, { t: 'info', text: 'Trop loin.' }); return; }
      this.eventNear(p, { t: 'aoe', from: p.id, x: cx, z: cz, radius: sp.radius, color: sp.color });
      for (const e of [...p.zi.nearby(cx, cz, sp.radius)]) {
        if (e.kind !== C.KIND.MOB || e.dead) continue;
        // les sorts ignorent la CA (T4C : seules les résistances comptaient)
        const dmg = Math.round(sp.power * (1 + intel * 0.045) * spellMul * (0.85 + Math.random() * 0.3));
        this.applyDamage(p, e, dmg, false);
      }
      p.lastCombat = now;
    }

    p.mana -= sp.mana;
    p.spellCds[sp.id] = now + sp.cd;
    p.state = C.ST.ATTACK;
    this.send(p, { t: 'cast_ok', spellId: sp.id, cd: sp.cd, mana: Math.round(p.mana) });
    if (sp.type === 'buff') this.sendSelf(p); // maxHp/dégâts/défense ont pu changer
  }

  applyDamage(attacker, defender, dmg, crit) {
    defender.hp -= dmg;
    defender.lastCombat = this.now();
    this.eventNear(defender, { t: 'dmg', from: attacker.id, to: defender.id, amount: dmg, crit });
    if (defender.hp <= 0) {
      if (defender.kind === C.KIND.MOB) this.killMob(defender, attacker);
      else this.killPlayer(defender, attacker);
    } else if (defender.kind === C.KIND.PLAYER) {
      this.send(defender, { t: 'vitals', hp: Math.round(defender.hp), mana: Math.round(defender.mana) });
    }
  }

  // ---------- Combat ----------
  attack(attacker, defender) {
    const aStats = attacker.kind === C.KIND.PLAYER ? attacker.eff.stats
      : { str: 0, agi: 10 + attacker.level * 1.8, end: 0, int: 0, wis: 0 };
    const dStats = defender.kind === C.KIND.PLAYER ? defender.eff.stats
      : { str: 0, agi: 10 + defender.level * 1.8, end: 0, int: 0, wis: 0 };
    attacker.state = C.ST.ATTACK;
    attacker.dir = Math.atan2(defender.x - attacker.x, defender.z - attacker.z);
    attacker.lastCombat = this.now();
    defender.lastCombat = this.now();

    let hitC = C.hitChance(aStats, dStats);
    if (attacker.kind === C.KIND.PLAYER) hitC = Math.min(0.98, hitC + (attacker.skillFx?.hit || 0));
    if (Math.random() > hitC) {
      this.eventNear(defender, { t: 'dmg', from: attacker.id, to: defender.id, miss: true });
      return;
    }
    // joueur : tirage dans la fourchette de l'arme (T4C) ; monstre : variance
    let dmg;
    if (attacker.kind === C.KIND.PLAYER) {
      const e = attacker.eff;
      dmg = Math.round((e.dmgMin + Math.random() * (e.dmgMax - e.dmgMin)) * e.dmgMult);
    } else {
      dmg = Math.round(attacker.sc.dmg * (0.85 + Math.random() * 0.3));
    }
    let crit = false;
    if (attacker.kind === C.KIND.PLAYER && Math.random() < C.critChance(aStats) + (attacker.skillFx?.crit || 0)) {
      dmg = Math.round(dmg * 1.6); crit = true;
    }
    const defense = defender.kind === C.KIND.PLAYER ? defender.eff.defense : defender.sc.def;
    dmg = C.mitigate(dmg, defense);
    this.applyDamage(attacker, defender, dmg, crit);
  }

  killMob(m, killer) {
    m.dead = true; m.state = C.ST.DEAD; m.hp = 0; m.target = null; m.path = null;
    m.hideAt = this.now() + 6;
    m.respawnAt = m.noRespawn ? Infinity : this.now() + m.def.respawn;
    if (killer.kind === C.KIND.PLAYER) {
      const xp = C.mobXpReward(m.level, killer.level);
      this.addXp(killer, xp);
      this.send(killer, { t: 'loot', text: `+${xp} XP (${m.def.name})` });
      if (killer.attackTarget === m.id) killer.attackTarget = null;
      const zid = m.zi.zoneId;
      for (const payload of rollDrops(m.def, Math.random, zid, killer.skillFx?.loot || 0)) {
        this.spawnDrop(m.zi, m.x, m.z, payload);
      }
    }
  }

  // Mort définitive : le personnage est effacé. Roguelike.
  killPlayer(p, killer) {
    p.dead = true; p.permadead = true; p.state = C.ST.DEAD; p.hp = 0;
    p.path = null; p.moveDir = null; p.attackTarget = null;
    const who = killer.kind === C.KIND.MOB ? killer.def.name : killer.name;
    const zoneName = p.zi.isTrial ? `l'Épreuve vers ${this.zoneDef(p.zi.trialTarget).name}` : this.zoneDef(p.zi.zoneId).name;
    db.recordDeath(p.name, p.level, zoneName, who);
    db.deleteCharacter(p.accountId);
    this.broadcastChat('sys', `☠ ${p.name} (niveau ${p.level}) a péri dans ${zoneName}, tué par ${who}. Son âme est perdue à jamais.`);
    this.send(p, { t: 'died', by: who, level: p.level, zone: zoneName, permadeath: true, pantheon: db.pantheon(8) });
  }

  // Infos de création (base, points à répartir, plafond) pour le client
  creationInfo() {
    return { ...C.CREATION, stats: C.STATS, names: C.STAT_NAMES };
  }

  // Construit les données d'un nouveau personnage (répartition validée)
  buildCharacter(name, stats, sex) {
    if (!C.validateCreationStats(stats)) return null;
    const clean = {};
    for (const st of C.STATS) clean[st] = stats[st] | 0;
    return db.newCharacterData(name, this.island(0).world.spawnPoint, clean, sex);
  }

  reincarnate(p, stats = null, sex = null) {
    const zi0 = this.island(0);
    const data = db.newCharacterData(p.name, zi0.world.spawnPoint, stats, sex || p.sex);
    p.sex = data.sex;
    db.saveCharacter(p.accountId, data);
    p.permadead = false; p.dead = false; p.state = C.ST.IDLE;
    p.level = 1; p.xp = 0; p.statPoints = 0;
    p.stats = { ...data.stats };
    p.hpAcc = C.maxHp(p.stats, 1);
    p.manaAcc = C.maxMana(p.stats, 1);
    p.gold = data.gold;
    p.inventory = data.inventory; p.equip = data.equip;
    p.spells = []; p.skills = []; p.unlocked = [0];
    p.buffs = []; p.spellCds = {};
    this.recompute(p);
    p.hp = p.eff.maxHp; p.mana = p.eff.maxMana;
    this.movePlayerToZone(p, zi0, zi0.world.spawnPoint.x, zi0.world.spawnPoint.z);
    this.broadcastChat('sys', `${p.name} renaît sur ${this.zoneDef(0).name}.`);
  }

  addXp(p, amount) {
    p.xp += amount;
    let leveled = false;
    while (p.level < C.MAX_LEVEL && p.xp >= C.xpForLevel(p.level + 1)) {
      p.level++;
      p.statPoints += C.POINTS_PER_LEVEL;
      // gains de PV/mana figés au passage de niveau, selon les stats DU MOMENT
      // (équipement compris) — fidèle à T4C
      p.hpAcc += C.hpGainPerLevel(p.eff.stats);
      p.manaAcc += C.manaGainPerLevel(p.eff.stats);
      leveled = true;
    }
    if (leveled) {
      this.recompute(p);
      p.hp = p.eff.maxHp; p.mana = p.eff.maxMana;
      this.eventNear(p, { t: 'fx', kind: 'levelup', id: p.id });
      this.broadcastChat('sys', `${p.name} passe niveau ${p.level} !`);
    }
    this.sendSelf(p);
  }

  doPickup(p, d) {
    if (d.gold) {
      p.gold += d.gold;
      this.send(p, { t: 'loot', text: `+${d.gold} or` });
    } else if (d.item) {
      if (p.inventory.length >= 24) { this.send(p, { t: 'loot', text: 'Inventaire plein !' }); return; }
      // encombrement T4C : capacité = 500×For/(For+100)
      const w = inventoryWeight(p.inventory) + itemWeight(d.item);
      if (w > p.eff.capacity) {
        this.send(p, { t: 'info', text: `Trop lourd ! (${w.toFixed(1)} / ${p.eff.capacity} — montez la Force ou délestez-vous)` });
        return;
      }
      p.inventory.push(d.item);
      this.send(p, { t: 'loot', text: itemLabel(d.item) });
    }
    d.zi.remove(d);
    this.sendSelf(p);
  }

  spawnDrop(zi, x, z, payload) {
    for (let tries = 0; tries < 8; tries++) {
      const dx = (Math.random() - 0.5) * 2, dz = (Math.random() - 0.5) * 2;
      if (zi.world.isWalkable(x + dx, z + dz)) { x += dx; z += dz; break; }
    }
    const d = {
      id: this.nextId++, kind: C.KIND.DROP,
      defId: payload.gold ? 'or' : payload.item.defId,
      gold: payload.gold || 0, item: payload.item || null,
      x, z, dir: 0, state: 0, hidden: false,
      expiresAt: this.now() + C.ITEM_DESPAWN,
    };
    zi.add(d);
  }

  // ---------- Boucle ----------
  tick() {
    this.tickCount++;
    const dt = C.TICK_DT;
    this.worldTime = (this.worldTime + dt) % C.DAY_LENGTH;
    const now = this.now();

    for (const p of this.players.values()) {
      if (p.dead) continue;
      // expiration des buffs
      const nb = p.buffs.filter(b => b.until > now);
      if (nb.length !== p.buffs.length) { p.buffs = nb; this.recompute(p); this.sendSelf(p); }

      // régénération
      if (now - p.lastCombat > 5 || p.eff.buffRegen) {
        const oldHp = p.hp, oldMana = p.mana;
        const inCombat = now - p.lastCombat <= 5;
        if (!inCombat) {
          p.hp = Math.min(p.eff.maxHp, p.hp + C.hpRegenPerSec(p.eff.stats) * (1 + (p.skillFx?.hpRegenMul || 0)) * dt);
          p.mana = Math.min(p.eff.maxMana, p.mana + C.manaRegenPerSec(p.eff.stats) * (1 + (p.skillFx?.manaRegenMul || 0)) * dt);
        }
        if (p.eff.buffRegen) p.hp = Math.min(p.eff.maxHp, p.hp + p.eff.buffRegen * dt);
        if ((Math.floor(p.hp) !== Math.floor(oldHp) || Math.floor(p.mana) !== Math.floor(oldMana)) && this.tickCount % 10 === 0) {
          this.send(p, { t: 'vitals', hp: Math.round(p.hp), mana: Math.round(p.mana) });
        }
      }
      p.atkCd = Math.max(0, p.atkCd - dt);

      // déplacement direct (flèches / clic maintenu)
      if (p.moveDir) {
        const sp = p.eff.speed * dt;
        const nx = p.x + p.moveDir.x * sp, nz = p.z + p.moveDir.z * sp;
        if (p.zi.world.isWalkable(nx, nz)) { p.x = nx; p.z = nz; }
        else if (p.zi.world.isWalkable(nx, p.z)) { p.x = nx; }
        else if (p.zi.world.isWalkable(p.x, nz)) { p.z = nz; }
        p.dir = Math.atan2(p.moveDir.x, p.moveDir.z);
        p.state = C.ST.WALK;
        p.zi.gridMove(p);
      }

      // poursuite/attaque
      if (p.attackTarget != null) {
        const tgt = p.zi.entities.get(p.attackTarget);
        if (!tgt || tgt.dead || tgt.hidden) { p.attackTarget = null; p.state = C.ST.IDLE; }
        else {
          const dist = Math.hypot(tgt.x - p.x, tgt.z - p.z);
          if (dist <= p.eff.atkRange && lineOfSight(p.zi.world, p, tgt)) {
            p.path = null;
            if (p.atkCd <= 0) { p.atkCd = p.eff.atkCd; this.attack(p, tgt); }
            else if (p.state !== C.ST.ATTACK) p.state = C.ST.IDLE;
          } else if (!p.path || this.tickCount % 5 === 0) {
            p.path = findPath(p.zi.world, p.x, p.z, tgt.x, tgt.z);
          }
        }
      }
      if (!p.moveDir) this.stepAlong(p, p.eff.speed, dt);

      // ramassage / interaction en attente
      if (p.pendingPickup != null) {
        const d = p.zi.entities.get(p.pendingPickup);
        if (!d || d.kind !== C.KIND.DROP) p.pendingPickup = null;
        else if (Math.hypot(d.x - p.x, d.z - p.z) <= C.PICKUP_RANGE) {
          this.doPickup(p, d);
          p.pendingPickup = null;
        }
      }
      if (p.pendingInteract) {
        const pi = p.pendingInteract;
        const tx = pi.id != null ? p.zi.entities.get(pi.id)?.x : pi.px;
        const tz = pi.id != null ? p.zi.entities.get(pi.id)?.z : pi.pz;
        if (tx == null) p.pendingInteract = null;
        else if (Math.hypot(tx - p.x, tz - p.z) <= C.INTERACT_RANGE) {
          p.pendingInteract = null;
          if (pi.id != null) {
            const npc = p.zi.entities.get(pi.id);
            if (npc?.kind === C.KIND.NPC) this.openShop(p, npc);
          } else {
            const prop = (p.zi.world.props || []).find(pr => pr.type === pi.prop && Math.hypot(pr.x - pi.px, pr.z - pi.pz) < 0.1);
            if (prop) this.interactProp(p, prop);
          }
        }
      }
    }

    // Monstres et objets au sol, zone par zone
    for (const zi of this.zones.values()) {
      const hasPlayers = zi.players > 0;
      for (const e of [...zi.entities.values()]) {
        if (e.kind === C.KIND.MOB) {
          if (hasPlayers || e.dead) this.tickMob(zi, e, now, dt);
        } else if (e.kind === C.KIND.DROP && now > e.expiresAt) {
          zi.remove(e);
        }
      }
    }

    this.sendSnapshots();
  }

  tickMob(zi, m, now, dt) {
    if (m.dead) {
      if (!m.hidden && now >= m.hideAt) m.hidden = true;
      if (now >= m.respawnAt) {
        m.dead = false; m.hidden = false; m.hp = m.maxHp; m.state = C.ST.IDLE;
        m.x = m.home.x; m.z = m.home.z; m.target = null; m.path = null;
        zi.gridMove(m);
      }
      return;
    }
    m.atkCd = Math.max(0, m.atkCd - dt);

    if (!m.target && (this.tickCount + m.id) % 5 === 0) {
      let best = null, bestD = m.def.aggro;
      for (const e of zi.nearby(m.x, m.z, m.def.aggro)) {
        if (e.kind !== C.KIND.PLAYER || e.dead) continue;
        const d = Math.hypot(e.x - m.x, e.z - m.z);
        if (d < bestD) { bestD = d; best = e; }
      }
      if (best) m.target = best.id;
    }

    if (m.target) {
      const tgt = zi.entities.get(m.target);
      const leashed = Math.hypot(m.x - m.home.x, m.z - m.home.z) > m.def.leash;
      if (!tgt || tgt.dead || leashed || Math.hypot(tgt.x - m.x, tgt.z - m.z) > m.def.leash) {
        m.target = null;
        m.path = findPath(zi.world, m.x, m.z, m.home.x, m.home.z);
      } else {
        const dist = Math.hypot(tgt.x - m.x, tgt.z - m.z);
        if (dist <= m.def.atkRange) {
          m.path = null;
          if (m.atkCd <= 0) { m.atkCd = m.def.atkSpeed; this.attack(m, tgt); }
        } else if (!m.path || (this.tickCount + m.id) % 5 === 0) {
          m.path = findPath(zi.world, m.x, m.z, tgt.x, tgt.z);
        }
      }
    } else if (now >= m.wanderAt) {
      m.wanderAt = now + 4 + Math.random() * 8;
      const a = Math.random() * Math.PI * 2, d = 1 + Math.random() * 4;
      const wx = m.home.x + Math.cos(a) * d, wz = m.home.z + Math.sin(a) * d;
      if (zi.world.isWalkable(wx, wz)) m.path = findPath(zi.world, m.x, m.z, wx, wz);
    }

    this.stepAlong(m, m.def.speed, dt);
  }

  stepAlong(e, speed, dt) {
    if (!e.path || !e.path.length) {
      if (e.state === C.ST.WALK) e.state = C.ST.IDLE;
      return;
    }
    let remaining = speed * dt;
    while (remaining > 0 && e.path && e.path.length) {
      const wp = e.path[0];
      const dx = wp.x - e.x, dz = wp.z - e.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.05) { e.path.shift(); continue; }
      const step = Math.min(d, remaining);
      e.x += (dx / d) * step;
      e.z += (dz / d) * step;
      e.dir = Math.atan2(dx, dz);
      remaining -= step;
    }
    if (e.path && !e.path.length) e.path = null;
    e.state = e.path ? C.ST.WALK : (e.state === C.ST.ATTACK ? C.ST.ATTACK : C.ST.IDLE);
    e.zi.gridMove(e);
  }

  // ---------- Snapshots ----------
  sendSnapshots() {
    for (const p of this.players.values()) {
      if (p.ws.readyState !== 1) continue;
      const visible = [];
      const seen = new Set();
      const metas = [];
      for (const e of p.zi.nearby(p.x, p.z, C.AOI_RADIUS)) {
        seen.add(e.id);
        visible.push({
          id: e.id, kind: e.kind, x: e.x, z: e.z, dir: e.dir || 0,
          state: e.state || 0,
          hpPct: e.kind === C.KIND.DROP || e.kind === C.KIND.NPC ? 100
            : Math.max(0, Math.min(100, Math.round((e.hp / (e.kind === C.KIND.PLAYER ? e.eff.maxHp : e.maxHp)) * 100))),
          level: Math.min(255, e.level || 0),
        });
        if (!p.known.has(e.id)) {
          p.known.add(e.id);
          metas.push(this.metaFor(e));
        }
      }
      const gone = [];
      for (const id of p.known) {
        if (!seen.has(id)) { gone.push(id); p.known.delete(id); }
      }
      if (metas.length) this.send(p, { t: 'meta', list: metas });
      if (p.events.length) {
        this.send(p, { t: 'events', list: p.events });
        p.events = [];
      }
      p.ws.send(encodeSnapshot(this.worldTime, visible, gone));
    }
  }

  // ---------- Arrêt gracieux : décompte diffusé, sauvegarde, extinction ----------
  beginShutdown(seconds = 45) {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    console.log(`Arrêt du serveur dans ${seconds}s (Ctrl-C à nouveau pour forcer)`);
    this.broadcastChat('sys', `⚠ ARRÊT DU SERVEUR DANS ${seconds} SECONDES — mettez-vous à l'abri !`);
    const marks = [30, 15, 10, 5, 4, 3, 2, 1].filter(m => m < seconds);
    for (const m of marks) {
      setTimeout(() => this.broadcastChat('sys', `⚠ Arrêt du serveur dans ${m} seconde${m > 1 ? 's' : ''}…`),
        (seconds - m) * 1000);
    }
    setTimeout(() => {
      this.broadcastChat('sys', '⚠ Arrêt du serveur. À bientôt dans les Royaumes !');
      this.saveAll();
      console.log(`${this.players.size} personnage(s) sauvegardé(s). Extinction.`);
      for (const p of this.players.values()) {
        try { p.ws.close(1001, 'Arrêt du serveur'); } catch {}
      }
      setTimeout(() => process.exit(0), 300);
    }, seconds * 1000);
  }

  metaFor(e) {
    if (e.kind === C.KIND.PLAYER) {
      return { id: e.id, kind: e.kind, name: e.name, level: e.level, look: e.look };
    }
    if (e.kind === C.KIND.MOB) {
      return { id: e.id, kind: e.kind, defId: e.defId, name: e.def.name, level: e.level };
    }
    if (e.kind === C.KIND.NPC) {
      return { id: e.id, kind: e.kind, npcId: e.npcId, name: e.name, look: e.look, level: 0 };
    }
    return { id: e.id, kind: e.kind, defId: e.defId, gold: e.gold || 0, q: e.item?.q || 0 };
  }
}
