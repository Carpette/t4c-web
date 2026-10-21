// Sorts, vue tableau : tous les sorts sur une grille éditable pour
// l'équilibrage (filtres par type, modification en masse, export CSV). Les
// modifications restent locales jusqu'à « Enregistrer », qui réécrit
// spells.json comme le fait la vue fiche (spells-editor) ; chaque vue
// recharge l'autre par l'événement « t4c:contenu » après un enregistrement.
import { allerA } from '../../console.js';

export const NOMS_TYPES = { bolt: 'Projectile', aoe: 'Zone', buff: 'Amélioration', heal: 'Soin', '-': 'Non classé' };
// colonnes numériques éditables ; `cachee` : masquée tant qu'on ne la demande pas
const COLONNES = [
  { id: 'level', nom: 'Niveau requis', court: 'Niv.' },
  { id: 'wis', nom: 'Sagesse requise', court: 'Sag.' },
  { id: 'int', nom: 'Intelligence requise', court: 'Int.' },
  { id: 'mana', nom: 'Coût en mana', court: 'Mana' },
  { id: 'range', nom: 'Portée (cases)', court: 'Portée', cachee: true },
  { id: 'radius', nom: 'Rayon (cases)', court: 'Rayon', cachee: true },
];
// autres colonnes que l'on peut masquer (les calculées sont en lecture seule)
const AUTRES = [
  { id: 'cooldown', nom: 'Recharge (formule)' },
  { id: 'rechargeMax', nom: 'Recharge au niveau requis (calculée)' },
  { id: 'rechargeMin', nom: 'Recharge plancher (calculée)' },
  { id: 'effet', nom: 'Effet principal' },
  { id: 'ratio', nom: 'Dégâts moyens / mana (calculé)' },
];
const CLE_COLONNES = 't4c_sorts_colonnes_cachees';
export const NIVEAU_MAX = 100;
const lireCachees = () => {
  try { const v = JSON.parse(localStorage.getItem(CLE_COLONNES)); if (Array.isArray(v)) return v; } catch { /* stockage indisponible */ }
  return COLONNES.filter(c => c.cachee).map(c => c.id);
};
const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const nombre = (v) => { const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : null; };

// Valeur MOYENNE d'une formule de sort (1d17 + 6 + self.buff_stats.int / 23) :
// dés remplacés par leur espérance, variables du lanceur par les valeurs
// données ; seul ce qui reste est une expression arithmétique (liste blanche).
export function moyenneFormule(formule, lanceur) {
  if (typeof formule !== 'string') return null;
  const expr = formule
    .replace(/(\d+)d(\d+)/gi, (_, n, f) => `(${n}*${(+f + 1) / 2})`)
    .replace(/self\.(?:buff_stats\.)?(level|int|wis|str|agi|end)\b/g, (_, k) => String(lanceur[k] ?? 0));
  if (!/^[\d\s+\-*/().,]*$/.test(expr.replace(/\b(?:max|min|floor|ceil|round)\b/g, ''))) return null;
  try {
    // eslint-disable-next-line no-new-func
    const v = new Function('max', 'min', 'floor', 'ceil', 'round', `return (${expr});`)(Math.max, Math.min, Math.floor, Math.ceil, Math.round);
    return Number.isFinite(v) ? v : null;
  } catch { return null; }
}

// recharge (ms) d'une formule à un niveau donné, comme castTimeMs côté serveur
// (ou null si l'expression n'est pas évaluable ici)
export function recharge(sort, niveau) {
  if (sort.cooldown) return moyenneFormule(String(sort.cooldown), { level: niveau, int: sort.int, wis: sort.wis });
  const lent = (sort.cast ?? 1.5) * 1000, rapide = (sort.castMin ?? 1) * 1000, pas = (sort.castStep ?? 0.02) * 1000;
  return Math.max(rapide, lent - Math.max(0, niveau - (sort.level || 1)) * pas);
}
const ms = (v) => (v == null ? '?' : Math.round(v).toLocaleString('fr-FR'));
// plancher de recharge : 100 évaluations de formule par sort, gardées tant que
// les champs dont il dépend ne changent pas (le tableau se redessine à la frappe)
const planchers = new Map();
function plancher(s) {
  const cle = JSON.stringify([s.cooldown, s.level, s.int, s.wis, s.cast, s.castMin, s.castStep]);
  if (!planchers.has(cle)) {
    let min = Infinity;
    for (let n = s.level || 1; n <= NIVEAU_MAX && min !== null; n++) { const v = recharge(s, n); min = v == null ? null : Math.min(min, v); }
    planchers.set(cle, min);
  }
  return planchers.get(cle);
}

