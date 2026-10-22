// Forge, Effets visuels : d'après la maquette. Bibliothèque de particules
// (content/particles.json), aperçu en direct par le même émetteur que le jeu
// (emitFromDef), et sorts qui utilisent chaque effet.
import { Particles, emitFromDef } from '../../../render2d/particles.js';
import { copie, norm } from '../../forge.js';

// familles par préfixe (cf. _note de particles.json)
const FAMILLES = [
  ['proj_', 'Traînées de projectile', true], ['imp_', 'Impacts', false], ['sol_', 'Zones au sol', true],
  ['soin_', 'Soins', false], ['bouclier_', 'Boucliers', false], ['buff_', 'Améliorations', false],
  ['malefice_', 'Maléfices', false], ['event_', 'Événements', false],
];
const HISTORIQUES = ['Effets historiques', /_(trail|impact)$/];
const continu = (id) => /_trail$|^proj_|^sol_|_stream$/.test(id);
const SPAWNS = [['point', 'Point'], ['ring', 'Anneau au sol'], ['circle', 'Disque au sol'], ['sphere', 'Sphère autour du torse']];
const MOUVEMENTS = [['outward', 'Dispersion vers l’extérieur'], ['upward', 'Vers le haut'], ['orbit', 'En orbite'], ['random', 'Aléatoire']];
const PHYSIQUE = [
  ['size', 'Taille', 0, 10, 0.1], ['gravity', 'Gravité (px/s²)', -300, 300, 1], ['speed', 'Vitesse (cases/s)', 0, 8, 0.1],
  ['density', 'Densité (par émission)', 1, 20, 1], ['life', 'Durée de vie (s)', 0.05, 3, 0.05], ['drag', 'Frottement', 0.8, 1, 0.01],
];
const FONDS = [['sombre', 'Sombre', '#0b0c0f'], ['herbe', 'Herbe', '#24361f'], ['paves', 'Pavés de nuit', '#262830']];
// effets appelés directement par le code du jeu (server/game/dialogues.js, prêtre)
const USAGES_JEU = { soin_majeur: 'Prêtre : soin complet', sol_benediction: 'Prêtre : levée de malédiction', bouclier_sacre: 'Prêtre : bénédiction' };

