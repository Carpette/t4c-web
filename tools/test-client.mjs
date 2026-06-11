// Client HEADLESS : exécute le vrai code client (main.js et tout son graphe)
// dans Node avec un DOM factice, contre un vrai serveur. Toute exception du
// flux connexion -> création -> entrée en jeu -> rendu apparaît ici.
// Usage : node tools/test-client.mjs [url=http://localhost:8090]
import WebSocket from 'ws';

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
class FakeElement {
  constructor(tag = 'div', id = '') {
    this.tagName = tag.toUpperCase(); this.id = id;
    this.children = []; this.dataset = {}; this.style = {};
    this.classList = new FakeClassList(this);
    this.value = ''; this.textContent = ''; this._innerHTML = '';
    this.width = 1280; this.height = 800;
    this.title = ''; this.disabled = false;
  }
  get innerHTML() { return this._innerHTML; }
  set innerHTML(v) { this._innerHTML = v; this.children = []; }
  appendChild(c) { this.children.push(c); return c; }
  append(...cs) { this.children.push(...cs); }
  before(c) {}
  insertAdjacentHTML() {}
  addEventListener() {}
  removeEventListener() {}
  querySelector() { return null; }
  querySelectorAll() { return []; }
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
  querySelectorAll() { return []; },
  addEventListener() {},
  activeElement: null,
};
const listeners = {};
const win = {
  addEventListener(t, fn) { (listeners[t] ||= []).push(fn); },
  removeEventListener() {},
  innerWidth: 1280, innerHeight: 800,
  location: new URL(BASE),
};
globalThis.document = doc;
globalThis.window = win;
globalThis.localStorage = { _m: new Map(), getItem(k) { return this._m.get(k) ?? null; }, setItem(k, v) { this._m.set(k, String(v)); }, removeItem(k) { this._m.delete(k); } };
globalThis.location = win.location;
globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(performance.now()), 16);
globalThis.Image = class { set src(v) { setTimeout(() => this.onload?.(), 0); } };
globalThis.Audio = class { constructor() { this.loop = false; this.volume = 1; } play() { return Promise.resolve(); } pause() {} set src(v) {} };
globalThis.WebSocket = WebSocket; // client ws de Node (API compatible)
const realFetch = globalThis.fetch;
globalThis.fetch = (url, opts) => realFetch(String(url).startsWith('/') ? BASE + url : url, opts);
globalThis.prompt = () => null;
globalThis.alert = () => {};

const MODE = process.argv[3] || 'register'; // register = inscription + écran de création ; login = compte existant
const NAME = 'Headless_' + Math.floor(Math.random() * 1e6);

if (MODE === 'login') {
  // pré-crée un compte avec personnage (via WS brut)
  await new Promise((resolve, reject) => {
    const ws = new WebSocket(BASE.replace('http', 'ws'));
    ws.on('open', () => ws.send(JSON.stringify({ t: 'register', name: NAME, pass: 'test1234' })));
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

// ---------- connexion via l'UI (comme un clic sur le bouton) ----------
doc.getElementById('login-name').value = NAME;
doc.getElementById('login-pass').value = 'test1234';
const btn = doc.getElementById(MODE === 'login' ? 'btn-login' : 'btn-register');
if (typeof btn.onclick !== 'function') { console.error('✘ bouton non câblé'); process.exit(1); }
btn.onclick();

if (MODE === 'register') {
  // attend l'écran de création, répartit les 30 points (6 par stat), confirme
  await new Promise(r => setTimeout(r, 1500));
  const creation = doc.getElementById('creation');
  console.log('écran de création visible :', !creation.classList.contains('hidden'));
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

// ---------- observe pendant 6 s ----------
await new Promise(r => setTimeout(r, 6000));
const hud = doc.getElementById('hud');
const checks = [
  ['HUD affiché après welcome', !hud.classList.contains('hidden')],
  ['écran de connexion masqué', doc.getElementById('login').classList.contains('hidden')],
  ['barre de vie remplie', String(doc.getElementById('hp-text').textContent).includes('/')],
  ['bannière de zone (Arakas)', String(doc.getElementById('zone-banner').textContent).includes('Arakas')],
  ['aucune exception client', failures.length === 0],
];
let bad = 0;
for (const [name, ok] of checks) { console.log(ok ? '  ✔' : '  ✘', name); if (!ok) bad++; }
console.log(bad ? `\n${bad} ÉCHEC(S)` : '\nCLIENT HEADLESS OK');
process.exit(bad ? 1 : 0);
