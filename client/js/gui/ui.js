// Interface : connexion, HUD, inventaire (poupée T4C), fiche perso, chat, dégâts flottants
import { STAT_NAMES, STATS, PROTOCOL_VERSION, GROUP_INVITE_TTL } from '../../../shared/constants.js';
import { ITEMS, QUALITY, SLOTS, SLOT_NAMES } from '../../../shared/defs.js';
import { LAYER_ORDER } from '../render2d/anim.js';
import { SETTING_DEFS, SETTING_CHOICES, SETTING_SLIDERS, settings, setSetting, resetSettings, sliderMeta } from '../settings.js';
import { refreshMusic } from '../music.js';
import { refreshSfx, play as playSfx } from '../sfx.js';
import { globalBus } from '../event-bus.js';
import { guiManager } from './gui-manager.js';
import { uiStore, rawUiContainer } from './ui-store.js';

const SLOT_ICONS = { weapon: '⚔️', shield: '🛡️', armor: '🥋', helmet: '⛑️', legs: '👖', gloves: '🧤', belt: '🎗️', boots: '🥾', ring: '💍', ring2: '💍', amulet: '📿', use: '🧪', gold: '🟡' };
const SPELL_ICONS = { bolt: '⚡', heal: '💚', aoe: '🔥', buff: '✨' };
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
    this.cds = {};            // spellId -> timestamp de fin
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
      this.renderSpellPanel();
      this.renderSpellbar();
      this.renderQuickbar();
      this.renderBuffs();
    });

    globalBus.on('settings:sfx-changed', () => refreshSfx());
    globalBus.on('settings:perf-visibility-changed', () => this.applyPerfVisibility());
    globalBus.on('settings:hud-scale-changed', () => this.applyHudScale());

    // capture de touche pour l'assignation de raccourci
    this.RESERVED_KEYS = {
      i: 'inventaire', c: 'personnage', s: 'sorts', h: 'aide',
      p: 'potion de vie', m: 'potion de mana',
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
          this.renderSpellPanel();
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
      this.renderSpellPanel();
      this.renderSpellbar();
    }, true);

    // Connexion

    $('btn-respawn').onclick = () => {
      uiStore.phase = 'creation';
      net.send({ t: 'newchar' });
    };

    // poser de l'or au sol (échange entre joueurs)
    guiManager.setUi(this);
    rawUiContainer.instance = this;

    // ---- Menu de jeu (Échap) ----
    $('menu-resume').onclick = () => this.hideMenu();
    $('menu-about').onclick = () => {
      $('menu-buttons').classList.add('hidden');
      $('menu-about-panel').classList.remove('hidden');
    };
    $('about-back').onclick = () => {
      $('menu-about-panel').classList.add('hidden');
      $('menu-buttons').classList.remove('hidden');
    };
    $('menu-quit').onclick = () => {
      try { net.ws?.close(1000, 'logout'); } catch {}
      location.reload(); // retour propre à l'écran de connexion
    };
    $('btn-trial-go').onclick = () => { $('trial-modal').classList.add('hidden'); net.send({ t: 'trial_enter' }); };
    $('btn-trial-no').onclick = () => $('trial-modal').classList.add('hidden');

    // ---- Groupe : réponses à l'invitation, départ, invitation par clic ----
    this.party = null;          // { leaderId, members: [{id, name, level}] }
    this.selfId = null;         // renseigné par main.js au welcome
    this.targetPlayerId = null; // joueur ciblé (bouton « Inviter »)
    $('target-invite').onclick = () => {
      if (this.targetPlayerId != null) net.send({ t: 'party_invite', id: this.targetPlayerId });
    };
  }

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

  // élément DOM prêt à insérer ; émoji de secours si le sprite manque
  itemIconEl(defId, fallback, size = 34) {
    const url = this.itemIconUrl(defId, size);
    if (!url) {
      const span = document.createElement('span');
      span.textContent = fallback || '❓';
      return span;
    }
    const img = document.createElement('img');
    img.className = 'item-icon';
    img.src = url;
    img.style.width = img.style.height = `${size}px`;
    return img;
  }

  // version HTML inline (lignes de boutique/banque construites en innerHTML)
  itemIconHtml(defId, fallback, size = 22) {
    const url = this.itemIconUrl(defId, size);
    return url ? `<img class="item-icon sm" src="${url}">` : (fallback || '');
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
    return url ? `<img class="item-icon sm" src="${url}">` : (SPELL_ICONS[sp.type] || '✨');
  }
  spellDef(id) { return uiStore.spellDefs.find(s => s.id === id); }
  knownSpells() { return (this.self?.spells || []).map(id => this.spellDef(id)).filter(Boolean); }

  renderSpellPanel() {}

  renderSpellbar() {
    const bar = $('spellbar');
    bar.innerHTML = '';
    // seuls les sorts dotés d'un RACCOURCI apparaissent dans la barre : les
    // autres restent dans le panneau Sorts (S), l'interface reste légère
    for (const sp of this.knownSpells()) {
      const key = Object.keys(this.hotkeys).find(k => this.hotkeys[k] === sp.id);
      if (!key) continue;
      const slot = document.createElement('div');
      slot.className = 'spell-slot' + (this.activeSpell === sp.id ? ' active' : '');
      slot.innerHTML = `<span class="icon">${this.spellIconHtml(sp)}</span>` +
        `<span class="key">${key.toUpperCase()}</span>`;
      slot.title = `${sp.name} — ${sp.mana} mana — touche ${key.toUpperCase()}`;
      slot.dataset.spell = sp.id;
      slot.onclick = () => { this.activeSpell = this.activeSpell === sp.id ? null : sp.id; this.renderSpellPanel(); this.renderSpellbar(); };
      const cd = document.createElement('div');
      cd.className = 'cd hidden';
      slot.appendChild(cd);
      bar.appendChild(slot);
    }
  }

  // ---- Réglages appliqués À CHAUD (sans reload) ----
  // Applique TOUS les réglages qui touchent à l'interface/au rendu. Centralisé
  // ici pour être rejoué après une réinitialisation et au démarrage du HUD.
  applyLiveSettings() {
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

  renderQuickbar() {
    const bar = $('quickbar');
    if (!bar) return;
    bar.innerHTML = '';
    const defs = [
      { kind: 'vie', key: 'P', defId: 'potion_vie', name: 'Potion de vie' },
      { kind: 'mana', key: 'M', defId: 'potion_mana', name: 'Potion de mana' },
    ];
    for (const q of defs) {
      const count = (this.self?.inventory || []).filter(it => {
        const d = ITEMS[it.defId];
        return d?.slot === 'use' && (q.kind === 'vie' ? d.heal : d.mana);
      }).length;
      const slot = document.createElement('div');
      slot.className = 'spell-slot potion-slot' + (count ? '' : ' empty');
      slot.title = `${q.name} — touche ${q.key}` + (count ? '' : ' (aucune)');
      slot.appendChild(this.itemIconEl(q.defId, '🧪', 28));
      slot.insertAdjacentHTML('beforeend',
        `<span class="key">${q.key}</span><span class="count">${count}</span>`);
      slot.onclick = () => this.usePotion(q.kind);
      bar.appendChild(slot);
    }
  }

  startCooldown(spellId, dur) {
    this.cds[spellId] = performance.now() / 1000 + dur;
  }

  tickCooldowns() {
    const now = performance.now() / 1000;
    document.querySelectorAll('#spellbar .spell-slot').forEach(slot => {
      const cd = slot.querySelector('.cd');
      if (!cd) return;
      const left = (this.cds[slot.dataset.spell] || 0) - now;
      if (left > 0) { cd.classList.remove('hidden'); cd.textContent = Math.ceil(left); }
      else cd.classList.add('hidden');
    });
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
    $('trial-text').textContent = msg.text;
    $('trial-modal').classList.remove('hidden');
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
    $('game-version').textContent = label;
    $('about-version').textContent = label + (v.branch && v.branch !== 'main' ? ` — branche ${v.branch}` : '');
  }

  // ---- Menu de jeu ----
  menuOpen() { return !$('game-menu').classList.contains('hidden'); }
  showMenu() {
    $('menu-settings-panel').classList.add('hidden');
    $('menu-about-panel').classList.add('hidden');
    $('menu-buttons').classList.remove('hidden');
    $('game-menu').classList.remove('hidden');
  }
  hideMenu() { $('game-menu').classList.add('hidden'); }
  // un panneau (inventaire, sorts, boutique...) est-il ouvert ?
  anyPanelOpen() {
    return ['inventory', 'character', 'help', 'spells', 'shop', 'obelisk-panel', 'bank']
      .some(p => !$(p).classList.contains('hidden'));
  }

  renderBuffs() {
    const names = {
      def: '🛡 Armure', speed: '💨 Hâte', dmg: '⚔ Instinct de combat',
      regen: '💚 Régénération', maxhp: '❤ Bénédiction', str: '💪 Force de la terre',
      light: '💡 Lumière', int: '🧠 Esprit clair', wis: '🕊 Tranquillité',
      agi: '🤸 Dextérité', spellpow: '🔮 Afflux de Mana', retort: '🔥 Bouclier élémentaire',
      resistAll: '🔮 Bouclier de mana', resist_feu: '🔥 Résistance au feu',
      resist_eau: '❄ Résistance à la glace', sanctuaire: '⛨ Sanctuaire (intouchable)',
      transe: '🧘 Transe (ni attaque ni sort)', maudit: '☠ Maudit (soins impossibles)',
    };
    $('buffs-display').innerHTML = (this.self?.buffs || [])
      .map(b => `${names[b.stat] || b.stat} (${b.left}s)`).join('<br>');
  }

  isTyping() {
    const chatInput = document.getElementById('chat-input');
    return document.activeElement === chatInput || document.activeElement?.tagName === 'INPUT';
  }
  focusChat() { document.getElementById('chat-input')?.focus(); }

  setClock(daylight, frac) {
    $('clock').textContent = daylight > 0.45 ? '🌞' : daylight > 0.12 ? '🌅' : '🌙';
    $('clock').title = `Heure du monde : ${Math.floor(frac * 24)}h`;
  }

  updateVitals(hp, mana) {
    if (this.self) { this.self.hp = hp; this.self.mana = mana; }
    if (guiManager.store.player) {
      guiManager.store.player.hp = hp;
      guiManager.store.player.mana = mana;
    }
  }

  renderBars() {}

  addChat(from, text, channelOrKind) {
    globalBus.emit('net:chat-received', { from, text, channel: channelOrKind });
  }

  floater(screen, text, cls = '') {
    globalBus.emit('ui:floater', { screen, text, cls });
  }

  showDeath(msg) {
    $('death-by').textContent = `${this.self?.level ? `Niveau ${msg.level}` : ''} — tué par ${msg.by} dans ${msg.zone}. Ce personnage est perdu à jamais.`;
    const pan = $('pantheon');
    pan.innerHTML = '<b style="color:#c8b87a">Panthéon des morts</b><br>' +
      (msg.pantheon || []).map(d =>
        `<div class="dead-row">☠ ${d.name} — niveau ${d.level}, tué par ${d.killer} (${d.zone})</div>`).join('');
  }

  // Tooltip générique
  bindTooltip(el, fn) {
    el.addEventListener('mouseenter', () => this.showTooltip(fn()));
    el.addEventListener('mousemove', (e) => this.moveTooltip(e.clientX, e.clientY));
    el.addEventListener('mouseleave', () => this.hideTooltip());
  }
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
    if (!name) { $('target-frame').classList.add('hidden'); this.targetPlayerId = null; return; }
    $('target-frame').classList.remove('hidden');
    $('target-name').textContent = name;
    $('target-hp').style.width = `${hpPct}%`;
    this.targetPlayerId = playerId;
    const alreadyGrouped = playerId != null && !!this.party?.members.some(m => m.id === playerId);
    $('target-invite').classList.toggle('hidden', playerId == null || alreadyGrouped);
  }

  // ---- Groupe ----
  setParty(msg) {
    globalBus.emit('net:party-update', msg);
  }

  renderParty() {}

  updatePartyVitals(msg) {
    globalBus.emit('net:party-vitals', msg);
  }

  showPartyInvite(msg) {
    globalBus.emit('net:party-invite', msg);
  }
}