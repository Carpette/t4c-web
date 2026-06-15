import { uiStore } from '../../ui-store.js';
import { globalBus } from '../../../event-bus.js';

export function PartyInviteController() {
  return {
    state: uiStore,
    _inviteTimer: null,
    onMounted() {
      clearTimeout(this._inviteTimer);
      this._inviteTimer = setTimeout(() => {
        this.close();
      }, 15000); // Expiration de l'invitation (15s)
    },
    close() {
      this.state.partyInvite = null;
      const el = document.getElementById('party-invite');
      if (el) el.classList.add('hidden');
    },
    accept() {
      globalBus.emit('ui:send-packet', { t: 'party_accept' });
      this.close();
    },
    decline() {
      globalBus.emit('ui:send-packet', { t: 'party_decline' });
      this.close();
    }
  };
}