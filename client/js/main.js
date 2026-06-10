// Point d'entrée client : assets Flare, rendu iso 2D, multi-zones, contrôles, sorts
import { generateWorld, generateTrial } from '../../shared/worldgen.js';
import { KIND, DAY_LENGTH } from '../../shared/constants.js';
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
let world = null;
let selfId = null;
let worldTime = DAY_LENGTH * 0.3;
let targetId = null;

// --- Chargement des assets + contenu, puis connexion ---
const errEl = document.getElementById('login-error');
errEl.textContent = 'Chargement des graphismes…';
let assets;
try {
  assets = await loadAssets((done, total) => {
    errEl.textContent = `Chargement des graphismes… ${Math.round(done / total * 100)} %`;
  });
  const spellsJson = await (await fetch('/content/spells.json')).json();
  ui.setSpellDefs(spellsJson.spells);
  errEl.textContent = '';
} catch (e) {
  errEl.textContent = e.message;
  throw e;
}
world = generateWorld();
renderer = new Renderer(canvas, assets, world, buildDecor(world));
em = new EntityManager2D(assets);
await net.connect();

// ---------- Réseau ----------
net.on('auth_error', (m) => ui.loginError(m.error));
net.on('welcome', (m) => {
  selfId = m.id;
  worldTime = m.time;
  ui.enterGame();
  ui.addChat('sys', "Bienvenue. Clic pour vous déplacer, H pour l'aide. La mort est définitive…");
});
net.on('zone', (m) => {
  world = m.kind === 'trial' ? generateTrial(m.seed) : generateWorld(m.seed);
  const decor = buildDecor(world);
  renderer.setWorld(world, decor, m.tint || null);
  em.clear(selfId);
  renderer.cam = { x: m.x, z: m.z };
  ui.zoneBanner(m.name, m.kind === 'trial' ? null : m.levels);
  if (m.kind === 'trial') ui.addChat('sys', '⚠ Vous êtes dans l\'Épreuve. Atteignez la sortie ou périssez.');
});
net.on('self', (m) => {
  ui.updateSelf(m);
  if (m.hp > 0) ui.hideDeath();
});
net.on('vitals', (m) => ui.updateVitals(m.hp, m.mana));
net.on('meta', (m) => { for (const meta of m.list) em.addMeta(meta); });
net.on('chat', (m) => ui.addChat(m.from, m.text));
net.on('info', (m) => ui.addChat('sys', m.text));
net.on('loot', (m) => {
  ui.addChat('sys', m.text);
  const v = em.get(selfId);
  if (v) ui.floater(headPos(v), m.text, 'xp');
});
net.on('died', (m) => ui.showDeath(m));
net.on('shop', (m) => ui.showShop(m));
net.on('obelisk', (m) => ui.showObelisk(m));
net.on('confirm_trial', (m) => ui.showTrialConfirm(m));
net.on('cast_ok', (m) => {
  ui.startCooldown(m.spellId, m.cd);
  if (ui.self) { ui.self.mana = m.mana; ui.renderBars(); }
});
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
      if (ev.kind === 'buff') ui.floater(headPos(v), '✨', 'heal');
    } else if (ev.t === 'look') {
      em.get(ev.id)?.setLook(ev.look);
    } else if (ev.t === 'say') {
      const v = em.get(ev.id);
      if (v) {
        v.say(ev.text);
        if (ev.npc) ui.addChat(v.meta.name + ' (PNJ)', ev.text); // chat local
      }
    } else if (ev.t === 'proj') {
      const a = em.get(ev.from), b = em.get(ev.to);
      if (a && b) renderer.addFx({ type: 'proj', x0: a.x, z0: a.z, x1: b.x, z1: b.z, color: ev.color, dur: 0.3 });
    } else if (ev.t === 'aoe') {
      renderer.addFx({ type: 'aoe', x: ev.x, z: ev.z, radius: ev.radius, color: ev.color, dur: 0.6 });
    }
  }
});
net.on('disconnected', () => ui.addChat('sys', 'Déconnecté du serveur. Rechargez la page.'));

