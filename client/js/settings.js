// Préférences d'affichage et d'audio du client — persistées en localStorage.
// Importé par l'UI (panneau Paramètres), le rendu (étiquettes) et la musique.
const KEY = 't4c_settings';

// Réglages à choix : { key, label, options: [[valeur, libellé], ...], def }
export const SETTING_CHOICES = [
  {
    key: 'musicPack', label: 'Pack de musiques', def: 'new',
    options: [['new', 'Nouvelles'], ['legacy', 'Anciennes (legacy)']],
  },
];

// Curseurs : [clé, libellé, valeur par défaut (0..1)]
export const SETTING_SLIDERS = [
  ['sfxVolume', 'Volume des effets sonores', 0.8],
];

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
];

export const settings = {};
for (const [k, , d] of SETTING_DEFS) settings[k] = d;
for (const [k, , d] of SETTING_SLIDERS) settings[k] = d;
for (const c of SETTING_CHOICES) settings[c.key] = c.def;
try {
  const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
  for (const [k, , ] of SETTING_DEFS) if (k in saved) settings[k] = !!saved[k];
  for (const [k, , d] of SETTING_SLIDERS) {
    if (k in saved && Number.isFinite(+saved[k])) settings[k] = Math.max(0, Math.min(1, +saved[k]));
    else settings[k] = d;
  }
  for (const c of SETTING_CHOICES) {
    if (c.key in saved && c.options.some(([v]) => v === saved[c.key])) settings[c.key] = saved[c.key];
  }
} catch { /* préférences corrompues : on repart des défauts */ }

export function setSetting(k, v) {
  settings[k] = v;
  localStorage.setItem(KEY, JSON.stringify(settings));
}
