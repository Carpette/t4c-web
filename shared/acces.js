// Accès à la console : profils de droits. Un profil donne, écran par écran,
// un niveau AUCUN / LECTURE / ÉDITION, plus deux autorisations (entrer en jeu
// comme animateur, publier). Partagé : le serveur l'applique, l'admin web
// l'affiche. Le super admin (accounts.is_admin) a tout, sans profil.

export const AUCUN = 0, LECTURE = 1, EDITION = 2;

export const DROITS = [
  // Monde, en direct
  { id: 'carte', espace: 'monde', nom: 'Carte du monde', desc: 'Voir le monde, les joueurs et les PNJ' },
  { id: 'pnj_placement', espace: 'monde', nom: 'Placement des PNJ', desc: 'Placer, déplacer, retirer un PNJ sur la carte' },
  { id: 'zones_musicales', espace: 'monde', nom: 'Zones musicales', desc: 'Dessiner les zones et leur associer un groupe' },
  { id: 'joueurs', espace: 'monde', nom: 'Joueurs : état', desc: 'Niveau, vie, or, sorts, téléportation' },
  { id: 'sanctions', espace: 'monde', nom: 'Joueurs : sanctions', desc: 'Foudroyer un joueur en jeu' },
  { id: 'invocation', espace: 'monde', nom: 'Invocation', desc: 'Créatures, objets, annonces et invasions en jeu' },
  { id: 'pantheon', espace: 'monde', nom: 'Panthéon', desc: 'Registre des personnages morts' },
  { id: 'acces', espace: 'monde', nom: 'Accès et rôles', desc: 'Cet écran' },
  // Forge, contenu
  { id: 'zones', espace: 'forge', nom: 'Zones et terrain' },
  { id: 'pnj', espace: 'forge', nom: 'PNJ, dialogues et quêtes' },
  { id: 'creatures', espace: 'forge', nom: 'Créatures' },
  { id: 'objets', espace: 'forge', nom: 'Objets' },
  { id: 'sorts', espace: 'forge', nom: 'Sorts, effets visuels et équilibrage' },
  { id: 'bibliotheque', espace: 'forge', nom: 'Bibliothèque (2D, 3D, matériaux)' },
  { id: 'musiques', espace: 'forge', nom: 'Musiques' },
  { id: 'fichiers', espace: 'forge', nom: 'Fichiers bruts' },
];
export const OPTIONS = [
  { id: 'animer', espace: 'monde', nom: 'Entrer en jeu comme animateur', desc: 'Les commandes en jeu exigent en plus l’édition du droit concerné' },
  { id: 'publier', espace: 'forge', nom: 'Publier et redémarrer', desc: 'Envoyer le brouillon en production' },
];

// profil assaini : droits connus bornés à 0..2, options booléennes
export function nettoyerProfil(p) {
  const droits = {};
  for (const d of DROITS) {
    const n = (p?.droits?.[d.id] | 0);
    if (n > 0) droits[d.id] = Math.min(EDITION, n);
  }
  return {
    nom: String(p?.nom ?? '').trim().slice(0, 40),
    droits, animer: !!p?.animer, publier: !!p?.publier,
  };
}

// accès effectif d'un compte : { superAdmin, droits, animer, publier }
export function accesDe(isAdmin, profil) {
  if (isAdmin) {
    return { superAdmin: true, droits: Object.fromEntries(DROITS.map(d => [d.id, EDITION])), animer: true, publier: true };
  }
  const p = nettoyerProfil(profil);
  return { superAdmin: false, droits: p.droits, animer: p.animer, publier: p.publier };
}
export const niveau = (acces, droit) => (acces?.droits?.[droit] | 0);
export const aConsole = (acces) => !!acces?.superAdmin || Object.values(acces?.droits || {}).some(n => n > 0);

// a ⊆ b : aucun droit ni option de a ne dépasse b (pas d'escalade)
export function inclus(a, b) {
  if (b.superAdmin) return true;
  if (a.superAdmin) return false;
  return DROITS.every(d => niveau(a, d.id) <= niveau(b, d.id))
    && (!a.animer || b.animer) && (!a.publier || b.publier);
}

// anciennes permissions (panneau d'admin en jeu) dérivées de l'accès
export function permsDe(acces) {
  if (acces?.superAdmin) return ['players', 'spawn', 'map', 'quests', 'roles'];
  const out = [];
  const jeu = (droit) => acces?.animer && niveau(acces, droit) >= EDITION;
  if (jeu('joueurs') || jeu('sanctions')) out.push('players');
  if (jeu('invocation')) out.push('spawn');
  if (jeu('zones')) out.push('map');
  if (jeu('pnj')) out.push('quests');
  if (niveau(acces, 'acces') >= LECTURE) out.push('roles');
  return out;
}

// migration : anciennes permissions -> profil équivalent
export function profilDepuisPerms(perms) {
  const droits = {}, mettre = (ids, n) => ids.forEach(id => { droits[id] = Math.max(droits[id] | 0, n); });
  if (perms.includes('players')) mettre(['joueurs', 'sanctions'], EDITION);
  if (perms.includes('spawn')) mettre(['invocation'], EDITION);
  if (perms.includes('map')) mettre(['zones', 'pnj_placement', 'zones_musicales'], EDITION);
  if (perms.includes('quests')) mettre(['pnj'], EDITION);
  if (perms.includes('roles')) mettre(['acces'], LECTURE);
  if (Object.keys(droits).length) mettre(['carte'], LECTURE);
  return { droits, animer: true, publier: false };
}

// profils proposés sur une base neuve
export const PROFILS_INITIAUX = [
  { nom: 'Administrateur', droits: Object.fromEntries(DROITS.filter(d => d.id !== 'acces').map(d => [d.id, EDITION]).concat([['acces', LECTURE]])), animer: true, publier: true },
  { nom: 'Animateur', droits: { carte: LECTURE, joueurs: EDITION, sanctions: EDITION, invocation: EDITION, pantheon: LECTURE, pnj: LECTURE }, animer: true, publier: false },
];
