// Génération d'instances d'objets et tirage de butin
import { ITEMS, QUALITY, AFFIXES } from '../../shared/defs.js';

let nextIid = 1;
export function setNextIid(n) { nextIid = Math.max(nextIid, n); }

const FLAT_STATS = ['str', 'end', 'agi', 'int', 'wis'];

// Multiplicateur de puissance/prix selon la zone d'origine de l'objet
export function zoneMult(z) { return 1 + 0.55 * (z || 0); }

export function rollQuality(rand) {
  const r = rand();
  if (r < 0.04) return 2;       // rare
  if (r < 0.18) return 1;       // magique
  return 0;
}

// z = zone d'origine (scaling) — les objets des zones hautes sont plus puissants
export function makeItem(defId, rand = Math.random, z = 0) {
  const def = ITEMS[defId];
  if (!def) return null;
  const item = { iid: nextIid++, defId, q: 0, z: z || 0, bonus: {} };
  if (def.slot !== 'use' && def.slot !== 'gold') {
    item.q = rollQuality(rand);
    const n = QUALITY[item.q].bonusCount;
    for (let i = 0; i < n; i++) {
      const [stat, lo, hi] = AFFIXES[Math.floor(rand() * AFFIXES.length)];
      const amp = Math.ceil(zoneMult(z));
      item.bonus[stat] = (item.bonus[stat] || 0) + (lo + Math.floor(rand() * (hi - lo + 1))) * amp;
    }
  }
  return item;
}

export function itemLabel(item) {
  const def = ITEMS[item.defId];
  const q = QUALITY[item.q || 0];
  let name = def.name;
  if (item.z) name += ` +${item.z}`;
  if (q.name) name += ` ${q.name}`;
  const bonuses = Object.entries(item.bonus || {});
  if (bonuses.length) name += ' (+' + bonuses.map(([s, v]) => `${v} ${s}`).join(', +') + ')';
  return name;
}

// Statistiques effectives d'un objet (qualité + zone appliquées)
export function itemStats(item) {
  const def = ITEMS[item.defId];
  const mult = QUALITY[item.q || 0].mult * zoneMult(item.z);
  const bonus = { ...(item.bonus || {}) };
  for (const st of FLAT_STATS) {
    if (def[st]) bonus[st] = (bonus[st] || 0) + Math.round(def[st] * zoneMult(item.z));
  }
  return {
    dmg: def.dmg ? Math.round(def.dmg * mult) : 0,
    def: def.def ? Math.round(def.def * mult) : 0,
    speed: def.speed || null,
    heal: def.heal ? Math.round(def.heal * zoneMult(item.z)) : 0,
    mana: def.mana ? Math.round(def.mana * zoneMult(item.z)) : 0,
    bonus,
  };
}

export function itemPrice(item) {
  const def = ITEMS[item.defId];
  return Math.round(def.price * QUALITY[item.q || 0].mult * Math.pow(zoneMult(item.z), 2.6));
}

// Tire le butin d'un mob : retourne [{gold} | {item}]
export function rollDrops(mobDef, rand = Math.random, zone = 0, lootBonus = 0) {
  const out = [];
  // l'or suit exactement la courbe des prix du marchand (zoneMult^2.6) :
  // le pouvoir d'achat par kill reste constant d'une zone à l'autre, et les
  // sorts (prix fixes) deviennent relativement plus abordables en progressant
  const goldMul = Math.pow(zoneMult(zone), 2.6);
  for (const [defId, chance, lo, hi] of mobDef.drops) {
    if (rand() < chance * (1 + lootBonus)) {
      if (defId === 'or') {
        out.push({ gold: Math.round((lo + Math.floor(rand() * (hi - lo + 1))) * goldMul) });
      } else {
        out.push({ item: makeItem(defId, rand, zone) });
      }
    }
  }
  return out;
}
