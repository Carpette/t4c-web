import { uiStore } from '../../ui-store.js';
import { globalBus } from '../../../event-bus.js';
import { PROTOCOL_VERSION } from '../../../../../shared/constants.js';

export function LoginController() {
  const ctrl = {
    state: uiStore,
    username: '',
    password: '',
    error: '',

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
    }
  };

  globalBus.on('gui:login-error', (text) => {
    ctrl.error = text;
  });

  return ctrl;
}
