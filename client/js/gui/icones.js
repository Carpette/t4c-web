// Jeu d'icônes de l'interface du jeu : SVG au trait (24×24, couleur héritée
// via currentColor), injecté une fois dans la page sous forme de <symbol>.
// AUCUN emoji dans l'interface : leur rendu dépend du système et jure avec
// les sprites du jeu. Usage :
//   icone('epee')              -> chaîne HTML <svg> (v-html, innerHTML)
//   <svg class="ico"><use href="#ico-epee"/></svg>   (gabarits statiques)
const TRACES = {
  // équipement
  epee: '<path d="M20 4l-1.5 5L10 17.5 6.5 14 15 5.5z"/><path d="M5 13l6 6M8 16l-4 4"/>',
  bouclier: '<path d="M12 3l8 3v6c0 4.5-3.4 7.8-8 9-4.6-1.2-8-4.5-8-9V6z"/>',
  armure: '<path d="M8 3L4 6v5l3 1v9h10v-9l3-1V6l-4-3c-.5 1.7-2 3-4 3S8.5 4.7 8 3z"/>',
  casque: '<path d="M4 16a8 8 0 0 1 16 0v3H4z"/><path d="M12 8v11M4 16h5"/>',
  jambieres: '<path d="M7 3h10l-1 18h-3.5L12 10l-.5 11H8z"/>',
  gants: '<path d="M7 21v-6l-2-4V7a1 1 0 0 1 2 0v3V4a1 1 0 0 1 2 0v6V3a1 1 0 0 1 2 0v7V4a1 1 0 0 1 2 0v8l2-2a1.4 1.4 0 0 1 2 2l-4 5v4z"/>',
  ceinture: '<rect x="3" y="9" width="18" height="6" rx="1"/><rect x="9.5" y="8" width="5" height="8" rx="1"/>',
  bottes: '<path d="M7 3h6v10l6 3v4H5v-4l2-1z"/>',
  anneau: '<circle cx="12" cy="14" r="6"/><path d="M9.5 6.5L12 4l2.5 2.5L12 8z"/>',
  amulette: '<path d="M5 3c0 5 3 8 7 9 4-1 7-4 7-9"/><circle cx="12" cy="16" r="4"/>',
  potion: '<path d="M10 3h4M10 3v5l-4.5 8A3 3 0 0 0 8 20.5h8a3 3 0 0 0 2.5-4.5L14 8V3"/><path d="M7.5 14h9"/>',
  piece: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4.5"/>',
  // magie et éléments
  eclair: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
  coeur: '<path d="M12 20s-7.5-4.5-7.5-10A4.2 4.2 0 0 1 12 7.5 4.2 4.2 0 0 1 19.5 10c0 5.5-7.5 10-7.5 10z"/>',
  flamme: '<path d="M12 21c-3.9 0-6.5-2.6-6.5-6.2 0-3.4 2.3-5.4 3.5-8.3.8 1.9 1.6 2.6 2.6 3C11.6 6.6 12.6 4.4 15 3c-.3 3.3 3.5 5.6 3.5 11.3 0 4-2.7 6.7-6.5 6.7z"/>',
  etincelle: '<path d="M12 3l1.8 5.4L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.6z"/><path d="M19 16l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>',
  flocon: '<path d="M12 2v20M3.3 7l17.4 10M3.3 17L20.7 7"/><path d="M9.5 3.5L12 6l2.5-2.5M9.5 20.5L12 18l2.5 2.5"/>',
  vent: '<path d="M3 8h11a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h7"/>',
  montagne: '<path d="M2 20L9 7l4 7 2-3 7 9z"/>',
  soleil: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  lune: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  couchant: '<path d="M3 17h18M7 17a5 5 0 0 1 10 0M12 5v3M5.6 9.6l1.5 1.5M18.4 9.6l-1.5 1.5M6 21h12"/>',
  goutte: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>',
  ampoule: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>',
  haltere: '<path d="M6 7v10M18 7v10M3 9v6M21 9v6M6 12h12"/>',
  oeil: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  sablier: '<path d="M6 3h12M6 21h12M7 3c0 6 10 5 10 9s-10 3-10 9M17 3c0 6-10 5-10 9s10 3 10 9"/>',
  etoile: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
  // interface
  sac: '<path d="M6 8h12l1 12H5z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
  personnage: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  livre: '<path d="M4 4h6a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H4zM20 4h-6a2 2 0 0 0-2 2v14a2 2 0 0 1 2-2h6z"/>',
  aide: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01"/>',
  journal: '<path d="M5 4a2 2 0 0 1 2-2h12v18H7a2 2 0 0 0-2 2z"/><path d="M5 20V4M9 7h6M9 11h6"/>',
  carte: '<path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z"/><path d="M9 3v15M15 6v15"/>',
  groupe: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14a6.5 6.5 0 0 1 3.5 6"/>',
  crane: '<path d="M12 3a7 7 0 0 0-7 7c0 2.4 1.2 4 3 5v3h8v-3c1.8-1 3-2.6 3-5a7 7 0 0 0-7-7z"/><circle cx="9.5" cy="10.5" r="1.5"/><circle cx="14.5" cy="10.5" r="1.5"/><path d="M10 21v-3M14 21v-3"/>',
  couronne: '<path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z"/>',
  fermer: '<path d="M6 6l12 12M18 6L6 18"/>',
  micro: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  reglages: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  cadenas: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  alerte: '<path d="M12 3L2 20h20z"/><path d="M12 9v5M12 17h.01"/>',
  boussole: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
  outils: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/>',
  annonce: '<path d="M3 10v4h4l7 4V6L7 10z"/><path d="M17.5 9a4 4 0 0 1 0 6"/>',
  epees: '<path d="M4 4l11 11M15 15l2 2M17 17l3 3M20 4L9 15M9 15l-2 2M7 17l-3 3M4 4h3v3M20 4h-3v3"/>',
};

