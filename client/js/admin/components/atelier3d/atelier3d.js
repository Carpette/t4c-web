// Atelier 3D : un modèle 3D (catalogue CC0 servi sous /src3d/, ou fichiers du
// poste) est rendu par bake3d.js avec la caméra, la lumière et l'échelle du
// jeu, puis publié par les routes existantes :
//   créature -> POST /api/admin/skins/enemy (planche 8 directions) + PUT
//               /api/admin/skins (assignation au monstre choisi) ;
//   décor    -> POST /api/admin/tiles, kind « objet » (tileset user_<nom>,
//               découvert par la palette : thème « Décors 3D (atelier) »).
// Les objets three.js restent HORS de l'état réactif de petite-vue (proxies).
import { MOBS } from '../../../../shared/defs.js';
import { CATALOGUE3D } from '../../catalogue3d.js';

// moteur 3D (three.js, ~1 Mo) chargé à la demande : seulement si l'onglet sert
let B = null;
const bake = async () => (B ||= await import('../../bake3d.js'));

const ANIMS = ['stance', 'run', 'swing', 'die'];
// devinette des clips par nom (les packs nomment librement) : le moteur joue
// « run » à chaque déplacement, d'où la préférence course > marche
const MOTIFS = {
  stance: [/^idle(_loop)?$/i, /idle/i],
  run: [/^run$|run_loop|jog|gallop/i, /run/i, /walk/i],
  swing: [/sword_attack$|^attack$|attack/i, /punch|bite|headbutt|swing|kick/i],
  die: [/^death(01)?$|^die$/i, /death|die/i],
};
const devinerClip = (noms, a) => {
  for (const re of MOTIFS[a]) { const n = noms.find(x => re.test(x) && !/pose/i.test(x)); if (n) return n; }
  return '';
};
const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);

// demande d'ouverture venue d'un autre écran (Bibliothèque) : chemin sous
// /src3d/, traité dès que l'atelier a fini son initialisation
let demande = null, recepteur = null;
export function ouvrirDansAtelier3D(fichier) { demande = fichier; recepteur?.(); }

