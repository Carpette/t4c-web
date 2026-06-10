// Boucle de jeu autoritative : mouvements, combat, IA, intérêt local (AOI), snapshots.
import * as C from '../../shared/constants.js';
import { ITEMS, MOBS, SLOTS } from '../../shared/defs.js';
import { generateWorld, SPAWN_ZONES, mulberry32 } from '../../shared/worldgen.js';
import { encodeSnapshot } from '../../shared/protocol.js';
import { makeItem, rollDrops, itemStats, itemLabel, setNextIid } from './items.js';
import { findPath, lineOfSight } from './pathfind.js';
import * as db from '../db.js';

const CELL = 16;

export class Game {
  constructor() {
    this.world = generateWorld();
    this.entities = new Map();   // id -> entité
    this.players = new Map();    // id -> joueur
    this.grid = new Map();       // hash spatial
    this.nextId = 1;
    this.worldTime = C.DAY_LENGTH * 0.3; // on démarre le matin
    this.tickCount = 0;
    this.spawnMobs();
    setInterval(() => this.tick(), 1000 / C.TICK_RATE);
    setInterval(() => this.saveAll(), 60_000);
  }

  // ---------- Hash spatial ----------
  cellKey(x, z) { return (Math.floor(x / CELL) << 8) | (Math.floor(z / CELL) & 0xff); }
  gridAdd(e) {
    const k = this.cellKey(e.x, e.z);
    let s = this.grid.get(k);
    if (!s) { s = new Set(); this.grid.set(k, s); }
    s.add(e); e._cell = k;
  }
  gridMove(e) {
    const k = this.cellKey(e.x, e.z);
    if (k !== e._cell) {
      this.grid.get(e._cell)?.delete(e);
      this.gridAdd(e);
    }
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

  // ---------- Apparition des monstres ----------
  spawnMobs() {
    const rng = mulberry32(C.WORLD_SEED ^ 0xbeef);
    for (const zone of SPAWN_ZONES) {
      for (let i = 0; i < zone.count; i++) {
        let x, z, tries = 0;
        do {
          const a = rng() * Math.PI * 2, d = rng() * zone.radius;
          x = zone.center[0] + Math.cos(a) * d + 0.5;
          z = zone.center[1] + Math.sin(a) * d + 0.5;
        } while (!this.world.isWalkable(x, z) && ++tries < 40);
        if (tries >= 40) continue;
        this.spawnMob(zone.mob, x, z);
      }
    }
  }

  spawnMob(defId, x, z) {
    const def = MOBS[defId];
    const m = {
      id: this.nextId++, kind: C.KIND.MOB, defId, def,
      x, z, dir: 0, state: C.ST.IDLE,
      hp: def.hp, maxHp: def.hp,
      home: { x, z }, target: null, atkCd: 0, path: null,
      wanderAt: this.now() + 2 + Math.random() * 6,
      dead: false, hidden: false, respawnAt: 0, hideAt: 0,
    };
    this.entities.set(m.id, m);
    this.gridAdd(m);
    return m;
  }

  now() { return this.tickCount / C.TICK_RATE; }

  // ---------- Joueurs ----------
  addPlayer(ws, accountId, name) {
    if (this.players.size >= C.MAX_PLAYERS) return { error: 'Serveur plein (256 joueurs max)' };
    for (const p of this.players.values()) {
      if (p.accountId === accountId) this.removePlayer(p, 'Connecté ailleurs');
    }
    let data = db.loadCharacter(accountId);
    if (!data) {
      data = db.newCharacterData(name, this.world.spawnPoint);
      db.saveCharacter(accountId, data);
    }
    const p = {
      id: this.nextId++, kind: C.KIND.PLAYER, ws, accountId,
      name: data.name, level: data.level, xp: data.xp, statPoints: data.statPoints,
      stats: data.stats, gold: data.gold,
      inventory: data.inventory || [], equip: data.equip || {},
      x: data.x, z: data.z, dir: 0, state: C.ST.IDLE,
      path: null, attackTarget: null, atkCd: 0, lastCombat: -99,
      hp: 1, mana: 1, dead: false, hidden: false, respawnReady: false,
      known: new Set(), events: [], lastChat: 0,
    };
    for (const it of p.inventory) setNextIid(it.iid + 1);
    if (!this.world.isWalkable(p.x, p.z)) { p.x = this.world.spawnPoint.x; p.z = this.world.spawnPoint.z; }
    this.recompute(p);
    p.hp = data.hp == null ? p.eff.maxHp : Math.min(data.hp, p.eff.maxHp);
    p.mana = data.mana == null ? p.eff.maxMana : Math.min(data.mana, p.eff.maxMana);
    if (p.hp <= 0) p.hp = p.eff.maxHp; // pas de connexion mort
    this.players.set(p.id, p);
    this.entities.set(p.id, p);
    this.gridAdd(p);
    this.send(p, { t: 'welcome', id: p.id, time: this.worldTime });
    this.sendSelf(p);
    this.broadcastChat('sys', `${p.name} entre dans le monde.`);
    return { player: p };
  }

  removePlayer(p, reason) {
    if (!this.players.has(p.id)) return;
    this.savePlayer(p);
    this.players.delete(p.id);
    this.entities.delete(p.id);
    this.gridRemove(p);
    this.broadcastChat('sys', `${p.name} quitte le monde.`);
    try { p.ws.close(1000, reason || 'bye'); } catch {}
  }

  savePlayer(p) {
    db.saveCharacter(p.accountId, {
      name: p.name, level: p.level, xp: p.xp, statPoints: p.statPoints,
      stats: p.stats, hp: p.hp, mana: p.mana, x: p.x, z: p.z,
      gold: p.gold, inventory: p.inventory, equip: p.equip,
    });
  }
  saveAll() { for (const p of this.players.values()) this.savePlayer(p); }

  // Stats effectives (base + équipement)
  recompute(p) {
    const stats = { ...p.stats };
    let weaponDmg = 0, weaponSpeed = null, defense = 0;
    for (const slot of SLOTS) {
      const iid = p.equip[slot];
      if (!iid) continue;
      const item = p.inventory.find(i => i.iid === iid);
      if (!item) { delete p.equip[slot]; continue; }
      const s = itemStats(item);
      if (slot === 'weapon') { weaponDmg = s.dmg; weaponSpeed = s.speed; }
      defense += s.def;
      for (const [st, v] of Object.entries(s.bonus)) stats[st] = (stats[st] || 0) + v;
    }
    p.eff = {
      stats,
      maxHp: C.maxHp(stats, p.level),
      maxMana: C.maxMana(stats, p.level),
      dmg: C.meleeDamage(stats, weaponDmg),
      atkCd: C.attackCooldown(stats, weaponSpeed),
      defense,
      speed: C.moveSpeed(stats),
      atkRange: 1.8,
    };
    p.hp = Math.min(p.hp, p.eff.maxHp);
    p.mana = Math.min(p.mana, p.eff.maxMana);

    // apparence (couches Flare) diffusée aux clients
    const layerOf = (slot) => {
      const iid = p.equip[slot];
      const item = iid && p.inventory.find(i => i.iid === iid);
      return item ? (ITEMS[item.defId].layer || null) : null;
    };
    const look = {
      chest: layerOf('armor'), head: layerOf('helmet'),
      main: layerOf('weapon'), off: layerOf('shield'),
    };
    const changed = JSON.stringify(look) !== JSON.stringify(p.look || null);
    p.look = look;
    if (changed && this.players.has(p.id)) {
      this.eventNear(p.x, p.z, { t: 'look', id: p.id, look });
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
      dmg: p.eff.dmg, defense: p.eff.defense, gold: p.gold,
      inventory: p.inventory.map(it => ({ ...it, label: itemLabel(it), slot: ITEMS[it.defId].slot })),
      equip: p.equip,
    });
  }

