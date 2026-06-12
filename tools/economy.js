// Audit de l'économie : revenu moyen par kill et par zone, comparé aux prix.
// Usage : node tools/economy.js
import { MOBS, ITEMS } from '../shared/defs.js';
import { zoneMult, itemPrice } from '../server/game/items.js';
import { mobXpReward, xpForLevel, scaleMob } from '../shared/constants.js';
import { content } from '../server/content.js';

// même formule que rollDrops
const goldMul = (z) => Math.pow(zoneMult(z), 2.6);

function mobIncome(def, zone) {
  let gold = 0;
  for (const [defId, chance, lo, hi] of def.drops) {
    if (defId === 'or') gold += chance * ((lo + hi) / 2) * goldMul(zone);
    else {
      // objet revendable au prix d'achat (qualité moyenne ~1.04)
      gold += chance * itemPrice({ defId, q: 0, z: zone }) * 1.04;
    }
  }
  return gold;
}

console.log('=== Revenu moyen par kill (or + revente du butin) ===');
console.log('zone | mult prix | ' + Object.keys(MOBS).join(' | '));
for (let z = 0; z < 8; z++) {
  const row = Object.values(MOBS).map(d => Math.round(mobIncome(d, z))).join(' | ');
  console.log(`  ${z}  |  x${Math.pow(zoneMult(z), 2.6).toFixed(1)}  | ${row}`);
}

console.log('\n=== Coût de la panoplie complète par zone (objets du marchand) ===');
for (let z = 0; z < 4; z++) {
  let total = 0;
  for (const [id, d] of Object.entries(ITEMS)) {
    if (d.zone != null && d.zone <= Math.min(z, 3) && d.slot !== 'use' && d.slot !== 'gold') {
      total += Math.round(d.price * Math.pow(zoneMult(z), 2.6));
    }
  }
  console.log(`  zone ${z} : ~${total} or (tous les objets)`);
}

console.log('\n=== Sorts : prix vs revenu de la zone où ils débloquent ===');
for (const sp of content.spells) {
  const z = sp.zone;
  const avgKill = Object.values(MOBS).reduce((s, d) => s + mobIncome(d, z), 0) / 7;
  console.log(`  ${sp.name.padEnd(28)} ${String(sp.price).padStart(7)} or  ≈ ${Math.ceil(sp.price / avgKill)} kills moyens en zone ${z}`);
}

// L'XP est versée PAR COUP : xpTotale(monstre, joueur) x dégâts / PVmax.
// Vider entièrement les PV d'un monstre rapporte donc exactement xpTotale :
// le « kill équivalent » reste la bonne unité de mesure de la progression.
console.log('\n=== Kills équivalents par palier (XP par dégâts, monstre moyen) ===');
for (let z = 0; z < 4; z++) {
  const lo = z * 25 + 1, hi = (z + 1) * 25;
  const base = z * 25;
  const avgXp = Object.values(MOBS).reduce((s, d) => s + mobXpReward(d.level + base, (lo + hi) / 2), 0) / Object.keys(MOBS).length;
  const span = xpForLevel(hi) - xpForLevel(lo);
  console.log(`  zone ${z} (niv ${lo}-${hi}) : ~${Math.round(span / avgXp)} kills équivalents pour traverser`);
}

// Rendement de l'XP par point de dégât infligé : xpTotale / PVmax du monstre.
// Utile pour calibrer les sorts et le partage de groupe (+10 %/membre, /n).
console.log('\n=== XP par point de dégât (joueur au niveau moyen de la zone) ===');
for (let z = 0; z < 4; z++) {
  const base = z * 25, mid = z * 25 + 13;
  const row = Object.entries(MOBS).map(([id, d]) => {
    const sc = scaleMob(d, base);
    return `${id}=${(mobXpReward(sc.level, mid) / sc.hp).toFixed(2)}`;
  }).join(' | ');
  console.log(`  zone ${z} : ${row}`);
}
