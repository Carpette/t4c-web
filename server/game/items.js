// Génération d'instances d'objets et tirage de butin
import { ITEMS, QUALITY, AFFIXES } from '../../shared/defs.js';

let nextIid = 1;
export function setNextIid(n) { nextIid = Math.max(nextIid, n); }

export function rollQuality(rand) {
  const r = rand();
  if (r < 0.04) return 2;       // rare
  if (r < 0.18) return 1;       // magique
  return 0;
}

export function makeItem(defId, rand = Math.random) {
  const def = ITEMS[defId];
  if (!def) return null;
  const item = { iid: nextIid++, defId, q: 0, bonus: {} };
  if (def.slot !== 'use' && def.slot !== 'gold') {
    item.q = rollQuality(rand);
    const n = QUALITY[item.q].bonusCount;
    for (let i = 0; i < n; i++) {
      const [stat, lo, hi] = AFFIXES[Math.floor(rand() * AFFIXES.length)];
      item.bonus[stat] = (item.bonus[stat] || 0) + lo + Math.floor(rand() * (hi - lo + 1));
    }
  }
  return item;
}

export function itemLabel(item) {
  const def = ITEMS[item.defId];
  const q = QUALITY[item.q || 0];
  let name = def.name;
  if (q.name) name += ` ${q.name}`;
  const bonuses = Object.entries(item.bonus || {});
  if (bonuses.length) name += ' (+' + bonuses.map(([s, v]) => `${v} ${s}`).join(', +') + ')';
  return name;
}

// Statistiques effectives d'un objet (qualité appliquée)
export function itemStats(item) {
  const def = ITEMS[item.defId];
  const mult = QUALITY[item.q || 0].mult;
  return {
    dmg: def.dmg ? Math.round(def.dmg * mult) : 0,
    def: def.def ? Math.round(def.def * mult) : 0,
    speed: def.speed || null,
    bonus: item.bonus || {},
  };
}

// Tire le butin d'un mob : retourne [{defId, qty} | item]
export function rollDrops(mobDef, rand = Math.random) {
  const out = [];
  for (const [defId, chance, lo, hi] of mobDef.drops) {
    if (rand() < chance) {
      if (defId === 'or') {
        out.push({ gold: lo + Math.floor(rand() * (hi - lo + 1)) });
      } else {
        out.push({ item: makeItem(defId, rand) });
      }
    }
  }
  return out;
}
