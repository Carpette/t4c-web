// Forge, Objets : édition des objets. Les fiches d'origine restent dans
// shared/defs.js ; l'écran écrit des surcharges dans content/objets.json,
// validées et appliquées à chaud par le serveur (prochains objets générés).
import { MOBS, ITEMS, ORIGINE_ITEMS, SLOT_NAMES } from '../../../../shared/defs.js';
import { chargerSurcharges } from '../../../surcharges.js';
import { chargerRessources, iconeObjet, difference, fixerNombre, norm, copie } from '../../forge.js';

// catégories de la liste -> emplacements
const CATEGORIES = [
  ['armes', 'Armes', ['weapon']],
  ['armures', 'Armures', ['armor', 'legs', 'belt', 'boots', 'gloves', 'helmet', 'shield']],
  ['bijoux', 'Bijoux', ['ring', 'amulet']],
  ['consommables', 'Consommables', ['use']],
  ['monnaie', 'Monnaie', ['gold']],
];
const categorieDe = (slot) => CATEGORIES.find(c => c[2].includes(slot)) || CATEGORIES[0];
const EMPLACEMENTS = [...CATEGORIES.flatMap(c => c[2])];
const NOM_EMPLACEMENT = { ...SLOT_NAMES, ring: 'Anneau', use: 'Consommable', gold: 'Monnaie' };
const STATS = [['str', 'Force'], ['end', 'Endurance'], ['agi', 'Agilité'], ['int', 'Intelligence'], ['wis', 'Sagesse']];

