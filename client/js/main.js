// Point d'entrée client : assets Flare, rendu iso 2D, multi-zones, contrôles, sorts
import { generateWorld, generateTrial } from '../../shared/worldgen.js';
import { generateCave } from '../../shared/cave.js';
import { applyOverrides } from '../../shared/overrides.js';
import { KIND, DAY_LENGTH } from '../../shared/constants.js';
import { ITEMS } from '../../shared/defs.js';
import { loadAssets } from './render2d/assets.js';
import { chargerSurcharges } from './surcharges.js';
import { buildDecor } from './render2d/decor.js';
import { Renderer } from './render2d/renderer.js';
import { EntityManager2D, setPartyIds } from './render2d/entities2d.js';
import { Net } from './net.js';
import { UI } from './gui/ui.js';
import { initDraggableWindows } from './drag.js';
import { settings } from './settings.js';
import { globalBus } from './event-bus.js';
import { uiStore, repondre } from './gui/ui-store.js';
import { guiManager, basculerMiniCarte } from './gui/gui-manager.js';
import { chargerJournal, effacerJournal } from './gui/journal.js';
import { MiniCarte } from './gui/minicarte.js';
import { BUFFS } from './gui/components/buffs/buffs.js';
import { playMusic } from './music.js';
import { play as playSfx, playCast, playImpact } from './sfx.js';
import { tickManette, boutonsDe, nomBouton } from './manette.js';

const INTERP_DELAY = 0.15;

const canvas = document.getElementById('game');
const net = new Net();
const ui = new UI(net);
initDraggableWindows(); // fenêtres de verre déplaçables par leur barre de titre

let renderer = null, em = null;
let world = null;
let selfId = null;
let worldTime = DAY_LENGTH * 0.3;
let targetId = null;

// --- Chargement des assets + contenu, puis connexion ---
let assets;
try {
  await chargerSurcharges(); // créatures / objets modifiés dans la Forge
  assets = await loadAssets();
  const spellsJson = await (await fetch('/content/spells.json')).json();
  uiStore.spellDefs = spellsJson.spells;
  uiStore.skillDefs = (await (await fetch('/content/skills.json')).json()).skills || [];
  ui.setAssets(assets); // pour la poupée d'inventaire
} catch (e) {
  fatal(e.message);
  throw e;
}
world = generateWorld();
renderer = new Renderer(canvas, assets, world, buildDecor(world));
// mini-carte : un clic dessus fait marcher vers le point visé
const miniCarte = new MiniCarte(document.getElementById('minicarte-canvas'), (x, z) => {
  cancelAuto();
  net.send({ t: 'move', x, z });
});
miniCarte.setWorld(world);
em = new EntityManager2D(assets);

// thème de l'écran de connexion (content/music.json, clé `login`). En jeu, le
// SERVEUR résout les emplacements (groupes -> liste) avant de pousser le message
// `music` ; le login étant lu en statique, on résout ici la même référence de
// groupe { group:"id" } -> objet groupe { new:[...], legacy } via la section
// `groups` du même fichier (sinon repli silence ; un slot { legacy, new } passe tel quel).
try {
  const musicCfg = await (await fetch('/content/music.json')).json();
  const login = musicCfg.login;
  const slot = (login && typeof login.group === 'string')
    ? (musicCfg.groups?.[login.group] || null)
    : login;
  playMusic(slot);
} catch { /* pas de musique configurée */ }

// version déployée : en bas à gauche du login + menu À propos.
// Garde-fou : un serveur antérieur à cette feature répond « 404 » en texte,
// que JSON.parse lit comme le nombre 404 — on n'affiche que du valide.
try {
  const v = await (await fetch('/api/version')).json();
  if (v && typeof v.version === 'string') ui.setVersion(v);
} catch { /* serveur sans version : on n'affiche rien */ }

await net.connect();

