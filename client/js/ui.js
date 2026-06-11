// Interface : connexion, HUD, inventaire (poupée T4C), fiche perso, chat, dégâts flottants
import { STAT_NAMES, STATS } from '../../shared/constants.js';
import { ITEMS, QUALITY, SLOTS, SLOT_NAMES } from '../../shared/defs.js';
import { LAYER_ORDER } from './render2d/anim.js';
import { SETTING_DEFS, SETTING_CHOICES, settings, setSetting } from './settings.js';
import { refreshMusic } from './music.js';

const SLOT_ICONS = { weapon: '⚔️', shield: '🛡️', armor: '🥋', helmet: '⛑️', legs: '👖', gloves: '🧤', belt: '🎗️', boots: '🥾', ring: '💍', ring2: '💍', amulet: '📿', use: '🧪', gold: '🟡' };
const SPELL_ICONS = { bolt: '⚡', heal: '💚', aoe: '🔥', buff: '✨' };
const $ = (id) => document.getElementById(id);

export class UI {
  constructor(net) {
    this.net = net;
    this.self = null;
    this.spellDefs = [];      // chargés depuis /content/spells.json
    this.activeSpell = null;  // sort lancé via Ctrl+clic
    this.hotkeys = {};        // touche -> spellId
    this.cds = {};            // spellId -> timestamp de fin
    this.bindingSpell = null;
    try { this.hotkeys = JSON.parse(localStorage.getItem('t4c_hotkeys') || '{}'); } catch {}

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
      }
      this.bindingSpell = null;
      this.renderSpellPanel();
      this.renderSpellbar();
    }, true);

    // Connexion
    const submit = (type) => {
      const name = $('login-name').value.trim();
      const pass = $('login-pass').value;
      if (!name || !pass) { this.loginError('Pseudo et mot de passe requis'); return; }
      net.send({ t: type, name, pass });
    };
    $('btn-login').onclick = () => submit('login');
    $('btn-register').onclick = () => submit('register');
    $('login-pass').addEventListener('keydown', e => { if (e.key === 'Enter') submit('login'); });

    // Panneaux
    document.querySelectorAll('#hotbuttons button').forEach(b => {
      b.onclick = () => this.togglePanel(b.dataset.panel);
    });

    // Chat
    this.chatInput = $('chat-input');
    this.chatInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        const text = this.chatInput.value.trim();
        if (text) net.send({ t: 'chat', text });
        this.chatInput.value = '';
        this.chatInput.blur();
      }
      if (e.key === 'Escape') this.chatInput.blur();
      e.stopPropagation();
    });

    $('btn-respawn').onclick = () => net.send({ t: 'newchar' });

    // poser de l'or au sol (échange entre joueurs)
    $('btn-drop-gold').onclick = () => {
      const max = this.self?.gold || 0;
      if (!max) return;
      const v = prompt(`Combien d'or poser au sol ? (vous : ${max})`, '');
      const amount = Math.min(max, Math.max(0, parseInt(v, 10) || 0));
      if (amount > 0) net.send({ t: 'drop', gold: amount });
    };

    // ---- Menu de jeu (Échap) ----
    $('menu-resume').onclick = () => this.hideMenu();
    $('menu-settings').onclick = () => {
      $('menu-buttons').classList.add('hidden');
      $('menu-settings-panel').classList.remove('hidden');
      this.renderSettings();
    };
    $('menu-back').onclick = () => {
      $('menu-settings-panel').classList.add('hidden');
      $('menu-buttons').classList.remove('hidden');
    };
    $('menu-quit').onclick = () => {
      try { net.ws?.close(1000, 'logout'); } catch {}
      location.reload(); // retour propre à l'écran de connexion
    };
    $('btn-trial-go').onclick = () => { $('trial-modal').classList.add('hidden'); net.send({ t: 'trial_enter' }); };
    $('btn-trial-no').onclick = () => $('trial-modal').classList.add('hidden');
    document.querySelectorAll('#shop-tabs button').forEach(b => {
      b.onclick = () => {
        document.querySelectorAll('#shop-tabs button').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        this.shopTab = b.dataset.tab;
        this.renderShop();
      };
    });
    this.shopTab = 'items';
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
    const lootKey = ITEMS[defId]?.loot;
    const entry = lootKey && this.assets.manifest.loot[lootKey];
    const img = entry && this.assets.images.get(entry.image);
    let url = null;
    if (img) {
      const [x, y, w, h] = entry.frame;
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
  setSpellDefs(defs) { this.spellDefs = defs; }
  spellDef(id) { return this.spellDefs.find(s => s.id === id); }
  knownSpells() { return (this.self?.spells || []).map(id => this.spellDef(id)).filter(Boolean); }

  // ---- Panneau des sorts + raccourcis ----
  renderSpellPanel() {
    const div = $('spell-list');
    if (!div) return;
    div.innerHTML = '';
    if (this.bindingError) {
      const err = document.createElement('p');
      err.style.cssText = 'color:#e86a6a;font-size:12px;margin-bottom:6px';
      err.textContent = this.bindingError;
      div.appendChild(err);
    }
    const known = this.knownSpells();
    if (!known.length) { div.innerHTML += '<p class="hint">Aucun sort appris. Voyez le marchand du village.</p>'; return; }
    for (const sp of known) {
      const row = document.createElement('div');
      row.className = 'spell-row' + (this.activeSpell === sp.id ? ' active-spell' : '');
      const key = Object.keys(this.hotkeys).find(k => this.hotkeys[k] === sp.id);
      row.innerHTML = `<span>${SPELL_ICONS[sp.type] || '✨'} ${sp.name} <span class="meta">(${sp.mana} mana)</span></span>`;
      const btn = document.createElement('button');
      btn.textContent = this.bindingSpell === sp.id ? 'Touche ?' : (key ? `« ${key.toUpperCase()} »` : 'Raccourci');
      btn.onclick = (e) => { e.stopPropagation(); this.bindingSpell = sp.id; this.renderSpellPanel(); };
      row.appendChild(btn);
      row.onclick = () => { this.activeSpell = this.activeSpell === sp.id ? null : sp.id; this.renderSpellPanel(); this.renderSpellbar(); };
      div.appendChild(row);
    }
  }

  renderSpellbar() {
    const bar = $('spellbar');
    bar.innerHTML = '';
    for (const sp of this.knownSpells()) {
      const slot = document.createElement('div');
      slot.className = 'spell-slot' + (this.activeSpell === sp.id ? ' active' : '');
      const key = Object.keys(this.hotkeys).find(k => this.hotkeys[k] === sp.id);
      slot.innerHTML = `<span class="icon">${SPELL_ICONS[sp.type] || '✨'}</span>` +
        (key ? `<span class="key">${key.toUpperCase()}</span>` : '');
      slot.title = `${sp.name} — ${sp.mana} mana` + (key ? ` — touche ${key.toUpperCase()}` : '');
      slot.dataset.spell = sp.id;
      slot.onclick = () => { this.activeSpell = this.activeSpell === sp.id ? null : sp.id; this.renderSpellPanel(); this.renderSpellbar(); };
      const cd = document.createElement('div');
      cd.className = 'cd hidden';
      slot.appendChild(cd);
      bar.appendChild(slot);
    }
  }

  // ---- Paramètres (menu Échap) : libellé à gauche, contrôle aligné à droite ----
  renderSettings() {
    const div = $('settings-list');
    div.innerHTML = '';
    const onChanged = (key) => { if (key === 'musicOn' || key === 'musicPack') refreshMusic(); };
    const addRow = (label, control) => {
      const row = document.createElement('label');
      row.className = 'setting-row';
      const span = document.createElement('span');
      span.textContent = label;
      row.append(span, control);
      div.appendChild(row);
    };
    const addSection = (title) => {
      const h = document.createElement('div');
      h.className = 'setting-section';
      h.textContent = title;
      div.appendChild(h);
    };

    addSection('Audio');
    for (const [key, label] of SETTING_DEFS.filter(([k]) => k === 'musicOn')) {
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = settings[key];
      cb.onchange = () => { setSetting(key, cb.checked); onChanged(key); };
      addRow(label, cb);
    }
    for (const c of SETTING_CHOICES) {
      const sel = document.createElement('select');
      sel.innerHTML = c.options.map(([v, l]) =>
        `<option value="${v}"${settings[c.key] === v ? ' selected' : ''}>${l}</option>`).join('');
      sel.onchange = () => { setSetting(c.key, sel.value); onChanged(c.key); };
      addRow(c.label, sel);
    }

    addSection('Affichage');
    for (const [key, label] of SETTING_DEFS.filter(([k]) => k !== 'musicOn')) {
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = settings[key];
      cb.onchange = () => { setSetting(key, cb.checked); onChanged(key); };
      addRow(label, cb);
    }
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
    document.querySelectorAll('.spell-slot').forEach(slot => {
      const cd = slot.querySelector('.cd');
      const left = (this.cds[slot.dataset.spell] || 0) - now;
      if (left > 0) { cd.classList.remove('hidden'); cd.textContent = Math.ceil(left); }
      else cd.classList.add('hidden');
    });
  }

  // ---- Boutique ----
  showShop(msg) {
    this.shop = msg;
    $('shop-title').textContent = msg.name;
    $('shop').classList.remove('hidden');
    this.renderShop();
  }

  renderShop() {
    const div = $('shop-list');
    if (!this.shop) return;
    div.innerHTML = '';
    const gold = this.self?.gold || 0;
    const mk = (label, meta, price, disabled, onBuy, ownedText) => {
      const row = document.createElement('div');
      row.className = 'shop-row';
      row.innerHTML = `<span>${label}<br><span class="meta">${meta}</span></span>`;
      const btn = document.createElement('button');
      if (ownedText) { btn.textContent = ownedText; btn.disabled = true; }
      else {
        btn.textContent = `${price} 🟡`;
        btn.disabled = disabled || gold < price;
        btn.onclick = onBuy;
      }
      row.appendChild(btn);
      div.appendChild(row);
      return row;
    };
    if (this.shopTab === 'items') {
      for (const it of this.shop.items) {
        const meta = [
          it.dmgRange && `dégâts ${it.dmgRange}`,
          it.def && `défense ${it.def}`,
          it.heal && `+${it.heal} PV`, it.mana && `+${it.mana} mana`,
          it.weight && `${it.weight} kg`,
          it.reqText && `requis : ${it.reqText}`,
        ].filter(Boolean).join(' — ') || '';
        mk(`${this.itemIconHtml(it.defId, SLOT_ICONS[it.slot])} ${it.name}`, meta, it.price, false,
          () => this.net.send({ t: 'buy', kind: 'item', id: it.defId }));
      }
    } else if (this.shopTab === 'spells') {
      const elems = { feu: '🔥', eau: '❄', air: '🌪', terre: '⛰', lumiere: '☀', arcane: '🌑' };
      for (const sp of this.shop.spells) {
        const meta = `${elems[sp.element] || ''} ${sp.element || ''} — ${sp.mana} mana — requis : ${sp.reqText || '—'}`;
        const row = mk(`${SPELL_ICONS[sp.type] || '✨'} ${sp.name}`, meta, sp.price, !sp.reqMet,
          () => this.net.send({ t: 'buy', kind: 'spell', id: sp.id }), sp.known ? 'Appris' : null);
        if (!sp.known && !sp.reqMet) row.style.opacity = 0.55;
      }
    } else if (this.shopTab === 'skills') {
      // compétences T4C : apprentissage puis entraînement point par point
      for (const sk of this.shop.skills) {
        const maxTxt = sk.max >= 9999 ? '∞' : sk.max;
        const row = document.createElement('div');
        row.className = 'shop-row';
        row.innerHTML = `<span>🎖 ${sk.name} <b style="color:#ffd24a">${sk.pts}</b>/${maxTxt}<br>` +
          `<span class="meta">${sk.desc}<br>Requis : ${sk.reqText}</span></span>`;
        const btns = document.createElement('span');
        if (!sk.known) {
          const learn = document.createElement('button');
          learn.textContent = `Apprendre ${sk.learnCost} 🟡`;
          learn.disabled = !sk.reqMet || gold < sk.learnCost;
          learn.onclick = () => this.net.send({ t: 'buy', kind: 'skill', id: sk.id });
          btns.appendChild(learn);
          if (!sk.reqMet) row.style.opacity = 0.55;
        } else if (sk.pts < sk.max) {
          const train = document.createElement('button');
          train.textContent = `+1 pt (${sk.trainCost} 🟡)`;
          train.disabled = !sk.reqMet || gold < sk.trainCost;
          train.onclick = () => this.net.send({ t: 'buy', kind: 'train', id: sk.id });
          btns.appendChild(train);
        } else {
          const max = document.createElement('button');
          max.textContent = 'Maximum';
          max.disabled = true;
          btns.appendChild(max);
        }
        row.appendChild(btns);
        div.appendChild(row);
      }
    } else {
      // vente : l'inventaire du joueur, au prix d'achat
      const inv = this.self?.inventory || [];
      if (!inv.length) { div.innerHTML = '<p class="hint">Votre inventaire est vide.</p>'; return; }
      const equipped = new Set(Object.values(this.self?.equip || {}));
      for (const it of inv) {
        const row = document.createElement('div');
        row.className = 'shop-row';
        row.innerHTML = `<span>${this.itemIconHtml(it.defId, SLOT_ICONS[it.slot])} ${it.label}${equipped.has(it.iid) ? ' <span class="meta">(équipé)</span>' : ''}</span>`;
        const btn = document.createElement('button');
        btn.textContent = `Vendre ${it.price} 🟡`;
        btn.onclick = () => this.net.send({ t: 'sell', iid: it.iid });
        row.appendChild(btn);
        div.appendChild(row);
      }
    }
  }

  // ---- Banque : coffre personnel ----
  showBank(msg) {
    this.bank = msg;
    $('bank').classList.remove('hidden');
    this.renderBank();
  }

  renderBank() {
    if (!this.bank) return;
    const bankFull = this.bank.items.length >= this.bank.max;
    $('bank-count').textContent = `Banque ${this.bank.items.length} / ${this.bank.max}`;
    const mkRow = (parent, label, btnText, disabled, onClick) => {
      const row = document.createElement('div');
      row.className = 'shop-row';
      row.innerHTML = `<span>${label}</span>`;
      const btn = document.createElement('button');
      btn.textContent = btnText;
      btn.disabled = disabled;
      btn.onclick = onClick;
      row.appendChild(btn);
      parent.appendChild(row);
    };
    // objets en banque -> Retirer
    const list = $('bank-list');
    list.innerHTML = '';
    if (!this.bank.items.length) list.innerHTML = '<p class="hint">Votre coffre est vide.</p>';
    for (const it of this.bank.items) {
      mkRow(list, `${this.itemIconHtml(it.defId, SLOT_ICONS[it.slot])} ${it.label}`, 'Retirer', false,
        () => this.net.send({ t: 'bank_withdraw', iid: it.iid }));
    }
    // inventaire -> Déposer
    const inv = this.self?.inventory || [];
    const equipped = new Set(Object.values(this.self?.equip || {}));
    const invList = $('bank-inv-list');
    invList.innerHTML = '';
    if (!inv.length) invList.innerHTML = '<p class="hint">Votre inventaire est vide.</p>';
    for (const it of inv) {
      mkRow(invList,
        `${this.itemIconHtml(it.defId, SLOT_ICONS[it.slot])} ${it.label}${equipped.has(it.iid) ? ' <span class="meta">(équipé)</span>' : ''}`,
        'Déposer', bankFull,
        () => this.net.send({ t: 'bank_deposit', iid: it.iid }));
    }
  }

  // ---- Obélisque ----
  showObelisk(msg) {
    const div = $('obelisk-list');
    div.innerHTML = '';
    for (const z of msg.zones) {
      const btn = document.createElement('button');
      btn.textContent = `${z.name} (niv. ${z.levels[0]}-${z.levels[1]})` + (z.id === msg.current ? ' — ici' : '');
      btn.disabled = z.id === msg.current;
      btn.onclick = () => { $('obelisk-panel').classList.add('hidden'); this.net.send({ t: 'teleport', zoneId: z.id }); };
      div.appendChild(btn);
    }
    $('obelisk-panel').classList.remove('hidden');
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

  // ---- Création de personnage (répartition des points, façon T4C) ----
  showCreation(info) {
    $('login').classList.add('hidden');
    $('death-screen').classList.add('hidden');
    const alloc = {};
    for (const st of info.stats) alloc[st] = info.base;
    let left = info.pool;
    let sex = 'male';

    const render = () => {
      // choix du sexe
      let sexRow = $('creation-sex');
      if (!sexRow) {
        sexRow = document.createElement('div');
        sexRow.id = 'creation-sex';
        sexRow.style.cssText = 'display:flex;gap:8px;justify-content:center;margin-bottom:12px';
        $('creation-stats').before(sexRow);
      }
      sexRow.innerHTML = '';
      for (const [val, label] of [['male', '♂ Homme'], ['female', '♀ Femme']]) {
        const b = document.createElement('button');
        b.textContent = label;
        if (sex !== val) b.classList.add('secondary');
        b.onclick = () => { sex = val; render(); };
        sexRow.appendChild(b);
      }
      renderStats();
    };
    const renderStats = () => {
      const div = $('creation-stats');
      div.innerHTML = '';
      for (const st of info.stats) {
        const row = document.createElement('div');
        row.className = 'stat-alloc';
        const minus = document.createElement('button');
        minus.textContent = '−';
        minus.disabled = alloc[st] <= info.base;
        minus.onclick = () => { alloc[st]--; left++; render(); };
        const plus = document.createElement('button');
        plus.textContent = '+';
        plus.disabled = left <= 0 || alloc[st] >= info.max;
        plus.onclick = () => { alloc[st]++; left--; render(); };
        row.innerHTML = `<span>${info.names[st]}</span>`;
        const ctrls = document.createElement('span');
        const val = document.createElement('span');
        val.className = 'val';
        val.textContent = alloc[st];
        ctrls.append(minus, val, plus);
        row.appendChild(ctrls);
        div.appendChild(row);
      }
      $('creation-left').textContent = left > 0
        ? `Points restants : ${left}` : 'Tous les points sont répartis.';
      $('creation-confirm').disabled = left !== 0;
    };
    $('creation-confirm').onclick = () => {
      if (left !== 0) return;
      $('creation').classList.add('hidden');
      this.net.send({ t: 'create', stats: alloc, sex });
    };
    render();
    $('creation').classList.remove('hidden');
  }

  // ---- Menu de jeu ----
  menuOpen() { return !$('game-menu').classList.contains('hidden'); }
  showMenu() {
    $('menu-settings-panel').classList.add('hidden');
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
      def: '🛡 Protection', speed: '💨 Dextérité', dmg: '⚔ Instinct de Combat',
      regen: '💚 Régénération', maxhp: '❤ Bénédiction', str: '💪 Force de la Terre',
      light: '💡 Lumière',
    };
    $('buffs-display').innerHTML = (this.self?.buffs || [])
      .map(b => `${names[b.stat] || b.stat} (${b.left}s)`).join('<br>');
  }

  isTyping() { return document.activeElement === this.chatInput || document.activeElement?.tagName === 'INPUT'; }
  focusChat() { this.chatInput.focus(); }

  loginError(text) { $('login-error').textContent = text; }
  enterGame() {
    $('login').classList.add('hidden');
    $('hud').classList.remove('hidden');
  }

  togglePanel(name) {
    for (const p of ['inventory', 'character', 'help', 'spells', 'shop', 'obelisk-panel', 'bank']) {
      if (p === name) $(p).classList.toggle('hidden');
      else $(p).classList.add('hidden');
    }
  }

  setClock(daylight, frac) {
    $('clock').textContent = daylight > 0.45 ? '🌞' : daylight > 0.12 ? '🌅' : '🌙';
    $('clock').title = `Heure du monde : ${Math.floor(frac * 24)}h`;
  }

  updateVitals(hp, mana) {
    if (!this.self) return;
    this.self.hp = hp; this.self.mana = mana;
    this.renderBars();
  }

  renderBars() {
    const s = this.self;
    $('hp-fill').style.width = `${(s.hp / s.maxHp) * 100}%`;
    $('hp-text').textContent = `${s.hp} / ${s.maxHp}`;
    $('mana-fill').style.width = `${(s.mana / s.maxMana) * 100}%`;
    $('mana-text').textContent = `${s.mana} / ${s.maxMana}`;
    const span = Math.max(1, s.xpNext - s.xpCur);
    const into = s.xp - s.xpCur;
    $('xp-fill').style.width = `${Math.min(100, (into / span) * 100)}%`;
    $('xp-text').textContent = `Niv. ${s.level} — ${into} / ${span} XP`;
    $('gold-text').textContent = s.gold;
  }

  updateSelf(msg) {
    this.self = msg;
    this.renderBars();
    this.renderInventory();
    this.renderCharacter();
    this.renderSpellPanel();
    this.renderSpellbar();
    this.renderQuickbar();
    this.renderBuffs();
    if (this.shop) this.renderShop();
    if (this.bank && !$('bank').classList.contains('hidden')) this.renderBank();
  }

  // dessine le personnage avec son équipement dans l'inventaire (face caméra)
  drawDoll() {
    const canvas = $('doll-canvas');
    if (!canvas || !this.assets || !this.self) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const look = this.self.look || {};
    const sex = look.sex === 'female' ? 'female' : 'male';
    const sheet = this.assets.manifest.avatar[sex];
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
      const img = this.assets.images.get(sheet[name].image);
      if (!img) continue;
      // ancre des pieds au bas du canvas, agrandi x1.4
      const S = 1.4;
      ctx.drawImage(img, x, y, w, h, canvas.width / 2 - ox * S, canvas.height - 14 - oy * S, w * S, h * S);
    }
  }

  renderInventory() {
    const s = this.self;
    // --- poupée d'équipement ---
    this.drawDoll();
    document.querySelectorAll('.doll-slot').forEach(div => {
      const slot = div.dataset.slot;
      const iid = s.equip[slot];
      const item = iid && s.inventory.find(i => i.iid === iid);
      div.className = 'doll-slot';
      div.onmouseenter = div.onmousemove = div.onmouseleave = null;
      if (item) {
        div.classList.add('filled');
        if (item.q) div.classList.add(`q${item.q}`);
        div.textContent = '';
        div.appendChild(this.itemIconEl(item.defId, SLOT_ICONS[slot]));
        div.oncontextmenu = (e) => { e.preventDefault(); this.net.send({ t: 'unequip', slot }); };
        div.onclick = (e) => { e.preventDefault(); this.net.send({ t: 'unequip', slot }); };
        this.bindTooltip(div, () => this.itemTooltip(item));
      } else {
        div.textContent = '';
        div.title = SLOT_NAMES[slot];
        div.onclick = null;
        div.oncontextmenu = (e) => e.preventDefault();
      }
    });
    // --- jauge de poids (encombrement T4C) ---
    if (s.capacity != null) {
      const pct = Math.min(100, (s.weight / s.capacity) * 100);
      const fill = $('weight-fill');
      fill.style.width = `${pct}%`;
      fill.classList.toggle('over', pct >= 95);
      $('weight-text').textContent = `${s.weight} / ${s.capacity}`;
    }
    const grid = $('inv-grid');
    grid.innerHTML = '';
    const equippedIids = new Set(Object.values(s.equip));
    for (const item of s.inventory) {
      const div = document.createElement('div');
      div.className = 'inv-item' + (item.q ? ` q${item.q}` : '') + (equippedIids.has(item.iid) ? ' equipped' : '');
      div.appendChild(this.itemIconEl(item.defId, SLOT_ICONS[item.slot] || '❓'));
      div.onclick = () => {
        if (item.slot === 'use') this.net.send({ t: 'use', iid: item.iid });
        else if (equippedIids.has(item.iid)) this.net.send({ t: 'unequip', slot: item.slot });
        else this.net.send({ t: 'equip', iid: item.iid });
      };
      // clic droit : poser l'objet au sol (échange entre joueurs, à la T4C)
      div.oncontextmenu = (e) => {
        e.preventDefault();
        this.hideTooltip();
        this.net.send({ t: 'drop', iid: item.iid });
      };
      this.bindTooltip(div, () => this.itemTooltip(item));
      grid.appendChild(div);
    }
    for (let i = s.inventory.length; i < 24; i++) {
      const div = document.createElement('div');
      div.className = 'inv-item';
      div.style.opacity = 0.35;
      grid.appendChild(div);
    }
  }

  itemTooltip(item) {
    const def = ITEMS[item.defId];
    const q = QUALITY[item.q || 0];
    const mult = q.mult;
    let lines = [item.label];
    if (def.dmgMin != null) lines.push(`Dégâts : ${Math.round(def.dmgMin * mult)}-${Math.round(def.dmgMax * mult)} (vitesse ${def.speed}s)`);
    else if (def.dmg) lines.push(`Dégâts : ${Math.round(def.dmg * mult)} (vitesse ${def.speed}s)`);
    if (def.def) lines.push(`Défense : ${Math.round(def.def * mult)}`);
    if (def.heal) lines.push(`Rend ${def.heal} PV`);
    if (def.mana) lines.push(`Rend ${def.mana} mana`);
    if (def.weight) lines.push(`Poids : ${def.weight}`);
    if (def.req) {
      const names = { str: 'For', agi: 'Agi', int: 'Int', wis: 'Sag' };
      lines.push('Requis : ' + Object.entries(def.req).map(([s, v]) => `${names[s] || s} ${v}`).join(', '));
    }
    for (const [st, v] of Object.entries(item.bonus || {})) lines.push(`+${v} ${STAT_NAMES[st] || st}`);
    return lines.join('\n');
  }

  renderCharacter() {
    const s = this.self;
    $('char-name').textContent = `Niveau ${s.level}`;
    $('char-info').innerHTML =
      `PV : <b>${s.hp} / ${s.maxHp}</b> — Mana : <b>${s.mana} / ${s.maxMana}</b><br>` +
      `Dégâts : <b>${s.dmg}</b> — Défense : <b>${s.defense}</b><br>` +
      `Or : <b>${s.gold}</b><br>` +
      (s.statPoints > 0 ? `<span style="color:#8ae88a">Points à répartir : <b>${s.statPoints}</b></span>` : '');
    const div = $('char-stats');
    div.innerHTML = '';
    for (const st of STATS) {
      const row = document.createElement('div');
      row.className = 'stat-row';
      const eff = s.eff[st] !== s.stats[st] ? ` <span style="color:#5b9cff">(${s.eff[st]})</span>` : '';
      row.innerHTML = `<span>${STAT_NAMES[st]}</span><span>${s.stats[st]}${eff}</span>`;
      if (s.statPoints > 0) {
        const btn = document.createElement('button');
        btn.textContent = '+';
        btn.onclick = () => this.net.send({ t: 'alloc', stat: st });
        row.appendChild(btn);
      }
      div.appendChild(row);
    }
  }

  addChat(from, text, channelOrKind) {
    const div = document.createElement('div');
    if (from === 'sys') {
      div.className = 'sys';
      div.textContent = `✦ ${text}`;
    } else if (channelOrKind && channelOrKind !== 'local') {
      // Message de canal public
      div.className = `channel-${channelOrKind}`;
      const prefixMap = {
        general: '[Général]',
        aide: '[Aide]',
        ventes: '[Marché]',
        roleplay: '[RP]',
      };
      const prefix = prefixMap[channelOrKind] || `[${channelOrKind.toUpperCase()}]`;
      div.innerHTML = `<span class="prefix"></span> <span class="from"></span> : `;
      div.querySelector('.prefix').textContent = prefix;
      div.querySelector('.from').textContent = from;
      div.appendChild(document.createTextNode(text));
    } else {
      // Message local par défaut
      div.className = 'local';
      div.innerHTML = `<span class="from"></span> : `;
      div.querySelector('.from').textContent = from;
      div.appendChild(document.createTextNode(text));
    }
    const box = $('chat-messages');
    box.appendChild(div);
    while (box.children.length > 60) box.removeChild(box.firstChild);
    box.scrollTop = box.scrollHeight;
  }

  floater(screen, text, cls = '') {
    if (!screen.visible || !settings.showFloaters) return;
    const div = document.createElement('div');
    div.className = `floater ${cls}`;
    div.textContent = text;
    div.style.left = `${screen.x + (Math.random() - 0.5) * 30}px`;
    div.style.top = `${screen.y - 30}px`;
    $('floaters').appendChild(div);
    setTimeout(() => div.remove(), 1100);
  }

  showDeath(msg) {
    $('death-by').textContent = `${this.self?.level ? `Niveau ${msg.level}` : ''} — tué par ${msg.by} dans ${msg.zone}. Ce personnage est perdu à jamais.`;
    const pan = $('pantheon');
    pan.innerHTML = '<b style="color:#c8b87a">Panthéon des morts</b><br>' +
      (msg.pantheon || []).map(d =>
        `<div class="dead-row">☠ ${d.name} — niveau ${d.level}, tué par ${d.killer} (${d.zone})</div>`).join('');
    $('death-screen').classList.remove('hidden');
  }
  hideDeath() { $('death-screen').classList.add('hidden'); }

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

  setTarget(name, hpPct) {
    if (!name) { $('target-frame').classList.add('hidden'); return; }
    $('target-frame').classList.remove('hidden');
    $('target-name').textContent = name;
    $('target-hp').style.width = `${hpPct}%`;
  }
}
