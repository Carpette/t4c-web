// Forge, Publication : d'après la maquette, adaptée au fonctionnement de la
// console où chaque enregistrement s'applique en direct. L'écran liste les
// modifications depuis la dernière version (champ par champ, par domaine),
// permet d'en défaire une, de marquer une version (point de retour) et de
// restaurer une version passée ; il programme aussi le redémarrage du
// serveur avec décompte pour les joueurs (graines et zones l'exigent).

const DOMAINES = [
  ['Sorts et effets', (f) => ['spells', 'skills', 'particles'].includes(f)],
  ['PNJ', (f) => f === 'npcs'],
  ['Créatures', (f) => f === 'creatures'],
  ['Objets', (f) => f === 'objets'],
  ['Zones et terrain', (f) => f === 'zones' || f.startsWith('overrides_')],
  ['Ressources et musiques', () => true],
];
const NOMS_FICHIERS = {
  spells: 'Sorts', skills: 'Compétences', particles: 'Effets visuels', npcs: 'PNJ', creatures: 'Créatures', objets: 'Objets',
  zones: 'Zones', music: 'Musiques', skins: 'Skins', atelier: 'Atelier 2D', templates: 'Modèles de terrain',
};
const DELAIS = [[45, 'Dans 45 secondes'], [300, 'Dans 5 minutes'], [900, 'Dans 15 minutes'], [1800, 'Dans 30 minutes']];

export function PublicationController(api) {
  return {
    DELAIS,
    modifications: [], versions: [], enLigne: 0, production: false, arret: null,
    note: '', delai: 300, chargement: true, message: '', erreur: false, ouvertes: [],

    get domaines() {
      const out = DOMAINES.map(([nom]) => ({ nom, mods: [] }));
      for (const m of this.modifications) out[DOMAINES.findIndex(([, f]) => f(m.fichier))].mods.push(m);
      return out.filter(d => d.mods.length);
    },
    get prochaine() { return (this.versions[0]?.id || 0) + 1; },
    nomFichier(m) { return NOMS_FICHIERS[m.fichier] || m.libelle; },
    ilya(t) {
      const s = Math.max(0, Math.round((Date.now() - t) / 1000));
      if (s < 60) return 'à l’instant';
      if (s < 3600) return `il y a ${Math.round(s / 60)} min`;
      if (s < 86400) return `il y a ${Math.round(s / 3600)} h`;
      return new Date(t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
    },
    date(t) { return new Date(t).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); },
    heure(t) { return new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); },
    lignes(m) { return this.ouvertes.includes(m.id) ? m.lignes : m.lignes.slice(0, 4); },
    basculer(m) { this.ouvertes = this.ouvertes.includes(m.id) ? this.ouvertes.filter(i => i !== m.id) : [...this.ouvertes, m.id]; },
    dire(t, err = false) { this.message = t; this.erreur = err; },

    async charger() {
      try {
        const d = await api('/api/admin/publication');
        Object.assign(this, { modifications: d.modifications, versions: d.versions, enLigne: d.enLigne, production: d.production, arret: d.arret });
      } catch (e) { this.dire(e.message, true); }
      this.chargement = false;
    },
    async annuler(m) {
      if (!confirm(`Défaire cette modification de ${this.nomFichier(m)} (${m.auteur}, ${this.ilya(m.t)}) ? Elle est retirée du jeu à chaud.`)) return;
      try {
        const r = await api(`/api/admin/publication/annuler/${m.id}`, 'POST');
        this.dire(r.conflits ? `Modification défaite en partie : ${r.conflits} valeur${r.conflits > 1 ? 's ont' : ' a'} changé depuis et ${r.conflits > 1 ? 'sont gardées' : 'est gardée'}.` : 'Modification défaite.');
      } catch (e) { this.dire(e.message, true); }
      await this.charger();
    },
    async marquer() {
      try {
        const r = await api('/api/admin/publication/version', 'POST', { note: this.note });
        this.note = '';
        this.dire(`Version v${r.id} marquée : vous pourrez y revenir depuis l’historique.`);
      } catch (e) { this.dire(e.message, true); }
      await this.charger();
    },
    async restaurer(v) {
      if (!confirm(`Restaurer la version v${v.id} ? Tout le contenu modifié depuis reprend son état du ${this.date(v.t)}, à chaud. Les modifications défaites restent dans l’historique.`)) return;
      try {
        const r = await api(`/api/admin/publication/restaurer/${v.id}`, 'POST');
        this.dire(r.fichiers ? `Version v${v.id} restaurée (${r.fichiers} fichier${r.fichiers > 1 ? 's' : ''}).` : `Rien à restaurer : le contenu est déjà celui de la version v${v.id}.`);
      } catch (e) { this.dire(e.message, true); }
      await this.charger();
    },
    async redemarrer() {
      const libelle = DELAIS.find(d => d[0] === this.delai)?.[1].toLowerCase() || '';
      const suite = this.production ? 'Il redémarrera aussitôt.' : 'En local, il ne redémarre pas seul : relancez-le ensuite.';
      if (!confirm(`Arrêter le serveur ${libelle} ? ${this.enLigne} joueur${this.enLigne > 1 ? 's' : ''} en ligne, prévenu${this.enLigne > 1 ? 's' : ''} par un décompte. ${suite}`)) return;
      try {
        const r = await api('/api/admin/publication/redemarrer', 'POST', { secondes: this.delai });
        this.arret = r.arret;
        this.dire(`Redémarrage programmé à ${this.heure(r.arret)}. Les joueurs sont prévenus.`);
      } catch (e) { this.dire(e.message, true); }
    },
    async annulerRedemarrage() {
      try {
        await api('/api/admin/publication/annuler-redemarrage', 'POST');
        this.arret = null;
        this.dire('Redémarrage annulé, les joueurs sont prévenus.');
      } catch (e) { this.dire(e.message, true); }
    },

    // rechargé à chaque ouverture de l'écran (les autres écrans écrivent)
    init() {
      let vu = false;
      setInterval(() => {
        const ici = document.getElementById('tab-publication')?.classList.contains('visible');
        if (ici && !vu) this.charger();
        vu = !!ici;
      }, 400);
    },
  };
}