export function ParticleEditorController(api) {
  let fichier = null, reference = null, anim = null;

  return {
    SPAWNS, MOUVEMENTS, PHYSIQUE, FONDS,
    effets: [], sorts: [], q: '', courant: null, fiche: null, nouveau: false,
    boucle: true, fond: 'sombre', message: '', erreur: false,

    famille(id) {
      const f = FAMILLES.find(([p]) => id.startsWith(p));
      return f ? f[1] : HISTORIQUES[1].test(id) ? HISTORIQUES[0] : 'Divers';
    },
    get groupes() {
      const q = norm(this.q.trim()), g = new Map();
      for (const e of this.effets) {
        if (q && !norm(e.name).includes(q) && !e.id.includes(q)) continue;
        const f = this.famille(e.id);
        if (!g.has(f)) g.set(f, []);
        g.get(f).push(e);
      }
      const ordre = [...FAMILLES.map(f => f[1]), HISTORIQUES[0], 'Divers'];
      return [...g].sort((a, b) => ordre.indexOf(a[0]) - ordre.indexOf(b[0])).map(([nom, effets]) => ({ nom, effets }));
    },
    get sale() { return this.nouveau || (!!this.fiche && JSON.stringify(this.fiche) !== JSON.stringify(reference)); },
    get utilisePar() {
      const id = this.courant, out = [];
      for (const s of this.sorts) for (const [k, v] of Object.entries(s.fx || {})) if (v === id) out.push({ id: s.id, name: s.name, role: { trail: 'traînée', impact: 'impact', ground: 'zone au sol', self: 'sur la cible' }[k] || k });
      return out;
    },
    get usageJeu() { return USAGES_JEU[this.courant] || ''; },
    get couleurFond() { return FONDS.find(f => f[0] === this.fond)[2]; },

    dire(t, err = false) { this.message = t; this.erreur = err; },

    ouvrir(id) {
      if (this.sale && id !== this.courant && !confirm('Abandonner les modifications de cet effet ?')) return;
      const e = this.effets.find(x => x.id === id);
      if (!e) return;
      this.courant = id; this.nouveau = false;
      this.fiche = copie(e); reference = copie(e);
      this.boucle = continu(id);
      this.dire('');
      this.demarrer();
    },
    dupliquer() {
      if (!this.fiche) return;
      let n = 2; while (this.effets.some(e => e.id === `${this.courant}_${n}`)) n++;
      this.fiche = { ...copie(this.fiche), id: `${this.courant}_${n}`, name: `${this.fiche.name} (copie)` };
      this.nouveau = true; reference = null;
      this.dire('Nouvel effet : le préfixe de l’identifiant (proj_, imp_, sol_…) le range dans sa famille.');
    },
    annuler() { this.nouveau = false; this.ouvrir(this.courant); },

    nombre(k, v) {
      const n = +String(v).replace(',', '.');
      if (v === '' || !Number.isFinite(n)) { if (k.startsWith('offset')) delete this.fiche[k]; return; }
      this.fiche[k] = n;
    },
    couleur(i, v) { this.fiche.colors[i] = v; },
    ajouterCouleur() { this.fiche.colors = [...(this.fiche.colors || []), this.fiche.colors?.at(-1) || '#ffffff']; },
    retirerCouleur(i) { if (this.fiche.colors.length > 1) this.fiche.colors.splice(i, 1); },

    // ---------- aperçu ----------
    demarrer() {
      setTimeout(() => {
        const cv = document.getElementById('pe-apercu');
        if (!cv) return;
        if (anim?.cv !== cv) {
          if (anim) cancelAnimationFrame(anim.raf);
          anim = { cv, g: cv.getContext('2d'), P: new Particles(), last: performance.now(), t: 0, raf: 0 };
          const boucle = (now) => { anim.raf = requestAnimationFrame(boucle); this.image(now); };
          anim.raf = requestAnimationFrame(boucle);
        }
        anim.P.pool.forEach(p => { p.on = false; });
        anim.t = 0; anim.prochain = 0;
      }, 0);
    },
    declencher() { if (anim && this.fiche) emitFromDef(anim.P, this.fiche, 0, 0, { burst: true, raw: true }); },
    image(now) {
      const a = anim;
      if (!a || !this.fiche || !a.cv.isConnected) return;
      const dt = Math.min(0.05, (now - a.last) / 1000); a.last = now; a.t += dt;
      if (this.boucle) emitFromDef(a.P, this.fiche, 0, 0, { raw: true });
      else if (a.t >= a.prochain) { this.declencher(); a.prochain = a.t + Math.max(0.8, (this.fiche.life || 0.5) + 0.5); }
      a.P.update(dt);
      const { g, cv } = a, k = cv.width / 8, cx = cv.width / 2, cy = cv.height * 0.62;
      g.fillStyle = this.couleurFond; g.fillRect(0, 0, cv.width, cv.height);
      // repère : losange d'une case et silhouette (échelle du jeu)
      g.strokeStyle = 'rgba(255,255,255,.12)'; g.beginPath();
      g.moveTo(cx, cy - k / 2); g.lineTo(cx + k, cy); g.lineTo(cx, cy + k / 2); g.lineTo(cx - k, cy); g.closePath(); g.stroke();
      g.fillStyle = 'rgba(255,255,255,.08)'; g.fillRect(cx - 6, cy - 46, 12, 44);
      a.P.draw(g, (x, z) => ({ x: cx + (x - z) * k, y: cy + (x + z) * k / 2 }), 1);
    },

    // ---------- enregistrement ----------
    async ecrire(effets, succes) {
      try {
        await api('/api/admin/content/particles', 'POST', { ...fichier, particles: effets });
        fichier = { ...fichier, particles: effets }; this.effets = effets;
        this.dire(succes + ' Les joueurs le verront au prochain chargement de page.');
        return true;
      } catch (e) { this.dire(e.message, true); return false; }
    },
    async enregistrer() {
      const f = copie(this.fiche);
      f.id = String(f.id || '').trim();
      if (!/^[a-z0-9_]{1,60}$/.test(f.id)) { this.dire('Identifiant : minuscules, chiffres et _ uniquement.', true); return; }
      if (this.nouveau && this.effets.some(e => e.id === f.id)) { this.dire(`L’identifiant « ${f.id} » existe déjà.`, true); return; }
      if (!f.colors?.length) { this.dire('Il faut au moins une couleur.', true); return; }
      const effets = this.nouveau ? [...this.effets, f] : this.effets.map(e => e.id === this.courant ? f : e);
      if (await this.ecrire(effets, `${f.name} enregistré.`)) { const m = this.message; this.nouveau = false; reference = null; this.ouvrir(f.id); this.dire(m); }
    },
    async supprimer() {
      if (this.nouveau) { this.annuler(); return; }
      const deps = [...this.utilisePar.map(s => s.name), ...(this.usageJeu ? [this.usageJeu] : [])];
      if (deps.length) { this.dire(`Encore utilisé par : ${deps.join(', ')}.`, true); return; }
      if (!confirm(`Supprimer l’effet ${this.fiche.name} ?`)) return;
      const id = this.courant;
      if (await this.ecrire(this.effets.filter(e => e.id !== id), 'Effet supprimé.')) { reference = null; this.fiche = null; this.ouvrir(this.effets[0]?.id); }
    },

    async init() {
      try { fichier = await api('/api/admin/content/particles'); this.effets = fichier.particles || []; }
      catch (e) { this.dire(e.message, true); }
      try { this.sorts = (await api('/api/admin/content/spells')).spells || []; } catch { /* facultatif */ }
      // un sort enregistré peut changer ses effets : « Utilisé par » suit
      window.addEventListener('t4c:contenu', async (e) => {
        if (e.detail?.nom === 'spells') try { this.sorts = (await api('/api/admin/content/spells')).spells || []; } catch { /* idem */ }
      });
      const premier = this.groupes[0]?.effets[0];
      if (premier) this.ouvrir(premier.id);
    },
  };
}
