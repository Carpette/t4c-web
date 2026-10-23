import { uiStore } from '../../ui-store.js';
import { globalBus } from '../../../event-bus.js';
import { PROTOCOL_VERSION } from '../../../../../shared/constants.js';

export function LoginController() {
  const ctrl = {
    state: uiStore,
    username: '',
    password: '',
    error: '', // saisie incomplète ; les erreurs du serveur passent par uiStore.erreurConnexion

    init() {
      // In a real scenario, you might want to focus the username input
    },

    login() {
      if (!this.username.trim() || !this.password) {
        this.error = 'Pseudo et mot de passe requis';
        return;
      }
      globalBus.emit('ui:send-packet', { t: 'login', name: this.username.trim(), pass: this.password, v: PROTOCOL_VERSION });
    },

    register() {
      if (!this.username.trim() || !this.password) {
        this.error = 'Pseudo et mot de passe requis';
        return;
      }
      globalBus.emit('ui:send-packet', { t: 'register', name: this.username.trim(), pass: this.password, v: PROTOCOL_VERSION });
    },

    handleKeydown(e) {
      if (e.key === 'Enter') {
        this.login();
      }
    },

    clearError() {
      this.error = '';
      uiStore.erreurConnexion = '';
    }
  };

  // erreur du serveur ou raison d'une déconnexion : dans le store réactif
  // (modifier `ctrl` directement ne passe pas par la réactivité de petite-vue,
  // et l'écran peut être monté avant que le message n'arrive)
  globalBus.on('gui:login-error', (text) => {
    uiStore.erreurConnexion = text;
  });

  return ctrl;
}
