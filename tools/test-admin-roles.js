// Test d'intégration des rôles d'administration : permissions par compte,
// attribution à chaud depuis l'admin web, commandes en jeu (invocation,
// carte, dialogues) acceptées/refusées selon les permissions.
// À lancer sur une base FRAÎCHE (1er compte = super admin), serveur lancé à
// part avec T4C_OVERRIDES_DIR pointant sur un dossier jetable.
// Usage : node tools/test-admin-roles.js [urlHttp=http://localhost:8090]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { PROTOCOL_VERSION, ADMIN_PERMS } from '../shared/constants.js';

const BASE = process.argv[2] || 'http://localhost:8090';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const NPCS_PATH = path.join(ROOT, 'content', 'npcs.json');
const npcsBackup = fs.readFileSync(NPCS_PATH, 'utf8');
const checks = [];
const ok = (name, cond) => { checks.push([name, !!cond]); console.log(cond ? '  ✔' : '  ✘', name); };

// ---- client ws minimal : register + collecte des messages ----
function connect(name) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(BASE.replace('http', 'ws'));
    const c = { ws, name, welcome: null, inbox: [] };
    ws.on('message', (raw, bin) => {
      if (bin) return;
      const m = JSON.parse(raw.toString());
      c.inbox.push(m);
      if (m.t === 'create_char') ws.send(JSON.stringify({ t: 'create', stats: { str: 22, end: 18, agi: 14, int: 8, wis: 8 } }));
      if (m.t === 'welcome') { c.welcome = m; resolve(c); }
      if (m.t === 'auth_error') reject(new Error(m.error));
    });
    ws.on('open', () => ws.send(JSON.stringify({ t: 'register', v: PROTOCOL_VERSION, name, pass: 'test1234' })));
    setTimeout(() => reject(new Error('timeout connexion ' + name)), 8000);
  });
}
const send = (c, msg) => c.ws.send(JSON.stringify(msg));
// attend un message qui satisfait le prédicat (ou null après le délai)
function waitMsg(c, pred, ms = 1500) {
  return new Promise((resolve) => {
    const hit = c.inbox.find(pred);
    if (hit) return resolve(hit);
    const t0 = c.inbox.length;
    const iv = setInterval(() => {
      const m = c.inbox.slice(t0).find(pred);
      if (m) { clearInterval(iv); resolve(m); }
    }, 50);
    setTimeout(() => { clearInterval(iv); resolve(null); }, ms);
  });
}

// ---- 1. super admin (1er compte) et simple joueur ----
const boss = await connect('Boss_' + Math.floor(Math.random() * 1e6));
ok('super admin : toutes les permissions au welcome',
  ADMIN_PERMS.every(p => boss.welcome.perms?.includes(p)));
const anim = await connect('Anim_' + Math.floor(Math.random() * 1e6));
ok('nouveau compte : aucune permission', (anim.welcome.perms || []).length === 0);

// ---- 2. sans permission : commandes refusées, admin web fermé ----
send(anim, { t: 'admin', cmd: 'spawn', defId: 'rat', n: 1 });
ok('invocation refusée sans permission',
  !(await waitMsg(anim, m => m.t === 'info' && /Invoqué/.test(m.text), 900)));
const badLogin = await (await fetch(`${BASE}/api/admin/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: anim.name, pass: 'test1234' }),
})).json();
ok('login admin web refusé sans rôle', !!badLogin.error);

// ---- 3. attribution des rôles par le super admin, appliquée à chaud ----
const login = await (await fetch(`${BASE}/api/admin/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: boss.name, pass: 'test1234' }),
})).json();
const H = { Authorization: `Bearer ${login.token}`, 'Content-Type': 'application/json' };
const api = (url, method = 'GET', body = null) =>
  fetch(BASE + url, { method, headers: H, body: body ? JSON.stringify(body) : null }).then(r => r.json());

const roles = await api('/api/admin/roles');
const animAcc = roles.accounts.find(a => a.name === anim.name);
ok('liste des comptes et permissions', !!animAcc && Array.isArray(roles.perms));
await api('/api/admin/roles', 'PUT', { accountId: animAcc.id, perms: ['spawn', 'quests', 'map'] });
const hot = await waitMsg(anim, m => m.t === 'perms');
ok('rôles appliqués à chaud au joueur connecté',
  hot && ['spawn', 'quests', 'map'].every(p => hot.perms.includes(p)));

// ---- 4. invocation désormais acceptée ----
anim.inbox.length = 0;
send(anim, { t: 'admin', cmd: 'spawn', defId: 'rat', n: 2 });
ok('invocation acceptée avec la permission',
  !!(await waitMsg(anim, m => m.t === 'info' && /Invoqué : 2/.test(m.text))));
send(anim, { t: 'admin', cmd: 'give', gold: 123 });
ok('don d\u2019or', !!(await waitMsg(anim, m => m.t === 'info' && /123 pièces/.test(m.text))));

