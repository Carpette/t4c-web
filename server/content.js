// Chargement (et rechargement à chaud) du contenu éditable : zones, sorts, compétences
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'content');

export const content = { zones: [], npc: {}, spells: [], skills: [] };

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
  return content;
}

export function saveContentFile(name, data) {
  if (!['zones', 'spells', 'skills'].includes(name)) throw new Error('fichier inconnu');
  fs.writeFileSync(path.join(DIR, `${name}.json`), JSON.stringify(data, null, 2));
  loadContent();
}

loadContent();
