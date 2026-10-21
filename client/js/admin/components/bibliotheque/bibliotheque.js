// Forge, Bibliothèque : catalogue unifié d'après la maquette. Recense les
// ressources graphiques (planches de créatures, couches de personnage, icônes
// d'objets, matériaux, jeux de tuiles, modèles 3D sources), avec aperçu,
// dimensions et usages ; la création et l'import restent dans les ateliers
// (Atelier 2D, Matériaux, Atelier 3D), ouverts d'un clic.
import { MOBS, ITEMS } from '../../../../shared/defs.js';
import { chargerRessources, dessinerCreature, image, spriteDe, norm } from '../../forge.js';
import { allerA } from '../../console.js';
import { ouvrirDansAtelier3D } from '../atelier3d/atelier3d.js';

const TYPES = [
  { id: 'creature', nom: 'Sprites de créatures', atelier: 'skins', nomAtelier: 'Atelier 2D' },
  { id: 'personnage', nom: 'Personnages', atelier: 'skins', nomAtelier: 'Atelier 2D' },
  { id: 'objet', nom: 'Icônes d’objets', atelier: 'skins', nomAtelier: 'Atelier 2D' },
  { id: 'materiau', nom: 'Matériaux', atelier: 'materials', nomAtelier: 'Matériaux' },
  { id: 'tuiles', nom: 'Jeux de tuiles', atelier: 'materials', nomAtelier: 'Matériaux' },
  { id: 'modele', nom: 'Modèles 3D', atelier: 'atelier3d', nomAtelier: 'Atelier 3D' },
];
const MATERIAU = /^(wall|roof|floor)_/;
const NOM_MATERIAU = { wall: 'Mur', roof: 'Toit', floor: 'Sol' };
const PAGE = 200; // cartes affichées à la fois (les sources 3D se comptent par milliers)

// ---------- vignettes des modèles 3D ----------
// Rendues par le moteur de l'Atelier 3D (même caméra, même lumière que les
// sprites cuits), une à la fois, et gardées pour la session : id -> canvas.
// File d'attente : l'aperçu de la fiche passe devant les cartes, et une carte
// sortie de la grille (filtre changé) est abandonnée avant son rendu.
let atelier3d = null, actif = false;
const rendus3d = new Map(), attente = [];
const urlSource = (f) => '/src3d/' + f.split('/').map(encodeURIComponent).join('/');
function liberer(racine) {
  racine.traverse(o => {
    o.geometry?.dispose();
    for (const m of [].concat(o.material || [])) {
      for (const v of Object.values(m)) if (v?.isTexture) v.dispose();
      m.dispose();
    }
  });
}
async function rendre3d(r) {
  try {
    const B = await import('../../bake3d.js');
    atelier3d ||= new B.Atelier3D();
    const m = await atelier3d.charger(urlSource(r.cle));
    // cadrage par la plus grande dimension (une dalle plate ne doit pas
    // être étirée comme le serait un personnage mis à sa hauteur)
    atelier3d.preparer(m, { module: 1 });
    atelier3d.preparer(m, { module: Math.max(1e-6, m.rayon) });
    const out = atelier3d.rendre(m, { dir: 5 }).canvas;
    liberer(m.racine);
    return out;
  } catch { return null; } // modèle illisible : pas de vignette
}
async function pomper() {
  if (actif) return;
  actif = true;
  while (attente.length) {
    const t = attente.shift();
    if (!t.utile()) { t.fin(undefined); continue; }
    const out = await rendre3d(t.r);
    rendus3d.set(t.r.id, out);
    t.fin(out);
  }
  actif = false;
}
// résout le canvas rendu, null si illisible, undefined si abandonné
function rendu3d(r, utile, prioritaire) {
  if (rendus3d.has(r.id)) return Promise.resolve(rendus3d.get(r.id));
  return new Promise(fin => {
    const t = { r, utile, fin };
    if (prioritaire) attente.unshift(t); else attente.push(t);
    pomper();
  });
}

