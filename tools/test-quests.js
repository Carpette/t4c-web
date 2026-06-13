// Éditeur de quêtes — test d'intégration de bout en bout :
// 1. on CONSTRUIT une quête AVEC L'ÉDITEUR (vrai code admin/editor.js chargé en
//    DOM factice, comme test-editor.mjs) : PNJ A pose un drapeau sur un mot-clé,
//    PNJ B exige ce drapeau et récompense (une fois), et un coffre est verrouillé
//    par le drapeau de B (reqFlag) ;
// 2. on récupère les overrides GÉNÉRÉS par l'éditeur et on les PUT sur un VRAI
//    serveur, puis un bot JOUE la quête : le mot-clé chez A pose le drapeau, B
//    récompense (et ne re-récompense pas), et le coffre ne s'ouvre qu'après B ;
// 3. la validation d'intégrité de l'éditeur détecte un drapeau orphelin.
//
// À lancer sur une base FRAÎCHE (1er compte = admin) avec T4C_OVERRIDES_DIR isolé.
// Usage : node tools/test-quests.js [url]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { register } from 'node:module';
import WebSocket from 'ws';
import { PROTOCOL_VERSION, KIND } from '../shared/constants.js';
import { decodeSnapshot, BIN_SNAPSHOT } from '../shared/protocol.js';
import { generateWorld } from '../shared/worldgen.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.argv[2] || 'http://localhost:8090';
const WS_URL = BASE.replace('http', 'ws');
const checks = [];
const ok = (name, cond) => { checks.push([name, !!cond]); console.log(cond ? '  ✔' : '  ✘', name); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---------- hook de résolution /shared (cf. test-editor.mjs) ----------
register('data:text/javascript,' + encodeURIComponent(`
  const SHARED = ${JSON.stringify(new URL('file://' + path.join(ROOT, 'shared') + '/').href)};
  export async function resolve(spec, ctx, next) {
    if (spec.startsWith('../shared/') && ctx.parentURL && ctx.parentURL.endsWith('/client/js/admin.js')) {
      return next(SHARED + spec.slice('../shared/'.length), ctx);
    }
    return next(spec, ctx);
  }
`), import.meta.url);

// ---------- DOM factice minimal (repris de test-editor.mjs) ----------
function ctxProxy() {
  return new Proxy(function () {}, {
    get(t, prop) {
      if (prop === Symbol.toPrimitive) return () => 1;
      if (prop === 'data') return new Proxy({}, { get: () => 0, set: () => true });
      return ctxProxy();
    },
    apply() { return ctxProxy(); }, set() { return true; },
  });
}
class FakeClassList {
  constructor() { this.set = new Set(); }
  add(...c) { c.forEach(x => this.set.add(x)); }
  remove(...c) { c.forEach(x => this.set.delete(x)); }
  toggle(c, force) { const w = force ?? !this.set.has(c); w ? this.set.add(c) : this.set.delete(c); return w; }
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
    this._listeners = {}; allElements.push(this);
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
  addEventListener() {}, activeElement: null,
};
const winListeners = {};
const win = {
  addEventListener(t, fn) { (winListeners[t] ||= []).push(fn); },
  removeEventListener() {}, innerWidth: 1280, innerHeight: 800,
};
globalThis.document = doc; globalThis.window = win;
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(performance.now()), 16);
globalThis.Image = class { set src(v) { setTimeout(() => this.onload?.(), 0); } };
globalThis.confirm = () => true; globalThis.alert = () => {};
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'client/assets/manifest.json'), 'utf8'));
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, ...rest) => {
  if (String(url).includes('manifest.json')) return { ok: true, json: async () => manifest };
  if (String(url).startsWith('http')) return realFetch(url, ...rest); // appels serveur réels
  throw new Error('fetch inattendu : ' + url);
};
const canvas = doc.getElementById('map-canvas'); canvas.width = 1000; canvas.height = 704;
const mini = doc.getElementById('map-mini'); mini.width = 168; mini.height = 168;

// ---------- emplacement des PNJ / coffre : cases praticables près du spawn ----------
const world = generateWorld(8281932, 'arakas'); // zone 0
const spawn = world.spawnPoint;
function walkableNear(min, max) {
  for (let r = min; r <= max; r += 0.5) {
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      const x = Math.floor(spawn.x + Math.cos(a) * r), z = Math.floor(spawn.z + Math.sin(a) * r);
      if (world.isWalkable(x + 0.5, z + 0.5)) return { x, z };
    }
  }
  throw new Error('aucune case praticable trouvée');
}
const NPC_A = walkableNear(2.5, 4);   // à portée d'oreille du spawn
const NPC_B = walkableNear(2.5, 4);
const CHEST = walkableNear(4, 6);

