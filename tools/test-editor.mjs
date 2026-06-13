// Éditeur de carte admin HEADLESS : charge le vrai code (admin.js, admin/editor.js,
// admin/palette.js) dans Node avec un DOM factice, SANS serveur (API simulée).
// Vérifie : chargement sans exception, palette construite, zoom centré curseur,
// pan, peinture au pointeur, pose de prop avec variante/échelle/miroir, undo/redo.
// Usage : node tools/test-editor.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { register } from 'node:module';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// En production, le serveur sert /shared/ depuis la RACINE : admin.js (servi
// sous /js/) importe donc « ../shared/defs.js » -> /shared/defs.js. Hors
// navigateur, ce chemin tombe sur client/shared/ (inexistant). Ce hook de
// résolution renvoie le vrai dossier shared/ pour exécuter le code tel quel.
register('data:text/javascript,' + encodeURIComponent(`
  import { pathToFileURL } from 'node:url';
  const SHARED = ${JSON.stringify(pathToFileURLString())};
  export async function resolve(spec, ctx, next) {
    if (spec.startsWith('../shared/') && ctx.parentURL && ctx.parentURL.endsWith('/client/js/admin.js')) {
      return next(SHARED + spec.slice('../shared/'.length), ctx);
    }
    return next(spec, ctx);
  }
`), import.meta.url);
function pathToFileURLString() {
  return new URL('file://' + path.join(ROOT, 'shared') + '/').href;
}
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
const MUSIC_FILES = ['exterieur.mp3', 'Velours Moteur.mp3', 'Gravel Starlight.mp3'];
const api = async (url) => {
  if (url === '/api/admin/content/zones') return zonesData;
  if (url.startsWith('/api/admin/overrides/')) return { tiles: [], props: { add: [], remove: [] } };
  if (url === '/api/admin/players') return { players: [] };
  if (url === '/api/admin/music') return { files: MUSIC_FILES, map: {} };
  return { ok: true };
};

// ---------- charge le VRAI code ----------
const checks = [];
const ok = (name, cond) => { checks.push([name, !!cond]); console.log(cond ? '  ✔' : '  ✘', name); };

await import('../client/js/admin.js'); // graphe complet (sans connexion : token absent)
console.log('✔ admin.js chargé');
const { initMapEditor } = await import('../client/js/admin/editor.js');
const ed = await initMapEditor({ api, zones: zonesData.zones, musicFiles: MUSIC_FILES });
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

// calques camps / PNJ : lecture des défauts, pose, matérialisation, undo
const campsBefore = ed.getCamps().length;
ok(`camps par défaut du worldgen exposés en lecture (${campsBefore})`, campsBefore > 0);
ed.placeCampAt(50, 50);
ok('pose d\'un camp : défauts matérialisés dans les overrides + nouveau camp',
  ed.getOverrides().camps?.length === campsBefore + 1
  && ed.getCamps().length === campsBefore + 1);
const npcsBefore = ed.getNpcs().length;
ed.placeNpcAt(52, 52);
ok('pose d\'un PNJ : entrée `npcs.add` dans les overrides',
  ed.getOverrides().npcs?.add?.length === 1 && ed.getNpcs().length === npcsBefore + 1);
win.fire('keydown', { code: 'KeyZ', ctrlKey: true });
win.fire('keydown', { code: 'KeyZ', ctrlKey: true });
ok('Ctrl+Z ×2 : pose de camp et de PNJ annulées (retour aux défauts)',
  ed.getOverrides().camps === undefined
  && (ed.getOverrides().npcs?.add?.length ?? 0) === 0
  && ed.getCamps().length === campsBefore);

// calque Musique : pose d'une zone rectangle puis cercle, fiche, undo
ed.placeMusicRect(40, 40, 60, 56);
let mz = ed.getMusicZones();
ok('pose d\'une zone musicale rectangle : entrée `music` dans les overrides',
  ed.getOverrides().music?.length === 1 && mz[0].shape === 'rect'
  && mz[0].w === 20 && mz[0].h === 16 && mz[0].track?.new === MUSIC_FILES[0]);
ed.placeMusicCircle(80, 80, 12);
mz = ed.getMusicZones();
ok('pose d\'une zone musicale cercle : 2e entrée, forme + rayon',
  ed.getOverrides().music?.length === 2 && mz[1].shape === 'circle' && mz[1].r === 12);
win.fire('keydown', { code: 'KeyZ', ctrlKey: true });
win.fire('keydown', { code: 'KeyZ', ctrlKey: true });
ok('Ctrl+Z ×2 : poses de zones musicales annulées (section `music` absente)',
  ed.getOverrides().music === undefined && ed.getMusicZones().length === 0);

// pot de peinture (flood-fill) : remplit par contiguïté les tuiles du même type
ed.loadZone && await ed.loadZone(0); // repart d'une zone propre (overrides vides)
await new Promise(r => setTimeout(r, 60));
{
  const tilesBefore = ed.getOverrides().tiles.length;
  ed.setTool({ kind: 'tile', tile: 1 }); // FOREST (≠ herbe par défaut autour du point)
  // remplit la zone contiguë autour d'un point d'herbe : produit des overrides tiles
  ed.floodFill(64, 64, false);
  const tilesAfter = ed.getOverrides().tiles.length;
  ok('flood-fill : produit des overrides tiles (remplissage par contiguïté)', tilesAfter > tilesBefore);
  win.fire('keydown', { code: 'KeyZ', ctrlKey: true }); // annule le remplissage
  ok('flood-fill : annulable (Ctrl+Z)', ed.getOverrides().tiles.length === tilesBefore);
}

