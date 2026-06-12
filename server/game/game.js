// Boucle de jeu autoritative multi-zones : îles, Épreuves solo, PNJ, sorts, permadeath.
import * as C from '../../shared/constants.js';
import { ITEMS, MOBS, SLOTS, CHESTS, BANK_SIZE, chestPool } from '../../shared/defs.js';
import { generateWorld, generateTrial, SPAWN_ZONES, mulberry32 } from '../../shared/worldgen.js';
import { encodeSnapshot } from '../../shared/protocol.js';
import { makeItem, rollDrops, itemStats, itemLabel, itemPrice, itemWeight, inventoryWeight, setNextIid, zoneMult } from './items.js';
import { findPath, lineOfSight } from './pathfind.js';
import { content } from '../content.js';
import { applyOverrides } from '../../shared/overrides.js';
import { loadOverrides } from '../admin.js';
import * as db from '../db.js';
import { Player, Mob, NPC, Drop } from './entities.js';

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
      const world = applyOverrides(generateWorld(z.seed, z.map), loadOverrides(z.id));
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
    // une carte fixe (Arakas) définit ses propres spots ; sinon spots communs
    for (const zone of zi.world.spawnZones || SPAWN_ZONES) {
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
    const m = new Mob(this.nextId++, defId, def, sc, x, z, this.now(), noRespawn);
    zi.add(m);
    return m;
  }

  spawnNpc(zi) {
    // carte fixe : emplacements explicites (un marchand par ville sur Arakas)
    const spots = zi.world.npcSpots || (() => {
      const v = zi.world.village;
      let x = v.x - 4.5, z = v.z - 3.5, tries = 0;
      while (!zi.world.isWalkable(x, z) && tries++ < 30) { x += 0.7; }
      return [{ npcId: 'merchant', x, z }];
    })();
    for (const spot of spots) {
      const def = content.npc[spot.npcId] || content.npc.merchant;
      let { x, z } = spot, tries = 0;
      while (!zi.world.isWalkable(x, z) && tries++ < 30) { x += 0.7; }
      zi.add(new NPC(this.nextId++, spot.npcId, def, x, z));
    }
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
    const hpAcc = data.hpAcc ?? C.maxHp(data.stats, data.level);
    const manaAcc = data.manaAcc ?? C.maxMana(data.stats, data.level);

    const p = new Player(this.nextId++, ws, accountId, isAdmin, data, hpAcc, manaAcc);
    for (const it of p.inventory) setNextIid(it.iid + 1);
    for (const it of p.bank) setNextIid(it.iid + 1);

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
    p.recompute(this);
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
    if (!p.permadead) p.save();
    p.zi.players--;
    p.zi.remove(p);
    this.maybeDestroyTrial(p.zi);
    this.players.delete(p.id);
    this.broadcastChat('sys', `${p.name} quitte le monde.`);
    try { p.ws.close(1000, reason || 'bye'); } catch {}
  }

  saveAll() { for (const p of this.players.values()) p.save(); }

  sendZone(p) {
    const zi = p.zi;
    const def = zi.isTrial ? this.zoneDef(zi.trialTarget) : this.zoneDef(zi.zoneId);
    this.send(p, {
      t: 'zone',
      kind: zi.isTrial ? 'trial' : 'island',
      zoneId: zi.isTrial ? zi.trialTarget : zi.zoneId,
      name: zi.isTrial ? `L'Épreuve — vers ${def.name}` : def.name,
      seed: def.seed,
      map: zi.isTrial ? null : def.map || null,
      music: this.musicFor(zi),
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
    p.path = null; p.moveDir = null; p.attackTarget = null; p.pendingPickup = null; p.pendingInteract = null; p.pendingCast = null;
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
    p.save();
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
    p.save();
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
      dmg: p.eff.dmg, dmgMin: p.eff.dmgMin, dmgMax: p.eff.dmgMax,
      defense: Math.round(p.eff.defense * 100) / 100, gold: p.gold,
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

  // Musique de la zone (mapping administrable dans content/music.json).
  // Renvoie les deux variantes { legacy, new } : le client choisit selon
  // le pack sélectionné dans ses paramètres.
  musicFor(zi) {
    const s = zi.isTrial ? content.music?.trial : content.music?.zones?.[String(zi.zoneId)];
    return (s && (s.legacy || s.new)) ? s : null;
  }

  // Pousse la musique à jour à tous les joueurs connectés (après édition admin)
  refreshMusic() {
    for (const p of this.players.values()) {
      this.send(p, { t: 'music', file: this.musicFor(p.zi) });
    }
  }

  send(p, obj) { if (p.ws.readyState === 1) p.ws.send(JSON.stringify(obj)); }
  broadcastChat(from, text) {
    const msg = JSON.stringify({ t: 'chat', from, text });
    for (const p of this.players.values()) if (p.ws.readyState === 1) p.ws.send(msg);
  }
  sendLocalChat(sender, text) {
    const msg = JSON.stringify({ t: 'chat', from: sender.name, fromId: sender.id, text, kind: 'local' });
    for (const p of sender.zi.nearby(sender.x, sender.z, C.LOCAL_CHAT_DISTANCE_MAX)) {
      if (p.kind === C.KIND.PLAYER && p.ws && p.ws.readyState === 1) {
        if (Math.hypot(p.x - sender.x, p.z - sender.z) <= C.LOCAL_CHAT_DISTANCE_MAX) {
          p.ws.send(msg);
        }
      }
    }
  }
  broadcastChannelChat(channel, from, text) {
    const msg = JSON.stringify({ t: 'chat', from, text, channel });
    for (const p of this.players.values()) {
      if (p.ws.readyState === 1 && p.channels && p.channels.includes(channel)) {
        p.ws.send(msg);
      }
    }
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
        p.attackTarget = null; p.moveDir = null; p.pendingInteract = null; p.pendingCast = null;
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
        p.path = null; p.attackTarget = null; p.pendingPickup = null; p.pendingInteract = null; p.pendingCast = null;
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
        p.castSpell(msg, this);
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
      case 'bank_deposit': {
        if (p.dead) return;
        this.bankDeposit(p, msg);
        break;
      }
      case 'bank_withdraw': {
        if (p.dead) return;
        this.bankWithdraw(p, msg);
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
        // prérequis de stats T4C (For/End/Agi/Int/Sag) pour porter l'objet
        if (def.req) {
          const names = { str: 'Force', end: 'Endurance', agi: 'Agilité', int: 'Intelligence', wis: 'Sagesse' };
          for (const [st, v] of Object.entries(def.req)) {
            if ((p.eff.stats[st] || 0) < v) {
              this.send(p, { t: 'info', text: `${def.name} : ${v} de ${names[st] || st} requis (vous : ${p.eff.stats[st] || 0}).` });
              return;
            }
          }
        }
        // deux anneaux : remplit le premier emplacement libre
        let target = slot;
        if (slot === 'ring' && p.equip.ring && p.equip.ring !== item.iid && !p.equip.ring2) target = 'ring2';
        p.equip[target] = item.iid;
        p.recompute(this); this.sendSelf(p);
        break;
      }
      case 'unequip': {
        if (p.equip[msg.slot]) { delete p.equip[msg.slot]; p.recompute(this); this.sendSelf(p); }
        break;
      }
      case 'drop': {
        if (p.dead) return;
        this.dropItem(p, msg);
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
          p.recompute(this); this.sendSelf(p);
        }
        break;
      }
      case 'chat': {
        const now = Date.now();
        if (now - p.lastChat < 800) {
          // anti-spam : prévenir plutôt qu'avaler silencieusement le message
          this.send(p, { t: 'info', text: 'Doucement... votre message n\'a pas été envoyé.' });
          return;
        }
        p.lastChat = now;
        const rawText = String(msg.text || '').slice(0, C.CHAT_MAX).trim();
        if (!rawText) return;

        // Vérifier si c'est un message de canal public (ex: /general message)
        const channelMatch = rawText.match(/^\/(\w+)\s+(.+)$/);
        if (channelMatch) {
          const channel = channelMatch[1].toLowerCase();
          const text = channelMatch[2].trim();
          
          const validChannels = ['general', 'aide', 'ventes', 'roleplay'];
          if (validChannels.includes(channel)) {
            this.broadcastChannelChat(channel, p.name, text);
          } else {
            this.send(p, { t: 'info', text: `Canal /${channel} inconnu. Utilise: /general, /aide, /ventes, ou /roleplay.` });
          }
        } else {
          // Chat local par défaut : envoie aux joueurs proches + bulle au-dessus de la tête
          this.sendLocalChat(p, rawText);
          this.eventNear(p, { t: 'say', id: p.id, text: rawText });
        }
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
        p.recompute(this);
        p.hp = p.eff.maxHp; p.mana = p.eff.maxMana;
        this.sendSelf(p);
        break;
      }
      case 'stats': {
        for (const st of C.STATS) {
          if (Number.isFinite(+msg[st])) p.stats[st] = Math.max(1, msg[st] | 0);
        }
        p.recompute(this);
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
    } else if (prop.type === 'bank') {
      this.openBank(p);
    } else if (prop.type === 'cave') {
      this.send(p, {
        t: 'info',
        text: `${prop.name || 'La grotte'} : l'entrée est obstruée par des éboulis... (les souterrains arrivent dans une prochaine version)`,
      });
    }
  }

  // ---------- Banque personnelle ----------
  // Coffre instancié par personnage (p.bank, stocké dans data) : inviolable par
  // construction — aucun message ne permet de viser la banque d'un autre joueur.
  // Les objets déposés ne comptent PAS dans l'encombrement (tout l'intérêt).
  // À la mort définitive, la banque est perdue avec le personnage (roguelike).
  nearBankProp(p) {
    return (p.zi.world.props || []).find(pr =>
      pr.type === 'bank' && Math.hypot(pr.x - p.x, pr.z - p.z) <= C.INTERACT_RANGE);
  }

  openBank(p) {
    this.send(p, {
      t: 'bank_open',
      max: BANK_SIZE,
      items: p.bank.map(it => ({
        ...it, label: itemLabel(it), slot: ITEMS[it.defId].slot, weight: itemWeight(it),
      })),
    });
  }

  bankDeposit(p, msg) {
    if (!this.nearBankProp(p)) { this.send(p, { t: 'info', text: 'Approchez-vous de votre coffre.' }); return; }
    const i = p.inventory.findIndex(it => it.iid === (msg.iid | 0));
    if (i < 0) return;
    if (p.bank.length >= BANK_SIZE) { this.send(p, { t: 'info', text: 'Votre coffre est plein.' }); return; }
    const item = p.inventory[i];
    // déséquipe si nécessaire (comme la vente)
    for (const [slot, iid] of Object.entries(p.equip)) {
      if (iid === item.iid) delete p.equip[slot];
    }
    p.inventory.splice(i, 1);
    p.bank.push(item);
    p.recompute(this);
    this.openBank(p);
    this.sendSelf(p);
  }

  bankWithdraw(p, msg) {
    if (!this.nearBankProp(p)) { this.send(p, { t: 'info', text: 'Approchez-vous de votre coffre.' }); return; }
    const i = p.bank.findIndex(it => it.iid === (msg.iid | 0));
    if (i < 0) return;
    if (p.inventory.length >= 24) { this.send(p, { t: 'info', text: 'Inventaire plein.' }); return; }
    const item = p.bank[i];
    // encombrement T4C : mêmes règles qu'au ramassage
    const w = inventoryWeight(p.inventory) + itemWeight(item);
    if (w > p.eff.capacity) {
      this.send(p, { t: 'info', text: `Trop lourd ! (${w.toFixed(1)} / ${p.eff.capacity} — montez la Force ou délestez-vous)` });
      return;
    }
    p.bank.splice(i, 1);
    p.inventory.push(item);
    this.openBank(p);
    this.sendSelf(p);
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
    const reqNames = { str: 'For', end: 'End', agi: 'Agi', int: 'Int', wis: 'Sag' };
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
      .map(s => ({
        ...s,
        learnCost: Math.round(s.learnCost * disc),
        trainCost: Math.round(s.trainCost * disc) || s.trainCost,
        known: s.innate || p.skills[s.id] != null,
        pts: p.skills[s.id] || 0,
        reqMet: this.skillReqMet(p, s) === true,
        reqText: this.skillReqText(s),
      }));
    const npcDef = content.npc[npc.npcId] || content.npc.merchant;
    const line = npcDef.greetings[Math.floor(Math.random() * npcDef.greetings.length)];
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
      // apprentissage d'une compétence (puis entraînement via 'train')
      const sk = content.skillById[msg.id];
      if (!sk || sk.zone > zid || sk.innate || p.skills[sk.id] != null) return;
      const req = this.skillReqMet(p, sk);
      if (req !== true) { this.send(p, { t: 'info', text: req }); return; }
      const price = Math.round(sk.learnCost * disc);
      if (p.gold < price) { this.send(p, { t: 'info', text: 'Or insuffisant.' }); return; }
      p.gold -= price;
      p.skills[sk.id] = 1;
    p.recompute(this);
      this.send(p, { t: 'loot', text: `Compétence apprise : ${sk.name}` });
    } else if (msg.kind === 'train') {
      // entraînement : +1 point, payé en or (système T4C)
      const sk = content.skillById[msg.id];
      if (!sk || sk.zone > zid) return;
      const cur = p.skills[sk.id] ?? (sk.innate ? 0 : null);
      if (cur == null) { this.send(p, { t: 'info', text: 'Apprenez d\'abord cette compétence.' }); return; }
      if (cur >= sk.max) { this.send(p, { t: 'info', text: 'Compétence au maximum.' }); return; }
      const req = this.skillReqMet(p, sk);
      if (req !== true) { this.send(p, { t: 'info', text: req }); return; }
      const price = Math.max(1, Math.round(sk.trainCost * disc));
      if (p.gold < price) { this.send(p, { t: 'info', text: 'Or insuffisant.' }); return; }
      p.gold -= price;
      p.skills[sk.id] = cur + 1;
    p.recompute(this);
    }
    this.sendSelf(p);
  }

  skillReqText(sk) {
    const names = { str: 'For', end: 'End', agi: 'Agi', int: 'Int', wis: 'Sag' };
    const parts = [];
    if (sk.level > 1) parts.push(`niv. ${sk.level}`);
    for (const [st, v] of Object.entries(sk.req || {})) parts.push(`${names[st] || st} ${v}`);
    return parts.join(', ') || '—';
  }

  skillReqMet(p, sk) {
    if (sk.level && p.level < sk.level) return `Niveau ${sk.level} requis.`;
    const names = { str: 'Force', end: 'Endurance', agi: 'Agilité', int: 'Intelligence', wis: 'Sagesse' };
    for (const [st, v] of Object.entries(sk.req || {})) {
      if ((p.eff.stats[st] || 0) < v) return `${v} de ${names[st] || st} requis (vous : ${p.eff.stats[st] || 0}).`;
    }
    return true;
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
    p.recompute(this);
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

  // Hors mode combat : marche jusqu'à la portée du sort, puis le lance
  startApproachCast(p, msg, tx, tz) {
    p.pendingCast = { ...msg, approach: false }; // une seule approche, pas de boucle
    p.path = findPath(p.zi.world, p.x, p.z, tx, tz);
    p.moveDir = null;
    p.attackTarget = null;
  }

  // Résistances élémentaires T4C : réduction (ou amplification si faiblesse)
  applyResist(target, sp, dmg) {
    const resist = target.def?.resist?.[sp.element] || 0;
    if (!resist) return { dmg, mod: null };
    return {
      dmg: Math.max(1, Math.round(dmg * (1 - resist))),
      mod: resist > 0.05 ? 'resist' : (resist < -0.05 ? 'weak' : null),
    };
  }


  killMob(m, killer) {
    m.dead = true; m.state = C.ST.DEAD; m.hp = 0; m.target = null; m.path = null;
    m.hideAt = this.now() + 6;
    m.respawnAt = m.noRespawn ? Infinity : this.now() + m.def.respawn;
    if (killer.kind === C.KIND.PLAYER) {
      const xp = C.mobXpReward(m.level, killer.level);
      killer.addXp(xp, this);
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
    return Player.buildCharacter(this.island(0).world.spawnPoint, name, stats, sex);
  }

  reincarnate(p, stats = null, sex = null) {
    p.reincarnate(this, stats, sex);
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

  spawnDrop(zi, x, z, payload, ttl = C.ITEM_DESPAWN) {
    for (let tries = 0; tries < 8; tries++) {
      const dx = (Math.random() - 0.5) * 2, dz = (Math.random() - 0.5) * 2;
      if (zi.world.isWalkable(x + dx, z + dz)) { x += dx; z += dz; break; }
    }
    const d = new Drop(
      this.nextId++,
      payload.gold ? 'or' : payload.item.defId,
      payload.gold || 0,
      payload.item || null,
      x, z,
      this.now() + ttl
    );
    zi.add(d);
  }

  // Pose au sol — c'est ainsi que s'échangent objets et or entre joueurs
  // (fidèle à T4C) : l'un pose, l'autre ramasse. L'objet reste visible par
  // tous et disparaît au bout de PLAYER_DROP_DESPAWN secondes.
  dropItem(p, msg) {
    if (msg.gold != null) {
      const amount = Math.min(p.gold, Math.max(0, msg.gold | 0));
      if (!amount) return;
      p.gold -= amount;
      this.spawnDrop(p.zi, p.x, p.z, { gold: amount }, C.PLAYER_DROP_DESPAWN);
      this.send(p, { t: 'loot', text: `Posé au sol : ${amount} or` });
      this.sendSelf(p);
      return;
    }
    const i = p.inventory.findIndex(it => it.iid === (msg.iid | 0));
    if (i < 0) return;
    const item = p.inventory[i];
    // déséquipe si nécessaire
    for (const [slot, iid] of Object.entries(p.equip)) {
      if (iid === item.iid) delete p.equip[slot];
    }
    p.inventory.splice(i, 1);
    this.spawnDrop(p.zi, p.x, p.z, { item }, C.PLAYER_DROP_DESPAWN);
    p.recompute(this);
    this.send(p, { t: 'loot', text: `Posé au sol : ${itemLabel(item)}` });
    this.sendSelf(p);
  }

  // ---------- Boucle ----------
  tick() {
    this.tickCount++;
    const dt = C.TICK_DT;
    this.worldTime = (this.worldTime + dt) % C.DAY_LENGTH;
    const now = this.now();

    for (const p of this.players.values()) {
      p.tick(this, now, dt);
    }

    // Monstres et objets au sol, zone par zone
    for (const zi of this.zones.values()) {
      const hasPlayers = zi.players > 0;
      for (const e of [...zi.entities.values()]) {
        if (e.kind === C.KIND.MOB) {
          if (hasPlayers || e.dead) e.tick(this, zi, now, dt);
        } else if (e.kind === C.KIND.DROP && now > e.expiresAt) {
          zi.remove(e);
        }
      }
    }

    this.sendSnapshots();
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
