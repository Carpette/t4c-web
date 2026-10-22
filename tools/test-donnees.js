// Données d'instance et mises à jour de la base (server/donnees.js), SANS
// serveur : règle de mise à jour élément par élément, puis cycle complet sur
// un dossier de données temporaire (premier démarrage, mise à jour de la
// base, rétablissement depuis l'historique de la Forge).
// Usage : node tools/test-donnees.js
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mettreAJour } from '../server/donnees.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const ok = (label, cond) => { console.log(`  ${cond ? '✔' : '✘'} ${label}`); if (!cond) failures.push(label); };
const clone = (v) => JSON.parse(JSON.stringify(v));

// ---------- règle : un élément inchangé suit la base, un élément modifié reste ----------
{
  const ancienne = { mobs: { orc: { hp: 10 }, loup: { hp: 5 }, rat: { hp: 1 } }, spells: [{ id: 'feu', dmg: 3 }, { id: 'eau', dmg: 2 }] };
  const neuve = { mobs: { orc: { hp: 12 }, loup: { hp: 6 }, ogre: { hp: 40 } }, spells: [{ id: 'feu', dmg: 4 }, { id: 'eau', dmg: 5 }] };
  const local = { valeur: clone(ancienne) };
  local.valeur.mobs.loup.hp = 7;                 // modifié par l'instance
  local.valeur.spells[1].nom = 'Eau du village'; // idem, autre champ que la base
  local.valeur.mobs.liche = { hp: 99 };          // créé par l'instance
  const r = mettreAJour('creatures', ancienne, neuve, local);
  const v = local.valeur;
  ok('élément inchangé : suit la base (orc 10 -> 12)', v.mobs.orc.hp === 12);
  ok('élément modifié par l\'instance : n\'évolue plus (loup reste à 7)', v.mobs.loup.hp === 7);
  ok('élément ajouté par la base : arrive (ogre)', v.mobs.ogre?.hp === 40);
  ok('élément supprimé par la base et intact ici : supprimé (rat)', !('rat' in v.mobs));
  ok('élément créé par l\'instance : conservé (liche)', v.mobs.liche?.hp === 99);
  ok('liste à id : sort intact mis à jour (feu 3 -> 4)', v.spells.find(s => s.id === 'feu').dmg === 4);
  ok('liste à id : sort retouché ici conservé en entier (eau reste à 2)', v.spells.find(s => s.id === 'eau').dmg === 2);
  ok('rapport : 4 mis à jour, 2 conservés', r.appliques.length === 4 && r.gardes.length === 2);

  // une carte de zone est un tout : retouchée ici, elle ne suit plus la base
  const carte = { tiles: [[1, 1, 2]], props: { add: [], remove: [] } };
  const carteNeuve = { tiles: [[1, 1, 3]], props: { add: [{ type: 'tree', x: 4, z: 4 }], remove: [] } };
  const intacte = { valeur: clone(carte) };
  mettreAJour('overrides_0', carte, carteNeuve, intacte);
  ok('carte intacte : remplacée par la nouvelle base', JSON.stringify(intacte.valeur) === JSON.stringify(carteNeuve));
  const retouchee = { valeur: clone(carte) };
  retouchee.valeur.props.remove.push([10, 10]); // bâtiment supprimé sur ce serveur
  mettreAJour('overrides_0', carte, carteNeuve, retouchee);
  ok('carte retouchée : la ville de ce serveur est gardée telle quelle',
    retouchee.valeur.tiles[0][2] === 2 && retouchee.valeur.props.remove.length === 1 && !retouchee.valeur.props.add.length);
}

// ---------- cycle complet sur un dossier de données temporaire ----------
const demarrer = (data, db) => execFileSync(process.execPath, ['-e', "await import('./server/content.js')"],
  { cwd: ROOT, env: { ...process.env, T4C_DATA_DIR: data, T4C_DB: db }, encoding: 'utf8' });
const lire = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 't4c-donnees-'));
try {
  const data = path.join(tmp, 'data'), db = path.join(tmp, 'game.db');
  demarrer(data, db);
  const base = lire(path.join(ROOT, 'content', 'spells.json'));
  ok('premier démarrage : contenu de l\'instance initialisé depuis la base',
    JSON.stringify(lire(path.join(data, 'content', 'spells.json'))) === JSON.stringify(base));
  ok('premier démarrage : manifeste de l\'instance initialisé', fs.existsSync(path.join(data, 'assets', 'manifest.json')));

  // on simule une base PRÉCÉDENTE où deux sorts s'appelaient autrement ; le
  // serveur avait renommé le second de son côté
  const [s0, s1] = base.spells;
  const ancienne = clone(base);
  ancienne.spells[0].name = 'Ancien nom 0';
  ancienne.spells[1].name = 'Ancien nom 1';
  fs.writeFileSync(path.join(data, 'base', 'content', 'spells.json'), JSON.stringify(ancienne));
  const local = clone(ancienne);
  local.spells[1].name = 'Nom choisi par ce serveur';
  fs.writeFileSync(path.join(data, 'content', 'spells.json'), JSON.stringify(local, null, 2));
  const sortie = demarrer(data, db);
  const apres = lire(path.join(data, 'content', 'spells.json'));
  ok(`mise à jour : sort intact renommé par la base (${s0.id})`, apres.spells[0].name === s0.name);
  ok(`mise à jour : sort renommé par ce serveur conservé (${s1.id})`, apres.spells[1].name === 'Nom choisi par ce serveur');
  ok('mise à jour : référence avancée à la nouvelle base',
    JSON.stringify(lire(path.join(data, 'base', 'content', 'spells.json'))) === JSON.stringify(base));
  ok('mise à jour : rapport au démarrage', /spells : 1 mis à jour, 1 conservé/.test(sortie));
  const journal = execFileSync(process.execPath, ['-e',
    "const db = await import('./server/db.js'); const m = db.getModification(db.derniereModification()); console.log(JSON.stringify({ f: m.fichier, a: m.auteur, n: m.note }))"],
  { cwd: ROOT, env: { ...process.env, T4C_DB: db }, encoding: 'utf8' });
  const m = JSON.parse(journal.trim().split('\n').pop());
  ok('mise à jour : consignée dans l\'historique de la Forge (annulable)', m.f === 'spells' && m.a === 'mise à jour de la base' && /conservés/.test(m.n));
  const sortie2 = demarrer(data, db);
  ok('redémarrage sans nouvelle base : rien n\'est touché', !/spells/.test(sortie2)
    && lire(path.join(data, 'content', 'spells.json')).spells[1].name === 'Nom choisi par ce serveur');

  // instance dont la Forge écrivait dans l'image (perdu au redéploiement) :
  // l'historique en base rétablit ses fichiers au premier démarrage
  const data2 = path.join(tmp, 'data2'), db2 = path.join(tmp, 'game2.db');
  const ov = { tiles: [[3, 3, 5]], props: { add: [], remove: [[12, 14]] } };
  execFileSync(process.execPath, ['-e',
    `const db = await import('./server/db.js'); db.ajouterModification('overrides_3', null, ${JSON.stringify(JSON.stringify(ov))}, 'mj', null);`],
  { cwd: ROOT, env: { ...process.env, T4C_DB: db2 }, encoding: 'utf8' });
  demarrer(data2, db2);
  ok('premier démarrage : carte retouchée rétablie depuis l\'historique',
    JSON.stringify(lire(path.join(data2, 'content', 'overrides_3.json'))) === JSON.stringify(ov));
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(failures.length ? `\n${failures.length} ÉCHEC(S)` : '\nDONNÉES OK');
process.exit(failures.length ? 1 : 0);