function headPos(v) {
  const p = renderer.w2s(v.x, v.z);
  return { x: p.x, y: (v.topY ?? p.y - 90), visible: true };
}

// ---------- Contrôles ----------
let combatMode = false;       // Ctrl maintenu
let held = false;             // clic maintenu = déplacement continu
let heldTimer = null;
let lastPointer = { x: 0, y: 0 };
const arrows = new Set();

function sendMoveDirFromArrows() {
  // écran -> carte : haut = (-1,-1), droite = (1,-1), bas = (1,1), gauche = (-1,1)
  let sx = 0, sy = 0;
  if (arrows.has('ArrowUp')) sy -= 1;
  if (arrows.has('ArrowDown')) sy += 1;
  if (arrows.has('ArrowLeft')) sx -= 1;
  if (arrows.has('ArrowRight')) sx += 1;
  if (!sx && !sy) { net.send({ t: 'movedir', x: 0, z: 0 }); return; }
  const mx = sx + sy, mz = sy - sx; // conversion iso écran -> monde
  net.send({ t: 'movedir', x: mx, z: mz });
}

function dirToCursor() {
  const w = renderer.s2w(lastPointer.x, lastPointer.y);
  const self = em.get(selfId);
  if (!self) return null;
  const dx = w.x - self.x, dz = w.z - self.z;
  if (Math.hypot(dx, dz) < 0.6) return { x: 0, z: 0 };
  return { x: dx, z: dz };
}

function castActive(spellId, ev) {
  const sp = ui.spellDef(spellId);
  if (!sp) return false;
  if (sp.type === 'heal' || sp.type === 'buff') { net.send({ t: 'cast', spellId }); return true; }
  if (sp.type === 'aoe') {
    const w = renderer.s2w(ev?.clientX ?? lastPointer.x, ev?.clientY ?? lastPointer.y);
    net.send({ t: 'cast', spellId, x: w.x, z: w.z });
    return true;
  }
  // bolt : cible sous le curseur, sinon cible courante
  let tid = null;
  const v = ev ? renderer.pickEntity(em, ev.clientX, ev.clientY) : null;
  if (v && v.kind === KIND.MOB && !v.isDead?.()) tid = v.id;
  else if (targetId != null) tid = targetId;
  if (tid == null) { ui.addChat('sys', 'Aucune cible pour ' + sp.name + '.'); return false; }
  net.send({ t: 'cast', spellId, target: tid });
  return true;
}

canvas.addEventListener('pointerdown', (ev) => {
  if (ev.button !== 0 || selfId == null) return;
  lastPointer = { x: ev.clientX, y: ev.clientY };

  // ---- mode combat : tous les clics sont des attaques/sorts ----
  if (combatMode) {
    if (ui.activeSpell) { castActive(ui.activeSpell, ev); return; }
    const v = renderer.pickEntity(em, ev.clientX, ev.clientY);
    if (v && v.kind === KIND.MOB && !v.isDead?.()) {
      targetId = v.id;
      net.send({ t: 'attack', id: v.id });
      updateTargetFrame();
    }
    return;
  }

  const v = renderer.pickEntity(em, ev.clientX, ev.clientY);
  if (v && v.id !== selfId && !v.isDead?.()) {
    if (v.kind === KIND.MOB) {
      targetId = v.id;
      net.send({ t: 'attack', id: v.id });
      updateTargetFrame();
    } else if (v.kind === KIND.DROP) {
      net.send({ t: 'pickup', id: v.id });
    } else if (v.kind === KIND.NPC) {
      net.send({ t: 'interact', id: v.id });
    } else if (v.kind === KIND.PLAYER) {
      targetId = v.id;
      updateTargetFrame();
    }
    return;
  }

  // décor interactif (obélisque, portails) ?
  const w = renderer.s2w(ev.clientX, ev.clientY);
  const prop = renderer.props.find(p => p.interact && Math.hypot(p.x - w.x, p.z - w.z) < 1.6);
  if (prop) {
    net.send({ t: 'interact', prop: prop.interact, x: prop.x, z: prop.z });
    return;
  }

  // déplacement : clic simple = aller au point ; maintenu = suivre le curseur
  if (w.x >= 0 && w.z >= 0 && w.x < world.size && w.z < world.size) {
    net.send({ t: 'move', x: w.x, z: w.z });
  }
  held = true;
  clearInterval(heldTimer);
  heldTimer = setInterval(() => {
    if (!held) return;
    const d = dirToCursor();
    if (d) net.send({ t: 'movedir', x: d.x, z: d.z });
  }, 120);
});

