import { uiStore } from '../../ui-store.js';
import { STAT_NAMES, STATS, hpRegenPerSec, manaRegenPerSec } from '../../../../../shared/constants.js';
import { globalBus } from '../../../event-bus.js';
import { ELEMENT_ICONS, icone } from '../../icones.js';

// clés des résistances calculées par le serveur (eff.resist_<id>)
const ELEMENTS = [
  { id: 'fire', nom: 'Feu' }, { id: 'water', nom: 'Eau et glace' }, { id: 'earth', nom: 'Terre' },
  { id: 'air', nom: 'Air et foudre' }, { id: 'light', nom: 'Lumière' }, { id: 'dark', nom: 'Ténèbres' },
  { id: 'arcane', nom: 'Arcanes' },
];

export function CharacterController() {
  return {
    state: uiStore,
    STATS,
    STAT_NAMES,
    ELEMENTS,
    or: icone('piece', { taille: 12, classe: 'ico-or' }),

    elementIcone(id) { return icone(ELEMENT_ICONS[id], { taille: 13 }); },
    // résistance en % (0,25 -> 25) ; négative = faiblesse
    resistance(id) { return Math.round((this.s?.eff?.['resist_' + id] || 0) * 100); },
    get degats() {
      if (!this.s) return '';
      return this.s.dmgMin != null && this.s.dmgMax != null ? `${this.s.dmgMin} – ${this.s.dmgMax}` : this.formatVal(this.s.dmg || 0, 0);
    },
    // compétences apprises (points > 0 ou innées), dans l'ordre du contenu
    get competences() {
      const pts = this.s?.skills || {};
      return (this.state.skillDefs || [])
        .filter(sk => pts[sk.id] != null)
        .map(sk => ({ id: sk.id, name: sk.name, desc: sk.desc, max: sk.max, pts: pts[sk.id] }));
    },

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
      if (v == null || !Number.isFinite(+v)) return '—';
      return Number.isInteger(+v) ? String(v) : (+v).toFixed(decimals);
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