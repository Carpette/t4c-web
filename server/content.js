// Chargement (et rechargement à chaud) du contenu éditable : zones, sorts, compétences
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FormulaEngine } from '../shared/formula-engine.js';
import { ORIGINE_MOBS, ORIGINE_ITEMS, SLOTS, MOBS, appliquerSurcharges } from '../shared/defs.js';
import { MAX_LEVEL } from '../shared/constants.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'content'); // Corrected path

export const content = { zones: [], npc: {}, spells: [], skills: [], particles: [], particlesById: {}, spellFormulas: new Map(), music: { login: null, trial: null, zones: {}, groups: {} }, skins: { items: {}, mobs: {}, spells: {}, npcs: {} }, atelier: { desc: {} }, templates: [], creatures: { mobs: {} }, objets: { items: {} } };

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
  const npcs = JSON.parse(fs.readFileSync(path.join(DIR, 'npcs.json'), 'utf8'));
  const spells = JSON.parse(fs.readFileSync(path.join(DIR, 'spells.json'), 'utf8'));
  const skills = JSON.parse(fs.readFileSync(path.join(DIR, 'skills.json'), 'utf8'));
  const particles = JSON.parse(fs.readFileSync(path.join(DIR, 'particles.json'), 'utf8'));
  content.zones = zones.zones;
  content.npc = npcs.npc;
  content.spells = spells.spells;
  content.skills = skills.skills;
  content.particles = particles.particles || [];
  content.spellById = Object.fromEntries(content.spells.map(s => [s.id, s]));
  content.skillById = Object.fromEntries(content.skills.map(s => [s.id, s]));
  content.particlesById = Object.fromEntries(content.particles.map(p => [p.id, p]));
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
  // skins (atelier 2D de l'admin) : { items: { defId: 'skins/x.png' },
  // mobs: { defId: spriteName }, spells: { spellId: 'skins/x.png' },
  // npcs: { npcId: 'skins/x.png' } }. spells/npcs sont optionnels (rétro-compat).
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(DIR, 'skins.json'), 'utf8'));
    content.skins = { items: raw.items || {}, mobs: raw.mobs || {}, spells: raw.spells || {}, npcs: raw.npcs || {} };
  } catch { content.skins = { items: {}, mobs: {}, spells: {}, npcs: {} }; }
  // atelier 2D : fiches descriptives par entité (description physique injectée
  // dans les prompts IA). Pur outillage d'édition, jamais lu par le serveur de JEU.
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(DIR, 'atelier.json'), 'utf8'));
    content.atelier = { desc: raw.desc || {} };
  } catch { content.atelier = { desc: {} }; }
  // templates de l'éditeur de carte (assemblages réutilisables tuiles+décors) :
  // pur outillage d'édition, jamais lu par le serveur de JEU. Tolérant si absent.
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(DIR, 'templates.json'), 'utf8'));
    content.templates = Array.isArray(raw.templates) ? raw.templates : [];
  } catch { content.templates = []; }
  // créatures et objets modifiés dans la Forge : surcharges de shared/defs.js,
  // appliquées en place sur MOBS / ITEMS (cf. appliquerSurcharges). Tolérant si absent.
  const lireSurcharges = (fichier, cle) => {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(DIR, fichier), 'utf8'));
      return raw[cle] && typeof raw[cle] === 'object' ? raw : { [cle]: {} };
    } catch { return { [cle]: {} }; }
  };
  content.creatures = lireSurcharges('creatures.json', 'mobs');
  content.objets = lireSurcharges('objets.json', 'items');
  appliquerSurcharges({ mobs: content.creatures.mobs, items: content.objets.items });
  return content;
}

// ---- validation des surcharges de la Forge (avant écriture) ----
// On valide la fiche FUSIONNÉE (origine + surcharge) : c'est elle que le jeu lira.
const nombre = (v) => typeof v === 'number' && Number.isFinite(v);
const CHAMPS_MOB = ['level', 'hp', 'dmg', 'def', 'speed', 'aggro', 'leash', 'atkRange', 'atkSpeed'];
const SLOTS_OBJET = [...SLOTS.filter(s => s !== 'ring2'), 'use', 'gold'];

