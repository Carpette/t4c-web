// Test d'intégration de la Publication : historique des modifications de la
// Forge (sorts, retouches de carte), versions, annulation d'une modification,
// restauration d'une version, redémarrage programmé puis annulé, droits.
// À lancer sur une base FRAÎCHE (1er compte = super admin), serveur lancé à
// part avec T4C_OVERRIDES_DIR pointant sur un dossier jetable.
// Usage : node tools/test-publication.js [urlHttp=http://localhost:8090]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { PROTOCOL_VERSION } from '../shared/constants.js';

const BASE = process.argv[2] || 'http://localhost:8090';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SPELLS_PATH = path.join(ROOT, 'content', 'spells.json');
const spellsBackup = fs.readFileSync(SPELLS_PATH, 'utf8');
const checks = [];
const ok = (name, cond) => { checks.push([name, !!cond]); console.log(cond ? '  ✔' : '  ✘', name); };

// ---- client ws minimal : register, puis attente du welcome ----
function connect(name) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(BASE.replace('http', 'ws'));
    const c = { ws, name, inbox: [] };
    ws.on('message', (raw, bin) => {
      if (bin) return;
      const m = JSON.parse(raw.toString());
      c.inbox.push(m);
      if (m.t === 'create_char') ws.send(JSON.stringify({ t: 'create', stats: { str: 22, end: 18, agi: 14, int: 8, wis: 8 } }));
      if (m.t === 'welcome') resolve(c);
      if (m.t === 'auth_error') reject(new Error(m.error));
    });
    ws.on('open', () => ws.send(JSON.stringify({ t: 'register', v: PROTOCOL_VERSION, name, pass: 'test1234' })));
    setTimeout(() => reject(new Error('timeout connexion ' + name)), 8000);
  });
}
const jeton = async (name) => (await (await fetch(`${BASE}/api/admin/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, pass: 'test1234' }),
})).json()).token;
const appel = (tok) => async (url, method = 'GET', body = null) => {
  const r = await fetch(BASE + url, { method, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : null });
  return { status: r.status, ...(await r.json()) };
};

const boss = await connect('Pub_' + Math.floor(Math.random() * 1e6));
const api = appel(await jeton(boss.name));
const sorts = async () => (await api('/api/admin/content/spells')).spells;
const majSort = async (id, champs) => {
  const d = await api('/api/admin/content/spells');
  delete d.status;
  Object.assign(d.spells.find(s => s.id === id), champs);
  return api('/api/admin/content/spells', 'PUT', d);
};

// ---- 1. une modification est consignée, champ par champ ----
const s0 = (await sorts())[0];
const manaAvant = s0.mana;
await majSort(s0.id, { mana: manaAvant + 7 });
let pub = await api('/api/admin/publication');
const m1 = pub.modifications.find(m => m.fichier === 'spells');
ok('modification consignée avec son auteur', m1 && m1.auteur === boss.name);
ok(`ligne « ${s0.name} · mana ${manaAvant} → ${manaAvant + 7} »`,
  m1?.lignes.some(l => l.objet === s0.name && l.champ === 'mana' && l.avant === String(manaAvant) && l.apres === String(manaAvant + 7)));
ok('compteur de la barre latérale', (await api('/api/admin/publication/compte')).n === pub.modifications.length);

// ---- 2. version marquée, puis nouvelle modification ----
const v1 = await api('/api/admin/publication/version', 'POST', { note: 'Rééquilibrage' });
ok('version v1 marquée', v1.ok && v1.id >= 1);
ok('plus rien depuis la version', (await api('/api/admin/publication/compte')).n === 0);
ok('version vide refusée', (await api('/api/admin/publication/version', 'POST', {})).status === 400);
await majSort(s0.id, { mana: manaAvant + 20, level: (s0.level || 1) + 1 });
pub = await api('/api/admin/publication');
ok('historique : v1 avec sa note', pub.versions[0]?.note === 'Rééquilibrage' && pub.versions[0]?.n >= 1);

// ---- 3. annuler une modification : seules ses valeurs sont défaites ----
const m2 = pub.modifications.find(m => m.fichier === 'spells');
await majSort(s0.id, { level: 42 }); // modifiée depuis : conflit, gardée
const ann = await api(`/api/admin/publication/annuler/${m2.id}`, 'POST');
let s = (await sorts()).find(x => x.id === s0.id);
ok(`annulation partielle (${ann.conflits} conflit sur ${ann.total})`, ann.ok && ann.conflits === 1 && ann.total === 2);
ok('mana défait, niveau modifié depuis gardé', s.mana === manaAvant + 7 && s.level === 42);
ok('l’annulation est elle-même consignée', (await api('/api/admin/publication')).modifications[0].note?.startsWith('Annulation'));

// ---- 4. retouches de carte consignées, restauration d'une version ----
const ov = await api('/api/admin/overrides/0');
delete ov.status;
ov.music = [{ id: 'test_pub', shape: 'rect', x: 1, z: 1, w: 4, h: 4, track: { new: null, legacy: null }, priority: 0 }];
await api('/api/admin/overrides/0', 'PUT', ov);
ok('retouche de carte consignée', (await api('/api/admin/publication')).modifications.some(m => m.fichier === 'overrides_0'));
const res = await api(`/api/admin/publication/restaurer/${v1.id}`, 'POST');
s = (await sorts()).find(x => x.id === s0.id);
const ov2 = await api('/api/admin/overrides/0');
ok(`restauration de v1 (${res.fichiers} fichiers)`, res.ok && res.fichiers === 2);
ok('sort revenu à son état de v1', s.mana === manaAvant + 7 && s.level === s0.level);
ok('retouche de carte revenue à son état de v1', !(ov2.music || []).length);

// ---- 5. redémarrage programmé, annoncé, puis annulé ----
boss.inbox.length = 0;
const r = await api('/api/admin/publication/redemarrer', 'POST', { secondes: 600 });
ok('redémarrage programmé dans 10 min', r.ok && Math.abs(r.arret - Date.now() - 600e3) < 5e3);
await new Promise(t => setTimeout(t, 300));
ok('joueurs prévenus', boss.inbox.some(m => m.t === 'chat' && /ARRÊT DU SERVEUR DANS 10 MINUTES/.test(m.text)));
ok('second redémarrage refusé', (await api('/api/admin/publication/redemarrer', 'POST', { secondes: 60 })).status === 409);
ok('redémarrage annulé', (await api('/api/admin/publication/annuler-redemarrage', 'POST')).ok);
ok('plus d’arrêt prévu', (await api('/api/admin/publication')).arret === null);

// ---- 6. droits : l'option « Publier » est requise ----
const autre = await connect('Edi_' + Math.floor(Math.random() * 1e6));
const prof = await api('/api/admin/profils', 'POST', { nom: 'Éditeur ' + Date.now(), droits: { sorts: 2 } });
const acc = (await api('/api/admin/roles')).accounts.find(a => a.name === autre.name);
await api('/api/admin/roles', 'PUT', { accountId: acc.id, profilId: prof.id });
const api2 = appel(await jeton(autre.name));
ok('sans « Publier » : historique refusé', (await api2('/api/admin/publication')).status === 403);
await api('/api/admin/profils', 'PUT', { id: prof.id, nom: prof.nom || 'Éditeur', droits: { sorts: 2 }, publier: true });
ok('avec « Publier » : historique visible', (await api2('/api/admin/publication')).status === 200);

// ---- nettoyage ----
await api('/api/admin/roles', 'PUT', { accountId: acc.id, profilId: null });
await api('/api/admin/profils/' + prof.id, 'DELETE');
fs.writeFileSync(SPELLS_PATH, spellsBackup);
boss.ws.close(); autre.ws.close();

const failed = checks.filter(([, c]) => !c);
console.log(failed.length ? `\n${failed.length} ÉCHEC(S)` : '\nTOUT EST OK');
process.exit(failed.length ? 1 : 0);
