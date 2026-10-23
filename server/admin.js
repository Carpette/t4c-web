// API HTTP d'administration : contenu, cartes (overrides), personnages,
// panthéon, comptes et profils. Auth PAR PROFIL : un super admin (is_admin)
// accède à tout ; un autre compte n'accède qu'aux routes que son profil
// couvre, en lecture ou en édition (voir shared/acces.js).
// Auth : compte avec is_admin = 1 → token de session.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as db from './db.js';
import { content, saveContentFile, validerSurcharges, validerZones, consignerEcriture, journaliserEcritures } from './content.js';
import { buildEnemyEntry, pngSize } from './enemy-import.js';
import { src3dDisponible, listerModeles } from './src3d.js';
import { xpForLevel, maxHp, maxMana, POINTS_PER_LEVEL, SKILL_POINTS_PER_LEVEL, MAX_LEVEL, KIND } from '../shared/constants.js';
import { DROITS, OPTIONS, LECTURE, EDITION, niveau, aConsole, inclus, permsDe, accesDe, nettoyerProfil } from '../shared/acces.js';
import { differences, annulerDifferences, decrire, resume } from '../shared/diff.js';
import { CONTENT_DIR, cheminAsset, cheminAssetEcriture, listerAssets, lireManifeste, ecrireManifeste } from './donnees.js';

// historique de la Forge : chaque écriture de contenu est consignée en base
journaliserEcritures((fichier, avant, apres, auteur, note) => db.ajouterModification(fichier, avant, apres, auteur, note));
const tokens = new Map(); // token -> { accountId, expires }

// Dossier des overrides de carte (overrides_<zone>.json). Par défaut le dossier
// content/ ; T4C_OVERRIDES_DIR l'isole (les suites de test l'imposent pour ne
// PAS polluer — ni lire — les overrides locaux du dépôt).
const OVERRIDES_DIR = process.env.T4C_OVERRIDES_DIR || CONTENT_DIR;
try { fs.mkdirSync(OVERRIDES_DIR, { recursive: true }); } catch { /* déjà présent */ }

export function overridesPath(zoneId) {
  return path.join(OVERRIDES_DIR, `overrides_${zoneId}.json`);
}
export function loadOverrides(zoneId) {
  try { return JSON.parse(fs.readFileSync(overridesPath(zoneId), 'utf8')); } catch { return null; }
}
// révision des retouches d'une zone (date d'écriture du fichier, 0 sans
// retouche) : les vues ouvertes rechargent la carte quand elle change
export function revisionOverrides(zoneId) {
  try { return fs.statSync(overridesPath(zoneId)).mtimeMs; } catch { return 0; }
}
// écrit les retouches d'une zone en les consignant dans l'historique
export function ecrireOverrides(zoneId, ov, auteur = 'serveur', note = null) {
  let avant = null;
  try { avant = fs.readFileSync(overridesPath(zoneId), 'utf8'); } catch { /* aucune retouche */ }
  fs.writeFileSync(overridesPath(zoneId), JSON.stringify(ov));
  consignerEcriture(`overrides_${zoneId}`, avant, ov, auteur, note);
}

function readBody(req, max = 5e6) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > max) reject(new Error('trop gros')); });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

// nom de fichier sûr pour les téléversements (pas de traversée de chemin)
function safeName(name) {
  const clean = String(name || '').replace(/\.png$/i, '').replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 48);
  if (!clean) throw new Error('nom de fichier invalide');
  return clean;
}

// Normalise un template de l'éditeur (même forme que le presse-papier) :
// { id, name, w, h, tiles:[[dx,dz,tileId]...], props:[{type,dx,dz,v?,s?,rot?}...] }.
// Rejette (null) les entrées sans nom ou sans contenu valide.
function cleanTemplate(t) {
  if (!t || typeof t !== 'object') return null;
  const name = String(t.name || '').trim().slice(0, 60);
  if (!name) return null;
  const w = Math.max(1, Math.min(512, t.w | 0));
  const h = Math.max(1, Math.min(512, t.h | 0));
  const tiles = (Array.isArray(t.tiles) ? t.tiles : [])
    .filter(c => Array.isArray(c) && c.length === 3 && c.every(Number.isFinite))
    .map(([dx, dz, id]) => [dx | 0, dz | 0, id | 0]);
  const props = (Array.isArray(t.props) ? t.props : [])
    .filter(p => p && typeof p.type === 'string' && Number.isFinite(p.dx) && Number.isFinite(p.dz))
    .map(p => {
      const e = { type: p.type, dx: p.dx | 0, dz: p.dz | 0 };
      if (p.v != null) e.v = p.v;
      if (Number.isFinite(p.s) && p.s !== 1) e.s = p.s;
      if (Number.isFinite(p.rot) && p.rot) e.rot = p.rot;
      return e;
    });
  if (!tiles.length && !props.length) return null; // assemblage vide : ignoré
  const id = String(t.id || '').trim().slice(0, 48) || ('tpl_' + crypto.randomBytes(6).toString('hex'));
  return { id, name, w, h, tiles, props };
}

function auth(req) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const s = tokens.get(token);
  if (!s || s.expires < Date.now()) return null;
  return s;
}