// ---------- Erreurs visibles ----------
// Une exception ou une erreur d'authentification ne doit JAMAIS laisser un
// écran figé sans explication : on réaffiche l'écran de connexion avec le
// message, quoi qu'il arrive.
function fatal(text) {
  document.getElementById('creation')?.classList.add('hidden');
  document.getElementById('hud')?.classList.add('hidden');
  document.getElementById('death-screen')?.classList.add('hidden');
  const login = document.getElementById('login');
  login?.classList.remove('hidden');
  uiStore.phase = 'login';
  guiManager.loadPhaseComponents('login');
  globalBus.emit('gui:login-error', text);
}
// Fin de session (connexion perdue, ou erreur du client en jeu) : l'état du
// jeu en mémoire n'est plus fiable et la connexion ne sert plus. On affiche
// la raison, on attend que le serveur réponde (redémarrage...), puis on
// recharge la page : retour PROPRE à l'écran de connexion, raison rappelée.
const CLE_DECONNEXION = 't4c:deconnexion';
let sortieEnCours = false;
async function retourConnexion(texte) {
  if (sortieEnCours) return;
  sortieEnCours = true;
  fatal(`${texte} Retour à l'écran de connexion…`);
  try { sessionStorage.setItem(CLE_DECONNEXION, texte); } catch { /* stockage indisponible */ }
  for (;;) {
    try { if ((await fetch('/api/version', { cache: 'no-store' })).ok) break; } catch { /* serveur absent */ }
    await new Promise(r => setTimeout(r, 2000));
  }
  location.reload();
}
// en jeu, une erreur du client ferme la session (le serveur sauvegarde) ;
// avant d'entrer en jeu, l'écran de connexion suffit
function erreurClient(texte) {
  if (selfId != null && net.ws?.readyState === 1) { retourConnexion(texte); net.ws.close(); }
  else fatal(texte);
}
window.addEventListener('error', (e) => erreurClient(`Erreur du client : ${e.message} (${(e.filename || '').split('/').pop()}:${e.lineno})`));
window.addEventListener('unhandledrejection', (e) => erreurClient(`Erreur du client : ${e.reason?.message || e.reason}`));
// raison de la session précédente (après le rechargement)
try {
  const raison = sessionStorage.getItem(CLE_DECONNEXION);
  if (raison) { sessionStorage.removeItem(CLE_DECONNEXION); fatal(raison); }
} catch { /* stockage indisponible */ }

