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
  panels: {
    character: false,
    inventory: false,
    bank: false,
    shop: false,
    'obelisk-panel': false,
    spells: false
  }
});

try {
  uiStore.hotkeys = JSON.parse(localStorage.getItem('t4c_hotkeys') || '{}');
} catch {}

globalBus.on('net:self-update', (playerData) => {
  if (playerData) {
    Object.assign(uiStore.player, playerData);
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
  uiStore.panels.bank = true;
  const el = document.getElementById('bank');
  if (el) el.classList.remove('hidden');
});

globalBus.on('net:obelisk', (msg) => {
  uiStore.obelisk = msg;
  uiStore.panels['obelisk-panel'] = true;
  const el = document.getElementById('obelisk-panel');
  if (el) el.classList.remove('hidden');
});

globalBus.on('net:shop', (msg) => {
  uiStore.shop = msg;
  if (!msg.items.length && msg.spells.length && uiStore.shopTab !== 'spells') {
    uiStore.shopTab = 'spells';
  } else {
    uiStore.shopTab = 'items';
  }
  uiStore.panels.shop = true;
  const el = document.getElementById('shop');
  if (el) el.classList.remove('hidden');
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