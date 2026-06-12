// Orchestrateur du jeu autoritatif multi-zones : boucle, réseau, zones (îles,
// Épreuves, cavernes), commerce, banque, groupes, permadeath. Les entités vivent
// dans entities.js, le système de sorts dans spells.js, la grille dans zone.js.
import * as C from '../../shared/constants.js';
import { ITEMS, MOBS, SLOTS, CHESTS, BANK_SIZE, chestPool } from '../../shared/defs.js';
import { generateWorld, generateTrial, defaultNpcSpots, SPAWN_ZONES, mulberry32 } from '../../shared/worldgen.js';
import { generateCave, CAVES, CAVE_LEVEL_BONUS } from '../../shared/cave.js';
import { encodeSnapshot } from '../../shared/protocol.js';
import { makeItem, rollDrops, itemStats, itemLabel, itemPrice, itemWeight, inventoryWeight, setNextIid, zoneMult } from './items.js';
import { findPath } from './pathfind.js';
import { content } from '../content.js';
import { applyOverrides } from '../../shared/overrides.js';
import { loadOverrides } from '../admin.js';
import * as db from '../db.js';
import { ZoneInstance, walkableNear } from './zone.js';
import { Player, Mob, NPC, Drop } from './entities.js';
import * as spells from './spells.js';
import { handleNpcKeywords, rootKeywordsHint } from './dialogues.js';

// voile sombre des cavernes (la pénombre elle-même est rendue côté client)
const CAVE_TINT = 'rgba(18, 14, 34, 0.22)';

// Intervalle entre deux apparitions de monstres dans une zone « chaude »
// (env T4C_SPAWN_MS ; les suites de test l'abaissent à ~250 ms)
const SPAWN_INTERVAL_MS = Math.max(50,
  parseInt(process.env.T4C_SPAWN_MS, 10) || C.SPAWN_INTERVAL_DEFAULT_MS);
const SPAWN_TRIES_PER_TICK = 12;  // essais de placement avant d'abandonner le tick
const PARTY_VITALS_EVERY_TICKS = 10; // PV des membres du groupe : 1 envoi/s

// Garde-fous des camps édités par l'admin (overrides `camps`)
const CAMP_RADIUS_MIN = 1, CAMP_RADIUS_MAX = 40; // rayon d'un camp (tuiles)
const CAMP_QUOTA_MAX = 50;                       // population max par monstre d'un camp

