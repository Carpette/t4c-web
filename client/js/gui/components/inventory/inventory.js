import { uiStore, rawUiContainer, demander } from '../../ui-store.js';
import { SLOT_NAMES, ITEMS } from '../../../../../shared/defs.js';
import { LAYER_ORDER } from '../../../render2d/anim.js';
import { Item } from '../../../Item.js';
import { globalBus } from '../../../event-bus.js';
import { SLOT_ICONS, icone } from '../../icones.js';

const SLOTS_LIST = ['helmet', 'amulet', 'weapon', 'shield', 'gloves', 'legs', 'armor', 'belt', 'boots', 'ring', 'ring2'];

// poupée : 4 emplacements par colonne autour du personnage, rangée du bas
// pour la ceinture et les deux bagues (sous ses pieds)
const SLOT_STYLES = {
  helmet: { top: '4px', left: '4px' },
  weapon: { top: '54px', left: '4px' },
  armor: { top: '104px', left: '4px' },
  legs: { top: '154px', left: '4px' },
  amulet: { top: '4px', right: '4px' },
  shield: { top: '54px', right: '4px' },
  gloves: { top: '104px', right: '4px' },
  boots: { top: '154px', right: '4px' },
  belt: { bottom: '4px', left: '30%', transform: 'translateX(-50%)' },
  ring: { bottom: '4px', left: '50%', transform: 'translateX(-50%)' },
  ring2: { bottom: '4px', left: '70%', transform: 'translateX(-50%)' },
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
      const manquantes = []; // couches pas encore chargées (chargement à la demande)
      for (const type of LAYER_ORDER[DIR]) {
        const name = layers[type];
        if (!name || !sheet[name]) continue;
        const a = sheet[name].anims.stance;
        const fr = (a.fr[DIR] || a.fr[0])?.[0];
        if (!fr) continue;
        const [x, y, w, h, ox, oy] = fr;
        const img = ui.assets.images.get(sheet[name].image);
        if (!img) { manquantes.push(sheet[name].image); continue; }
        const S = 1.4;
        ctx.drawImage(img, x, y, w, h, canvas.width / 2 - ox * S, canvas.height - 14 - oy * S, w * S, h * S);
      }
      // redessine quand les couches manquantes arrivent (une seule fois si
      // aucune ne se charge : pas de boucle sur une image introuvable)
      if (manquantes.length) {
        ui.assets.images.chargerTout(manquantes).then(r => { if (r.some(Boolean)) this.drawDoll(); });
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

    // prérequis de caractéristiques remplis (mêmes règles que le serveur)
    portable(item) {
      const req = ITEMS[item.defId]?.req, eff = this.s?.eff || {};
      return !req || Object.entries(req).every(([st, v]) => (eff[st] || 0) >= v);
    },

    isEquippedItem(iid) {
      if (!this.s || !this.s.equip) return false;
      return Object.values(this.s.equip).includes(iid);
    },

    slotIcone(slot) { return icone(SLOT_ICONS[slot], { taille: 22 }); },

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

    // poser au sol = l'objet peut être ramassé par n'importe qui : on confirme
    async dropItem(item) {
      this.hideTooltip();
      const nom = item.label || item.name || 'cet objet';
      if (!await demander({
        titre: 'Poser au sol', ok: 'Poser', danger: true,
        texte: `Poser ${nom} au sol ? N'importe quel joueur pourra le ramasser.`,
      })) return;
      globalBus.emit('ui:send-packet', { t: 'drop', iid: item.iid });
    },

    showItemTooltip(e, rawItem, vide = '') {
      const ui = rawUiContainer.instance;
      if (!ui || (!rawItem && !vide)) return;
      if (!rawItem) { ui.showTooltip(`${vide} — vide`); ui.moveTooltip(e.clientX, e.clientY); return; }
      // comparaison avec l'objet porté au même emplacement (2e anneau inclus)
      const slot = ITEMS[rawItem.defId]?.slot;
      const porte = slot && slot !== 'use' ? (this.getEquippedItem(slot) || (slot === 'ring' ? this.getEquippedItem('ring2') : null)) : null;
      ui.showTooltipHtml(new Item(rawItem).getTooltipHtml({ stats: this.s?.eff, porte: porte ? new Item(porte) : null }));
      ui.moveTooltip(e.clientX, e.clientY);
    },

    hideTooltip() {
      const ui = rawUiContainer.instance;
      if (ui) ui.hideTooltip();
    },

    async dropGold() {
      const gold = this.s?.gold || 0;
      if (!gold) return;
      const amount = await demander({
        titre: 'Poser de l’or au sol', ok: 'Poser',
        texte: 'Pour donner de l’or à un joueur : posez-le, il le ramasse.',
        nombre: { valeur: Math.min(gold, 10), max: gold },
      });
      if (amount) globalBus.emit('ui:send-packet', { t: 'drop', defId: 'gold', amount });
    }
  };
}