// ---------- 1. construire la quête AVEC l'éditeur ----------
const zonesData = JSON.parse(fs.readFileSync(path.join(ROOT, 'content/zones.json'), 'utf8'));
const localApi = async (url) => {
  if (url === '/api/admin/content/zones') return zonesData;
  if (url.startsWith('/api/admin/overrides/')) return { tiles: [], props: { add: [], remove: [] } };
  if (url === '/api/admin/players') return { players: [] };
  if (url === '/api/admin/music') return { files: [], map: {} };
  return { ok: true };
};
await import('../client/js/admin.js');
const { initMapEditor } = await import('../client/js/admin/editor.js');
const ed = await initMapEditor({ api: localApi, zones: zonesData.zones, npcDefs: zonesData.npc || {}, spells: [] });

ed.placeNpcAt(NPC_A.x, NPC_A.z);
ed.placeNpcAt(NPC_B.x, NPC_B.z);
const npcs = ed.getNpcs();
const a = npcs.find(n => Math.floor(n.x) === NPC_A.x && Math.floor(n.z) === NPC_A.z);
const b = npcs.find(n => Math.floor(n.x) === NPC_B.x && Math.floor(n.z) === NPC_B.z);
// place un coffre verrouillé par le drapeau de l'étape 2
ed.placeChestAt(CHEST.x, CHEST.z);
const F1 = ed.questFlag('olin', 1), F2 = ed.questFlag('olin', 2);
ed.generateQuest({
  id: 'olin', title: 'Olin', desc: '', steps: [
    { n: '1', flag: F1, npcId: a.npcId, keywords: ['mission'], reponse: 'REPONSE_A : commence par ceci.', reqFlag: '', reqLevel: 0, reqItem: '', consume: false, gold: 0, itemDefId: '', itemN: 1, xp: 0, tp: null },
    { n: '2', flag: F2, npcId: b.npcId, keywords: ['suite'], reponse: 'REPONSE_B : bien joué, voici ta récompense.', reqFlag: F1, reqLevel: 0, reqItem: '', consume: false, gold: 120, itemDefId: '', itemN: 1, xp: 0, tp: null },
  ],
});
// verrouille le coffre par F2 (effet « débloquer un coffre » d'une étape)
const chestOv = (ed.getOverrides().chests ||= []);
chestOv.push({ x: CHEST.x, z: CHEST.z, gold: [555, 555], items: [], reqFlag: F2 });
ed.rebuildNow();
const QUEST_OV = ed.getOverrides();
ok('éditeur : quête « olin » générée (2 PNJ + coffre verrouillé)',
  (QUEST_OV.npcs?.add?.length === 2) && QUEST_OV.npcs.add.some(n => (n.dialogues || []).some(d => (d.reactions || []).some(r => r.type === 'flag' && r.key === F1)))
  && QUEST_OV.chests?.some(c => c.reqFlag === F2));

// intégrité : référence orpheline (coffre exigeant un drapeau jamais posé)
{
  const before = JSON.stringify(ed.getOverrides().chests);
  ed.getOverrides().chests.push({ x: CHEST.x + 2, z: CHEST.z, gold: [0, 0], items: [], reqFlag: 'quete:olin:9' });
  ed.rebuildNow();
  const integ = ed.questIntegrity('olin');
  ok('intégrité : drapeau exigé par un coffre mais jamais posé = signalé orphelin',
    integ.orphanRefs.includes('quete:olin:9'));
  // retire la référence orpheline avant de jouer la quête sur le serveur
  ed.getOverrides().chests = JSON.parse(before);
  ed.rebuildNow();
}

// ---------- 2. jouer la quête sur un VRAI serveur ----------
function session(name) {
  const S = { name, id: null, self: null, zone: null, pos: new Map(), drops: new Map(), metas: new Map(), chats: [], loots: [] };
  const ws = new WebSocket(WS_URL);
  ws.on('message', (raw, bin) => {
    if (bin) {
      const ab = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
      if (new DataView(ab).getUint8(0) !== BIN_SNAPSHOT) return;
      const snap = decodeSnapshot(ab);
      for (const e of snap.entities) { S.pos.set(e.id, e); if (e.kind === KIND.DROP) S.drops.set(e.id, e); }
      for (const id of snap.gone) { S.pos.delete(id); S.drops.delete(id); }
      return;
    }
    const m = JSON.parse(raw.toString());
    switch (m.t) {
      case 'create_char': S.send({ t: 'create', stats: { str: 22, end: 18, agi: 14, int: 8, wis: 8 } }); break;
      case 'welcome': S.id = m.id; break;
      case 'self': S.self = m; break;
      case 'zone': S.zone = m; break;
      case 'meta': for (const e of m.list) S.metas.set(e.id, e); break;
      case 'chat': S.chats.push(m); break;
      case 'loot': S.loots.push(m.text); break;
    }
  });
  S.ws = ws; S.send = (o) => ws.send(JSON.stringify(o));
  S.waitFor = (fn, timeout = 6000) => new Promise((res) => {
    const t0 = Date.now();
    const iv = setInterval(() => { const v = fn(); if (v) { clearInterval(iv); res(v); } else if (Date.now() - t0 > timeout) { clearInterval(iv); res(null); } }, 40);
  });
  S.open = new Promise(r => ws.on('open', r));
  S.me = () => S.pos.get(S.id);
  return S;
}
async function sayAndListen(S, text, fromName, timeout = 2500) {
  const from = S.chats.length;
  S.send({ t: 'chat', text });
  const reply = await S.waitFor(() => S.chats.slice(from).find(c => c.from === fromName), timeout);
  await sleep(900); // anti-spam du chat
  return reply;
}

