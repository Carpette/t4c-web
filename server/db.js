// Persistance SQLite : comptes + personnages (node:sqlite natif, Node >= 22.5)
import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASE_STATS } from '../shared/constants.js';

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
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS characters (
  account_id INTEGER PRIMARY KEY REFERENCES accounts(id),
  data TEXT NOT NULL
);
`);

function hashPassword(pass, salt) {
  return crypto.scryptSync(pass, salt, 32).toString('hex');
}

export function register(name, pass) {
  if (!/^[\p{L}\p{N}_-]{3,16}$/u.test(name)) return { error: 'Pseudo invalide (3-16 caractères, lettres/chiffres/_-)' };
  if (typeof pass !== 'string' || pass.length < 4) return { error: 'Mot de passe trop court (4 caractères min.)' };
  const exists = db.prepare('SELECT id FROM accounts WHERE name = ?').get(name);
  if (exists) return { error: 'Ce pseudo est déjà pris' };
  const salt = crypto.randomBytes(16).toString('hex');
  const info = db.prepare('INSERT INTO accounts (name, hash, salt, created_at) VALUES (?, ?, ?, ?)')
    .run(name, hashPassword(pass, salt), salt, Date.now());
  return { accountId: info.lastInsertRowid, name };
}

export function login(name, pass) {
  const acc = db.prepare('SELECT * FROM accounts WHERE name = ?').get(name);
  if (!acc) return { error: 'Compte inconnu' };
  const h = hashPassword(pass, acc.salt);
  if (!crypto.timingSafeEqual(Buffer.from(h), Buffer.from(acc.hash))) return { error: 'Mot de passe incorrect' };
  return { accountId: acc.id, name: acc.name };
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

export function newCharacterData(name, spawn) {
  return {
    name,
    level: 1, xp: 0, statPoints: 0,
    stats: { ...BASE_STATS },
    hp: null, mana: null, // null => max au premier chargement
    x: spawn.x, z: spawn.z,
    gold: 25,
    inventory: [], // [{iid, defId, q, bonus}]
    equip: {},     // slot -> iid
  };
}
