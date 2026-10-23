// Persistance SQLite : comptes + personnages (node:sqlite natif, Node >= 22.5)
import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASE_STATS } from '../shared/constants.js';
import { accesDe, nettoyerProfil, profilDepuisPerms, PROFILS_INITIAUX } from '../shared/acces.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.T4C_DB || path.join(__dirname, '..', 'game.db');
const db = new DatabaseSync(dbPath);
try { db.exec('PRAGMA journal_mode = WAL;'); } catch { /* WAL indisponible sur certains FS */ }

db.exec(`
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL COLLATE NOCASE,
  hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS characters (
  account_id INTEGER PRIMARY KEY REFERENCES accounts(id),
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS world_kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS deaths (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  level INTEGER NOT NULL,
  zone TEXT NOT NULL,
  killer TEXT NOT NULL,
  died_at INTEGER NOT NULL
);
`);
try { db.exec('ALTER TABLE accounts ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0'); } catch { /* déjà présente */ }
try { db.exec("ALTER TABLE accounts ADD COLUMN perms TEXT NOT NULL DEFAULT '[]'"); } catch { /* déjà présente */ }
// Profils d'accès à la console (cf. shared/acces.js) : un compte non super
// admin a au plus un profil ; sans profil, c'est un simple joueur.
db.exec(`CREATE TABLE IF NOT EXISTS profils (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nom TEXT UNIQUE NOT NULL COLLATE NOCASE,
  data TEXT NOT NULL
);`);
try { db.exec('ALTER TABLE accounts ADD COLUMN profil_id INTEGER'); } catch { /* déjà présente */ }
// sanctions : silence jusqu'à une date (ms), bannissement (connexion refusée)
try { db.exec('ALTER TABLE accounts ADD COLUMN muet_jusqua INTEGER NOT NULL DEFAULT 0'); } catch { /* déjà présente */ }
try { db.exec('ALTER TABLE accounts ADD COLUMN banni INTEGER NOT NULL DEFAULT 0'); } catch { /* déjà présente */ }
// Panthéon : compte, personnage à sa mort (restauration par un MJ), lieu
for (const col of ['account_id INTEGER', 'data TEXT', 'zone_id INTEGER', 'x REAL', 'z REAL', 'restored_at INTEGER']) {
  try { db.exec(`ALTER TABLE deaths ADD COLUMN ${col}`); } catch { /* déjà présente */ }
}

// Historique de la Forge : chaque écriture d'un fichier de contenu ou de
// retouches de carte (état avant / après, JSON compact), et les versions
// marquées depuis l'écran Publication (une version couvre les modifications
// jusqu'à `jusqua` inclus).
db.exec(`CREATE TABLE IF NOT EXISTS modifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  t INTEGER NOT NULL,
  auteur TEXT NOT NULL,
  fichier TEXT NOT NULL,
  avant TEXT,
  apres TEXT,
  note TEXT
);
CREATE TABLE IF NOT EXISTS versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  t INTEGER NOT NULL,
  auteur TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  jusqua INTEGER NOT NULL
);`);
{
  // base neuve : profils proposés par défaut
  if (db.prepare('SELECT COUNT(*) AS n FROM profils').get().n === 0) {
    for (const p of PROFILS_INITIAUX) creerProfil(p);
  }
  // migration : les anciennes permissions par compte deviennent un profil
  // équivalent (un profil par combinaison), puis sont vidées
  const anciens = db.prepare("SELECT id, perms FROM accounts WHERE profil_id IS NULL AND perms <> '[]'").all();
  const parCombinaison = new Map();
  for (const a of anciens) {
    const perms = parsePerms(a.perms).sort();
    if (!perms.length) continue;
    const cle = perms.join(', ');
    if (!parCombinaison.has(cle)) parCombinaison.set(cle, creerProfil({ nom: `Animateur (${cle})`, ...profilDepuisPerms(perms) }));
    db.prepare("UPDATE accounts SET profil_id = ?, perms = '[]' WHERE id = ?").run(parCombinaison.get(cle), a.id);
  }
}
// Auto-réparation : s'il existe des comptes mais aucun administrateur
// (base créée avant la fonctionnalité admin), promeut le plus ancien.
{
  const hasAdmin = db.prepare('SELECT COUNT(*) AS n FROM accounts WHERE is_admin = 1').get().n > 0;
  const hasAccounts = db.prepare('SELECT COUNT(*) AS n FROM accounts').get().n > 0;
  if (!hasAdmin && hasAccounts) {
    db.prepare('UPDATE accounts SET is_admin = 1 WHERE id = (SELECT MIN(id) FROM accounts)').run();
  }
}

