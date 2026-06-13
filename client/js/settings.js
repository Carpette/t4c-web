// Préférences d'affichage et d'audio du client — persistées en localStorage.
// Importé par l'UI (panneau Paramètres), le rendu (étiquettes, gamma, zoom),
// la musique et les effets sonores. Tout est appliqué À CHAUD (pas de reload).
const KEY = 't4c_settings';

// Bornes du zoom de la caméra : DOIVENT rester cohérentes avec renderer.zoom()
// (même min/max) pour que le « zoom par défaut » couvre exactement la plage molette.
export const ZOOM_MIN = 0.55;
export const ZOOM_MAX = 1.4;

// Réglages à choix : { key, label, options: [[valeur, libellé], ...], def }
export const SETTING_CHOICES = [
  {
    key: 'musicPack', label: 'Pack de musiques', def: 'new',
    options: [['new', 'Nouvelles'], ['legacy', 'Anciennes (legacy)']],
  },
  {
    key: 'hudScale', label: 'Taille du texte / HUD', def: '1',
    options: [['0.85', 'Petit'], ['1', 'Normal'], ['1.2', 'Grand']],
  },
  {
    key: 'defaultZoom', label: 'Zoom par défaut', def: '1',
    options: [[String(ZOOM_MIN), 'Loin'], ['1', 'Normal'], [String(ZOOM_MAX), 'Près']],
  },
];

// Curseurs. Deux formes acceptées :
//   ['clé', 'libellé', def]                              -> plage implicite 0..1
//   ['clé', 'libellé', def, min, max, step, format]      -> plage explicite
// `format` (optionnel) : 'percent' (def) ou 'raw' pour l'affichage de la valeur.
export const SETTING_SLIDERS = [
  ['masterVolume', 'Volume maître', 1],
  ['musicVolume',  'Volume de la musique', 0.6],
  ['sfxVolume',    'Volume des effets sonores', 0.8],
  ['gamma',        'Luminosité', 1, 0.5, 1.5, 0.05, 'percent'],
  ['fxDensity',    'Densité des effets (particules)', 1],
  ['chatOpacity',  'Opacité du chat', 0.85, 0.2, 1, 0.05, 'percent'],
  ['chatLines',    'Lignes de chat affichées', 8, 5, 20, 1, 'raw'],
];

// métadonnées normalisées d'un curseur (min/max/step/format), quelle que soit
// la forme déclarée ci-dessus
export function sliderMeta([key, label, def, min, max, step, format]) {
  return {
    key, label, def,
    min: min ?? 0, max: max ?? 1, step: step ?? 0.05,
    format: format || 'percent',
  };
}

// Cases à cocher : [clé, libellé, valeur par défaut]
export const SETTING_DEFS = [
  ['musicOn',          'Musique', true],
  ['sfxOn',            'Effets sonores', true],
  ['showPlayerNames',  'Noms des autres joueurs', true],
  ['showPlayerLevels', 'Niveaux des autres joueurs', true],
  ['showSelfName',     'Votre propre nom', true],
  ['showMobNames',     'Noms des monstres', true],
  ['showMobLevels',    'Niveaux des monstres', true],
  ['showHpBars',       'Barres de vie au-dessus des têtes', true],
  ['showBubbles',      'Bulles de dialogue', true],
  ['showFloaters',     'Dégâts et soins flottants', true],
  ['showPerf',         'Afficher ping / FPS', false],
];

function defaults() {
  const out = {};
  for (const [k, , d] of SETTING_DEFS) out[k] = d;
  for (const s of SETTING_SLIDERS) { const m = sliderMeta(s); out[m.key] = m.def; }
  for (const c of SETTING_CHOICES) out[c.key] = c.def;
  return out;
}

export const settings = defaults();

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    for (const [k] of SETTING_DEFS) if (k in saved) settings[k] = !!saved[k];
    for (const s of SETTING_SLIDERS) {
      const m = sliderMeta(s);
      if (m.key in saved && Number.isFinite(+saved[m.key])) {
        settings[m.key] = Math.max(m.min, Math.min(m.max, +saved[m.key]));
      } else settings[m.key] = m.def;
    }
    for (const c of SETTING_CHOICES) {
      if (c.key in saved && c.options.some(([v]) => v === saved[c.key])) settings[c.key] = saved[c.key];
    }
  } catch { /* préférences corrompues : on repart des défauts */ }
}
load();

export function setSetting(k, v) {
  settings[k] = v;
  localStorage.setItem(KEY, JSON.stringify(settings));
}

// Remet TOUS les réglages à leur valeur par défaut (bouton « Réinitialiser »)
export function resetSettings() {
  Object.assign(settings, defaults());
  localStorage.setItem(KEY, JSON.stringify(settings));
}
