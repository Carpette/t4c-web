// Forge, Créatures : édition du bestiaire. Les fiches d'origine restent dans
// shared/defs.js ; l'écran écrit des surcharges dans content/creatures.json,
// validées et appliquées à chaud par le serveur (prochaines apparitions).
import { MOBS, ITEMS, ORIGINE_MOBS } from '../../../../shared/defs.js';
import { mobXpReward } from '../../../../shared/constants.js';
import { chargerSurcharges } from '../../../surcharges.js';
import { chargerRessources, dessinerCreature, difference, fixerNombre, norm, copie } from '../../forge.js';

const CHAMPS = {
  carac: [['level', 'Niveau', 1], ['hp', 'Points de vie', 1], ['dmg', 'Dégâts', 1], ['def', 'Défense', 1]],
  comportement: [['speed', 'Vitesse de course', 0.1], ['atkSpeed', 'Délai d’attaque (s)', 0.1], ['atkRange', 'Portée d’attaque (cases)', 0.1],
    ['aggro', 'Détection (cases)', 1], ['leash', 'Poursuite (cases)', 1]],
};
const ELEMENTS = [['feu', 'Feu'], ['eau', 'Eau'], ['air', 'Air'], ['terre', 'Terre'], ['lumiere', 'Lumière'], ['arcane', 'Arcane']];

