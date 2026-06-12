// Éditeur de carte admin HEADLESS : charge le vrai code (admin.js, admin/editor.js,
// admin/palette.js) dans Node avec un DOM factice, SANS serveur (API simulée).
// Vérifie : chargement sans exception, palette construite, zoom centré curseur,
// pan, peinture au pointeur, pose de prop avec variante/échelle/miroir, undo/redo.
// Usage : node tools/test-editor.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
process.on('uncaughtException', (e) => { failures.push(e); console.error('✘ EXCEPTION:', e.stack?.split('\n').slice(0, 4).join('\n')); });
process.on('unhandledRejection', (e) => { failures.push(e); console.error('✘ REJET:', (e?.stack || e)?.toString().split('\n').slice(0, 4).join('\n')); });
// les erreurs avalées par la boucle de rendu de l'éditeur comptent comme échecs
const realError = console.error;
console.error = (...a) => { if (String(a[0]).startsWith('éditeur')) failures.push(a); realError(...a); };

// ---------- DOM factice ----------
function ctxProxy() {
  return new Proxy(function () {}, {
    get(t, prop) {
      if (prop === Symbol.toPrimitive) return () => 1;
      if (prop === 'data') return new Proxy({}, { get: () => 0, set: () => true });
      return ctxProxy();
    },
    apply() { return ctxProxy(); },
    set() { return true; },
  });
}
class FakeClassList {
  constructor() { this.set = new Set(); }
  add(...c) { c.forEach(x => this.set.add(x)); }
  remove(...c) { c.forEach(x => this.set.delete(x)); }
  toggle(c, force) { const want = force ?? !this.set.has(c); want ? this.set.add(c) : this.set.delete(c); return want; }
  contains(c) { return this.set.has(c); }
}
const allElements = [];
class FakeElement {
  constructor(tag = 'div', id = '') {
    this.tagName = tag.toUpperCase(); this.id = id;
    this.children = []; this.dataset = {}; this.style = {};
    this.classList = new FakeClassList();
    this.value = ''; this.textContent = ''; this._innerHTML = '';
    this.checked = false; this.title = ''; this.width = 0; this.height = 0;
    this._listeners = {};
    allElements.push(this);
  }
  set className(v) { this.classList.set = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get className() { return [...this.classList.set].join(' '); }
  get innerHTML() { return this._innerHTML; }
  set innerHTML(v) { this._innerHTML = v; this.children = []; }
  appendChild(c) { this.children.push(c); return c; }
  append(...cs) { this.children.push(...cs); }
  addEventListener(t, fn) { (this._listeners[t] ||= []).push(fn); }
  removeEventListener() {}
  fire(t, ev = {}) { for (const fn of this._listeners[t] || []) fn({ preventDefault() {}, ...ev }); }
  getContext() { return ctxProxy(); }
  getBoundingClientRect() { return { left: 0, top: 0, width: this.width || 100, height: this.height || 100 }; }
  click() {} focus() {} blur() {}
  // descendants + sélecteur de classe minimal (pour compter les vignettes)
  _descendants(out = []) { for (const c of this.children) if (c instanceof FakeElement) { out.push(c); c._descendants(out); } return out; }
  querySelectorAll(sel) { return this._descendants().filter(e => sel.startsWith('.') && e.classList.contains(sel.slice(1))); }
}
const elements = new Map();
const doc = {
  getElementById(id) {
    if (!elements.has(id)) elements.set(id, new FakeElement(id.includes('canvas') || id.includes('mini') ? 'canvas' : 'div', id));
    return elements.get(id);
  },
  createElement(tag) { return new FakeElement(tag); },
  createTextNode(t) { return { nodeType: 3, textContent: t }; },
  querySelector() { return null; },
  querySelectorAll(sel) { return allElements.filter(e => sel.startsWith('.') && e.classList.contains(sel.slice(1))); },
  addEventListener() {},
  activeElement: null,
};
const winListeners = {};
const win = {
  addEventListener(t, fn) { (winListeners[t] ||= []).push(fn); },
  removeEventListener() {},
  fire(t, ev = {}) { for (const fn of winListeners[t] || []) fn({ preventDefault() {}, ...ev }); },
  innerWidth: 1280, innerHeight: 800,
};
globalThis.document = doc;
globalThis.window = win;
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(performance.now()), 16);
globalThis.Image = class { set src(v) { setTimeout(() => this.onload?.(), 0); } };
globalThis.confirm = () => false;
globalThis.alert = () => {};
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'client/assets/manifest.json'), 'utf8'));
globalThis.fetch = async (url) => {
  if (String(url).includes('manifest.json')) return { ok: true, json: async () => manifest };
  throw new Error('fetch inattendu : ' + url);
};

