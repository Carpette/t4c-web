// Données vivantes d'une instance et mises à jour de la base livrée.
//
// Le dépôt (l'image Docker) livre une BASE : contenu du jeu (content/*.json)
// et ressources graphiques (client/assets). Chaque serveur fait ensuite vivre
// son monde dans la Forge : ses villes, ses monstres, ses PNJ, son histoire.
// Avec T4C_DATA_DIR (l'image le fixe à /data, le volume persistant), tout ce
// que la Forge écrit va dans ce dossier, jamais dans l'image :
//   <data>/content/   contenu du jeu de CETTE instance (+ retouches de carte)
//   <data>/assets/    ressources ajoutées ou remplacées par la Forge,
//                     servies en priorité sur celles de la base
//   <data>/base/      copie de la base telle qu'elle était livrée au dernier
//                     démarrage : la référence des mises à jour
//
// Règle de mise à jour, ÉLÉMENT par élément (une carte de zone, un monstre,
// un PNJ, un sort...) : un élément resté identique à l'ancienne base suit la
// nouvelle ; un élément modifié par l'instance lui appartient et n'évolue
// plus. Les mises à jour appliquées sont consignées dans l'historique de la
// Forge (onglet Publication), d'où elles s'annulent comme toute modification.
//
// Sans T4C_DATA_DIR (développement), rien ne change : la Forge écrit dans le
// dépôt, qui EST la base.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { differences, egal, lire, ecrire } from '../shared/diff.js';

const RACINE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BASE_CONTENT = path.join(RACINE, 'content');
export const BASE_ASSETS = path.join(RACINE, 'client', 'assets');
const DATA = process.env.T4C_DATA_DIR ? path.resolve(process.env.T4C_DATA_DIR) : null;

export const CONTENT_DIR = DATA ? path.join(DATA, 'content') : BASE_CONTENT;
// dossier où la Forge écrit ses ressources (lecture : cheminAsset)
export const ASSETS_ECRITURE = DATA ? path.join(DATA, 'assets') : BASE_ASSETS;
const REFERENCE = DATA ? path.join(DATA, 'base') : null;

// chemin relatif à client/assets, sans sortie du dossier (null si invalide)
function relSur(rel) {
  const r = path.normalize(String(rel || '')).replace(/^([/\\])+/, '');
  return !r || r.startsWith('..') || path.isAbsolute(r) ? null : r;
}
// fichier d'asset effectif : version de l'instance si elle existe, sinon base
export function cheminAsset(rel) {
  const r = relSur(rel);
  if (!r) return null;
  if (DATA) {
    const p = path.join(ASSETS_ECRITURE, r);
    if (fs.existsSync(p)) return p;
  }
  return path.join(BASE_ASSETS, r);
}
// chemin d'écriture d'un asset (dossiers créés)
export function cheminAssetEcriture(rel) {
  const r = relSur(rel);
  if (!r) throw new Error(`chemin invalide : ${rel}`);
  const p = path.join(ASSETS_ECRITURE, r);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  return p;
}
// fichiers d'un sous-dossier d'assets, base et instance réunies
export function listerAssets(sousDossier, filtre = () => true) {
  const noms = new Set();
  for (const racine of DATA ? [BASE_ASSETS, ASSETS_ECRITURE] : [BASE_ASSETS]) {
    try { for (const f of fs.readdirSync(path.join(racine, sousDossier))) if (filtre(f)) noms.add(f); } catch { /* absent */ }
  }
  return [...noms].sort();
}
export const lireManifeste = () => JSON.parse(fs.readFileSync(cheminAsset('manifest.json'), 'utf8'));
export function ecrireManifeste(m) { fs.writeFileSync(cheminAssetEcriture('manifest.json'), JSON.stringify(m)); }

// --- unités de mise à jour ---
// Le chemin d'une différence est ramené à l'élément du jeu qu'il touche :
// une carte de zone (overrides_<n>) est un tout ; ailleurs, l'élément est la
// première entrée identifiée (« #id » d'une liste) ou, dans un objet, l'entrée
// de second niveau (mobs.orc, npc.garde, tilesets.cave) ; les couches
// d'avatar du manifeste ont un niveau de plus (avatar.male.head_short).
function unite(fichier, chemin) {
  if (/^overrides_\d+$/.test(fichier)) return [];
  const i = chemin.findIndex(s => typeof s === 'string' && s.startsWith('#'));
  if (i >= 0) return chemin.slice(0, i + 1);
  const n = fichier === 'manifest' && chemin[0] === 'avatar' ? 3 : 2;
  return chemin.slice(0, n);
}

