import { uiStore, rawUiContainer } from '../../ui-store.js';
import { SPELL_ICONS, icone } from '../../icones.js';

export function SpellsController() {
  return {
    state: uiStore,
    get s() {
      return this.state.player;
    },
    get knownSpells() {
      const ui = rawUiContainer.instance;
      if (!ui || !this.s) return [];
      return (this.s.spells || []).map(id => ui.spellDef(id)).filter(Boolean);
    },
    get bindingError() {
      return this.state.bindingError;
    },
    getSpellIconHtml(sp) {
      const ui = rawUiContainer.instance;
      return ui ? ui.spellIconHtml(sp) : icone(SPELL_ICONS[sp.type] || 'etincelle');
    },
    getHotkey(spellId) {
      const hotkeys = this.state.hotkeys || {};
      return Object.keys(hotkeys).find(k => hotkeys[k] === spellId);
    },
    toggleActiveSpell(spellId) {
      this.state.activeSpell = this.state.activeSpell === spellId ? null : spellId;
    },
    startBinding(spellId) {
      this.state.bindingSpell = spellId;
    }
  };
}