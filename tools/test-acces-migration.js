// Migration des anciennes permissions par compte vers les profils d'accès :
// une base « d'avant » (colonne perms) est ouverte par server/db.js, qui doit
// créer un profil par combinaison et garder des droits équivalents.
// Autonome : base jetable dans le dossier temporaire, pas de serveur.
// Usage : node tools/test-acces-migration.js
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't4c-migr-'));
const file = path.join(dir, 'ancienne.db');
const old = new DatabaseSync(file);
old.exec(`CREATE TABLE accounts (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL COLLATE NOCASE,
  hash TEXT NOT NULL, salt TEXT NOT NULL, created_at INTEGER NOT NULL, is_admin INTEGER NOT NULL DEFAULT 0,
  perms TEXT NOT NULL DEFAULT '[]')`);
const ins = old.prepare('INSERT INTO accounts (name, hash, salt, created_at, is_admin, perms) VALUES (?, ?, ?, 0, ?, ?)');
ins.run('Fondateur', 'x', 'x', 1, '[]');
ins.run('Anim1', 'x', 'x', 0, '["spawn","map"]');
ins.run('Anim2', 'x', 'x', 0, '["map","spawn"]');
ins.run('Modo', 'x', 'x', 0, '["players","roles"]');
ins.run('Joueur', 'x', 'x', 0, '[]');
old.close();

process.env.T4C_DB = file;
const db = await import('../server/db.js');
const checks = [];
const ok = (n, c) => { checks.push(!!c); console.log(c ? '  ✔' : '  ✘', n); };
const comptes = Object.fromEntries(db.listAccounts().map(a => [a.name, a]));
const acces = (n) => db.getAcces(comptes[n].id);
ok('même combinaison (ordre indifférent) : un seul profil', comptes.Anim1.profilId && comptes.Anim1.profilId === comptes.Anim2.profilId);
ok('spawn + map : invocation et zones en édition, animer', acces('Anim1').droits.invocation === 2 && acces('Anim1').droits.zones === 2 && acces('Anim1').animer);
ok('players + roles : joueurs et sanctions en édition, accès en lecture', acces('Modo').droits.joueurs === 2 && acces('Modo').droits.sanctions === 2 && acces('Modo').droits.acces === 1);
ok('joueur sans permission : sans profil', comptes.Joueur.profilId === null && !Object.keys(acces('Joueur').droits).length);
ok('super admin intact', acces('Fondateur').superAdmin);
ok('profils initiaux + 2 migrés', db.listProfils().length === 4);
fs.rmSync(dir, { recursive: true, force: true });
const ko = checks.filter(c => !c).length;
console.log(ko ? `\n${ko} ÉCHEC(S)` : '\nTOUT EST OK');
process.exit(ko ? 1 : 0);