  send(p, obj) {
    if (p.ws.readyState === 1) p.ws.send(JSON.stringify(obj));
  }
  broadcastChat(from, text) {
    const msg = JSON.stringify({ t: 'chat', from, text });
    for (const p of this.players.values()) if (p.ws.readyState === 1) p.ws.send(msg);
  }
  eventNear(x, z, obj) {
    for (const e of this.nearby(x, z, C.AOI_RADIUS)) {
      if (e.kind === C.KIND.PLAYER) e.events.push(obj);
    }
  }

  // ---------- Messages clients ----------
  onMessage(p, msg) {
    switch (msg.t) {
      case 'move': {
        if (p.dead) return;
        const x = +msg.x, z = +msg.z;
        if (!Number.isFinite(x) || !Number.isFinite(z)) return;
        p.attackTarget = null;
        p.path = findPath(this.world, p.x, p.z, x, z);
        break;
      }
      case 'attack': {
        if (p.dead) return;
        const target = this.entities.get(msg.id | 0);
        if (target && target.kind !== C.KIND.DROP && !target.dead && target.id !== p.id) {
          p.attackTarget = target.id;
          p.path = null;
        }
        break;
      }
      case 'pickup': {
        if (p.dead) return;
        const d = this.entities.get(msg.id | 0);
        if (!d || d.kind !== C.KIND.DROP || d.hidden) return;
        if (Math.hypot(d.x - p.x, d.z - p.z) > C.PICKUP_RANGE) {
          p.path = findPath(this.world, p.x, p.z, d.x, d.z);
          p.pendingPickup = d.id;
          return;
        }
        this.doPickup(p, d);
        break;
      }
      case 'equip': {
        const item = p.inventory.find(i => i.iid === (msg.iid | 0));
        if (!item) return;
        const slot = ITEMS[item.defId].slot;
        if (!SLOTS.includes(slot)) return;
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
        const def = ITEMS[p.inventory[i].defId];
        if (def.slot !== 'use') return;
        if (def.heal) p.hp = Math.min(p.eff.maxHp, p.hp + def.heal);
        if (def.mana) p.mana = Math.min(p.eff.maxMana, p.mana + def.mana);
        p.inventory.splice(i, 1);
        this.eventNear(p.x, p.z, { t: 'fx', kind: 'heal', id: p.id });
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
        if (text) this.broadcastChat(p.name, text);
        break;
      }
      case 'respawn': {
        if (!p.dead) return;
        p.dead = false; p.hidden = false; p.state = C.ST.IDLE;
        p.hp = p.eff.maxHp; p.mana = p.eff.maxMana;
        p.x = this.world.spawnPoint.x; p.z = this.world.spawnPoint.z;
        this.gridMove(p);
        this.sendSelf(p);
        break;
      }
    }
  }

