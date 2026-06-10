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
export const MAX_LEVEL = 50;

export function xpForLevel(level) {
  // XP totale requise pour atteindre `level` (niveau 1 = 0)
  if (level <= 1) return 0;
  return Math.floor(60 * Math.pow(level - 1, 2.15) + 40 * (level - 1));
}

export function maxHp(stats, level) {
  return Math.floor(40 + stats.end * 8 + stats.str * 2 + level * 6);
}
export function maxMana(stats, level) {
  return Math.floor(20 + stats.int * 6 + stats.wis * 4 + level * 3);
}
export function hpRegenPerSec(stats) { return 0.6 + stats.end * 0.06; }
export function manaRegenPerSec(stats) { return 0.5 + stats.wis * 0.09; }

export function meleeDamage(stats, weaponDmg) {
  const base = (weaponDmg || 2) + Math.floor(stats.str / 3);
  return base;
}
export function attackCooldown(stats, weaponSpeed) {
  // weaponSpeed = secondes de base entre 2 coups
  const cd = (weaponSpeed || 1.6) * (1 - Math.min(stats.agi, 100) * 0.004);
  return Math.max(0.55, cd);
}
export function hitChance(attStats, defStats) {
  const c = 0.78 + (attStats.agi - defStats.agi) * 0.006;
  return Math.min(0.95, Math.max(0.45, c));
}
export function critChance(stats) {
  return Math.min(0.35, 0.05 + stats.agi * 0.003);
}
export function mitigate(dmg, defense) {
  return Math.max(1, Math.round(dmg * (1 - defense / (defense + 60))));
}
export function moveSpeed(stats) {
  return Math.min(6.2, 4.0 + stats.agi * 0.02);
}

export function mobXpReward(mobLevel, playerLevel) {
  const base = 18 + mobLevel * 14;
  const diff = mobLevel - playerLevel;
  let mult = 1 + diff * 0.12;
  mult = Math.max(0.15, Math.min(1.6, mult));
  return Math.floor(base * mult);
}

export const DEATH_XP_LOSS = 0.03; // 3% de l'XP du niveau courant, jamais de déniveau

// États d'entité (champ binaire `state`)
export const ST = { IDLE: 0, WALK: 1, ATTACK: 2, DEAD: 3, HURT: 4 };
// Genres d'entité
export const KIND = { PLAYER: 0, MOB: 1, DROP: 2 };
