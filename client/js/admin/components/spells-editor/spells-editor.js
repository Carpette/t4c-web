// Forge, Sorts (fiche) : d'après la maquette. La fiche édite une COPIE
// complète du sort : les champs sans contrôle dédié (cast, castMin, todo,
// champs d'effet…) sont conservés tels quels à l'enregistrement.
// Enregistre content/spells.json entier (même route que la vue Tableau) et
// prévient l'autre vue par l'événement t4c:contenu.
import { Particles, emitFromDef, emitTrail, emitImpact, emitGround, emitHeal, emitBuff } from '../../../render2d/particles.js';
import { NOMS_TYPES, moyenneFormule, recharge, NIVEAU_MAX } from '../spells-table/spells-table.js';
import { copie, norm } from '../../forge.js';

const TYPES = [['bolt', 'Projectile'], ['aoe', 'Zone'], ['buff', 'Amélioration'], ['heal', 'Soin'], ['', 'Non classé']];
const ELEMENTS = [['fire', 'Feu'], ['water', 'Eau, glace'], ['air', 'Air, foudre'], ['earth', 'Terre'], ['light', 'Lumière'], ['dark', 'Ténèbres'], ['arcane', 'Arcane'], ['neutre', 'Neutre']];
// types d'effet connus du moteur (server/game/effects.js) et des données
const TYPES_EFFET = [
  ['damage', 'Dégâts'], ['heal', 'Soin'], ['drain', 'Drain de vie'], ['stats_boost', 'Bonus de caractéristique'],
  ['resist_boost', 'Bonus de résistance'], ['power_boost', 'Puissance élémentaire'], ['damage_boost', 'Bonus de dégâts'],
  ['defense_boost', 'Bonus d’armure'], ['hp_boost', 'Bonus de vie max'], ['mp_boost', 'Bonus de mana max'],
  ['hp_regen_boost', 'Régénération de vie'], ['mp_regen_boost', 'Régénération de mana'], ['slow', 'Ralentissement'],
  ['curse', 'Malédiction'], ['invincible', 'Invincibilité'], ['pacified', 'Pacification'], ['retort', 'Riposte'],
  ['light', 'Lumière'], ['damage_over_time', 'Dégâts sur la durée'], ['stun', 'Étourdissement'], ['hide', 'Dissimulation'],
];
const PARAMETRES = ['str', 'end', 'agi', 'int', 'wis', 'hit', 'dodge', 'parry', 'crit', 'pierce', 'stun', 'spellMul', 'fire', 'water', 'air', 'earth', 'light', 'dark', 'arcane'];
// tableau, pas de Set : petite-vue ne sait pas rendre réactives les collections
const AVEC_PARAMETRE = ['stats_boost', 'resist_boost', 'power_boost', 'skill_boost'];
const INSERTIONS = ['self.level', 'self.wis', 'self.int', 'max()', 'min()'];

