// Panthéon : registre des personnages tombés (100 derniers), statistiques,
// filtres et export CSV, lieu de la mort sur la carte et restauration d'un
// personnage (mort injuste : bogue, déconnexion). Le serveur enregistre le
// NOM du tueur : une créature porte le nom de sa définition (MOBS), sinon
// c'est un joueur.
import { MOBS } from '../../../../shared/defs.js';
import { allerA, consoleEtat, ecranParId, peutVoir } from '../../console.js';
import { montrerPointSurCarte } from '../monde-carte/monde-carte.js';

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
    morts: [], erreur: '', info: '',
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

    get voitCarte() { return peutVoir(ecranParId('carte')); },
    // restaurer : écrire un personnage, droit « Joueurs » en édition
    get peutRestaurer() { const m = consoleEtat.moi; return !!m && (m.isAdmin || (m.droits?.joueurs | 0) >= 2); },
    lieu(d) { allerA('carte'); montrerPointSurCarte(d.zoneId, Math.round(d.x), Math.round(d.z)); },
    async restaurer(d, remplacer = false) {
      if (!remplacer && !confirm(`Rendre ${d.name} (niveau ${d.level}) à son compte, tel qu’il était à sa mort ?`)) return;
      try {
        await api(`/api/admin/pantheon/${d.id}/restaurer`, 'POST', { remplacer });
        this.info = `${d.name} restauré : le joueur le retrouve à sa prochaine connexion.`; this.erreur = '';
        await this.charger();
      } catch (e) {
        // le compte s'est réincarné : on ne remplace qu'après confirmation
        if (!remplacer && /confirmez le remplacement/.test(e.message)) {
          if (confirm(`${e.message.replace(' : confirmez le remplacement', '')}.\nIl sera remplacé par ${d.name} et définitivement perdu. Continuer ?`)) await this.restaurer(d, true);
          return;
        }
        this.erreur = e.message; this.info = '';
      }
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
