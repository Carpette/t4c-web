// Barre de potions (raccourcis P / M) : compte des potions de l'inventaire.
import { uiStore, rawUiContainer } from '../../ui-store.js';
import { ITEMS } from '../../../../../shared/defs.js';

const POTIONS = [
  { kind: 'vie', key: 'P', defId: 'potion_vie', name: 'Potion de vie', match: (d) => d.heal },
  { kind: 'mana', key: 'M', defId: 'potion_mana', name: 'Potion de mana', match: (d) => d.mana },
];

export function QuickbarController() {
  return {
    get potions() {
      const inv = uiStore.player.inventory || [];
      return POTIONS.map(q => ({
        ...q,
        count: inv.filter(it => { const d = ITEMS[it.defId]; return d?.slot === 'use' && q.match(d); }).length,
      }));
    },
    icone(defId) { return rawUiContainer.instance?.itemIconUrl(defId, 28) || ''; },
    boire(kind) { rawUiContainer.instance?.usePotion(kind); },
  };
}
