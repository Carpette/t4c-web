// Forge, Effets visuels : bibliothèque d'effets (content/particles.json),
// aperçu en direct par le même moteur que le jeu (render2d/particles.js), et
// sorts qui utilisent chaque effet.
//
// Un effet est PONCTUEL (joué une fois : impact, soin, explosion) ou
// PERSISTANT (entretenu tant que sa source dure : aura d'un sort actif,
// traînée de projectile, zone au sol). Il empile des COUCHES : nappes de
// particules, et primitives à un seul tracé (bulle, anneau au sol, lueur),
// bien moins coûteuses que des centaines de particules.
import {
  Particles, jouerEffet, entretenirEffet, arreterEffet, coucheDepuisAncien, modeParDefaut, coutEffet, FORMES, SOLIDES, COULEUR_SORT, REPARTITIONS, tirageTaille,
} from '../../../render2d/particles.js';
import { copie, norm } from '../../forge.js';

// familles par préfixe (cf. _note de particles.json)
const FAMILLES = [
  ['aura_', 'Auras'], ['proj_', 'Traînées de projectile'], ['imp_', 'Impacts'], ['sol_', 'Zones au sol'],
  ['soin_', 'Soins'], ['bouclier_', 'Boucliers'], ['buff_', 'Améliorations'],
  ['malefice_', 'Maléfices'], ['event_', 'Événements'],
];
const HISTORIQUES = ['Effets historiques', /_(trail|impact)$/];
const SPAWNS = [
  ['point', 'Point'], ['ring', 'Anneau au sol'], ['circle', 'Disque au sol'], ['coquille', 'Sphère (surface)'],
  ['boule', 'Sphère (volume)'], ['colonne', 'Colonne'], ['sphere', 'Sphère aplatie (ancienne)'],
];
const MOUVEMENTS = [
  ['outward', 'Dispersion vers l’extérieur'], ['upward', 'Vers le haut'], ['orbite', 'Rotation autour du centre'],
  ['fontaine', 'Jaillissement (gerbe en cloche)'], ['spirale', 'Spirale montante'], ['aspiration', 'Aspiration vers le centre'], ['random', 'Aléatoire'],
  ['immobile', 'Immobile'], ['orbit', 'Départ tangent (ancien)'],
];
const ALPHAS = [['fondu', 'Fondu progressif'], ['entree', 'Apparition puis fondu'], ['scintille', 'Scintillement'], ['constant', 'Constante']];
const FUSIONS = [['additif', 'Lumineuse (additive)'], ['normal', 'Opaque (fumée, ombres)']];
const SOLS = [['traverse', 'Le traverse (lumière)'], ['pose', 'S’y pose'], ['rebondit', 'Rebondit']];
const TYPES_COUCHE = [['particules', 'Particules'], ['bulle', 'Bulle'], ['anneau', 'Anneau au sol'], ['lueur', 'Lueur']];
const PHYSIQUE = [
  ['speed', 'Vitesse (cases/s)', 0, 8, 0.1], ['gravity', 'Gravité (px/s²)', -300, 800, 5],
  ['drag', 'Frottement', 0.8, 1, 0.01], ['life', 'Durée de vie (s)', 0.05, 4, 0.05],
];
const FONDS = [['sombre', 'Sombre', '#0b0c0f'], ['herbe', 'Herbe', '#24361f'], ['paves', 'Pavés de nuit', '#262830']];
// effets appelés directement par le code du jeu (server/game/dialogues.js, prêtre)
const USAGES_JEU = { soin_majeur: 'Prêtre : soin complet', sol_benediction: 'Prêtre : levée de malédiction', bouclier_sacre: 'Prêtre : bénédiction' };
const RESERVE = 1600, JOUEURS = 15; // cf. particles.js (MAX) ; foule de référence

// ---------- modèles de départ ----------
const P = (o) => ({ type: 'particules', spawn: 'point', movement: 'outward', radius: 0.3, colors: ['#ffffff'], size: 3, sizeEnd: 1,
  speed: 1, gravity: 0, drag: 1, life: 0.8, rate: 20, burst: 20, forme: 'doux', fusion: 'additif', alpha: 'fondu', opacite: 1, ...o });