// champs d'un PNJ que les overrides (`npcs.edit` / `npcs.add`) peuvent définir
const NPC_EDITABLE_FIELDS = ['name', 'look', 'role', 'greetings', 'sells', 'teaches', 'dialogues'];

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
  // monstres. Les camps (par défaut ceux du worldgen, sinon les overrides
  // `camps` édités dans l'admin) sont des BUDGETS : tant qu'un camp est sous
  // sa capacité et qu'un joueur bouge dans la zone, le tick de spawn peut y
  // faire apparaître un monstre — toujours hors champ (SPAWN_MIN_PLAYER_DIST).
  populateIsland(zi) {
    const ov = loadOverrides(zi.zoneId);
    zi.camps = this.buildIslandCamps(zi, ov);
    this.spawnNpc(zi, ov);
  }

  // Un camp = centre + rayon + quota de population PAR monstre. `aliveBy`
  // décompte les vivants par defId (décrémenté à la mort), `cap`/`alive` la
  // population globale (les camps de caverne, sans quota, n'utilisent qu'eux).
  makeCamp(x, z, radius, mobs, base) {
    const quota = {};
    let cap = 0;
    for (const [defId, n] of Object.entries(mobs || {})) {
      if (!MOBS[defId] || !((n | 0) > 0)) continue;
      quota[defId] = Math.min(CAMP_QUOTA_MAX, n | 0);
      cap += quota[defId];
    }
    if (!cap || !Number.isFinite(+x) || !Number.isFinite(+z)) return null;
    return {
      x: +x, z: +z,
      radius: Math.max(CAMP_RADIUS_MIN, Math.min(CAMP_RADIUS_MAX, +radius || CAMP_RADIUS_MIN)),
      defIds: Object.keys(quota),
      quota, aliveBy: {},
      cap, alive: 0,
      base, // niveau de base de la zone (scaling)
    };
  }

  // Camps d'une île : les overrides `camps` (format {id, x, z, r, mobs}) s'ils
  // existent — un tableau, même vide, REMPLACE tout — sinon les camps par
  // défaut du worldgen (carte fixe ou camps communs procéduraux).
  buildIslandCamps(zi, ov) {
    const base = this.zoneDef(zi.zoneId).levels[0] - 1;
    if (Array.isArray(ov?.camps)) {
      return ov.camps.map(c => this.makeCamp(c.x, c.z, c.r, c.mobs, base)).filter(Boolean);
    }
    return (zi.world.spawnZones || SPAWN_ZONES)
      .map(zone => this.makeCamp(zone.center[0] + 0.5, zone.center[1] + 0.5,
        zone.radius, { [zone.mob]: zone.count }, base))
      .filter(Boolean);
  }

  // Reconstruit les camps À CHAUD (PUT des overrides) : chaque monstre vivant
  // est rattaché au nouveau camp qui le couvre (position + quota) ; l'orphelin
  // d'un camp supprimé s'efface, sauf s'il est déjà au combat — « plus de
  // spawn là » est effectif immédiatement.
  refreshCamps(zi, ov) {
    zi.camps = this.buildIslandCamps(zi, ov);
    for (const e of [...zi.entities.values()]) {
      if (e.kind !== C.KIND.MOB || e.dead) continue;
      const wasCamped = !!e.camp;
      e.camp = null;
      const camp = zi.camps.find(c =>
        (c.aliveBy[e.defId] || 0) < (c.quota[e.defId] || 0)
        && Math.hypot(c.x - e.x, c.z - e.z) <= c.radius + 2);
      if (camp) {
        e.camp = camp;
        camp.alive++;
        camp.aliveBy[e.defId] = (camp.aliveBy[e.defId] || 0) + 1;
      } else if (wasCamped && !e.target) {
        zi.remove(e);
      }
    }
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
  // Le spawn SUIT le mouvement (témoignages T4C) : les camps proches d'un
  // joueur sont servis en priorité — le bestiaire étant vaste, arroser les
  // camps déserts de l'autre bout de la carte gaspillerait le budget.
  maybeSpawn(zi, now) {
    if (!zi.camps.length || now > zi.hotUntil || now < zi.nextSpawnAt) return;
    zi.nextSpawnAt = now + SPAWN_INTERVAL_MS / 1000;
    let open = zi.camps.filter(c => c.alive < c.cap);
    if (!open.length) return;
    const minDist = zi.isCave ? C.SPAWN_MIN_PLAYER_DIST_CAVE : C.SPAWN_MIN_PLAYER_DIST;
    const players = [];
    for (const p of this.players.values()) {
      if (p.zi === zi && !p.dead) players.push(p);
    }
    const near = open.filter(c =>
      players.some(p => Math.hypot(p.x - c.x, p.z - c.z) <= C.AOI_RADIUS + c.radius));
    if (near.length) open = near;
    for (let attempt = 0; attempt < SPAWN_TRIES_PER_TICK; attempt++) {
      const camp = open[Math.floor(Math.random() * open.length)];
      const a = Math.random() * Math.PI * 2, d = Math.random() * camp.radius;
      const x = camp.x + Math.cos(a) * d, z = camp.z + Math.sin(a) * d;
      if (!zi.world.isWalkable(x, z)) continue;
      if (players.some(p => Math.hypot(p.x - x, p.z - z) < minDist)) continue;
      const defId = this.pickCampMob(camp);
      if (!defId) continue;
      const m = this.spawnMob(zi, defId, x, z, camp.base);
      m.camp = camp;
      camp.alive++;
      if (camp.aliveBy) camp.aliveBy[defId] = (camp.aliveBy[defId] || 0) + 1;
      return;
    }
  }

  // Quel monstre faire apparaître dans ce camp ? Avec quota (camps d'île,
  // édités ou par défaut) : tirage parmi les monstres sous leur quota. Sans
  // quota (camps de caverne, capacité globale) : tirage libre dans le thème.
  pickCampMob(camp) {
    if (camp.quota) {
      const open = camp.defIds.filter(d => (camp.aliveBy[d] || 0) < camp.quota[d]);
      return open.length ? open[Math.floor(Math.random() * open.length)] : null;
    }
    return camp.defIds[Math.floor(Math.random() * camp.defIds.length)];
  }

  spawnMob(zi, defId, x, z, zoneBase) {
    const def = MOBS[defId];
    const sc = C.scaleMob(def, zoneBase);
    const m = new Mob(this.nextId++, defId, def, sc, x, z, this.now());
    zi.add(m);
    return m;
  }

  // Peuple la zone en PNJ : les emplacements par défaut du worldgen (carte
  // fixe ou marchand du village), retouchés par les overrides `npcs` —
  // remove (retirés), move (déplacés), edit (définition retouchée) — plus les
  // PNJ créés de toutes pièces (add). Rétrocompatible : sans overrides, les
  // PNJ de zones.json restent tels quels.
  spawnNpc(zi, ov = null) {
    const o = ov?.npcs || {};
    const removed = new Set(Array.isArray(o.remove) ? o.remove : []);
    const moved = new Map((Array.isArray(o.move) ? o.move : []).map(m => [m.npcId, m]));
    const edits = o.edit || {};
    const list = [];
    for (const spot of defaultNpcSpots(zi.world)) {
      if (removed.has(spot.npcId)) continue;
      const base = content.npc[spot.npcId] || content.npc.merchant;
      const at = moved.get(spot.npcId) || spot;
      list.push({ npcId: spot.npcId, def: this.npcDefWithPatch(base, edits[spot.npcId]), x: +at.x, z: +at.z });
    }
    for (const a of Array.isArray(o.add) ? o.add : []) {
      if (!a || !a.id || !Number.isFinite(+a.x) || !Number.isFinite(+a.z)) continue;
      list.push({ npcId: String(a.id), def: this.npcDefWithPatch(content.npc.merchant, a), x: +a.x, z: +a.z });
    }
    for (const e of list) {
      let { x, z } = e, tries = 0;
      while (!zi.world.isWalkable(x, z) && tries++ < 30) { x += 0.7; }
      zi.add(new NPC(this.nextId++, e.npcId, e.def, x, z));
    }
  }

  // définition effective d'un PNJ : base de zones.json + champs édités
  npcDefWithPatch(base, patch) {
    if (!patch) return base;
    const def = { ...base };
    for (const f of NPC_EDITABLE_FIELDS) {
      if (patch[f] != null) def[f] = patch[f];
    }
    return def;
  }

  // Applique les overrides d'une zone À CHAUD (PUT de l'admin) : le monde est
  // reconstruit (tuiles/décors), les camps rebranchés, les PNJ respawnés.
  applyZoneEdits(zoneId, ov) {
    const def = content.zones[zoneId];
    const zi = this.island(zoneId);
    if (!def || !zi) return;
    zi.world = applyOverrides(generateWorld(def.seed, def.map), ov);
    this.refreshCamps(zi, ov);
    for (const e of [...zi.entities.values()]) {
      if (e.kind === C.KIND.NPC) zi.remove(e);
    }
    this.spawnNpc(zi, ov);
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
    const p = new Player(this.nextId++, ws, accountId, isAdmin, data);
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
    this.leaveParty(p); // la déconnexion fait quitter le groupe
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
    p.save();
    this.send(p, { t: 'info', text: `Vous pénétrez dans ${zi.caveName}. L'obscurité vous enveloppe...` });
  }

  leaveCave(p) {
    const back = p.zi.returnTo;
    this.movePlayerToZone(p, this.island(back.zoneId), back.x, back.z);
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
          // un PNJ à portée d'oreille peut réagir aux mots-clés (quêtes T4C)
          handleNpcKeywords(this, p, rawText);
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
        p.reincarnate(this, msg.stats, msg.sex === 'female' ? 'female' : 'male');
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

  // ---------- Marchands et enseignants ----------
  // premier PNJ à portée d'interaction qui passe le filtre
  nearbyNpc(p, accepts = () => true) {
    for (const e of p.zi.nearby(p.x, p.z, C.INTERACT_RANGE + 1)) {
      if (e.kind === C.KIND.NPC && accepts(e)) return e;
    }
    return null;
  }

  // marchand généraliste (objets, compétences, rachat) — ni enseignant ni bavard
  nearbyMerchant(p) {
    return this.nearbyNpc(p, n => !this.isTeacher(n) && !this.isTalker(n));
  }

  // Le rôle d'un PNJ : `role` explicite des overrides ('merchant' | 'teacher'
  // | 'bavard'), sinon le drapeau historique `teacher` de zones.json.
  isTeacher(npc) {
    return npc.def.role ? npc.def.role === 'teacher' : !!npc.def.teacher;
  }

  // un bavard ne tient pas boutique : il salue, et réagit aux mots-clés
  isTalker(npc) {
    return npc.def.role === 'bavard';
  }

  // Qui enseigne quoi : un répertoire `teaches` édité fait foi ; sinon un sort
  // avec `vendor` n'est vendu QUE par ce PNJ, et les autres sorts restent
  // vendus par les marchands généralistes de leur zone.
  npcSellsSpell(p, npc, sp) {
    if (sp.todo) return false;
    if (Array.isArray(npc.def.teaches)) return npc.def.teaches.includes(sp.id);
    if (sp.vendor) return sp.vendor === npc.npcId;
    return !this.isTeacher(npc) && !this.isTalker(npc) && sp.zone <= p.zi.zoneId;
  }

  // Quels objets ce PNJ vend-il ? Un étal `sells` édité fait foi ; sinon la
  // règle historique : tout marchand généraliste vend le standard de la zone.
  npcSellsItem(npc, defId, zid) {
    const d = ITEMS[defId];
    if (!d || d.slot === 'gold' || d.legacy) return false;
    if (Array.isArray(npc.def.sells)) return npc.def.sells.includes(defId);
    if (this.isTeacher(npc) || this.isTalker(npc)) return false;
    return d.zone != null && d.zone <= Math.min(zid, 3);
  }

  // salut du PNJ : phrase d'ambiance + indice des mots-clés racine (T4C)
  npcGreet(p, npc) {
    const lines = Array.isArray(npc.def.greetings) && npc.def.greetings.length
      ? npc.def.greetings : ['...'];
    let line = lines[Math.floor(Math.random() * lines.length)];
    const hint = rootKeywordsHint(npc.def);
    if (hint) line += ' ' + hint;
    this.eventNear(p, { t: 'say', id: npc.id, text: line, npc: true });
  }

  openShop(p, npc) {
    // un bavard ne tient pas boutique : il salue (et ses mots-clés font le reste)
    if (this.isTalker(npc)) { this.npcGreet(p, npc); return; }
    const zid = p.zi.zoneId;
    const disc = 1 - (p.skillFx?.discount || 0);
    const reqNames = { str: 'For', end: 'End', agi: 'Agi', int: 'Int', wis: 'Sag' };
    // un enseignant ne tient pas d'étal : ni objets ni compétences, ses sorts seulement
    const teacher = this.isTeacher(npc);
    const items = teacher ? [] : Object.entries(ITEMS)
      .filter(([defId]) => this.npcSellsItem(npc, defId, zid))
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
    const spellList = content.spells.filter(s => this.npcSellsSpell(p, npc, s))
      .map(s => ({
        ...s,
        price: Math.round(s.price * disc),
        known: p.spells.includes(s.id),
        reqMet: spells.spellReqMet(p, s) === true,
        reqText: spells.spellReqText(s),
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
    this.npcGreet(p, npc);
    this.send(p, { t: 'shop', npcId: npc.id, name: npc.name, items, spells: spellList, skills });
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
      const def = ITEMS[msg.id];
      if (!def) return;
      // un PNJ proche doit avoir cet article à son étal (édité ou standard de zone)
      if (!this.nearbyNpc(p, n => this.npcSellsItem(n, msg.id, zid))) {
        this.send(p, { t: 'info', text: 'Personne ici ne vend cet article.' });
        return;
      }
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
      const req = spells.spellReqMet(p, sp);
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
      p.recompute(this);
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
    p.recompute(this);
    this.send(p, { t: 'loot', text: `Vendu : ${itemLabel(item)} (+${price} or)` });
    this.sendSelf(p);
  }

  // La cible (joueur ou monstre) est-elle intouchable (Sanctuaire) ?
  isUntouchable(e) { return (e.sanctuaryUntil || 0) > this.now(); }

  // Le joueur est-il en transe (Sanctuaire) : ni attaque ni sort pendant 2x la durée
  isPacified(p) { return (p.pacifiedUntil || 0) > this.now(); }

  // Malédiction / Peste : la cible ne peut plus être soignée (sorts, potions, drains)
  isCursed(e) { return (e.curseUntil || 0) > this.now(); }

  // ---------- Sorts (système complet dans spells.js) ----------
  castSpell(p, msg) { spells.castSpell(this, p, msg); }

  killMob(m, killer) {
    m.dead = true; m.state = C.ST.DEAD; m.hp = 0; m.target = null; m.path = null;
    m.curseUntil = 0; m.slowUntil = 0;
    this.eventNear(m, { t: 'fx', kind: 'die', id: m.id }); // râle + poussière côté client
    m.hideAt = this.now() + 6;
    // la place se libère au camp : le spawn par mouvement pourra la repourvoir
    if (m.camp) {
      m.camp.alive--;
      if (m.camp.aliveBy) m.camp.aliveBy[m.defId] = Math.max(0, (m.camp.aliveBy[m.defId] || 0) - 1);
      m.camp = null;
    }
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
      r.grantXp(C.mobXpReward(mob.level, r.level) * fraction * bonus / recipients.length, this);
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
    const d = new Drop(this.nextId++, payload.gold ? 'or' : payload.item.defId,
      payload.gold, payload.item, x, z, this.now() + ttl);
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

    for (const p of this.players.values()) p.tick(this, now, dt);

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
          if (hasPlayers || e.dead) e.tick(this, now, dt);
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