// équipement -> icône de repli (objet sans sprite)
export const SLOT_ICONS = {
  weapon: 'epee', shield: 'bouclier', armor: 'armure', helmet: 'casque', legs: 'jambieres',
  gloves: 'gants', belt: 'ceinture', boots: 'bottes', ring: 'anneau', ring2: 'anneau',
  amulet: 'amulette', use: 'potion', gold: 'piece',
};
export const SPELL_ICONS = { bolt: 'eclair', heal: 'coeur', aoe: 'flamme', buff: 'etincelle' };
// éléments : clés du contenu (anglaises) et anciennes clés françaises
export const ELEMENT_ICONS = {
  fire: 'flamme', water: 'flocon', air: 'eclair', earth: 'montagne', light: 'soleil', dark: 'lune', arcane: 'etoile',
  feu: 'flamme', eau: 'flocon', terre: 'montagne', lumiere: 'soleil',
};

export function icone(nom, { taille = 16, classe = '' } = {}) {
  const id = TRACES[nom] ? nom : 'etincelle';
  return `<svg class="ico${classe ? ' ' + classe : ''}" width="${taille}" height="${taille}" aria-hidden="true" focusable="false"><use href="#ico-${id}"></use></svg>`;
}

// sprite injecté une fois (les <use href="#ico-…"> s'y réfèrent)
export function installerIcones(doc = globalThis.document) {
  if (!doc?.body || doc.getElementById?.('icones-sprite')?.tagName) return;
  const symboles = Object.entries(TRACES).map(([nom, d]) =>
    `<symbol id="ico-${nom}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</symbol>`).join('');
  doc.body.insertAdjacentHTML('afterbegin',
    `<svg id="icones-sprite" width="0" height="0" style="position:absolute" aria-hidden="true">${symboles}</svg>`);
}
installerIcones();
