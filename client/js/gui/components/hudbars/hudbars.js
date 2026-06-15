import { uiStore } from '../../ui-store.js';

export function HudBarsController() {
  return {
    state: uiStore,
    get s() {
      return this.state.player;
    },
    get hpPct() {
      if (!this.s || !this.s.maxHp) return 0;
      return (this.s.hp / this.s.maxHp) * 100;
    },
    get manaPct() {
      if (!this.s || !this.s.maxMana) return 0;
      return (this.s.mana / this.s.maxMana) * 100;
    },
    get xpSpan() {
      if (!this.s) return 1;
      return Math.max(1, (this.s.xpNext || 1) - (this.s.xpCur || 0));
    },
    get xpInto() {
      if (!this.s) return 0;
      return Math.max(0, this.s.xp - (this.s.xpCur || 0));
    },
    get xpPct() {
      if (!this.s) return 0;
      const span = this.xpSpan;
      if (span === 0) return 0;
      return Math.min(100, (this.xpInto / span) * 100);
    }
  };
}