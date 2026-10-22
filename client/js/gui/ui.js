// Interface : connexion, HUD, inventaire (poupée T4C), fiche perso, chat, dégâts flottants
import { ITEMS } from '../../../shared/defs.js';
import { settings } from '../settings.js';
import { refreshSfx, play as playSfx } from '../sfx.js';
import { globalBus } from '../event-bus.js';
import { guiManager } from './gui-manager.js';
import { uiStore, rawUiContainer } from './ui-store.js';
import { SPELL_ICONS, SLOT_ICONS, icone } from './icones.js';

const $ = (id) => document.getElementById(id);

export class UI {
  get activeSpell() { return uiStore.activeSpell; }
  set activeSpell(val) { uiStore.activeSpell = val; }
  get bindingSpell() { return uiStore.bindingSpell; }
  set bindingSpell(val) { uiStore.bindingSpell = val; }
  get bindingError() { return uiStore.bindingError; }
  set bindingError(val) { uiStore.bindingError = val; }
  get hotkeys() { return uiStore.hotkeys; }
  set hotkeys(val) { uiStore.hotkeys = val; }

  constructor(net) {
    this.net = net;
    this.self = null;
    try { this.hotkeys = JSON.parse(localStorage.getItem('t4c_hotkeys') || '{}'); } catch {}

    // Instanciation des sous-composants

    globalBus.on('ui:send-chat', (text) => {
      this.net.send({ t: 'chat', text });
    });

    globalBus.on('ui:send-packet', (packet) => {
      this.net.send(packet);
    });

    globalBus.on('net:self-update', (playerData) => {
      this.self = playerData;
    });

    globalBus.on('settings:sfx-changed', () => refreshSfx());
    globalBus.on('settings:chat-style-changed', () => this.applyChatStyle());
    globalBus.on('ui:floater', ({ screen, text, cls }) => this.floater(screen, text, cls));
    globalBus.on('ui:play-sfx', (name) => playSfx(name)); // aperçu du volume dans les réglages
    globalBus.on('settings:perf-visibility-changed', () => this.applyPerfVisibility());
    globalBus.on('settings:hud-scale-changed', () => this.applyHudScale());

    // capture de touche pour l'assignation de raccourci
    this.RESERVED_KEYS = {
      i: 'inventaire', c: 'personnage', s: 'sorts', h: 'aide', j: 'journal', o: 'joueurs',
      n: 'mini-carte', p: 'potion de vie', m: 'potion de mana', v: 'dictée vocale',
    };
    // purge d'éventuels raccourcis réservés enregistrés avant ce garde-fou
    for (const k of Object.keys(this.hotkeys)) {
      if (this.RESERVED_KEYS[k]) delete this.hotkeys[k];
    }
    window.addEventListener('keydown', (e) => {
      if (!this.bindingSpell) return;
      e.preventDefault(); e.stopPropagation();
      const k = e.key.toLowerCase();
      this.bindingError = null;
      if (k !== 'escape' && k.length === 1) {
        if (this.RESERVED_KEYS[k]) {
          // touche déjà utilisée par l'interface : refusée, on reste en attente
          this.bindingError = `« ${k.toUpperCase()} » est réservée (${this.RESERVED_KEYS[k]}). Choisissez une autre touche.`;
          return;
        }
        for (const key of Object.keys(this.hotkeys)) {
          if (this.hotkeys[key] === this.bindingSpell) delete this.hotkeys[key];
        }
        this.hotkeys[k] = this.bindingSpell;
        localStorage.setItem('t4c_hotkeys', JSON.stringify(this.hotkeys));
        globalBus.emit('ui:hotkeys-updated');
      }
      this.bindingSpell = null;
    }, true);

    // poser de l'or au sol (échange entre joueurs)
    guiManager.setUi(this);
    rawUiContainer.instance = this;

    globalBus.on('ui:quit', () => {
      try { net.ws?.close(1000, 'logout'); } catch {}
      location.reload(); // retour propre à l'écran de connexion
    });

    this.selfId = null;         // renseigné par main.js au welcome
  }

