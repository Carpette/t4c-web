// API HTTP d'administration : contenu, cartes (overrides), personnages, panthéon.
// Auth : compte avec is_admin = 1 → token de session.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as db from './db.js';
import { content, saveContentFile } from './content.js';
import { xpForLevel, maxHp, maxMana, POINTS_PER_LEVEL, MAX_LEVEL } from '../shared/constants.js';

const CONTENT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'content');
const tokens = new Map(); // token -> { accountId, expires }

export function overridesPath(zoneId) {
  return path.join(CONTENT_DIR, `overrides_${zoneId}.json`);
}
export function loadOverrides(zoneId) {
  try { return JSON.parse(fs.readFileSync(overridesPath(zoneId), 'utf8')); } catch { return null; }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 5e6) reject(new Error('trop gros')); });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
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
      if (!r.isAdmin) return json(403, { error: 'Ce compte n\'est pas administrateur' });
      const token = crypto.randomBytes(24).toString('hex');
      tokens.set(token, { accountId: r.accountId, expires: Date.now() + 24 * 3600e3 });
      return json(200, { token, name: r.name });
    }

    const session = auth(req);
    if (!session) return json(401, { error: 'Non authentifié' });

    // ---- contenu (zones / sorts / compétences) ----
    const mContent = url.match(/^\/api\/admin\/content\/(zones|spells|skills)$/);
    if (mContent) {
      const name = mContent[1];
      if (req.method === 'GET') {
        return json(200, JSON.parse(fs.readFileSync(path.join(CONTENT_DIR, `${name}.json`), 'utf8')));
      }
      if (req.method === 'PUT') {
        const data = JSON.parse(await readBody(req)); // valide le JSON
        saveContentFile(name, data);
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
        fs.writeFileSync(overridesPath(zoneId), JSON.stringify(ov));
        // applique à chaud : monde reconstruit, camps rebranchés, PNJ respawnés
        game.applyZoneEdits(zoneId, ov);
        return json(200, { ok: true });
      }
    }

    // ---- musiques : liste des fichiers + correspondance zone -> musique ----
    if (url === '/api/admin/music') {
      const musicDir = path.join(CONTENT_DIR, '..', 'client', 'assets', 'music');
      if (req.method === 'GET') {
        let files = [];
        try {
          files = fs.readdirSync(musicDir).filter(f => /\.(mp3|ogg)$/i.test(f)).sort();
        } catch { /* pas de dossier musique */ }
        return json(200, { files, map: content.music });
      }
      if (req.method === 'PUT') {
        const map = JSON.parse(await readBody(req));
        // ne garde que la structure attendue : { legacy, new } par emplacement
        const slot = (v) => ({
          legacy: typeof v?.legacy === 'string' && v.legacy ? v.legacy : null,
          new: typeof v?.new === 'string' && v.new ? v.new : null,
        });
        const clean = { login: slot(map.login), trial: slot(map.trial), zones: {} };
        for (const [k, v] of Object.entries(map.zones || {})) clean.zones[k] = slot(v);
        saveContentFile('music', clean);
        game.refreshMusic(); // appliqué à chaud aux joueurs connectés
        return json(200, { ok: true });
      }
    }

    // ---- personnages ----
    if (url === '/api/admin/characters' && req.method === 'GET') {
      const rows = db.listCharacters().map(r => {
        let d = null;
        try { d = r.data ? JSON.parse(r.data) : null; } catch {}
        return {
          accountId: r.id, account: r.name, isAdmin: !!r.is_admin,
          online: [...game.players.values()].some(p => p.accountId === r.id),
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
        for (const k of ['gold', 'zoneId', 'statPoints', 'x', 'z']) {
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
          data.hpAcc = maxHp(data.stats, newLevel);
          data.manaAcc = maxMana(data.stats, newLevel);
        } else if (patch.stats) {
          // stats changées sans changement de niveau : réapproxime l'accumulation
          data.hpAcc = maxHp(data.stats, data.level);
          data.manaAcc = maxMana(data.stats, data.level);
        }
        if (Array.isArray(patch.unlocked)) data.unlocked = patch.unlocked.map(Number);
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

    // ---- panthéon ----
    if (url === '/api/admin/pantheon' && req.method === 'GET') {
      return json(200, { deaths: db.pantheon(100) });
    }

    // ---- joueurs connectés (position en direct, pour la carte admin) ----
    if (url === '/api/admin/players' && req.method === 'GET') {
      const players = [];
      for (const p of game.players.values()) {
        players.push({
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
