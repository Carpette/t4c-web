import { uiStore } from '../../ui-store.js';

export function HelpController() {
  return {
    state: uiStore,
    get s() {
      console.log('[HelpController] getting s:', this.state.player);
      return this.state.player;
    },
    get spellHotkeys() {
      const hotkeys = this.state.hotkeys || {};
      const spellDefs = this.state.spellDefs || [];
      const knownSpellIds = this.state.player?.spells || [];
      const spellDef = (id) => spellDefs.find(s => s.id === id);
      return Object.entries(hotkeys)
        .filter(([, spellId]) => knownSpellIds.includes(spellId))
        .map(([key, spellId]) => {
          const sp = spellDef(spellId);
          return {
            key,
            name: sp ? sp.name : 'Sort inconnu'
          };
        });
    }
  };
}