function erreursMob(id, m, items) {
  const e = [];
  if (typeof m.name !== 'string' || !m.name.trim()) e.push('nom manquant');
  if (typeof m.sprite !== 'string' || !m.sprite) e.push('sprite manquant');
  for (const k of CHAMPS_MOB) if (!nombre(m[k]) || m[k] < 0) e.push(`${k} doit être un nombre positif`);
  if (nombre(m.level) && m.level < 1) e.push('niveau minimum : 1');
  if (nombre(m.hp) && m.hp < 1) e.push('points de vie minimum : 1');
  if (m.resist != null && (typeof m.resist !== 'object' || Object.values(m.resist).some(v => !nombre(v)))) e.push('résistances invalides');
  if (!Array.isArray(m.drops)) e.push('butin invalide');
  else for (const d of m.drops) {
    if (!Array.isArray(d) || d.length !== 4) { e.push('ligne de butin invalide'); continue; }
    const [obj, chance, min, max] = d;
    if (!(obj in items)) e.push(`butin : objet inconnu « ${obj} »`);
    if (!nombre(chance) || chance < 0 || chance > 1) e.push(`butin ${obj} : chance entre 0 et 1`);
    if (!Number.isInteger(min) || !Number.isInteger(max) || min < 1 || max < min) e.push(`butin ${obj} : quantité invalide`);
  }
  return e.map(x => `${id} : ${x}`);
}

function erreursObjet(id, o) {
  const e = [];
  if (typeof o.name !== 'string' || !o.name.trim()) e.push('nom manquant');
  if (!SLOTS_OBJET.includes(o.slot)) e.push(`emplacement inconnu « ${o.slot} »`);
  for (const k of ['price', 'weight']) if (!nombre(o[k]) || o[k] < 0) e.push(`${k} doit être un nombre positif`);
  for (const k of ['dmgMin', 'dmgMax', 'speed', 'def', 'range', 'heal', 'mana', 'str', 'end', 'agi', 'int', 'wis', 'zone', 'chest', 'malus', 'att', 'dmg']) {
    if (o[k] != null && !nombre(o[k])) e.push(`${k} doit être un nombre`);
  }
  if (nombre(o.dmgMin) && nombre(o.dmgMax) && o.dmgMax < o.dmgMin) e.push('dégâts max < dégâts min');
  if (o.req != null && (typeof o.req !== 'object' || Object.values(o.req).some(v => !nombre(v)))) e.push('prérequis invalides');
  return e.map(x => `${id} : ${x}`);
}

// Liste des erreurs (vide = valide) pour une nouvelle version de zones.json.
// Les zones existantes restent (leurs numéros sont dans les sauvegardes, les
// retouches, les musiques) ; de nouvelles peuvent s'ajouter à la suite, elles
// sont générées au prochain redémarrage.
export function validerZones(data) {
  const zones = data?.zones;
  if (!Array.isArray(zones)) return ['« zones » doit être une liste'];
  const err = [];
  const ids = zones.map(z => z?.id);
  const avant = content.zones.map(z => z.id);
  if (avant.some(id => !ids.includes(id))) err.push(`les zones ${avant.join(', ')} ne peuvent pas être retirées`);
  if (new Set(ids).size !== ids.length || [...ids].sort((a, b) => a - b).some((id, i) => id !== i)) err.push('numéros de zone attendus : 0, 1, 2… sans trou ni doublon');
  for (const z of zones) {
    const nom = `zone ${z?.id}`;
    if (!z || typeof z !== 'object') { err.push(`${nom} : fiche invalide`); continue; }
    if (!String(z.name ?? '').trim()) err.push(`${nom} : nom vide`);
    const [a, b] = Array.isArray(z.levels) ? z.levels : [];
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 1 || b < a || b > MAX_LEVEL) err.push(`${nom} : niveaux entre 1 et ${MAX_LEVEL}, minimum ≤ maximum`);
    if (!Number.isInteger(z.seed)) err.push(`${nom} : graine entière attendue`);
    if (z.map != null && z.map !== 'arakas') err.push(`${nom} : carte inconnue « ${z.map} »`);
    if (z.tint != null && !/^rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(,\s*[\d.]+\s*)?\)$/.test(String(z.tint))) err.push(`${nom} : teinte rgba(r, g, b, a) attendue`);
    if (!Array.isArray(z.mobs) || !z.mobs.length) err.push(`${nom} : au moins une créature`);
    else for (const id of z.mobs) if (!MOBS[id]) err.push(`${nom} : créature inconnue « ${id} »`);
    if (z.boss != null) {
      if (!MOBS[z.boss.defId]) err.push(`${nom} : boss d’une créature inconnue « ${z.boss.defId} »`);
      if (!String(z.boss.name ?? '').trim()) err.push(`${nom} : nom du boss vide`);
      if (!(+z.boss.respawnMs > 0)) err.push(`${nom} : délai de retour du boss > 0`);
    }
  }
  return err;
}