  doPickup(p, d) {
    if (d.gold) {
      p.gold += d.gold;
      this.send(p, { t: 'loot', text: `+${d.gold} or` });
    } else if (d.item) {
      if (p.inventory.length >= 24) { this.send(p, { t: 'loot', text: 'Inventaire plein !' }); return; }
      p.inventory.push(d.item);
      this.send(p, { t: 'loot', text: itemLabel(d.item) });
    }
    this.removeEntity(d);
    this.sendSelf(p);
  }

  removeEntity(e) {
    this.entities.delete(e.id);
    this.gridRemove(e);
  }

  spawnDrop(x, z, payload) {
    // petite dispersion praticable
    for (let tries = 0; tries < 8; tries++) {
      const dx = (Math.random() - 0.5) * 2, dz = (Math.random() - 0.5) * 2;
      if (this.world.isWalkable(x + dx, z + dz)) { x += dx; z += dz; break; }
    }
    const d = {
      id: this.nextId++, kind: C.KIND.DROP,
      defId: payload.gold ? 'or' : payload.item.defId,
      gold: payload.gold || 0, item: payload.item || null,
      x, z, dir: 0, state: 0, hidden: false,
      expiresAt: this.now() + C.ITEM_DESPAWN,
    };
    this.entities.set(d.id, d);
    this.gridAdd(d);
  }

  // ---------- Combat ----------
  attack(attacker, defender) {
    const aStats = attacker.kind === C.KIND.PLAYER ? attacker.eff.stats
      : { str: 0, agi: 10 + attacker.def.level * 1.8, end: 0, int: 0, wis: 0 };
    const dStats = defender.kind === C.KIND.PLAYER ? defender.eff.stats
      : { str: 0, agi: 10 + defender.def.level * 1.8, end: 0, int: 0, wis: 0 };
    attacker.state = C.ST.ATTACK;
    attacker.dir = Math.atan2(defender.x - attacker.x, defender.z - attacker.z);
    attacker.lastCombat = this.now();
    defender.lastCombat = this.now();

    if (Math.random() > C.hitChance(aStats, dStats)) {
      this.eventNear(defender.x, defender.z, { t: 'dmg', from: attacker.id, to: defender.id, miss: true });
      return;
    }
    let dmg = attacker.kind === C.KIND.PLAYER ? attacker.eff.dmg : attacker.def.dmg;
    dmg = Math.round(dmg * (0.85 + Math.random() * 0.3));
    let crit = false;
    if (attacker.kind === C.KIND.PLAYER && Math.random() < C.critChance(aStats)) { dmg = Math.round(dmg * 1.6); crit = true; }
    const defense = defender.kind === C.KIND.PLAYER ? defender.eff.defense : defender.def.def;
    dmg = C.mitigate(dmg, defense);
    defender.hp -= dmg;
    this.eventNear(defender.x, defender.z, { t: 'dmg', from: attacker.id, to: defender.id, amount: dmg, crit });

    if (defender.hp <= 0) {
      if (defender.kind === C.KIND.MOB) this.killMob(defender, attacker);
      else this.killPlayer(defender, attacker);
    } else if (defender.kind === C.KIND.PLAYER) {
      this.send(defender, { t: 'vitals', hp: Math.round(defender.hp), mana: Math.round(defender.mana) });
    }
  }

