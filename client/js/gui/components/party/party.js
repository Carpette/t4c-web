// Panneau de groupe : cadres des membres (PV temps réel via party_vitals),
// invitation par nom (chef, ou solo pour fonder), exclusion (chef), départ,
// et toast d'invitation reçue avec compte à rebours (GROUP_INVITE_TTL).
// Les données vivent dans uiStore (net:party-update / net:party-vitals /
// net:party-invite) ; les commandes partent par le pont 'party:cmd' de main.js.
import { uiStore } from '../../ui-store.js';
import { globalBus } from '../../../event-bus.js';

export function PartyController() {
  const ctrl = {
    showInvite: false, inviteName: '', inviteLeft: 30, _timer: null,

    get party() { return uiStore.party; },
    get invite() { return uiStore.partyInvite; },
    get isLeader() { return uiStore.party && uiStore.party.leaderId === uiStore.selfId; },

    hpStyle(m) {
      const pct = m.maxHp ? Math.max(0, Math.min(100, 100 * m.hp / m.maxHp)) : 100;
      return `width:${pct}%`;
    },

    sendInvite() {
      const name = this.inviteName.trim();
      if (!name) return;
      globalBus.emit('ui:send-packet', { t: 'party_invite', name });
      this.inviteName = '';
      this.showInvite = false;
    },
    kick(m) { globalBus.emit('ui:send-packet', { t: 'party_kick', id: m.id }); },
    leave() { globalBus.emit('ui:send-packet', { t: 'party_leave' }); this.showInvite = false; },
    accept() { globalBus.emit('ui:send-packet', { t: 'party_accept' }); uiStore.partyInvite = null; },
    decline() { globalBus.emit('ui:send-packet', { t: 'party_decline' }); uiStore.partyInvite = null; },

    // compte à rebours de l'invitation reçue (expire toute seule côté serveur)
    mounted() {
      ctrl._timer = setInterval(() => {
        const inv = uiStore.partyInvite;
        if (!inv) return;
        ctrl.inviteLeft = Math.max(0, Math.ceil((inv.until - Date.now()) / 1000));
        if (ctrl.inviteLeft <= 0) uiStore.partyInvite = null;
      }, 500);
    },
  };
  ctrl.mounted();
  return ctrl;
}
