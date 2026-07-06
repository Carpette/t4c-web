// Client HEADLESS : exécute le vrai code client (main.js et tout son graphe)
// dans Node avec un DOM factice, contre un vrai serveur. Toute exception du
// flux connexion -> création -> entrée en jeu -> rendu apparaît ici.
// Usage : node tools/test-client.mjs [url=http://localhost:8090]
import { register } from 'node:module';
import { PROTOCOL_VERSION } from '../shared/constants.js';
import WebSocket from 'ws';

// Le client importe petite-vue par chemin ABSOLU ('/js/vendor/petite-vue.js'),
// que le navigateur résout via HTTP mais que Node ne sait pas charger : on
// enregistre un résolveur qui fait pointer '/…' sur le dossier client/.
register('./client-loader.mjs', import.meta.url);

const BASE = process.argv[2] || 'http://localhost:8090';
const failures = [];
process.on('uncaughtException', (e) => { failures.push(e); console.error('✘ EXCEPTION:', e.stack?.split('\n').slice(0, 5).join('\n')); });
process.on('unhandledRejection', (e) => { failures.push(e); console.error('✘ REJET NON GÉRÉ:', (e?.stack || e)?.toString().split('\n').slice(0, 5).join('\n')); });

// ---------- DOM factice ----------
const NUM1 = { [Symbol.toPrimitive]: () => 1 };
function ctxProxy() {
  return new Proxy(function () {}, {
    get(t, prop) {
      if (prop === Symbol.toPrimitive) return () => 1;
      if (prop === 'width') return 1;
      return ctxProxy();
    },
    apply() { return ctxProxy(); },
    set() { return true; },
  });
}
class FakeClassList {
  constructor(el) { this.el = el; this.set = new Set(); }
  add(...c) { c.forEach(x => this.set.add(x)); }
  remove(...c) { c.forEach(x => this.set.delete(x)); }
  toggle(c, force) { const want = force ?? !this.set.has(c); want ? this.set.add(c) : this.set.delete(c); return want; }
  contains(c) { return this.set.has(c); }
}
const allElements = []; // registre : permet de vrais querySelectorAll
class FakeElement {
  constructor(tag = 'div', id = '') {
    this.tagName = tag.toUpperCase(); this.id = id;
    this.children = []; this.parent = null; this.dataset = {};
    // style factice : propriétés directes + setProperty (variables CSS --x)
    this.style = { setProperty() {}, removeProperty() {}, getPropertyValue() { return ''; } };
    this.classList = new FakeClassList(this);
    this.value = ''; this.textContent = ''; this._innerHTML = '';
    this.width = 1280; this.height = 800;
    this.title = ''; this.disabled = false;
    allElements.push(this);
  }
  // petite-vue (mount/walk) : type de nœud, attributs, fratrie
  get nodeType() { return 1; }
  get parentNode() { return this.parent; }
  get childNodes() { return this.children; }
  get firstChild() { return this.children[0] || null; }
  get nextSibling() {
    const sib = this.parent?.children || [];
    return sib[sib.indexOf(this) + 1] || null;
  }
  get attributes() { return []; }
  hasAttribute() { return false; }
  getAttribute() { return null; }
  cloneNode() { return new FakeElement(this.tagName, this.id); }
  matches(sel) { try { return this._matchesSel(sel); } catch { return false; } }
  get className() { return [...this.classList.set].join(' '); }
  set className(v) { this.classList.set = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get innerHTML() { return this._innerHTML; }
  set innerHTML(v) { this._innerHTML = v; this.children = []; }
  appendChild(c) { this.children.push(c); if (c instanceof FakeElement) c.parent = this; return c; }
  append(...cs) { for (const c of cs) this.appendChild(c); }
  before(c) {}
  insertAdjacentHTML() {}
  addEventListener() {}
  removeEventListener() {}
  // sélecteurs simples : '.classe', '#id', 'tag', et descendants 'a b'
  _matches(part) {
    if (part.startsWith('.')) return this.classList.contains(part.slice(1));
    if (part.startsWith('#')) return this.id === part.slice(1);
    return this.tagName === part.toUpperCase();
  }
  _matchesSel(sel) {
    const parts = sel.trim().split(/\s+/);
    if (!this._matches(parts[parts.length - 1])) return false;
    let node = this.parent;
    for (let i = parts.length - 2; i >= 0; i--) {
      while (node && !node._matches(parts[i])) node = node.parent;
      if (!node) return false;
      node = node.parent;
    }
    return true;
  }
  _descendants(out = []) {
    for (const c of this.children) if (c instanceof FakeElement) { out.push(c); c._descendants(out); }
    return out;
  }
  querySelector(sel) { return this._descendants().find(e => e._matchesSel(sel)) || null; }
  querySelectorAll(sel) { return this._descendants().filter(e => e._matchesSel(sel)); }
  getContext() { return ctxProxy(); }
  toDataURL() { return 'data:image/png;base64,'; }
  getBoundingClientRect() { return { left: 0, top: 0, width: this.width, height: this.height }; }
  focus() {} blur() {} remove() {}
  setAttribute() {} removeAttribute() {}
}
const elements = new Map();
const doc = {
  getElementById(id) {
    if (!elements.has(id)) {
      const el = new FakeElement(id.includes('canvas') || id === 'game' ? 'canvas' : 'div', id);
      // les panneaux/écrans démarrent cachés comme dans index.html (sauf login)
      if (id !== 'login') el.classList.add('hidden');
      elements.set(id, el);
    }
    return elements.get(id);
  },
  createElement(tag) { return new FakeElement(tag); },
  querySelector(sel) { return allElements.find(e => e._matchesSel(sel)) || null; },
  querySelectorAll(sel) { return allElements.filter(e => e._matchesSel(sel)); },
  addEventListener() {},
  activeElement: null,
};
doc.body = new FakeElement('body', 'body');
const listeners = {};
const win = {
  addEventListener(t, fn) { (listeners[t] ||= []).push(fn); },
  removeEventListener() {},
  innerWidth: 1280, innerHeight: 800,
  location: new URL(BASE),
};
globalThis.HTMLTemplateElement = class HTMLTemplateElement {}; // instanceof petite-vue
globalThis.document = doc;
globalThis.window = win;
globalThis.localStorage = { _m: new Map(), getItem(k) { return this._m.get(k) ?? null; }, setItem(k, v) { this._m.set(k, String(v)); }, removeItem(k) { this._m.delete(k); } };
globalThis.location = win.location;
globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(performance.now()), 16);
globalThis.Image = class { set src(v) { setTimeout(() => this.onload?.(), 0); } };
// Audio factice : supporte loop/volume + addEventListener('ended') (playlists de
// groupes) et play/pause/src, sans rien jouer réellement.
globalThis.Audio = class { constructor() { this.loop = false; this.volume = 1; } addEventListener() {} removeEventListener() {} play() { return Promise.resolve(); } pause() {} set src(v) {} };
globalThis.WebSocket = WebSocket; // client ws de Node (API compatible)
const realFetch = globalThis.fetch;
globalThis.fetch = (url, opts) => realFetch(String(url).startsWith('/') ? BASE + url : url, opts);
globalThis.prompt = () => null;
globalThis.alert = () => {};