// ---------- Réseau ----------
net.on('auth_error', (m) => fatal(m.error));
net.on('create_char', async (m) => {
  uiStore.phase = 'creation';
  await guiManager.loadPhaseComponents('creation');
  globalBus.emit('gui:show-creation', m);
});
net.on('welcome', (m) => {
  selfId = m.id;
  uiStore.player.name = m.name || '';
  chargerJournal();
  uiStore.selfId = m.id;
  uiStore.adminPerms = m.perms || [];
  ui.selfId = m.id;
  worldTime = m.time;
  uiStore.phase = 'in-game';
  // réglages à chaud (taille du HUD, style du chat, overlay perf) une fois le HUD monté
  guiManager.loadPhaseComponents('in-game').then(() => ui.applyLiveSettings());
  globalBus.emit('net:chat-received', { from: 'sys', text: "Bienvenue. Clic pour vous déplacer, H pour l'aide. La mort est définitive…" });
});
net.on('perms', (m) => { uiStore.adminPerms = m.perms || []; });
net.on('who', (m) => { uiStore.joueurs = m.list || []; });
net.on('channels', (m) => { uiStore.channels = m.list || []; });
// le serveur diffuse aussi l'annonce dans le chat : ici, seulement le bandeau
net.on('announce', (m) => ui.announce(m.text));
// commandes de la boîte à outils admin (composant gui/admin)
globalBus.on('admin:cmd', (m) => net.send({ t: 'admin', ...m }));
net.on('zone', async (m) => {
  cancelAim(); cancelAuto(); ui.endCastBar(); targetId = null;
  em.clear(selfId); // tout de suite : les entités de la nouvelle zone vont arriver
  // le client régénère le même monde que le serveur : île (seed/carte fixe),
  // labyrinthe de l'Épreuve, ou intérieur de caverne (paramètres partagés)
  const w = m.kind === 'trial' ? generateTrial(m.seed)
    : m.kind === 'cave' ? generateCave(m.cave.seed, m.cave.size, m.cave.depth)
    : generateWorld(m.seed, m.map);
  if (m.kind === 'island') {
    try {
      const r = await fetch(`/content/overrides_${m.zoneId}.json`);
      if (r.ok) applyOverrides(w, await r.json());
    } catch { /* pas d'overrides */ }
  }
  world = w;
  renderer.setWorld(world, buildDecor(world), m.tint || null);
  renderer.cam = { x: m.x, z: m.z };
  ui.zoneBanner(m.name, m.levels || null);
  uiStore.zoneName = m.name || '';
  miniCarte.setWorld(world);
  renderer.ambience = m.ambience || null; // ambiance d'arrivée (teinte/obscurité)
  playMusic(m.music); // musique de la zone (null = silence)
  if (m.kind === 'trial') globalBus.emit('net:chat-received', { from: 'sys', text: 'Vous êtes dans l\'Épreuve. Atteignez la sortie ou périssez.' });
});
net.on('music', (m) => playMusic(m.file)); // changement à chaud par l'admin
// ambiance de sous-zone (teinte/obscurité) : bascule à hystérésis côté serveur
net.on('ambience', (m) => { renderer.ambience = m.ambience || null; });
net.on('self', (m) => {
  globalBus.emit('net:self-update', m);
});
net.on('vitals', (m) => globalBus.emit('net:vitals', m));
net.on('meta', (m) => { for (const meta of m.list) em.addMeta(meta); });
net.on('chat', (m) => globalBus.emit('net:chat-received', m));
net.on('info', (m) => globalBus.emit('net:chat-received', { from: 'sys', text: m.text }));
net.on('loot', (m) => {
  globalBus.emit('net:chat-received', { from: 'sys', text: m.text });
  if (/^\+\d+ or$/.test(m.text)) playSfx('or');           // pièces ramassées
  else if (m.text.startsWith('Vous ouvrez le coffre')) playSfx('coffre');
  const v = em.get(selfId);
  if (v) triggerFloater(headPos(v), m.text, 'xp');
});
net.on('died', (m) => {
  effacerJournal(); // la mort est définitive : le journal part avec le personnage
  cancelAim();
  cancelAuto();
  ui.endCastBar();
  uiStore.phase = 'death';
  guiManager.loadPhaseComponents('death');
  ui.showDeath(m);
});
// XP par coup : gains regroupés par le serveur -> un flotteur lisible + la barre
net.on('xp', (m) => {
  globalBus.emit('net:xp', m);
  const v = em.get(selfId);
  if (v) triggerFloater(headPos(v), `+${m.gain} XP`, 'xp');
});
// ---- Groupe ----
net.on('party_update', (m) => {
  ui.setParty(m);
  // surlignage des noms des membres au-dessus des têtes
  setPartyIds(m.members.map(x => x.id));
});
net.on('party_invite', (m) => ui.showPartyInvite(m));
net.on('party_vitals', (m) => ui.updatePartyVitals(m));
net.on('shop', (m) => globalBus.emit('net:shop', m));
net.on('obelisk', (m) => globalBus.emit('net:obelisk', m));
net.on('bank_open', (m) => globalBus.emit('net:bank-open', m));
net.on('confirm_trial', (m) => ui.showTrialConfirm(m));
net.on('cast_ok', (m) => {
  ui.startCooldown(m.spellId, m.cd);
  if (ui.self) { globalBus.emit('net:vitals', { hp: ui.self.hp, mana: m.mana }); }
});
// T4C : le sort part immédiatement, la barre montre la RÉCUPÉRATION avant de
// pouvoir relancer (vitesse du sort de la Bible)
net.on('cast_start', (m) => {
  spellReadyAt = performance.now() + m.ms;
  ui.startCastBar(m.name, m.ms);
});
net.on('cast_break', () => ui.endCastBar());
// relance trop tôt : le serveur indique le temps de récupération restant
net.on('cast_cd', (m) => { spellReadyAt = performance.now() + m.ms; });
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
      if (ev.parry) { triggerFloater(pos, 'paré !', 'miss'); playSfx('parade'); }
      else if (ev.miss) triggerFloater(pos, 'raté', 'miss');
      else {
        const suffix = ev.mod === 'resist' ? ' (résisté)' : ev.mod === 'weak' ? ' !' : '';
        // couleurs : dégâts REÇUS en rouge, INFLIGÉS en clair, ceux des autres atténués
        const cls = (ev.crit ? 'crit' : '') + (ev.to === selfId ? ' self' : ev.from === selfId ? ' inflige' : '')
          + (ev.mod === 'resist' ? ' miss' : '') + (ev.mod === 'weak' ? ' heal' : '');
        triggerFloater(pos, `-${ev.amount}${suffix}`, cls);
        if (ev.from === selfId || ev.to === selfId) playSfx('coup');
      }
    } else if (ev.t === 'fx') {
      const v = em.get(ev.id);
      if (!v) continue;
      renderer.fxAt(ev.kind, v.x, v.z, ev.color, ev.fx);
      if (ev.kind === 'levelup') { triggerFloater(headPos(v), 'NIVEAU SUPÉRIEUR !', 'crit'); if (ev.id === selfId) playSfx('levelup'); }
      if (ev.kind === 'heal') { triggerFloater(headPos(v), '+ soin', 'heal'); if (ev.id === selfId) playSfx('soin'); }
      if (ev.kind === 'buff') {
        // buffs DÉFENSIFS : bulle de protection éphémère autour de la cible
        const DEFENSIFS = /^(def|resistAll|resist_|sanctuaire|retort)/;
        if (ev.stat && DEFENSIFS.test(ev.stat)) renderer.fxAt('shield', v.x, v.z, ev.color || '#9ad4ff', ev.fx);
        triggerFloater(headPos(v), BUFFS[ev.stat]?.[1] || 'renforcé', 'heal');
        if (ev.id === selfId) playSfx('buff');
      }
      if (ev.kind === 'curse') { triggerFloater(headPos(v), 'maudit', 'miss'); playSfx('malediction'); }
      if (ev.kind === 'die') playSfx('mort');
    } else if (ev.t === 'look') {
      em.get(ev.id)?.setLook(ev.look);
    } else if (ev.t === 'say') {
      const v = em.get(ev.id);
      if (v) {
        v.say(ev.text);
        if (ev.npc) {
          ui.addChat(v.meta.name + ' (PNJ)', ev.text); // chat local
          globalBus.emit('net:npc-say', { nom: v.meta.name, texte: ev.text, zone: uiStore.zoneName });
        }
      }
    } else if (ev.t === 'proj') {
      const a = em.get(ev.from), b = em.get(ev.to);
      a?.triggerSwing(); // animation de lancement à chaque sort
      if (a && b) {
        if (ev.element === 'air') {
          // éclair : zigzag instantané entre lanceur et cible, pas un projectile lent
          renderer.addFx({ type: 'zap', x0: a.x, z0: a.z, x1: b.x, z1: b.z, color: ev.color, fx: ev.fx, dur: 0.22 });
          playImpact('air');
        } else {
          renderer.addFx({ type: 'proj', x0: a.x, z0: a.z, x1: b.x, z1: b.z, color: ev.color, element: ev.element, fx: ev.fx, dur: 0.3 });
          if (ev.element) { playCast(ev.element); playImpact(ev.element, 0.3); }
        }
      }
    } else if (ev.t === 'aoe') {
      em.get(ev.from)?.triggerSwing();
      renderer.addFx({ type: 'aoe', x: ev.x, z: ev.z, radius: ev.radius, color: ev.color, element: ev.element, fx: ev.fx, dur: 0.6 });
      playImpact(ev.element || 'neutre');
    }
  }
});
// 1006 : connexion coupée sans fermeture (serveur arrêté, réseau, veille)
net.on('disconnected', (m) => retourConnexion(m?.raison && m.raison !== 'bye'
  ? `Déconnecté du serveur : ${m.raison}.`
  : m?.code === 1006 ? 'Connexion au serveur perdue (serveur arrêté ou réseau coupé).'
  : `Déconnecté du serveur${m?.code && m.code !== 1000 ? ` (code ${m.code})` : ''}.`));