const A = session('Quete_' + Math.floor(Math.random() * 1e6));
await A.open;
A.send({ t: 'register', v: PROTOCOL_VERSION, name: A.name, pass: 'test1234' });
await A.waitFor(() => A.self && A.zone && A.me());
ok('connexion zone 0', A.zone?.zoneId === 0);

const login = await (await realFetch(`${BASE}/api/admin/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: A.name, pass: 'test1234' }),
})).json();
ok('connexion admin', !!login.token);
const api = async (url, method = 'GET', body = null) => {
  const r = await realFetch(BASE + url, {
    method, headers: { Authorization: `Bearer ${login.token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : null,
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || r.status);
  return j;
};

const before = await api('/api/admin/overrides/0');
// PUT des overrides PRODUITS PAR L'ÉDITEUR (avec le coffre verrouillé) + prop coffre
const ovToPut = {
  ...before,
  npcs: QUEST_OV.npcs,
  props: { add: [...(before.props?.add || []), { type: 'chest', x: CHEST.x, z: CHEST.z }], remove: before.props?.remove || [] },
  chests: QUEST_OV.chests,
};
await api('/api/admin/overrides/0', 'PUT', ovToPut);
await sleep(500); // respawn des PNJ + entrée en AOI

// au spawn, à portée des deux PNJ
A.send({ t: 'admin', cmd: 'goto', x: spawn.x, z: spawn.z });
await sleep(400);

// --- coffre fermé tant que l'étape 2 n'est pas faite ---
A.drops.clear(); A.loots = [];
A.send({ t: 'admin', cmd: 'goto', x: CHEST.x + 1.5, z: CHEST.z + 0.5 });
await A.waitFor(() => { const me = A.me(); return me && Math.hypot(me.x - (CHEST.x + 1.5), me.z - (CHEST.z + 0.5)) < 1; }, 4000);
A.send({ t: 'interact', prop: 'chest', x: CHEST.x + 0.5, z: CHEST.z + 0.5 });
await sleep(700);
ok('coffre verrouillé : fermé avant la quête (aucun butin, message « fermé à clé »)',
  A.drops.size === 0 && A.loots.length === 0);

// --- étape 1 : PNJ A pose le drapeau sur le mot-clé ---
A.send({ t: 'admin', cmd: 'goto', x: spawn.x, z: spawn.z });
await sleep(400);
const r1 = await sayAndListen(A, 'Parle-moi de la mission.', a.def.name);
ok('étape 1 : PNJ A répond au mot-clé', !!r1?.text.includes('REPONSE_A'));

// --- étape 2 : PNJ B exige le drapeau de A et récompense (une fois) ---
const gold0 = A.self.gold;
const r2 = await sayAndListen(A, 'Et la suite ?', b.def.name);
ok('étape 2 : PNJ B répond (drapeau d\'étape 1 présent)', !!r2?.text.includes('REPONSE_B'));
await A.waitFor(() => A.self.gold === gold0 + 120, 3000);
ok(`étape 2 : récompense versée (+120 or : ${gold0} → ${A.self.gold})`, A.self.gold === gold0 + 120);
// re-déclencher : la réplique rejoue, la récompense NE retombe PAS
const r2b = await sayAndListen(A, 'Encore la suite ?', b.def.name);
ok('anti-farm : la récompense d\'étape 2 ne tombe qu\'une fois', !!r2b && A.self.gold === gold0 + 120);

// --- coffre désormais déverrouillé (drapeau d'étape 2 posé) ---
A.drops.clear(); A.loots = [];
A.send({ t: 'admin', cmd: 'goto', x: CHEST.x + 1.5, z: CHEST.z + 0.5 });
await A.waitFor(() => { const me = A.me(); return me && Math.hypot(me.x - (CHEST.x + 1.5), me.z - (CHEST.z + 0.5)) < 1; }, 4000);
A.send({ t: 'interact', prop: 'chest', x: CHEST.x + 0.5, z: CHEST.z + 0.5 });
await A.waitFor(() => A.drops.size >= 1, 4000);
ok('coffre déverrouillé après l\'étape 2 : butin déposé', A.drops.size >= 1);

// ---------- restauration ----------
await api('/api/admin/overrides/0', 'PUT', before);
const restored = await api('/api/admin/overrides/0');
ok('restauration des overrides initiaux', JSON.stringify(restored) === JSON.stringify(before));

A.ws.close();
const bad = checks.filter(([, c]) => !c).length;
console.log(bad ? `\n${bad} ÉCHEC(S): ${checks.filter(([, c]) => !c).map(([n]) => n).join(', ')}` : '\nTOUT EST OK');
await sleep(100);
process.exit(bad ? 1 : 0);