  get cds() { return uiStore.cds; } // spellId -> fin de recharge (s), lu par main.js

  setAssets(assets) { this.assets = assets; }

  // ---- Icônes d'objets : vrais sprites loot (atlas Flare) plutôt qu'émojis ----
  // Recadre le frame manifest.loot de l'objet dans un canvas size×size (contain),
  // mis en cache en dataURL pour ne pas redessiner à chaque rendu.
  itemIconUrl(defId, size = 34) {
    if (!this.assets) return null;
    if (!this._iconCache) this._iconCache = new Map();
    const key = `${defId}:${size}`;
    if (this._iconCache.has(key)) return this._iconCache.get(key);
    // skin admin prioritaire (content/skins.json), repli sur le sprite loot Flare
    let img = null, x = 0, y = 0, w = 0, h = 0;
    const skinPath = this.assets.skins?.items?.[defId];
    const skinImg = skinPath ? this.assets.images.get(skinPath) : null;
    if (skinImg) {
      img = skinImg; w = skinImg.width; h = skinImg.height;
    } else {
      const lootKey = ITEMS[defId]?.loot;
      const entry = lootKey && this.assets.manifest.loot[lootKey];
      img = entry && this.assets.images.get(entry.image);
      if (img) [x, y, w, h] = entry.frame;
    }
    let url = null;
    if (img) {
      const c = document.createElement('canvas');
      c.width = size; c.height = size;
      const ctx = c.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      const s = Math.min(size / w, size / h);
      const dw = Math.max(1, Math.round(w * s)), dh = Math.max(1, Math.round(h * s));
      ctx.drawImage(img, x, y, w, h, Math.round((size - dw) / 2), Math.round((size - dh) / 2), dw, dh);
      url = c.toDataURL();
    }
    this._iconCache.set(key, url);
    return url;
  }

  // version HTML (listes de boutique/banque) ; icône d'emplacement si le sprite manque
  itemIconHtml(defId, slot, size = 22) {
    const url = this.itemIconUrl(defId, size);
    return url ? `<img class="item-icon sm" src="${url}" alt="">` : icone(SLOT_ICONS[slot] || 'sac', { taille: size * 0.8 });
  }

