// Point d'entrée client : assets Flare, rendu iso 2D, réseau, UI
import { generateWorld } from '../../shared/worldgen.js';
import { KIND, ST, DAY_LENGTH } from '../../shared/constants.js';
import { loadAssets } from './render2d/assets.js';
import { buildDecor } from './render2d/decor.js';
import { Renderer } from './render2d/renderer.js';
import { EntityManager2D } from './render2d/entities2d.js';
import { Net } from './net.js';
import { UI } from './ui.js';

const INTERP_DELAY = 0.15;

const canvas = document.getElementById('game');
const net = new Net();
const ui = new UI(net);

let renderer = null, em = null;
let selfId = null;
let worldTime = DAY_LENGTH * 0.3;
let targetId = null;

const world = generateWorld();

// --- Chargement des assets puis connexion ---
const errEl = document.getElementById('login-error');
errEl.textContent = 'Chargement des graphismes…';
let assets;
try {
  assets = await loadAssets((done, total) => {
    errEl.textContent = `Chargement des graphismes… ${Math.round(done / total * 100)} %`;
  });
  errEl.textContent = '';
} catch (e) {
  errEl.textContent = e.message;
  throw e;
}
const decor = buildDecor(world);
renderer = new Renderer(canvas, assets, world, decor);
em = new EntityManager2D(assets);
await net.connect();

// ---------- Réseau ----------
net.on('auth_error', (m) => ui.loginError(m.error));
net.on('welcome', (m) => {
  selfId = m.id;
  worldTime = m.time;
  ui.enterGame();
  ui.addChat('sys', "Bienvenue dans le monde. Clic pour vous déplacer, H pour l'aide.");
});
net.on('self', (m) => {
  ui.updateSelf(m);
  if (m.hp > 0) ui.hideDeath();
});
net.on('vitals', (m) => ui.updateVitals(m.hp, m.mana));
net.on('meta', (m) => { for (const meta of m.list) em.addMeta(meta); });
net.on('chat', (m) => ui.addChat(m.from, m.text));
net.on('loot', (m) => {
  ui.addChat('sys', m.text);
  const v = em.get(selfId);
  if (v) ui.floater(headPos(v), m.text, 'xp');
});
net.on('died', (m) => ui.showDeath(m.by));
net.on('snapshot', (snap) => {
  const now = performance.now() / 1000;
  worldTime = snap.worldTime;
  em.applySnapshot(snap, now);
});
net.on('events', (m) => {
  for (const ev of m.list) {
    if (ev.t === 'dmg') {
      const v = em.get(ev.to);
      if (!v) continue;
      const pos = headPos(v);
      if (ev.miss) ui.floater(pos, 'raté', 'miss');
      else ui.floater(pos, `-${ev.amount}`, (ev.crit ? 'crit' : '') + (ev.to === selfId ? ' self' : ''));
    } else if (ev.t === 'fx') {
      const v = em.get(ev.id);
      if (!v) continue;
      if (ev.kind === 'levelup') ui.floater(headPos(v), 'NIVEAU SUPÉRIEUR !', 'crit');
      if (ev.kind === 'heal') ui.floater(headPos(v), '+ soin', 'heal');
    } else if (ev.t === 'look') {
      em.get(ev.id)?.setLook(ev.look);
    }
  }
});
net.on('disconnected', () => {
  ui.addChat('sys', 'Déconnecté du serveur. Rechargez la page.');
});

function headPos(v) {
  const p = renderer.w2s(v.x, v.z);
  return { x: p.x, y: (v.topY ?? p.y - 90), visible: true };
}

// ---------- Entrées ----------
canvas.addEventListener('pointerdown', (ev) => {
  if (ev.button !== 0 || selfId == null) return;
  const v = renderer.pickEntity(em, ev.clientX, ev.clientY);
  if (v && v.id !== selfId && !v.isDead?.()) {
    if (v.kind === KIND.MOB) {
      targetId = v.id;
      net.send({ t: 'attack', id: v.id });
      updateTargetFrame();
    } else if (v.kind === KIND.DROP) {
      net.send({ t: 'pickup', id: v.id });
    } else if (v.kind === KIND.PLAYER) {
      targetId = v.id;
      updateTargetFrame();
    }
    return;
  }
  const w = renderer.s2w(ev.clientX, ev.clientY);
  if (w.x >= 0 && w.z >= 0 && w.x < world.size && w.z < world.size) {
    net.send({ t: 'move', x: w.x, z: w.z });
  }
});

let hoverPending = null;
canvas.addEventListener('pointermove', (ev) => { hoverPending = ev; });
function processHover() {
  if (!hoverPending || selfId == null || !renderer) return;
  const ev = hoverPending;
  hoverPending = null;
  const v = renderer.pickEntity(em, ev.clientX, ev.clientY);
  if (v && v.id !== selfId && !v.isDead?.()) {
    canvas.style.cursor = 'pointer';
    const label = v.kind === KIND.DROP
      ? (v.meta.gold ? `${v.meta.gold} pièces d'or` : 'Objet (clic pour ramasser)')
      : `${v.meta.name} [niv. ${v.level || v.meta.level}]`;
    ui.showTooltip(label);
    ui.moveTooltip(ev.clientX, ev.clientY);
  } else {
    canvas.style.cursor = 'crosshair';
    ui.hideTooltip();
  }
}

canvas.addEventListener('wheel', (ev) => { ev.preventDefault(); renderer.zoom(ev.deltaY); }, { passive: false });
canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());

window.addEventListener('keydown', (ev) => {
  if (ui.isTyping()) return;
  const k = ev.key.toLowerCase();
  if (k === 'i') ui.togglePanel('inventory');
  else if (k === 'c') ui.togglePanel('character');
  else if (k === 'h') ui.togglePanel('help');
  else if (ev.key === 'Enter') { ev.preventDefault(); ui.focusChat(); }
});

function updateTargetFrame() {
  const v = targetId != null ? em.get(targetId) : null;
  if (!v || v.isDead?.()) { targetId = null; ui.setTarget(null); return; }
  ui.setTarget(`${v.meta.name} [${v.level || v.meta.level}]`, v.hpPct);
}

// ---------- Boucle de rendu ----------
let lastT = performance.now() / 1000;
let frameN = 0;
function frame() {
  requestAnimationFrame(frame);
  const now = performance.now() / 1000;
  const dt = Math.min(0.1, now - lastT);
  lastT = now;

  worldTime += dt; // resynchronisé à chaque snapshot
  em.update(now - INTERP_DELAY, now, dt);

  const selfView = em.get(selfId);
  if (selfView) renderer.follow(selfView.x, selfView.z);

  const daylight = renderer.render(em, worldTime, now, selfId);
  ui.setClock(daylight, (worldTime % DAY_LENGTH) / DAY_LENGTH);

  processHover();
  if (++frameN % 20 === 0) updateTargetFrame();
}
frame();