// ---------- Mesure de latence (ping) ----------
// Aller-retour WebSocket périodique : on envoie {t:'ping', ts}, le serveur
// renvoie {t:'pong', ts} et on en déduit le RTT. Affiché seulement si activé.
let lastPing = null; // ms, dernier aller-retour mesuré
const PING_INTERVAL_MS = 2000;
net.on('pong', (m) => { if (Number.isFinite(m.ts)) lastPing = Math.max(0, performance.now() - m.ts); });
setInterval(() => {
  if (selfId != null && settings.showPerf) net.send({ t: 'ping', ts: performance.now() });
}, PING_INTERVAL_MS);

function headPos(v) {
  const p = renderer.w2s(v.x, v.z);
  return { x: p.x, y: (v.topY ?? p.y - 90), visible: true };
}

function triggerFloater(pos, text, cls = '') {
  globalBus.emit('ui:floater', { screen: pos, text, cls });
}

// ---------- Contrôles ----------
let combatMode = false;       // Ctrl maintenu
let altTenu = false;          // Alt maintenu : noms des objets au sol
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
let spellReadyAt = 0;         // fin de la récupération globale (ms, performance.now)

function cancelAim() { aimSpell = null; canvas.style.cursor = ''; }

// touche ou case de la barre : visée (curseur réticule), ou lancement
// immédiat d'un sort centré sur le lanceur
function armerSort(spellId) {
  if (selfId == null || !(ui.self?.spells || []).includes(spellId)) return;
  const sp = ui.spellDef(spellId);
  if (sp?.centered) { cancelAuto(); castSpellAt(spellId, {}); }
  else { aimSpell = spellId; canvas.style.cursor = 'none'; }
}
globalBus.on('ui:sort', armerSort);
function cancelAuto() { autoCast = null; }

