// Barre de sorts : seuls les sorts dotés d'un RACCOURCI y figurent (les autres
// restent dans le panneau Sorts, S). Clic : sort actif du mode combat.
import { uiStore, rawUiContainer } from '../../ui-store.js';
import { SPELL_ICONS, icone } from '../../icones.js';

export function SpellbarController() {
  return {
    state: uiStore,
    get sorts() {
      const hotkeys = uiStore.hotkeys || {};
      return (uiStore.player.spells || [])
        .map(id => uiStore.spellDefs.find(s => s.id === id))
        .filter(Boolean)
        .map(sp => ({ ...sp, touche: Object.keys(hotkeys).find(k => hotkeys[k] === sp.id) }))
        .filter(sp => sp.touche);
    },
    icone(sp) {
      const ui = rawUiContainer.instance;
      return ui ? ui.spellIconHtml(sp) : icone(SPELL_ICONS[sp.type] || 'etincelle');
    },
    // secondes de recharge restantes (0 : prêt)
    recharge(id) {
      const left = (uiStore.cds[id] || 0) - uiStore.now;
      return left > 0 ? Math.ceil(left) : 0;
    },
    basculer(id) {
      uiStore.activeSpell = uiStore.activeSpell === id ? null : id;
    },
  };
}
