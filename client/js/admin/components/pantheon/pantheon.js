// Panthéon : registre des personnages tombés (100 derniers), statistiques,
// filtres et export CSV. Le serveur enregistre le NOM du tueur : une créature
// porte le nom de sa définition (MOBS), sinon c'est un joueur.
import { MOBS } from '../../../../shared/defs.js';

const SEMAINE = 7 * 24 * 3600e3;
const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// [valeur, effectif] le plus fréquent, ou null
function plusFrequent(valeurs) {
  const n = new Map();
  for (const v of valeurs) n.set(v, (n.get(v) || 0) + 1);
  let best = null;
  for (const e of n) if (!best || e[1] > best[1]) best = e;
  return best;
}

export function PantheonController(api) {
  return {
    morts: [], erreur: '',
    q: '', zone: '', cause: '',

    get zones() { return [...new Set(this.morts.map(d => d.zone))].sort((a, b) => a.localeCompare(b)); },

    get filtres() {
      const q = norm(this.q.trim());
      return this.morts.filter(d => (!this.zone || d.zone === this.zone)
        && (!this.cause || (this.cause === 'joueur') === d.joueur)
        && (!q || norm(d.name).includes(q) || norm(d.killer).includes(q)));
    },

    get stats() {
      const m = this.morts;
      return {
        semaine: m.filter(d => Date.now() - d.died_at < SEMAINE).length,
        tueur: plusFrequent(m.map(d => d.killer)),
        zone: plusFrequent(m.map(d => d.zone)),
        niveau: m.length ? Math.round(m.reduce((s, d) => s + d.level, 0) / m.length) : '—',
      };
    },

    get texteCompte() {
      const n = this.morts.length;
      return n ? `${this.pluriel(n, 'mort')} enregistrée${n > 1 ? 's' : ''}${n >= 100 ? ' (les 100 plus récentes)' : ''}` : '';
    },

    pluriel(n, mot) { return `${n} ${mot}${n > 1 ? 's' : ''}`; },
    date(t) { return new Date(t).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }); },

    async charger() {
      try {
        const { deaths } = await api('/api/admin/pantheon');
        // noms lus ici, après application des surcharges de la Forge
        const creatures = new Set(Object.values(MOBS).map(m => m.name));
        this.morts = deaths.map(d => ({ ...d, joueur: !creatures.has(d.killer) }));
        this.erreur = '';
      } catch (e) {
        this.erreur = e.message;
      }
    },

    exporter() {
      const champ = (v) => `"${String(v).replace(/"/g, '""')}"`;
      const lignes = [['Personnage', 'Niveau', 'Zone', 'Tué par', 'Cause', 'Date'],
        ...this.filtres.map(d => [d.name, d.level, d.zone, d.killer, d.joueur ? 'joueur' : 'créature', new Date(d.died_at).toISOString()])];
      const csv = '﻿' + lignes.map(l => l.map(champ).join(';')).join('\r\n');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      a.download = 'pantheon.csv';
      a.click();
      URL.revokeObjectURL(a.href);
    },

    init() { this.charger(); },
  };
}
