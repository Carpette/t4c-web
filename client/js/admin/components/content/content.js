// Fichiers bruts : édition directe des fichiers de contenu JSON servis par
// /api/admin/content/<nom>. Le JSON est validé à la frappe ; l'enregistrement
// reste refusé tant qu'il est invalide. La vue « Différences » compare le
// texte édité (non enregistré compris) à l'état de la dernière version.
import { differences, decrire, resume } from '../../../../shared/diff.js';
import { allerA, ecranParId, peutVoir } from '../../console.js';

// ecran : écran dédié au fichier (lien « Ouvrir dans l'écran »)
const FICHIERS = [
  { id: 'zones', nom: 'zones', cle: 'zones', ecran: 'zones', sous: 'zone-props' },
  { id: 'npcs', nom: 'PNJ', cle: 'npc', ecran: 'pnj' },
  { id: 'spells', nom: 'sorts', cle: 'spells', ecran: 'sorts' },
  { id: 'skills', nom: 'compétences', cle: 'skills' },
  { id: 'particles', nom: 'particules', cle: 'particles', ecran: 'effets' },
  { id: 'creatures', nom: 'créatures', cle: 'mobs', ecran: 'creatures' },
  { id: 'objets', nom: 'objets', cle: 'items', ecran: 'objets' },
];
const MAX_DIFFS = 300;

export function ContentController(api) {
  // dernière analyse, réutilisée tant que le texte ne change pas (les getters
  // de petite-vue ne sont pas mémorisés et sont lus plusieurs fois par frappe)
  let memo = { texte: null, res: null };

  return {
    fichiers: FICHIERS,
    courant: 'zones', texte: '', original: '',
    vue: 'fichier', reference: null, // { version, inchange, contenu } de la dernière version
    ligne: 1, colonne: 1,
    message: '', erreur: false,

    get analyse() {
      if (memo.texte !== this.texte) {
        let res;
        try { res = { ok: true, data: JSON.parse(this.texte) }; } catch (e) { res = { ok: false, err: e.message }; }
        memo = { texte: this.texte, res };
      }
      return memo.res;
    },
    get valide() { return this.analyse.ok; },
    get erreurJson() { return this.analyse.err || ''; },
    get modifie() { return this.texte !== this.original; },
    // « 8 zones » : taille de la collection principale du fichier, si elle existe
    get resume() {
      if (!this.valide) return '';
      const d = this.analyse.data;
      const f = FICHIERS.find(x => x.id === this.courant);
      const coll = Array.isArray(d) ? d : d?.[f.cle];
      const n = Array.isArray(coll) ? coll.length : coll && typeof coll === 'object' ? Object.keys(coll).length : null;
      return n == null ? '' : `${n} ${f.nom}`;
    },

    get fiche() { return FICHIERS.find(f => f.id === this.courant); },
    get ecran() { const e = this.fiche.ecran && ecranParId(this.fiche.ecran); return e && peutVoir(e) ? e : null; },
    ouvrirEcran() { allerA(this.ecran.id, this.fiche.sous); },

    // ---------- différences avec la dernière version ----------
    get libelleReference() {
      const v = this.reference?.version;
      return v ? `v${v.id} du ${new Date(v.t).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })}` : 'avant la première modification suivie';
    },
    get diffs() {
      if (!this.reference || !this.valide) return [];
      const avant = this.reference.inchange ? JSON.parse(this.original) : this.reference.contenu;
      const apres = this.analyse.data;
      return differences(avant, apres, MAX_DIFFS).map(d => ({ ...decrire(d, avant, apres), avant: resume(d.avant), apres: resume(d.apres) }));
    },
    async voirDifferences() {
      this.vue = 'diff';
      try { this.reference = await api(`/api/admin/content/${this.courant}/reference`); }
      catch (e) { this.reference = null; this.dire('✘ ' + e.message, true); }
    },

    dire(t, err = false) { this.message = t; this.erreur = err; },

    async ouvrir(id) {
      if (id !== this.courant && this.modifie && !confirm(`Abandonner les modifications de ${this.courant}.json ?`)) return;
      this.courant = id;
      this.reference = null;
      await this.recharger();
      if (this.vue === 'diff') await this.voirDifferences();
    },

    async recharger() {
      try {
        this.texte = this.original = JSON.stringify(await api(`/api/admin/content/${this.courant}`), null, 2);
        this.ligne = this.colonne = 1;
        this.dire('');
      } catch (e) { this.dire('✘ ' + e.message, true); }
    },

    formater() { if (this.valide) this.texte = JSON.stringify(this.analyse.data, null, 2); },

    async enregistrer() {
      if (!this.valide) return;
      try {
        const r = await api(`/api/admin/content/${this.courant}`, 'PUT', this.analyse.data);
        this.original = this.texte;
        this.dire('✔ Enregistré. ' + (r.note || ''));
        if (this.vue === 'diff') await this.voirDifferences();
      } catch (e) { this.dire('✘ ' + e.message, true); }
    },

    curseur(e) {
      const avant = e.target.value.slice(0, e.target.selectionStart).split('\n');
      this.ligne = avant.length;
      this.colonne = avant.at(-1).length + 1;
    },

    init() { this.recharger(); },
  };
}