// copier / coller une région : décalage correct des tuiles et props add
{
  // pose une tuile repère + un décor dans une petite région, puis copie/colle
  ed.setTool({ kind: 'tile', tile: 3 }); // COBBLE
  ed.paintAt(10, 10);
  ed.rebuildNow(); // applique tout de suite (la peinture est normalement différée)
  const addBefore = ed.getOverrides().props.add.length;
  // sélectionne la région 10..12 x 10..12 et copie
  ed.selectRegion(10, 10, 12, 12);
  ed.copySelection();
  const clip = ed.getClipboard();
  ok('copier : presse-papier rempli (région 3×3, tuiles incluses)', clip && clip.w === 3 && clip.h === 3 && clip.tiles.length === 9);
  const cobbleInClip = clip.tiles.find(([dx, dz, t]) => dx === 0 && dz === 0 && t === 3);
  ok('copier : la tuile COBBLE est capturée en coordonnées relatives', !!cobbleInClip);
  // colle 100 tuiles plus loin : la tuile COBBLE doit réapparaître à (110,110)
  const tilesBefore = ed.getOverrides().tiles.length;
  ed.pasteAt(110, 110);
  const pasted = ed.getOverrides().tiles.find(([x, z, t]) => x === 110 && z === 110 && t === 3);
  ok('coller : la région est décalée (COBBLE recopiée à la nouvelle position)', !!pasted);
  ok('coller : de nouvelles tuiles ont été écrites', ed.getOverrides().tiles.length > tilesBefore);
  void addBefore;
}

// calque Coffres : pose d'un coffre + édition du butin (ov.chests)
ed.loadZone && await ed.loadZone(0);
await new Promise(r => setTimeout(r, 60));
{
  const chestsBefore = ed.getChests().length;
  ed.placeChestAt(70, 70);
  ok('pose d\'un coffre : prop `chest` ajouté + listé', ed.getChests().length === chestsBefore + 1
    && ed.getOverrides().props.add.some(p => p.type === 'chest' && Math.floor(p.x) === 70 && Math.floor(p.z) === 70));
}

// calque Points spéciaux : pose d'un téléporteur (ov.markers)
{
  ed.placeMarkerAt(80, 80);
  const m = ed.getMarkers();
  ok('pose d\'un point spécial : entrée `markers` (téléport par défaut)',
    ed.getOverrides().markers?.length === 1 && m[0].kind === 'teleport' && m[0].target);
  win.fire('keydown', { code: 'KeyZ', ctrlKey: true });
  ok('Ctrl+Z : pose du point annulée (section `markers` absente)', ed.getOverrides().markers === undefined);
}

// calque Ambiance : pose d'une zone (rect puis cercle), réglage teinte/obscurité, undo
ed.loadZone && await ed.loadZone(0);
await new Promise(r => setTimeout(r, 60));
{
  ed.placeAmbienceRect(40, 40, 60, 56);
  let az = ed.getAmbience();
  ok('pose d\'une zone d\'ambiance rectangle : entrée `ambience` dans les overrides',
    ed.getOverrides().ambience?.length === 1 && az[0].shape === 'rect' && az[0].w === 20 && az[0].h === 16);
  // une zone fraîche a une teinte par défaut (marais verdâtre) et obscurité 0
  ok('zone d\'ambiance : teinte par défaut posée', typeof az[0].tint === 'string' && az[0].tint.startsWith('rgba'));
  ed.placeAmbienceCircle(80, 80, 10);
  az = ed.getAmbience();
  ok('pose d\'une zone d\'ambiance cercle : 2e entrée, forme + rayon',
    ed.getOverrides().ambience?.length === 2 && az[1].shape === 'circle' && az[1].r === 10);
  win.fire('keydown', { code: 'KeyZ', ctrlKey: true });
  win.fire('keydown', { code: 'KeyZ', ctrlKey: true });
  ok('Ctrl+Z ×2 : poses de zones d\'ambiance annulées (section `ambience` absente)',
    ed.getOverrides().ambience === undefined && ed.getAmbience().length === 0);
}

// calque Lumières : pose d'une source + undo ; format { x, z, r, color, flicker }
{
  const lightsBefore = ed.getLights().length;
  ed.placeLightAt(70, 70);
  const lz = ed.getLights();
  ok('pose d\'une lumière : entrée `lights` (rayon + couleur + scintillement)',
    ed.getOverrides().lights?.length === lightsBefore + 1
    && Math.floor(lz[lz.length - 1].x) === 70 && lz[lz.length - 1].r > 0
    && typeof lz[lz.length - 1].color === 'string');
  win.fire('keydown', { code: 'KeyZ', ctrlKey: true });
  ok('Ctrl+Z : pose de lumière annulée (section `lights` absente)', ed.getOverrides().lights === undefined);
}

// aperçu jour/nuit : bascule l'état d'aperçu (et le rendu ne lève pas d'exception)
{
  ed.setDayPreview('night');
  ok('aperçu nuit activé', ed.getDayPreview() === 'night');
  // pose une zone d'ambiance + une lumière, puis force quelques frames de rendu
  ed.placeAmbienceCircle(64, 64, 12);
  ed.placeLightAt(64, 64);
  ed.rebuildNow();
}
await new Promise(r => setTimeout(r, 200));
{
  ed.setDayPreview('day');
  ok('aperçu jour activé', ed.getDayPreview() === 'day');
  ed.setDayPreview(null);
  ok('aperçu jour/nuit désactivable', ed.getDayPreview() === null);
}

// laisse la boucle de rendu dessiner quelques frames en mode sprites (chunks)
await new Promise(r => setTimeout(r, 400));
ok('aucune exception (chargement, rendu chunks, outils)', failures.length === 0);

const bad = checks.filter(([, c]) => !c).length;
console.log(bad ? `\n${bad} ÉCHEC(S)` : '\nÉDITEUR HEADLESS OK');
process.exit(bad ? 1 : 0);
