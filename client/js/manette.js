// Manette (API Gamepad du navigateur) : manettes Xbox / PlayStation et Steam
// Deck (navigateur lancé comme jeu Steam, profil « manette »). Stick gauche =
// déplacement ; chaque bouton déclenche une action du jeu, remappable dans
// Paramètres > Manette (préférence locale au navigateur).

// actions proposées au remappage, dans l'ordre d'affichage
export const ACTIONS_MANETTE = [
  ['attaquer', 'Attaquer le plus proche (encore : le suivant)'],
  ['ciblePrecedente', 'Cible précédente'],
  ['ramasser', 'Ramasser l\'objet le plus proche'],
  ['echap', 'Annuler / fermer / menu'],
  ['potionVie', 'Potion de vie'],
  ['potionMana', 'Potion de mana'],
  ['bandage', 'Premiers soins (bandage)'],
  ['sort1', 'Sort 1'], ['sort2', 'Sort 2'], ['sort3', 'Sort 3'], ['sort4', 'Sort 4'],
  ['sort5', 'Sort 5'], ['sort6', 'Sort 6'], ['sort7', 'Sort 7'], ['sort8', 'Sort 8'],
  ['inventaire', 'Inventaire'],
  ['personnage', 'Personnage'],
  ['carte', 'Mini-carte'],
];

// disposition « standard » de l'API Gamepad (libellés Xbox, Steam Deck entre parenthèses)
export const NOMS_BOUTONS = ['A', 'B', 'X', 'Y', 'LB (L1)', 'RB (R1)', 'LT (L2)', 'RT (R2)',
  'Vue (Select)', 'Menu (Start)', 'Stick gauche (L3)', 'Stick droit (R3)',
  'Croix haut', 'Croix bas', 'Croix gauche', 'Croix droite', 'Guide'];
export const nomBouton = (i) => NOMS_BOUTONS[i] || `Bouton ${i}`;

// bouton -> action
const DEFAUTS = {
  0: 'attaquer', 1: 'echap', 2: 'ramasser', 3: 'potionVie',
  4: 'ciblePrecedente', 5: 'potionMana', 6: 'sort5', 7: 'sort6',
  8: 'inventaire', 9: 'echap', 10: 'sort7', 11: 'sort8',
  12: 'sort1', 13: 'sort3', 14: 'sort4', 15: 'sort2',
};
const CLE = 't4c_manette';

let boutons = { ...DEFAUTS };
try {
  const lu = JSON.parse(localStorage.getItem(CLE) || 'null');
  if (lu && typeof lu === 'object') boutons = lu;
} catch { /* préférence illisible : défauts */ }
const sauver = () => { try { localStorage.setItem(CLE, JSON.stringify(boutons)); } catch { /* stockage indisponible */ } };

export const boutonsDe = (action) => Object.keys(boutons).filter(b => boutons[b] === action).map(Number);
export function boutonsParDefaut() { boutons = { ...DEFAUTS }; sauver(); }
// associe un bouton à une action : le bouton quitte son ancienne action,
// l'action quitte ses anciens boutons (un bouton par action après remappage)
export function assigner(action, bouton) {
  for (const b of boutonsDe(action)) delete boutons[b];
  boutons[bouton] = action;
  sauver();
}

let capture = null;      // remappage : prochain bouton pressé -> rappel
export function capturerBouton(fn) { capture = fn; }

const ZONE_MORTE = 0.3;
let precedent = [];      // état des boutons au tick précédent (fronts montants)
let dirStick = null;     // direction envoyée par le stick (secteur de 16) ou null
let connue = false;

// À appeler à chaque image. `actions` : { nomAction: () => void },
// `deplacer(sx, sy)` : direction ÉCRAN (0,0 = arrêt), `actif()` : appelé
// seulement quand la manette sert (bouton, stick hors zone morte) ; faux = ignorée.
export function tickManette(actions, deplacer, actif, annoncer) {
  const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
  const pad = pads.find(p => p.connected);
  if (!pad) {
    if (dirStick != null) { dirStick = null; deplacer(0, 0); }
    connue = false;
    return;
  }
  if (!connue) { connue = true; annoncer?.(pad); }
  const presses = pad.buttons.map(b => b.pressed || b.value > 0.5);
  presses.forEach((p, i) => {
    if (!p || precedent[i]) return;
    if (capture) { const fn = capture; capture = null; fn(i); return; }
    if (!actif()) return;
    actions[boutons[i]]?.();
  });
  precedent = presses;

  // stick gauche : direction quantifiée (16 secteurs) pour ne renvoyer au
  // serveur qu'un changement réel, pas chaque frémissement du stick
  const sx = pad.axes[0] || 0, sy = pad.axes[1] || 0;
  const secteur = Math.hypot(sx, sy) > ZONE_MORTE && actif()
    ? Math.round(Math.atan2(sy, sx) / (Math.PI / 8)) & 15 : null;
  if (secteur !== dirStick) {
    dirStick = secteur;
    if (secteur == null) deplacer(0, 0);
    else { const a = secteur * Math.PI / 8; deplacer(Math.cos(a), Math.sin(a)); }
  }
}
