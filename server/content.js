// Chargement (et rechargement à chaud) du contenu éditable : zones, sorts, compétences
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FormulaEngine } from '../shared/formula-engine.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'content'); // Corrected path

export const content = { zones: [], npc: {}, spells: [], skills: [], spellFormulas: new Map(), music: { login: null, trial: null, zones: {}, groups: {} }, skins: { items: {}, mobs: {} }, templates: [] };

const engine = new FormulaEngine();

// Compile les expressions des sorts (champs `cooldown` et `effects[].formula`)
// UNE FOIS au chargement : le tick à 10 Hz et les lancers ne parsent jamais.
// Appelée à chaque loadContent(), donc aussi au PUT de l'admin : le cache est
// vidé puis reconstruit — l'édition à chaud des expressions est immédiate.
// Une expression invalide est ignorée (avertissement) : le sort retombe sur
// ses champs numériques historiques (dmg/heal/cast).
function compileSpellFormulas() {
  content.spellFormulas = new Map();
  for (const sp of content.spells) {
    const entry = { cooldown: null, effects: [] };
    if (typeof sp.cooldown === 'string') {
      try { entry.cooldown = engine.compile(sp.cooldown); }
      catch (e) { console.warn(`sort ${sp.id} : expression cooldown invalide ignorée (${e.message})`); }
    }
    const effectsList = sp.effects || [];
    for (const ef of effectsList) {
      if (typeof ef.formula !== 'string') continue;
      try { entry.effects.push({ ...ef, expr: engine.compile(ef.formula) }); }
      catch (e) { console.warn(`sort ${sp.id} : expression ${ef.kind || ef.type} invalide ignorée (${e.message})`); }
    }
    content.spellFormulas.set(sp.id, entry);
  }
}

function compileSkillFormulas() {
  content.skillFormulas = new Map();
  for (const sk of content.skills) {
    const entry = { effects: [] };
    const effectsList = sk.effects || [];
    for (const ef of effectsList) {
      if (typeof ef.formula !== 'string') continue;
      try { entry.effects.push({ ...ef, expr: engine.compile(ef.formula) }); }
      catch (e) { console.warn(`compétence ${sk.id} : expression ${ef.type || ef.kind} invalide ignorée (${e.message})`); }
    }
    content.skillFormulas.set(sk.id, entry);
  }
}

export function loadContent() {
  const zones = JSON.parse(fs.readFileSync(path.join(DIR, 'zones.json'), 'utf8'));
  const spells = JSON.parse(fs.readFileSync(path.join(DIR, 'spells.json'), 'utf8'));
  const skills = JSON.parse(fs.readFileSync(path.join(DIR, 'skills.json'), 'utf8'));
  content.zones = zones.zones;
  content.npc = zones.npc;
  content.spells = spells.spells;
  content.skills = skills.skills;
  content.spellById = Object.fromEntries(content.spells.map(s => [s.id, s]));
  content.skillById = Object.fromEntries(content.skills.map(s => [s.id, s]));
  compileSpellFormulas();
  compileSkillFormulas();
  // musiques (écran de connexion, Épreuve, zone -> emplacement) : tolérant si absent.
  // Un emplacement vaut soit deux variantes { legacy, new } (le joueur choisit son
  // pack dans les paramètres, nouvelles musiques par défaut, l'ancien format fichier
  // seul étant migré en variante legacy), soit une RÉFÉRENCE de groupe { group:"id" }
  // pointant sur content.music.groups (listes nommées réutilisables, cf. parseGroups).
  // Le serveur résout cette référence avant de pousser la piste (cf. game.resolveSlot).
  const slot = (v) => {
    if (v == null) return { legacy: null, new: null };
    if (typeof v === 'string') return { legacy: v, new: null };
    if (typeof v.group === 'string' && v.group) return { group: v.group };
    return { legacy: v.legacy || null, new: v.new || null };
  };
  // Groupes de musique : { "<id>": { new: ["a.mp3", ...], legacy: "x.mp3"|null } }.
  // `new` = LISTE de pistes du pack moderne (tirées au sort/enchaînées côté client) ;
  // `legacy` = UNE seule piste du pack original (jamais de liste). Entrées invalides ignorées.
  const parseGroups = (raw) => {
    const out = {};
    for (const [id, g] of Object.entries(raw || {})) {
      if (!id || g == null || typeof g !== 'object') continue;
      const list = Array.isArray(g.new) ? g.new.filter(f => typeof f === 'string' && f) : [];
      const legacy = typeof g.legacy === 'string' && g.legacy ? g.legacy : null;
      if (!list.length && !legacy) continue; // un groupe sans aucune piste n'a pas de sens
      out[id] = { new: list, legacy };
    }
    return out;
  };
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(DIR, 'music.json'), 'utf8'));
    content.music = { login: slot(raw.login), trial: slot(raw.trial), zones: {}, groups: parseGroups(raw.groups) };
    for (const [k, v] of Object.entries(raw.zones || {})) content.music.zones[k] = slot(v);
  } catch { content.music = { login: slot(null), trial: slot(null), zones: {}, groups: {} }; }
  // skins (onglet admin) : { items: { defId: 'skins/x.png' }, mobs: { defId: spriteName } }
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(DIR, 'skins.json'), 'utf8'));
    content.skins = { items: raw.items || {}, mobs: raw.mobs || {} };
  } catch { content.skins = { items: {}, mobs: {} }; }
  // templates de l'éditeur de carte (assemblages réutilisables tuiles+décors) :
  // pur outillage d'édition, jamais lu par le serveur de JEU. Tolérant si absent.
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(DIR, 'templates.json'), 'utf8'));
    content.templates = Array.isArray(raw.templates) ? raw.templates : [];
  } catch { content.templates = []; }
  return content;
}

export function saveContentFile(name, data) {
  if (!['zones', 'spells', 'skills', 'music', 'skins', 'templates'].includes(name)) throw new Error('fichier inconnu');
  fs.writeFileSync(path.join(DIR, `${name}.json`), JSON.stringify(data, null, 2));
  loadContent();
}

loadContent();