// canvas principal et mini-carte aux dimensions de admin.html
const canvas = doc.getElementById('map-canvas');
canvas.width = 1000; canvas.height = 704;
const mini = doc.getElementById('map-mini');
mini.width = 168; mini.height = 168;

// ---------- API admin simulée ----------
const zonesData = JSON.parse(fs.readFileSync(path.join(ROOT, 'content/zones.json'), 'utf8'));
const api = async (url) => {
  if (url === '/api/admin/content/zones') return zonesData;
  if (url.startsWith('/api/admin/overrides/')) return { tiles: [], props: { add: [], remove: [] } };
  if (url === '/api/admin/players') return { players: [] };
  return { ok: true };
};

// ---------- charge le VRAI code ----------
const checks = [];
const ok = (name, cond) => { checks.push([name, !!cond]); console.log(cond ? '  ✔' : '  ✘', name); };

await import('../client/js/admin.js'); // graphe complet (sans connexion : token absent)
console.log('✔ admin.js chargé');
const { initMapEditor } = await import('../client/js/admin/editor.js');
const ed = await initMapEditor({ api, zones: zonesData.zones });
ok('éditeur initialisé (zone 0 générée, vue ajustée)', ed && ed.getView().z > 0);

// palette : sols + tous les props avec variantes
const chips = doc.getElementById('map-palette').querySelectorAll('.pal-chip');
ok(`palette construite (${chips.length} vignettes, sols + variantes de props)`, chips.length >= 50);

// zoom à la molette, centré sur le curseur
const z0 = ed.getView().z;
for (let i = 0; i < 20; i++) canvas.fire('wheel', { clientX: 500, clientY: 352, deltaY: -100 });
ok('zoom molette (jusqu\'au rendu sprites)', ed.getView().z > z0 && ed.getView().z >= 12);

// pan au clic milieu
const cx0 = ed.getView().cx;
canvas.fire('pointerdown', { clientX: 500, clientY: 352, button: 1 });
canvas.fire('pointermove', { clientX: 560, clientY: 392, button: 1 });
win.fire('pointerup', {});
ok('pan au clic milieu (la vue suit le curseur)', ed.getView().cx !== cx0);

// peinture d'une tuile au pointeur (outil par défaut : herbe)
canvas.fire('pointerdown', { clientX: 500, clientY: 352, button: 0 });
win.fire('pointerup', {});
ok('peinture au clic : un override de tuile enregistré', ed.getOverrides().tiles.length === 1);

// pose d'un prop avec variante, échelle et miroir
ed.setTool({ kind: 'prop', type: 'tree', v: 7, s: 1.5, flip: true });
canvas.fire('pointerdown', { clientX: 520, clientY: 360, button: 0 });
win.fire('pointerup', {});
const added = ed.getOverrides().props.add[0];
ok('pose de prop : variante/échelle/miroir dans l\'override',
  added && added.type === 'tree' && added.v === 7 && added.s === 1.5 && added.rot === Math.PI);

// annuler / rétablir (Ctrl+Z / Ctrl+Maj+Z)
win.fire('keydown', { code: 'KeyZ', ctrlKey: true });
ok('Ctrl+Z : la pose de prop est annulée', ed.getOverrides().props.add.length === 0);
win.fire('keydown', { code: 'KeyZ', ctrlKey: true, shiftKey: true });
ok('Ctrl+Maj+Z : la pose de prop est rétablie', ed.getOverrides().props.add.length === 1);
win.fire('keydown', { code: 'KeyZ', ctrlKey: true });
win.fire('keydown', { code: 'KeyZ', ctrlKey: true });
ok('Ctrl+Z ×2 : retour à l\'état initial', ed.getOverrides().tiles.length === 0
  && ed.getOverrides().props.add.length === 0);

// laisse la boucle de rendu dessiner quelques frames en mode sprites (chunks)
await new Promise(r => setTimeout(r, 400));
ok('aucune exception (chargement, rendu chunks, outils)', failures.length === 0);

const bad = checks.filter(([, c]) => !c).length;
console.log(bad ? `\n${bad} ÉCHEC(S)` : '\nÉDITEUR HEADLESS OK');
process.exit(bad ? 1 : 0);