function castSpellAt(spellId, params) {
  // hors mode combat, le serveur rapproche le personnage si la cible est trop loin
  net.send({ t: 'cast', spellId, ...params, approach: !combatMode });
  autoCast = { spellId, ...params };
}

// une vue est-elle une cible valide pour ce sort ? (monstre, ou joueur pour
// les sorts purement maudissants comme Malédiction)
function validSpellTarget(sp, v) {
  if (!v || v.isDead?.()) return false;
  if (v.kind === KIND.MOB) return true;
  return v.kind === KIND.PLAYER && v.id !== selfId && !!sp.curse && !sp.dmg;
}

// clic de visée : détermine la cible selon le type du sort
function aimClick(spellId, ev) {
  const sp = ui.spellDef(spellId);
  if (!sp) return;
  cancelAuto();
  if (sp.type === 'bolt') {
    const v = renderer.pickEntity(em, ev.clientX, ev.clientY);
    if (!validSpellTarget(sp, v)) { ui.addChat('sys', 'Cible invalide.'); return; }
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
  if (performance.now() < spellReadyAt) return;      // récupération T4C en cours
  if ((ui.cds[sp.id] || 0) > now) return;            // encore en recharge
  if ((ui.self?.mana ?? 0) < sp.mana) return;        // attend le mana
  // en mode combat on attend d'être à portée ; sinon le serveur s'approche tout seul
  if (sp.range > 0 && combatMode) {
    const me = em.get(selfId);
    const tx = autoCast.target != null ? em.get(autoCast.target)?.x : autoCast.x;
    const tz = autoCast.target != null ? em.get(autoCast.target)?.z : autoCast.z;
    if (me && tx != null && Math.hypot(tx - me.x, tz - me.z) > sp.range) return;
  }
  net.send({ t: 'cast', spellId: sp.id, approach: !combatMode, ...(autoCast.target != null ? { target: autoCast.target } : {}), ...(autoCast.x != null ? { x: autoCast.x, z: autoCast.z } : {}) });
  ui.cds[sp.id] = now + 0.4; // anti-spam local en attendant le cast_ok serveur
}

// curseur de visée dessiné dans le canvas (un curseur CSS ne s'anime pas) :
// réticule à la couleur du sort, qui tourne, entouré d'étincelles
function drawAimCursor(now) {
  if (!aimSpell) return;
  const ctx = renderer.ctx;
  const { x, y } = lastPointer;
  const couleur = ui.spellDef(aimSpell)?.color || '#ffe48a';
  ctx.save();
  ctx.translate(x, y);
  ctx.lineCap = 'round';
  // contour sombre puis trait coloré : lisible sur tous les sols
  for (const [largeur, teinte] of [[4, 'rgba(0,0,0,0.6)'], [2, couleur]]) {
    ctx.strokeStyle = teinte;
    ctx.lineWidth = largeur;
    ctx.beginPath();
    ctx.arc(0, 0, 11, 0, Math.PI * 2);
    ctx.stroke();
    ctx.save();
    ctx.rotate(now * 1.6);
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2;
      ctx.moveTo(Math.cos(a) * 14, Math.sin(a) * 14);
      ctx.lineTo(Math.cos(a) * 20, Math.sin(a) * 20);
    }
    ctx.stroke();
    ctx.restore();
  }
  ctx.fillStyle = couleur;
  ctx.beginPath();
  ctx.arc(0, 0, 2, 0, Math.PI * 2);
  ctx.fill();
  // étincelles en orbite
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 5; i++) {
    const a = now * 3 + i * 1.26;
    const px = Math.cos(a) * 16, py = Math.sin(a) * 16;
    const r = 1.5 + Math.sin(now * 7 + i) * 1;
    const g = ctx.createRadialGradient(px, py, 0, px, py, r * 3);
    g.addColorStop(0, couleur);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(px - r * 3, py - r * 3, r * 6, r * 6);
  }
  ctx.restore();
}