  // ---- Annonce de MJ : bandeau dramatique plein écran, puis fondu ----
  announce(text) {
    let el = document.getElementById('gm-announce');
    if (!el) {
      el = document.createElement('div');
      el.id = 'gm-announce';
      el.style.cssText = 'position:fixed;left:0;right:0;top:18%;z-index:80;text-align:center;'
        + 'pointer-events:none;font-family:Georgia,serif;font-size:26px;color:var(--gold,#ffd24a);'
        + 'text-shadow:0 0 18px rgba(0,0,0,.9),0 2px 4px #000;letter-spacing:1px;'
        + 'opacity:0;transition:opacity .6s;padding:0 10vw;';
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.style.opacity = '1';
    clearTimeout(this._announceT);
    this._announceT = setTimeout(() => { el.style.opacity = '0'; }, 6000);
  }

  // ---- Icônes de sorts : skin de l'atelier 2D si assigné, sinon émoji ----
  // Même mécanique de cache dataURL que les objets (recadrage contain size×size).
  spellIconUrl(spellId, size = 26) {
    if (!this.assets) return null;
    if (!this._iconCache) this._iconCache = new Map();
    const key = `spell:${spellId}:${size}`;
    if (this._iconCache.has(key)) return this._iconCache.get(key);
    const skinPath = this.assets.skins?.spells?.[spellId];
    const img = skinPath ? this.assets.images.get(skinPath) : null;
    let url = null;
    if (img) {
      const c = document.createElement('canvas');
      c.width = size; c.height = size;
      const ctx = c.getContext('2d');
      const s = Math.min(size / img.width, size / img.height);
      const dw = Math.max(1, Math.round(img.width * s)), dh = Math.max(1, Math.round(img.height * s));
      ctx.drawImage(img, Math.round((size - dw) / 2), Math.round((size - dh) / 2), dw, dh);
      url = c.toDataURL();
    }
    this._iconCache.set(key, url);
    return url;
  }
  spellIconHtml(sp, size = 26) {
    const url = this.spellIconUrl(sp.id, size);
    return url ? `<img class="item-icon sm" src="${url}" alt="">` : icone(SPELL_ICONS[sp.type] || 'etincelle', { taille: size * 0.8 });
  }
  spellDef(id) { return uiStore.spellDefs.find(s => s.id === id); }
  knownSpells() { return (this.self?.spells || []).map(id => this.spellDef(id)).filter(Boolean); }

  // ---- Réglages appliqués À CHAUD (sans reload) ----
  // Applique TOUS les réglages qui touchent à l'interface/au rendu. Centralisé
  // ici pour être rejoué après une réinitialisation et au démarrage du HUD.
  applyLiveSettings() {
    this.applyHudScale();
    globalBus.emit('settings:sfx-changed');
    globalBus.emit('settings:chat-style-changed');
    globalBus.emit('settings:perf-visibility-changed');
    globalBus.emit('settings:applied'); // Notifie les composants que les réglages ont été appliqués
  }
  // Taille du texte / HUD : variable CSS héritée par le HUD (chat, panneaux…)
  applyHudScale() {
    const root = $('hud');
    if (root) root.style.setProperty('--hud-scale', String(+settings.hudScale || 1));
  }

  // Opacité et nombre de lignes du chat
  applyChatStyle() {
    const box = $('chat-messages');
    if (!box) return;
    box.style.opacity = String(Math.max(0.2, Math.min(1, +settings.chatOpacity || 0.85)));
    // ~16 px par ligne : la hauteur max suit le nombre de lignes choisi
    const lines = Math.max(5, Math.min(20, Math.round(+settings.chatLines || 8)));
    box.style.maxHeight = `${lines * 1.5}em`;
  }

  applyPerfVisibility() {
    $('perf-overlay')?.classList.toggle('hidden', !settings.showPerf);
  }

  // ---- Barre de potions (raccourcis P / M) ----
  potionOf(kind) {
    const match = kind === 'vie' ? (d) => d.heal : (d) => d.mana;
    return (this.self?.inventory || []).find(it => {
      const d = ITEMS[it.defId];
      return d?.slot === 'use' && match(d);
    });
  }

  usePotion(kind) {
    const it = this.potionOf(kind);
    if (!it) { this.addChat('sys', `Plus de potion de ${kind}.`); return; }
    this.net.send({ t: 'use', iid: it.iid });
  }

  startCooldown(spellId, dur) {
    uiStore.cds[spellId] = performance.now() / 1000 + dur;
  }

  // horloge réactive des recharges et des buffs (appelée par la boucle de rendu)
  tickCooldowns() {
    uiStore.now = performance.now() / 1000;
  }

  // ---- Barre d'incantation (vitesse de sort T4C) ----
  // Remplissage linéaire en CSS pendant `ms` ; cachée à la fin ou si le
  // serveur interrompt l'incantation (cast_break : mouvement, cible perdue).
  startCastBar(name, ms) {
    const bar = $('castbar'), fill = $('castbar-fill');
    $('castbar-label').textContent = `${name} — récupération`;
    bar.classList.remove('hidden');
    fill.style.transition = 'none';
    fill.style.width = '0%';
    void fill.offsetWidth; // force le reflow pour relancer la transition
    fill.style.transition = `width ${ms}ms linear`;
    fill.style.width = '100%';
    clearTimeout(this._castTimer);
    this._castTimer = setTimeout(() => bar.classList.add('hidden'), ms + 200);
  }

  endCastBar() {
    clearTimeout(this._castTimer);
    $('castbar').classList.add('hidden');
  }

  showTrialConfirm(msg) {
    uiStore.trial = { text: msg.text };
  }

  zoneBanner(name, levels) {
    const b = $('zone-banner');
    b.textContent = levels ? `${name} — niveaux ${levels[0]} à ${levels[1]}` : name;
    b.style.opacity = 1;
    clearTimeout(this._bannerTimer);
    this._bannerTimer = setTimeout(() => { b.style.opacity = 0; }, 4000);
  }

  setCombatMode(on) {
    $('combat-indicator').classList.toggle('hidden', !on);
  }

  // ---- Version déployée (login + À propos) ----
  setVersion(v) {
    const label = v.version + (v.sha ? ` — ${v.sha} (${v.date})` : '');
    uiStore.version = {
      label,
      about: label + (v.branch && v.branch !== 'main' ? ` — branche ${v.branch}` : ''),
    };
  }

  // ---- Menu de jeu ----
  menuOpen() { return !!uiStore.menu; }
  showMenu() { uiStore.menu = 'buttons'; }
  hideMenu() { uiStore.menu = null; }
  // un panneau (inventaire, sorts, boutique...) est-il ouvert ?
  anyPanelOpen() { return guiManager.anyPanelOpen(); }

  isTyping() {
    const chatInput = document.getElementById('chat-input');
    return document.activeElement === chatInput || document.activeElement?.tagName === 'INPUT';
  }
  focusChat() { document.getElementById('chat-input')?.focus(); }

  setClock(daylight, frac) {
    const moment = daylight > 0.45 ? 'soleil' : daylight > 0.12 ? 'couchant' : 'lune';
    const heure = Math.floor(frac * 24);
    if (moment === this._moment && heure === this._heure) return; // appelé à chaque image
    this._moment = moment; this._heure = heure;
    const el = $('clock');
    el.innerHTML = icone(moment, { taille: 18 }) + `<span>${heure} h</span>`;
    el.title = `Heure du monde : ${heure} h`;
    el.setAttribute('aria-label', el.title);
  }

  addChat(from, text, channelOrKind) {
    globalBus.emit('net:chat-received', { from, text, channel: channelOrKind });
  }

  // chiffre flottant (dégâts, XP, soin...) au-dessus d'une entité
  floater(screen, text, cls = '') {
    if (!screen?.visible || !settings.showFloaters) return;
    const div = document.createElement('div');
    div.className = `floater ${cls}`;
    div.textContent = text;
    div.style.left = `${screen.x + (Math.random() - 0.5) * 30}px`;
    div.style.top = `${screen.y - 30}px`;
    $('floaters').appendChild(div);
    setTimeout(() => div.remove(), 1100);
  }

  showDeath(msg) {
    uiStore.menu = null;
    guiManager.showOnly(null);
    uiStore.death = msg;
  }

  // Tooltip générique
  showTooltip(text) {
    const t = $('tooltip');
    t.textContent = text;
    t.classList.remove('hidden');
  }
  moveTooltip(x, y) {
    const t = $('tooltip');
    t.style.left = `${Math.min(x + 14, window.innerWidth - 220)}px`;
    t.style.top = `${y + 14}px`;
  }
  hideTooltip() { $('tooltip').classList.add('hidden'); }

  // `playerId` : si la cible est un autre joueur, propose de l'inviter au groupe
  setTarget(name, hpPct, playerId = null) {
    uiStore.target = name ? { name, hpPct, playerId } : null;
  }

  // ---- Groupe ----
  setParty(msg) {
    globalBus.emit('net:party-update', msg);
  }

  updatePartyVitals(msg) {
    globalBus.emit('net:party-vitals', msg);
  }

  showPartyInvite(msg) {
    globalBus.emit('net:party-invite', msg);
  }
}