function hashPassword(pass, salt) {
  return crypto.scryptSync(pass, salt, 32).toString('hex');
}

export function register(name, pass) {
  if (!/^[\p{L}\p{N}_-]{3,16}$/u.test(name)) return { error: 'Pseudo invalide (3-16 caractères, lettres/chiffres/_-)' };
  if (typeof pass !== 'string' || pass.length < 4) return { error: 'Mot de passe trop court (4 caractères min.)' };
  const exists = db.prepare('SELECT id FROM accounts WHERE name = ?').get(name);
  if (exists) return { error: 'Ce pseudo est déjà pris' };
  const salt = crypto.randomBytes(16).toString('hex');
  // le tout premier compte créé est administrateur
  const isFirst = db.prepare('SELECT COUNT(*) AS n FROM accounts').get().n === 0;
  const info = db.prepare('INSERT INTO accounts (name, hash, salt, created_at, is_admin) VALUES (?, ?, ?, ?, ?)')
    .run(name, hashPassword(pass, salt), salt, Date.now(), isFirst ? 1 : 0);
  return { accountId: info.lastInsertRowid, name, isAdmin: isFirst, acces: accesDe(isFirst, null) };
}

export function login(name, pass) {
  const acc = db.prepare('SELECT * FROM accounts WHERE name = ?').get(name);
  if (!acc) return { error: 'Compte inconnu' };
  const h = hashPassword(pass, acc.salt);
  if (!crypto.timingSafeEqual(Buffer.from(h), Buffer.from(acc.hash))) return { error: 'Mot de passe incorrect' };
  if (acc.banni) return { error: 'Ce compte est banni.' };
  return { accountId: acc.id, name: acc.name, isAdmin: !!acc.is_admin, acces: getAcces(acc.id), muetJusqua: acc.muet_jusqua || 0 };
}

export function deleteCharacter(accountId) {
  db.prepare('DELETE FROM characters WHERE account_id = ?').run(accountId);
}

