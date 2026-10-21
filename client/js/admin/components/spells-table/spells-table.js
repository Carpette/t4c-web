// Sorts, vue tableau : tous les sorts sur une grille éditable pour
// l'équilibrage (filtres par type, modification en masse, export CSV). Les
// modifications restent locales jusqu'à « Enregistrer », qui réécrit
// spells.json comme le fait la vue fiche (spells-editor) ; chaque vue
// recharge l'autre par l'événement « t4c:contenu » après un enregistrement.

export const NOMS_TYPES = { bolt: 'Projectile', aoe: 'Zone', buff: 'Amélioration', heal: 'Soin', '-': 'Non classé' };
const COLONNES = [
  { id: 'level', nom: 'Niveau requis', court: 'Niv.' },
  { id: 'wis', nom: 'Sagesse requise', court: 'Sag.' },
  { id: 'int', nom: 'Intelligence requise', court: 'Int.' },
  { id: 'mana', nom: 'Coût en mana', court: 'Mana' },
];
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

export function SpellsTableController(api) {
  let brut = null;        // fichier complet (garde _note et l'ordre)
  let origine = {};       // id -> copie JSON du sort au chargement

  return {
    NOMS_TYPES, colonnesNum: COLONNES,
    sorts: [], q: '', type: '', selection: [],
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
      const ex = this.sorts.filter(s => this.selection.includes(s.id)).slice(0, 3)
        .map(s => `${s[this.masse.col]} → ${this.calculer(s[this.masse.col], v)}`);
      return 'Résultat : ' + ex.join(', ') + (this.selection.length > 3 ? '…' : '');
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
      for (const s of this.sorts) if (this.selection.includes(s.id)) s[this.masse.col] = this.calculer(s[this.masse.col], v);
      this.dire(`${this.selection.length} sort(s) modifié(s) : pensez à enregistrer.`);
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
      const lignes = [['id', 'Sort', 'Type', ...COLONNES.map(c => c.nom), 'Recharge', 'Effet principal', 'Dégâts moy. / mana'],
        ...this.visibles.map(s => [s.id, s.name, NOMS_TYPES[s.type || '-'], ...COLONNES.map(c => s[c.id]), s.cooldown, s.effects?.[0]?.formula, this.ratio(s)])];
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