function sendMoveDirFromArrows() {
  let sx = 0, sy = 0;
  if (arrows.has('ArrowUp')) sy -= 1;
  if (arrows.has('ArrowDown')) sy += 1;
  if (arrows.has('ArrowLeft')) sx -= 1;
  if (arrows.has('ArrowRight')) sx += 1;
  envoyerDirEcran(sx, sy);
}
// direction ÉCRAN (flèches, stick de manette) -> déplacement sur la carte :
// haut = (-1,-1), droite = (1,-1), bas = (1,1), gauche = (-1,1)
function envoyerDirEcran(sx, sy) {
  if (!sx && !sy) { net.send({ t: 'movedir', x: 0, z: 0 }); return; }
  net.send({ t: 'movedir', x: sx + sy, z: sy - sx });
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
  if (validSpellTarget(sp, v)) tid = v.id;
  else if (targetId != null) tid = targetId;
  if (tid == null) { ui.addChat('sys', 'Aucune cible pour ' + sp.name + '.'); return false; }
  castSpellAt(spellId, { target: tid });
  return true;
}

canvas.addEventListener('pointerdown', (ev) => {
  if (selfId == null) return;
  lastPointer = { x: ev.clientX, y: ev.clientY };

  // clic droit : annule la visée en cours et le mode placement admin
  if (ev.button === 2) { cancelAim(); uiStore.adminPlace = null; return; }
  if (ev.button !== 0) return;

  // ---- placement admin : chaque clic pose/invoque à la case visée ----
  if (uiStore.adminPlace) {
    const w = renderer.s2w(ev.clientX, ev.clientY);
    const { label, ...payload } = uiStore.adminPlace;
    net.send({ t: 'admin', ...payload, x: w.x, z: w.z });
    return; // le mode reste actif : clic droit ou « stop » pour quitter
  }

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

  cancelAuto();
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
    renderer.marquerDestination(w.x, w.z);
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
let pointeurSurCarte = false;  // le pointeur survole le canvas (pas le HUD)
let survolRevuA = 0;           // dernière réévaluation du survol sans mouvement
canvas.addEventListener('pointermove', (ev) => {
  hoverPending = ev;
  pointeurSurCarte = true;
  lastPointer = { x: ev.clientX, y: ev.clientY };
});
// pointeur parti sur le HUD ou hors de la fenêtre : plus rien n'est survolé
canvas.addEventListener('pointerleave', () => {
  pointeurSurCarte = false;
  hoverPending = null;
  hover = { id: null, color: null };
  ui.hideTooltip();
});
// la carte défile sous un pointeur immobile (marche, monstre qui passe) :
// le survol est réévalué au même point, sinon l'infobulle d'une entité
// partie reste affichée
function revoirSurvol(now) {
  if (!pointeurSurCarte || hoverPending || now - survolRevuA < 0.15) return;
  survolRevuA = now;
  hoverPending = { clientX: lastPointer.x, clientY: lastPointer.y };
}
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
    if (sp?.type === 'bolt' && validSpellTarget(sp, v)) {
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
      ? (v.meta.gold ? `${v.meta.gold} pièces d'or` : `${ITEMS[v.meta.defId]?.name || 'Objet'} (clic ou Espace pour ramasser)`)
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
      const labels = {
        obelisk: 'Obélisque des voyages', trialgate: "Portail de l'Épreuve",
        exitgate: world.kind === 'cave' ? 'Sortie de la caverne' : "Sortie de l'Épreuve",
        chest: 'Coffre au trésor', bank: 'Coffre personnel (banque)', cave: prop.name || 'Grotte',
      };
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
  // Alt : sans preventDefault, Firefox ouvre sa barre de menus au relâchement
  if (ev.key === 'Alt') { ev.preventDefault(); altTenu = true; }
  // boîte de dialogue ouverte : elle a la main (Échap = annuler)
  if (uiStore.dialogue) {
    if (ev.key === 'Escape') { ev.preventDefault(); repondre(false); }
    return;
  }
  if (ui.isTyping() || ui.bindingSpell) return;
  // menu ouvert : seule Échap (fermer) passe, le jeu est en pause d'entrées
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
      armerSort(spellId);
      return;
    }
  }

  // Tab : attaquer le monstre le plus proche ; encore Tab : le suivant
  // (Maj+Tab : le précédent). Laissé au navigateur quand un panneau est
  // ouvert, pour la navigation au clavier dans ses boutons.
  if (ev.key === 'Tab' && !ev.ctrlKey && !ev.altKey && !ui.anyPanelOpen()) {
    ev.preventDefault();
    attaquerSuivant(ev.shiftKey ? -1 : 1);
    return;
  }
  // Espace : ramasser l'objet au sol le plus proche (le personnage y va)
  if (ev.key === ' ' && !ev.ctrlKey && !ev.altKey && !ui.anyPanelOpen()) {
    ev.preventDefault();
    if (!ev.repeat) ramasserProche();
    return;
  }
  if (ev.key.startsWith('Arrow')) {
    ev.preventDefault();
    cancelAuto();
    if (!arrows.has(ev.key)) { arrows.add(ev.key); sendMoveDirFromArrows(); }
    return;
  }
  const k = ev.key.toLowerCase();
  if (k === 'i') guiManager.togglePanel('inventory');
  else if (k === 'c') guiManager.togglePanel('character');
  else if (k === 's') guiManager.togglePanel('spells');
  else if (k === 'h') guiManager.togglePanel('help');
  else if (k === 'j') guiManager.togglePanel('journal');
  else if (k === 'o') guiManager.togglePanel('joueurs');
  else if (k === 'n') basculerMiniCarte();
  else if (k === 'p') ui.usePotion('vie');
  else if (k === 'm') ui.usePotion('mana');
  else if (k === 'b') ui.utiliserBandage();
  else if (ev.key === 'Enter') { ev.preventDefault(); ui.focusChat(); }
  else if (ev.key === 'Escape') echap();
});

