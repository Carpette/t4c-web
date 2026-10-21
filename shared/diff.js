// Différences entre deux états JSON du contenu (historique de la Forge).
// Une différence = { chemin, avant, apres } au niveau le plus fin utile :
//   - objets comparés clé par clé ;
//   - tableaux d'objets à `id` (sorts, zones, particules...) comparés élément
//     par élément, l'élément étant désigné dans le chemin par « #<id> » ;
//   - tout autre tableau (tuiles d'une carte, listes de pistes) est une valeur.
// `avant` ou `apres` vaut undefined pour un ajout ou une suppression.
// Chaque différence peut être défaite seule (annulerDifferences), tant que la
// valeur actuelle est encore celle qu'elle avait laissée.

const estObjet = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const parId = (t) => Array.isArray(t) && t.every(e => estObjet(e) && (typeof e.id === 'string' || typeof e.id === 'number'));
const segId = (s) => typeof s === 'string' && s.startsWith('#');

export function egal(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((v, i) => egal(v, b[i]));
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every(k => Object.prototype.hasOwnProperty.call(b, k) && egal(a[k], b[k]));
}

export function differences(a, b, max = 500, chemin = [], out = []) {
  if (out.length >= max || egal(a, b)) return out;
  if (estObjet(a) && estObjet(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) differences(a[k], b[k], max, [...chemin, k], out);
    return out;
  }
  if (parId(a) && parId(b) && (a.length || b.length)) {
    const ids = [...new Set([...a, ...b].map(e => String(e.id)))];
    const trouver = (t, id) => t.find(e => String(e.id) === id);
    for (const id of ids) differences(trouver(a, id), trouver(b, id), max, [...chemin, '#' + id], out);
    return out;
  }
  out.push({ chemin, avant: a, apres: b });
  return out;
}

export function lire(racine, chemin) {
  let v = racine;
  for (const s of chemin) {
    if (v == null) return undefined;
    v = segId(s) ? (Array.isArray(v) ? v.find(e => String(e?.id) === s.slice(1)) : undefined) : v[s];
  }
  return v;
}

// écrit `valeur` au chemin (undefined = supprime la clé ou l'élément)
export function ecrire(racine, chemin, valeur) {
  let parent = racine;
  for (let i = 0; i < chemin.length - 1; i++) {
    let v = lire(parent, [chemin[i]]);
    if (v == null) {
      if (valeur === undefined) return;
      v = segId(chemin[i + 1]) ? [] : {};
      if (segId(chemin[i])) parent.push({ id: chemin[i].slice(1), ...v }); else parent[chemin[i]] = v;
      v = lire(parent, [chemin[i]]);
    }
    parent = v;
  }
  const s = chemin[chemin.length - 1];
  if (segId(s)) {
    const i = parent.findIndex(e => String(e?.id) === s.slice(1));
    if (valeur === undefined) { if (i >= 0) parent.splice(i, 1); }
    else if (i >= 0) parent[i] = valeur;
    else parent.push(valeur);
  } else if (valeur === undefined) delete parent[s];
  else parent[s] = valeur;
}

// défait des différences sur l'état actuel ; renvoie le nombre de conflits
// (valeur modifiée depuis : laissée telle quelle)
export function annulerDifferences(courant, diffs) {
  let conflits = 0;
  for (const d of diffs) {
    if (!d.chemin.length) continue;
    if (egal(lire(courant, d.chemin), d.apres)) ecrire(courant, d.chemin, d.avant === undefined ? undefined : JSON.parse(JSON.stringify(d.avant)));
    else conflits++;
  }
  return conflits;
}

// libellé d'une différence : objet concerné (son nom) et champ modifié
export function decrire(d, avant, apres) {
  let nom = null, depuis = 0;
  for (let i = 1; i <= d.chemin.length; i++) {
    const o = lire(apres, d.chemin.slice(0, i)) ?? lire(avant, d.chemin.slice(0, i));
    if (estObjet(o) && (typeof o.name === 'string' || typeof o.nom === 'string')) { nom = o.name || o.nom; depuis = i; }
  }
  const brut = (s) => (segId(s) ? s.slice(1) : s);
  const champ = d.chemin.slice(depuis).map(brut).join('.');
  return { objet: nom || d.chemin.slice(0, Math.max(1, depuis)).map(brut).join('.'), champ };
}

// valeur courte pour l'affichage
export function resume(v, max = 90) {
  if (v === undefined) return null;
  if (Array.isArray(v) && v.length > 6) return `${v.length} éléments`;
  const t = typeof v === 'string' ? v : JSON.stringify(v);
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}
