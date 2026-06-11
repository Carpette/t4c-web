// Préférences d'affichage du client — persistées en localStorage.
// Importé par l'UI (panneau Paramètres) et par le rendu (étiquettes des entités).
const KEY = 't4c_settings';

// [clé, libellé, valeur par défaut]
export const SETTING_DEFS = [
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
try {
  const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
  for (const k of Object.keys(saved)) if (k in settings) settings[k] = !!saved[k];
} catch { /* préférences corrompues : on repart des défauts */ }

export function setSetting(k, v) {
  settings[k] = !!v;
  localStorage.setItem(KEY, JSON.stringify(settings));
}
