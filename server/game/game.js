// Boucle de jeu autoritative multi-zones : îles, Épreuves solo, PNJ, sorts, permadeath.
import * as C from '../../shared/constants.js';
import { ITEMS, MOBS, SLOTS, CHESTS, BANK_SIZE, chestPool } from '../../shared/defs.js';
import { generateWorld, generateTrial, SPAWN_ZONES, mulberry32 } from '../../shared/worldgen.js';
import { generateCave, CAVES, CAVE_LEVEL_BONUS } from '../../shared/cave.js';
import { encodeSnapshot } from '../../shared/protocol.js';
import { makeItem, rollDrops, itemStats, itemLabel, itemPrice, itemWeight, inventoryWeight, setNextIid, zoneMult } from './items.js';
import { findPath, lineOfSight } from './pathfind.js';
import { content } from '../content.js';
import { applyOverrides } from '../../shared/overrides.js';
import { loadOverrides } from '../admin.js';
import * as db from '../db.js';

const CELL = 16;
// voile sombre des cavernes (la pénombre elle-même est rendue côté client)
const CAVE_TINT = 'rgba(18, 14, 34, 0.22)';

// Intervalle entre deux apparitions de monstres dans une zone « chaude »
// (env T4C_SPAWN_MS ; les suites de test l'abaissent à ~250 ms)
const SPAWN_INTERVAL_MS = Math.max(50,
  parseInt(process.env.T4C_SPAWN_MS, 10) || C.SPAWN_INTERVAL_DEFAULT_MS);
const SPAWN_TRIES_PER_TICK = 12;  // essais de placement avant d'abandonner le tick
const XP_NOTIFY_EVERY_TICKS = 5;  // flotteurs d'XP regroupés (2 envois/s au plus)
const PARTY_VITALS_EVERY_TICKS = 10; // PV des membres du groupe : 1 envoi/s

