// Monde, Accès et rôles : d'après la maquette. Profils (niveau Aucun /
// Lecture / Édition par écran, plus deux autorisations) et comptes (profil
// attribué, super admin). Les garde-fous sont côté serveur (server/admin.js) :
// ici on ne fait que refléter ce que le compte connecté peut faire.
import { copie } from '../../forge.js';

const NIVEAUX = [[0, 'Aucun'], [1, 'Lecture'], [2, 'Édition']];
const vierge = () => ({ id: null, nom: '', droits: {}, animer: false, publier: false });

export function AccessController(api) {
  let reference = '';

  return {
    NIVEAUX,
    onglet: 'profils', comptes: [], profils: [], droits: [], options: [], moiId: null, moi: null,
    courant: null, fiche: null, message: '', erreur: false, q: '',

    get edition() { return !!this.moi && (this.moi.isAdmin || (this.moi.droits?.acces | 0) >= 2); },
    get superAdmin() { return !!this.moi?.isAdmin; },
    get sections() {
      return [['monde', 'Monde', 'en direct, appliqué à chaud'], ['forge', 'Forge', 'contenu du jeu']].map(([id, nom, note]) => ({
        id, nom, note, droits: this.droits.filter(d => d.espace === id), options: this.options.filter(o => o.espace === id),
      }));
    },
    get liste() {
      const n = (pid) => this.comptes.filter(c => !c.isAdmin && c.profilId === pid).length;
      return [
        { id: 'super', nom: 'Super admin', desc: 'Tous les droits, non modifiable', n: this.comptes.filter(c => c.isAdmin).length, fixe: true },
        ...this.profils.map(p => ({ id: p.id, nom: p.nom, desc: this.resume(p), n: n(p.id) })),
        { id: 'joueur', nom: 'Joueur', desc: 'Aucun accès à la console', n: n(null), fixe: true },
      ];
    },
    get comptesFiltres() {
      const q = this.q.trim().toLowerCase();
      return this.comptes.filter(c => !q || c.name.toLowerCase().includes(q));
    },
    get sale() { return !!this.fiche && JSON.stringify(this.fiche) !== reference; },
    // ce que le compte connecté peut accorder (pas d'escalade)
    plafond(id) { return this.superAdmin ? 2 : (this.moi?.droits?.[id] | 0); },
    optionPermise(id) { return this.superAdmin || !!this.moi?.[id]; },
    resume(p) {
      const esp = ['monde', 'forge'].filter(e => this.droits.some(d => d.espace === e && (p.droits[d.id] | 0) > 0));
      return esp.length ? esp.map(e => e === 'monde' ? 'Monde' : 'Forge').join(' et ') : 'Aucun écran';
    },
    nomProfil(c) { return c.isAdmin ? 'Super admin' : this.profils.find(p => p.id === c.profilId)?.nom || 'Joueur'; },
    date(t) { return t ? new Date(t).toLocaleDateString('fr-FR') : ''; },

    dire(t, err = false) { this.message = t; this.erreur = err; },

    ouvrir(id) {
      if (this.sale && id !== this.courant && !confirm('Abandonner les modifications de ce profil ?')) return;
      this.courant = id;
      const p = this.profils.find(x => x.id === id);
      this.fiche = typeof id === 'number' && p ? copie(p) : null;
      reference = JSON.stringify(this.fiche);
      this.dire('');
    },
    nouveau() {
      if (this.sale && !confirm('Abandonner les modifications de ce profil ?')) return;
      this.courant = 'nouveau'; this.fiche = vierge(); reference = '';
      this.dire('');
      setTimeout(() => document.getElementById('ac-nom')?.focus(), 0);
    },
    dupliquer() {
      this.fiche = { ...copie(this.fiche), id: null, nom: `${this.fiche.nom} (copie)` };
      this.courant = 'nouveau'; reference = '';
    },
    fixer(id, n) {
      if (!this.edition || n > this.plafond(id)) return;
      if (n) this.fiche.droits[id] = n; else delete this.fiche.droits[id];
    },
    tout(section, n) { for (const d of section.droits) this.fixer(d.id, Math.min(n, this.plafond(d.id))); },
    async enregistrer() {
      const f = this.fiche;
      if (!f.nom.trim()) { this.dire('✘ Donnez un nom au profil.', true); return; }
      try {
        const r = await api('/api/admin/profils', f.id ? 'PUT' : 'POST', f);
        await this.charger();
        this.ouvrir(r.id);
        this.dire(`✔ Profil « ${f.nom.trim()} » enregistré, appliqué aux comptes connectés.`);
      } catch (e) { this.dire('✘ ' + e.message, true); }
    },
    async supprimer() {
      if (!this.fiche.id) { this.ouvrir('super'); return; }
      if (!confirm(`Supprimer le profil « ${this.fiche.nom} » ?`)) return;
      try {
        await api(`/api/admin/profils/${this.fiche.id}`, 'DELETE');
        reference = JSON.stringify(this.fiche); // évite la confirmation d'abandon
        await this.charger();
        this.ouvrir('super');
        this.dire('✔ Profil supprimé.');
      } catch (e) { this.dire('✘ ' + e.message, true); }
    },

    // ---------- comptes ----------
    peutChanger(c) { return this.edition && c.id !== 1 && (this.superAdmin || (!c.isAdmin && c.id !== this.moiId)); },
    async attribuer(c, valeur) {
      const corps = { accountId: c.id };
      if (valeur === 'super') corps.superAdmin = true;
      else {
        if (c.isAdmin) corps.superAdmin = false;
        corps.profilId = valeur === '' ? null : +valeur;
      }
      try {
        await api('/api/admin/roles', 'PUT', corps);
        await this.charger();
        const n = this.comptes.find(x => x.id === c.id);
        this.dire(`✔ ${c.name} : ${this.nomProfil(n)}. Appliqué à chaud s’il est connecté.`);
      } catch (e) { this.dire('✘ ' + e.message, true); await this.charger(); }
    },

    async charger() {
      const d = await api('/api/admin/roles');
      this.comptes = d.accounts; this.profils = d.profils; this.droits = d.droits; this.options = d.options; this.moiId = d.moi;
    },
    async init() {
      try {
        this.moi = await api('/api/admin/me');
        await this.charger();
        this.ouvrir(this.profils[0]?.id ?? 'super');
      } catch (e) { this.dire('✘ ' + e.message, true); }
    },
  };
}
