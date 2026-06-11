// Chargement (et rechargement à chaud) du contenu éditable : zones, sorts, compétences
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'content');

export const content = { zones: [], npc: {}, spells: [], skills: [], music: { login: null, trial: null, zones: {} } };

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
  // musiques (écran de connexion, Épreuve, zone -> fichier) : tolérant si absent.
  // Chaque emplacement a deux variantes { legacy, new } : le joueur choisit son
  // pack dans les paramètres (nouvelles musiques par défaut). L'ancien format
  // (fichier seul) est migré en variante legacy.
  const slot = (v) => {
    if (v == null) return { legacy: null, new: null };
    if (typeof v === 'string') return { legacy: v, new: null };
    return { legacy: v.legacy || null, new: v.new || null };
  };
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(DIR, 'music.json'), 'utf8'));
    content.music = { login: slot(raw.login), trial: slot(raw.trial), zones: {} };
    for (const [k, v] of Object.entries(raw.zones || {})) content.music.zones[k] = slot(v);
  } catch { content.music = { login: slot(null), trial: slot(null), zones: {} }; }
  return content;
}

export function saveContentFile(name, data) {
  if (!['zones', 'spells', 'skills', 'music'].includes(name)) throw new Error('fichier inconnu');
  fs.writeFileSync(path.join(DIR, `${name}.json`), JSON.stringify(data, null, 2));
  loadContent();
}

loadContent();
