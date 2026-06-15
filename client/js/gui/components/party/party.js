import { uiStore, rawUiContainer } from '../../ui-store.js';
import { globalBus } from '../../../event-bus.js';

export function PartyController() {
  return {
    state: uiStore,
    get selfId() {
      const ui = rawUiContainer.instance;
      return ui ? ui.selfId : null;
    },
    get isLeader() {
      if (!this.state.party) return false;
      return this.state.party.leaderId === this.selfId;
    },
    getHpPct(m) {
      if (m.hp == null || m.maxHp == null) return 100;
      return Math.max(0, Math.min(100, (m.hp / Math.max(1, m.maxHp)) * 100));
    },
    kick(id) {
      globalBus.emit('ui:send-packet', { t: 'party_kick', id });
    },
    leave() {
      globalBus.emit('ui:send-packet', { t: 'party_leave' });
    }
  };
}