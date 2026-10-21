// Console d'administration : deux espaces, « Monde » (le serveur en direct) et
// « Forge » (le contenu du jeu). Ce module décrit les écrans et tient l'état
// partagé (réactif) entre la coque (en-tête, navigation, palette Ctrl K) et
// l'en-tête de page : chaque composant est une app petite-vue distincte, elles
// se synchronisent par ce seul objet.
import { reactive } from '/js/vendor/petite-vue.js';

// icônes de navigation : tracés SVG 16x16, trait 1.5 (inline, couleur du texte)
export const ICONES = {
  carte: '<path d="M2 4l4-2 4 2 4-2v10l-4 2-4-2-4 2z"/><path d="M6 2v10M10 4v10"/>',
  joueurs: '<circle cx="6" cy="5" r="2.5"/><path d="M1.5 14c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4"/><path d="M11 3a2.3 2.3 0 010 4.5M12.5 10c1.3.5 2 1.8 2 4"/>',
  pantheon: '<path d="M2 6l6-4 6 4M3 6v7M6 6v7M10 6v7M13 6v7M1.5 14h13"/>',
  acces: '<circle cx="5" cy="8" r="3"/><path d="M8 8h6M12 8v2.5M14 8v2"/>',
  zones: '<path d="M2 12l4-7 3 4 2-2 3 5z"/>',
  pnj: '<circle cx="8" cy="5" r="2.5"/><path d="M3 14c0-3 2.2-4.5 5-4.5s5 1.5 5 4.5"/>',
  creatures: '<circle cx="8" cy="10.5" r="2.5"/><circle cx="4" cy="6.5" r="1.3"/><circle cx="12" cy="6.5" r="1.3"/><circle cx="6.3" cy="3.6" r="1.2"/><circle cx="9.7" cy="3.6" r="1.2"/>',
  sorts: '<path d="M8 1.5l1.6 4.4L14 8l-4.4 1.6L8 14.5l-1.6-4.9L2 8l4.4-2.1z"/>',
  effets: '<circle cx="4" cy="11" r="1.5"/><circle cx="9" cy="6" r="2"/><circle cx="13" cy="3" r="1"/><circle cx="12" cy="11" r="1"/>',
  objets: '<path d="M6 2h4M6.5 2v3L3.5 10a3 3 0 002.6 4.5h3.8A3 3 0 0012.5 10L9.5 5V2"/>',
  bibliotheque: '<rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/>',
  musiques: '<path d="M6 12V3l7-1.5V10.5"/><circle cx="4.5" cy="12" r="1.8"/><circle cx="11.5" cy="10.5" r="1.8"/>',
  fichiers: '<path d="M5.5 5L2.5 8l3 3M10.5 5l3 3-3 3"/>',
  publication: '<path d="M8 11V2.5M4.5 6L8 2.5 11.5 6M2.5 13.5h11"/>',
  entrer: '<path d="M9 2.5h3.5v11H9M2 8h7.5M6.5 5l3 3-3 3"/>',
  sortir: '<path d="M7 2.5H3.5v11H7M14 8H6.5M11 5l3 3-3 3"/>',
};