// ---- 5. édition de carte : persistée dans les overrides ----
const ovDir = process.env.T4C_OVERRIDES_DIR;
send(anim, { t: 'admin', cmd: 'tile', x: 3, z: 3, tile: 5 });
await new Promise(r => setTimeout(r, 500));
let painted = false;
try {
  const ov = JSON.parse(fs.readFileSync(path.join(ovDir, 'overrides_0.json'), 'utf8'));
  painted = (ov.tiles || []).some(([x, z, t]) => x === 3 && z === 3 && t === 5);
} catch { /* fichier absent */ }
ok('tuile peinte persistée dans overrides_0.json', painted);

// ---- 6. dialogues d\u2019un PNJ : assainis, sauvés, à chaud ----
anim.inbox.length = 0;
send(anim, {
  t: 'admin', cmd: 'dialogues', npcId: 'merchant',
  dialogues: [{ keywords: ['testquete'], reponse: 'Rapporte-moi une dague.', reactions: [{ type: 'flag', key: 'q:test' }] }],
});
ok('dialogues enregistrés (confirmation)',
  !!(await waitMsg(anim, m => m.t === 'info' && /Dialogues .* enregistrés/.test(m.text))));
const saved = JSON.parse(fs.readFileSync(NPCS_PATH, 'utf8'));
ok('npcs.json mis à jour sur disque',
  saved.npc.merchant.dialogues?.some(d => d.keywords?.includes('testquete')));
send(anim, { t: 'admin', cmd: 'dialogues', npcId: 'merchant', dialogues: [{ keywords: [], reponse: 'x' }] });
ok('dialogues invalides refusés',
  !!(await waitMsg(anim, m => m.t === 'info' && /invalides/.test(m.text))));

// ---- 6bis. événements de MJ : annonce diffusée, invasion en vagues ----
boss.inbox.length = 0;
send(anim, { t: 'admin', cmd: 'announce', text: 'Les corbeaux se rassemblent sur Arakas…' });
ok('annonce reçue par TOUS les joueurs (dont un autre compte)',
  !!(await waitMsg(boss, m => m.t === 'announce' && /corbeaux/.test(m.text))));
anim.inbox.length = 0;
send(anim, { t: 'admin', cmd: 'wave', defId: 'rat', n: 2, waves: 2, interval: 2000 });
ok('invasion : vague 1 immédiate',
  !!(await waitMsg(anim, m => m.t === 'info' && /Vague 1\/2/.test(m.text))));
ok('invasion : vague 2 après l\u2019intervalle',
  !!(await waitMsg(anim, m => m.t === 'info' && /Vague 2\/2/.test(m.text), 4000)));

// ---- 7. admin web de l\u2019animateur : son périmètre, rien de plus ----
const login2 = await (await fetch(`${BASE}/api/admin/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: anim.name, pass: 'test1234' }),
})).json();
const H2 = { Authorization: `Bearer ${login2.token}`, 'Content-Type': 'application/json' };
const api2 = (url, method = 'GET', body = null) =>
  fetch(BASE + url, { method, headers: H2, body: body ? JSON.stringify(body) : null });
ok('login admin web accepté avec un rôle', !!login2.token);
ok('animateur : dialogues PNJ accessibles (quests)', (await api2('/api/admin/content/npcs')).status === 200);
ok('animateur : personnages refusés (players manquant)', (await api2('/api/admin/characters')).status === 403);
ok('animateur : attribution des rôles refusée (réservée aux super admins)',
  (await api2('/api/admin/roles', 'PUT', { accountId: animAcc.id, perms: [] })).status === 403);

// ---- 8. super admin : promotion à chaud, garde-fous ----
anim.inbox.length = 0;
await api('/api/admin/roles', 'PUT', { accountId: animAcc.id, perms: [], superAdmin: true });
const crowned = await waitMsg(anim, m => m.t === 'perms');
ok('promotion 👑 : TOUTES les permissions à chaud',
  crowned && ADMIN_PERMS.every(p => crowned.perms.includes(p)));
ok('promotion 👑 : notification en jeu',
  !!(await waitMsg(anim, m => m.t === 'info' && /super admin/.test(m.text))));
// le promu peut désormais gérer les rôles lui-même
const login3 = await (await fetch(`${BASE}/api/admin/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: anim.name, pass: 'test1234' }),
})).json();
const r8 = await fetch(`${BASE}/api/admin/roles`, {
  method: 'PUT', headers: { Authorization: `Bearer ${login3.token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ accountId: animAcc.id, perms: [], superAdmin: false }),
});
ok('un super admin peut gérer les rôles (auto-rétrogradation acceptée)', r8.status === 200);
const r9 = await api('/api/admin/roles', 'PUT', { accountId: 1, perms: [], superAdmin: false });
ok('le compte fondateur est intouchable (anti-verrouillage)', !!r9.error);

// ---- nettoyage : rôles retirés, npcs.json restauré ----
await api('/api/admin/roles', 'PUT', { accountId: animAcc.id, perms: [] });
fs.writeFileSync(NPCS_PATH, npcsBackup);
boss.ws.close(); anim.ws.close();

const failed = checks.filter(([, c]) => !c);
console.log(failed.length ? `\n${failed.length} ÉCHEC(S)` : '\nTOUT EST OK');
process.exit(failed.length ? 1 : 0);