export function ObjetsController(api) {
  let surcharges = {};
  let reference = '';

  return {
    CATEGORIES, EMPLACEMENTS, NOM_EMPLACEMENT, STATS,
    liste: [], q: '', cat: '', vue: 'fiche', tri: 'name', sens: 1,
    courant: null, fiche: null, nouveau: false, nouvelId: '',
    icones: {}, lootCles: [], marchands: [], circulation: null,
    message: '', erreur: false,

    get visibles() {
      const q = norm(this.q.trim());
      const v = this.liste.filter(o => (!this.cat || o.cat === this.cat) && (!q || norm(o.name).includes(q) || o.id.includes(q)));
      const k = this.tri;
      return v.sort((a, b) => (typeof a[k] === 'number' || typeof b[k] === 'number' ? (a[k] ?? -1) - (b[k] ?? -1) : String(a[k] ?? '').localeCompare(String(b[k] ?? ''))) * this.sens);
    },
    get sale() { return !!this.fiche && JSON.stringify(this.fiche) !== reference; },
    get etatCourant() { return this.nouveau ? 'Nouveau' : this.liste.find(o => o.id === this.courant)?.etat || ''; },
    get famille() { return categorieDe(this.fiche?.slot)[0]; },
    get equipable() { return !['use', 'gold'].includes(this.fiche?.slot); },
    // créatures qui lâchent l'objet
    get sources() {
      const out = [];
      for (const [id, m] of Object.entries(MOBS)) for (const d of m.drops || []) {
        if (d[0] === this.courant) out.push({ id, name: m.name, chance: +(d[1] * 100).toFixed(1), qte: d[2] === d[3] ? d[2] : `${d[2]} à ${d[3]}` });
      }
      return out.sort((a, b) => b.chance - a.chance);
    },
    // mêmes règles que Game.npcSellsItem : marchand sans liste -> objets de palier <= zone (max 3)
    get vendeurs() {
      const f = this.fiche;
      if (!f || f.slot === 'gold' || f.legacy || f.zone == null || f.zone > 3) return [];
      return this.marchands.map(m => ({ ...m, des: f.zone }));
    },

    dire(t, err = false) { this.message = t; this.erreur = err; },
    trier(k) { if (this.tri === k) this.sens = -this.sens; else { this.tri = k; this.sens = 1; } },

    rafraichirListe() {
      this.liste = Object.entries(ITEMS).map(([id, o]) => ({
        id, name: o.name, slot: o.slot, cat: categorieDe(o.slot)[0], type: NOM_EMPLACEMENT[o.slot] || o.slot,
        price: o.price, weight: o.weight, zone: o.zone, def: o.def, dmg: o.dmgMin != null ? (o.dmgMin + o.dmgMax) / 2 : null,
        dmgTxt: o.dmgMin != null ? `${o.dmgMin}–${o.dmgMax}` : '', speed: o.speed, legacy: !!o.legacy,
        etat: !(id in ORIGINE_ITEMS) ? 'Créé' : id in surcharges ? 'Modifié' : '',
      }));
      this.chargerIcones();
    },

    async chargerIcones() {
      const ic = { ...this.icones };
      await Promise.all(Object.entries(ITEMS).map(async ([id, o]) => {
        const cle = `${id}|${o.loot}`;
        if (!(cle in ic)) ic[cle] = await iconeObjet(id, o).catch(() => null);
      }));
      this.icones = ic;
    },
    icone(id) { return this.icones[`${id}|${ITEMS[id]?.loot ?? this.fiche?.loot}`] || ''; },
    get iconeFiche() { return this.fiche ? this.icones[`${this.courant}|${this.fiche.loot}`] : ''; },

    ouvrir(id) {
      if (this.sale && id !== this.courant && !confirm('Abandonner les modifications de cet objet ?')) return;
      const def = ITEMS[id];
      if (!def) return;
      this.courant = id; this.nouveau = false; this.vue = 'fiche';
      this.fiche = copie(def);
      reference = JSON.stringify(this.fiche);
      this.dire('');
    },

    dupliquer() {
      if (!this.fiche) return;
      let n = 2; while (ITEMS[`${this.courant}_${n}`]) n++;
      this.nouvelId = `${this.courant}_${n}`;
      this.fiche = { ...copie(this.fiche), name: `${this.fiche.name} (copie)` };
      delete this.fiche.legacy;
      this.nouveau = true;
      reference = '';
      this.dire('Nouvel objet : choisissez son identifiant, puis enregistrez.');
    },

    nombre(k, v) { fixerNombre(this.fiche, k, v); },
    req(s) { return this.fiche.req?.[s] ?? ''; },
    fixerReq(s, v) {
      const r = { ...(this.fiche.req || {}) };
      if (v === '' || +v === 0) delete r[s]; else r[s] = Math.max(0, Math.round(+v));
      this.fiche.req = r;
    },
    drapeau(k, v) { if (v) this.fiche[k] = true; else delete this.fiche[k]; },
    async changerIcone(cle) {
      this.fiche.loot = cle;
      const k = `${this.courant}|${cle}`;
      if (!(k in this.icones)) this.icones = { ...this.icones, [k]: await iconeObjet(this.courant, this.fiche).catch(() => null) };
    },

    // ouvre une fiche sans effacer le message de l'enregistrement qui précède
    rouvrir(id) { const m = this.message, e = this.erreur; this.ouvrir(id); this.dire(m, e); },

    async ecrire(items, succes) {
      try {
        const r = await api('/api/admin/content/objets', 'PUT', { ...this.fichier, items });
        surcharges = items;
        this.fichier = { ...this.fichier, items };
        await chargerSurcharges();
        this.rafraichirListe();
        this.dire(`✔ ${succes} ${r.note || ''}`);
        return true;
      } catch (e) { this.dire('✘ ' + e.message, true); return false; }
    },

    async enregistrer() {
      const id = this.nouveau ? this.nouvelId.trim() : this.courant;
      if (this.nouveau && ITEMS[id]) { this.dire(`✘ L’identifiant « ${id} » existe déjà.`, true); return; }
      const items = { ...surcharges };
      const s = difference(copie(this.fiche), ORIGINE_ITEMS[id]);
      if (Object.keys(s).length) items[id] = s; else delete items[id];
      if (await this.ecrire(items, `${this.fiche.name} enregistré.`)) { this.nouveau = false; this.rouvrir(id); }
    },

    async retablir() {
      if (!confirm(`Rétablir ${ORIGINE_ITEMS[this.courant].name} tel que dans shared/defs.js ?`)) return;
      const items = { ...surcharges };
      delete items[this.courant];
      if (await this.ecrire(items, 'Objet d’origine rétabli.')) this.rouvrir(this.courant);
    },

    async supprimer() {
      if (this.nouveau) { this.nouveau = false; reference = ''; this.fiche = null; this.ouvrir(this.courant); return; }
      if (!confirm(`Supprimer l’objet ${this.fiche.name} (${this.courant}) ? Les exemplaires déjà possédés deviendront illisibles.`)) return;
      const items = { ...surcharges };
      delete items[this.courant];
      if (await this.ecrire(items, 'Objet supprimé.')) { this.fiche = null; this.rouvrir(this.liste[0]?.id); }
    },

    async init() {
      try { this.fichier = await api('/api/admin/content/objets'); surcharges = this.fichier.items || {}; }
      catch (e) { this.dire('✘ ' + e.message, true); this.fichier = { items: {} }; }
      const res = await chargerRessources().catch(() => null);
      this.lootCles = res ? Object.keys(res.manifest.loot).sort() : [];
      try {
        const npcs = (await api('/api/admin/content/npcs')).npc || {};
        this.marchands = Object.entries(npcs).filter(([, n]) => n.role ? n.role === 'merchant' : !n.teacher).map(([id, n]) => ({ id, name: n.name }));
      } catch { /* facultatif */ }
      try { this.circulation = (await api('/api/admin/objets/circulation')).compte; } catch { /* facultatif */ }
      this.rafraichirListe();
      const premier = this.visibles[0];
      if (premier) this.ouvrir(premier.id);
    },
  };
}