export function CreaturesController(api) {
  let surcharges = {};   // contenu de content/creatures.json (mobs)
  let reference = '';    // fiche au chargement, pour savoir si elle a changé

  return {
    CHAMPS, ELEMENTS,
    liste: [], q: '', vue: 'fiche', tri: 'level', sens: 1, courant: null, fiche: null, nouveau: false, nouvelId: '',
    sprites: [], objets: [], zones: [], morts: [], skins: {},
    message: '', erreur: false,

    get visibles() {
      const q = norm(this.q.trim());
      const k = this.tri;
      return this.liste.filter(c => !q || norm(c.name).includes(q) || c.id.includes(q))
        .sort((a, b) => (typeof a[k] === 'string' ? a[k].localeCompare(b[k]) : (a[k] ?? -1) - (b[k] ?? -1)) * this.sens || a.level - b.level);
    },
    trier(k) { if (this.tri === k) this.sens = -this.sens; else { this.tri = k; this.sens = 1; } },
    get sale() { return !!this.fiche && JSON.stringify(this.fiche) !== reference; },
    get etatCourant() { return this.nouveau ? 'Nouvelle' : this.liste.find(c => c.id === this.courant)?.etat || ''; },
    get xp() { return this.fiche?.level ? mobXpReward(this.fiche.level, this.fiche.level) : '—'; },
    get skin() { return this.skins[this.courant] || ''; },
    get zonesDe() { return this.zones.filter(z => (z.mobs || []).includes(this.courant)); },
    get victimes() {
      if (!this.fiche) return null;
      return this.morts.filter(d => d.killer === MOBS[this.courant]?.name).length;
    },
    // écart aux créatures de niveau voisin (PV, dégâts, défense)
    get comparaison() {
      // toujours un objet (n = 0 si rien à comparer) : petite-vue réévalue les
      // enfants avant le v-if parent, un null les ferait planter
      const f = this.fiche;
      const de = Math.max(1, (f?.level || 1) - 3), a = (f?.level || 1) + 2;
      const pairs = f?.level ? Object.entries(MOBS).filter(([id, m]) => id !== this.courant && m.level >= de && m.level <= a) : [];
      if (!pairs.length) return { de, a, n: 0, lignes: [] };
      const moy = (k) => pairs.reduce((s, [, m]) => s + (m[k] || 0), 0) / pairs.length;
      const ecart = (k) => { const m = moy(k); return m ? Math.round(((f[k] || 0) - m) / m * 100) : 0; };
      return { de, a, n: pairs.length, lignes: [['hp', 'Points de vie'], ['dmg', 'Dégâts'], ['def', 'Défense']].map(([k, nom]) => ({ nom, ecart: ecart(k) })) };
    },

    dire(t, err = false) { this.message = t; this.erreur = err; },

    rafraichirListe() {
      this.liste = Object.entries(MOBS).map(([id, m]) => ({
        id, name: m.name, level: m.level, hp: m.hp, dmg: m.dmg, def: m.def, speed: m.speed, atkSpeed: m.atkSpeed, aggro: m.aggro,
        xp: mobXpReward(m.level, m.level), butin: (m.drops || []).length,
        etat: !(id in ORIGINE_MOBS) ? 'Créée' : id in surcharges ? 'Modifiée' : '',
      })).sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
      this.objets = Object.entries(ITEMS).map(([id, o]) => ({ id, name: `${o.name} (${id})` })).sort((a, b) => a.name.localeCompare(b.name));
    },

    ouvrir(id) {
      if (this.sale && id !== this.courant && !confirm('Abandonner les modifications de cette créature ?')) return;
      const def = MOBS[id];
      if (!def) return;
      this.courant = id; this.nouveau = false; this.vue = 'fiche';
      this.fiche = copie({ resist: {}, drops: [], ...def });
      reference = JSON.stringify(this.fiche);
      this.dire('');
      this.apercu();
    },

    dupliquer() {
      if (!this.fiche) return;
      const base = copie(this.fiche);
      let n = 2; while (MOBS[`${this.courant}_${n}`]) n++;
      this.nouvelId = `${this.courant}_${n}`;
      this.fiche = { ...base, name: `${base.name} (copie)` };
      this.nouveau = true;
      reference = '';
      this.dire('Nouvelle créature : choisissez son identifiant, puis enregistrez.');
    },

    nombre(k, v) { fixerNombre(this.fiche, k, v); },
    resist(e) { const v = this.fiche.resist?.[e]; return v == null ? '' : Math.round(v * 100); },
    fixerResist(e, v) {
      const r = { ...(this.fiche.resist || {}) };
      if (v === '' || +v === 0) delete r[e]; else r[e] = Math.round(+v) / 100;
      this.fiche.resist = r;
    },

    apercu() { setTimeout(() => { const cv = document.getElementById('cr-apercu'); if (cv && this.fiche) dessinerCreature(cv, this.courant, this.fiche); }, 0); },

    // ouvre une fiche sans effacer le message de l'enregistrement qui précède
    rouvrir(id) { const m = this.message, e = this.erreur; this.ouvrir(id); this.dire(m, e); },

    async ecrire(mobs, succes) {
      try {
        const r = await api('/api/admin/content/creatures', 'PUT', { ...this.fichier, mobs });
        surcharges = mobs;
        this.fichier = { ...this.fichier, mobs };
        await chargerSurcharges();   // MOBS de l'admin à jour (autres écrans compris)
        this.rafraichirListe();
        this.dire(`✔ ${succes} ${r.note || ''}`);
        return true;
      } catch (e) { this.dire('✘ ' + e.message, true); return false; }
    },

    async enregistrer() {
      const id = this.nouveau ? this.nouvelId.trim() : this.courant;
      if (this.nouveau && MOBS[id]) { this.dire(`✘ L’identifiant « ${id} » existe déjà.`, true); return; }
      const fiche = copie(this.fiche);
      const mobs = { ...surcharges };
      const s = difference(fiche, ORIGINE_MOBS[id]);
      if (Object.keys(s).length) mobs[id] = s; else delete mobs[id];
      if (await this.ecrire(mobs, `${fiche.name} enregistrée.`)) { this.nouveau = false; this.rouvrir(id); }
    },

    async retablir() {
      if (!confirm(`Rétablir ${ORIGINE_MOBS[this.courant].name} telle que dans shared/defs.js ?`)) return;
      const mobs = { ...surcharges };
      delete mobs[this.courant];
      if (await this.ecrire(mobs, 'Créature d’origine rétablie.')) this.rouvrir(this.courant);
    },

    async supprimer() {
      if (this.nouveau) { this.nouveau = false; reference = ''; this.fiche = null; this.ouvrir(this.courant); return; }
      if (!confirm(`Supprimer la créature ${this.fiche.name} (${this.courant}) ?`)) return;
      const mobs = { ...surcharges };
      delete mobs[this.courant];
      if (await this.ecrire(mobs, 'Créature supprimée.')) { this.fiche = null; this.rouvrir(this.liste[0]?.id); }
    },

    async init() {
      try { this.fichier = await api('/api/admin/content/creatures'); surcharges = this.fichier.mobs || {}; }
      catch (e) { this.dire('✘ ' + e.message, true); this.fichier = { mobs: {} }; }
      const res = await chargerRessources().catch(() => null);
      this.sprites = res ? Object.keys(res.manifest.enemies).sort() : [];
      this.skins = res?.skins.mobs || {};
      try { this.zones = (await api('/api/admin/content/zones')).zones; } catch { /* facultatif */ }
      try { this.morts = (await api('/api/admin/pantheon')).deaths; } catch { /* facultatif */ }
      this.rafraichirListe();
      if (this.liste.length) this.ouvrir(this.liste[0].id);
    },
  };
}