// Applique à `local` les changements de la base (ancienne -> neuve) sur les
// éléments que l'instance n'a pas modifiés. Rend { appliques, gardes } (listes
// de libellés d'éléments).
export function mettreAJour(fichier, ancienne, neuve, local) {
  const unites = new Map();
  for (const d of differences(ancienne, neuve, Infinity)) {
    const u = unite(fichier, d.chemin);
    unites.set(JSON.stringify(u), u);
  }
  const appliques = [], gardes = [];
  for (const u of unites.values()) {
    const nom = u.length ? u.map(s => String(s).replace(/^#/, '')).join('.') : fichier;
    if (!u.length) {
      // l'élément est le fichier entier (carte de zone)
      if (egal(local.valeur, ancienne)) { local.valeur = structuredClone(neuve); appliques.push(nom); } else gardes.push(nom);
      continue;
    }
    if (egal(lire(local.valeur, u), lire(ancienne, u))) {
      const v = lire(neuve, u);
      ecrire(local.valeur, u, v === undefined ? undefined : structuredClone(v));
      appliques.push(nom);
    } else gardes.push(nom);
  }
  return { appliques, gardes };
}

const lireJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const memeJson = (a, b) => egal(a, b);

// Synchronise l'instance avec la base livrée (au démarrage, avant le
// chargement du contenu). `db` : module de base de données (historique).
function synchroniser(db) {
  const premier = !fs.existsSync(CONTENT_DIR);
  for (const d of [CONTENT_DIR, ASSETS_ECRITURE, path.join(REFERENCE, 'content'), path.join(REFERENCE, 'assets')]) {
    fs.mkdirSync(d, { recursive: true });
  }
  const rapport = [];
  const fichiers = [
    ...fs.readdirSync(BASE_CONTENT).filter(f => f.endsWith('.json'))
      .map(f => ({ nom: f.slice(0, -5), base: path.join(BASE_CONTENT, f), local: path.join(CONTENT_DIR, f),
        ref: path.join(REFERENCE, 'content', f), joli: !f.startsWith('overrides_'), historique: true })),
    { nom: 'manifest', base: path.join(BASE_ASSETS, 'manifest.json'), local: path.join(ASSETS_ECRITURE, 'manifest.json'),
      ref: path.join(REFERENCE, 'assets', 'manifest.json'), joli: false, historique: false },
  ];
  const ecrireJson = (f, v, joli) => fs.writeFileSync(f, joli ? JSON.stringify(v, null, 2) : JSON.stringify(v));
  for (const f of fichiers) {
    let neuve;
    try { neuve = lireJson(f.base); } catch (e) { console.warn(`[données] base illisible ${f.base} : ${e.message}`); continue; }
    if (!fs.existsSync(f.local)) {
      ecrireJson(f.local, neuve, f.joli);
      ecrireJson(f.ref, neuve, f.joli);
      continue;
    }
    if (!fs.existsSync(f.ref)) { ecrireJson(f.ref, neuve, f.joli); continue; } // instance antérieure au mécanisme
    const ancienne = lireJson(f.ref);
    if (memeJson(ancienne, neuve)) continue;
    const avantTxt = fs.readFileSync(f.local, 'utf8');
    const local = { valeur: JSON.parse(avantTxt) };
    const { appliques, gardes } = mettreAJour(f.nom, ancienne, neuve, local);
    if (appliques.length) {
      ecrireJson(f.local, local.valeur, f.joli);
      if (f.historique) {
        const note = `Mise à jour de la base : ${appliques.length} élément(s) mis à jour`
          + (gardes.length ? ` ; ${gardes.length} élément(s) propres à ce serveur conservés (${gardes.slice(0, 12).join(', ')}${gardes.length > 12 ? '…' : ''})` : '');
        db.ajouterModification(f.nom, JSON.stringify(JSON.parse(avantTxt)), JSON.stringify(local.valeur), 'mise à jour de la base', note);
      }
    }
    ecrireJson(f.ref, neuve, f.joli);
    rapport.push(`${f.nom} : ${appliques.length} mis à jour, ${gardes.length} conservé(s)`);
  }
  // Premier démarrage avec ce dossier : les fichiers que la Forge avait
  // écrits ailleurs (dans l'image, perdus au redéploiement) sont rétablis
  // depuis l'historique en base, qui vit déjà sur le volume persistant.
  if (premier) {
    for (const nom of db.fichiersModifiesApres(0)) {
      if (!/^[\w-]+$/.test(nom)) continue;
      const apres = db.dernierEtatFichier(nom);
      if (apres == null) continue;
      const f = path.join(CONTENT_DIR, `${nom}.json`);
      const v = JSON.parse(apres);
      ecrireJson(f, v, !nom.startsWith('overrides_'));
      rapport.push(`${nom} : rétabli depuis l'historique de la Forge`);
    }
  }
  if (rapport.length) console.log(`[données] ${DATA}\n  ` + rapport.join('\n  '));
}

if (DATA) {
  const db = await import('./db.js');
  synchroniser(db);
}
