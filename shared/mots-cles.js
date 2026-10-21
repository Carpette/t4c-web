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
// sont remplies. `etat` décrit le joueur : { flags, level, gold,
// aObjet(defId) -> bool, maudit: (() -> bool) | null } (maudit null : inconnu).
export function conditionBloquante(c, etat) {
  if (!c) return null;
  if (c.flag && !etat.flags[c.flag]) return `le drapeau ${c.flag} n'est pas posé`;
  if (c.notFlag && etat.flags[c.notFlag]) return `le drapeau ${c.notFlag} est posé`;
  if (c.level && etat.level < c.level) return `niveau ${c.level} requis`;
  if (c.item && !etat.aObjet(c.item)) return `objet ${c.item} requis`;
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
