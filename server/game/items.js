// Génération d'instances d'objets, prix, poids et tirage de butin
import { ITEMS, QUALITY, AFFIXES } from '../../shared/defs.js';

let nextIid = 1;
export function setNextIid(n) { nextIid = Math.max(nextIid, n); }

const FLAT_STATS = ['str', 'end', 'agi', 'int', 'wis'];

// Multiplicateur de puissance/prix selon la zone d'origine (objets génériques
// uniquement — les armes T4C authentiques ont des stats et prix fixes)
export function zoneMult(z) { return 1 + 0.55 * (z || 0); }

export function rollQuality(rand) {
  const r = rand();
  if (r < 0.04) return 2;       // rare
  if (r < 0.18) return 1;       // magique
  return 0;
}

// z = zone d'origine (ignorée pour les objets `fixed`)
export function makeItem(defId, rand = Math.random, z = 0) {
  const def = ITEMS[defId];
  if (!def) return null;
  const zz = def.fixed ? 0 : (z || 0);
  const item = { iid: nextIid++, defId, q: 0, z: zz, bonus: {} };
  if (def.slot !== 'use' && def.slot !== 'gold') {
    item.q = rollQuality(rand);
    const n = QUALITY[item.q].bonusCount;
    for (let i = 0; i < n; i++) {
      const [stat, lo, hi] = AFFIXES[Math.floor(rand() * AFFIXES.length)];
      const amp = def.fixed ? 1 : Math.ceil(zoneMult(zz));
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
  const qMult = QUALITY[item.q || 0].mult;
  const mult = qMult * (def.fixed ? 1 : zoneMult(item.z));
  const bonus = { ...(item.bonus || {}) };
  for (const st of FLAT_STATS) {
    if (def[st]) bonus[st] = (bonus[st] || 0) + Math.round(def[st] * (def.fixed ? 1 : zoneMult(item.z)));
  }
  // armes authentiques : fourchette de dégâts T4C (la qualité bonifie un peu)
  const dmgMin = def.dmgMin != null ? Math.round(def.dmgMin * qMult) : (def.dmg ? Math.round(def.dmg * mult * 0.85) : 0);
  const dmgMax = def.dmgMax != null ? Math.round(def.dmgMax * qMult) : (def.dmg ? Math.round(def.dmg * mult * 1.15) : 0);
  return {
    dmgMin, dmgMax,
    dmg: Math.round((dmgMin + dmgMax) / 2),
    def: def.def ? Math.round(def.def * mult) : 0,
    speed: def.speed || null,
    heal: def.heal ? Math.round(def.heal * (def.fixed ? 1 : zoneMult(item.z))) : 0,
    mana: def.mana ? Math.round(def.mana * (def.fixed ? 1 : zoneMult(item.z))) : 0,
    weight: def.weight || 0,
    req: def.req || null,
    bonus,
  };
}

export function itemPrice(item) {
  const def = ITEMS[item.defId];
  const zm = def.fixed ? 1 : Math.pow(zoneMult(item.z), 2.6);
  return Math.round(def.price * QUALITY[item.q || 0].mult * zm);
}

export function itemWeight(item) {
  return ITEMS[item.defId]?.weight || 0;
}

export function inventoryWeight(inventory) {
  let w = 0;
  for (const it of inventory) w += itemWeight(it);
  return Math.round(w * 10) / 10;
}

// Tire le butin d'un mob : retourne [{gold} | {item}]
export function rollDrops(mobDef, rand = Math.random, zone = 0, lootBonus = 0) {
  const out = [];
  // l'or suit exactement la courbe des prix du marchand (zoneMult^2.6)
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
