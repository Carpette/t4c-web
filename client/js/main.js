// Point d'entrée client : assets Flare, rendu iso 2D, multi-zones, contrôles, sorts
import { generateWorld, generateTrial } from '../../shared/worldgen.js';
import { applyOverrides } from '../../shared/overrides.js';
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
  ui.setAssets(assets); // pour la poupée d'inventaire
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
net.on('create_char', (m) => ui.showCreation(m));
net.on('welcome', (m) => {
  selfId = m.id;
  worldTime = m.time;
  ui.enterGame();
  ui.addChat('sys', "Bienvenue. Clic pour vous déplacer, H pour l'aide. La mort est définitive…");
});
net.on('zone', async (m) => {
  cancelAim(); cancelAuto(); targetId = null;
  em.clear(selfId); // tout de suite : les entités de la nouvelle zone vont arriver
  const w = m.kind === 'trial' ? generateTrial(m.seed) : generateWorld(m.seed);
  if (m.kind !== 'trial') {
    try {
      const r = await fetch(`/content/overrides_${m.zoneId}.json`);
      if (r.ok) applyOverrides(w, await r.json());
    } catch { /* pas d'overrides */ }
  }
  world = w;
  renderer.setWorld(world, buildDecor(world), m.tint || null);
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
net.on('died', (m) => { cancelAim(); cancelAuto(); ui.showDeath(m); });
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
      em.get(ev.from)?.triggerSwing(); // l'attaquant rejoue son animation à chaque coup
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
      a?.triggerSwing(); // animation de lancement à chaque sort
      if (a && b) renderer.addFx({ type: 'proj', x0: a.x, z0: a.z, x1: b.x, z1: b.z, color: ev.color, dur: 0.3 });
    } else if (ev.t === 'aoe') {
      em.get(ev.from)?.triggerSwing();
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

// ---- Visée et relance automatique des sorts ----
// Appui sur la touche du sort -> curseur "main scintillante" -> clic sur la cible.
// Le sort est ensuite relancé dès que possible, tant qu'aucune autre action
// n'est faite et que la cible est en vie. (Les sorts `centered` — effet autour
// du lanceur — partent immédiatement, sans visée.)
let aimSpell = null;          // sort en cours de visée
let autoCast = null;          // { spellId, targetId?, x?, z? }

function cancelAim() { aimSpell = null; canvas.style.cursor = ''; }
function cancelAuto() { autoCast = null; }

function castSpellAt(spellId, params) {
  net.send({ t: 'cast', spellId, ...params });
  autoCast = { spellId, ...params };
}

// clic de visée : détermine la cible selon le type du sort
function aimClick(spellId, ev) {
  const sp = ui.spellDef(spellId);
  if (!sp) return;
  cancelAuto();
  if (sp.type === 'bolt') {
    const v = renderer.pickEntity(em, ev.clientX, ev.clientY);
    if (!v || v.kind !== KIND.MOB || v.isDead?.()) { ui.addChat('sys', 'Cible invalide.'); return; }
    targetId = v.id;
    updateTargetFrame();
    castSpellAt(spellId, { target: v.id });
  } else if (sp.type === 'aoe') {
    const w = renderer.s2w(ev.clientX, ev.clientY);
    castSpellAt(spellId, { x: w.x, z: w.z });
  } else { // heal / buff : sur soi
    castSpellAt(spellId, {});
  }
}

// relance automatique (appelée régulièrement par la boucle de rendu)
function tickAutoCast() {
  if (!autoCast || selfId == null) return;
  const sp = ui.spellDef(autoCast.spellId);
  if (!sp) { cancelAuto(); return; }
  // cible morte ou disparue -> stop
  if (autoCast.target != null) {
    const v = em.get(autoCast.target);
    if (!v || v.isDead?.()) { cancelAuto(); return; }
  }
  const now = performance.now() / 1000;
  if ((ui.cds[sp.id] || 0) > now) return;            // encore en recharge
  if ((ui.self?.mana ?? 0) < sp.mana) return;        // attend le mana
  // attend que la cible/le point soit à portée (évite le spam « Trop loin »)
  if (sp.range > 0) {
    const me = em.get(selfId);
    const tx = autoCast.target != null ? em.get(autoCast.target)?.x : autoCast.x;
    const tz = autoCast.target != null ? em.get(autoCast.target)?.z : autoCast.z;
    if (me && tx != null && Math.hypot(tx - me.x, tz - me.z) > sp.range) return;
  }
  net.send({ t: 'cast', spellId: sp.id, ...(autoCast.target != null ? { target: autoCast.target } : {}), ...(autoCast.x != null ? { x: autoCast.x, z: autoCast.z } : {}) });
  ui.cds[sp.id] = now + 0.4; // anti-spam local en attendant le cast_ok serveur
}

// curseur "main scintillante" dessiné dans le canvas (un curseur CSS ne s'anime pas)
function drawAimCursor(now) {
  if (!aimSpell) return;
  const ctx = renderer.ctx;
  const { x, y } = lastPointer;
  const sp = ui.spellDef(aimSpell);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.sin(now * 6) * 0.14);
  ctx.font = '30px serif';
  ctx.textAlign = 'center';
  ctx.fillText('🖐', 0, 12);
  // étincelles au bout des doigts
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 5; i++) {
    const a = now * 7 + i * 1.3;
    const px = -2 + Math.sin(a) * 7 + (i - 2) * 4;
    const py = -16 + Math.cos(a * 1.7) * 5;
    const r = 1.5 + Math.sin(a * 2.3 + i) * 1;
    const g = ctx.createRadialGradient(px, py, 0, px, py, r * 3);
    g.addColorStop(0, sp?.color || '#ffe48a');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(px - r * 3, py - r * 3, r * 6, r * 6);
  }
  ctx.restore();
}

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
  if (sp.type === 'heal' || sp.type === 'buff') { castSpellAt(spellId, {}); return true; }
  if (sp.type === 'aoe') {
    const w = renderer.s2w(ev?.clientX ?? lastPointer.x, ev?.clientY ?? lastPointer.y);
    castSpellAt(spellId, { x: w.x, z: w.z });
    return true;
  }
  // bolt : cible sous le curseur, sinon cible courante
  let tid = null;
  const v = ev ? renderer.pickEntity(em, ev.clientX, ev.clientY) : null;
  if (v && v.kind === KIND.MOB && !v.isDead?.()) tid = v.id;
  else if (targetId != null) tid = targetId;
  if (tid == null) { ui.addChat('sys', 'Aucune cible pour ' + sp.name + '.'); return false; }
  castSpellAt(spellId, { target: tid });
  return true;
}