// priorité : annuler la visée > fermer les panneaux > menu (reprendre/quitter)
function echap() {
  if (aimSpell) { cancelAim(); return; }
  if (ui.menuOpen()) { ui.hideMenu(); return; }
  if (ui.anyPanelOpen()) { guiManager.togglePanel(null); return; }
  if (selfId != null) ui.showMenu();
}

// ---------- Manette ----------
// sort de la touche n de la barre (1 à 8) ; à la manette pas de visée à la
// souris : la cible en cours, sinon le monstre le plus proche (qui devient
// la cible), une zone sur la cible ou à ses pieds, un soin sur soi
function sortManette(n) {
  const spellId = ui.hotkeys[String(n)];
  if (selfId == null || !spellId || !(ui.self?.spells || []).includes(spellId)) return;
  const sp = ui.spellDef(spellId);
  if (!sp) return;
  cancelAim(); cancelAuto();
  if (sp.centered || (sp.type !== 'bolt' && sp.type !== 'aoe')) { castSpellAt(spellId, {}); return; }
  let v = targetId != null ? em.get(targetId) : null;
  if (!validSpellTarget(sp, v)) {
    const me = em.get(selfId);
    v = [...em.views.values()].filter(e => e.kind === KIND.MOB && !e.isDead?.() && Math.hypot(e.x - me.x, e.z - me.z) < 14)
      .sort((a, b) => Math.hypot(a.x - me.x, a.z - me.z) - Math.hypot(b.x - me.x, b.z - me.z))[0];
  }
  if (sp.type === 'bolt') {
    if (!v) { ui.addChat('sys', 'Aucune cible à portée.'); return; }
    targetId = v.id; updateTargetFrame();
    castSpellAt(spellId, { target: v.id });
  } else {
    const c = v || em.get(selfId);
    castSpellAt(spellId, { x: c.x, z: c.z });
  }
}
const actionsManette = {
  attaquer: () => attaquerSuivant(1),
  ciblePrecedente: () => attaquerSuivant(-1),
  ramasser: () => ramasserProche(),
  echap: () => echap(),
  potionVie: () => ui.usePotion('vie'),
  potionMana: () => ui.usePotion('mana'),
  bandage: () => ui.utiliserBandage(),
  inventaire: () => guiManager.togglePanel('inventory'),
  personnage: () => guiManager.togglePanel('character'),
  carte: () => basculerMiniCarte(),
  ...Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8].map(n => [`sort${n}`, () => sortManette(n)])),
};
// la manette a la main dès qu'elle sert : elle quitte la saisie du chat
// (restée active après un message, elle bloquerait stick et boutons)
const manetteActive = () => {
  if (selfId == null || uiStore.dialogue) return false;
  if (ui.isTyping()) document.activeElement?.blur?.();
  return true;
};
function annoncerManette() {
  const b = (a) => boutonsDe(a).map(nomBouton)[0] || '—';
  ui.addChat('sys', `Manette détectée : ${b('attaquer')} attaque, ${b('ramasser')} ramasse, ${b('echap')} annule, croix = sorts 1 à 4. `
    + 'Boutons modifiables dans Paramètres > Manette.');
}

window.addEventListener('keyup', (ev) => {
  if (ev.key === 'Control') { combatMode = false; ui.setCombatMode(false); }
  if (ev.key === 'Alt') { ev.preventDefault(); altTenu = false; }
  if (ev.key?.startsWith('Arrow')) {
    arrows.delete(ev.key);
    sendMoveDirFromArrows();
  }
});
window.addEventListener('blur', () => {
  arrows.clear();
  altTenu = false;
  combatMode = false;
  ui.setCombatMode(false);
  if (selfId != null) net.send({ t: 'movedir', x: 0, z: 0 });
});