window.addEventListener('pointerup', () => {
  if (held) {
    held = false;
    clearInterval(heldTimer);
    net.send({ t: 'movedir', x: 0, z: 0 });
  }
});

let hoverPending = null;
canvas.addEventListener('pointermove', (ev) => {
  hoverPending = ev;
  lastPointer = { x: ev.clientX, y: ev.clientY };
});
function processHover() {
  if (!hoverPending || selfId == null || !renderer) return;
  const ev = hoverPending;
  hoverPending = null;
  const v = renderer.pickEntity(em, ev.clientX, ev.clientY);
  if (v && v.id !== selfId && !v.isDead?.()) {
    canvas.style.cursor = 'pointer';
    const label = v.kind === KIND.DROP
      ? (v.meta.gold ? `${v.meta.gold} pièces d'or` : 'Objet (clic pour ramasser)')
      : v.kind === KIND.NPC ? `${v.meta.name} (clic pour parler)`
      : `${v.meta.name} [niv. ${v.level || v.meta.level}]`;
    ui.showTooltip(label);
    ui.moveTooltip(ev.clientX, ev.clientY);
  } else {
    const w = renderer.s2w(ev.clientX, ev.clientY);
    const prop = renderer.props.find(p => p.interact && Math.hypot(p.x - w.x, p.z - w.z) < 1.6);
    if (prop) {
      canvas.style.cursor = 'pointer';
      const labels = { obelisk: 'Obélisque des voyages', trialgate: "Portail de l'Épreuve", exitgate: "Sortie de l'Épreuve" };
      ui.showTooltip(labels[prop.interact] || '');
      ui.moveTooltip(ev.clientX, ev.clientY);
    } else {
      canvas.style.cursor = combatMode ? 'cell' : 'crosshair';
      ui.hideTooltip();
    }
  }
}

canvas.addEventListener('wheel', (ev) => { ev.preventDefault(); renderer.zoom(ev.deltaY); }, { passive: false });
canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());

window.addEventListener('keydown', (ev) => {
  if (ev.key === 'Control' && !combatMode) { combatMode = true; ui.setCombatMode(true); }
  if (ui.isTyping() || ui.bindingSpell) return;

  // Ctrl+touche = sort assigné
  if (combatMode && ev.key.length === 1) {
    const spellId = ui.hotkeys[ev.key.toLowerCase()];
    if (spellId && (ui.self?.spells || []).includes(spellId)) {
      ev.preventDefault();
      castActive(spellId, null);
      return;
    }
  }

  if (ev.key.startsWith('Arrow')) {
    ev.preventDefault();
    if (!arrows.has(ev.key)) { arrows.add(ev.key); sendMoveDirFromArrows(); }
    return;
  }
  const k = ev.key.toLowerCase();
  if (k === 'i') ui.togglePanel('inventory');
  else if (k === 'c') ui.togglePanel('character');
  else if (k === 's') ui.togglePanel('spells');
  else if (k === 'h') ui.togglePanel('help');
  else if (ev.key === 'Enter') { ev.preventDefault(); ui.focusChat(); }
  else if (ev.key === 'Escape') ui.togglePanel(null);
});

window.addEventListener('keyup', (ev) => {
  if (ev.key === 'Control') { combatMode = false; ui.setCombatMode(false); }
  if (ev.key.startsWith('Arrow')) {
    arrows.delete(ev.key);
    sendMoveDirFromArrows();
  }
});
window.addEventListener('blur', () => {
  arrows.clear();
  combatMode = false;
  ui.setCombatMode(false);
  if (selfId != null) net.send({ t: 'movedir', x: 0, z: 0 });
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
  if (++frameN % 20 === 0) { updateTargetFrame(); ui.tickCooldowns(); }
}
frame();
