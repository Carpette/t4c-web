import { uiStore, rawUiContainer, demander } from '../../ui-store.js';
import { SLOT_ICONS, SPELL_ICONS, ELEMENT_ICONS as ELEMS, icone } from '../../icones.js';
import { globalBus } from '../../../event-bus.js';

export function ShopController() {
  return {
    state: uiStore,
    or: icone('piece', { taille: 12, classe: 'ico-or' }),
    etoile: icone('etoile', { taille: 18 }),
    tabNames: {
      items: 'Objets',
      spells: 'Sorts',
      skills: 'Compétences',
      sell: 'Vendre'
    },
    // onglets non vides seulement (un maître sans étal n'affiche que ses sorts)
    get onglets() {
      const sh = this.shop;
      if (!sh) return [];
      return ['items', 'spells', 'skills', 'sell'].filter(t =>
        t === 'sell' ? sh.items.length > 0 : (sh[t] || []).length > 0);
    },
    get shop() {
      return this.state.shop;
    },
    get s() {
      return this.state.player;
    },
    get inventory() {
      return this.s ? this.s.inventory : [];
    },
    isEquipped(iid) {
      if (!this.s || !this.s.equip) return false;
      return Object.values(this.s.equip).includes(iid);
    },
    getItemIconHtml(defId, slot) {
      return rawUiContainer.instance?.itemIconHtml(defId, slot) || icone(SLOT_ICONS[slot] || 'sac');
    },
    getSpellIconHtml(sp) {
      const ui = rawUiContainer.instance;
      return ui ? ui.spellIconHtml(sp) : icone(SPELL_ICONS[sp.type] || 'etincelle');
    },
    getItemMeta(it) {
      return [
        it.dmgRange && `dégâts ${it.dmgRange}`,
        it.def && `défense ${it.def}`,
        it.heal && `+${it.heal} PV`,
        it.mana && `+${it.mana} mana`,
        it.weight && `${it.weight} kg`,
        it.reqText && `requis : ${it.reqText}`,
      ].filter(Boolean).join(' — ') || '';
    },
    elementHtml(el) {
      return icone(ELEMS[el] || 'etincelle', { taille: 11 }) + ' ' + el + ' — ';
    },
    getSpellMeta(sp) {
      return `${sp.mana} mana — requis : ${sp.reqText || '—'}`;
    },
    buyItem(defId) {
      globalBus.emit('ui:send-packet', { t: 'buy', kind: 'item', id: defId });
    },
    buySpell(id) {
      globalBus.emit('ui:send-packet', { t: 'buy', kind: 'spell', id });
    },
    buySkill(id) {
      globalBus.emit('ui:send-packet', { t: 'buy', kind: 'skill', id });
    },
    trainSkill(id) {
      globalBus.emit('ui:send-packet', { t: 'buy', kind: 'train', id });
    },
    // vendre un objet équipé se confirme (perte de l'équipement porté)
    async sellItem(it) {
      if (this.isEquipped(it.iid) && !await demander({
        titre: 'Vendre un objet équipé', texte: `${it.label} est actuellement porté. Le vendre quand même ?`, ok: 'Vendre',
      })) return;
      globalBus.emit('ui:send-packet', { t: 'sell', iid: it.iid });
    }
  };
}