// monstres vivants à moins de 14 cases, du plus proche au plus lointain ;
// on prend celui qui suit (ou précède) la cible actuelle dans cet ordre
function attaquerSuivant(sens) {
  const me = em.get(selfId);
  if (!me) return;
  const proches = [...em.views.values()]
    .filter(v => v.kind === KIND.MOB && !v.isDead?.() && Math.hypot(v.x - me.x, v.z - me.z) < 14)
    .sort((a, b) => Math.hypot(a.x - me.x, a.z - me.z) - Math.hypot(b.x - me.x, b.z - me.z));
  if (!proches.length) { ui.addChat('sys', 'Aucun monstre à proximité.'); return; }
  const i = proches.findIndex(v => v.id === targetId);
  const v = proches[i < 0 ? 0 : (i + sens + proches.length) % proches.length];
  cancelAuto();
  targetId = v.id;
  net.send({ t: 'attack', id: v.id });
  updateTargetFrame();
}

// objet au sol le plus proche, à courte portée : le butin du combat qu'on
// vient de livrer, pas celui de l'autre bout de l'écran
const PORTEE_RAMASSAGE = 5;
function ramasserProche() {
  const me = em.get(selfId);
  if (!me) return;
  let proche = null, dMin = PORTEE_RAMASSAGE;
  for (const v of em.views.values()) {
    if (v.kind !== KIND.DROP) continue;
    const d = Math.hypot(v.x - me.x, v.z - me.z);
    if (d <= dMin) { dMin = d; proche = v; }
  }
  if (!proche) { ui.addChat('sys', 'Rien à ramasser à proximité.'); return; }
  cancelAuto();
  net.send({ t: 'pickup', id: proche.id });
  renderer.marquerDestination(proche.x, proche.z);
}

function updateTargetFrame() {
  const v = targetId != null ? em.get(targetId) : null;
  if (!v || v.isDead?.()) { targetId = null; ui.setTarget(null); return; }
  // cible joueur : son id permet le bouton « Inviter dans le groupe »
  const playerId = (v.kind === KIND.PLAYER && v.id !== selfId) ? v.id : null;
  // difficulté d'un monstre selon l'écart de niveau (couleur du nom de la cible)
  const niv = v.level || v.meta.level || 1, ecart = niv - (ui.self?.level || 1);
  const danger = v.kind !== KIND.MOB ? null
    : ecart >= 5 ? 'mortel' : ecart >= 2 ? 'dur' : ecart <= -6 ? 'facile' : 'egal';
  ui.setTarget(`${v.meta.name} [${niv}]`, v.hpPct, playerId, danger);
}

// ---------- Boucle de rendu ----------
let lastT = performance.now() / 1000;
let frameN = 0;
let fps = 0; // FPS lissé sur la boucle de rendu
function updatePerfOverlay() {
  const el = document.getElementById('perf-overlay');
  if (!el || !settings.showPerf) return;
  const pingTxt = lastPing != null ? `${Math.round(lastPing)} ms` : '— ms';
  el.textContent = `${Math.round(fps)} FPS · ${pingTxt}`;
}
function frame() {
  requestAnimationFrame(frame);
  const now = performance.now() / 1000;
  const dt = Math.min(0.1, now - lastT);
  lastT = now;
  if (dt > 0) fps = fps * 0.9 + (1 / dt) * 0.1; // moyenne glissante

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
    butin: altTenu, // Alt maintenu : noms des objets au sol
    // sort Lumière actif -> le rendu perce l'obscurité autour de soi
    selfLight: !!(ui.self?.buffs || []).some(b => b.stat === 'light'),
  };
  const daylight = renderer.render(em, worldTime, now, selfId, hl);
  ui.setClock(daylight, (worldTime % DAY_LENGTH) / DAY_LENGTH);
  drawAimCursor(now);

  revoirSurvol(now);
  processHover();
  if (frameN % 6 === 0) tickAutoCast();
  tickManette(actionsManette, (sx, sy) => { if (sx || sy) cancelAuto(); envoyerDirEcran(sx, sy); },
    manetteActive, annoncerManette);
  if (frameN % 6 === 0 && uiStore.miniCarte && uiStore.phase === 'in-game') miniCarte.dessiner(em, selfId, renderer.props);
  if (++frameN % 20 === 0) { updateTargetFrame(); ui.tickCooldowns(); updatePerfOverlay(); }
}
frame();