export function BibliothequeController(api) {
  let manifest = null, retouches = {}, pnjBrut = '', veilleur = null;

  return {
    TYPES,
    ressources: [], type: null, q: '', inutilisees: false, limite: PAGE, courant: null, chargement: true, message: '',

    get filtres() {
      return [{ id: null, nom: 'Toutes', n: this.ressources.length },
        ...TYPES.map(t => ({ ...t, n: this.ressources.filter(r => r.type === t.id).length })).filter(t => t.n)];
    },
    get liste() {
      const q = norm(this.q.trim());
      return this.ressources.filter(r => (!this.type || r.type === this.type)
        && (!q || norm(r.nom).includes(q) || norm(r.cle).includes(q))
        && (!this.inutilisees || (r.usages && !r.usages.length)));
    },
    get visibles() { return this.liste.slice(0, this.limite); },
    plus() { this.limite += PAGE; this.peindre(); },
    // nouveau filtre : on repart de la première page
    refiltrer() { this.limite = PAGE; this.peindre(); },
    get fiche() { return this.ressources.find(r => r.id === this.courant) || null; },
    get typeFiche() { return TYPES.find(t => t.id === this.fiche?.type) || TYPES[0]; },
    nomType(id) { return TYPES.find(t => t.id === id)?.nom || id; },

    ouvrir(id) { this.courant = id; this.apercu(); },
    atelier() {
      if (this.fiche?.type === 'modele') ouvrirDansAtelier3D(this.fiche.cle);
      allerA('bibliotheque', this.typeFiche.atelier);
    },

    // ---------- recensement ----------
    recenser() {
      const out = [];
      const ajouter = (r) => out.push({ dims: '', usages: [], ...r, id: `${r.type}:${r.cle}` });
      for (const [cle, e] of Object.entries(manifest.enemies || {})) {
        const usages = Object.entries(MOBS).filter(([id, d]) => spriteDe(id, d) === cle).map(([, d]) => ({ nom: d.name, ou: 'créature', lien: '#creatures' }));
        ajouter({ type: 'creature', cle, nom: cle.replace(/_/g, ' '), fichier: e.image, anims: Object.keys(e.anims || {}).length, usages });
      }
      for (const [sexe, couches] of Object.entries(manifest.avatar || {})) {
        for (const [cle, e] of Object.entries(couches)) {
          const usages = pnjBrut.includes(`"${cle}"`) ? [{ nom: 'PNJ (apparence)', ou: 'PNJ', lien: '#pnj' }] : [];
          ajouter({ type: 'personnage', cle: `${sexe}/${cle}`, nom: `${cle.replace(/_/g, ' ')} (${sexe === 'male' ? 'homme' : 'femme'})`, fichier: e.image, usages: cle.startsWith('default_') ? null : usages });
        }
      }
      for (const [cle, e] of Object.entries(manifest.loot || {})) {
        const usages = Object.entries(ITEMS).filter(([, d]) => d.loot === cle).map(([, d]) => ({ nom: d.name, ou: 'objet', lien: '#objets' }));
        ajouter({ type: 'objet', cle, nom: cle.replace(/_/g, ' '), fichier: e.image, dims: `${e.frame[2]} × ${e.frame[3]} px`, usages });
      }
      for (const [cle, t] of Object.entries(manifest.tilesets || {})) {
        const m = cle.match(MATERIAU);
        // décors « wall_<mat> », pièces « floor_<mat>:n » dans les retouches de zone
        const cite = new RegExp(`"${cle}["':]`);
        const usages = Object.entries(retouches).filter(([, brut]) => cite.test(brut)).map(([zone]) => ({ nom: zone, ou: 'zone', lien: '#zones/map' }));
        ajouter({ type: m ? 'materiau' : 'tuiles', cle, nom: m ? `${NOM_MATERIAU[m[1]]} · ${cle.slice(m[0].length).replace(/_/g, ' ')}` : cle.replace(/_/g, ' '),
          fichier: t.images?.[0], pieces: Object.keys(t.tiles || {}).length, usages: m ? usages : null });
      }
      return out;
    },

    // ---------- aperçus ----------
    async vignette(r, cv) {
      if (!cv || cv.dataset.fait === r.id) return;
      cv.dataset.fait = r.id;
      const g = cv.getContext('2d');
      g.clearRect(0, 0, cv.width, cv.height);
      try {
        if (r.type === 'creature') { await dessinerCreature(cv, `bib_${r.cle}`, { sprite: r.cle, name: r.nom }); return; }
        let src, x, y, w, h;
        if (r.type === 'modele') {
          const apercu = cv.id === 'bib-apercu';
          if (!rendus3d.has(r.id)) r.enRendu = true;
          src = await rendu3d(r, () => cv.isConnected && cv.dataset.fait === r.id, apercu);
          if (src !== undefined) r.enRendu = false;
          if (src === undefined) { if (cv.dataset.fait === r.id) delete cv.dataset.fait; return; }
          if (!src) { r.illisible = true; return; }
          [x, y, w, h] = [0, 0, src.width, src.height];
        }
        else if (r.type === 'objet') { const e = manifest.loot[r.cle]; src = await image(e.image); [x, y, w, h] = e.frame; }
        else if (r.type === 'personnage') {
          const [sexe, cle] = r.cle.split('/'), e = manifest.avatar[sexe][cle];
          const f = e.anims?.stance?.fr?.['6']?.[0];
          if (!f) return;
          src = await image(e.image); [x, y, w, h] = f;
        } else {
          const t = manifest.tilesets[r.cle], premiere = Object.values(t.tiles || {})[0];
          if (!premiere) return;
          src = await image(t.images[0]); [x, y, w, h] = premiere;
        }
        // le canevas a pu être réattribué à une autre ressource pendant le chargement
        if (cv.dataset.fait !== r.id) return;
        if (!r.dims && src && r.type !== 'modele') r.dims = r.type === 'personnage' ? `${w} × ${h} px` : `planche ${src.width} × ${src.height} px`;
        const k = Math.min((cv.width - 8) / w, (cv.height - 8) / h, r.type === 'objet' ? 3 : r.type === 'modele' ? 4 : 1.5);
        g.imageSmoothingEnabled = k < 1;
        g.drawImage(src, x, y, w, h, (cv.width - w * k) / 2, (cv.height - h * k) / 2, w * k, h * k);
      } catch { /* image absente : vignette vide */ }
    },
    // dessine les vignettes (après rendu de la grille) ; celles des modèles
    // 3D, coûteuses, seulement quand la carte entre dans la vue
    peindre() {
      setTimeout(() => {
        veilleur ||= new IntersectionObserver(entrees => {
          for (const e of entrees) {
            if (!e.isIntersecting) continue;
            veilleur.unobserve(e.target);
            const r = this.ressources.find(x => x.id === e.target.dataset.res);
            if (r) this.vignette(r, e.target);
          }
        }, { rootMargin: '200px' });
        for (const cv of document.querySelectorAll('#tab-bibliotheque canvas[data-res]')) {
          const r = this.ressources.find(x => x.id === cv.dataset.res);
          if (!r || cv.dataset.fait === r.id) continue;
          if (r.type === 'modele') { veilleur.unobserve(cv); veilleur.observe(cv); } else this.vignette(r, cv);
        }
      }, 0);
    },
    apercu() { setTimeout(() => { const cv = document.getElementById('bib-apercu'); if (cv && this.fiche) { delete cv.dataset.fait; this.vignette(this.fiche, cv); } }, 0); },

    // recensement coûteux (retouches de chaque zone, sources 3D) : seulement
    // à la première ouverture de l'écran, pas au chargement de la console
    init() {
      const veille = setInterval(() => {
        if (!document.getElementById('tab-bibliotheque')?.offsetParent) return;
        clearInterval(veille);
        this.recenserTout();
      }, 300);
    },
    async recenserTout() {
      try {
        manifest = (await chargerRessources()).manifest;
        try { pnjBrut = JSON.stringify((await api('/api/admin/content/npcs')).npc || {}); } catch { /* sans PNJ */ }
        try {
          const zones = (await api('/api/admin/content/zones')).zones || [];
          for (const z of zones) {
            try { retouches[z.name] = JSON.stringify(await api(`/api/admin/overrides/${z.id}`)); } catch { /* droit carte absent */ }
          }
        } catch { /* sans zones */ }
        const res = this.recenser();
        try {
          const m = await api('/api/admin/src3d');
          for (const f of m.modeles || []) {
            res.push({ id: `modele:${f}`, type: 'modele', cle: f, nom: f.split('/').pop().replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '), fichier: f, format: f.split('.').pop().toUpperCase(), usages: null });
          }
        } catch { /* sources 3D indisponibles */ }
        this.ressources = res;
        this.courant = res[0]?.id || null;
      } catch (e) { this.message = '✘ ' + e.message; }
      this.chargement = false;
      this.peindre(); this.apercu();
    },
  };
}
