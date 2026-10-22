// Effets actifs (buffs et malédictions) : icône, nom, jauge et décompte local
// entre deux messages `self` (le serveur ne renvoie que le temps restant).
import { uiStore } from '../../ui-store.js';
import { icone } from '../../icones.js';

// stat -> [icône SVG, nom]
export const BUFFS = {
  def: ['bouclier', 'Armure'], speed: ['vent', 'Hâte'], dmg: ['epee', 'Instinct de combat'],
  regen: ['coeur', 'Régénération'], manaregen: ['goutte', 'Afflux de mana'], maxhp: ['coeur', 'Bénédiction'],
  str: ['haltere', 'Force de la terre'], light: ['ampoule', 'Lumière'], int: ['etoile', 'Esprit clair'],
  wis: ['lune', 'Tranquillité'], agi: ['vent', 'Dextérité'], spellpow: ['etincelle', 'Afflux de mana'],
  retort: ['flamme', 'Bouclier élémentaire'], resistAll: ['bouclier', 'Bouclier de mana'],
  resist_feu: ['flamme', 'Résistance au feu'], resist_eau: ['flocon', 'Résistance à la glace'],
  sanctuaire: ['bouclier', 'Sanctuaire (intouchable)'], transe: ['sablier', 'Transe (ni attaque ni sort)'],
  maudit: ['crane', 'Maudit (soins impossibles)'],
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
        const [ico, nom] = BUFFS[b.stat] || ['etincelle', b.stat];
        return { stat: b.stat, icone: icone(ico, { taille: 14 }), nom, reste, nefaste: NEFASTES.has(b.stat), pct: durees[b.stat] ? 100 * reste / durees[b.stat] : 0 };
      }).filter(b => b.reste > 0);
    },
  };
}
