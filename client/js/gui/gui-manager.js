import { createApp } from '/js/vendor/petite-vue.js';
import { uiStore } from './ui-store.js';
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

function RootController() {
  return {
    store: uiStore
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
  // le toast d'invitation vit dans le composant party (plus de party-invite)
};

// panneaux latéraux exclusifs (un seul ouvert à la fois) : nom -> id du conteneur
const PANELS = {
  inventory: 'inventory', character: 'character', help: 'help', spells: 'spells',
  shop: 'shop', bank: 'bank', obelisk: 'obelisk-panel',
};

const PHASE_COMPONENTS = {
  login: ['login'],
  creation: ['creation'],
  'in-game': ['chat', 'hudbars', 'help', 'settings', 'admin', 'party'],
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

      this.setupHotbuttons();
      this.setupGameMenu();
    }

  async loadPhaseComponents(phase) {
    const componentsToLoad = PHASE_COMPONENTS[phase];
    if (!componentsToLoad) return;

    for (const name of componentsToLoad) {
      if (!this.loaded.has(name)) {
        const selector = COMPONENT_MAP[name];
        if (selector) {
          await this.loadComponent(name, selector);
          this.loaded.add(name);
        }
      }
    }
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
    } catch (err) {
      console.error(`Erreur d'initialisation du composant GUI [${name}] :`, err);
    }
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
    await this.loadComponent(name, selector);
    this.loaded.add(name);
  }

  // affiche `name` (null : aucun) et masque les autres panneaux
  showOnly(name) {
    for (const [p, id] of Object.entries(PANELS)) {
      const el = document.getElementById(id);
      if (!el) continue;
      const shouldShow = p === name;
      el.classList.toggle('hidden', !shouldShow);
      if (this.store.panels[id] !== undefined) this.store.panels[id] = shouldShow;
      document.querySelector(`#hotbuttons button[data-panel="${p}"]`)?.classList.toggle('active', shouldShow);
    }
  }

  async openPanel(name) {
    await this.ensureLoaded(name);
    this.showOnly(name);
  }

  async togglePanel(name) {
    await this.ensureLoaded(name);
    const el = name && document.getElementById(PANELS[name]);
    this.showOnly(el && el.classList.contains('hidden') ? name : null);
  }

  setupGameMenu() {
    const $ = (id) => document.getElementById(id);
    $('menu-settings').onclick = () => {
      $('menu-buttons').classList.add('hidden');
      $('menu-settings-panel').classList.remove('hidden');
    };

    globalBus.on('gui:menu-back', () => {
      $('menu-settings-panel').classList.add('hidden');
      $('menu-buttons').classList.remove('hidden');
    });
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