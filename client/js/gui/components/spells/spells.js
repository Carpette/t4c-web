import { uiStore, rawUiContainer } from '../../ui-store.js';

const SPELL_ICONS = { bolt: '⚡', heal: '💚', aoe: '🔥', buff: '✨' };

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
      return ui ? ui.spellIconHtml(sp) : (SPELL_ICONS[sp.type] || '✨');
    },
    getHotkey(spellId) {
      const hotkeys = this.state.hotkeys || {};
      return Object.keys(hotkeys).find(k => hotkeys[k] === spellId);
    },
    toggleActiveSpell(spellId) {
      const ui = rawUiContainer.instance;
      this.state.activeSpell = this.state.activeSpell === spellId ? null : spellId;
      if (ui) ui.renderSpellbar();
    },
    startBinding(spellId) {
      this.state.bindingSpell = spellId;
    }
  };
}