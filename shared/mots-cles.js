// Règles des dialogues à mots-clés partagées entre le serveur
// (server/game/dialogues.js) et le simulateur de la fiche PNJ de l'admin :
// reconnaissance d'un mot-clé et conditions d'un dialogue.

// minuscules + accents retirés : « Quête » et « quete » se valent
export function normalize(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// le message contient-il le mot-clé en MOT ENTIER ? (« or » ne réagit pas à « mort »)
export function containsKeyword(text, keyword) {
  const k = normalize(keyword).trim();
  if (!k) return false;
  const escaped = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, 'u').test(normalize(text));
}

// Première condition du dialogue qui bloque (texte lisible), ou null si toutes
// sont remplies. Conditions : flag, notFlag, level, item (+ n), gold, chasse,
// cursed, notCursed, et les listes flags[], items[{ item, n, consume }],
// chasses[] (toutes requises). `etat` décrit le joueur : { flags, level, gold,
// aObjet(defId, n) -> bool (au moins n exemplaires), chasse(clef) -> { tues, n } | null, maudit: (() -> bool) | null } (maudit null : inconnu).
export function conditionBloquante(c, etat) {
  if (!c) return null;
  if (c.flag && !etat.flags[c.flag]) return `le drapeau ${c.flag} n'est pas posé`;
  if (c.notFlag && etat.flags[c.notFlag]) return `le drapeau ${c.notFlag} est posé`;
  if (c.level && etat.level < c.level) return `niveau ${c.level} requis`;
  if (c.item && !etat.aObjet(c.item, Math.max(1, c.n | 0))) return `objet ${c.item}${c.n > 1 ? ' ×' + c.n : ''} requis`;
  // formes multiples (objectifs d'une quête entre deux dialogues) : toutes requises
  for (const f of Array.isArray(c.flags) ? c.flags : []) if (!etat.flags[f]) return `le drapeau ${f} n'est pas posé`;
  for (const o of Array.isArray(c.items) ? c.items : []) {
    if (o?.item && !etat.aObjet(o.item, Math.max(1, o.n | 0))) return `objet ${o.item}${o.n > 1 ? ' ×' + o.n : ''} requis`;
  }
  for (const key of [c.chasse, ...(Array.isArray(c.chasses) ? c.chasses : [])]) {
    if (!key) continue;
    const ch = etat.chasse?.(key);
    if (!ch) return `chasse ${key} non commencée`;
    if (ch.tues < ch.n) return `chasse ${key} : ${ch.tues}/${ch.n}`;
  }
  if (c.gold && etat.gold < c.gold) return `${c.gold} pièces d'or requises`;   // seuil (prélevé si consumeGold)
  if (c.cursed && !(etat.maudit && etat.maudit())) return 'réservé aux maudits';
  if (c.notCursed && etat.maudit && etat.maudit()) return 'refusé aux maudits';
  return null;
}

const HINT_KEYWORDS_MAX = 4;     // mots-clés racine glissés dans le salut

// Indice des mots-clés « racine » à glisser dans le salut du PNJ : le premier
// mot-clé de chaque dialogue accessible d'emblée (sans drapeau requis) — le
// reste se découvre en tapant, comme dans T4C.
export function rootKeywordsHint(def) {
  const roots = [];
  for (const dlg of Array.isArray(def?.dialogues) ? def.dialogues : []) {
    if (dlg.conditions?.flag) continue; // réservé : se mérite en jouant
    const k = Array.isArray(dlg.keywords) ? dlg.keywords[0] : null;
    if (k && !roots.includes(k)) roots.push(k);
  }
  if (!roots.length) return null;
  return `(Parlez-moi de ${roots.slice(0, HINT_KEYWORDS_MAX).map(k => `« ${k} »`).join(', ')}.)`;
}

// ---- Répliques : phrases au hasard et variables ----
// Un dialogue peut porter plusieurs répliques (`reponses`), tirées au hasard ;
// sinon `reponse`. Les variables {nom} sont remplacées par leur valeur pour le
// joueur qui parle (calculées par le serveur, ou le simulateur de l'admin).
export const VARIABLES_PHRASE = [
  ['joueur', 'nom du personnage'],
  ['pnj', 'nom du PNJ qui parle'],
  ['niveau', 'niveau du personnage'],
  ['or', 'pièces d’or du personnage'],
  ['tues', 'monstres déjà tués (chasse en cours)'],
  ['total', 'monstres à tuer (chasse en cours)'],
  ['reste', 'monstres qui restent à tuer'],
  ['monstre', 'créature chassée'],
  ['objet', 'objet à rapporter'],
  ['possede', 'exemplaires de cet objet sur le personnage'],
  ['requis', 'exemplaires demandés'],
  ['manque', 'exemplaires qui manquent'],
  ['lieu', 'lieu où se rendre'],
  ['visites', 'fois où le joueur est venu en parler'],
  ['moment', 'moment de la journée (matin, après-midi, soir, nuit)'],
];

export function choisirReponse(dlg, rnd = Math.random) {
  const l = (Array.isArray(dlg?.reponses) ? dlg.reponses : []).filter(s => String(s || '').trim());
  return l.length ? l[Math.floor(rnd() * l.length) % l.length] : String(dlg?.reponse || '...');
}

// variable inconnue laissée telle quelle : une coquille se voit en test
export function remplirPhrase(texte, vars) {
  return String(texte).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k] ?? '') : m));
}

// fraction du cycle jour/nuit (0 = minuit, 0,25 = lever, 0,5 = midi, 0,75 = coucher)
export function momentDuJour(frac) {
  if (frac >= 0.22 && frac < 0.4) return 'matin';
  if (frac >= 0.4 && frac < 0.62) return 'après-midi';
  if (frac >= 0.62 && frac < 0.8) return 'soir';
  return 'nuit';
}
