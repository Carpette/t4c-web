import { uiStore, rawUiContainer } from '../../ui-store.js';
import { SLOT_NAMES } from '../../../../../shared/defs.js';
import { LAYER_ORDER } from '../../../render2d/anim.js';
import { Item } from '../../../Item.js';
import { globalBus } from '../../../event-bus.js';

const SLOTS_LIST = ['helmet', 'amulet', 'weapon', 'shield', 'gloves', 'legs', 'armor', 'belt', 'boots', 'ring', 'ring2'];

const SLOT_STYLES = {
  helmet: { top: '4px', left: '4px' },
  amulet: { top: '4px', right: '4px' },
  weapon: { top: '54px', left: '4px' },
  shield: { top: '54px', right: '4px' },
  gloves: { top: '104px', left: '4px' },
  legs: { top: '104px', right: '4px' },
  armor: { bottom: '4px', left: '4px' },
  belt: { bottom: '4px', left: '33%', transform: 'translateX(-50%)' },
  boots: { bottom: '4px', left: '67%', transform: 'translateX(-50%)' },
  ring: { bottom: '4px', right: '4px' },
  ring2: { bottom: '54px', right: '4px' }
};

export function InventoryController() {
  return {
    state: uiStore,
    SLOTS_LIST,
    SLOT_STYLES,

    get s() {
      return this.state.player;
    },

    get weightPct() {
      if (!this.s || this.s.capacity == null) return 0;
      return Math.min(100, (this.s.weight / this.s.capacity) * 100);
    },

    get gridItems() {
      if (!this.s) return Array(24).fill({});
      const items = this.s.inventory.map(raw => new Item(raw));
      while (items.length < 24) {
        items.push({ empty: true });
      }
      return items;
    },

    onMounted() {
      this.drawDoll();
      globalBus.on('net:self-update', () => {
        this.drawDoll();
      });
    },

    drawDoll() {
      const canvas = document.getElementById('doll-canvas');
      const ui = rawUiContainer.instance;
      if (!canvas || !ui || !ui.assets || !this.s) return;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const look = this.s.look || {};
      const sex = look.sex === 'female' ? 'female' : 'male';
      const sheet = ui.assets.manifest.avatar[sex];
      if (!sheet) return;
      const defaultHead = sex === 'female' ? 'head_long' : 'head_short';
      const layers = {
        feet: look.feet || 'default_feet',
        legs: look.legs || 'cloth_pants',
        hands: look.hands || 'default_hands',
        chest: look.chest || 'default_chest', head: look.head || defaultHead,
        main: look.main || null, off: look.off || null,
      };
      const DIR = 6; // face au joueur (sud)
      for (const type of LAYER_ORDER[DIR]) {
        const name = layers[type];
        if (!name || !sheet[name]) continue;
        const a = sheet[name].anims.stance;
        const fr = (a.fr[DIR] || a.fr[0])?.[0];
        if (!fr) continue;
        const [x, y, w, h, ox, oy] = fr;
        const img = ui.assets.images.get(sheet[name].image);
        if (!img) continue;
        const S = 1.4;
        ctx.drawImage(img, x, y, w, h, canvas.width / 2 - ox * S, canvas.height - 14 - oy * S, w * S, h * S);
      }
    },

    isEquipped(slot) {
      return this.s && this.s.equip && this.s.equip[slot];
    },

    getEquippedItem(slot) {
      if (!this.s || !this.s.equip) return null;
      const iid = this.s.equip[slot];
      return iid && this.s.inventory.find(i => i.iid === iid);
    },

    isEquippedItem(iid) {
      if (!this.s || !this.s.equip) return false;
      return Object.values(this.s.equip).includes(iid);
    },

    getSlotTitle(slot) {
      return SLOT_NAMES[slot] || slot;
    },

    getItemIconUrl(defId) {
      const ui = rawUiContainer.instance;
      if (!ui || !defId) return '';
      return ui.itemIconUrl(defId) || '';
    },

    unequip(slot) {
      if (this.isEquipped(slot)) {
        globalBus.emit('ui:send-packet', { t: 'unequip', slot });
      }
    },

    useOrEquip(item) {
      if (item.slot === 'use') {
        globalBus.emit('ui:send-packet', { t: 'use', iid: item.iid });
      } else if (this.isEquippedItem(item.iid)) {
        globalBus.emit('ui:send-packet', { t: 'unequip', slot: item.slot });
      } else {
        globalBus.emit('ui:send-packet', { t: 'equip', iid: item.iid });
      }
    },

    dropItem(item) {
      this.hideTooltip();
      globalBus.emit('ui:send-packet', { t: 'drop', iid: item.iid });
    },

    showItemTooltip(e, rawItem) {
      const ui = rawUiContainer.instance;
      if (!rawItem || !ui) return;
      const item = new Item(rawItem);
      ui.showTooltip(item.getTooltip());
      ui.moveTooltip(e.clientX, e.clientY);
    },

    hideTooltip() {
      const ui = rawUiContainer.instance;
      if (ui) ui.hideTooltip();
    },

    dropGold() {
      const amount = +prompt('Quantité à poser au sol :', this.s?.gold || 0);
      if (Number.isFinite(amount) && amount > 0) {
        globalBus.emit('ui:send-packet', { t: 'drop', defId: 'gold', amount });
      }
    }
  };
}