canvas.addEventListener('pointerdown', (ev) => {
  if (selfId == null) return;
  lastPointer = { x: ev.clientX, y: ev.clientY };

  // clic droit : annule la visée en cours
  if (ev.button === 2) { cancelAim(); return; }
  if (ev.button !== 0) return;

  // ---- visée de sort : ce clic désigne la cible ----
  if (aimSpell) {
    const id = aimSpell;
    cancelAim();
    aimClick(id, ev);
    return;
  }

  // ---- mode combat : tous les clics sont des attaques/sorts ----
  if (combatMode) {
    cancelAuto();
    if (ui.activeSpell) { castActive(ui.activeSpell, ev); return; }
    const v = renderer.pickEntity(em, ev.clientX, ev.clientY);
    if (v && v.kind === KIND.MOB && !v.isDead?.()) {
      targetId = v.id;
      net.send({ t: 'attack', id: v.id });
      updateTargetFrame();
    }
    return;
  }

  cancelAuto(); // toute autre action interrompt la relance automatique
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
let hover = { id: null, color: null }; // entité survolée (pour le surlignement)
canvas.addEventListener('pointermove', (ev) => {
  hoverPending = ev;
  lastPointer = { x: ev.clientX, y: ev.clientY };
});
function processHover() {
  if (!hoverPending || selfId == null || !renderer) return;
  const ev = hoverPending;
  hoverPending = null;
  if (aimSpell) {
    canvas.style.cursor = 'none';
    ui.hideTooltip();
    // en visée : surligne la cible potentielle avec la couleur du sort
    const sp = ui.spellDef(aimSpell);
    const v = renderer.pickEntity(em, ev.clientX, ev.clientY);
    if (sp?.type === 'bolt' && v && v.kind === KIND.MOB && !v.isDead?.()) {
      hover = { id: v.id, color: sp.color || '#aaddff' };
    } else {
      hover = { id: null, color: null };
    }
    return;
  }
  const v = renderer.pickEntity(em, ev.clientX, ev.clientY);
  if (v && v.id !== selfId && !v.isDead?.()) {
    canvas.style.cursor = 'pointer';
    hover = {
      id: v.id,
      color: v.kind === KIND.MOB ? '#ff9a6a' : v.kind === KIND.NPC ? '#ffe48a'
        : v.kind === KIND.DROP ? '#d8d8d8' : '#8ac8ff',
    };
    const label = v.kind === KIND.DROP
      ? (v.meta.gold ? `${v.meta.gold} pièces d'or` : 'Objet (clic pour ramasser)')
      : v.kind === KIND.NPC ? `${v.meta.name} (clic pour parler)`
      : `${v.meta.name} [niv. ${v.level || v.meta.level}]`;
    ui.showTooltip(label);
    ui.moveTooltip(ev.clientX, ev.clientY);
  } else {
    hover = { id: null, color: null };
    const w = renderer.s2w(ev.clientX, ev.clientY);
    const prop = renderer.props.find(p => p.interact && Math.hypot(p.x - w.x, p.z - w.z) < 1.6);
    if (prop) {
      canvas.style.cursor = 'pointer';
      const labels = { obelisk: 'Obélisque des voyages', trialgate: "Portail de l'Épreuve", exitgate: "Sortie de l'Épreuve", chest: 'Coffre au trésor' };
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
  // menu ouvert : seules Échap (fermer) passe, le jeu est en pause d'entrées
  if (ui.menuOpen()) {
    if (ev.key === 'Escape') ui.hideMenu();
    return;
  }

  // touche de sort (hors chat) = entrer en visée — comportement par défaut.
  // Les sorts `centered` (effet autour du lanceur) partent immédiatement.
  if (!ev.ctrlKey && !ev.metaKey && !ev.altKey && ev.key.length === 1) {
    const spellId = ui.hotkeys[ev.key.toLowerCase()];
    if (spellId && (ui.self?.spells || []).includes(spellId)) {
      ev.preventDefault();
      const sp = ui.spellDef(spellId);
      if (sp?.centered) { cancelAuto(); castSpellAt(spellId, {}); }
      else { aimSpell = spellId; canvas.style.cursor = 'none'; }
      return;
    }
  }

  if (ev.key.startsWith('Arrow')) {
    ev.preventDefault();
    cancelAuto();
    if (!arrows.has(ev.key)) { arrows.add(ev.key); sendMoveDirFromArrows(); }
    return;
  }
  const k = ev.key.toLowerCase();
  if (k === 'i') ui.togglePanel('inventory');
  else if (k === 'c') ui.togglePanel('character');
  else if (k === 's') ui.togglePanel('spells');
  else if (k === 'h') ui.togglePanel('help');
  else if (ev.key === 'Enter') { ev.preventDefault(); ui.focusChat(); }
  else if (ev.key === 'Escape') {
    // priorité : annuler la visée > fermer les panneaux > menu (reprendre/quitter)
    if (aimSpell) { cancelAim(); return; }
    if (ui.menuOpen()) { ui.hideMenu(); return; }
    if (ui.anyPanelOpen()) { ui.togglePanel(null); return; }
    if (selfId != null) ui.showMenu();
  }
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

  // cible en cours : sort auto en priorité, sinon cible d'attaque/inspection
  const curTargetId = autoCast?.target ?? targetId;
  const curTargetView = curTargetId != null ? em.get(curTargetId) : null;
  const hl = {
    targetId: curTargetId,
    targetColor: autoCast?.target != null ? (ui.spellDef(autoCast.spellId)?.color || '#ff5040')
      : curTargetView?.kind === KIND.PLAYER ? '#8ac8ff' : '#ff5040',
    hoverId: hover.id !== curTargetId ? hover.id : null,
    hoverColor: hover.color,
  };
  const daylight = renderer.render(em, worldTime, now, selfId, hl);
  ui.setClock(daylight, (worldTime % DAY_LENGTH) / DAY_LENGTH);
  drawAimCursor(now);

  processHover();
  if (frameN % 6 === 0) tickAutoCast();
  if (++frameN % 20 === 0) { updateTargetFrame(); ui.tickCooldowns(); }
}
frame();
