// Connexion WebSocket + décodage du protocole
import { decodeSnapshot, BIN_SNAPSHOT } from '../../shared/protocol.js';

export class Net {
  constructor() {
    this.handlers = {};
    this.ws = null;
  }
  on(type, fn) { this.handlers[type] = fn; }
  emit(type, data) { this.handlers[type]?.(data); }

  connect() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.ws = new WebSocket(`${proto}//${location.host}`);
    this.ws.binaryType = 'arraybuffer';
    this.ws.onmessage = (ev) => {
      if (ev.data instanceof ArrayBuffer) {
        const v = new DataView(ev.data);
        if (v.getUint8(0) === BIN_SNAPSHOT) this.emit('snapshot', decodeSnapshot(ev.data));
        return;
      }
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      this.emit(msg.t, msg);
    };
    this.ws.onclose = () => this.emit('disconnected');
    this.ws.onerror = () => this.emit('disconnected');
    return new Promise((resolve) => { this.ws.onopen = resolve; });
  }

  send(obj) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(obj));
  }
}
