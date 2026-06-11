// Constantes et formules de jeu — partagées serveur/client
export const TICK_RATE = 10;            // ticks serveur par seconde
export const TICK_DT = 1 / TICK_RATE;
export const MAP_SIZE = 128;            // tuiles
export const WORLD_SEED = 0x7e5f4c;     // carte déterministe
export const AOI_RADIUS = 42;           // rayon d'intérêt (unités monde)
export const MAX_PLAYERS = 256;
export const DAY_LENGTH = 600;          // secondes pour un cycle jour/nuit complet
export const ITEM_DESPAWN = 90;         // s avant disparition d'un objet au sol
export const PICKUP_RANGE = 2.2;
export const CHAT_MAX = 200;

export const STATS = ['str', 'end', 'agi', 'int', 'wis'];
export const STAT_NAMES = {
  str: 'Force', end: 'Endurance', agi: 'Agilité', int: 'Intelligence', wis: 'Sagesse',
};
export const BASE_STATS = { str: 12, end: 12, agi: 12, int: 10, wis: 10 };
export const POINTS_PER_LEVEL = 5;

// Création de personnage façon T4C : points à répartir par le joueur
export const CREATION = { base: 8, pool: 30, max: 25 };
export function validateCreationStats(s) {
  let total = 0;
  for (const st of STATS) {
    const v = s?.[st] | 0;
    if (v < CREATION.base || v > CREATION.max) return false;
    total += v;
  }
  return total === CREATION.base * STATS.length + CREATION.pool;
}
export const MAX_LEVEL = 200;

// Courbe XP façon T4C : départ rapide, exponentielle ensuite — le 200 est mythique.
// XP pour passer du niveau k au niveau k+1 :
export function xpToNext(k) {
  return Math.floor(55 * Math.pow(k, 1.9) * Math.pow(1.028, k));
}
const _cumXp = new Float64Array(MAX_LEVEL + 2);
for (let k = 1; k <= MAX_LEVEL; k++) _cumXp[k + 1] = _cumXp[k] + xpToNext(k);
export function xpForLevel(level) {
  // XP totale requise pour atteindre `level` (niveau 1 = 0)
  if (level <= 1) return 0;
  return _cumXp[Math.min(level, MAX_LEVEL + 1)];
}

// Gains PAR NIVEAU, calculés au moment du passage de niveau avec les stats
// du moment (équipement compris) — comme dans T4C : monter l'Endurance tôt
// paie sur toute la carrière du personnage.
export function hpGainPerLevel(stats) {
  return 7 + stats.end / 20;
}
export function manaGainPerLevel(stats) {
  return Math.floor(stats.wis / 60) + Math.floor(3 + stats.int / 20);
}
// Approximation rétroactive (migration d'anciens personnages, outils admin)
export function maxHp(stats, level) {
  return Math.floor(hpGainPerLevel(stats) * level);
}
export function maxMana(stats, level) {
  return manaGainPerLevel(stats) * level;
}
export function hpRegenPerSec(stats) { return 0.6 + stats.end * 0.06; }
export function manaRegenPerSec(stats) { return 0.5 + stats.wis * 0.09; }

export function enc(stats) {
  return Math.floor((stats.str * 500)/(stats.str + 100));
}

export function meleeDamage(stats, weaponDmg) {
  const base = (weaponDmg || 2) + Math.floor(stats.str / 3);
  return base;
}
export function attackCooldown(stats, weaponSpeed) {
  // weaponSpeed = secondes de base entre 2 coups
  const cd = (weaponSpeed || 1.6) * (1 - Math.min(stats.agi, 100) * 0.004);
  return Math.max(0.55, cd);
}
// Jet de toucher : seule l'esquive (Agilité) fait rater les coups.
// La CA n'intervient PAS ici — dans T4C elle absorbe les dégâts (cf. mitigate).
export function hitChance(attStats, defStats) {
  const c = 0.78 + (attStats.agi - defStats.agi) * 0.006;
  return Math.min(0.95, Math.max(0.45, c));
}
export function critChance(stats) {
  return Math.min(0.35, 0.05 + stats.agi * 0.003);
}
// Absorption T4C : la CA se SOUSTRAIT des dégâts. La qualité du coup
// détermine quelle part de la CA est contournée (30 à 80 % de la CA
// compte selon le jet) — une plate absorbe énormément face aux petits
// coups, les grosses attaques passent quand même. Minimum 1 dégât.
export function mitigate(dmg, defense, rand = Math.random) {
  const effectiveCA = defense * (0.3 + rand() * 0.5);
  return Math.max(1, Math.round(dmg - effectiveCA));
}
export function moveSpeed(stats) {
  return Math.min(6.2, 4.0 + stats.agi * 0.02);
}

export function mobXpReward(mobLevel, playerLevel) {
  const base = 18 + mobLevel * 14 + mobLevel * mobLevel * 1.1;
  const diff = mobLevel - playerLevel;
  let mult = 1 + diff * 0.12;
  mult = Math.max(0.15, Math.min(1.6, mult));
  return Math.floor(base * mult);
}

// Scaling des monstres selon le niveau de base de la zone (0, 25, 50, ...)
export function scaleMob(def, zoneBase) {
  const level = def.level + zoneBase;
  const k = 1 + zoneBase * 0.35;
  return {
    level,
    hp: Math.floor(def.hp * k * (1 + zoneBase * 0.06)),
    dmg: Math.floor(def.dmg * (1 + zoneBase * 0.22)),
    def: Math.floor(def.def * (1 + zoneBase * 0.15)),
    goldMul: 1 + zoneBase * 0.5,
  };
}

// États d'entité (champ binaire `state`)
export const ST = { IDLE: 0, WALK: 1, ATTACK: 2, DEAD: 3, HURT: 4 };
// Genres d'entité
export const KIND = { PLAYER: 0, MOB: 1, DROP: 2, NPC: 3 };
export const INTERACT_RANGE = 3.2;
