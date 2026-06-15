import { uiStore, rawUiContainer } from '../../ui-store.js';
import { globalBus } from '../../../event-bus.js';

const SLOT_ICONS = { weapon: '⚔️', shield: '🛡️', armor: '🥋', helmet: '⛑️', legs: '👖', gloves: '🧤', belt: '🎗️', boots: '🥾', ring: '💍', ring2: '💍', amulet: '📿', use: '🧪', gold: '🟡' };

export function BankController() {
  return {
    state: uiStore,
    get bank() {
      return this.state.bank;
    },
    get s() {
      return this.state.player;
    },
    get inventory() {
      return this.s ? this.s.inventory : [];
    },
    get bankFull() {
      return this.bank ? this.bank.items.length >= this.bank.max : false;
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
    deposit(iid) {
      globalBus.emit('ui:send-packet', { t: 'bank_deposit', iid });
    },
    withdraw(iid) {
      globalBus.emit('ui:send-packet', { t: 'bank_withdraw', iid });
    }
  };
}