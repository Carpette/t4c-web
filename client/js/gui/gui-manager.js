import { createApp } from '/js/vendor/petite-vue.js';
import { uiStore, repondre } from './ui-store.js';
import { globalBus } from '../event-bus.js';
import { CharacterController } from './components/character/character.js';
import { InventoryController } from './components/inventory/inventory.js';
import { HelpController } from './components/help/help.js';
import { BankController } from './components/bank/bank.js';
import { ChatController } from './components/chat/chat.js';
import { ShopController } from './components/shop/shop.js';
import { ObeliskController } from './components/obelisk/obelisk.js';
import { HudBarsController } from './components/hudbars/hudbars.js';
import { PartyController } from './components/party/party.js';
import { LoginController } from './components/login/login.js';
import { SpellsController } from './components/spells/spells.js';
import { SettingsController } from './components/settings/settings.js';
import { CreationController } from './components/creation/creation.js';
import { AdminController } from './components/admin/admin.js';
import { SpellbarController } from './components/spellbar/spellbar.js';
import { QuickbarController } from './components/quickbar/quickbar.js';
import { BuffsController } from './components/buffs/buffs.js';

// Application racine (montée sur <body>) : écrans et fenêtres déclarés en dur
// dans index.html (menu Échap, Épreuve, cible, mort), liés au store.
function RootController() {
  const send = (packet) => globalBus.emit('ui:send-packet', packet);
  return {
    store: uiStore,
    entrerEpreuve() { uiStore.trial = null; send({ t: 'trial_enter' }); },
    peutInviterCible() {
      const id = uiStore.target?.playerId;
      return id != null && !uiStore.party?.members.some(m => m.id === id);
    },
    inviterCible() {
      if (uiStore.target?.playerId != null) send({ t: 'party_invite', id: uiStore.target.playerId });
    },
    renaitre() {
      uiStore.death = null;
      uiStore.phase = 'creation';
      send({ t: 'newchar' });
    },
    quitter() { globalBus.emit('ui:quit'); },
    repondre,
  };
}

const COMPONENT_MAP = {
  login: '#login',
  creation: '#creation',
  character: '#character',
  inventory: '#inventory',
  help: '#help',
  bank: '#bank',
  chat: '#chat',
  shop: '#shop',
  settings: '#menu-settings-panel',
  party: '#party-panel',
  spells: '#spells',
  hudbars: '#hud-bars',
  admin: '#admin-panel',
  obelisk: '#obelisk-panel',
  spellbar: '#spellbar',
  quickbar: '#quickbar',
  buffs: '#buffs-display',
};

// panneaux latéraux exclusifs : un seul ouvert à la fois (clé de uiStore.panels)
const PANELS = ['inventory', 'character', 'help', 'spells', 'shop', 'bank', 'obelisk'];

const PANEL_TITLES = {
  inventory: 'Inventaire (I)', character: 'Personnage (C)', help: 'Aide (H)', spells: 'Sorts (S)',
  shop: 'Marchand', bank: 'Coffre', obelisk: 'Obélisque',
};

const PHASE_COMPONENTS = {
  login: ['login'],
  creation: ['creation'],
  'in-game': ['chat', 'hudbars', 'help', 'settings', 'admin', 'party', 'spellbar', 'quickbar', 'buffs'],
  death: []
};

class GuiManager {
  constructor() {
    this.store = uiStore;
    this.controllers = {
      login: LoginController,
      character: CharacterController,
      inventory: InventoryController,
      help: HelpController,
      bank: BankController,
      chat: ChatController,
      shop: ShopController,
      obelisk: ObeliskController,
      hudbars: HudBarsController,
      party: PartyController,
      spells: SpellsController,
      settings: SettingsController,
      creation: CreationController,
      admin: AdminController,
      spellbar: SpellbarController,
      quickbar: QuickbarController,
      buffs: BuffsController,
    };
    this.ui = null;
    this.loaded = new Set();
  }

  setUi(ui) {
    this.ui = ui;
  }

  async init() {
    createApp(RootController()).mount(document.body);

    this.loadPhaseComponents(this.store.phase);

    // Raccorder les événements globaux du jeu pour synchroniser le store réactif
    window.addEventListener('game:update-player', (e) => {
      this.updatePlayer(e.detail);
    });

    // ouverture déclenchée par le serveur (marchand, coffre, obélisque)
    globalBus.on('gui:open-panel', (name) => this.openPanel(name));
    globalBus.on('gui:close-panels', () => this.showOnly(null));
    globalBus.on('gui:menu-back', () => { this.store.menu = 'buttons'; });

    this.setupHotbuttons();
  }

  async loadPhaseComponents(phase) {
    const componentsToLoad = PHASE_COMPONENTS[phase];
    if (!componentsToLoad) return;

    for (const name of componentsToLoad) await this.ensureLoaded(name);
  }

  async loadComponent(name, selector) {
    const container = document.querySelector(selector);
    if (!container) return;

    try {
      const res = await fetch(`/js/gui/components/${name}/${name}.html`);
      if (!res.ok) throw new Error(`Template introuvable: ${res.statusText}`);
      const html = await res.text();

      container.innerHTML = html;

      // Instancier Petite-Vue sur ce composant avec son contrôleur dédié
      createApp(this.controllers[name]()).mount(container);
      if (PANELS.includes(name)) this.addCloseButton(container, name);
    } catch (err) {
      console.error(`Erreur d'initialisation du composant GUI [${name}] :`, err);
    }
  }

  // bouton ✕ commun à tous les panneaux (hors gabarit : petite-vue n'y touche pas)
  addCloseButton(container, name) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'panel-close';
    btn.textContent = '✕';
    btn.title = 'Fermer (Échap)';
    btn.setAttribute('aria-label', `Fermer — ${PANEL_TITLES[name] || name}`);
    btn.onclick = () => this.showOnly(null);
    container.prepend(btn);
  }

  updatePlayer(playerData) {
    if (!playerData) return;
    Object.assign(this.store.player, playerData);
  }

  // charge le composant d'un panneau à la première ouverture
  async ensureLoaded(name) {
    if (!name || this.loaded.has(name)) return;
    const selector = COMPONENT_MAP[name];
    if (!selector) return;
    this.loaded.add(name); // avant l'await : deux ouvertures rapprochées ne montent qu'une fois
    await this.loadComponent(name, selector);
  }

  // affiche `name` (null : aucun) et masque les autres panneaux
  showOnly(name) {
    for (const p of PANELS) {
      const shouldShow = p === name;
      this.store.panels[p] = shouldShow;
      const btn = document.querySelector(`#hotbuttons button[data-panel="${p}"]`);
      btn?.classList.toggle('active', shouldShow);
      btn?.setAttribute('aria-pressed', String(shouldShow));
    }
  }

  anyPanelOpen() {
    return PANELS.some(p => this.store.panels[p]);
  }

  async openPanel(name) {
    await this.ensureLoaded(name);
    this.showOnly(name);
  }

  async togglePanel(name) {
    await this.ensureLoaded(name);
    this.showOnly(name && !this.store.panels[name] ? name : null);
  }

  setupHotbuttons() {
    document.querySelectorAll('#hotbuttons button').forEach(btn => {
      const panelName = btn.dataset.panel;
      btn.onclick = (e) => {
        e.preventDefault();
        this.togglePanel(panelName);
      };
    });
  }
}

export const guiManager = new GuiManager();
guiManager.init();