const MODE = process.argv[3] || 'register'; // register = inscription ; login = compte existant
// compte explicite (ex. rejouer un cas réel) : node tools/test-client.mjs url login Nom MotDePasse
const FORCED = process.argv[4] ? { name: process.argv[4], pass: process.argv[5] || 'test1234' } : null;
const NAME = FORCED?.name || ('Headless_' + Math.floor(Math.random() * 1e6));
const PASS = FORCED?.pass || 'test1234';

if (MODE === 'login' && !FORCED) {
  // pré-crée un compte avec personnage (via WS brut)
  await new Promise((resolve, reject) => {
    const ws = new WebSocket(BASE.replace('http', 'ws'));
    ws.on('open', () => ws.send(JSON.stringify({ t: 'register', v: PROTOCOL_VERSION, name: NAME, pass: 'test1234' })));
    ws.on('message', (raw, bin) => {
      if (bin) return;
      const m = JSON.parse(raw.toString());
      if (m.t === 'create_char') ws.send(JSON.stringify({ t: 'create', stats: { str: 22, end: 18, agi: 14, int: 8, wis: 8 } }));
      if (m.t === 'welcome') { ws.close(); resolve(); }
      if (m.t === 'auth_error') reject(new Error(m.error));
    });
    setTimeout(() => reject(new Error('timeout pré-création')), 8000);
  });
  console.log('compte prêt :', NAME);
}

// ---------- charge le VRAI client ----------
await import('../client/js/main.js');
console.log('✔ main.js chargé (assets, monde initial, connexion)');

// ---------- connexion via l'UI ----------
// Depuis la migration petite-vue, login/création/paramètres sont des
// composants dont les gabarits HTML ne prennent vie qu'avec un vrai DOM :
// le flux cliqué n'est plus pilotable ici (suivi : passer le DOM factice à
// linkedom/jsdom). On vérifie donc : graphe de modules complet, boot de
// petite-vue, assets, et les helpers d'interface purs.
doc.getElementById('login-name').value = NAME;
doc.getElementById('login-pass').value = PASS;
const btn = doc.getElementById(MODE === 'login' ? 'btn-login' : 'btn-register');
const uiFlow = typeof btn.onclick === 'function';
if (uiFlow) btn.onclick();
else console.log('⚠ flux cliqué non couvert headless (composants petite-vue)');