const MODELES = [
  { cle: 'vide', nom: 'Effet vide', desc: 'Une couche de particules à régler', id: 'imp_', mode: 'ponctuel', couches: [P({})] },
  { cle: 'bulle', nom: 'Bulle de protection', desc: 'Sphère autour du personnage, étoiles qui tournent', id: 'aura_', mode: 'persistant', couches: [
    { type: 'bulle', radius: 0.5, offsetH: 50, colors: ['#8fd0ff'], opacite: 0.7, pulse: 0.3, freq: 0.8, fusion: 'additif' },
    P({ spawn: 'coquille', radius: 0.5, offsetH: 50, movement: 'orbite', speed: 0.5, rate: 25, life: 0.9, size: 2.5, sizeEnd: 0.5, forme: 'etoile', colors: ['#ffffff', '#bfe6ff'], alpha: 'entree' }),
    { type: 'anneau', radius: 0.55, offsetH: 0, colors: ['#8fd0ff'], opacite: 0.5, pulse: 0.2, freq: 0.8, fusion: 'additif' }] },
  { cle: 'flammes', nom: 'Aura de flammes', desc: 'Flammes qui montent autour du personnage', id: 'aura_', mode: 'persistant', couches: [
    P({ spawn: 'circle', radius: 0.35, movement: 'upward', speed: 4, rate: 40, life: 0.8, size: 5, sizeEnd: 0.3, colors: ['#ffd24a', '#ff8a2a', '#c0300a'], degrade: true }),
    { type: 'lueur', radius: 0.4, offsetH: 20, colors: ['#ff7a20'], opacite: 0.35, pulse: 0.4, freq: 2, fusion: 'additif' }] },
  { cle: 'tourbillon', nom: 'Tourbillon montant', desc: 'Spirale de lumière autour du personnage', id: 'aura_', mode: 'persistant', couches: [
    P({ spawn: 'ring', radius: 0.45, movement: 'spirale', speed: 1.2, rate: 30, life: 1.2, size: 3, colors: ['#9fe4ff', '#ffffff'], alpha: 'entree' })] },
  { cle: 'fumee', nom: 'Fumée', desc: 'Volutes opaques qui s’élèvent', id: 'aura_', mode: 'persistant', couches: [
    P({ spawn: 'circle', radius: 0.4, movement: 'upward', speed: 1.5, rate: 12, life: 2, size: 8, sizeEnd: 3, forme: 'fumee', fusion: 'normal', alpha: 'entree', colors: ['#4a4a4a', '#6a6a6a'], drag: 0.98, opacite: 0.8 })] },
  { cle: 'sol', nom: 'Cercle lumineux au sol', desc: 'Anneau qui pulse et poussière d’étoiles', id: 'sol_', mode: 'persistant', couches: [
    { type: 'anneau', radius: 0.7, offsetH: 0, colors: ['#ffe48a'], opacite: 0.6, pulse: 0.4, freq: 1, fusion: 'additif' },
    P({ spawn: 'circle', radius: 0.6, movement: 'upward', speed: 2, rate: 10, life: 1, size: 2, forme: 'etoile', colors: ['#fff4c8'], alpha: 'entree' })] },
  { cle: 'explosion', nom: 'Explosion', desc: 'Éclair, étincelles et fumée', id: 'imp_', mode: 'ponctuel', couches: [
    { type: 'lueur', radius: 0.6, offsetH: 30, life: 0.35, radiusEnd: 1.6, opacite: 0.9, colors: ['#ffb040'], fusion: 'additif' },
    P({ offsetH: 30, speed: 3, burst: 40, rate: 0, life: 0.6, gravity: 120, drag: 0.95, size: 3, forme: 'etincelle', colors: ['#ffd24a', '#ff7a20'] }),
    P({ spawn: 'boule', radius: 0.2, offsetH: 30, speed: 0.6, burst: 12, rate: 0, life: 1.2, size: 8, sizeEnd: 2.5, forme: 'fumee', fusion: 'normal', colors: ['#3a3430', '#5a5048'], alpha: 'entree', gravity: -20, delai: 0.05 })] },
  { cle: 'onde', nom: 'Onde de choc', desc: 'Anneau qui s’élargit au sol', id: 'imp_', mode: 'ponctuel', couches: [
    { type: 'anneau', radius: 0.3, radiusEnd: 6, life: 0.5, offsetH: 0, opacite: 0.9, colors: ['#ffffff'], fusion: 'additif' },
    P({ spawn: 'ring', speed: 4, burst: 30, rate: 0, life: 0.5, size: 2, colors: ['#e8f4ff'] })] },
  { cle: 'etincelles', nom: 'Gerbe d’étincelles', desc: 'Jaillissement qui retombe', id: 'imp_', mode: 'ponctuel', duree: 0.6, couches: [
    P({ offsetH: 60, speed: 2.5, rate: 60, burst: 10, life: 0.7, gravity: 300, forme: 'etincelle', size: 1.5, colors: ['#fff4c8', '#ffd24a'] })] },
  { cle: 'eboulis', nom: 'Éboulis', desc: 'Cailloux projetés qui rebondissent, nuage de poussière', id: 'imp_', mode: 'ponctuel', couches: [
    P({ movement: 'fontaine', offsetH: 10, speed: 1.4, burst: 14, rate: 0, life: 1.4, gravity: 520, drag: 0.99, tailleMin: 3, size: 11, repartition: 'petits', forme: 'roche', fusion: 'normal', alpha: 'constant',
      colors: ['#7a6a58', '#8f8070', '#5e5248'], sol: 'rebondit', rebond: 0.35, rotation: 1.5 }),
    P({ spawn: 'boule', radius: 0.25, offsetH: 15, speed: 0.5, burst: 8, rate: 0, life: 1.2, size: 7, sizeEnd: 2.5, forme: 'fumee', fusion: 'normal', alpha: 'entree', opacite: 0.6,
      colors: ['#8a7a68', '#a09080'] })] },
  { cle: 'glace', nom: 'Éclats de glace', desc: 'Cristaux qui volent et se posent au sol', id: 'imp_', mode: 'ponctuel', couches: [
    P({ movement: 'fontaine', offsetH: 30, speed: 1.8, burst: 16, rate: 0, life: 1.2, gravity: 450, tailleMin: 3, size: 8, repartition: 'petits', forme: 'eclat', fusion: 'normal', alpha: 'constant',
      colors: ['#bfeaff', '#8fd0ff', '#e8f8ff'], sol: 'pose', rotation: 2 }),
    { type: 'lueur', radius: 0.5, offsetH: 30, life: 0.3, radiusEnd: 1.5, opacite: 0.7, colors: ['#bfeaff'], fusion: 'additif' }] },
  { cle: 'charge', nom: 'Implosion (charge)', desc: 'Énergie aspirée puis libérée', id: 'event_', mode: 'ponctuel', duree: 0.8, couches: [
    P({ spawn: 'coquille', radius: 0.8, offsetH: 50, movement: 'aspiration', rate: 60, burst: 0, life: 0.6, size: 3, sizeEnd: 0.3, colors: ['#d070ff', '#ffffff'], alpha: 'entree' }),
    { type: 'lueur', radius: 0.25, offsetH: 50, life: 1, radiusEnd: 2, opacite: 0.8, colors: ['#c060ff'], fusion: 'additif', delai: 0.6 }] },
];

