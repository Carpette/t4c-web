import { uiStore } from '../../ui-store.js';
import { STAT_NAMES, STATS, hpRegenPerSec, manaRegenPerSec } from '../../../../../shared/constants.js';
import { globalBus } from '../../../event-bus.js';

const ELEMENT_NAMES = {
  fire: 'Feu 🔥',
  water: 'Eau / Glace ❄️',
  earth: 'Terre ⛰️',
  air: 'Air / Foudre 🌪️',
  light: 'Lumière ☀️',
  dark: 'Ténèbres 🌑',
  arcane: 'Arcane 🔮'
};

export function CharacterController() {
  return {
    state: uiStore,
    STATS,
    STAT_NAMES,
    ELEMENT_NAMES,

    get s() {
      return this.state.player;
    },

    get xpPct() {
      if (!this.s) return 0;
      const xpCur = this.s.xpCur || 0;
      const xpNext = this.s.xpNext || 1;
      const totalXpForLevel = Math.max(1, xpNext - xpCur);
      const currentXpInLevel = Math.max(0, this.s.xp - xpCur);
      return Math.min(100, (currentXpInLevel / totalXpForLevel) * 100);
    },

    get currentXpInLevel() {
      if (!this.s) return 0;
      return Math.max(0, this.s.xp - (this.s.xpCur || 0));
    },

    get totalXpForLevel() {
      if (!this.s) return 1;
      return Math.max(1, (this.s.xpNext || 1) - (this.s.xpCur || 0));
    },

    getBuffPower(statName) {
      if (!this.s || !this.s.buffs) return 0;
      const buff = this.s.buffs.find(b => b.stat === statName);
      return buff ? buff.power : 0;
    },

    get tempHpBoost() {
      return this.getBuffPower('hp_boost') || this.getBuffPower('maxhp');
    },

    get baseMaxHp() {
      if (!this.s) return 1;
      return Math.max(1, this.s.maxHp - this.tempHpBoost);
    },

    get tempMpBoost() {
      return this.getBuffPower('mp_boost') || this.getBuffPower('maxmp');
    },

    get baseMaxMana() {
      if (!this.s) return 0;
      return Math.max(0, this.s.maxMana - this.tempMpBoost);
    },

    get totalDefense() {
      if (!this.s) return 0;
      return this.s.defense || 0;
    },

    get tempDefBoost() {
      return this.getBuffPower('def');
    },

    get baseDefense() {
      return Math.max(0, this.totalDefense - this.tempDefBoost);
    },

    // HP regen
    get baseHpRegen() {
      if (!this.s) return 0;
      return hpRegenPerSec(this.s.eff);
    },

    get finalHpRegen() {
      if (!this.s) return 0;
      const hpRegenMul = this.s.skillFx?.hpRegenMul || 0;
      const tempHpRegenBoost = this.s.buffRegen || 0;
      return this.baseHpRegen * (1 + hpRegenMul) + tempHpRegenBoost;
    },

    get hpRegenBoostVal() {
      return this.finalHpRegen - this.baseHpRegen;
    },

    // MP regen
    get baseMpRegen() {
      if (!this.s) return 0;
      return manaRegenPerSec(this.s.eff);
    },

    get finalMpRegen() {
      if (!this.s) return 0;
      const mpRegenMul = this.s.skillFx?.mpRegenMul || 0;
      const tempMpRegenBoost = this.getBuffPower('manaregen');
      return this.baseMpRegen * (1 + mpRegenMul) + tempMpRegenBoost;
    },

    get mpRegenBoostVal() {
      return this.finalMpRegen - this.baseMpRegen;
    },

    formatVal(v, decimals = 1) {
      return Number.isInteger(v) ? String(v) : v.toFixed(decimals);
    },

    getStatBoost(st) {
      if (!this.s) return 0;
      const base = this.s.stats[st];
      const eff = this.s.eff[st];
      return eff - base;
    },

    allocateStat(st) {
      globalBus.emit('ui:send-packet', { t: 'alloc', stat: st });
    }
  };
}