export async function handleAdmin(req, res, url, game) {
  const json = (code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
  };
  try {
    // ---- login ----
    if (url === '/api/admin/login' && req.method === 'POST') {
      const { name, pass } = JSON.parse(await readBody(req));
      const r = db.login(name, pass);
      if (r.error) return json(401, { error: r.error });
      if (!aConsole(r.acces)) return json(403, { error: 'Ce compte n\'a aucun accès à la console' });
      const token = crypto.randomBytes(24).toString('hex');
      tokens.set(token, { accountId: r.accountId, expires: Date.now() + 24 * 3600e3 });
      return json(200, { token, name: r.name });
    }

    const session = auth(req);
    if (!session) return json(401, { error: 'Non authentifié' });

    // ---- contrôle d'accès : droit et niveau requis par route ----
    // Lecture pour un GET, édition sinon. Le contenu du jeu (GET content/*,
    // musiques, ressources) est lisible par tout compte de la console : les
    // éditeurs se croisent (PNJ -> sorts, carte -> PNJ) et ce contenu est de
    // toute façon servi aux joueurs. Route non listée : super admin.
    const acces = db.getAcces(session.accountId);
    const auteur = db.getAccountById(session.accountId)?.name || '?';
    if (!acces.superAdmin && !aConsole(acces)) return json(403, { error: 'Ce compte n\'a plus accès à la console' });
    const lecture = req.method === 'GET';
    const min = lecture ? LECTURE : EDITION;
    const CONTENU = { zones: 'zones', npcs: 'pnj', spells: 'sorts', skills: 'sorts', particles: 'sorts', creatures: 'creatures', objets: 'objets' };
    const mC = url.match(/^\/api\/admin\/content\/([a-z]+)$/);
    // [droits acceptés (l'un suffit), niveau] ; 'console' = tout compte de la console ; null = libre
    const requis =
      ['/api/admin/check-session', '/api/admin/me', '/api/admin/logout'].includes(url) ? null
        : mC ? (lecture ? 'console' : [[CONTENU[mC[1]] || '__super__'], EDITION])
        : url === '/api/admin/content' ? [['sorts'], EDITION]
        : /^\/api\/admin\/content\/[a-z]+\/reference$/.test(url) ? [['fichiers'], LECTURE]
        : /^\/api\/admin\/overrides\/\d+$/.test(url) ? (lecture ? [['zones', 'pnj_placement', 'zones_musicales', 'carte'], LECTURE] : [['zones', 'pnj_placement', 'zones_musicales'], EDITION])
        : url === '/api/admin/npcs/positions' ? [['pnj', 'pnj_placement'], LECTURE]
        : url === '/api/admin/objets/circulation' ? [['objets'], LECTURE]
        : url === '/api/admin/characters' || /^\/api\/admin\/character\/\d+$/.test(url) ? [['joueurs'], min]
        : url === '/api/admin/players' ? [['carte', 'joueurs'], LECTURE]
        : /^\/api\/admin\/monde\/zone\/\d+$/.test(url) || url === '/api/admin/monde/journal' ? [['carte'], LECTURE]
        : /^\/api\/admin\/monde\/joueur\/\d+$/.test(url) ? (lecture ? [['joueurs', 'sanctions'], LECTURE] : [['carte', 'joueurs', 'sanctions'], LECTURE])
        : /^\/api\/admin\/comptes\/\d+\/debannir$/.test(url) ? [['sanctions'], EDITION]
        : url === '/api/admin/teleport' ? 'animer'
        : url === '/api/admin/pantheon' ? [['pantheon'], LECTURE]
        : /^\/api\/admin\/pantheon\/\d+\/restaurer$/.test(url) ? [['joueurs'], EDITION]
        : url === '/api/admin/roles' || url === '/api/admin/profils' || /^\/api\/admin\/profils\/\d+$/.test(url) ? [['acces'], min]
        : url === '/api/admin/music' || url === '/api/admin/music/upload' ? (lecture ? 'console' : [['musiques'], EDITION])
        : url === '/api/admin/tiles' ? (lecture ? 'console' : [['bibliotheque', 'zones'], EDITION])
        : url === '/api/admin/templates' ? (lecture ? 'console' : [['zones'], EDITION])
        : url === '/api/admin/bibliotheque/remplacer' || url === '/api/admin/bibliotheque/dupliquer' ? [['bibliotheque'], EDITION]
        : ['/api/admin/skins', '/api/admin/skins/upload', '/api/admin/skins/enemy', '/api/admin/atelier', '/api/admin/src3d'].includes(url)
          ? (lecture ? 'console' : [['bibliotheque'], EDITION])
        : url.startsWith('/api/admin/publication') ? 'publier'
        : '__super__';
    const autorise = acces.superAdmin || requis === null || requis === 'console'
      || (requis === 'animer' && acces.animer) || (requis === 'publier' && acces.publier)
      || (Array.isArray(requis) && requis[0].some(d => niveau(acces, d) >= requis[1]));
    if (!autorise) return json(403, { error: 'Permission insuffisante pour cette action' });

    if (url === '/api/admin/check-session') {
      const account = db.getAccountById(session.accountId);
      return json(200, { name: account.name });
    }

    // déconnexion : le jeton est invalidé côté serveur (sinon il resterait
    // valable 24 h dans un cache navigateur, un historique, un proxy…)
    if (url === '/api/admin/logout' && req.method === 'POST') {
      const raw = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      tokens.delete(raw);
      return json(200, { ok: true });
    }

    // identité et droits effectifs de la session (l'admin web adapte son interface)
    if (url === '/api/admin/me') {
      const account = db.getAccountById(session.accountId);
      const profil = account.is_admin ? null : db.getProfil(account.profil_id);
      return json(200, { name: account.name, isAdmin: acces.superAdmin, profil: profil?.nom || null,
        droits: acces.droits, animer: acces.animer, publier: acces.publier, perms: permsDe(acces) });
    }

    // ---- comptes et profils ----
    // Garde-fous : un compte qui n'est pas super admin ne touche ni aux super
    // admins ni à son propre compte, et n'accorde jamais plus que ses droits.
    const depasse = (profil) => !inclus(accesDe(false, profil), acces);
    const appliquerProfil = (profilId) => {
      for (const id of db.comptesDuProfil(profilId)) game.majAcces(id, db.getAcces(id), false);
    };
    if (url === '/api/admin/roles' && req.method === 'GET') {
      return json(200, { accounts: db.listAccounts(), profils: db.listProfils(), droits: DROITS, options: OPTIONS, moi: session.accountId });
    }
    if (url === '/api/admin/roles' && req.method === 'PUT') {
      const { accountId, profilId, superAdmin } = JSON.parse(await readBody(req));
      const target = db.getAccountById(accountId | 0);
      if (!target) return json(404, { error: 'Compte inconnu' });
      if (!acces.superAdmin) {
        if (target.is_admin || typeof superAdmin === 'boolean') return json(403, { error: 'Réservé aux super admins' });
        if (target.id === session.accountId) return json(403, { error: 'Vous ne pouvez pas changer votre propre profil' });
      }
      // le compte fondateur (n°1) est intouchable : il y a TOUJOURS au moins
      // un super admin, personne ne peut verrouiller le serveur
      if (target.id === 1 && superAdmin === false) {
        return json(400, { error: 'Le compte fondateur reste super admin (anti-verrouillage)' });
      }
      if (typeof superAdmin === 'boolean' && target.id !== 1) db.setAdmin(target.id, superAdmin ? 1 : 0);
      if (profilId !== undefined) {
        const profil = profilId == null ? null : db.getProfil(profilId | 0);
        if (profilId != null && !profil) return json(404, { error: 'Profil inconnu' });
        if (profil && depasse(profil)) return json(403, { error: 'Ce profil dépasse vos propres droits' });
        db.setProfil(target.id, profil?.id ?? null);
      }
      const t = db.getAccountById(target.id);
      game.majAcces(t.id, db.getAcces(t.id), !!t.is_admin);
      return json(200, { ok: true, superAdmin: !!t.is_admin, profilId: t.is_admin ? null : t.profil_id ?? null });
    }
    if (url === '/api/admin/profils' && (req.method === 'POST' || req.method === 'PUT')) {
      const p = JSON.parse(await readBody(req));
      const propre = nettoyerProfil(p);
      if (!propre.nom) return json(400, { error: 'Donnez un nom au profil' });
      if (depasse(propre)) return json(403, { error: 'Ce profil dépasse vos propres droits' });
      if (req.method === 'PUT') {
        const ancien = db.getProfil(p.id | 0);
        if (!ancien) return json(404, { error: 'Profil inconnu' });
        if (depasse(ancien)) return json(403, { error: 'Ce profil dépasse vos propres droits : modification réservée' });
      }
      try {
        const id = req.method === 'POST' ? db.creerProfil(propre) : (db.majProfil(p.id | 0, propre), p.id | 0);
        appliquerProfil(id);
        return json(200, { ok: true, id });
      } catch (e) {
        if (/UNIQUE/.test(e.message)) return json(409, { error: `Le profil « ${propre.nom} » existe déjà` });
        throw e;
      }
    }
    const mProfil = url.match(/^\/api\/admin\/profils\/(\d+)$/);
    if (mProfil && req.method === 'DELETE') {
      const id = mProfil[1] | 0, profil = db.getProfil(id);
      if (!profil) return json(404, { error: 'Profil inconnu' });
      if (depasse(profil)) return json(403, { error: 'Ce profil dépasse vos propres droits' });
      const n = db.comptesDuProfil(id).length;
      if (n) return json(409, { error: `Encore attribué à ${n} compte${n > 1 ? 's' : ''}` });
      db.supprimerProfil(id);
      return json(200, { ok: true });
    }

    // ---- contenu (générique, pour les anciens clients) ----
    if (url === '/api/admin/content' && req.method === 'POST') {
      const { name, data } = JSON.parse(await readBody(req));
      if (name === 'spells') {
        saveContentFile(name, data, auteur);
        return json(200, { ok: true, note: 'Appliqué à chaud.' });
      }
    }

    // ---- état d'un fichier de contenu à la dernière version marquée ----
    // (Fichiers bruts, vue « Différences ») ; sans version, l'état d'avant
    // la première modification consignée
    const mRef = url.match(/^\/api\/admin\/content\/(zones|npcs|spells|skills|particles|creatures|objets)\/reference$/);
    if (mRef && req.method === 'GET') {
      const jusqua = db.jusquaDerniereVersion();
      const v = db.listVersions()[0] || null;
      const t = db.etatFichierA(mRef[1], jusqua);
      return json(200, { version: v && { id: v.id, t: v.t, note: v.note }, inchange: t === undefined, contenu: t == null ? null : JSON.parse(t) });
    }

    // ---- contenu (zones / npcs / sorts / compétences / particules) ----
    const mContent = url.match(/^\/api\/admin\/content\/(zones|npcs|spells|skills|particles|creatures|objets)$/);
    if (mContent) {
      const name = mContent[1];
      // créatures / objets : surcharges validées, puis appliquées à chaud (prochaines apparitions)
      if (['creatures', 'objets'].includes(name)) {
        if (req.method === 'GET') return json(200, name === 'creatures' ? content.creatures : content.objets);
        if (req.method === 'PUT') {
          const data = JSON.parse(await readBody(req));
          const erreurs = validerSurcharges(name, data);
          if (erreurs.length) return json(400, { error: erreurs.slice(0, 8).join(' ; '), erreurs });
          saveContentFile(name, data, auteur);
          return json(200, { ok: true, note: 'Appliqué à chaud : prochaines apparitions et prochains objets générés. Les joueurs rechargent (F5) pour voir noms et apparences.' });
        }
      }
      if (req.method === 'GET') {
        return json(200, JSON.parse(fs.readFileSync(path.join(CONTENT_DIR, `${name}.json`), 'utf8')));
      }
      if (req.method === 'PUT' || (['spells', 'particles'].includes(name) && req.method === 'POST')) {
        const data = JSON.parse(await readBody(req)); // valide le JSON
        if (name === 'zones') {
          const erreurs = validerZones(data);
          if (erreurs.length) return json(400, { error: erreurs.slice(0, 8).join(' ; '), erreurs });
        }
        saveContentFile(name, data, auteur);
        // PNJ en jeu : ils pointent sur l'ancienne définition, on les recrée
        if (name === 'npcs') game.refreshNpcs();
        return json(200, { ok: true, note: name === 'zones' ? 'Redémarrage du serveur requis pour les seeds/zones.' : 'Appliqué à chaud.' });
      }
    }

    // ---- overrides de carte ----
    const mOv = url.match(/^\/api\/admin\/overrides\/(\d+)$/);
    if (mOv) {
      const zoneId = parseInt(mOv[1], 10);
      if (req.method === 'GET') return json(200, loadOverrides(zoneId) || { tiles: [], props: { add: [], remove: [] } });
      if (req.method === 'PUT') {
        const ov = JSON.parse(await readBody(req));
        // chaque partie modifiée exige l'édition de son droit : placement des
        // PNJ, zones musicales, le reste relève de Zones et terrain
        if (!acces.superAdmin) {
          const avant = loadOverrides(zoneId) || {};
          const DROIT_OV = { npcs: 'pnj_placement', music: 'zones_musicales' };
          for (const k of new Set([...Object.keys(avant), ...Object.keys(ov || {})])) {
            if (JSON.stringify(avant[k] ?? null) === JSON.stringify(ov?.[k] ?? null)) continue;
            const d = DROIT_OV[k] || 'zones';
            if (niveau(acces, d) < EDITION) return json(403, { error: `Permission insuffisante : ${DROITS.find(x => x.id === d).nom}` });
          }
        }
        ecrireOverrides(zoneId, ov, auteur);
        // applique à chaud : monde reconstruit, camps rebranchés, PNJ respawnés
        game.applyZoneEdits(zoneId, ov);
        return json(200, { ok: true });
      }
    }

    // ---- musiques : liste des fichiers + correspondance zone -> musique ----
    if (url === '/api/admin/music') {
      if (req.method === 'GET') {
        const files = listerAssets('music', f => /\.(mp3|ogg)$/i.test(f));
        // sous-zones musicales dessinées sur la carte : l'écran Musiques montre
        // où chaque groupe est joué et refuse d'en supprimer un encore utilisé
        const sousZones = [];
        for (const z of content.zones || []) {
          for (const m of loadOverrides(z.id)?.music || []) {
            sousZones.push({ zoneId: z.id, zone: z.name, id: String(m?.id ?? ''), track: m?.track || null });
          }
        }
        return json(200, { files, map: content.music, sousZones });
      }
      if (req.method === 'PUT') {
        const map = JSON.parse(await readBody(req));
        // Groupes de musique : { "<id>": { new: [pistes...], legacy: "x.mp3"|null } }.
        // `new` = liste du pack moderne ; `legacy` = une seule piste. Entrées vides ignorées.
        const groups = {};
        for (const [id, g] of Object.entries(map.groups || {})) {
          if (!id || g == null || typeof g !== 'object') continue;
          const list = Array.isArray(g.new) ? g.new.filter(f => typeof f === 'string' && f) : [];
          const legacy = typeof g.legacy === 'string' && g.legacy ? g.legacy : null;
          if (!list.length && !legacy) continue;
          groups[id] = { new: list, legacy };
        }
        // Un emplacement vaut soit une référence de groupe { group:"id" } (le groupe
        // doit exister), soit l'ancien couple { legacy, new }.
        const slot = (v) => {
          if (typeof v?.group === 'string' && v.group && groups[v.group]) return { group: v.group };
          return {
            legacy: typeof v?.legacy === 'string' && v.legacy ? v.legacy : null,
            new: typeof v?.new === 'string' && v.new ? v.new : null,
          };
        };
        const clean = { login: slot(map.login), trial: slot(map.trial), zones: {}, groups };
        for (const [k, v] of Object.entries(map.zones || {})) clean.zones[k] = slot(v);
        // groupes renommés : les zones musicales de la carte qui les jouaient suivent
        const renommes = (Array.isArray(map.renommages) ? map.renommages : [])
          .filter(r => typeof r?.de === 'string' && typeof r?.vers === 'string' && groups[r.vers]);
        if (renommes.length) {
          for (const z of content.zones || []) {
            const ov = loadOverrides(z.id);
            let n = 0;
            for (const m of ov?.music || []) for (const r of renommes) if (m.track?.group === r.de) { m.track.group = r.vers; n++; break; }
            if (!n) continue;
            ecrireOverrides(z.id, ov, auteur, renommes.map(r => `Groupe « ${r.de} » renommé « ${r.vers} »`).join(', '));
            const zi = game.island(z.id);
            if (zi) zi.musicZones = game.buildMusicZones(ov);
          }
        }
        saveContentFile('music', clean, auteur);
        game.refreshMusic(); // appliqué à chaud aux joueurs connectés
        return json(200, { ok: true });
      }
    }

    // ---- import d'une piste audio (MP3 ou Ogg) dans client/assets/music ----
    if (url === '/api/admin/music/upload' && req.method === 'POST') {
      const { name, data } = JSON.parse(await readBody(req, 40e6));
      const m = String(name || '').match(/^(.+)\.(mp3|ogg)$/i);
      // nom lisible conservé (espaces, accents, parenthèses), sans séparateur de chemin
      const base = m ? m[1].replace(/[^\p{L}\p{N} ()_.'-]+/gu, '_').replace(/^[.\s]+/, '').slice(0, 80).trim() : '';
      if (!base) return json(400, { error: 'Fichier .mp3 ou .ogg attendu' });
      const buf = Buffer.from(String(data || ''), 'base64');
      const ogg = buf.subarray(0, 4).toString('latin1') === 'OggS';
      const mp3 = buf.subarray(0, 3).toString('latin1') === 'ID3' || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0);
      if (!(m[2].toLowerCase() === 'ogg' ? ogg : mp3)) return json(400, { error: `${name} n'est pas un fichier ${m[2].toUpperCase()} valide` });
      const file = `${base}.${m[2].toLowerCase()}`;
      // pas d'écrasement : une piste déjà jouée changerait sous les pieds des joueurs
      if (fs.existsSync(cheminAsset(`music/${file}`))) return json(409, { error: `${file} existe déjà` });
      fs.writeFileSync(cheminAssetEcriture(`music/${file}`), buf);
      return json(200, { ok: true, file });
    }

    // ---- skins : images d'objets et planches de créatures fournies ----
    if (url === '/api/admin/skins') {
      if (req.method === 'GET') {
        const files = listerAssets('skins', f => /\.png$/i.test(f));
        const manifest = lireManifeste();
        // listes pour l'atelier 2D : sorts (icônes) et PNJ (portraits), avec le
        // minimum utile aux prompts — le client admin n'importe pas le contenu serveur
        const spells = (content.spells || []).map(s => ({
          id: s.id, name: s.name, type: s.type, element: s.element || null,
          color: s.color || null, level: s.level | 0,
        }));
        const npcs = Object.entries(content.npc || {}).map(([id, n]) => ({ id, name: n.name || id }));
        return json(200, {
          files, sprites: Object.keys(manifest.enemies).sort(), map: content.skins,
          spells, npcs, desc: content.atelier.desc,
        });
      }
      if (req.method === 'PUT') {
        const map = JSON.parse(await readBody(req));
        const manifest = lireManifeste();
        const clean = { items: {}, mobs: {}, spells: {}, npcs: {} };
        // items, sorts et PNJ pointent tous vers un PNG de assets/skins/
        for (const section of ['items', 'spells', 'npcs']) {
          for (const [defId, file] of Object.entries(map[section] || {})) {
            if (typeof file !== 'string' || !file) continue;
            const rel = file.startsWith('skins/') ? file : `skins/${file}`;
            if (!fs.existsSync(cheminAsset(rel) || '')) return json(400, { error: `image introuvable : ${rel}` });
            clean[section][defId] = rel;
          }
        }
        for (const [defId, sprite] of Object.entries(map.mobs || {})) {
          if (typeof sprite !== 'string' || !sprite) continue;
          if (!manifest.enemies[sprite]) return json(400, { error: `sprite inconnu : ${sprite}` });
          clean.mobs[defId] = sprite;
        }
        saveContentFile('skins', clean, auteur);
        return json(200, { ok: true, note: 'Appliqué au prochain rechargement du client (F5).' });
      }
    }

    // fiches de l'atelier 2D : description physique par entité, injectée dans
    // les prompts IA. Clés de la forme « mobs:orc », « spells:lumiere »...
    if (url === '/api/admin/atelier' && req.method === 'PUT') {
      const { desc } = JSON.parse(await readBody(req));
      const clean = {};
      for (const [k, v] of Object.entries(desc || {})) {
        if (!/^(items|mobs|spells|npcs):[\w-]+$/.test(k)) continue;
        const txt = String(v || '').trim().slice(0, 1200);
        if (txt) clean[k] = txt;
      }
      saveContentFile('atelier', { desc: clean }, auteur);
      return json(200, { ok: true, count: Object.keys(clean).length });
    }

    // téléversement d'une image d'objet (icône + objet au sol) : PNG en base64
    if (url === '/api/admin/skins/upload' && req.method === 'POST') {
      const { name, data } = JSON.parse(await readBody(req, 16e6));
      const buf = Buffer.from(String(data || ''), 'base64');
      pngSize(buf); // valide que c'est bien un PNG
      const file = `${safeName(name)}.png`;
      fs.writeFileSync(cheminAssetEcriture(`skins/${file}`), buf);
      return json(200, { ok: true, file: `skins/${file}` });
    }

    // téléversement d'une planche de créature (grille 8 directions) + description
    if (url === '/api/admin/skins/enemy' && req.method === 'POST') {
      const { cfg, data } = JSON.parse(await readBody(req, 16e6));
      const buf = Buffer.from(String(data || ''), 'base64');
      const { w, h } = pngSize(buf);
      const entry = buildEnemyEntry(cfg, w, h); // valide grille + animations
      fs.writeFileSync(cheminAssetEcriture(`enemies/${cfg.name}.png`), buf);
      const manifest = lireManifeste();
      const existed = !!manifest.enemies[cfg.name];
      manifest.enemies[cfg.name] = { image: entry.image, anims: entry.anims };
      ecrireManifeste(manifest);
      return json(200, {
        ok: true, sprite: cfg.name, existed, cols: entry.cols,
        anims: Object.keys(entry.anims),
        note: 'Assignez ce sprite à une créature ci-dessous, puis rechargez le client (F5).',
      });
    }

    // ---- Bibliothèque : remplacer l'image d'une ressource, ou la dupliquer ----
    // Une ressource = une entrée du manifeste et son image (aucune n'est
    // partagée). Le remplaçant doit avoir les mêmes dimensions : les
    // découpes (images d'animation, pièces) restent celles du manifeste.
    if ((url === '/api/admin/bibliotheque/remplacer' || url === '/api/admin/bibliotheque/dupliquer') && req.method === 'POST') {
      const { type, cle, data } = JSON.parse(await readBody(req, 16e6));
      const manifest = lireManifeste();
      const [sexe, couche] = String(cle || '').split('/');
      const table = type === 'creature' ? manifest.enemies : type === 'objet' ? manifest.loot
        : type === 'personnage' ? manifest.avatar?.[sexe] : type === 'tuiles' || type === 'materiau' ? manifest.tilesets : null;
      const nom = type === 'personnage' ? couche : cle;
      const entree = table && Object.prototype.hasOwnProperty.call(table, nom) ? table[nom] : null;
      if (!entree) return json(404, { error: `ressource inconnue : ${cle}` });
      const images = entree.images || [entree.image];
      // lecture : version effective (instance, sinon base) ; écriture : instance
      const fichier = (rel) => {
        const p = /\.png$/i.test(String(rel)) && cheminAsset(rel);
        if (!p) throw new Error(`chemin d'image invalide : ${rel}`);
        return p;
      };
      if (url.endsWith('/remplacer')) {
        const buf = Buffer.from(String(data || ''), 'base64');
        const neuf = pngSize(buf), cible = fichier(images[0]);
        const actuel = pngSize(fs.readFileSync(cible));
        if (neuf.w !== actuel.w || neuf.h !== actuel.h) {
          return json(400, { error: `dimensions différentes : ${neuf.w} × ${neuf.h} px au lieu de ${actuel.w} × ${actuel.h} px (les découpes du manifeste ne correspondraient plus)` });
        }
        fs.writeFileSync(cheminAssetEcriture(images[0]), buf);
        return json(200, { ok: true, fichier: images[0], note: 'Image remplacée. Les joueurs la verront après rechargement (F5).' });
      }
      // dupliquer : nouvelle clé « <clé>_copie[_n] », images copiées à côté
      let n = 1, nouveau = `${nom}_copie`;
      while (table[nouveau]) nouveau = `${nom}_copie_${++n}`;
      const copie = structuredClone(entree);
      const copier = (rel, i) => {
        const dest = rel.replace(/[^/]+\.png$/i, `${nouveau}${i ? '_' + i : ''}.png`);
        if (fs.existsSync(fichier(dest))) throw new Error(`${dest} existe déjà`);
        fs.copyFileSync(fichier(rel), cheminAssetEcriture(dest));
        return dest;
      };
      if (copie.images) copie.images = copie.images.map(copier); else copie.image = copier(copie.image, 0);
      table[nouveau] = copie;
      ecrireManifeste(manifest);
      return json(200, { ok: true, cle: type === 'personnage' ? `${sexe}/${nouveau}` : nouveau });
    }

    // ---- atelier 3D : modèles sources disponibles (servis sous /src3d/) ----
    if (url === '/api/admin/src3d' && req.method === 'GET') {
      return json(200, { disponible: src3dDisponible(), modeles: listerModeles() });
    }

    // ---- atelier terrains : tuiles/murs générés (PNG + rects) enregistrés en tileset user_ ----
    // Le client GÉNÈRE le PNG (canvas) et calcule les rects ; le serveur se contente
    // d'écrire le fichier et de fusionner le manifeste — MÊME patron que /skins/enemy.
    // Aucune bibliothèque d'image côté serveur (offline, pas de dépendance native).
    if (url === '/api/admin/tiles' && req.method === 'POST') {
      const { name, kind, data, tiles, types, names } = JSON.parse(await readBody(req, 16e6));
      const buf = Buffer.from(String(data || ''), 'base64');
      pngSize(buf); // valide que c'est bien un PNG (en-tête IHDR)
      if (!tiles || typeof tiles !== 'object' || !Object.keys(tiles).length) {
        return json(400, { error: 'aucune pièce (rects) fournie' });
      }
      const kd = kind === 'mur' ? 'mur' : kind === 'toit' ? 'toit' : kind === 'objet' ? 'objet' : 'sol';
      const cleanTiles = {}, cleanTypes = {};
      for (const [frame, rect] of Object.entries(tiles)) {
        const f = String(parseInt(frame, 10));
        if (!/^\d+$/.test(f)) return json(400, { error: `frame invalide : ${frame}` });
        if (!Array.isArray(rect) || rect.length < 6 || !rect.slice(0, 6).every(Number.isFinite)) {
          return json(400, { error: `rect invalide (frame ${frame})` });
        }
        cleanTiles[f] = [...rect.slice(0, 6).map(n => n | 0), 0]; // [x,y,w,h,ox,oy,imgIndex=0]
        const t = types && types[frame];
        cleanTypes[f] = (t === 'sol' || t === 'mur' || t === 'objet') ? t : (kd === 'toit' ? 'objet' : kd);
      }
      const nm = safeName(name);
      fs.writeFileSync(cheminAssetEcriture(`tilesets/user/${nm}.png`), buf);
      const manifest = lireManifeste();
      // Le PRÉFIXE du tileset détermine sa famille côté client (reconnaissance
      // par préfixe : palette, rendu, collision, outil de tracé pour les murs).
      const tsName = kd === 'mur' ? `wall_u_${nm}` : kd === 'toit' ? `roof_u_${nm}` : kd === 'sol' ? `floor_u_${nm}` : `user_${nm}`;
      const existed = !!manifest.tilesets[tsName];
      const entry = {
        images: [`tilesets/user/${nm}.png`],
        tiles: cleanTiles,
        types: cleanTypes,
        family: kd,       // sol | mur | toit | objet
        label: String(name || nm).slice(0, 60),
        user: true,       // marque « asset créé dans l'atelier »
      };
      if (Array.isArray(names)) entry.names = names.map(s => String(s).slice(0, 40));
      if (kd === 'mur') entry.edgekit = true; // jeu de pièces d'ARÊTE (outil de tracé)
      manifest.tilesets[tsName] = entry;
      ecrireManifeste(manifest);
      return json(200, {
        ok: true, tileset: tsName, frames: Object.keys(cleanTiles).length, existed,
        note: 'Rechargez le client (F5) pour voir le nouveau matériau dans la palette.',
      });
    }

    // ---- templates de l'éditeur (assemblages réutilisables tuiles+décors) ----
    // Pur outillage d'édition, partagé entre sessions/navigateurs. GET = liste,
    // PUT = remplace toute la liste (le client renvoie l'ensemble normalisé).
    if (url === '/api/admin/templates') {
      if (req.method === 'GET') {
        return json(200, { templates: content.templates });
      }
      if (req.method === 'PUT') {
        const body = JSON.parse(await readBody(req)); // valide le JSON
        const list = Array.isArray(body?.templates) ? body.templates : [];
        const clean = list.map(cleanTemplate).filter(Boolean);
        saveContentFile('templates', { templates: clean }, auteur);
        return json(200, { ok: true, count: clean.length });
      }
    }

    // ---- personnages ----
    if (url === '/api/admin/characters' && req.method === 'GET') {
      const enJeu = new Map([...game.players.values()].map(p => [p.accountId, p.id]));
      const rows = db.listCharacters().map(r => {
        let d = null;
        try { d = r.data ? JSON.parse(r.data) : null; } catch {}
        return {
          accountId: r.id, account: r.name, isAdmin: !!r.is_admin,
          online: enJeu.has(r.id),
          joueurId: enJeu.get(r.id) ?? null, // id en jeu : actions en direct (/monde/joueur/:id)
          char: d && {
            name: d.name, level: d.level, gold: d.gold, zoneId: d.zoneId,
            hp: d.hp, stats: d.stats, x: d.x, z: d.z,
            flags: d.flags || {}, // drapeaux de quête (dialogues de PNJ)
          },
        };
      });
      return json(200, { characters: rows });
    }
    const mChar = url.match(/^\/api\/admin\/character\/(\d+)$/);
    if (mChar) {
      const accountId = parseInt(mChar[1], 10);
      if (req.method === 'DELETE') {
        db.deleteCharacter(accountId);
        kickIfOnline(game, accountId);
        return json(200, { ok: true });
      }
      if (req.method === 'PUT') {
        const patch = JSON.parse(await readBody(req));
        const data = db.loadCharacter(accountId);
        if (!data) return json(404, { error: 'Pas de personnage' });
        for (const k of ['gold', 'zoneId', 'statPoints', 'skillPoints', 'x', 'z']) {
          if (patch[k] != null && Number.isFinite(+patch[k])) data[k] = +patch[k];
        }
        if (patch.stats) for (const s of Object.keys(data.stats)) {
          if (Number.isFinite(+patch.stats[s])) data.stats[s] = +patch.stats[s];
        }
        // changer le niveau = un VRAI passage de niveau : XP correspondante,
        // points de stats gagnés/repris, accumulation PV/mana recalculée
        if (patch.level != null && Number.isFinite(+patch.level)) {
          const oldLevel = data.level;
          const newLevel = Math.max(1, Math.min(MAX_LEVEL, +patch.level | 0));
          data.level = newLevel;
          data.xp = xpForLevel(newLevel);
          if (patch.statPoints == null) {
            data.statPoints = Math.max(0, (data.statPoints || 0) + POINTS_PER_LEVEL * (newLevel - oldLevel));
          }
          if (patch.skillPoints == null && data.skillPoints != null) {
            data.skillPoints = Math.max(0, data.skillPoints + SKILL_POINTS_PER_LEVEL * (newLevel - oldLevel));
          }
          data.hpAcc = maxHp(data.stats, newLevel);
          data.manaAcc = maxMana(data.stats, newLevel);
        } else if (patch.stats) {
          // stats changées sans changement de niveau : réapproxime l'accumulation
          data.hpAcc = maxHp(data.stats, data.level);
          data.manaAcc = maxMana(data.stats, data.level);
        }
        if (Array.isArray(patch.unlocked)) data.unlocked = patch.unlocked.map(Number);
        // drapeaux de quête : mêmes clés admises que l'action « drapeaux » en direct
        if (patch.flags && typeof patch.flags === 'object' && !Array.isArray(patch.flags)) {
          data.flags = Object.fromEntries(Object.entries(patch.flags).filter(([k]) => /^[\w:.-]{1,60}$/.test(k)));
        }
        data.hp = null; data.mana = null; // recalculés au chargement
        db.saveCharacter(accountId, data);
        kickIfOnline(game, accountId); // le joueur recharge avec les nouvelles données
        return json(200, { ok: true });
      }
      if (req.method === 'POST' && url.endsWith(accountId.toString())) {
        // promotion admin via ?admin=1 dans le corps
        const body = JSON.parse(await readBody(req));
        if (body.admin != null) { db.setAdmin(accountId, !!body.admin); return json(200, { ok: true }); }
      }
    }

    // ---- PNJ présents dans le monde (position effective : worldgen + overrides) ----
    if (url === '/api/admin/npcs/positions' && req.method === 'GET') {
      const pnj = [];
      for (const zi of game.zones.values()) {
        if (zi.isTrial) continue;
        for (const e of zi.entities.values()) {
          if (e.kind !== KIND.NPC) continue;
          pnj.push({ npcId: e.npcId, name: e.name, zoneId: zi.zoneId, zone: content.zones[zi.zoneId]?.name || `zone ${zi.zoneId}`,
            x: Math.round(e.x), z: Math.round(e.z), retouche: e.def !== content.npc[e.npcId] });
        }
      }
      return json(200, { pnj });
    }

    // ---- objets en circulation : exemplaires par defId dans les sauvegardes
    //      (sacs, équipement compris, et coffres) ----
    if (url === '/api/admin/objets/circulation' && req.method === 'GET') {
      const compte = {};
      for (const row of db.listCharacters()) {
        if (!row.data) continue;
        let d; try { d = JSON.parse(row.data); } catch { continue; }
        for (const it of [...(d.inventory || []), ...(d.bank || [])]) {
          if (it?.defId) compte[it.defId] = (compte[it.defId] || 0) + 1;
        }
      }
      return json(200, { compte });
    }

    // ---- panthéon ----
    if (url === '/api/admin/pantheon' && req.method === 'GET') {
      return json(200, { deaths: db.pantheonAdmin(100) });
    }
    // rend au compte le personnage tel qu'il était à sa mort ; il remplace
    // le personnage actuel (la réincarnation) seulement si on le demande
    const mRest = url.match(/^\/api\/admin\/pantheon\/(\d+)\/restaurer$/);
    if (mRest && req.method === 'POST') {
      const mort = db.getDeath(mRest[1] | 0);
      if (!mort) return json(404, { error: 'Mort inconnue' });
      if (!mort.data || !mort.account_id) return json(409, { error: 'Mort enregistrée avant la restauration : rien à rendre' });
      if (mort.restored_at) return json(409, { error: 'Ce personnage a déjà été restauré' });
      if (!db.getAccountById(mort.account_id)) return json(404, { error: 'Le compte n’existe plus' });
      const { remplacer } = JSON.parse(await readBody(req) || '{}');
      const actuel = db.loadCharacter(mort.account_id);
      if (actuel && !remplacer) return json(409, { error: `Le compte a un personnage (${actuel.name}, niveau ${actuel.level}) : confirmez le remplacement`, actuel: { name: actuel.name, level: actuel.level } });
      const data = JSON.parse(mort.data);
      data.hp = null; data.mana = null; // recalculés au chargement : pleine vie
      db.saveCharacter(mort.account_id, data);
      db.marquerRestauree(mort.id);
      kickIfOnline(game, mort.account_id); // le joueur reprend son personnage à la reconnexion
      game.journaliser(`${auteur} : restaure ${mort.name} (niveau ${mort.level})${actuel ? `, à la place de ${actuel.name} (niveau ${actuel.level})` : ''}`, 'mj');
      return json(200, { ok: true });
    }

    // ---- joueurs connectés (position en direct, pour la carte admin) ----
    if (url === '/api/admin/players' && req.method === 'GET') {
      const players = [];
      for (const p of game.players.values()) {
        players.push({
          id: p.id, // id en jeu : actions en direct (/monde/joueur/:id)
          name: p.name,
          level: p.level,
          x: Math.round(p.x * 10) / 10,
          z: Math.round(p.z * 10) / 10,
          zoneId: p.zi.isTrial ? p.zi.trialTarget : p.zi.zoneId,
          trial: !!p.zi.isTrial, // dans une Épreuve : carte instanciée, pas la zone
          admin: !!p.isAdmin,
        });
      }
      return json(200, { players });
    }

    // ---- téléport « tester ici » : envoie le perso EN LIGNE de ce compte admin
    // à une case d'une zone (depuis l'éditeur de carte). Réutilise la logique de
    // déplacement de zone du jeu ; refuse si le compte n'a pas de perso connecté.
    // ---- Carte du monde : état en direct d'une zone, journal, actions ----
    const enLigne = (id) => game.players.get(id | 0) || null;
    const moiEnJeu = () => [...game.players.values()].find(p => p.accountId === session.accountId) || null;
    const zoneDe = (p) => (p.zi.isTrial ? p.zi.trialTarget : p.zi.zoneId);
    const resumeJoueur = (p) => ({
      id: p.id, accountId: p.accountId, name: p.name, level: p.level, admin: !!p.isAdmin,
      x: Math.round(p.x * 10) / 10, z: Math.round(p.z * 10) / 10, zoneId: zoneDe(p),
      lieu: p.zi.isTrial ? 'Épreuve' : p.zi.isCave ? p.zi.caveName : null,
      hp: Math.round(p.hp), maxHp: Math.round(p.eff.maxHp), mana: Math.round(p.mana), maxMana: Math.round(p.eff.maxMana),
      gold: p.gold, depuis: p.sessionT0 || null, muetJusqua: p.muetJusqua || 0,
    });
    const mZoneLive = url.match(/^\/api\/admin\/monde\/zone\/(\d+)$/);
    if (mZoneLive && req.method === 'GET') {
      const zoneId = mZoneLive[1] | 0;
      const zi = game.island(zoneId);
      const pnj = [];
      for (const e of zi?.entities?.values?.() || []) {
        if (e.kind === KIND.NPC) pnj.push({ id: e.id, npcId: e.npcId, name: e.name, x: Math.round(e.x * 10) / 10, z: Math.round(e.z * 10) / 10 });
      }
      const joueurs = [...game.players.values()].map(resumeJoueur);
      // entités au format du client de jeu (meta + état), pour la vue en
      // direct : mêmes sprites, mêmes apparences, mêmes animations
      const entites = [];
      for (const e of zi?.entities?.values?.() || []) {
        entites.push({ ...game.metaFor(e), x: e.x, z: e.z, dir: e.dir || 0, state: e.state || 0,
          hpPct: e.kind === KIND.MOB ? Math.max(0, Math.min(100, Math.round((e.hp / e.maxHp) * 100))) : 100 });
      }
      return json(200, { zoneId, joueurs, pnj, entites, worldTime: game.worldTime, musique: content.music.zones?.[zoneId] || null,
        ovRev: revisionOverrides(zoneId) });
    }
    if (url === '/api/admin/monde/journal' && req.method === 'GET') {
      return json(200, { journal: game.journal.slice(-150).reverse() });
    }
    const mJoueur = url.match(/^\/api\/admin\/monde\/joueur\/(\d+)$/);
    if (mJoueur) {
      const cible = enLigne(mJoueur[1]);
      if (!cible) return json(404, { error: 'Ce joueur n’est plus connecté' });
      if (req.method === 'GET') return json(200, { ...resumeJoueur(cible), flags: cible.flags || {} });
      if (req.method === 'POST') {
        const corps = JSON.parse(await readBody(req));
        const action = String(corps.action || '');
        const DROIT_ACTION = { aller: ['carte', LECTURE], amener: ['joueurs', EDITION], message: ['joueurs', EDITION],
          etat: ['joueurs', EDITION], drapeaux: ['joueurs', EDITION], expulser: ['sanctions', EDITION], muet: ['sanctions', EDITION], bannir: ['sanctions', EDITION] };
        const r = DROIT_ACTION[action];
        if (!r) return json(400, { error: 'Action inconnue' });
        if (!acces.superAdmin && niveau(acces, r[0]) < r[1]) return json(403, { error: 'Permission insuffisante pour cette action' });
        if (!acces.superAdmin && ['expulser', 'muet', 'bannir'].includes(action) && cible.isAdmin) return json(403, { error: 'On ne sanctionne pas un super admin' });
        const auteur = db.getAccountById(session.accountId)?.name || '?';
        const trace = (texte) => game.journaliser(`${auteur} : ${texte}`, 'mj');
        switch (action) {
          case 'aller': case 'amener': {
            const moi = moiEnJeu();
            if (!moi) return json(409, { error: 'Aucun personnage de ce compte n’est connecté en jeu. Entrez d’abord en jeu.' });
            if (action === 'aller' && !acces.animer) return json(403, { error: 'Votre profil n’autorise pas l’entrée en jeu comme animateur' });
            const [qui, vers] = action === 'aller' ? [moi, cible] : [cible, moi];
            if (qui === vers) return json(400, { error: 'C’est votre propre personnage' });
            const t = game.teleportPlayerTo(qui, zoneDe(vers), vers.x + 1, vers.z);
            if (t.error) return json(400, { error: t.error });
            if (action === 'amener') { game.send(cible, { t: 'info', text: 'Un maître du jeu vous a fait venir à lui.' }); trace(`amène ${cible.name} à lui`); }
            return json(200, { ok: true });
          }
          case 'message': {
            const texte = String(corps.texte || '').trim().slice(0, 300);
            if (!texte) return json(400, { error: 'Message vide' });
            game.send(cible, { t: 'chat', from: 'Maître du jeu', text: texte, kind: 'mj' });
            trace(`message à ${cible.name} : ${texte}`);
            return json(200, { ok: true });
          }
          case 'etat': {
            const n = (v) => (v === undefined || v === null || v === '' ? null : Math.round(+v));
            const lvl = n(corps.level), gold = n(corps.gold), hp = n(corps.hp);
            if ([lvl, gold, hp].some(v => v !== null && !Number.isFinite(v))) return json(400, { error: 'Valeurs numériques attendues' });
            if (lvl !== null) {
              cible.level = Math.max(1, Math.min(MAX_LEVEL, lvl));
              cible.xp = xpForLevel(cible.level);
              cible.recompute(game);
            }
            if (gold !== null) cible.gold = Math.max(0, gold);
            if (hp !== null) cible.hp = Math.max(1, Math.min(cible.eff.maxHp, hp));
            game.sendSelf(cible);
            trace(`état de ${cible.name} : ${[lvl !== null && `niveau ${cible.level}`, gold !== null && `or ${cible.gold}`, hp !== null && `vie ${Math.round(cible.hp)}`].filter(Boolean).join(', ')}`);
            return json(200, { ok: true, joueur: resumeJoueur(cible) });
          }
          case 'drapeaux': {
            const flags = corps.flags;
            if (!flags || typeof flags !== 'object' || Array.isArray(flags)) return json(400, { error: 'Drapeaux : objet attendu' });
            const propre = {};
            for (const [k, v] of Object.entries(flags)) if (/^[\w:.-]{1,60}$/.test(k)) propre[k] = v;
            cible.flags = propre;
            trace(`drapeaux de ${cible.name} modifiés`);
            return json(200, { ok: true, flags: propre });
          }
          case 'expulser': {
            trace(`expulse ${cible.name}`);
            game.send(cible, { t: 'info', text: 'Vous avez été expulsé par un maître du jeu.' });
            game.removePlayer(cible, 'Expulsé');
            return json(200, { ok: true });
          }
          case 'muet': {
            const minutes = Math.max(0, Math.min(10080, Math.round(+corps.minutes || 0)));
            cible.muetJusqua = minutes ? Date.now() + minutes * 60000 : 0;
            db.setMuet(cible.accountId, cible.muetJusqua);
            game.send(cible, { t: 'info', text: minutes ? `Un maître du jeu vous réduit au silence pour ${minutes} min.` : 'Vous pouvez de nouveau parler.' });
            trace(minutes ? `rend ${cible.name} muet ${minutes} min` : `rend la parole à ${cible.name}`);
            return json(200, { ok: true, muetJusqua: cible.muetJusqua });
          }
          case 'bannir': {
            db.setBanni(cible.accountId, true);
            trace(`bannit ${cible.name}`);
            game.send(cible, { t: 'info', text: 'Votre compte a été banni.' });
            game.removePlayer(cible, 'Banni');
            return json(200, { ok: true });
          }
        }
      }
    }
    const mDeban = url.match(/^\/api\/admin\/comptes\/(\d+)\/debannir$/);
    if (mDeban && req.method === 'POST') {
      const compte = db.getAccountById(mDeban[1] | 0);
      if (!compte) return json(404, { error: 'Compte inconnu' });
      db.setBanni(compte.id, false);
      game.journaliser(`${db.getAccountById(session.accountId)?.name || '?'} : lève le bannissement de ${compte.name}`, 'mj');
      return json(200, { ok: true });
    }

    if (url === '/api/admin/teleport' && req.method === 'POST') {
      const { zoneId, x, z } = JSON.parse(await readBody(req));
      const player = [...game.players.values()].find(p => p.accountId === session.accountId);
      if (!player) return json(409, { error: 'Aucun personnage de ce compte n\'est connecté en jeu. Connectez-vous d\'abord côté joueur.' });
      const r = game.teleportPlayerTo(player, zoneId | 0, +x, +z);
      if (r.error) return json(400, { error: r.error });
      return json(200, { ok: true });
    }

    // ---- Publication : historique des modifications de la Forge, versions ----
    // Les modifications s'appliquent en direct ; une version marque un état
    // auquel revenir. Une modification se défait seule (champ par champ, tant
    // que la valeur n'a pas changé depuis), une version se restaure en bloc.
    if (url.startsWith('/api/admin/publication')) {
      const lireJson = (t) => (t == null ? undefined : JSON.parse(t));
      const libelle = (f) => { const m = f.match(/^overrides_(\d+)$/); return m ? `Carte · ${content.zones[m[1]]?.name ?? 'zone ' + m[1]}` : f; };
      const courant = (f) => {
        const m = f.match(/^overrides_(\d+)$/);
        return m ? (loadOverrides(+m[1]) || { tiles: [], props: { add: [], remove: [] } })
          : JSON.parse(fs.readFileSync(path.join(CONTENT_DIR, `${f}.json`), 'utf8'));
      };
      // écrit un fichier et l'applique à chaud, comme le font les écrans
      const appliquer = (f, data, note) => {
        const m = f.match(/^overrides_(\d+)$/);
        if (m) {
          const ov = data || { tiles: [], props: { add: [], remove: [] } };
          ecrireOverrides(+m[1], ov, auteur, note);
          game.applyZoneEdits(+m[1], ov);
          return;
        }
        if (data == null) return;
        saveContentFile(f, data, auteur, note);
        if (f === 'npcs') game.refreshNpcs();
        if (f === 'music') game.refreshMusic();
      };
      if (url === '/api/admin/publication/compte' && req.method === 'GET') {
        return json(200, { n: db.compterModificationsApres(db.jusquaDerniereVersion()) });
      }
      if (url === '/api/admin/publication' && req.method === 'GET') {
        const depuis = db.jusquaDerniereVersion();
        const modifications = db.modificationsApres(depuis).slice(-200).reverse().map(m => {
          const a = lireJson(m.avant), b = lireJson(m.apres), diffs = differences(a, b, 60);
          return {
            id: m.id, t: m.t, auteur: m.auteur, fichier: m.fichier, libelle: libelle(m.fichier), note: m.note, nb: diffs.length,
            lignes: diffs.slice(0, 30).map(d => ({ ...decrire(d, a, b), avant: resume(d.avant), apres: resume(d.apres) })),
          };
        });
        return json(200, {
          modifications, versions: db.listVersions(), enLigne: game.players.size,
          production: process.env.NODE_ENV === 'production', arret: game.arretPrevu || null,
        });
      }
      if (url === '/api/admin/publication/version' && req.method === 'POST') {
        const { note } = JSON.parse(await readBody(req) || '{}');
        const jusqua = db.derniereModification();
        if (jusqua <= db.jusquaDerniereVersion()) return json(400, { error: 'Aucune modification depuis la dernière version' });
        const id = db.creerVersion(auteur, String(note || '').trim().slice(0, 500), jusqua);
        game.journaliser?.(`${auteur} marque la version v${id}`, 'mj');
        return json(200, { ok: true, id });
      }
      const mAnn = url.match(/^\/api\/admin\/publication\/annuler\/(\d+)$/);
      if (mAnn && req.method === 'POST') {
        const m = db.getModification(mAnn[1] | 0);
        if (!m) return json(404, { error: 'Modification inconnue' });
        if (m.avant == null) return json(400, { error: 'Création de fichier : restaurez plutôt une version antérieure' });
        const a = lireJson(m.avant), b = lireJson(m.apres), diffs = differences(a, b);
        const etat = courant(m.fichier);
        const conflits = annulerDifferences(etat, diffs);
        if (conflits === diffs.length) return json(409, { error: 'Tout a déjà été modifié depuis : rien à annuler' });
        appliquer(m.fichier, etat, `Annulation de la modification n° ${m.id}`);
        return json(200, { ok: true, conflits, total: diffs.length });
      }
      const mRes = url.match(/^\/api\/admin\/publication\/restaurer\/(\d+)$/);
      if (mRes && req.method === 'POST') {
        const v = db.getVersion(mRes[1] | 0);
        if (!v) return json(404, { error: 'Version inconnue' });
        const fichiers = db.fichiersModifiesApres(v.jusqua);
        let n = 0;
        for (const f of fichiers) {
          const t = db.etatFichierA(f, v.jusqua);
          if (t === undefined) continue;
          const cible = lireJson(t);
          if (JSON.stringify(cible ?? null) === JSON.stringify(courant(f))) continue;
          appliquer(f, cible ?? null, `Restauration de la version v${v.id}`);
          n++;
        }
        game.journaliser?.(`${auteur} restaure la version v${v.id} (${n} fichier${n > 1 ? 's' : ''})`, 'mj');
        return json(200, { ok: true, fichiers: n });
      }
      if (url === '/api/admin/publication/redemarrer' && req.method === 'POST') {
        const { secondes } = JSON.parse(await readBody(req) || '{}');
        const s = Math.max(10, Math.min(3600, secondes | 0 || 45));
        if (game.shuttingDown) return json(409, { error: 'Un arrêt est déjà programmé' });
        game.journaliser?.(`${auteur} programme le redémarrage du serveur dans ${Math.round(s / 60) || s + ' s'}${s >= 60 ? ' min' : ''}`, 'mj');
        game.beginShutdown(s);
        return json(200, { ok: true, arret: game.arretPrevu });
      }
      if (url === '/api/admin/publication/annuler-redemarrage' && req.method === 'POST') {
        if (!game.cancelShutdown()) return json(409, { error: 'Aucun arrêt programmé' });
        game.journaliser?.(`${auteur} annule le redémarrage du serveur`, 'mj');
        return json(200, { ok: true });
      }
    }

    return json(404, { error: 'Route inconnue' });
  } catch (e) {
    return json(400, { error: e.message });
  }
}

function kickIfOnline(game, accountId) {
  for (const p of game.players.values()) {
    if (p.accountId === accountId) {
      p.permadead = true; // évite la sauvegarde qui écraserait l'édition
      game.removePlayer(p, 'Personnage modifié par un administrateur');
      p.permadead = false;
    }
  }
}