// l'écran de création apparaît à l'inscription, mais aussi à la connexion
// d'un compte dont le personnage est mort (permadeath) : on gère les deux
await new Promise(r => setTimeout(r, 1500));
// visibilité RÉELLE : l'élément ET tous ses ancêtres doivent être visibles
// (un panneau « affiché » dans un parent caché reste invisible à l'écran —
// c'est exactement le bug de l'écran de création imbriqué dans #hud)
const reallyVisible = (el) => {
  for (let n = el; n && n.classList; n = n.parentNode) {
    if (n.classList.contains('hidden')) return false;
  }
  return true;
};
if (uiFlow && !doc.getElementById('creation').classList.contains('hidden')) {
  const creation = doc.getElementById('creation');
  if (!reallyVisible(creation)) {
    console.error('✘ écran de création « affiché » mais invisible (un ancêtre est caché)');
    process.exit(1);
  }
  console.log('écran de création visible :', reallyVisible(creation));
  for (let round = 0; round < 6; round++) {
    const rows = doc.getElementById('creation-stats').children;
    for (const row of rows) {
      const ctrls = row.children[row.children.length - 1];
      const plus = ctrls?.children?.[2];
      if (typeof plus?.onclick === 'function' && !plus.disabled) plus.onclick();
    }
  }
  const confirm = doc.getElementById('creation-confirm');
  console.log('confirmation activée :', !confirm.disabled);
  if (typeof confirm.onclick === 'function') confirm.onclick();
  else { console.error('✘ bouton de confirmation non câblé'); }
}

// ---------- ouverture du panneau Paramètres (renderSettings) ----------
// La lecture des réglages et le rendu des sections (Audio/Affichage/Confort/
// Interface) ne doivent jamais jeter, même avec le DOM factice.
let settingsOk = false;
try {
  if (!uiFlow) throw Object.assign(new Error('skip'), { skip: true });
  doc.getElementById('menu-settings').onclick?.(); // ouvre + appelle renderSettings()
  const list = doc.getElementById('settings-list');
  settingsOk = (list?.children?.length || 0) > 0;
  // bascule quelques contrôles puis réinitialise (tout doit rester sans exception)
  for (const row of list.children) {
    const ctrl = row.children[row.children.length - 1];
    if (ctrl?.type === 'checkbox' && typeof ctrl.onchange === 'function') { ctrl.checked = !ctrl.checked; ctrl.onchange(); }
  }
  const reset = doc.getElementById('settings-reset');
  if (typeof reset.onclick === 'function') reset.onclick();
} catch (e) { if (!e.skip) { failures.push(e); console.error('✘ EXCEPTION renderSettings:', e.message); } }

// ---------- observe pendant 4 s (boot complet, timers, rAF) ----------
await new Promise(r => setTimeout(r, 4000));

// ---------- helpers d'interface purs (barre de sorts, boutique, assets) ----------
// Exécutés sur les VRAIS modules chargés : toute rupture de contrat
// (retour d'assets, icônes de sorts/objets, composants) casse ici.
let assetsOk = false, spellIconOk = false, compIconOk = false;
try {
  const { loadAssets } = await import('../client/js/render2d/assets.js');
  const a = await loadAssets();
  assetsOk = a.manifest && a.images instanceof Map && a.skins
    && a.skins.items && a.skins.spells && a.skins.npcs
    && a.fxById && Object.keys(a.fxById).length >= 60;
} catch (e) { failures.push(e); console.error('✘ EXCEPTION loadAssets:', e.message); }
try {
  const { rawUiContainer } = await import('../client/js/gui/ui-store.js');
  const ui = rawUiContainer.instance;
  // sort sans skin assigné : repli émoji ; sort inconnu : étincelle par défaut
  spellIconOk = !!ui && ui.spellIconHtml({ id: 'zzz_inconnu', type: 'heal' }) === '💚'
    && ui.spellIconHtml({ id: 'zzz_inconnu', type: 'inconnu' }) === '✨';
} catch (e) { failures.push(e); console.error('✘ EXCEPTION spellIconHtml:', e.message); }
try {
  const { SpellsController } = await import('../client/js/gui/components/spells/spells.js');
  const { ShopController } = await import('../client/js/gui/components/shop/shop.js');
  const sc = SpellsController(), hc = ShopController();
  compIconOk = typeof sc.getSpellIconHtml === 'function' && typeof hc.getSpellIconHtml === 'function'
    && sc.getSpellIconHtml({ id: 'zzz', type: 'bolt' }) === '⚡';
} catch (e) { failures.push(e); console.error('✘ EXCEPTION composants sorts/boutique:', e.message); }

const checks = [
  ['version affichée au login (bas gauche)', String(doc.getElementById('game-version').textContent).startsWith('v')],
  ['graphe client complet chargé (main.js et ses imports)', true],
  ['assets complets (manifest, images, skins 4 sections, 60+ presets fx)', assetsOk],
  ['icônes de sorts : repli émoji correct (ui.spellIconHtml)', spellIconOk],
  ['composants Sorts/Boutique : helpers d\u2019icônes présents et fonctionnels', compIconOk],
  ['aucune exception client (boot, petite-vue, timers, rendu)', failures.length === 0],
];
let bad = 0;
for (const [name, ok] of checks) { console.log(ok ? '  ✔' : '  ✘', name); if (!ok) bad++; }
console.log(bad ? `\n${bad} ÉCHEC(S)` : '\nCLIENT HEADLESS OK');
process.exit(bad ? 1 : 0);