export function recordDeath(name, level, zone, killer, { accountId = null, data = null, lieu = null } = {}) {
  db.prepare(`INSERT INTO deaths (name, level, zone, killer, died_at, account_id, data, zone_id, x, z)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(name, level, zone, killer, Date.now(), accountId, data && JSON.stringify(data),
      lieu?.zoneId ?? null, lieu?.x ?? null, lieu?.z ?? null);
}

// Panthéon de la console : lieu de la mort et restauration possible
export function pantheonAdmin(limit = 100) {
  return db.prepare(`SELECT id, name, level, zone, killer, died_at, account_id AS accountId, zone_id AS zoneId, x, z,
                     restored_at AS restaureLe, data IS NOT NULL AS restaurable
                     FROM deaths ORDER BY died_at DESC LIMIT ?`).all(limit)
    .map(d => ({ ...d, restaurable: !!d.restaurable }));
}
export function getDeath(id) {
  return db.prepare('SELECT * FROM deaths WHERE id = ?').get(id);
}
export function marquerRestauree(id) {
  db.prepare('UPDATE deaths SET restored_at = ? WHERE id = ?').run(Date.now(), id);
}

export function pantheon(limit = 10) {
  return db.prepare('SELECT name, level, zone, killer, died_at FROM deaths ORDER BY died_at DESC LIMIT ?').all(limit);
}

// --- pour l'administration ---
export function listCharacters() {
  return db.prepare(`SELECT a.id, a.name, a.is_admin, c.data FROM accounts a
                     LEFT JOIN characters c ON c.account_id = a.id`).all();
}
function parsePerms(raw) {
  try { const a = JSON.parse(raw || '[]'); return Array.isArray(a) ? a.filter(x => typeof x === 'string') : []; }
  catch { return []; }
}

// ---- profils d'accès ----
function lireProfil(row) {
  if (!row) return null;
  let data = {};
  try { data = JSON.parse(row.data) || {}; } catch { /* profil illisible : aucun droit */ }
  return { id: row.id, ...nettoyerProfil({ ...data, nom: row.nom }) };
}
export function listProfils() {
  return db.prepare('SELECT * FROM profils ORDER BY id').all().map(lireProfil);
}
export function getProfil(id) {
  return lireProfil(db.prepare('SELECT * FROM profils WHERE id = ?').get(id));
}
// renvoie l'id ; nom déjà pris -> exception (contrainte UNIQUE)
export function creerProfil(p) {
  const { nom, ...data } = nettoyerProfil(p);
  return Number(db.prepare('INSERT INTO profils (nom, data) VALUES (?, ?)').run(nom, JSON.stringify(data)).lastInsertRowid);
}
export function majProfil(id, p) {
  const { nom, ...data } = nettoyerProfil(p);
  db.prepare('UPDATE profils SET nom = ?, data = ? WHERE id = ?').run(nom, JSON.stringify(data), id);
}
export function supprimerProfil(id) {
  db.prepare('DELETE FROM profils WHERE id = ?').run(id);
}
export function setProfil(accountId, profilId) {
  db.prepare('UPDATE accounts SET profil_id = ? WHERE id = ?').run(profilId ?? null, accountId);
}
export function comptesDuProfil(profilId) {
  return db.prepare('SELECT id FROM accounts WHERE profil_id = ? AND is_admin = 0').all(profilId).map(r => r.id);
}

// accès effectif d'un compte (voir shared/acces.js)
export function getAcces(accountId) {
  const acc = db.prepare('SELECT is_admin, profil_id FROM accounts WHERE id = ?').get(accountId);
  if (!acc) return accesDe(false, null);
  return accesDe(!!acc.is_admin, acc.is_admin ? null : getProfil(acc.profil_id));
}

export function listAccounts() {
  return db.prepare('SELECT id, name, is_admin, profil_id, created_at, banni, muet_jusqua FROM accounts ORDER BY id').all()
    .map(a => ({ id: a.id, name: a.name, isAdmin: !!a.is_admin, profilId: a.is_admin ? null : a.profil_id ?? null, createdAt: a.created_at,
      banni: !!a.banni, muetJusqua: a.muet_jusqua || 0 }));
}

// ---- sanctions ----
export function setMuet(accountId, jusqua) {
  db.prepare('UPDATE accounts SET muet_jusqua = ? WHERE id = ?').run(Math.max(0, Math.round(jusqua)), accountId);
}
// ---- historique de la Forge ----
export function ajouterModification(fichier, avant, apres, auteur, note = null) {
  return Number(db.prepare('INSERT INTO modifications (t, auteur, fichier, avant, apres, note) VALUES (?, ?, ?, ?, ?, ?)')
    .run(Date.now(), auteur, fichier, avant, apres, note).lastInsertRowid);
}
export function getModification(id) {
  return db.prepare('SELECT * FROM modifications WHERE id = ?').get(id) || null;
}
export function modificationsApres(id) {
  return db.prepare('SELECT * FROM modifications WHERE id > ? ORDER BY id').all(id);
}
export function compterModificationsApres(id) {
  return db.prepare('SELECT COUNT(*) AS n FROM modifications WHERE id > ?').get(id).n;
}
export function derniereModification() {
  return db.prepare('SELECT COALESCE(MAX(id), 0) AS n FROM modifications').get().n;
}
export function listVersions() {
  return db.prepare(`SELECT v.*, (SELECT COUNT(*) FROM modifications m WHERE m.id <= v.jusqua
      AND m.id > COALESCE((SELECT MAX(p.jusqua) FROM versions p WHERE p.id < v.id), 0)) AS n
    FROM versions v ORDER BY v.id DESC`).all();
}
export function getVersion(id) {
  return db.prepare('SELECT * FROM versions WHERE id = ?').get(id) || null;
}
export function creerVersion(auteur, note, jusqua) {
  return Number(db.prepare('INSERT INTO versions (t, auteur, note, jusqua) VALUES (?, ?, ?, ?)').run(Date.now(), auteur, note, jusqua).lastInsertRowid);
}
// modifications couvertes par une version : après la précédente, jusqu'à la sienne
export function modificationsDeVersion(v) {
  const debut = db.prepare('SELECT COALESCE(MAX(jusqua), 0) AS n FROM versions WHERE id < ?').get(v.id).n;
  return db.prepare('SELECT * FROM modifications WHERE id > ? AND id <= ? ORDER BY id').all(debut, v.jusqua);
}
export function jusquaDerniereVersion() {
  return db.prepare('SELECT COALESCE(MAX(jusqua), 0) AS n FROM versions').get().n;
}
// état d'un fichier tel qu'à la fin de la modification `jusqua` : l'« avant »
// de sa première modification ultérieure (undefined = jamais touché depuis)
export function etatFichierA(fichier, jusqua) {
  const r = db.prepare('SELECT avant FROM modifications WHERE fichier = ? AND id > ? ORDER BY id LIMIT 1').get(fichier, jusqua);
  return r ? r.avant : undefined;
}
// dernier état écrit d'un fichier (texte JSON), null s'il a été supprimé
export function dernierEtatFichier(fichier) {
  const r = db.prepare('SELECT apres FROM modifications WHERE fichier = ? ORDER BY id DESC LIMIT 1').get(fichier);
  return r ? r.apres : null;
}
export function fichiersModifiesApres(jusqua) {
  return db.prepare('SELECT DISTINCT fichier FROM modifications WHERE id > ?').all(jusqua).map(r => r.fichier);
}

export function setBanni(accountId, banni) {
  db.prepare('UPDATE accounts SET banni = ? WHERE id = ?').run(banni ? 1 : 0, accountId);
}

// état du monde persistant (ex. prochaine venue d'un boss de zone)
export function getKV(key) {
  return db.prepare('SELECT value FROM world_kv WHERE key = ?').get(key)?.value ?? null;
}
export function setKV(key, value) {
  db.prepare('INSERT INTO world_kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, String(value));
}

export function setAdmin(accountId, val) {
  db.prepare('UPDATE accounts SET is_admin = ? WHERE id = ?').run(val ? 1 : 0, accountId);
}

export function getAccountById(accountId) {
  return db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId);
}

export function loadCharacter(accountId) {
  const row = db.prepare('SELECT data FROM characters WHERE account_id = ?').get(accountId);
  if (!row) return null;
  try { return JSON.parse(row.data); } catch { return null; }
}

export function saveCharacter(accountId, data) {
  db.prepare(`INSERT INTO characters (account_id, data) VALUES (?, ?)
              ON CONFLICT(account_id) DO UPDATE SET data = excluded.data`)
    .run(accountId, JSON.stringify(data));
}

export function newCharacterData(name, spawn, stats = null, sex = 'male') {
  // équipement de départ : poignard rouillé et veste en toile (T4C), deux potions
  const inventory = [
    { iid: 1, defId: 'poignard_rouille', q: 0, z: 0, bonus: {} },
    { iid: 2, defId: 'veste_toile', q: 0, z: 0, bonus: {} },
    { iid: 3, defId: 'potion_vie', q: 0, z: 0, bonus: {} },
    { iid: 4, defId: 'potion_vie', q: 0, z: 0, bonus: {} },
  ];
  return {
    name,
    sex: sex === 'female' ? 'female' : 'male',
    level: 1, xp: 0, statPoints: 0, skillPoints: 0,
    stats: stats ? { ...stats } : { ...BASE_STATS },
    hp: null, mana: null, // null => max au premier chargement
    x: spawn.x, z: spawn.z,
    gold: parseInt(process.env.T4C_START_GOLD || '25', 10),
    inventory,
    bank: [], // coffre personnel : perdu avec le personnage à la mort définitive
    equip: { weapon: 1, armor: 2 },
    zoneId: 0,
    unlocked: [0],
    spells: [],    // ids de sorts appris
    skills: [],    // ids de compétences apprises
    flags: {},     // drapeaux de quête posés par les dialogues de PNJ
    trialFor: null, // zone cible si le joueur est piégé dans une Épreuve
  };
}
