// Effets actifs (buffs et malédictions) : icône, nom, jauge et décompte local
// entre deux messages `self` (le serveur ne renvoie que le temps restant).
import { uiStore } from '../../ui-store.js';

export const BUFFS = {
  def: ['🛡', 'Armure'], speed: ['💨', 'Hâte'], dmg: ['⚔', 'Instinct de combat'],
  regen: ['💚', 'Régénération'], manaregen: ['💧', 'Afflux de mana'], maxhp: ['❤', 'Bénédiction'],
  str: ['💪', 'Force de la terre'], light: ['💡', 'Lumière'], int: ['🧠', 'Esprit clair'],
  wis: ['🕊', 'Tranquillité'], agi: ['🤸', 'Dextérité'], spellpow: ['🔮', 'Afflux de Mana'],
  retort: ['🔥', 'Bouclier élémentaire'], resistAll: ['🔮', 'Bouclier de mana'],
  resist_feu: ['🔥', 'Résistance au feu'], resist_eau: ['❄', 'Résistance à la glace'],
  sanctuaire: ['⛨', 'Sanctuaire (intouchable)'], transe: ['🧘', 'Transe (ni attaque ni sort)'],
  maudit: ['☠', 'Maudit (soins impossibles)'],
};
const NEFASTES = new Set(['maudit', 'transe']);

export function BuffsController() {
  const durees = {}; // stat -> plus longue durée vue (s) : base de la jauge
  return {
    get buffs() {
      const ecoule = Math.max(0, uiStore.now - uiStore.selfAt);
      return (uiStore.player.buffs || []).map(b => {
        if (!durees[b.stat] || b.left > durees[b.stat]) durees[b.stat] = b.left;
        const reste = Math.max(0, Math.round(b.left - ecoule));
        const [icone, nom] = BUFFS[b.stat] || ['✨', b.stat];
        return { stat: b.stat, icone, nom, reste, nefaste: NEFASTES.has(b.stat), pct: durees[b.stat] ? 100 * reste / durees[b.stat] : 0 };
      }).filter(b => b.reste > 0);
    },
  };
}