// Première case praticable en spirale autour de (x, z) — pour déposer un
// joueur au pied d'un prop bloquant (obélisque...) sans l'enfermer dedans.
function walkableNear(world, x, z, maxR = 4) {
  for (let r = 0; r <= maxR; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue; // anneau seulement
        if (world.isWalkable(x + dx, z + dz)) return { x: x + dx, z: z + dz };
      }
    }
  }
  return { x: world.spawnPoint.x, z: world.spawnPoint.z };
}

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
    // spawn par le mouvement : camps (budgets de population) + « chaleur »
    this.camps = [];
    this.hotUntil = 0;       // la zone est chaude tant que now <= hotUntil
    this.nextSpawnAt = 0;    // prochain tick de spawn autorisé
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
  // Spawn T4C déclenché par le MOUVEMENT : les zones démarrent VIDES de
  // monstres. Les camps historiques (composition de l'ancien populateIsland)
  // deviennent des BUDGETS : tant qu'un camp est sous sa capacité et qu'un
  // joueur bouge dans la zone, le tick de spawn peut y faire apparaître un
  // monstre — toujours hors champ (à SPAWN_MIN_PLAYER_DIST de tout joueur).
  populateIsland(zi) {
    const base = this.zoneDef(zi.zoneId).levels[0] - 1;
    // une carte fixe (Arakas) définit ses propres camps ; sinon camps communs
    zi.camps = (zi.world.spawnZones || SPAWN_ZONES).map(zone => ({
      x: zone.center[0] + 0.5, z: zone.center[1] + 0.5,
      radius: zone.radius,
      defIds: [zone.mob],   // composition du camp
      cap: zone.count,      // population maximale
      alive: 0,             // population actuelle (décomptée à la mort)
      base,                 // niveau de base de la zone (scaling)
    }));
    this.spawnNpc(zi);
  }

  // un joueur a réellement bougé : la zone devient « chaude » quelques secondes
  heatZone(zi) {
    zi.hotUntil = this.now() + C.SPAWN_HEAT_DURATION;
  }

  // Tick de spawn : zone chaude ET population sous la capacité d'un camp ->
  // UN monstre apparaît, jamais plus (progressif). Placement : un point du
  // camp, praticable, à au moins SPAWN_MIN_PLAYER_DIST tuiles de TOUT joueur
  // de la zone (le monstre surgit devant celui qui marche, jamais sous ses
  // yeux). Aucun point valide -> le tick est sauté.
  maybeSpawn(zi, now) {
    if (!zi.camps.length || now > zi.hotUntil || now < zi.nextSpawnAt) return;
    zi.nextSpawnAt = now + SPAWN_INTERVAL_MS / 1000;
    const open = zi.camps.filter(c => c.alive < c.cap);
    if (!open.length) return;
    const minDist = zi.isCave ? C.SPAWN_MIN_PLAYER_DIST_CAVE : C.SPAWN_MIN_PLAYER_DIST;
    const players = [];
    for (const p of this.players.values()) {
      if (p.zi === zi && !p.dead) players.push(p);
    }
    for (let attempt = 0; attempt < SPAWN_TRIES_PER_TICK; attempt++) {
      const camp = open[Math.floor(Math.random() * open.length)];
      const a = Math.random() * Math.PI * 2, d = Math.random() * camp.radius;
      const x = camp.x + Math.cos(a) * d, z = camp.z + Math.sin(a) * d;
      if (!zi.world.isWalkable(x, z)) continue;
      if (players.some(p => Math.hypot(p.x - x, p.z - z) < minDist)) continue;
      const defId = camp.defIds[Math.floor(Math.random() * camp.defIds.length)];
      const m = this.spawnMob(zi, defId, x, z, camp.base);
      m.camp = camp;
      camp.alive++;
      return;
    }
  }

  spawnMob(zi, defId, x, z, zoneBase) {
    const def = MOBS[defId];
    const sc = C.scaleMob(def, zoneBase);
    const m = {
      id: this.nextId++, kind: C.KIND.MOB, defId, def, sc,
      level: sc.level,
      x, z, dir: 0, state: C.ST.IDLE,
      hp: sc.hp, maxHp: sc.hp,
      home: { x, z }, target: null, atkCd: 0, path: null,
      wanderAt: this.now() + 2 + Math.random() * 6,
      dead: false, hidden: false, hideAt: 0, camp: null,
    };
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
      zi.add({
        id: this.nextId++, kind: C.KIND.NPC, npcId: spot.npcId,
        name: def.name,
        look: def.look,
        x, z, dir: Math.PI, state: C.ST.IDLE, level: 0,
        hp: 1, dead: false, hidden: false,
      });
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
    const p = {
      id: this.nextId++, kind: C.KIND.PLAYER, ws, accountId, isAdmin: !!isAdmin,
      name: data.name, sex: data.sex || 'male',
      level: data.level, xp: data.xp, statPoints: data.statPoints,
      stats: data.stats, gold: data.gold,
      inventory: data.inventory || [], equip: data.equip || {},
      bank: data.bank ?? [], // coffre personnel (migration : anciens personnages sans banque)
      spells: data.spells || [],
      // migration : l'ancien format (tableau d'ids) est abandonné -> {id: points}
      skills: (data.skills && !Array.isArray(data.skills)) ? data.skills : {},
      unlocked: data.unlocked || [0],
      x: data.x, z: data.z, dir: 0, state: C.ST.IDLE,
      path: null, moveDir: null, attackTarget: null, atkCd: 0, lastCombat: -99,
      spellCds: {}, buffs: [],
      hp: 1, mana: 1, dead: false, hidden: false,
      party: null, partyInvite: null, xpNotify: 0,
      known: new Set(), events: [], lastChat: 0,
      channels: ['general', 'aide', 'ventes', 'roleplay'], // Abonnés par défaut
      pendingPickup: null, pendingInteract: null, trialOffer: null, obeliskUntil: 0,
    };
    for (const it of p.inventory) setNextIid(it.iid + 1);
    for (const it of p.bank) setNextIid(it.iid + 1);
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
    this.leaveParty(p); // la déconnexion fait quitter le groupe
    p.zi.players--;
    p.zi.remove(p);
    this.maybeDestroyTrial(p.zi);
    this.players.delete(p.id);
    this.broadcastChat('sys', `${p.name} quitte le monde.`);
    try { p.ws.close(1000, reason || 'bye'); } catch {}
  }

  savePlayer(p) {
    if (p.permadead) return;
    // en caverne, on sauvegarde le point de retour à la surface : les
    // coordonnées de la grotte n'auraient aucun sens sur la carte de l'île
    const pos = p.zi.isCave ? p.zi.returnTo : p;
    db.saveCharacter(p.accountId, {
      name: p.name, level: p.level, xp: p.xp, statPoints: p.statPoints,
      stats: p.stats, hp: p.hp, mana: p.mana, x: pos.x, z: pos.z,
      gold: p.gold, inventory: p.inventory, equip: p.equip,
      bank: p.bank,
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
    if (zi.isCave) {
      // caverne : le client régénère le même intérieur avec ces paramètres
      const { seed, size, depth } = zi.caveDef;
      this.send(p, {
        t: 'zone',
        kind: 'cave',
        zoneId: zi.zoneId,
        name: zi.caveName,
        cave: { seed, size, depth },
        music: this.musicFor(zi),
        tint: CAVE_TINT,
        levels: null,
        x: p.x, z: p.z,
        unlocked: p.unlocked,
      });
      p.known = new Set();
      return;
    }
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
    this.heatZone(zi); // l'arrivée d'un joueur compte comme un mouvement
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
      const m = this.spawnMob(zi, defId, spot.x, spot.z, base);
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

  // ---------- Cavernes (intérieurs instanciés, PARTAGÉS entre joueurs) ----------
  // Contrairement à l'Épreuve (instance personnelle), chaque grotte n'a qu'UNE
  // instance : créée au premier visiteur puis conservée — les joueurs s'y
  // croisent, les monstres y réapparaissent normalement. Ni obélisque ni
  // banque à l'intérieur : la seule issue est la sortie (ou la mort, définitive).
  getCaveZone(prop, from) {
    const def = CAVES[prop.caveId];
    if (!def) return null;
    const key = `cave:${prop.caveId}`;
    let zi = this.zones.get(key);
    if (zi) return zi;
    zi = new ZoneInstance(key, generateCave(def.seed, def.size, def.depth), from.zoneId);
    zi.isCave = true;
    zi.caveDef = def;
    zi.caveName = prop.name;
    zi.returnTo = this.surfaceExit(from, prop);
    this.zones.set(key, zi);
    this.populateCave(zi, def);
    return zi;
  }

  // case praticable devant l'entrée de la grotte : le point de retour à la surface
  surfaceExit(zi, prop) {
    for (const [dx, dz] of [[0, 1], [1, 0], [-1, 0], [0, 2], [1, 1], [-1, 1], [0, -1]]) {
      if (zi.world.isWalkable(prop.x + dx, prop.z + dz)) {
        return { zoneId: zi.zoneId, x: prop.x + dx, z: prop.z + dz };
      }
    }
    return { zoneId: zi.zoneId, x: zi.world.spawnPoint.x, z: zi.world.spawnPoint.z };
  }

  populateCave(zi, def) {
    // Comme en surface : la grotte démarre VIDE, les monstres apparaissent au
    // rythme des déplacements. Chaque spot de monstre devient un camp de
    // capacité 1, peuplé par le thème de la grotte (un peu plus coriace que
    // la surface : CAVE_LEVEL_BONUS).
    const base = this.zoneDef(zi.zoneId).levels[0] - 1 + CAVE_LEVEL_BONUS;
    zi.camps = zi.world.mobSpots.map(spot => ({
      x: spot.x, z: spot.z, radius: 2,
      defIds: def.mobs, cap: 1, alive: 0, base,
    }));
  }

  enterCave(p, prop) {
    const zi = this.getCaveZone(prop, p.zi);
    if (!zi) {
      // grotte sans intérieur défini : l'entrée reste condamnée (contenu à venir)
      this.send(p, { t: 'info', text: `${prop.name || 'La grotte'} : l'entrée est obstruée par des éboulis...` });
      return;
    }
    this.movePlayerToZone(p, zi, zi.world.spawnPoint.x, zi.world.spawnPoint.z);
    this.savePlayer(p);
    this.send(p, { t: 'info', text: `Vous pénétrez dans ${zi.caveName}. L'obscurité vous enveloppe...` });
  }

  leaveCave(p) {
    const back = p.zi.returnTo;
    this.movePlayerToZone(p, this.island(back.zoneId), back.x, back.z);
    this.savePlayer(p);
  }

  // ---------- Stats effectives ----------
  recompute(p) {
    const stats = { ...p.stats };
    let wMin = 0, wMax = 0, weaponSpeed = null, defense = 0, dodgeMalus = 0;
    let wRanged = false, wRange = 0, attBonus = 0;
    for (const slot of SLOTS) {
      const iid = p.equip[slot];
      if (!iid) continue;
      const item = p.inventory.find(i => i.iid === iid);
      if (!item) { delete p.equip[slot]; continue; }
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
    for (const [id, pts] of Object.entries(p.skills)) {
      const sk = content.skillById[id];
      if (!sk || !pts) continue;
      for (const [k, v] of Object.entries(sk.effect)) fx[k] = (fx[k] || 0) + v * pts;
    }
    // un bouclier équipé améliore la parade de moitié (T4C)
    if (p.equip.shield) fx.parry *= 1.5;
    // bonus d'Attaque d'objets (+50 Att = +5 % de toucher en mêlée, comme la compétence)
    fx.hit += attBonus * 0.001;
    // le malus d'esquive de l'armure ronge la compétence Esquive (T4C)
    fx.dodge = Math.max(0, fx.dodge - dodgeMalus * 0.001);
    // buffs temporaires (valeurs calculées au lancement, façon T4C)
    let buffDef = 0, buffSpeed = 0, buffDmgMul = 0, buffRegen = 0, buffMaxHp = 0;
    for (const b of p.buffs) {
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
      // arc équipé : portée de l'arme (tuiles), sinon mêlée
      atkRange: wRanged ? Math.max(1.8, wRange || 8) : 1.8,
      ranged: wRanged,
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
      legs: layerOf('legs'), hands: layerOf('gloves'),
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
    // les cavernes partagent l'ambiance oppressante de l'Épreuve
    const s = (zi.isTrial || zi.isCave) ? content.music?.trial : content.music?.zones?.[String(zi.zoneId)];
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
        if (this.isPacified(p)) {
          this.send(p, { t: 'info', text: 'La transe du Sanctuaire vous empêche d\'attaquer.' });
          return;
        }
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
        if (p.dead || p.zi.isTrial || p.zi.isCave) return; // pas d'obélisque sous terre
        const zid = msg.zoneId | 0;
        if (!p.unlocked.includes(zid) || !this.island(zid)) return;
        if (this.now() > p.obeliskUntil) { this.send(p, { t: 'info', text: 'Approchez-vous de l\'obélisque.' }); return; }
        const dest = this.island(zid);
        this.movePlayerToZone(p, dest, dest.world.spawnPoint.x, dest.world.spawnPoint.z);
        break;
      }
      case 'teleport_local': {
        // voyage entre obélisques de la MÊME zone : 10 po, accès déjà acquis
        if (p.dead || p.zi.isTrial || p.zi.isCave) return;
        if (this.now() > p.obeliskUntil) { this.send(p, { t: 'info', text: 'Approchez-vous de l\'obélisque.' }); return; }
        const dest = this.zoneObelisks(p.zi).find(o => o.i === (msg.i | 0));
        if (!dest || Math.hypot(dest.x - p.x, dest.z - p.z) <= C.INTERACT_RANGE) return;
        if (p.gold < C.OBELISK_TRAVEL_COST) {
          this.send(p, { t: 'info', text: `Il vous faut ${C.OBELISK_TRAVEL_COST} pièces d'or pour ce voyage.` });
          return;
        }
        p.gold -= C.OBELISK_TRAVEL_COST;
        const spot = walkableNear(p.zi.world, dest.x, dest.z + 1.5);
        p.x = spot.x; p.z = spot.z;
        p.path = null; p.moveDir = null; p.attackTarget = null; p.pendingCast = null;
        p.zi.gridMove(p);
        this.heatZone(p.zi); // le voyage local est un déplacement réel
        p.obeliskUntil = this.now() + 30; // on arrive au pied d'un obélisque : panneau réutilisable
        this.send(p, { t: 'info', text: `L'obélisque vous transporte : ${dest.name} (−${C.OBELISK_TRAVEL_COST} or).` });
        this.sendSelf(p);
        break;
      }
      case 'trial_enter': {
        if (p.dead || p.zi.isTrial || p.zi.isCave) return;
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
        this.recompute(p); this.sendSelf(p);
        break;
      }
      case 'unequip': {
        if (p.equip[msg.slot]) { delete p.equip[msg.slot]; this.recompute(p); this.sendSelf(p); }
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
        // Malédiction : les potions de vie n'ont plus aucun effet (non consommées)
        if (st.heal && this.isCursed(p)) {
          this.send(p, { t: 'info', text: 'Une malédiction pèse sur vous : la potion reste sans effet.' });
          return;
        }
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

          // commande de groupe : /inviter Nom
          if (channel === 'inviter') {
            this.partyInvite(p, { name: text });
            return;
          }
          const validChannels = ['general', 'aide', 'ventes', 'roleplay'];
          if (validChannels.includes(channel)) {
            this.broadcastChannelChat(channel, p.name, text);
          } else {
            this.send(p, { t: 'info', text: `Canal /${channel} inconnu. Utilise: /general, /aide, /ventes, /roleplay — ou /inviter Nom (groupe).` });
          }
        } else {
          // Chat local par défaut : envoie aux joueurs proches + bulle au-dessus de la tête
          this.sendLocalChat(p, rawText);
          this.eventNear(p, { t: 'say', id: p.id, text: rawText });
        }
        break;
      }
      case 'party_invite': {
        if (p.dead) return;
        this.partyInvite(p, msg);
        break;
      }
      case 'party_accept': {
        if (p.dead) return;
        this.partyAccept(p);
        break;
      }
      case 'party_decline': {
        this.partyDecline(p);
        break;
      }
      case 'party_leave': {
        if (!p.party) return;
        this.broadcastToParty(p.party, `${p.name} quitte le groupe.`, p);
        this.leaveParty(p);
        break;
      }
      case 'party_kick': {
        this.partyKick(p, msg);
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
        this.heatZone(p.zi); // la téléportation admin est un déplacement réel
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
      case 'learn': {
        // apprend un sort directement (outillage admin/tests, sans marchand)
        const sp = content.spellById[msg.spell];
        if (sp && !p.spells.includes(sp.id)) { p.spells.push(sp.id); this.sendSelf(p); }
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

  // Les obélisques d'une zone forment un réseau de voyage local : on peut
  // rejoindre n'importe lequel des autres pour OBELISK_TRAVEL_COST pièces d'or
  // (l'accès à la zone suffit — c'est le réseau d'Arakas demandé par Quentin).
  zoneObelisks(zi) {
    return zi.world.props
      .filter(pr => pr.type === 'obelisk')
      .map((pr, i) => ({ i, name: pr.name || `Obélisque ${i + 1}`, x: pr.x, z: pr.z }));
  }

  interactProp(p, prop) {
    if (prop.type === 'obelisk') {
      p.obeliskUntil = this.now() + 30;
      this.send(p, {
        t: 'obelisk',
        zones: p.unlocked.map(id => ({ id, name: this.zoneDef(id).name, levels: this.zoneDef(id).levels }))
          .sort((a, b) => a.id - b.id),
        current: p.zi.zoneId,
        // réseau local : les autres obélisques de la zone (celui-ci exclu)
        local: this.zoneObelisks(p.zi)
          .filter(o => Math.hypot(o.x - prop.x, o.z - prop.z) > 1)
          .map(({ i, name }) => ({ i, name })),
        cost: C.OBELISK_TRAVEL_COST,
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
    } else if (prop.type === 'exitgate' && p.zi.isCave) {
      this.leaveCave(p);
    } else if (prop.type === 'chest') {
      this.openChest(p, prop);
    } else if (prop.type === 'bank') {
      this.openBank(p);
    } else if (prop.type === 'cave') {
      this.enterCave(p, prop);
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
    this.recompute(p);
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

  // ---------- Marchands et enseignants ----------
  // premier PNJ à portée d'interaction qui passe le filtre
  nearbyNpc(p, accepts = () => true) {
    for (const e of p.zi.nearby(p.x, p.z, C.INTERACT_RANGE + 1)) {
      if (e.kind === C.KIND.NPC && accepts(e)) return e;
    }
    return null;
  }

  // marchand généraliste (objets, compétences, rachat) — pas un enseignant
  nearbyMerchant(p) {
    return this.nearbyNpc(p, n => !this.isTeacher(n));
  }

  isTeacher(npc) {
    return !!(content.npc[npc.npcId]?.teacher);
  }

  // Qui enseigne quoi : un sort avec `vendor` n'est vendu QUE par ce PNJ ;
  // les autres sorts restent vendus par les marchands généralistes de leur zone.
  npcSellsSpell(p, npc, sp) {
    if (sp.todo) return false;
    if (sp.vendor) return sp.vendor === npc.npcId;
    return !this.isTeacher(npc) && sp.zone <= p.zi.zoneId;
  }

  openShop(p, npc) {
    const zid = p.zi.zoneId;
    const disc = 1 - (p.skillFx?.discount || 0);
    const reqNames = { str: 'For', end: 'End', agi: 'Agi', int: 'Int', wis: 'Sag' };
    // un enseignant ne tient pas d'étal : ni objets ni compétences, ses sorts seulement
    const teacher = this.isTeacher(npc);
    const items = teacher ? [] : Object.entries(ITEMS)
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
    // les sorts "todo" (mécanique non implémentée) ne sont pas proposés à la vente
    const spells = content.spells.filter(s => this.npcSellsSpell(p, npc, s))
      .map(s => ({
        ...s,
        price: Math.round(s.price * disc),
        known: p.spells.includes(s.id),
        reqMet: this.spellReqMet(p, s) === true,
        reqText: this.spellReqText(s),
      }));
    const skills = (teacher ? [] : content.skills.filter(s => s.zone <= zid))
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
    // vérifie qu'un PNJ capable de vendre est à proximité : un marchand
    // généraliste pour les objets et compétences ; pour un sort, le PNJ doit
    // l'avoir à son répertoire (enseignant attitré ou marchand de la zone)
    if (!this.nearbyNpc(p)) { this.send(p, { t: 'info', text: 'Aucun marchand à proximité.' }); return; }
    const needMerchant = () => {
      if (this.nearbyMerchant(p)) return true;
      this.send(p, { t: 'info', text: 'Ce maître n\'est pas marchand. Voyez un marchand généraliste.' });
      return false;
    };
    const zid = p.zi.zoneId;
    const disc = 1 - (p.skillFx?.discount || 0);

    if (msg.kind === 'item') {
      if (!needMerchant()) return;
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
      if (!sp || sp.todo || sp.zone > zid || p.spells.includes(sp.id)) return;
      if (!this.nearbyNpc(p, n => this.npcSellsSpell(p, n, sp))) {
        this.send(p, { t: 'info', text: 'Personne ici ne peut vous enseigner ce sort.' });
        return;
      }
      const req = this.spellReqMet(p, sp);
      if (req !== true) { this.send(p, { t: 'info', text: req }); return; }
      const price = Math.round(sp.price * disc);
      if (p.gold < price) { this.send(p, { t: 'info', text: 'Or insuffisant.' }); return; }
      p.gold -= price;
      p.spells.push(sp.id);
      this.send(p, { t: 'loot', text: `Sort appris : ${sp.name}` });
    } else if (msg.kind === 'skill') {
      // apprentissage d'une compétence (puis entraînement via 'train')
      if (!needMerchant()) return;
      const sk = content.skillById[msg.id];
      if (!sk || sk.zone > zid || sk.innate || p.skills[sk.id] != null) return;
      const req = this.skillReqMet(p, sk);
      if (req !== true) { this.send(p, { t: 'info', text: req }); return; }
      const price = Math.round(sk.learnCost * disc);
      if (p.gold < price) { this.send(p, { t: 'info', text: 'Or insuffisant.' }); return; }
      p.gold -= price;
      p.skills[sk.id] = 1;
      this.recompute(p);
      this.send(p, { t: 'loot', text: `Compétence apprise : ${sk.name}` });
    } else if (msg.kind === 'train') {
      // entraînement : +1 point, payé en or (système T4C)
      if (!needMerchant()) return;
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
      this.recompute(p);
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

  // Vente au marchand : même prix que l'achat (qualité et zone de l'objet
  // comprises). Les enseignants, eux, n'achètent rien.
  sell(p, msg) {
    if (!this.nearbyMerchant(p)) { this.send(p, { t: 'info', text: 'Aucun marchand à proximité.' }); return; }
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

  // Prérequis T4C d'un sort : niveau, Sagesse, Intelligence, sort(s) précédent(s).
  // Retourne true, ou le message expliquant ce qui manque.
  spellReqMet(p, sp) {
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

  spellReqText(sp) {
    const parts = [];
    if (sp.level) parts.push(`niv. ${sp.level}`);
    if (sp.wis) parts.push(`Sag ${sp.wis}`);
    if (sp.int) parts.push(`Int ${sp.int}`);
    for (const req of (Array.isArray(sp.requires) ? sp.requires : sp.requires ? [sp.requires] : [])) {
      parts.push(content.spellById[req]?.name || req);
    }
    return parts.join(', ');
  }

  // ---------- Sorts ----------
  // Vitesse d'incantation T4C (Bible, Spell Speed) : `cast` secondes au niveau
  // du sort, qui diminue de `castStep` (20 ou 40 ms) par niveau au-delà,
  // plancher `castMin`. Word of Recall/Gateway/Portal sont fixes (castStep 0).
  castTimeMs(p, sp) {
    const slow = (sp.cast ?? 1.5) * 1000;
    const fast = (sp.castMin ?? 1) * 1000;
    const step = (sp.castStep ?? 0.02) * 1000;
    return Math.round(Math.max(fast, slow - Math.max(0, p.level - (sp.level || 1)) * step));
  }

  // Formule de la Bible : 1dN + base + Int/k + Sag/k (puissance élémentaire = 100)
  rollSpellOutput(p, f) {
    const s = p.eff.stats;
    let v = f.base || 0;
    if (f.dice) v += 1 + Math.floor(Math.random() * f.dice);
    if (f.int) v += s.int / f.int;
    if (f.wis) v += s.wis / f.wis;
    return v;
  }

  // Multiplicateur de puissance : compétences + Afflux de Mana (+33 %).
  // L'Afflux ne s'applique PAS aux sorts d'arcane (réf. t4c.arp.free.fr).
  spellPowerMul(p, element = null) {
    let m = 1 + (p.skillFx?.spellMul || 0);
    if (element !== 'arcane') {
      for (const b of p.buffs) if (b.stat === 'spellpow') m *= 1 + b.power;
    }
    return m;
  }

  // La cible (joueur ou monstre) est-elle intouchable (Sanctuaire) ?
  isUntouchable(e) { return (e.sanctuaryUntil || 0) > this.now(); }

  // Le joueur est-il en transe (Sanctuaire) : ni attaque ni sort pendant 2x la durée
  isPacified(p) { return (p.pacifiedUntil || 0) > this.now(); }

  // Malédiction / Peste : la cible ne peut plus être soignée (sorts, potions, drains)
  isCursed(e) { return (e.curseUntil || 0) > this.now(); }

  // Style visuel/sonore d'un sort pour le client : poison (vert), drain (sombre)
  // ou simplement son élément
  spellStyle(sp) {
    if (sp.leech) return 'drain';
    if (sp.dot) return 'poison';
    return sp.element || null;
  }

  // Validation + début d'incantation. L'effet part dans resolveCast() une fois
  // le temps d'incantation écoulé (tick). L'approche automatique hors combat
  // passe toujours par pendingCast : l'incantation démarre une fois à portée.
  castSpell(p, msg) {
    const sp = content.spellById[msg.spellId];
    if (!sp || !p.spells.includes(sp.id) || sp.todo) return;
    const now = this.now();
    if (this.isPacified(p)) {
      this.send(p, { t: 'info', text: 'La transe du Sanctuaire vous empêche de lancer le moindre sort.' });
      return;
    }
    if (p.casting) return; // déjà en train d'incanter
    if ((p.spellCds[sp.id] || 0) > now) return;
    if (p.mana < sp.mana) { this.send(p, { t: 'info', text: 'Mana insuffisant.' }); return; }

    const cast = { spellId: sp.id };
    if (sp.type === 'bolt') {
      const target = p.zi.entities.get(msg.target | 0);
      // les sorts purement maudissants (Malédiction) peuvent viser un joueur (T4C)
      const curseOnly = sp.curse && !sp.dmg;
      const validTarget = target && !target.dead && !target.hidden
        && (target.kind === C.KIND.MOB
          || (curseOnly && target.kind === C.KIND.PLAYER && target.id !== p.id && !this.isUntouchable(target)));
      if (!validTarget) return;
      if (sp.undeadOnly && !target.def?.undead) {
        this.send(p, { t: 'info', text: `${sp.name} n'affecte que les morts-vivants.` });
        return;
      }
      if (Math.hypot(target.x - p.x, target.z - p.z) > sp.range) {
        // hors mode combat : on s'approche puis on lance (à la T4C)
        if (msg.approach) { this.startApproachCast(p, msg, target.x, target.z); return; }
        this.send(p, { t: 'info', text: 'Trop loin.' });
        return;
      }
      if (!lineOfSight(p.zi.world, p, target)) return;
      cast.target = target.id;
      p.dir = Math.atan2(target.x - p.x, target.z - p.z);
    } else if (sp.type === 'aoe' && !sp.centered) {
      const cx = +msg.x, cz = +msg.z;
      if (!Number.isFinite(cx) || !Number.isFinite(cz)) return;
      if (Math.hypot(cx - p.x, cz - p.z) > sp.range) {
        if (msg.approach) { this.startApproachCast(p, msg, cx, cz); return; }
        this.send(p, { t: 'info', text: 'Trop loin.' });
        return;
      }
      cast.x = cx; cast.z = cz;
      p.dir = Math.atan2(cx - p.x, cz - p.z);
    }

    // T4C : l'effet du sort part IMMÉDIATEMENT — la « vitesse du sort » de la
    // Bible est le délai de RÉCUPÉRATION avant de pouvoir relancer, pas une
    // incantation préalable (corrigé d'après l'expérience de jeu de Quentin)
    if ((p.spellReadyAt || 0) > now) {
      this.send(p, { t: 'cast_cd', ms: Math.max(0, Math.round((p.spellReadyAt - now) * 1000)) });
      return;
    }
    p.casting = cast;
    if (this.resolveCast(p)) {
      const ms = this.castTimeMs(p, sp);
      p.spellReadyAt = now + ms / 1000;
      p.state = C.ST.ATTACK; // posture de lancement
      this.send(p, { t: 'cast_start', spellId: sp.id, name: sp.name, ms }); // barre de récupération
    }
  }

  // Applique l'effet du sort (formules de la Bible). Retourne true si le sort
  // est réellement parti (la récupération ne s'applique qu'en cas de succès).
  resolveCast(p) {
    const c = p.casting;
    p.casting = null;
    const sp = content.spellById[c.spellId];
    if (!sp || p.dead) return false;
    const now = this.now();
    if (p.mana < sp.mana) { this.send(p, { t: 'cast_break' }); this.send(p, { t: 'info', text: 'Mana insuffisant.' }); return false; }

    const mul = this.spellPowerMul(p, sp.element);
    const wis = p.eff.stats.wis;

    if (sp.type === 'heal') {
      // Malédiction : aucun soin ne peut atteindre la cible
      if (this.isCursed(p)) {
        this.send(p, { t: 'cast_break' });
        this.send(p, { t: 'info', text: 'Une malédiction pèse sur vous : le soin échoue.' });
        return false;
      }
      const amount = Math.max(1, Math.round(this.rollSpellOutput(p, sp.heal) * mul));
      p.hp = Math.min(p.eff.maxHp, p.hp + amount);
      this.eventNear(p, { t: 'fx', kind: 'heal', id: p.id });
    } else if (sp.type === 'buff' && sp.buff.stat === 'sanctuaire') {
      // Sanctuaire : intouchable pendant la durée, mais incapable d'attaquer
      // ou de lancer un sort pendant LE DOUBLE de la durée (T4C)
      p.sanctuaryUntil = now + sp.duration;
      p.pacifiedUntil = now + sp.duration * 2;
      p.attackTarget = null; p.pendingCast = null;
      p.buffs = p.buffs.filter(x => x.stat !== 'sanctuaire' && x.stat !== 'transe');
      p.buffs.push({ stat: 'sanctuaire', power: 1, until: p.sanctuaryUntil });
      p.buffs.push({ stat: 'transe', power: 1, until: p.pacifiedUntil });
      this.eventNear(p, { t: 'fx', kind: 'buff', id: p.id, color: sp.color, element: sp.element, stat: 'sanctuaire' });
    } else if (sp.type === 'buff') {
      const b = sp.buff;
      let power;
      if (b.value != null) power = b.value;
      else if (b.selfFrac) power = Math.max(1, Math.round((p.stats[b.stat] || 0) * b.selfFrac)); // % de la stat DE BASE (true_x de la Bible)
      else if (b.stat === 'maxhp') power = Math.round(wis + Math.random() * (wis / 4)); // Bénédiction : Sag + 1d(Sag/4) PV
      else if (b.stat === 'retort') power = Math.round((b.base || 0) + (b.dice || 0) / 2); // affichage : dégâts moyens de riposte
      else power = Math.round(((b.base || 0) + (b.intDiv ? p.eff.stats.int / b.intDiv : 0) + (b.wisDiv ? wis / b.wisDiv : 0)) * 10) / 10;
      p.buffs = p.buffs.filter(x => x.stat !== b.stat);
      p.buffs.push({ stat: b.stat, power, dice: b.dice, base: b.base, element: sp.element, until: now + sp.duration });
      this.recompute(p);
      this.eventNear(p, { t: 'fx', kind: 'buff', id: p.id, color: sp.color, element: sp.element, stat: b.stat });
    } else if (sp.type === 'bolt') {
      const target = p.zi.entities.get(c.target | 0);
      const curseOnly = sp.curse && !sp.dmg;
      // la cible est morte ou s'est dérobée pendant l'incantation : le sort échoue sans coûter de mana
      if (!target || target.dead || target.hidden
          || !(target.kind === C.KIND.MOB || (curseOnly && target.kind === C.KIND.PLAYER && target.id !== p.id && !this.isUntouchable(target)))
          || Math.hypot(target.x - p.x, target.z - p.z) > sp.range + 2
          || !lineOfSight(p.zi.world, p, target)) {
        this.send(p, { t: 'cast_break' });
        this.send(p, { t: 'info', text: 'La cible s\'est dérobée.' });
        return false;
      }
      this.eventNear(target, { t: 'proj', from: p.id, to: target.id, color: sp.color, element: this.spellStyle(sp) });
      if (sp.dmg) {
        // pas de CA contre les sorts : seules les RÉSISTANCES élémentaires comptent (T4C)
        let dmg = this.rollSpellOutput(p, sp.dmg) * mul;
        // Renvoi des Morts-Vivants : multiplicateur Sag/(20+2×niveau) de la Bible
        if (sp.turnUndead) dmg *= wis / (20 + 2 * p.level);
        const { dmg: final, mod } = this.applyResist(target, sp, Math.max(1, Math.round(dmg)));
        this.applyDamage(p, target, final, false, mod);
        // drain de vie : rend au lanceur, inefficace sur les morts-vivants (T4C)
        // et bloqué si le lanceur est lui-même maudit (aucun soin ne l'atteint)
        if (sp.leech && !target.def.undead && !this.isCursed(p)) {
          p.hp = Math.min(p.eff.maxHp, p.hp + final * sp.leech);
          // filet sombre de la cible vers le lanceur
          this.eventNear(p, { t: 'proj', from: target.id, to: p.id, color: '#5a1a6a', element: 'drain' });
          this.eventNear(p, { t: 'fx', kind: 'heal', id: p.id });
        }
      }
      // Enchevêtrement : RALENTIT la cible (malus de vitesse, fidèle au site français)
      if (sp.slow && !target.dead) {
        target.slowUntil = now + sp.slow.duration;
        target.slowFactor = sp.slow.factor;
      }
      // Malédiction / Peste : la cible (joueur OU monstre) ne peut plus être soignée
      if (sp.curse && !target.dead) {
        target.curseUntil = now + sp.curse;
        this.eventNear(target, { t: 'fx', kind: 'curse', id: target.id });
        if (target.kind === C.KIND.PLAYER) {
          target.buffs = target.buffs.filter(x => x.stat !== 'maudit');
          target.buffs.push({ stat: 'maudit', power: 1, until: target.curseUntil });
          this.send(target, { t: 'info', text: `${p.name} vous a maudit : aucun soin ne peut plus vous atteindre !` });
          this.sendSelf(target);
        }
      }
      // Poison / Flèche empoisonnée / Peste : dégâts sur la durée
      if (sp.dot && !target.dead) {
        (target.dots = target.dots || []).push({
          ...sp.dot, element: sp.element, from: p,
          until: now + sp.dot.duration, nextAt: now + sp.dot.interval,
        });
      }
      p.dir = Math.atan2(target.x - p.x, target.z - p.z);
      p.lastCombat = now;
    } else if (sp.type === 'aoe') {
      // sorts centrés sur le lanceur (Vague de Flamme, Séisme) ou sur un point visé
      const cx = sp.centered ? p.x : +c.x, cz = sp.centered ? p.z : +c.z;
      this.eventNear(p, { t: 'aoe', from: p.id, x: cx, z: cz, radius: sp.radius, color: sp.color, element: this.spellStyle(sp) });
      const hits = [...p.zi.nearby(cx, cz, sp.radius)].filter(e => e.kind === C.KIND.MOB && !e.dead);
      for (const e of hits) {
        const dist = Math.hypot(e.x - cx, e.z - cz);
        // dégâts pleins au centre, décroissants vers le bord ((20-r)/20 de la Bible)
        let dmg = this.rollSpellOutput(p, sp.dmg) * mul * (1 - 0.5 * Math.min(1, dist / sp.radius));
        if (hits.length === 1) dmg *= 2; // T4C : dégâts doublés sur cible unique
        const { dmg: final, mod } = this.applyResist(e, sp, Math.max(1, Math.round(dmg)));
        this.applyDamage(p, e, final, false, mod);
      }
      p.lastCombat = now;
    }

    p.mana -= sp.mana;
    p.spellCds[sp.id] = now + (sp.cd || 0);
    p.state = C.ST.ATTACK;
    this.send(p, { t: 'cast_ok', spellId: sp.id, cd: sp.cd || 0, mana: Math.round(p.mana) });
    if (sp.type === 'buff') this.sendSelf(p); // maxHp/dégâts/défense ont pu changer
    else this.send(p, { t: 'vitals', hp: Math.round(p.hp), mana: Math.round(p.mana) });
    return true;
  }

  // Hors mode combat : marche jusqu'à la portée du sort, puis le lance
  startApproachCast(p, msg, tx, tz) {
    p.pendingCast = { ...msg, approach: false }; // une seule approche, pas de boucle
    p.path = findPath(p.zi.world, p.x, p.z, tx, tz);
    p.moveDir = null;
    p.attackTarget = null;
  }

  // Résistances élémentaires T4C : réduction (ou amplification si faiblesse).
  // Pour un joueur, les buffs s'ajoutent : Bouclier de mana (+33 % contre toutes
  // les magies SAUF arcanes) et Résistance au feu / à la glace (+100 % à l'élément).
  // À 100 % ou plus, le sort est entièrement annulé (0 dégât).
  applyResist(target, sp, dmg) {
    let resist = target.def?.resist?.[sp.element] || 0;
    if (target.kind === C.KIND.PLAYER && sp.element) {
      for (const b of target.buffs) {
        if (b.stat === 'resistAll' && sp.element !== 'arcane') resist += b.power;
        else if (b.stat === 'resist_' + sp.element) resist += b.power;
      }
    }
    if (!resist) return { dmg, mod: null };
    resist = Math.min(1, resist);
    return {
      dmg: resist >= 1 ? 0 : Math.max(1, Math.round(dmg * (1 - resist))),
      mod: resist > 0.05 ? 'resist' : (resist < -0.05 ? 'weak' : null),
    };
  }

  applyDamage(attacker, defender, dmg, crit, mod = null) {
    const hpBefore = defender.hp;
    defender.hp -= dmg;
    defender.lastCombat = this.now();
    this.eventNear(defender, { t: 'dmg', from: attacker.id, to: defender.id, amount: dmg, crit, mod });
    // XP « par coup » (T4C) : chaque dégât d'un joueur sur un monstre rapporte
    // xpTotale × dégâtsEffectifs / PVmax, bornés aux PV restants (pas d'XP
    // d'overkill). Les PV régénérés redonnent de l'XP : pas de plafond cumulé
    // par monstre — le « milking » de liche est canon.
    if (attacker.kind === C.KIND.PLAYER && defender.kind === C.KIND.MOB && dmg > 0) {
      const effective = Math.min(dmg, Math.max(0, hpBefore));
      if (effective > 0) this.shareXpForDamage(attacker, defender, effective / defender.maxHp);
    }
    if (defender.hp <= 0) {
      if (defender.kind === C.KIND.MOB) this.killMob(defender, attacker);
      else this.killPlayer(defender, attacker);
    } else if (defender.kind === C.KIND.PLAYER) {
      this.send(defender, { t: 'vitals', hp: Math.round(defender.hp), mana: Math.round(defender.mana) });
    }
  }

  // ---------- Combat ----------
  attack(attacker, defender) {
    // Sanctuaire : la cible est intouchable ; l'attaquant en transe ne frappe pas
    if (this.isUntouchable(defender)) return;
    if (attacker.kind === C.KIND.PLAYER && this.isPacified(attacker)) { attacker.attackTarget = null; return; }
    const aStats = attacker.kind === C.KIND.PLAYER ? attacker.eff.stats
      : { str: 0, agi: 10 + attacker.level * 1.8, end: 0, int: 0, wis: 0 };
    const dStats = defender.kind === C.KIND.PLAYER ? defender.eff.stats
      : { str: 0, agi: 10 + defender.level * 1.8, end: 0, int: 0, wis: 0 };
    attacker.state = C.ST.ATTACK;
    attacker.dir = Math.atan2(defender.x - attacker.x, defender.z - attacker.z);
    attacker.lastCombat = this.now();
    defender.lastCombat = this.now();

    let hitC = C.hitChance(aStats, dStats);
    // T4C : Attaque ne sert qu'en mêlée, Archerie qu'à l'arc — jamais les deux
    const usesBow = attacker.kind === C.KIND.PLAYER && attacker.eff.ranged;
    if (attacker.kind === C.KIND.PLAYER) {
      hitC = Math.min(0.98, hitC + (usesBow ? (attacker.skillFx?.rangedHit || 0) : (attacker.skillFx?.hit || 0)));
    }
    if (defender.kind === C.KIND.PLAYER) hitC = Math.max(0.15, hitC - (defender.skillFx?.dodge || 0));
    if (Math.random() > hitC) {
      this.eventNear(defender, { t: 'dmg', from: attacker.id, to: defender.id, miss: true });
      return;
    }
    // Parade T4C : annule totalement le coup (bouclier : +50 % d'efficacité)
    if (defender.kind === C.KIND.PLAYER && Math.random() < (defender.skillFx?.parry || 0)) {
      this.eventNear(defender, { t: 'dmg', from: attacker.id, to: defender.id, parry: true });
      return;
    }
    // flèche : trace visuelle du tir à chaque coup réussi (système des projectiles de sorts)
    if (usesBow) this.eventNear(defender, { t: 'proj', from: attacker.id, to: defender.id, color: '#d8c8a0' });
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
    let defense = defender.kind === C.KIND.PLAYER ? defender.eff.defense : defender.sc.def;
    // Transpercer l'armure : la CA adverse compte moins (0,25 %/pt)
    if (attacker.kind === C.KIND.PLAYER) defense *= 1 - (attacker.skillFx?.pierce || 0);
    dmg = C.mitigate(dmg, defense);
    // attaque élémentaire d'un monstre (ex. Fourmi de feu) : les résistances
    // du défenseur s'appliquent (Bouclier de mana, Résistance au feu/à la glace...)
    let elemMod = null;
    if (attacker.kind === C.KIND.MOB && attacker.def.element) {
      ({ dmg, mod: elemMod } = this.applyResist(defender, { element: attacker.def.element }, dmg));
    }
    // Coup assommant : chance d'immobiliser brièvement le monstre
    if (attacker.kind === C.KIND.PLAYER && defender.kind === C.KIND.MOB
        && Math.random() < (attacker.skillFx?.stun || 0)) {
      defender.stunnedUntil = this.now() + 0.8;
      defender.path = null;
    }
    this.applyDamage(attacker, defender, dmg, crit, elemMod);
    // Boucliers de Feu/Glace/Électrique (T4C) : riposte élémentaire à chaque
    // coup physique encaissé — 1dN + base, modulé par la résistance du monstre
    if (defender.kind === C.KIND.PLAYER && attacker.kind === C.KIND.MOB && !attacker.dead) {
      for (const b of defender.buffs) {
        if (b.stat !== 'retort') continue;
        const raw = (b.base || 0) + 1 + Math.floor(Math.random() * (b.dice || 1));
        const { dmg: rDmg, mod } = this.applyResist(attacker, { element: b.element }, raw);
        this.applyDamage(defender, attacker, rDmg, false, mod);
        if (attacker.dead) break;
      }
    }
  }

  killMob(m, killer) {
    m.dead = true; m.state = C.ST.DEAD; m.hp = 0; m.target = null; m.path = null;
    m.curseUntil = 0; m.slowUntil = 0;
    this.eventNear(m, { t: 'fx', kind: 'die', id: m.id }); // râle + poussière côté client
    m.hideAt = this.now() + 6;
    // la place se libère au camp : le spawn par mouvement pourra la repourvoir
    if (m.camp) { m.camp.alive--; m.camp = null; }
    // l'XP a déjà été versée COUP PAR COUP (applyDamage) : rien à la mort
    if (killer.kind === C.KIND.PLAYER) {
      if (killer.attackTarget === m.id) killer.attackTarget = null;
      const zid = m.zi.zoneId;
      for (const payload of rollDrops(m.def, Math.random, zid, killer.skillFx?.loot || 0)) {
        this.spawnDrop(m.zi, m.x, m.z, payload);
      }
    }
  }

  // Mort définitive : le personnage est effacé. Roguelike.
  killPlayer(p, killer) {
    this.leaveParty(p); // le mort quitte le groupe
    p.dead = true; p.permadead = true; p.state = C.ST.DEAD; p.hp = 0;
    p.path = null; p.moveDir = null; p.attackTarget = null;
    p.casting = null; p.pendingCast = null; // la mort interrompt l'incantation
    const who = killer.kind === C.KIND.MOB ? killer.def.name : killer.name;
    const zoneName = p.zi.isTrial ? `l'Épreuve vers ${this.zoneDef(p.zi.trialTarget).name}`
      : p.zi.isCave ? p.zi.caveName
      : this.zoneDef(p.zi.zoneId).name;
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
    p.bank = data.bank || []; // la banque de l'ancien personnage est perdue (permadeath)
    p.spells = []; p.skills = {}; p.unlocked = [0];
    p.buffs = []; p.spellCds = {}; p.casting = null;
    p.curseUntil = 0; p.sanctuaryUntil = 0; p.pacifiedUntil = 0;
    this.recompute(p);
    p.hp = p.eff.maxHp; p.mana = p.eff.maxMana;
    this.movePlayerToZone(p, zi0, zi0.world.spawnPoint.x, zi0.world.spawnPoint.z);
    this.broadcastChat('sys', `${p.name} renaît sur ${this.zoneDef(0).name}.`);
  }

  // XP générée par les dégâts d'un membre, mutualisée dans son groupe.
  // Adaptation du modèle « 100 % aux dégâts » au jeu en groupe : la part de
  // monstre entamée (fraction = dégâts effectifs / PVmax) vaut, pour chaque
  // membre à portée, SA récompense de référence mobXpReward(mob, membre) —
  // chacun à son niveau, comme en solo. Le total est bonifié de +10 % par
  // membre au-delà du premier puis réparti à parts égales : les soigneurs
  // touchent leur part, et grouper reste légèrement plus rentable que
  // d'additionner des chasses solo. Hors portée ou autre zone : chacun pour soi.
  shareXpForDamage(dealer, mob, fraction) {
    const recipients = this.xpRecipients(dealer);
    const bonus = 1 + C.GROUP_XP_BONUS_PER_MEMBER * (recipients.length - 1);
    for (const r of recipients) {
      this.grantXp(r, C.mobXpReward(mob.level, r.level) * fraction * bonus / recipients.length);
    }
  }

  // membres du groupe éligibles au partage : même zone, vivants, à portée
  xpRecipients(dealer) {
    if (!dealer.party) return [dealer];
    const out = [];
    for (const m of dealer.party.members) {
      if (m.dead || m.zi !== dealer.zi) continue;
      if (Math.hypot(m.x - dealer.x, m.z - dealer.z) > C.GROUP_XP_RANGE) continue;
      out.push(m);
    }
    return out.length ? out : [dealer];
  }

  // Crédite de l'XP (flottante : les petits coups s'accumulent sans perte).
  // Le client est notifié par paquets via 'xp' (flush throttlé dans tick).
  grantXp(p, amount) {
    if (!this.players.has(p.id) || p.permadead || amount <= 0) return;
    p.xp += amount;
    p.xpNotify = (p.xpNotify || 0) + amount;
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
      this.sendSelf(p);
    }
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
    const d = {
      id: this.nextId++, kind: C.KIND.DROP,
      defId: payload.gold ? 'or' : payload.item.defId,
      gold: payload.gold || 0, item: payload.item || null,
      x, z, dir: 0, state: 0, hidden: false,
      expiresAt: this.now() + ttl,
    };
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
    this.recompute(p);
    this.send(p, { t: 'loot', text: `Posé au sol : ${itemLabel(item)}` });
    this.sendSelf(p);
  }

  // ---------- Groupes (parties) ----------
  // Un groupe = { leader, members: [joueurs, chef compris] }. Invitation par
  // nom (/inviter Nom) ou par clic ; elle expire après GROUP_INVITE_TTL s.
  // Le chef peut exclure ; s'il part (départ, mort, déconnexion), dissolution.

  // informe tous les membres de la composition (panneau + surlignage des noms)
  sendPartyUpdate(party) {
    const msg = {
      t: 'party_update',
      leaderId: party.leader.id,
      members: party.members.map(m => ({ id: m.id, name: m.name, level: m.level })),
    };
    for (const m of party.members) this.send(m, msg);
  }

  broadcastToParty(party, text, except = null) {
    for (const m of party.members) {
      if (m !== except) this.send(m, { t: 'info', text });
    }
  }

  partyInvite(p, msg) {
    let target = null;
    if (msg.id != null) target = this.players.get(msg.id | 0);
    else {
      const name = String(msg.name || '').trim().toLowerCase();
      if (name) for (const x of this.players.values()) {
        if (x.name.toLowerCase() === name) { target = x; break; }
      }
    }
    if (!target || target === p || target.dead || target.permadead) {
      this.send(p, { t: 'info', text: 'Personne de ce nom à inviter.' });
      return;
    }
    if (target.party) { this.send(p, { t: 'info', text: `${target.name} est déjà dans un groupe.` }); return; }
    if (p.party && p.party.leader !== p) { this.send(p, { t: 'info', text: 'Seul le chef du groupe peut inviter.' }); return; }
    if (p.party && p.party.members.length >= C.GROUP_MAX_SIZE) {
      this.send(p, { t: 'info', text: `Le groupe est complet (${C.GROUP_MAX_SIZE} membres).` });
      return;
    }
    target.partyInvite = { fromId: p.id, until: this.now() + C.GROUP_INVITE_TTL };
    this.send(target, { t: 'party_invite', fromId: p.id, from: p.name });
    this.send(p, { t: 'info', text: `Invitation envoyée à ${target.name}.` });
  }

  partyAccept(p) {
    const inv = p.partyInvite;
    p.partyInvite = null;
    if (!inv || this.now() > inv.until) { this.send(p, { t: 'info', text: 'L\'invitation a expiré.' }); return; }
    if (p.party) return; // déjà groupé (ne devrait pas arriver)
    const from = this.players.get(inv.fromId);
    if (!from || from.dead || from.permadead) { this.send(p, { t: 'info', text: 'L\'invitant n\'est plus là.' }); return; }
    if (from.party && from.party.leader !== from) { this.send(p, { t: 'info', text: 'L\'invitant n\'est plus chef de groupe.' }); return; }
    let party = from.party;
    if (!party) {
      party = { leader: from, members: [from] };
      from.party = party;
    }
    if (party.members.length >= C.GROUP_MAX_SIZE) { this.send(p, { t: 'info', text: 'Le groupe est complet.' }); return; }
    party.members.push(p);
    p.party = party;
    this.broadcastToParty(party, `${p.name} rejoint le groupe.`, p);
    this.send(p, { t: 'info', text: `Vous rejoignez le groupe de ${party.leader.name}.` });
    this.sendPartyUpdate(party);
  }

  partyDecline(p) {
    const inv = p.partyInvite;
    p.partyInvite = null;
    if (!inv) return;
    const from = this.players.get(inv.fromId);
    if (from) this.send(from, { t: 'info', text: `${p.name} décline votre invitation.` });
  }

  partyKick(p, msg) {
    const party = p.party;
    if (!party || party.leader !== p) return;
    const target = party.members.find(m => m.id === (msg.id | 0));
    if (!target || target === p) return;
    this.send(target, { t: 'info', text: 'Vous avez été exclu du groupe.' });
    this.broadcastToParty(party, `${target.name} a été exclu du groupe.`, target);
    this.leaveParty(target);
  }

  // sortie d'un membre (départ volontaire, exclusion, mort, déconnexion).
  // Chef parti -> dissolution ; groupe réduit à un seul membre -> dissolution.
  leaveParty(p) {
    const party = p.party;
    if (!party) return;
    p.party = null;
    const emptyUpdate = { t: 'party_update', leaderId: 0, members: [] };
    this.send(p, emptyUpdate);
    if (party.leader === p) {
      for (const m of party.members) {
        if (m === p) continue;
        m.party = null;
        this.send(m, emptyUpdate);
        this.send(m, { t: 'info', text: 'Le groupe est dissous : le chef est parti.' });
      }
      party.members = [];
      return;
    }
    party.members = party.members.filter(m => m !== p);
    if (party.members.length < 2) {
      for (const m of party.members) {
        m.party = null;
        this.send(m, emptyUpdate);
        this.send(m, { t: 'info', text: 'Le groupe est dissous.' });
      }
      party.members = [];
    } else {
      this.sendPartyUpdate(party);
    }
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

      // XP accumulée depuis le dernier envoi : un seul message regroupé
      // (le client affiche un flotteur lisible, pas un par tick de DoT)
      if ((p.xpNotify || 0) >= 1 && this.tickCount % XP_NOTIFY_EVERY_TICKS === 0) {
        this.send(p, { t: 'xp', gain: Math.round(p.xpNotify), xp: Math.floor(p.xp) });
        p.xpNotify = 0;
      }

      // déplacement direct (flèches / clic maintenu)
      if (p.moveDir) {
        const sp = p.eff.speed * dt;
        const ox = p.x, oz = p.z;
        const nx = p.x + p.moveDir.x * sp, nz = p.z + p.moveDir.z * sp;
        if (p.zi.world.isWalkable(nx, nz)) { p.x = nx; p.z = nz; }
        else if (p.zi.world.isWalkable(nx, p.z)) { p.x = nx; }
        else if (p.zi.world.isWalkable(p.x, nz)) { p.z = nz; }
        p.dir = Math.atan2(p.moveDir.x, p.moveDir.z);
        p.state = C.ST.WALK;
        p.zi.gridMove(p);
        if (p.x !== ox || p.z !== oz) this.heatZone(p.zi); // mouvement réel
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
      // sort en attente d'approche : lance dès qu'on est à portée
      if (p.pendingCast) {
        const pc = p.pendingCast;
        const spc = content.spellById[pc.spellId];
        const tgt = pc.target != null ? p.zi.entities.get(pc.target) : null;
        if (!spc || (pc.target != null && (!tgt || tgt.dead || tgt.hidden))) {
          p.pendingCast = null;
        } else {
          const tx = tgt ? tgt.x : pc.x, tz = tgt ? tgt.z : pc.z;
          // à portée ET en ligne de vue : sinon on continue d'avancer
          if (Math.hypot(tx - p.x, tz - p.z) <= spc.range
              && lineOfSight(p.zi.world, p, { x: tx, z: tz })) {
            if ((p.spellCds[spc.id] || 0) <= now) {
              p.pendingCast = null;
              p.path = null;
              this.castSpell(p, pc);
            }
          } else if (!p.path || this.tickCount % 5 === 0) {
            p.path = findPath(p.zi.world, p.x, p.z, tx, tz);
          }
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

    // PV des membres de groupe (panneau de groupe côté client)
    if (this.tickCount % PARTY_VITALS_EVERY_TICKS === 0) {
      const done = new Set();
      for (const p of this.players.values()) {
        const party = p.party;
        if (!party || done.has(party)) continue;
        done.add(party);
        const vit = party.members.map(m => ({ id: m.id, hp: Math.round(m.hp), maxHp: m.eff.maxHp }));
        for (const m of party.members) this.send(m, { t: 'party_vitals', members: vit });
      }
    }

    // Monstres et objets au sol, zone par zone
    for (const zi of this.zones.values()) {
      const hasPlayers = zi.players > 0;
      // spawn par le mouvement (l'Épreuve, gauntlet figé, reste pré-peuplée)
      if (hasPlayers && !zi.isTrial) this.maybeSpawn(zi, now);
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
      // le cadavre reste visible le temps du râle, puis l'entité disparaît :
      // plus de réapparition par timer (le spawn par mouvement prend le relais)
      if (now >= m.hideAt) zi.remove(m);
      return;
    }
    m.atkCd = Math.max(0, m.atkCd - dt);
    // poisons en cours (Poison, Flèche Empoisonnée) : dégâts sur la durée
    if (m.dots && m.dots.length) {
      for (const d of m.dots) {
        if (now >= d.nextAt && now <= d.until) {
          d.nextAt += d.interval;
          const dmg = Math.max(1, Math.round(d.min + Math.random() * (d.max - d.min)));
          this.applyDamage(d.from, m, dmg, false);
          if (m.dead) return;
        }
      }
      m.dots = m.dots.filter(d => now < d.until);
    }
    if (m.stunnedUntil && now < m.stunnedUntil) return; // assommé (Coup assommant)

    if (!m.target && (this.tickCount + m.id) % 5 === 0) {
      let best = null, bestD = m.def.aggro;
      for (const e of zi.nearby(m.x, m.z, m.def.aggro)) {
        if (e.kind !== C.KIND.PLAYER || e.dead || this.isUntouchable(e)) continue;
        const d = Math.hypot(e.x - m.x, e.z - m.z);
        if (d < bestD) { bestD = d; best = e; }
      }
      if (best) m.target = best.id;
    }

    if (m.target) {
      const tgt = zi.entities.get(m.target);
      const leashed = Math.hypot(m.x - m.home.x, m.z - m.home.z) > m.def.leash;
      if (!tgt || tgt.dead || this.isUntouchable(tgt) || leashed || Math.hypot(tgt.x - m.x, tgt.z - m.z) > m.def.leash) {
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

    // Enchevêtrement : vitesse réduite tant que le ralentissement court
    const speed = (m.slowUntil && now < m.slowUntil) ? m.def.speed * (m.slowFactor ?? 0.5) : m.def.speed;
    this.stepAlong(m, speed, dt);
  }

  stepAlong(e, speed, dt) {
    if (!e.path || !e.path.length) {
      if (e.state === C.ST.WALK) e.state = C.ST.IDLE;
      return;
    }
    let remaining = speed * dt;
    let moved = false;
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
      moved = true;
    }
    if (e.path && !e.path.length) e.path = null;
    e.state = e.path ? C.ST.WALK : (e.state === C.ST.ATTACK ? C.ST.ATTACK : C.ST.IDLE);
    e.zi.gridMove(e);
    // un joueur qui suit un chemin maintient la zone « chaude » (spawn T4C)
    if (moved && e.kind === C.KIND.PLAYER) this.heatZone(e.zi);
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