  killMob(m, killer) {
    m.dead = true; m.state = C.ST.DEAD; m.hp = 0; m.target = null; m.path = null;
    m.hideAt = this.now() + 6;
    m.respawnAt = this.now() + m.def.respawn;
    if (killer.kind === C.KIND.PLAYER) {
      const xp = C.mobXpReward(m.def.level, killer.level);
      this.addXp(killer, xp);
      this.send(killer, { t: 'loot', text: `+${xp} XP (${m.def.name})` });
      if (killer.attackTarget === m.id) killer.attackTarget = null;
      for (const payload of rollDrops(m.def)) this.spawnDrop(m.x, m.z, payload);
    }
  }

  killPlayer(p, killer) {
    p.dead = true; p.state = C.ST.DEAD; p.hp = 0;
    p.path = null; p.attackTarget = null;
    const floor = C.xpForLevel(p.level);
    const span = C.xpForLevel(p.level + 1) - floor;
    p.xp = Math.max(floor, p.xp - Math.floor(span * C.DEATH_XP_LOSS));
    const who = killer.kind === C.KIND.MOB ? killer.def.name : killer.name;
    this.send(p, { t: 'died', by: who });
    this.broadcastChat('sys', `${p.name} a été tué par ${who}.`);
    this.sendSelf(p);
  }

  addXp(p, amount) {
    p.xp += amount;
    let leveled = false;
    while (p.level < C.MAX_LEVEL && p.xp >= C.xpForLevel(p.level + 1)) {
      p.level++;
      p.statPoints += C.POINTS_PER_LEVEL;
      leveled = true;
    }
    if (leveled) {
      this.recompute(p);
      p.hp = p.eff.maxHp; p.mana = p.eff.maxMana;
      this.eventNear(p.x, p.z, { t: 'fx', kind: 'levelup', id: p.id });
      this.broadcastChat('sys', `${p.name} passe niveau ${p.level} !`);
    }
    this.sendSelf(p);
  }

  // ---------- Boucle ----------
  tick() {
    this.tickCount++;
    const dt = C.TICK_DT;
    this.worldTime = (this.worldTime + dt) % C.DAY_LENGTH;
    const now = this.now();

    // Joueurs
    for (const p of this.players.values()) {
      if (p.dead) continue;
      // régénération hors combat
      if (now - p.lastCombat > 5) {
        const oldHp = p.hp, oldMana = p.mana;
        p.hp = Math.min(p.eff.maxHp, p.hp + C.hpRegenPerSec(p.eff.stats) * dt);
        p.mana = Math.min(p.eff.maxMana, p.mana + C.manaRegenPerSec(p.eff.stats) * dt);
        if ((Math.floor(p.hp) !== Math.floor(oldHp) || Math.floor(p.mana) !== Math.floor(oldMana)) && this.tickCount % 10 === 0) {
          this.send(p, { t: 'vitals', hp: Math.round(p.hp), mana: Math.round(p.mana) });
        }
      }
      p.atkCd = Math.max(0, p.atkCd - dt);

      // poursuite/attaque
      if (p.attackTarget != null) {
        const tgt = this.entities.get(p.attackTarget);
        if (!tgt || tgt.dead || tgt.hidden) { p.attackTarget = null; p.state = C.ST.IDLE; }
        else {
          const dist = Math.hypot(tgt.x - p.x, tgt.z - p.z);
          if (dist <= p.eff.atkRange && lineOfSight(this.world, p, tgt)) {
            p.path = null;
            if (p.atkCd <= 0) { p.atkCd = p.eff.atkCd; this.attack(p, tgt); }
            else if (p.state !== C.ST.ATTACK) p.state = C.ST.IDLE;
          } else {
            if (!p.path || this.tickCount % 5 === 0) {
              p.path = findPath(this.world, p.x, p.z, tgt.x, tgt.z);
            }
          }
        }
      }
      this.stepAlong(p, p.eff.speed, dt);

      // ramassage en attente
      if (p.pendingPickup != null) {
        const d = this.entities.get(p.pendingPickup);
        if (!d || d.kind !== C.KIND.DROP) p.pendingPickup = null;
        else if (Math.hypot(d.x - p.x, d.z - p.z) <= C.PICKUP_RANGE) {
          this.doPickup(p, d);
          p.pendingPickup = null;
        }
      }
    }

    // Monstres
    for (const e of this.entities.values()) {
      if (e.kind !== C.KIND.MOB) continue;
      this.tickMob(e, now, dt);
    }

    // Objets au sol expirés
    for (const e of [...this.entities.values()]) {
      if (e.kind === C.KIND.DROP && now > e.expiresAt) this.removeEntity(e);
    }

    this.sendSnapshots();
  }

