// Panneau Joueurs (O) : aventuriers en ligne (message serveur `who`), invitation de groupe.
import { uiStore } from '../../ui-store.js';
import { globalBus } from '../../../event-bus.js';
import { icone } from '../../icones.js';

export function JoueursController() {
  return {
    state: uiStore,
    iconeGroupe: icone('groupe', { taille: 13 }),
    pluriel: (n) => `${n} aventurier${n > 1 ? 's' : ''} en ligne`,
    rafraichir() { globalBus.emit('ui:send-packet', { t: 'who' }); },
    inviter(name) { globalBus.emit('ui:send-packet', { t: 'party_invite', name }); },
  };
}
