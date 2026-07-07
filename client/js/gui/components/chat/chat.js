// Chat : messages, saisie, et gestion des canaux de discussion.
// Les ABONNEMENTS viennent du serveur (uiStore.channels, commandes .canal) ;
// les COULEURS et la VISIBILITÉ dans le général sont des préférences LOCALES
// (localStorage), sans aucun effet pour les autres joueurs.
import { uiStore } from '../../ui-store.js';
import { globalBus } from '../../../event-bus.js';

const LS = typeof localStorage !== 'undefined' ? localStorage : { getItem: () => null, setItem: () => {} };
function loadPrefs(key, fallback) {
  try { return JSON.parse(LS.getItem(key)) || fallback; } catch { return fallback; }
}

const DEFAULT_COLORS = { general: '#9ad4ff', aide: '#9fe6a0', ventes: '#ffd24a', roleplay: '#d0a8ff', groupe: '#7ee8e0' };

export function ChatController() {
  return {
    state: uiStore,
    showChans: false, newChan: '', newPrive: false,
    chanColors: loadPrefs('t4c:chanColors', {}),
    chanHidden: loadPrefs('t4c:chanHidden', {}),   // masqués du général (défaut : visibles)

    onMounted() {
      globalBus.on('ui:chat-scroll', () => {
        this.scrollToBottom();
      });
      this.scrollToBottom();
    },
    scrollToBottom() {
      const el = document.getElementById('chat-messages');
      if (el) {
        el.scrollTop = el.scrollHeight;
      }
    },
    getMessageClass(msg) {
      if (msg.from === 'sys') return 'sys';
      return msg.kind || 'local';
    },

    // ---- préférences locales : couleur et visibilité par canal ----
    colorOf(ch) { return this.chanColors[ch] || DEFAULT_COLORS[ch] || '#8fd0ff'; },
    setColor(ch, color) {
      this.chanColors = { ...this.chanColors, [ch]: color };
      LS.setItem('t4c:chanColors', JSON.stringify(this.chanColors));
    },
    isVisibleChan(ch) { return !this.chanHidden[ch]; },
    toggleVisible(ch) {
      this.chanHidden = { ...this.chanHidden, [ch]: !this.chanHidden[ch] };
      LS.setItem('t4c:chanHidden', JSON.stringify(this.chanHidden));
    },
    isVisible(msg) { return !msg.channel || !this.chanHidden[msg.channel]; },

    // ---- abonnements (serveur) : le panneau envoie les commandes .canal ----
    myChannels() { return (uiStore.channels || []).filter(c => c.joined); },
    joinable() { return (uiStore.channels || []).filter(c => !c.joined); },
    join(name) { globalBus.emit('ui:send-chat', `.canal rejoindre ${name}`); },
    leave(name) { globalBus.emit('ui:send-chat', `.canal quitter ${name}`); },
    create() {
      const name = this.newChan.trim().toLowerCase();
      if (!name) return;
      globalBus.emit('ui:send-chat', `.canal creer ${name}${this.newPrive ? ' prive' : ''}`);
      this.newChan = ''; this.newPrive = false;
    },

    onKeyDown(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        const text = this.state.chat.input.trim();
        if (text) {
          globalBus.emit('ui:send-chat', text);
          this.state.chat.input = '';
        }
        e.target.blur();
      } else if (e.key === 'Escape') {
        e.target.blur();
      }
    }
  };
}
