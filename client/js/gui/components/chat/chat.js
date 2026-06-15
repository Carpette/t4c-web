import { uiStore } from '../../ui-store.js';
import { globalBus } from '../../../event-bus.js';

export function ChatController() {
  return {
    state: uiStore,
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