export function SpellsEditorController(api) {
  let fichier = null;     // content/spells.json complet (_note, ordre)
  let reference = null;   // sort tel qu'au chargement
  let apercu = null;      // { P, raf, t0, cv }
  let fx = [];            // bibliothèque de particules

  return {
    TYPES, ELEMENTS, TYPES_EFFET, PARAMETRES, AVEC_PARAMETRE, INSERTIONS,
    sorts: [], q: '', type: null, courant: null, fiche: null, nouveau: false,
    fxParFamille: [], pnj: {}, message: '', erreur: false,

    // ---------- liste ----------
    typeDe(s) { return s.type || ''; },
    nomType(s) { return NOMS_TYPES[s.type || '-']; },
    get filtres() {
      const n = (t) => this.sorts.filter(s => this.typeDe(s) === t).length;
      return [{ id: null, nom: 'Tous', n: null }, ...TYPES.map(([id, nom]) => ({ id, nom, n: n(id) })).filter(t => t.n)];
    },
    get liste() {
      const q = norm(this.q.trim());
      return this.sorts.filter(s => (this.type === null || this.typeDe(s) === this.type)
        && (!q || norm(s.name).includes(q) || s.id.includes(q)));
    },

    // ---------- état de la fiche ----------
    get modifies() {
      if (!this.fiche || !reference) return [];
      const cles = new Set([...Object.keys(this.fiche), ...Object.keys(reference)]);
      return [...cles].filter(k => JSON.stringify(this.fiche[k]) !== JSON.stringify(reference[k]));
    },
    get sale() { return this.nouveau || this.modifies.length > 0; },
    avant(k) { return reference && JSON.stringify(this.fiche[k]) !== JSON.stringify(reference[k]) ? reference[k] : undefined; },
    get requis() { const r = this.fiche?.requires; return Array.isArray(r) ? r : r ? [r] : []; },
    get requisDispo() { return this.sorts.filter(s => s.id !== this.fiche?.id && !this.requis.includes(s.id)); },
    nomSort(id) { return this.sorts.find(s => s.id === id)?.name || id; },
    get requisPar() { return this.sorts.filter(s => [].concat(s.requires || []).includes(this.courant)); },
    get enseignants() {
      return Object.entries(this.pnj).filter(([, n]) => n.teachesSpells?.[this.courant] !== undefined)
        .map(([id, n]) => ({ id, name: n.name, prix: n.teachesSpells[this.courant] }));
    },

    // ---------- recharge ----------
    get courbe() {
      const f = this.fiche;
      if (!f) return null;
      const n0 = f.level || 1, pts = [];
      // objet complet même en erreur : petite-vue réévalue les enfants avant le v-if parent
      const invalide = { erreur: true, depart: 0, plancher: 0, auNiveau: n0, n0, max: 0, trace: '', xPlancher: 34 };
      for (let n = n0; n <= NIVEAU_MAX; n++) { const v = recharge(f, n); if (v == null) return invalide; pts.push([n, v]); }
      const min = Math.min(...pts.map(p => p[1])), max = Math.max(...pts.map(p => p[1]));
      const plancher = pts.find(p => Math.abs(p[1] - min) < 0.5)[0];
      // tracé 280 × 130 (axes à gauche et en bas)
      const X = (n) => 34 + (n - n0) / Math.max(1, NIVEAU_MAX - n0) * 236;
      const Y = (v) => max === min ? 57 : 10 + (max - v) / (max - min) * 94;
      return {
        depart: Math.round(pts[0][1]), plancher: Math.round(min), auNiveau: plancher, n0, max: Math.round(max),
        trace: pts.map(([n, v], i) => `${i ? 'L' : 'M'}${X(n).toFixed(1)},${Y(v).toFixed(1)}`).join(' '),
        xPlancher: X(plancher),
      };
    },
    inserer(t) {
      const el = document.getElementById('sp-cd');
      const v = String(this.fiche.cooldown ?? '');
      const a = el?.selectionStart ?? v.length, b = el?.selectionEnd ?? v.length;
      this.fiche.cooldown = v.slice(0, a) + t + v.slice(b);
      setTimeout(() => { el?.focus(); const p = a + (t.endsWith('()') ? t.length - 1 : t.length); el?.setSelectionRange(p, p); }, 0);
    },

    // ---------- effets ----------
    moyenne(e) {
      const v = moyenneFormule(e.formula, { level: this.fiche.level || 1, int: this.fiche.int || 0, wis: this.fiche.wis || 0 });
      return v == null ? null : Math.round(v * 10) / 10;
    },
    ajouterEffet() { this.fiche.effects = [...(this.fiche.effects || []), { type: 'damage', formula: '1d6', duration: 0, element: this.fiche.element }]; },
    retirerEffet(i) { this.fiche.effects.splice(i, 1); if (!this.fiche.effects.length) delete this.fiche.effects; },
    champEffet(e, k, v, nombre = false) {
      if (v === '' || v == null) delete e[k];
      else e[k] = nombre ? +String(v).replace(',', '.') : v;
    },

    // ---------- champs ----------
    nombre(k, v) {
      if (v === '' || v == null) { delete this.fiche[k]; return; }
      const n = +String(v).replace(',', '.');
      if (Number.isFinite(n)) this.fiche[k] = n;
    },
    drapeau(k, on) { if (on) this.fiche[k] = true; else delete this.fiche[k]; },
    changerType(t) { if (t) this.fiche.type = t; else delete this.fiche.type; this.rejouer(); },
    ajouterRequis(id) {
      if (!id) return;
      const r = [...this.requis, id];
      this.fiche.requires = r.length === 1 ? r[0] : r;
    },
    retirerRequis(id) {
      const r = this.requis.filter(x => x !== id);
      this.fiche.requires = r.length ? (r.length === 1 ? r[0] : r) : null;
    },
    fixerFx(k, v) {
      const f = { ...(this.fiche.fx || {}) };
      if (v) f[k] = v; else delete f[k];
      if (Object.keys(f).length) this.fiche.fx = f; else delete this.fiche.fx;
      this.rejouer();
    },
    get emplacementsFx() {
      const t = this.fiche?.type;
      return [['trail', 'Traînée (vol)', t === 'bolt'], ['impact', 'Impact (arrivée)', t === 'bolt' || t === 'aoe'],
        ['ground', 'Zone au sol', t === 'aoe'], ['self', 'Sur le lanceur / la cible', true]].filter(e => e[2] || this.fiche?.fx?.[e[0]]);
    },

    dire(t, err = false) { this.message = t; this.erreur = err; },

    ouvrir(id) {
      if (this.sale && id !== this.courant && !confirm('Abandonner les modifications de ce sort ?')) return;
      const s = this.sorts.find(x => x.id === id);
      if (!s) return;
      this.courant = id; this.nouveau = false;
      this.fiche = copie(s);
      reference = copie(s);
      this.dire('');
      this.rejouer();
    },
    annuler() { if (this.nouveau) { this.nouveau = false; this.ouvrir(this.sorts[0]?.id); } else this.ouvrir(this.courant); },

    dupliquer(vierge = false) {
      if (this.sale && !confirm('Abandonner les modifications de ce sort ?')) return;
      const base = vierge || !this.fiche
        ? { name: 'Nouveau sort', level: 1, wis: 0, int: 0, requires: null, mana: 1, type: 'bolt', range: 9, color: '#ffffff', element: 'neutre', cooldown: '1500', effects: [] }
        : { ...copie(this.fiche), name: `${this.fiche.name} (copie)` };
      let n = 2, racine = vierge ? 'nouveau_sort' : this.courant;
      while (this.sorts.some(s => s.id === `${racine}_${n}`)) n++;
      this.fiche = { ...base, id: `${racine}_${n}` };
      reference = null; this.nouveau = true;
      this.dire('Nouveau sort : choisissez son identifiant, puis enregistrez.');
    },

    async ecrire(sorts, succes) {
      try {
        await api('/api/admin/content/spells', 'POST', { ...fichier, spells: sorts });
        fichier = { ...fichier, spells: sorts };
        this.sorts = sorts;
        window.dispatchEvent(new CustomEvent('t4c:contenu', { detail: { nom: 'spells', source: 'fiche' } }));
        this.dire(succes);
        return true;
      } catch (e) { this.dire(e.message, true); return false; }
    },

    async enregistrer() {
      const f = copie(this.fiche);
      f.id = String(f.id || '').trim();
      if (!String(f.cooldown ?? '').trim()) delete f.cooldown; // repli : cast / castMin / castStep
      if (!/^[a-z0-9_]{1,60}$/.test(f.id)) { this.dire('Identifiant : minuscules, chiffres et _ uniquement.', true); return; }
      if (this.nouveau && this.sorts.some(s => s.id === f.id)) { this.dire(`L’identifiant « ${f.id} » existe déjà.`, true); return; }
      if (!f.name?.trim()) { this.dire('Le nom est obligatoire.', true); return; }
      if (f.cooldown && this.courbe?.erreur) { this.dire('La formule de recharge n’est pas valide.', true); return; }
      const sorts = this.nouveau ? [...this.sorts, f] : this.sorts.map(s => s.id === this.courant ? f : s);
      if (await this.ecrire(sorts, `${f.name} enregistré.`)) {
        const m = this.message; this.nouveau = false; reference = null; this.ouvrir(f.id); this.dire(m);
      }
    },

    async supprimer() {
      if (this.nouveau) { this.annuler(); return; }
      const deps = [...this.requisPar.map(s => s.name), ...this.enseignants.map(n => n.name)];
      if (!confirm(`Supprimer le sort ${this.fiche.name} ?${deps.length ? `\nIl est encore cité par : ${deps.join(', ')}.` : ''}`)) return;
      const id = this.courant;
      if (await this.ecrire(this.sorts.filter(s => s.id !== id), 'Sort supprimé.')) { reference = null; this.fiche = null; this.ouvrir(this.sorts[0]?.id); }
    },

    // ---------- aperçu : le lanceur à gauche, la cible à droite ----------
    rejouer() {
      setTimeout(() => {
        const cv = document.getElementById('sp-apercu');
        if (!cv || !this.fiche) return;
        if (!apercu || apercu.cv !== cv) {
          if (apercu) cancelAnimationFrame(apercu.raf);
          apercu = { cv, g: cv.getContext('2d'), P: new Particles(), t: 0, last: performance.now(), raf: 0 };
          const boucle = (now) => { apercu.raf = requestAnimationFrame(boucle); this.image(now); };
          apercu.raf = requestAnimationFrame(boucle);
        }
        apercu.P.pool.forEach(p => { p.on = false; });
        apercu.t = 0; apercu.impact = false; apercu.sol = 0;
      }, 0);
    },
    image(now) {
      const a = apercu, f = this.fiche;
      if (!a || !f || !a.cv.isConnected) return;
      const dt = Math.min(0.05, (now - a.last) / 1000); a.last = now; a.t += dt;
      const def = (k) => (f.fx?.[k] ? fx.find(p => p.id === f.fx[k]) : null);
      const el = f.element, L = -3, C = 3;   // positions en tuiles
      const t = f.type;
      if (t === 'bolt') {
        const vol = 0.6;
        if (a.t < vol) {
          const x = L + (C - L) * (a.t / vol);
          if (def('trail')) emitFromDef(a.P, def('trail'), x, 0, { raw: true }); else emitTrail(a.P, el, x, 0);
        } else if (!a.impact) {
          a.impact = true;
          if (def('impact')) emitFromDef(a.P, def('impact'), C, 0, { burst: true, raw: true }); else emitImpact(a.P, el, C, 0);
        }
      } else if (t === 'aoe') {
        if (a.sol < 6 && a.t > a.sol * 0.15) {
          a.sol++;
          if (def('ground')) emitFromDef(a.P, def('ground'), C, 0, { raw: true }); else emitGround(a.P, el, C, 0, Math.min(3, f.radius || 2));
        }
        if (!a.impact) { a.impact = true; if (def('impact')) emitFromDef(a.P, def('impact'), C, 0, { burst: true, raw: true }); }
      } else if (!a.impact) {
        a.impact = true;
        const cible = t === 'buff' || t === 'heal' ? L : C;
        if (def('self')) emitFromDef(a.P, def('self'), cible, 0, { burst: true, raw: true });
        else if (t === 'heal') emitHeal(a.P, cible, 0);
        else emitBuff(a.P, cible, 0, f.color);
      }
      if (a.t > 2.2) this.rejouer();
      a.P.update(dt);
      const { g, cv } = a, k = cv.width / 9;
      g.clearRect(0, 0, cv.width, cv.height);
      for (const [x, nom] of [[L, 'Lanceur'], [C, 'Cible']]) {
        const px = cv.width / 2 + x * k, py = cv.height * 0.68;
        g.fillStyle = '#23262c'; g.beginPath(); g.ellipse(px, py, 18, 8, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#5a5f69'; g.fillRect(px - 5, py - 34, 10, 30);
        g.fillStyle = '#8b8f98'; g.font = '11px Inter, sans-serif'; g.textAlign = 'center'; g.fillText(nom, px, py + 22);
      }
      a.P.draw(g, (x, z) => ({ x: cv.width / 2 + x * k, y: cv.height * 0.68 + z * k * 0.5 }), 1);
    },

    async init() {
      try {
        fichier = await api('/api/admin/content/spells');
        this.sorts = fichier.spells || [];
      } catch (e) { this.dire(e.message, true); }
      try { fx = (await api('/api/admin/content/particles')).particles || []; } catch { fx = []; }
      const familles = {};
      for (const p of fx) (familles[p.id.includes('_') ? p.id.split('_')[0] : 'divers'] ||= []).push(p);
      this.fxParFamille = Object.keys(familles).sort().map(f => ({ famille: f, effets: familles[f] }));
      try { this.pnj = (await api('/api/admin/content/npcs')).npc || {}; } catch { /* facultatif */ }
      // la vue Tableau ouvre un sort dans la fiche (clic sur son nom)
      window.addEventListener('t4c:ouvrir', (e) => { if (e.detail?.nom === 'spells') this.ouvrir(e.detail.id); });
      // la vue Tableau a enregistré spells.json : recharger (sans perdre un brouillon)
      window.addEventListener('t4c:contenu', async (e) => {
        if (e.detail?.nom !== 'spells' || e.detail.source === 'fiche') return;
        fichier = await api('/api/admin/content/spells');
        this.sorts = fichier.spells || [];
        if (!this.sale && this.courant) this.ouvrir(this.courant);
      });
      if (this.sorts.length) this.ouvrir(this.sorts[0].id);
    },
  };
}