// Liste des erreurs (vide = valide) pour une nouvelle version de creatures.json
// ou objets.json, compte tenu de l'AUTRE fichier tel qu'il est sur disque.
export function validerSurcharges(nom, data) {
  const cle = nom === 'creatures' ? 'mobs' : 'items';
  const s = data?.[cle];
  if (!s || typeof s !== 'object' || Array.isArray(s)) return [`« ${cle} » doit être un objet`];
  const mobsS = nom === 'creatures' ? s : content.creatures.mobs;
  const itemsS = nom === 'objets' ? s : content.objets.items;
  const fusion = (origine, surch) => {
    const out = structuredClone(origine);
    for (const [id, v] of Object.entries(surch)) {
      if (!v || typeof v !== 'object' || Array.isArray(v)) { out[id] = null; continue; }
      out[id] = { ...(out[id] || {}), ...v };
    }
    return out;
  };
  const items = fusion(ORIGINE_ITEMS, itemsS);
  const mobs = fusion(ORIGINE_MOBS, mobsS);
  const err = [];
  for (const id of Object.keys(s)) {
    if (!/^[a-z0-9_]{1,40}$/.test(id)) { err.push(`identifiant invalide « ${id} » (minuscules, chiffres, _)`); continue; }
    const def = (nom === 'creatures' ? mobs : items)[id];
    if (!def) { err.push(`${id} : fiche invalide`); continue; }
    err.push(...(nom === 'creatures' ? erreursMob(id, def, items) : erreursObjet(id, def)));
  }
  // une créature retirée ne doit plus être citée par une zone (spawn -> plantage)
  if (nom === 'creatures') {
    for (const z of content.zones) for (const id of z.mobs || []) {
      if (!mobs[id]) err.push(`zone ${z.name} : créature inconnue « ${id} »`);
    }
  }
  // un objet retiré ou renommé ne doit pas laisser de butin orphelin
  if (nom === 'objets') {
    for (const [mid, m] of Object.entries(mobs)) for (const d of m?.drops || []) {
      if (!(d[0] in items)) err.push(`${mid} : butin vers un objet inconnu « ${d[0]} »`);
    }
  }
  return err;
}

// Historique : chaque écriture est signalée (fichier, avant, après, auteur)
// au journal branché par l'administration (server/admin.js -> base).
let journal = null;
export function journaliserEcritures(fn) { journal = fn; }
// état JSON compact (l'historique ignore les changements de mise en forme)
const compact = (txt) => { try { return JSON.stringify(JSON.parse(txt)); } catch { return txt; } };
export function consignerEcriture(fichier, avantTexte, apres, auteur = 'serveur', note = null) {
  const a = avantTexte == null ? null : compact(avantTexte), b = JSON.stringify(apres);
  if (a !== b) journal?.(fichier, a, b, auteur, note);
}

export const FICHIERS_CONTENU = ['zones', 'npcs', 'spells', 'skills', 'music', 'skins', 'templates', 'particles', 'atelier', 'creatures', 'objets'];
export function saveContentFile(name, data, auteur = 'serveur', note = null) {
  if (!FICHIERS_CONTENU.includes(name)) throw new Error('fichier inconnu');
  const f = path.join(DIR, `${name}.json`);
  let avant = null;
  try { avant = fs.readFileSync(f, 'utf8'); } catch { /* fichier neuf */ }
  fs.writeFileSync(f, JSON.stringify(data, null, 2));
  consignerEcriture(name, avant, data, auteur, note);
  loadContent();
}

loadContent();
