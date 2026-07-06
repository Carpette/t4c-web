// Boîte à outils d'animation EN JEU. Visible seulement si le serveur a envoyé
// des permissions au welcome (voir ADMIN_PERMS) ; chaque onglet correspond à
// une permission, et le serveur revérifie de toute façon chaque commande.
// Les poses « au clic » passent par uiStore.adminPlace, consommé par le
// gestionnaire de clic du monde dans main.js.
import { uiStore } from '../../ui-store.js';
import { globalBus } from '../../../event-bus.js';
import { MOBS, ITEMS } from '../../../../shared/defs.js';

const TILES = [
  { id: 0, name: 'Eau' }, { id: 1, name: 'Sable' }, { id: 2, name: 'Herbe' },
  { id: 3, name: 'Forêt (sol)' }, { id: 4, name: 'Roche (bloquant)' },
  { id: 5, name: 'Pavés' }, { id: 6, name: 'Chemin' }, { id: 7, name: 'Gravier' },
];
// types rendus par decormap.js (les portails d'Épreuve et coffres se posent
// aussi, mais gardent leur logique serveur propre)
const PROP_TYPES = ['tree', 'rock', 'house', 'well', 'grave', 'fence', 'ruin', 'torch', 'bridge', 'chest'];

export function AdminController() {
  return {
    open: false, tab: 'spawn', msg: '',
    mobSearch: '', itemSearch: '', mobId: 'rat', itemId: '', nMob: 1, nItem: 1, gold: 100,
    tileId: 2, propType: 'tree', propScale: 1,
    npcId: '', npcs: [], dlgText: '',
    tiles: TILES, propTypes: PROP_TYPES,

    get perms() { return uiStore.adminPerms || []; },
    get placing() { return uiStore.adminPlace?.label || ''; },

    toggle() {
      this.open = !this.open;
      if (this.open && !this.npcs.length) this.loadNpcs();
      const first = ['spawn', 'map', 'quests'].find(t => this.perms.includes(t));
      if (first && !this.perms.includes(this.tab)) this.tab = first;
    },
    tabStyle(t) {
      return this.tab === t
        ? 'flex:1;background:#6b5322;color:#fff;border:1px solid var(--gold);'
        : 'flex:1;background:#241a0a;border:1px solid #6b5322;';
    },

    // ---------- invocation ----------
    mobList() {
      const q = this.mobSearch.toLowerCase();
      return Object.entries(MOBS).map(([id, m]) => ({ id, name: m.name, level: m.level | 0 }))
        .filter(m => !q || m.id.includes(q) || m.name.toLowerCase().includes(q))
        .sort((a, b) => a.level - b.level);
    },
    itemList() {
      const q = this.itemSearch.toLowerCase();
      return Object.entries(ITEMS).filter(([id]) => id !== 'or')
        .map(([id, i]) => ({ id, name: i.name }))
        .filter(i => !q || i.id.includes(q) || i.name.toLowerCase().includes(q))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    placeMob() {
      if (!this.mobId) return;
      uiStore.adminPlace = {
        label: `invoquer ${MOBS[this.mobId]?.name || this.mobId}`,
        cmd: 'spawn', defId: this.mobId, n: Math.max(1, this.nMob | 0),
      };
    },
    spawnHere() {
      if (!this.mobId) return;
      globalBus.emit('admin:cmd', { cmd: 'spawn', defId: this.mobId, n: Math.max(1, this.nMob | 0) });
    },
    giveItem() {
      if (!this.itemId) return;
      globalBus.emit('admin:cmd', { cmd: 'give', defId: this.itemId, n: Math.max(1, this.nItem | 0) });
    },
    giveGold() {
      globalBus.emit('admin:cmd', { cmd: 'give', gold: Math.max(1, this.gold | 0) });
    },

    // ---------- carte ----------
    placeTile() {
      const t = TILES.find(x => x.id === +this.tileId);
      uiStore.adminPlace = { label: `peindre « ${t?.name} »`, cmd: 'tile', tile: +this.tileId };
    },
    placeProp() {
      uiStore.adminPlace = {
        label: `poser « ${this.propType} »`,
        cmd: 'prop', op: 'add', type: this.propType, s: +this.propScale || 1,
      };
    },
    placeRemove() {
      uiStore.adminPlace = { label: 'retirer un décor', cmd: 'prop', op: 'remove' };
    },
    stopPlace() { uiStore.adminPlace = null; },

    // ---------- quêtes ----------
    async loadNpcs() {
      try {
        const raw = await (await fetch('/content/npcs.json')).json();
        this.npcs = Object.entries(raw.npc || {}).map(([id, n]) => ({ id, name: n.name || id }));
        if (!this.npcId && this.npcs.length) { this.npcId = this.npcs[0].id; this.loadDialogues(); }
      } catch { this.msg = '✘ npcs.json inaccessible'; }
    },
    async loadDialogues() {
      this.msg = '';
      try {
        const raw = await (await fetch('/content/npcs.json')).json();
        this.dlgText = JSON.stringify(raw.npc?.[this.npcId]?.dialogues || [], null, 1);
      } catch { this.msg = '✘ lecture impossible'; }
    },
    saveDialogues() {
      let dialogues;
      try { dialogues = JSON.parse(this.dlgText); }
      catch (e) { this.msg = '✘ JSON invalide : ' + e.message; return; }
      globalBus.emit('admin:cmd', { cmd: 'dialogues', npcId: this.npcId, dialogues });
      this.msg = '… envoyé (la confirmation arrive dans le chat)';
    },
  };
}