  tickMob(m, now, dt) {
    if (m.dead) {
      if (!m.hidden && now >= m.hideAt) m.hidden = true;
      if (now >= m.respawnAt) {
        m.dead = false; m.hidden = false; m.hp = m.maxHp; m.state = C.ST.IDLE;
        m.x = m.home.x; m.z = m.home.z; m.target = null; m.path = null;
        this.gridMove(m);
      }
      return;
    }
    m.atkCd = Math.max(0, m.atkCd - dt);

    // acquisition de cible (échelonnée)
    if (!m.target && (this.tickCount + m.id) % 5 === 0) {
      let best = null, bestD = m.def.aggro;
      for (const e of this.nearby(m.x, m.z, m.def.aggro)) {
        if (e.kind !== C.KIND.PLAYER || e.dead) continue;
        const d = Math.hypot(e.x - m.x, e.z - m.z);
        if (d < bestD) { bestD = d; best = e; }
      }
      if (best) m.target = best.id;
    }

    if (m.target) {
      const tgt = this.entities.get(m.target);
      const leashed = Math.hypot(m.x - m.home.x, m.z - m.home.z) > m.def.leash;
      if (!tgt || tgt.dead || leashed || Math.hypot(tgt.x - m.x, tgt.z - m.z) > m.def.leash) {
        m.target = null;
        m.path = findPath(this.world, m.x, m.z, m.home.x, m.home.z);
      } else {
        const dist = Math.hypot(tgt.x - m.x, tgt.z - m.z);
        if (dist <= m.def.atkRange) {
          m.path = null;
          if (m.atkCd <= 0) { m.atkCd = m.def.atkSpeed; this.attack(m, tgt); }
        } else if (!m.path || (this.tickCount + m.id) % 5 === 0) {
          m.path = findPath(this.world, m.x, m.z, tgt.x, tgt.z);
        }
      }
    } else if (now >= m.wanderAt) {
      // errance autour du point d'origine
      m.wanderAt = now + 4 + Math.random() * 8;
      const a = Math.random() * Math.PI * 2, d = 1 + Math.random() * 4;
      const wx = m.home.x + Math.cos(a) * d, wz = m.home.z + Math.sin(a) * d;
      if (this.world.isWalkable(wx, wz)) m.path = findPath(this.world, m.x, m.z, wx, wz);
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
    this.gridMove(e);
  }

  // ---------- Snapshots ----------
  sendSnapshots() {
    for (const p of this.players.values()) {
      if (p.ws.readyState !== 1) continue;
      const visible = [];
      const seen = new Set();
      const metas = [];
      for (const e of this.nearby(p.x, p.z, C.AOI_RADIUS)) {
        seen.add(e.id);
        visible.push({
          id: e.id, kind: e.kind, x: e.x, z: e.z, dir: e.dir || 0,
          state: e.state || 0,
          hpPct: e.kind === C.KIND.DROP ? 0 : Math.max(0, Math.min(255, Math.round((e.hp / (e.kind === C.KIND.PLAYER ? e.eff.maxHp : e.maxHp)) * 100))),
          level: e.kind === C.KIND.PLAYER ? e.level : (e.kind === C.KIND.MOB ? e.def.level : 0),
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

  metaFor(e) {
    if (e.kind === C.KIND.PLAYER) {
      return { id: e.id, kind: e.kind, name: e.name, level: e.level, look: e.look };
    }
    if (e.kind === C.KIND.MOB) {
      return { id: e.id, kind: e.kind, defId: e.defId, name: e.def.name, level: e.def.level };
    }
    return { id: e.id, kind: e.kind, defId: e.defId, gold: e.gold || 0, q: e.item?.q || 0 };
  }
}