export function Atelier3DController(api) {
  let atelier = null;     // créé à l'ouverture (contexte WebGL)
  let modele = null;      // modèle chargé (three.js, non réactif)
  let source = null;      // { url, opts } pour recharger à une autre échelle
  let minuteur = null, t = 0;

  return {
    catalogue: [], libs: [], mobs: [],
    preset: '', lib: '', fichierSource: '', charge: false, occupe: false,
    type: 'creature', mode: 'h', valeur: 1.8,
    clips: [], choix: { stance: '', run: '', swing: '', die: '' },
    anim: 'stance', dir: 5, nom: '', mob: '',
    message: '', erreur: false, progres: null,

    async init() {
      this.mobs = Object.entries(MOBS).map(([id, m]) => ({ id, name: m.name })).sort((a, b) => a.name.localeCompare(b.name));
      try {
        const r = await api('/api/admin/src3d');
        const dispo = new Set(r.modeles || []);
        this.libs = (r.modeles || []).filter(m => /anim/i.test(m) && /\.glb$/i.test(m));
        let k = 0;
        this.catalogue = CATALOGUE3D.map(([groupe, type, entrees]) => ({
          groupe,
          entrees: entrees.filter(e => dispo.has(e.url)).map(e => ({ ...e, type, cle: String(k++) })),
        })).filter(g => g.entrees.length);
      } catch (e) {
        this.dire('Catalogue indisponible : ' + e.message, true);
      }
      recepteur = () => { const f = demande; demande = null; if (f) this.ouvrirFichier(f); };
      recepteur();
    },

    // ouvre un modèle source par son chemin : préréglage du catalogue s'il y
    // figure (échelle, animations), sinon chargement direct du fichier
    async ouvrirFichier(f) {
      if (this.occupe) { demande = f; setTimeout(() => recepteur?.(), 300); return; }
      const e = this.catalogue.flatMap(g => g.entrees).find(x => x.url === f);
      if (e) { this.preset = e.cle; this.fichierSource = ''; await this.chargerPreset(); return; }
      this.preset = '';
      this.fichierSource = f;
      this.nom = slug(f.split('/').pop().replace(/\.\w+$/, ''));
      this.mode = 'h';
      const url = '/src3d/' + f.split('/').map(encodeURIComponent).join('/');
      await this.charger(url, { format: /\.fbx$/i.test(f) ? 'fbx' : 'gltf' });
      if (source?.url !== url) return; // échec : message déjà affiché
      // sans animation, c'est un décor (taille d'objet), sinon une créature
      const decor = !modele.clips.length;
      this.type = decor ? 'decor' : 'creature';
      this.valeur = decor ? 1 : 1.8;
      this.reprendre();
    },

    dire(texte, erreur = false) { this.message = texte; this.erreur = erreur; },

    moteur() { return atelier; },

    async charger(url, opts, anims = []) {
      this.occupe = true;
      this.dire('Chargement du modèle…');
      try {
        atelier ||= new (await bake()).Atelier3D();
        const m = await this.moteur().charger(url, opts);
        for (const a of anims) await this.moteur().ajouterAnimations(m, a.url, a.opts);
        modele = m;
        source = { url, opts };
        this.preparer();
        this.majClips();
        this.charge = true;
        this.dire(`✔ Modèle chargé (${m.clips.length} animation(s)).`);
        setTimeout(() => this.apercu(), 0);
        this.boucle();
      } catch (e) {
        this.dire('✘ Chargement impossible : ' + e.message, true);
      } finally {
        this.occupe = false;
      }
    },

    async chargerPreset() {
      this.fichierSource = '';
      const e = this.catalogue.flatMap(g => g.entrees).find(x => x.cle === this.preset);
      if (!e) return;
      this.type = e.type;
      this.mode = e.module ? 'module' : 'h';
      this.valeur = e.module || e.h || 1.8;
      this.nom = slug(e.nom);
      const S = '/src3d/';
      await this.charger(S + e.url, { texture: e.texture ? S + e.texture : null },
        (e.anims || []).map(a => ({ url: S + a })));
      if (e.clip && modele) {
        const c = B.trouverClip(modele.clips, e.clip);
        if (c) this.choix.stance = c.name;
      }
    },

    async chargerFichiers(ev) {
      const liste = [...(ev.target.files || [])];
      const principal = liste.find(f => /\.(glb|gltf|fbx)$/i.test(f.name));
      if (!principal) { this.dire('Sélectionnez au moins un fichier .glb, .gltf ou .fbx.', true); return; }
      const fichiers = new Map(liste.map(f => [f.name, URL.createObjectURL(f)]));
      this.preset = '';
      this.fichierSource = '';
      this.nom = slug(principal.name.replace(/\.\w+$/, ''));
      this.mode = 'h';
      await this.charger(fichiers.get(principal.name), {
        fichiers, format: /\.fbx$/i.test(principal.name) ? 'fbx' : 'gltf',
      });
    },

    async ajouterLib() {
      if (!this.lib || !modele) return;
      this.occupe = true;
      try {
        await this.moteur().ajouterAnimations(modele, '/src3d/' + this.lib);
        this.majClips();
        this.dire(`✔ Animations ajoutées (${modele.clips.length} au total).`);
      } catch (e) {
        this.dire('✘ Bibliothèque illisible : ' + e.message, true);
      } finally {
        this.occupe = false; this.lib = '';
      }
    },

    preparer() {
      const opt = this.mode === 'module' ? { module: Number(this.valeur) || 1 } : { hauteur: Number(this.valeur) || 1.8 };
      this.moteur().preparer(modele, opt);
    },

    reprendre() { if (modele) { this.preparer(); this.apercu(); } },

    majClips() {
      this.clips = modele.clips.map(c => c.name);
      for (const a of ANIMS) if (!this.clips.includes(this.choix[a])) this.choix[a] = devinerClip(this.clips, a);
    },

    clip(a) { return modele && this.choix[a] ? B.trouverClip(modele.clips, '^' + this.choix[a].replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$') : null; },

    // aperçu : sprite ancré aux pieds sur un losange de case 192x96
    apercu() {
      const cv = document.getElementById('a3d-apercu');
      if (!cv || !modele) return;
      const g = cv.getContext('2d');
      g.clearRect(0, 0, cv.width, cv.height);
      const cx = cv.width / 2, cy = cv.height - 80;
      g.beginPath(); g.moveTo(cx, cy - 48); g.lineTo(cx + 96, cy); g.lineTo(cx, cy + 48); g.lineTo(cx - 96, cy); g.closePath();
      g.fillStyle = '#3c4a2e'; g.fill(); g.strokeStyle = '#56663f'; g.stroke();
      const creature = this.type === 'creature';
      const f = this.moteur().rendre(modele, { dir: this.dir, clip: creature ? this.clip(this.anim) : null, t });
      const k = Math.min(1, (cv.width - 10) / f.canvas.width, (cy - 5) / Math.max(1, f.oy));
      g.drawImage(f.canvas, cx - f.ox * k, cy - f.oy * k, f.canvas.width * k, f.canvas.height * k);
      if (k < 1) { g.fillStyle = '#bbb'; g.font = '12px sans-serif'; g.fillText(`aperçu réduit ×${k.toFixed(2)}`, 8, 16); }
    },

    // animation de l'aperçu (~12 im/s), seulement onglet visible
    boucle() {
      if (minuteur) return;
      minuteur = setInterval(() => {
        const cv = document.getElementById('a3d-apercu');
        if (!cv || !cv.offsetParent || this.occupe || this.type !== 'creature') return;
        t += 0.083;
        this.apercu();
      }, 83);
    },

    async publier() {
      const nom = slug(this.nom);
      if (!modele || !nom) return;
      this.occupe = true; this.progres = 0;
      try {
        if (this.type === 'creature') {
          const clips = Object.fromEntries(ANIMS.map(a => [a, this.clip(a)]));
          const { canvas, cfg } = await B.cuireCreature(this.moteur(), modele, clips, { progres: p => { this.progres = p; } });
          cfg.name = 'a3d_' + nom;
          const r = await api('/api/admin/skins/enemy', 'POST', { cfg, data: B.versBase64(canvas) });
          let txt = `✔ Planche « ${r.sprite} » publiée (${canvas.width}×${canvas.height} px, ${r.anims.join(', ')}).`;
          if (this.mob) {
            const cur = await api('/api/admin/skins');
            const map = { items: {}, mobs: {}, spells: {}, npcs: {}, ...(cur.map || {}) };
            map.mobs = { ...(map.mobs || {}), [this.mob]: r.sprite };
            await api('/api/admin/skins', 'PUT', map);
            txt += ` Assignée à « ${MOBS[this.mob]?.name || this.mob} ».`;
          }
          this.dire(txt + ' Rechargez le jeu (F5) pour la voir.');
        } else {
          const { canvas, tiles, names } = B.cuireDecor(this.moteur(), modele);
          const types = Object.fromEntries(Object.keys(tiles).map(k => [k, 'objet']));
          const r = await api('/api/admin/tiles', 'POST', { name: nom, kind: 'objet', data: B.versBase64(canvas), tiles, types, names });
          this.dire(`✔ Décor « ${r.tileset} » publié (${r.frames} orientations). Rechargez l'admin (F5) : palette, thème « Décors 3D (atelier) ».`);
        }
      } catch (e) {
        this.dire('✘ Publication refusée : ' + e.message, true);
      } finally {
        this.occupe = false; this.progres = null;
      }
    },
  };
}