const nomSpawn = (k) => SPAWNS.find(s => s[0] === k)?.[1] || k;
const nomType = (k) => TYPES_COUCHE.find(s => s[0] === (k || 'particules'))?.[1] || k;

// fiche éditée : toujours au format en couches (l'ancien format est converti)
function versFiche(e) {
  if (Array.isArray(e.couches)) return { id: e.id, name: e.name, mode: modeParDefaut(e), duree: +e.duree || 0, couches: copie(e.couches) };
  return { id: e.id, name: e.name, mode: modeParDefaut(e), duree: 0, couches: [coucheDepuisAncien(e)] };
}

export function ParticleEditorController(api) {
  let fichier = null, reference = null, anim = null;

  return {
    SPAWNS, MOUVEMENTS, PHYSIQUE, FONDS, FORMES, ALPHAS, FUSIONS, TYPES_COUCHE, MODELES, SOLS, REPARTITIONS,
    solide: (f) => SOLIDES.has(f), // pas de Set dans la portée : petite-vue ne sait pas le rendre réactif
    effets: [], sorts: [], q: '', courant: null, fiche: null, nouveau: false, galerie: false,
    couche: 0, enMouvement: false, fond: 'sombre', message: '', erreur: false, vivants: 0,
    COULEUR_SORT, teinteApercu: '#ff5a2a', // couleur de sort essayée dans l'aperçu

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
      if (this.nouveau) return out; // effet pas encore enregistré : courant désigne encore l'effet précédent
      for (const s of this.sorts) for (const [k, v] of Object.entries(s.fx || {})) if (v === id) out.push({ id: s.id, name: s.name, role: { trail: 'traînée', impact: 'impact', ground: 'zone au sol', self: 'sur la cible', aura: 'aura' }[k] || k });
      return out;
    },
    get usageJeu() { return this.nouveau ? '' : USAGES_JEU[this.courant] || ''; },
    get couleurFond() { return FONDS.find(f => f[0] === this.fond)[2]; },
    get persistant() { return this.fiche?.mode === 'persistant'; },
    get L() { return this.fiche?.couches[this.couche] || null; },
    get estParticules() { return !this.L?.type || this.L.type === 'particules'; },
    // coût : particules vivantes en régime établi, puis pour une foule
    get cout() {
      const c = this.fiche ? coutEffet(this.fiche) : { particules: 0, primitives: 0 };
      const foule = c.particules * JOUEURS;
      const niveau = foule < RESERVE * 0.4 ? 'ok' : foule < RESERVE * 0.75 ? 'lourd' : 'trop';
      return { ...c, foule, niveau };
    },

    dire(t, err = false) { this.message = t; this.erreur = err; },
    nomCouche(L) { return !L.type || L.type === 'particules' ? `Particules · ${nomSpawn(L.spawn)}` : nomType(L.type); },

    ouvrir(id) {
      if (this.sale && id !== this.courant && !confirm('Abandonner les modifications de cet effet ?')) return;
      const e = this.effets.find(x => x.id === id);
      if (!e) return;
      this.courant = id; this.nouveau = false; this.galerie = false;
      this.fiche = versFiche(e); reference = copie(this.fiche);
      this.couche = 0;
      this.dire('');
      this.demarrer();
    },
    ouvrirGalerie() {
      if (this.sale && !this.nouveau && !confirm('Abandonner les modifications de cet effet ?')) return;
      this.galerie = true;
    },
    partirDe(m) {
      let base = m.id + (m.cle === 'vide' ? 'nouveau' : m.cle), id = base, n = 2;
      while (this.effets.some(e => e.id === id)) id = `${base}_${n++}`;
      this.fiche = { id, name: m.cle === 'vide' ? 'Nouvel effet' : m.nom, mode: m.mode, duree: m.duree || 0, couches: copie(m.couches) };
      this.nouveau = true; this.galerie = false; this.couche = 0; reference = null;
      this.dire('Nouvel effet : le préfixe de l’identifiant (aura_, imp_, sol_…) le range dans sa famille.');
      this.demarrer();
    },
    dupliquer() {
      if (!this.fiche) return;
      let n = 2; while (this.effets.some(e => e.id === `${this.courant}_${n}`)) n++;
      this.fiche = { ...copie(this.fiche), id: `${this.courant}_${n}`, name: `${this.fiche.name} (copie)` };
      this.nouveau = true; reference = null;
      this.dire('Copie : changez l’identifiant si besoin, puis enregistrez.');
    },
    annuler() { this.nouveau = false; this.galerie = false; this.ouvrir(this.courant); },

    // ---------- type et couches ----------
    // au changement de type, chaque nappe de particules reçoit la quantité qui
    // lui manque (débit continu <-> gerbe), pour garder un rendu comparable
    fixerMode(m) {
      for (const L of this.fiche.couches) {
        if (L.type && L.type !== 'particules') continue;
        const vie = +L.life || 0.5;
        if (m === 'persistant' && !(+L.rate > 0)) L.rate = Math.max(5, Math.round((+L.burst || 10) / vie));
        if (m === 'ponctuel' && !(+L.burst > 0) && !this.fiche.duree) L.burst = Math.max(1, Math.round((+L.rate || 20) * vie));
      }
      this.fiche.mode = m; this.demarrer();
    },
    ajouterCouche(type) {
      const L = type === 'particules' ? P({}) : { type, radius: 0.5, offsetH: type === 'anneau' ? 0 : 40, colors: [this.L?.colors?.[0] || '#9ad4ff'], opacite: 0.7, pulse: 0, freq: 1, fusion: 'additif', life: 0.6, radiusEnd: 1 };
      this.fiche.couches.push(L);
      this.couche = this.fiche.couches.length - 1;
    },
    dupliquerCouche(i) { this.fiche.couches.splice(i + 1, 0, copie(this.fiche.couches[i])); this.couche = i + 1; },
    retirerCouche(i) {
      if (this.fiche.couches.length < 2) { this.dire('Un effet garde au moins une couche.', true); return; }
      this.fiche.couches.splice(i, 1);
      this.couche = Math.min(this.couche, this.fiche.couches.length - 1);
    },
    deplacerCouche(i, d) {
      const j = i + d, c = this.fiche.couches;
      if (j < 0 || j >= c.length) return;
      [c[i], c[j]] = [c[j], c[i]];
      this.couche = j;
    },
    basculerMasque(i) { const L = this.fiche.couches[i]; if (L.masque) delete L.masque; else L.masque = true; },

    nombre(k, v, cible = this.L) {
      const n = +String(v).replace(',', '.');
      if (v === '' || !Number.isFinite(n)) { delete cible[k]; return; }
      cible[k] = n;
    },
    // une forme matérielle (roche, éclat) part avec les réglages d'un débris :
    // opaque, sans fondu, qui tournoie et rebondit (tout reste modifiable)
    choisirForme(v) {
      const L = this.L, avant = SOLIDES.has(L.forme);
      L.forme = v;
      if (SOLIDES.has(v) && !avant) {
        L.fusion = 'normal'; L.alpha = 'constant'; L.sol ??= 'rebondit'; L.rebond ??= 0.4;
        if (!(+L.gravity > 0)) L.gravity = 500;
      } else if (!SOLIDES.has(v) && avant) { L.fusion = 'additif'; L.alpha = 'fondu'; }
    },
    // taille variable : plage [tailleMin, size] et répartition
    get tailleVariable() { const m = this.L?.tailleMin; return m != null && m !== '' && +m !== +this.L.size; },
    // histogramme de la répartition (16 barres, hauteurs 0..1) par tirage
    get histoTaille() {
      const rep = this.L?.repartition, b = new Array(16).fill(0);
      for (let i = 0; i < 4000; i++) b[Math.min(15, (tirageTaille(rep) * 16) | 0)]++;
      const max = Math.max(...b);
      return b.map(v => v / max);
    },
    couleur(i, v) { this.L.colors[i] = v; },
    // dernière couleur fixe de la couche (l'entrée « couleur du sort » n'en est pas une)
    fixe(L = this.L) { return [...(L.colors || [])].reverse().find(c => c !== COULEUR_SORT) || '#ffffff'; },
    ajouterCouleur() { this.L.colors = [...(this.L.colors || []), this.fixe()]; },
    retirerCouleur(i) { if (this.L.colors.length > 1) this.L.colors.splice(i, 1); },
    // « Couleur du sort » : remplacée en jeu par la couleur du sort qui joue l'effet
    get aCouleurSort() { return !!this.L?.colors?.includes(COULEUR_SORT); },
    get effetACouleurSort() { return !!this.fiche?.couches.some(c => c.colors?.includes(COULEUR_SORT)); },
    ajouterCouleurSort() { if (!this.aCouleurSort) this.L.colors = [...(this.L.colors || []), COULEUR_SORT]; },
    // primitive (une couleur) : [sort, couleur de repli si le sort n'en a pas] <-> [couleur fixe]
    basculerCouleurSort(oui) { this.L.colors = oui ? [COULEUR_SORT, this.fixe()] : [this.fixe()]; },
    pastille(c) { return c === COULEUR_SORT ? this.teinteApercu : c; },

    // ---------- aperçu ----------
    demarrer() {
      setTimeout(() => {
        const cv = document.getElementById('pe-apercu');
        if (!cv) return;
        if (anim?.cv !== cv) {
          if (anim) cancelAnimationFrame(anim.raf);
          anim = { cv, g: cv.getContext('2d'), P: new Particles(), last: performance.now(), t: 0, raf: 0, cible: { x: 0, z: 0 }, etat: {} };
          const boucle = (now) => { anim.raf = requestAnimationFrame(boucle); this.image(now); };
          anim.raf = requestAnimationFrame(boucle);
        }
        anim.P.vider(); anim.etat = {};
        anim.t = 0; anim.prochain = 0;
      }, 0);
    },
    declencher() {
      if (!anim || !this.fiche) return;
      if (this.persistant) { this.demarrer(); return; }
      jouerEffet(anim.P, this.fiche, 0, 0, { raw: true, frais: true, ancre: anim.cible, teinte: this.teinteApercu });
    },
    image(now) {
      const a = anim;
      if (!a || !this.fiche) return;
      if (!a.cv.isConnected) { // toile recréée (retour de la galerie de modèles)
        const cv = document.getElementById('pe-apercu');
        if (!cv) return;
        a.cv = cv; a.g = cv.getContext('2d');
      }
      const dt = Math.min(0.05, (now - a.last) / 1000); a.last = now; a.t += dt;
      // cible : immobile, ou qui va et vient (effets accrochés au personnage)
      a.cible.x = this.enMouvement ? Math.sin(a.t * 0.9) * 1.4 : 0;
      a.cible.z = this.enMouvement ? -Math.sin(a.t * 0.9) * 1.4 : 0;
      // réglage modifié : les primitives en place sont recréées avec les nouvelles valeurs
      const sig = JSON.stringify(this.fiche) + this.teinteApercu;
      if (sig !== a.sig) { a.sig = sig; arreterEffet(a.P, a.etat); a.etat = {}; }
      if (this.persistant) entretenirEffet(a.P, this.fiche, a.etat, 0, 0, dt, { raw: true, frais: true, ancre: a.cible, teinte: this.teinteApercu });
      else if (a.t >= a.prochain) {
        this.declencher();
        const vie = Math.max(0.3, ...this.fiche.couches.map(c => (+c.delai || 0) + (+c.life || 0.6)));
        a.prochain = a.t + (+this.fiche.duree || 0) + vie + 0.6;
      }
      a.P.update(dt);
      this.vivants = a.P.actifs;
      const { g, cv } = a, s = 0.6, HW = 96 * s, HH = 48 * s;
      const cx = cv.width / 2, cy = cv.height * 0.66;
      const w2s = (x, z) => ({ x: cx + (x - z) * HW, y: cy + (x + z) * HH });
      g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
      g.fillStyle = this.couleurFond; g.fillRect(0, 0, cv.width, cv.height);
      // repère : cases autour du personnage, puis silhouette à l'échelle du jeu (≈ 100 px)
      g.strokeStyle = 'rgba(255,255,255,.08)'; g.lineWidth = 1;
      for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) {
        const p = w2s(i - 0.5, j - 0.5), q = w2s(i + 0.5, j - 0.5), r = w2s(i + 0.5, j + 0.5), t = w2s(i - 0.5, j + 0.5);
        g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(q.x, q.y); g.lineTo(r.x, r.y); g.lineTo(t.x, t.y); g.closePath(); g.stroke();
      }
      const pc = w2s(a.cible.x, a.cible.z);
      g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.ellipse(pc.x, pc.y, 22 * s, 11 * s, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#4a4f59';
      g.beginPath(); g.ellipse(pc.x, pc.y - 88 * s, 9 * s, 10 * s, 0, 0, Math.PI * 2); g.fill();
      g.fillRect(pc.x - 13 * s, pc.y - 78 * s, 26 * s, 46 * s);
      g.fillRect(pc.x - 11 * s, pc.y - 34 * s, 9 * s, 34 * s); g.fillRect(pc.x + 2 * s, pc.y - 34 * s, 9 * s, 34 * s);
      a.P.draw(g, w2s, s);
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
      if (!f.couches.length) { this.dire('Il faut au moins une couche.', true); return; }
      if (f.couches.some(c => !c.colors?.length)) { this.dire('Chaque couche a besoin d’au moins une couleur.', true); return; }
      if (f.mode !== 'ponctuel' || !f.duree) delete f.duree;
      const effets = this.nouveau ? [...this.effets, f] : this.effets.map(e => e.id === this.courant ? f : e);
      // fiche vidée avant de rouvrir : sinon « modifications non enregistrées » serait demandé à tort
      if (await this.ecrire(effets, `${f.name} enregistré.`)) { const m = this.message; this.nouveau = false; reference = null; this.fiche = null; this.ouvrir(f.id); this.dire(m); }
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
