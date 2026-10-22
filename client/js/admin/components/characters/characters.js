// Joueurs : tous les personnages du serveur (filtres, export CSV, actions
// groupées) et fiche latérale éditable. Modifier un personnage le déconnecte
// (le serveur recharge ses données) ; supprimer efface le personnage, le
// compte reste. Les actions en direct (message, or, téléport, expulsion)
// passent par les mêmes routes que la Carte du monde.
import { STATS } from '../../../../shared/constants.js';
import { allerA, consoleEtat } from '../../console.js';
import { montrerJoueurSurCarte } from '../monde-carte/monde-carte.js';

const NOMS_STATS = { str: 'For', end: 'End', agi: 'Agi', int: 'Int', wis: 'Sag' };
const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const DRAPEAU = /^[\w:.-]{1,60}$/; // clés admises par le serveur
// profil d'un compte dans le sélecteur de la fiche
const valeurProfil = (c, comptes) => c.isAdmin ? 'super' : String(comptes[c.accountId] ?? '');

export function CharactersController(api) {
  return {
    NOMS_STATS, stats: STATS,
    lignes: [], zonesConnues: [], profils: [], comptes: {},   // comptes : accountId -> profilId
    q: '', statut: '', zone: '', profil: '',
    choisi: null, edit: null, drapeauNeuf: '', coches: [],
    message: '', erreur: false, occupe: false,

    peut(droit, n = 2) { const m = consoleEtat.moi; return !!m && (m.isAdmin || (m.droits?.[droit] | 0) >= n); },
    get superAdmin() { return !!consoleEtat.moi?.isAdmin; },

    get enLigne() { return this.lignes.filter(c => c.online).length; },
    get zonesPresentes() { return [...new Set(this.lignes.filter(c => c.char).map(c => c.char.zoneId))].sort((a, b) => a - b); },
    get filtrees() {
      const q = norm(this.q.trim());
      return this.lignes.filter(c => (!this.statut || (this.statut === 'on') === c.online)
        && (this.zone === '' || c.char?.zoneId === +this.zone)
        && (!this.profil || c.profil === this.profil)
        && (!q || norm(c.account).includes(q) || norm(c.char?.name || '').includes(q)));
    },
    get fiche() { return this.lignes.find(c => c.accountId === this.choisi) || null; },
    nomProfil(c) { return c.isAdmin ? 'Super admin' : this.profils.find(p => p.id === this.comptes[c.accountId])?.nom || 'Joueur'; },

    pluriel(n, mot) { return `${n} ${mot}${n > 1 ? 's' : ''}`; },
    nomZone(id) { return this.zonesConnues.find(z => z.id === id)?.name ?? `zone ${id}`; },
    dire(t, err = false) { this.message = t; this.erreur = err; },

    async charger() {
      try {
        const { characters } = await api('/api/admin/characters');
        this.lignes = characters.map(c => ({ ...c, profil: this.nomProfil(c) }));
        const presents = new Set(this.lignes.map(c => c.accountId));
        this.coches = this.coches.filter(id => presents.has(id));
        if (this.fiche) this.ouvrir(this.fiche);
      } catch (e) { this.dire(e.message, true); }
    },

    // facultatif : noms de zones et profils d'accès (droit « Accès et rôles » en lecture)
    async contexte() {
      try { this.zonesConnues = (await api('/api/admin/content/zones')).zones.map(z => ({ id: z.id, name: z.name })); } catch { /* « zone N » */ }
      try {
        const { accounts, profils } = await api('/api/admin/roles');
        this.profils = profils;
        this.comptes = Object.fromEntries(accounts.map(a => [a.id, a.profilId]));
      } catch { /* profils : super admin / joueur seulement */ }
    },

    // ---------- fiche ----------
    ouvrir(c) {
      this.choisi = c.accountId;
      this.drapeauNeuf = '';
      this.edit = {
        profil: valeurProfil(c, this.comptes),
        perso: c.char && {
          level: c.char.level, gold: c.char.gold, zoneId: c.char.zoneId,
          x: Math.round(c.char.x ?? 0), z: Math.round(c.char.z ?? 0),
          stats: { ...(c.char.stats || {}) }, flags: { ...(c.char.flags || {}) },
        },
      };
      // zone inconnue (animateur sans accès aux zones) : la garder sélectionnable
      if (c.char && !this.zonesConnues.some(z => z.id === c.char.zoneId)) {
        this.zonesConnues = [...this.zonesConnues, { id: c.char.zoneId, name: `zone ${c.char.zoneId}` }].sort((a, b) => a.id - b.id);
      }
    },
    get drapeaux() { return Object.keys(this.edit?.perso?.flags || {}); },
    ajouterDrapeau() {
      const k = this.drapeauNeuf.trim();
      if (!DRAPEAU.test(k)) { this.dire('Drapeau : lettres, chiffres, « _ : . - », 60 caractères au plus.', true); return; }
      this.edit.perso.flags = { ...this.edit.perso.flags, [k]: true };
      this.drapeauNeuf = '';
    },
    retirerDrapeau(k) { const f = { ...this.edit.perso.flags }; delete f[k]; this.edit.perso.flags = f; },
    // le profil se règle d'ici si l'on a le droit « Accès et rôles » (le serveur
    // refuse le reste : super admins, son propre compte, profil trop large)
    get profilModifiable() { return this.peut('acces') && !!this.fiche && this.fiche.account !== consoleEtat.moi?.name; },
    get persoModifie() {
      const c = this.fiche?.char, p = this.edit?.perso;
      if (!c || !p) return false;
      const avant = { level: c.level, gold: c.gold, zoneId: c.zoneId, x: Math.round(c.x ?? 0), z: Math.round(c.z ?? 0), stats: c.stats || {}, flags: c.flags || {} };
      return JSON.stringify(avant) !== JSON.stringify({ ...p, stats: { ...p.stats }, flags: { ...p.flags } });
    },
    get profilModifie() { return !!this.fiche && this.edit?.profil !== valeurProfil(this.fiche, this.comptes); },

    async appliquer() {
      const c = this.fiche;
      if (!this.persoModifie && !this.profilModifie) { this.dire('Rien à appliquer.'); return; }
      try {
        if (this.profilModifie) {
          const v = this.edit.profil;
          await api('/api/admin/roles', 'PUT', v === 'super' ? { accountId: c.accountId, superAdmin: true }
            : { accountId: c.accountId, profilId: v === '' ? null : +v, ...(c.isAdmin ? { superAdmin: false } : {}) });
        }
        if (this.persoModifie) {
          // position envoyée seulement si elle a changé : l'arrondi de la
          // fiche déplacerait sinon le personnage d'une fraction de case
          const { x, z, ...corps } = this.edit.perso;
          if (x !== Math.round(c.char.x ?? 0) || z !== Math.round(c.char.z ?? 0)) Object.assign(corps, { x, z });
          await api(`/api/admin/character/${c.accountId}`, 'PUT', corps);
        }
        this.dire(`${c.char?.name || c.account} mis à jour.`);
        await this.contexte();
        await this.charger();
      } catch (e) { this.dire(e.message, true); }
    },

    async supprimer() {
      const c = this.fiche;
      if (!confirm(`Supprimer définitivement le personnage ${c.char.name} (compte ${c.account}) ?`)) return;
      try {
        await api(`/api/admin/character/${c.accountId}`, 'DELETE');
        this.dire(`Personnage de ${c.account} supprimé.`);
        await this.charger();
      } catch (e) { this.dire(e.message, true); }
    },

    // ---------- actions en direct ----------
    allerVers(c) { allerA('carte'); montrerJoueurSurCarte(c.joueurId); },
    async expulser(c) {
      if (!confirm(`Expulser ${c.char.name} ?`)) return;
      try {
        await api(`/api/admin/monde/joueur/${c.joueurId}`, 'POST', { action: 'expulser' });
        this.dire(`${c.char.name} expulsé.`);
        await this.charger();
      } catch (e) { this.dire(e.message, true); }
    },

    // ---------- sélection et actions groupées ----------
    get selection() { return this.lignes.filter(c => this.coches.includes(c.accountId) && c.char); },
    get toutCoche() { return !!this.filtrees.length && this.filtrees.every(c => this.coches.includes(c.accountId)); },
    basculer(c) { this.coches = this.coches.includes(c.accountId) ? this.coches.filter(id => id !== c.accountId) : [...this.coches, c.accountId]; },
    basculerTout() {
      const ids = this.filtrees.map(c => c.accountId);
      this.coches = this.toutCoche ? this.coches.filter(id => !ids.includes(id)) : [...new Set([...this.coches, ...ids])];
    },
    // applique `faire` à chaque personnage choisi ; `horsLigne` : ce qu'on fait
    // d'un joueur déconnecté (null : il est ignoré)
    async grouper(verbe, faire, horsLigne = null) {
      const ok = [], ignores = [], echecs = [];
      this.occupe = true;
      for (const c of this.selection) {
        try {
          if (c.online) await faire(c);
          else if (horsLigne) await horsLigne(c);
          else { ignores.push(c.char.name); continue; }
          ok.push(c.char.name);
        } catch (e) { echecs.push(`${c.char.name} (${e.message})`); }
      }
      this.occupe = false;
      const parts = [ok.length && `${verbe} : ${ok.join(', ')}`, ignores.length && `hors ligne, ignoré${ignores.length > 1 ? 's' : ''} : ${ignores.join(', ')}`,
        echecs.length && `échec : ${echecs.join(', ')}`].filter(Boolean);
      this.dire(parts.join(' · ') || 'Aucun personnage choisi.', !!echecs.length);
      await this.charger();
    },
    async donnerOr() {
      const n = Math.round(+prompt(`Or à donner à ${this.pluriel(this.selection.length, 'personnage')} :`, '100'));
      if (!Number.isFinite(n) || !n) return;
      // en ligne : l'or vivant (la base n'est à jour qu'à la sauvegarde) ;
      // hors ligne : la fiche en base
      await this.grouper(`${n} or donné${n > 1 ? 's' : ''}`, async (c) => {
        const j = await api(`/api/admin/monde/joueur/${c.joueurId}`);
        await api(`/api/admin/monde/joueur/${c.joueurId}`, 'POST', { action: 'etat', gold: Math.max(0, j.gold + n) });
      }, (c) => api(`/api/admin/character/${c.accountId}`, 'PUT', { gold: Math.max(0, c.char.gold + n) }));
    },
    // amène les joueurs choisis auprès de son propre personnage en jeu
    teleporter() { return this.grouper('amené près de vous', (c) => api(`/api/admin/monde/joueur/${c.joueurId}`, 'POST', { action: 'amener' })); },
    async envoyerMessage() {
      const texte = (prompt('Message du maître du jeu :') || '').trim();
      if (!texte) return;
      await this.grouper('message envoyé', (c) => api(`/api/admin/monde/joueur/${c.joueurId}`, 'POST', { action: 'message', texte }));
    },
    async expulserSelection() {
      const enLigne = this.selection.filter(c => c.online);
      if (!enLigne.length) { this.dire('Aucun joueur choisi n’est en ligne.'); return; }
      if (!confirm(`Expulser ${enLigne.map(c => c.char.name).join(', ')} ?`)) return;
      await this.grouper('expulsé', (c) => api(`/api/admin/monde/joueur/${c.joueurId}`, 'POST', { action: 'expulser' }));
    },

    exporter() {
      const champ = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const lignes = [['Compte', 'Personnage', 'Statut', 'Niveau', 'Or', 'Zone', 'Profil'],
        ...this.filtrees.map(c => [c.account, c.char?.name, c.online ? 'en ligne' : 'hors ligne', c.char?.level, c.char?.gold,
          c.char ? this.nomZone(c.char.zoneId) : '', c.profil])];
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob(['﻿' + lignes.map(l => l.map(champ).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
      a.download = 'joueurs.csv';
      a.click();
      URL.revokeObjectURL(a.href);
    },

    async init() {
      await this.contexte();
      await this.charger();
    },
  };
}
