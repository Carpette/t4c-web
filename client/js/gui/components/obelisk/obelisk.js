import { uiStore } from '../../ui-store.js';
import { globalBus } from '../../../event-bus.js';

export function ObeliskController() {
  return {
    state: uiStore,
    get obelisk() {
      return this.state.obelisk;
    },
    get s() {
      return this.state.player;
    },
    get broke() {
      if (!this.s || !this.obelisk) return true;
      return (this.s.gold ?? 0) < this.obelisk.cost;
    },
    closePanel() {
      this.state.panels['obelisk-panel'] = false;
      const el = document.getElementById('obelisk-panel');
      if (el) el.classList.add('hidden');
    },
    teleportLocal(i) {
      this.closePanel();
      globalBus.emit('ui:send-packet', { t: 'teleport_local', i });
    },
    teleport(zoneId) {
      this.closePanel();
      globalBus.emit('ui:send-packet', { t: 'teleport', zoneId });
    }
  };
}