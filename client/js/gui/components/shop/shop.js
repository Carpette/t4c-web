import { uiStore, rawUiContainer } from '../../ui-store.js';
import { globalBus } from '../../../event-bus.js';

const SLOT_ICONS = { weapon: '⚔️', shield: '🛡️', armor: '🥋', helmet: '⛑️', legs: '👖', gloves: '🧤', belt: '🎗️', boots: '🥾', ring: '💍', ring2: '💍', amulet: '📿', use: '🧪', gold: '🟡' };
const SPELL_ICONS = { bolt: '⚡', heal: '💚', aoe: '🔥', buff: '✨' };
const ELEMS = { feu: '🔥', eau: '❄', air: '🌪', terre: '⛰', lumiere: '☀', arcane: '🌑' };

export function ShopController() {
  return {
    state: uiStore,
    tabNames: {
      items: 'Objets',
      spells: 'Sorts',
      skills: 'Compétences',
      sell: 'Vendre'
    },
    get shop() {
      return this.state.shop;
    },
    get s() {
      return this.state.player;
    },
    get inventory() {
      return this.s ? this.s.inventory : [];
    },
    isEquipped(iid) {
      if (!this.s || !this.s.equip) return false;
      return Object.values(this.s.equip).includes(iid);
    },
    getItemIconHtml(defId, slot) {
      const fallback = SLOT_ICONS[slot] || '❓';
      const ui = rawUiContainer.instance;
      return ui ? ui.itemIconHtml(defId, fallback) : '';
    },
    getSpellIconHtml(sp) {
      const ui = rawUiContainer.instance;
      return ui ? ui.spellIconHtml(sp) : (SPELL_ICONS[sp.type] || '✨');
    },
    getItemMeta(it) {
      return [
        it.dmgRange && `dégâts ${it.dmgRange}`,
        it.def && `défense ${it.def}`,
        it.heal && `+${it.heal} PV`,
        it.mana && `+${it.mana} mana`,
        it.weight && `${it.weight} kg`,
        it.reqText && `requis : ${it.reqText}`,
      ].filter(Boolean).join(' — ') || '';
    },
    getSpellMeta(sp) {
      const elEmoji = ELEMS[sp.element] || '';
      return `${elEmoji} ${sp.element || ''} — ${sp.mana} mana — requis : ${sp.reqText || '—'}`;
    },
    getSkillMeta(sk) {
      return `${sk.desc}<br>Requis : ${sk.reqText}`;
    },
    buyItem(defId) {
      globalBus.emit('ui:send-packet', { t: 'buy', kind: 'item', id: defId });
    },
    buySpell(id) {
      globalBus.emit('ui:send-packet', { t: 'buy', kind: 'spell', id });
    },
    buySkill(id) {
      globalBus.emit('ui:send-packet', { t: 'buy', kind: 'skill', id });
    },
    trainSkill(id) {
      globalBus.emit('ui:send-packet', { t: 'buy', kind: 'train', id });
    },
    sellItem(iid) {
      globalBus.emit('ui:send-packet', { t: 'sell', iid });
    }
  };
}