export function SpellsTableController(api) {
  let brut = null;        // fichier complet (garde _note et l'ordre)
  let origine = {};       // id -> copie JSON du sort au chargement

  return {
    NOMS_TYPES, colonnesToutes: COLONNES, autres: AUTRES,
    sorts: [], q: '', type: '', selection: [], cachees: lireCachees(),
    masse: { col: 'mana', op: 'mul', v: '1,1' },
    message: '', erreur: false,

    get filtresType() {
      const n = (t) => this.sorts.filter(s => (s.type || '-') === t).length;
      return [{ id: '', nom: 'Tous', n: null }, ...['bolt', 'aoe', 'buff', 'heal', '-'].map(t => ({ id: t, nom: NOMS_TYPES[t], n: n(t) })).filter(t => t.n)];
    },
    get visibles() {
      const q = norm(this.q.trim());
      return this.sorts.filter(s => (!this.type || (s.type || '-') === this.type) && (!q || norm(s.name).includes(q) || s.id.includes(q)));
    },
    get toutCoche() { return this.visibles.length > 0 && this.visibles.every(s => this.selection.includes(s.id)); },
    get nbModifies() { return this.sorts.filter(s => JSON.stringify(s) !== origine[s.id]).length; },
    get valeurMasse() { return nombre(this.masse.v); },
    get apercuMasse() {
      const v = this.valeurMasse;
      if (v === null) return 'Valeur invalide';
      const ex = this.sorts.filter(s => this.selection.includes(s.id) && this.modifiable(s)).slice(0, 3)
        .map(s => `${s[this.masse.col]} → ${this.calculer(s[this.masse.col], v)}`);
      if (!ex.length) return 'Aucun sort choisi n’a cette valeur';
      return 'Résultat : ' + ex.join(', ') + (this.selection.length > 3 ? '…' : '');
    },

    // ---------- colonnes ----------
    get colonnesNum() { return COLONNES.filter(c => !this.cachees.includes(c.id)); },
    voit(id) { return !this.cachees.includes(id); },
    basculerColonne(id) {
      this.cachees = this.voit(id) ? [...this.cachees, id] : this.cachees.filter(x => x !== id);
      try { localStorage.setItem(CLE_COLONNES, JSON.stringify(this.cachees)); } catch { /* préférence perdue au rechargement */ }
    },
    get nbColonnes() { return 3 + this.colonnesNum.length + AUTRES.filter(c => this.voit(c.id)).length; },
    // recharge au niveau requis et plancher (le minimum jusqu'au niveau maximal)
    rechargeMax(s) { return ms(recharge(s, s.level || 1)); },
    rechargeMin(s) { return ms(plancher(s)); },
    ouvrirFiche(s) {
      allerA('sorts', 'spells-editor');
      window.dispatchEvent(new CustomEvent('t4c:ouvrir', { detail: { nom: 'spells', id: s.id } }));
    },

    dire(t, err = false) { this.message = t; this.erreur = err; },
    modifie(s, k) { const o = origine[s.id]; return !!o && JSON.stringify(JSON.parse(o)[k]) !== JSON.stringify(s[k]); },
    modifieEffet(s) { const o = origine[s.id]; return !!o && JSON.parse(o).effects?.[0]?.formula !== s.effects?.[0]?.formula; },

    ratio(s) {
      const f = s.effects?.find(e => e.type === 'damage' || e.type === 'heal' || e.type === 'drain');
      if (!f || !s.mana) return '·';
      const m = moyenneFormule(f.formula, { level: s.level, int: s.int, wis: s.wis });
      return m === null ? '?' : (m / s.mana).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    },

    modifiable(s) { return this.masse.op === 'set' || typeof s[this.masse.col] === 'number'; },
    calculer(x, v) {
      const r = this.masse.op === 'mul' ? x * v : this.masse.op === 'add' ? x + v : v;
      return Math.max(0, Math.round(r));
    },

    cocher(id, oui) { this.selection = oui ? [...new Set([...this.selection, id])] : this.selection.filter(x => x !== id); },
    toutCocher(oui) {
      const ids = this.visibles.map(s => s.id);
      this.selection = oui ? [...new Set([...this.selection, ...ids])] : this.selection.filter(x => !ids.includes(x));
    },

    fixer(s, k, v) { if (typeof v === 'number' && !Number.isFinite(v)) return; s[k] = v; },
    fixerEffet(s, v) { s.effects[0].formula = v; },

    appliquerMasse() {
      const v = this.valeurMasse;
      if (v === null) return;
      // un sort sans cette valeur (portée, rayon) n'est pas touché, sauf « Fixer à »
      const cibles = this.sorts.filter(s => this.selection.includes(s.id) && this.modifiable(s));
      for (const s of cibles) s[this.masse.col] = this.calculer(s[this.masse.col], v);
      this.dire(`${cibles.length} sort(s) modifié(s) : pensez à enregistrer.`);
    },

    async charger() {
      try {
        brut = await api('/api/admin/content/spells');
        origine = Object.fromEntries(brut.spells.map(s => [s.id, JSON.stringify(s)]));
        this.sorts = brut.spells.map(s => JSON.parse(JSON.stringify(s)));
        this.selection = this.selection.filter(id => origine[id]);
        this.dire('');
      } catch (e) { this.dire('✘ ' + e.message, true); }
    },

    async enregistrer() {
      try {
        const sorts = JSON.parse(JSON.stringify(this.sorts));
        await api('/api/admin/content/spells', 'POST', { ...brut, spells: sorts });
        const n = this.nbModifies;
        await this.charger();
        this.dire(`✔ ${n} sort(s) enregistré(s), appliqué à chaud.`);
        window.dispatchEvent(new CustomEvent('t4c:contenu', { detail: { nom: 'spells', source: 'tableau' } }));
      } catch (e) { this.dire('✘ ' + e.message, true); }
    },

    exporter() {
      const champ = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const lignes = [['id', 'Sort', 'Type', ...COLONNES.map(c => c.nom), 'Recharge', 'Recharge au niveau requis (ms)', 'Recharge plancher (ms)', 'Effet principal', 'Dégâts moy. / mana'],
        ...this.visibles.map(s => [s.id, s.name, NOMS_TYPES[s.type || '-'], ...COLONNES.map(c => s[c.id]), s.cooldown,
          this.rechargeMax(s), this.rechargeMin(s), s.effects?.[0]?.formula, this.ratio(s)])];
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob(['﻿' + lignes.map(l => l.map(champ).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
      a.download = 'sorts.csv';
      a.click();
      URL.revokeObjectURL(a.href);
    },

    init() {
      this.charger();
      // la vue fiche a enregistré : on recharge, sauf modifications en cours ici
      window.addEventListener('t4c:contenu', (e) => {
        if (e.detail?.nom === 'spells' && e.detail.source !== 'tableau' && !this.nbModifies) this.charger();
      });
    },
  };
}
