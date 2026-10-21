// Applique les créatures et objets modifiés dans la Forge (content/creatures.json,
// content/objets.json) sur MOBS / ITEMS, avant le premier usage côté client.
// Fichier absent ou illisible : définitions d'origine.
import { appliquerSurcharges } from '../../shared/defs.js';

const lire = async (nom) => {
  try {
    const r = await fetch(`/content/${nom}.json`, { cache: 'no-store' });
    return r.ok ? await r.json() : {};
  } catch { return {}; }
};

export async function chargerSurcharges() {
  const [c, o] = await Promise.all([lire('creatures'), lire('objets')]);
  appliquerSurcharges({ mobs: c.mobs, items: o.items });
}