// Écrans. tab = id du conteneur #tab-<tab> monté par GuiManagerAdmin ;
// sous = sous-écrans (onglets segmentés de l'en-tête de page) ; bientot =
// écran prévu dont le serveur n'existe pas encore (en-tête + description) ;
// droits = droits de profil qui ouvrent l'écran (shared/acces.js) ; l'écran
// est en lecture seule sans le niveau Édition. Sans droits : super admin.
export const ECRANS = [
  { id: 'carte', espace: 'monde', section: 'Monde en direct', nom: 'Carte du monde', icone: 'carte', droits: ['carte'], bientot: true,
    desc: 'Les joueurs et les créatures en direct sur la carte, avec les actions d’animation au clic.',
    prevu: ['Position des joueurs connectés, rafraîchie en continu', 'Sélection d’un joueur : aller à lui, l’amener à soi, message privé, expulsion', 'Journal des événements du serveur'] },
  { id: 'joueurs', espace: 'monde', section: 'Monde en direct', nom: 'Joueurs', icone: 'joueurs', tab: 'chars', droits: ['joueurs'],
    desc: 'Les personnages du serveur. Une modification déconnecte le joueur pour qu’il recharge ses données.' },
  { id: 'pantheon', espace: 'monde', section: 'Monde en direct', nom: 'Panthéon', icone: 'pantheon', tab: 'pantheon', droits: ['pantheon'],
    desc: 'Le registre des personnages tombés, du plus récent au plus ancien.' },
  { id: 'acces', espace: 'monde', section: 'Administration', nom: 'Accès et rôles', icone: 'acces', tab: 'access', droits: ['acces'],
    desc: 'Qui administre le serveur, et avec quelles permissions. Appliqué à chaud si le compte est connecté.' },

  { id: 'zones', espace: 'forge', section: 'Monde', nom: 'Zones et terrain', icone: 'zones', tab: 'map', droits: ['zones', 'pnj_placement', 'zones_musicales'],
    desc: 'Le terrain, les décors, les camps et les lumières de chaque zone.' },
  { id: 'pnj', espace: 'forge', section: 'Habitants', nom: 'PNJ', icone: 'pnj', tab: 'npcs-editor', droits: ['pnj'],
    desc: 'Les personnages non joueurs, leurs mots-clés et leurs dialogues de quête.' },
  { id: 'creatures', espace: 'forge', section: 'Habitants', nom: 'Créatures', icone: 'creatures', tab: 'creatures', droits: ['creatures'],
    desc: 'Le bestiaire : statistiques, butin et apparence de chaque créature. Appliqué à chaud aux prochaines apparitions.' },
  { id: 'sorts', espace: 'forge', section: 'Magie', nom: 'Sorts', icone: 'sorts', droits: ['sorts'],
    desc: 'Les sortilèges : coût, formules, conditions et effets.',
    sous: [{ tab: 'spells-editor', nom: 'Fiche' }, { tab: 'spells-table', nom: 'Tableau' }] },
  { id: 'effets', espace: 'forge', section: 'Magie', nom: 'Effets visuels', icone: 'effets', tab: 'particle-editor', droits: ['sorts'],
    desc: 'Les profils de particules joués par les sorts et les objets.' },
  { id: 'objets', espace: 'forge', section: 'Objets', nom: 'Objets', icone: 'objets', tab: 'objets', droits: ['objets'],
    desc: 'Armes, armures, bijoux et potions : règles, économie et apparence. Appliqué à chaud aux prochains objets générés.' },
  { id: 'bibliotheque', espace: 'forge', section: 'Ressources', nom: 'Bibliothèque', icone: 'bibliotheque', droits: ['bibliotheque'],
    desc: 'Les ressources graphiques du jeu : sprites 2D, matériaux de construction et modèles 3D cuits en sprites.',
    sous: [{ tab: 'skins', nom: 'Atelier 2D' }, { tab: 'materials', nom: 'Matériaux' }, { tab: 'atelier3d', nom: 'Atelier 3D' }] },
  { id: 'musiques', espace: 'forge', section: 'Ressources', nom: 'Musiques', icone: 'musiques', tab: 'music', droits: ['musiques'],
    desc: 'Ce que joue chaque zone et chaque écran, et les groupes de pistes.' },
  { id: 'fichiers', espace: 'forge', section: 'Avancé', nom: 'Fichiers bruts', icone: 'fichiers', tab: 'content', droits: ['fichiers'],
    desc: 'Les fichiers de contenu en JSON. Préférez les écrans dédiés, sauf pour une correction précise.' },
  { id: 'publication', espace: 'forge', nom: 'Publication', icone: 'publication', bientot: true, pied: true,
    desc: 'Le brouillon de la Forge, comparé à ce qui tourne sur le serveur.',
    prevu: ['Liste des modifications en attente, par écran', 'Choix du moment : prochain redémarrage, heure précise ou immédiat', 'Avertissement des joueurs connectés', 'Historique des versions publiées, avec restauration'] },
];

export const ESPACES = [
  { id: 'monde', nom: 'Monde', defaut: 'carte' },
  { id: 'forge', nom: 'Forge', defaut: 'zones' },
];

export const ecranParId = (id) => ECRANS.find(e => e.id === id);

export const consoleEtat = reactive({
  ecran: 'zones',
  sous: {},             // sous-écran choisi, par écran (ex. bibliotheque -> 'materials')
  moi: null,            // { name, isAdmin, perms } (/api/admin/me)
  enLigne: null,        // joueurs connectés (/api/admin/players), null = inconnu
  serveurOk: true,
});

// meilleur niveau du compte sur les droits de l'écran : 0 aucun, 1 lecture, 2 édition
export const niveauEcran = (e) => {
  const moi = consoleEtat.moi;
  if (!moi || moi.isAdmin) return 2;
  if (e?.id === 'publication') return moi.publier ? 2 : 0;
  return Math.max(0, ...(e?.droits || []).map(d => moi.droits?.[d] | 0));
};
export const peutVoir = (e) => niveauEcran(e) > 0;

// tab-content réellement affiché pour un écran (sous-écran éventuel)
export const tabDe = (e) => e.sous ? (consoleEtat.sous[e.id] || e.sous[0].tab) : e.tab;

// affiche un écran : un seul .tab-content visible, mémorisé dans l'adresse
// (#zones, #bibliotheque/materials) pour le rechargement et les liens
export function allerA(id, sous) {
  const e = ecranParId(id) || ecranParId('zones');
  if (sous && e.sous?.some(s => s.tab === sous)) consoleEtat.sous[e.id] = sous;
  consoleEtat.ecran = e.id;
  const tab = tabDe(e);
  document.querySelectorAll('.tab-content').forEach(tc => tc.classList.toggle('visible', tc.id === `tab-${tab}`));
  // lecture seule : les actions d'écriture sont masquées (le serveur refuse de toute façon)
  document.body.classList.toggle('cs-lecture', niveauEcran(e) < 2);
  const h = '#' + e.id + (e.sous ? '/' + tab : '');
  if (location.hash !== h) history.replaceState(null, '', h);
}

export function ecranDepuisAdresse() {
  const [id, sous] = location.hash.slice(1).split('/');
  return { id: ecranParId(id) ? id : null, sous };
}
