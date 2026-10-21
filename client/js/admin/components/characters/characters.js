// Joueurs : tous les personnages du serveur (filtres, export CSV) et fiche
// latérale éditable. Modifier un personnage le déconnecte (le serveur recharge
// ses données) ; supprimer efface le personnage, le compte reste.
import { STATS } from '../../../../shared/constants.js';

const NOMS_STATS = { str: 'For', end: 'End', agi: 'Agi', int: 'Int', wis: 'Sag' };
const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function CharactersController(api) {
  return {
    NOMS_STATS, stats: STATS,
    lignes: [], zonesConnues: [], perms: {},   // perms : accountId -> nb de permissions d'animateur
    q: '', statut: '', zone: '', profil: '',
    choisi: null, edit: null,
    message: '', erreur: false,

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
    get drapeaux() { return Object.keys(this.fiche?.char?.flags || {}); },

    pluriel(n, mot) { return `${n} ${mot}${n > 1 ? 's' : ''}`; },
    nomZone(id) { return this.zonesConnues.find(z => z.id === id)?.name ?? `zone ${id}`; },
    dire(t, err = false) { this.message = t; this.erreur = err; },

    async charger() {
      try {
        const { characters } = await api('/api/admin/characters');
        this.lignes = characters.map(c => ({ ...c, profil: c.isAdmin ? 'Super admin' : (this.perms[c.accountId] ? 'Animateur' : 'Joueur') }));
        if (this.fiche) this.ouvrir(this.fiche);
      } catch (e) { this.dire('✘ ' + e.message, true); }
    },

    // facultatif : noms de zones (super admin) et profils d'animateur (permission « roles »)
    async contexte() {
      try { this.zonesConnues = (await api('/api/admin/content/zones')).zones.map(z => ({ id: z.id, name: z.name })); } catch { /* « zone N » */ }
      try {
        const { accounts } = await api('/api/admin/roles');
        this.perms = Object.fromEntries(accounts.map(a => [a.id, a.perms.length]));
      } catch { /* profils : super admin / joueur seulement */ }
    },

    ouvrir(c) {
      this.choisi = c.accountId;
      this.edit = c.char && {
        level: c.char.level, gold: c.char.gold, zoneId: c.char.zoneId,
        stats: { ...(c.char.stats || {}) },
      };
      // zone inconnue (animateur sans accès aux zones) : la garder sélectionnable
      if (c.char && !this.zonesConnues.some(z => z.id === c.char.zoneId)) {
        this.zonesConnues = [...this.zonesConnues, { id: c.char.zoneId, name: `zone ${c.char.zoneId}` }].sort((a, b) => a.id - b.id);
      }
    },

    async appliquer() {
      const c = this.fiche;
      try {
        await api(`/api/admin/character/${c.accountId}`, 'PUT', this.edit);
        this.dire(`✔ ${c.char.name} mis à jour.`);
        await this.charger();
      } catch (e) { this.dire('✘ ' + e.message, true); }
    },

    async supprimer() {
      const c = this.fiche;
      if (!confirm(`Supprimer définitivement le personnage ${c.char.name} (compte ${c.account}) ?`)) return;
      try {
        await api(`/api/admin/character/${c.accountId}`, 'DELETE');
        this.dire(`✔ Personnage de ${c.account} supprimé.`);
        await this.charger();
      } catch (e) { this.dire('✘ ' + e.message, true); }
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
