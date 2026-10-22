import { reactive } from '/js/vendor/petite-vue.js';
import { globalBus } from '../event-bus.js';

export const rawUiContainer = {
  instance: null
};

export const uiStore = reactive({
  phase: 'login',
  adminPerms: [],   // permissions d'administration reçues au welcome
  adminPlace: null, // mode « poser au clic » de la boîte à outils admin
  player: {
    hp: 0, maxHp: 0,
    mana: 0, maxMana: 0,
    xp: 0, xpCur: 0, xpNext: 1,
    level: 1,
    gold: 0,
    name: '',
    stats: {},
    eff: {},
    items: [],
    spells: [],
    buffs: []
  },
  bank: null,
  shop: null,
  shopTab: 'items',
  obelisk: null,
  party: null,
  partyInvite: null,
  selfId: null,      // id d'entité du joueur (chef de groupe ? etc.)
  channels: [],      // canaux de discussion (serveur) : {name, private?, owner?, mine?, joined}
  hotkeys: {},
  spellDefs: [],
  activeSpell: null,
  bindingSpell: null,
  bindingError: null,
  chat: {
    messages: [],
    input: ''
  },
  // panneaux latéraux (un seul ouvert à la fois, cf. GuiManager.showOnly) :
  // SEULE source de vérité, les conteneurs d'index.html s'y lient par v-show
  panels: {
    inventory: false,
    character: false,
    spells: false,
    help: false,
    shop: false,
    bank: false,
    obelisk: false,
  },
  menu: null,        // menu Échap : null | 'buttons' | 'settings' | 'about'
  target: null,      // cadre de cible : { name, hpPct, playerId }
  trial: null,       // confirmation d'entrée dans l'Épreuve : { text }
  death: null,       // écran de mort : message `died` du serveur
  version: null,     // { label, about } (login + À propos)
  cds: {},           // spellId -> fin de recharge (s, horloge performance)
  now: 0,            // horloge rafraîchie par la boucle de rendu (recharges, buffs)
  dialogue: null,    // boîte modale : { titre, texte, ok, danger?, nombre?: { max } }
  dialogueValeur: '', // quantité saisie dans la boîte (hors de `dialogue` : v-model survit à sa fermeture)
  selfAt: 0,         // instant (s) du dernier message `self` : décompte local des buffs
});

// Boîte de dialogue de l'interface (remplace confirm/prompt natifs).
// Résout true/false, ou le nombre saisi (null si annulé) quand `nombre` est fourni.
let resoudre = null;
export function demander({ titre, texte = '', ok = 'Confirmer', danger = false, nombre = null }) {
  resoudre?.(nombre ? null : false); // une seule boîte à la fois
  return new Promise((resolve) => {
    resoudre = resolve;
    uiStore.dialogueValeur = nombre ? String(nombre.valeur ?? '') : '';
    uiStore.dialogue = { titre, texte, ok, danger, nombre: nombre ? { max: nombre.max } : null };
  });
}
export function repondre(valide) {
  const d = uiStore.dialogue;
  uiStore.dialogue = null;
  const r = resoudre; resoudre = null;
  if (!r || !d) return;
  if (!d.nombre) { r(!!valide); return; }
  const n = Math.floor(+uiStore.dialogueValeur);
  r(valide && Number.isFinite(n) && n > 0 ? Math.min(n, d.nombre.max ?? n) : null);
}

try {
  uiStore.hotkeys = JSON.parse(localStorage.getItem('t4c_hotkeys') || '{}');
} catch {}

globalBus.on('net:self-update', (playerData) => {
  if (playerData) {
    Object.assign(uiStore.player, playerData);
    uiStore.selfAt = performance.now() / 1000;
  }
});

globalBus.on('net:vitals', (data) => {
  if (!uiStore.player) return;
  uiStore.player.hp = data.hp;
  uiStore.player.mana = data.mana;
});

globalBus.on('net:xp', (data) => {
  if (!uiStore.player) return;
  uiStore.player.xp = data.xp;
});

globalBus.on('net:party-update', (msg) => {
  uiStore.party = msg.members.length ? msg : null;
});

globalBus.on('net:party-vitals', (msg) => {
  if (!uiStore.party) return;
  for (const v of msg.members) {
    const member = uiStore.party.members.find(m => m.id === v.id);
    if (member) {
      member.hp = v.hp;
      member.maxHp = v.maxHp;
    }
  }
});

globalBus.on('net:party-invite', (msg) => {
  // le composant party affiche le toast et son compte à rebours (TTL serveur : 30 s)
  uiStore.partyInvite = { ...msg, until: Date.now() + 30e3 };
});

globalBus.on('net:bank-open', (msg) => {
  uiStore.bank = msg;
  globalBus.emit('gui:open-panel', 'bank');
});

globalBus.on('net:obelisk', (msg) => {
  uiStore.obelisk = msg;
  globalBus.emit('gui:open-panel', 'obelisk');
});

globalBus.on('net:shop', (msg) => {
  uiStore.shop = msg;
  // premier onglet non vide : objets, sinon sorts (maître), sinon compétences
  uiStore.shopTab = msg.items.length ? 'items'
    : msg.spells.length ? 'spells' : (msg.skills || []).length ? 'skills' : 'items';
  globalBus.emit('gui:open-panel', 'shop');
});

globalBus.on('net:chat-received', (msg) => {
  const newMsg = { ...msg };
  // Normalize channel messages to have a 'kind' property for consistency
  if (newMsg.channel) {
    newMsg.kind = `channel-${newMsg.channel}`;
  }
  uiStore.chat.messages.push(newMsg);
  if (uiStore.chat.messages.length > 100) {
    uiStore.chat.messages.shift();
  }
  globalBus.emit('ui:chat-scroll');
});

globalBus.on('ui:hotkeys-updated', () => {
  try {
    uiStore.hotkeys = JSON.parse(localStorage.getItem('t4c_hotkeys') || '{}');
  } catch {}
});