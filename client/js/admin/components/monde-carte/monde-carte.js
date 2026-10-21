// Monde, Carte du monde : d'après la maquette. La zone telle que la voient
// les joueurs (moteur de rendu du jeu : tuiles isométriques, décors, sprites
// animés des joueurs, PNJ, créatures et objets au sol, rafraîchis chaque
// seconde et interpolés), avec trois outils :
//   Sélection (V)     — inspecteur du joueur choisi (aller à lui, l'amener,
//                       message, état à chaud, drapeaux, sanctions), d'un PNJ
//                       (glisser pour le déplacer, retirer) ou d'une zone
//                       musicale (glisser pour la déplacer, poignée pour la
//                       redimensionner, groupe, priorité, suppression) ;
//   Placer un PNJ (P) — pose un PNJ retiré ou une copie d'un modèle ;
//   Zone musicale (M) — dessine une zone et lui associe un groupe.
// Placement et zones musicales s'enregistrent dans les retouches de la zone
// (droits « Placement des PNJ » et « Zones musicales ») et s'appliquent à
// chaud : pas besoin d'accéder à la Forge.
import { generateWorld } from '../../../../shared/worldgen.js';
import { applyOverrides } from '../../../../shared/overrides.js';
import { KIND } from '../../../../shared/constants.js';
import { loadAssets } from '../../../render2d/assets.js';
import { buildDecor } from '../../../render2d/decor.js';
import { Renderer, HW, HH } from '../../../render2d/renderer.js';
import { EntityManager2D } from '../../../render2d/entities2d.js';
import { TILE_COLORS, TILE_NAMES } from '../../palette.js';
import { consoleEtat } from '../../console.js';

const RAFRAICHIR_MS = 1000;
const INTERP = 1.1;            // s : retard d'interpolation (un rafraîchissement + marge)
const ECHELLE_MIN = 0.15, ECHELLE_MAX = 1.6;
const MINI = 150;              // côté de la minicarte (px)
const MUS_MIN = 2;             // côté minimal d'une zone musicale dessinée (cases)
const rgb = (hex) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const duree = (ms) => {
  const m = Math.max(0, Math.round(ms / 60000));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
};
const visible = () => document.getElementById('tab-monde-carte')?.classList.contains('visible') && !document.hidden;
const copie = (v) => JSON.parse(JSON.stringify(v));
const idNeuf = (pre) => pre + Date.now().toString(36);

export function MondeCarteController(api) {
  // hors réactivité : moteur de rendu, entités, gros tableaux, canevas
  let assets = null, renderer = null, em = null, monde = null, ov = null, fond = null;
  let cv = null, mini = null, glisse = null, brouillon = null, tirePnj = null, tireMus = null;
  let worldTime = 0, dernier = 0, npcDefs = {};

  return {
    zones: [], zoneId: 0, chargement: true, indispo: '',
    calques: { pnj: true, joueurs: true, creatures: true, objets: true, musique: true, apparition: false, eclairage: false },
    outil: 'selection', joueurs: [], musique: null, groupes: [], journal: [], musZones: [], retires: [],
    onglet: 'selection', choix: null, fiche: null, etat: { level: '', gold: '', hp: '' }, drapeauNeuf: '',
    point: null, curseur: '', message: '', erreur: false, muetMin: 15, texte: '',
    aPlacer: '', qModele: '', modeles: [], compte: { pnj: 0, creatures: 0, objets: 0 },

    // fiche : jamais remise à null (petite-vue réévalue les enfants d'un v-if
    // avant le parent) ; c'est « choix » qui décide de l'affichage
    // ---------- droits du compte (le serveur tranche, l'interface s'adapte) ----------
    peut(droit, n = 2) { const m = consoleEtat.moi; return !!m && (m.isAdmin || (m.droits?.[droit] | 0) >= n); },
    get animer() { return !!consoleEtat.moi?.isAdmin || !!consoleEtat.moi?.animer; },

    get ici() { return this.joueurs.filter(p => p.zoneId === this.zoneId); },
    get groupeMusique() {
      const s = this.musique;
      return !s ? 'aucune' : s.group ? s.group : (s.new || s.legacy || 'silence');
    },
    get dirtyEtat() {
      const f = this.choix?.type === 'joueur' && this.fiche?.id === this.choix.id ? this.fiche : null;
      return !!f && ['level', 'gold', 'hp'].some(k => this.etat[k] !== '' && +this.etat[k] !== f[k]);
    },
    get changements() { return ['level', 'gold', 'hp'].filter(k => this.fiche && this.etat[k] !== '' && +this.etat[k] !== this.fiche[k]).length; },
    get drapeaux() { return Object.entries(this.fiche?.flags || {}).map(([k, v]) => ({ k, v })); },
    get zoneMus() { return this.choix?.type === 'musique' ? this.musZones.find(m => m.id === this.choix.id) || null : null; },
    get aPlacerListe() {
      const q = this.qModele.trim().toLowerCase();
      const f = (m) => !q || m.nom.toLowerCase().includes(q) || m.cle.toLowerCase().includes(q);
      return [...this.retires.map(r => ({ ...r, groupe: 'Retiré de cette zone' })), { cle: 'nouveau', nom: 'Nouveau PNJ (bavard)', groupe: 'Vierge' },
        ...this.modeles.map(m => ({ ...m, groupe: 'Copie du modèle' }))].filter(f);
    },
    get nomAPlacer() { return this.aPlacerListe.find(m => m.cle === this.aPlacer)?.nom || ''; },
    pct(a, b) { return b ? Math.max(0, Math.min(100, (a / b) * 100)) : 0; },
    depuis(t) { return t ? duree(Date.now() - t) : ''; },
    restant(t) { return duree(t - Date.now()); },
    heure(t) { return new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); },
    nomZone(id) { return this.zones.find(z => z.id === id)?.name ?? `zone ${id}`; },
    nomPiste(t) { return !t ? 'aucune' : t.group ? `groupe ${t.group}` : (t.new || t.legacy || 'silence'); },

    dire(t, err = false) { this.message = t; this.erreur = err; },

    choisirOutil(o) {
      if (o === 'pnj' && !this.peut('pnj_placement')) return;
      if (o === 'musique' && !this.peut('zones_musicales')) return;
      this.outil = o; this.onglet = 'selection'; brouillon = null;
      if (o === 'musique') this.calques.musique = true;
      this.dire({ selection: '', pnj: 'Choisissez un PNJ dans l’inspecteur, puis cliquez sur la carte pour le poser.', musique: 'Glissez sur la carte pour dessiner une zone musicale.' }[o]);
    },

    // ---------- zone ----------
    async changerZone(id) {
      this.zoneId = +id; this.chargement = true; this.point = null; this.choix = null;
      const z = this.zones.find(x => x.id === this.zoneId);
      try { ov = await api(`/api/admin/overrides/${this.zoneId}`); } catch { ov = null; }
      // laisse le navigateur peindre « chargement » : la génération prend ~250 ms
      await new Promise(r => setTimeout(r, 0));
      monde = applyOverrides(generateWorld(z.seed, z.map), ov);
      const decor = buildDecor(monde);
      if (!renderer) {
        renderer = new Renderer(cv, assets, monde, decor);
        // le moteur du jeu occupe la fenêtre : ici, il suit son conteneur
        renderer.resize = () => {
          const l = Math.round(cv.clientWidth), h = Math.round(cv.clientHeight);
          if (l > 0 && h > 0) { cv.width = renderer.lightCanvas.width = l; cv.height = renderer.lightCanvas.height = h; }
        };
        renderer.resize();
        if (typeof ResizeObserver === 'function') new ResizeObserver(() => renderer.resize()).observe(cv);
      }
      renderer.setWorld(monde, decor, z.tint || null);
      renderer.scale = 0.5;
      em = new EntityManager2D(assets);
      this.peindreMini();
      this.lireOv();
      this.chargement = false;
      await this.rafraichir();
    },
    // aplats de la zone pour la minicarte (une fois par zone)
    peindreMini() {
      const N = monde.size;
      fond = document.createElement('canvas'); fond.width = fond.height = N;
      const fg = fond.getContext('2d'), img = fg.createImageData(N, N);
      const couleurs = Object.fromEntries(Object.entries(TILE_COLORS).map(([t, h]) => [t, rgb(h)]));
      for (let i = 0; i < N * N; i++) img.data.set([...(couleurs[monde.tile[i]] || [255, 0, 255]), 255], i * 4);
      fg.putImageData(img, 0, 0);
    },
    // copies réactives des retouches utiles à l'inspecteur
    lireOv() {
      this.musZones = copie(Array.isArray(ov?.music) ? ov.music : []);
      this.retires = (ov?.npcs?.remove || []).map(id => ({ cle: 'retire:' + id, nom: npcDefs[id]?.name || id }));
      if (this.aPlacer && !this.aPlacerListe.some(m => m.cle === this.aPlacer)) this.aPlacer = '';
    },
    async rafraichir() {
      if (!em) return;
      try {
        const d = await api(`/api/admin/monde/zone/${this.zoneId}`);
        this.indispo = '';
        this.joueurs = d.joueurs; this.musique = d.musique;
        const t = performance.now() / 1000;
        const vus = new Set(d.entites.map(e => e.id));
        for (const e of d.entites) if (!em.views.has(e.id)) em.addMeta(e);
        em.applySnapshot({ entities: d.entites, gone: [...em.views.keys()].filter(id => !vus.has(id)) }, t);
        worldTime = d.worldTime;
        const n = (k) => d.entites.filter(e => e.kind === k).length;
        this.compte = { pnj: n(KIND.NPC), creatures: n(KIND.MOB), objets: n(KIND.DROP) };
        // PNJ choisi : il réapparaît sous un autre id après une retouche
        if (this.choix?.type === 'pnj' && !vus.has(this.choix.id)) {
          const n = d.entites.find(e => e.kind === KIND.NPC && e.npcId === this.choix.npcId);
          if (n) this.choix = { ...this.choix, id: n.id, x: n.x, z: n.z }; else this.choix = null;
        }
      } catch (e) {
        // serveur lancé avant la mise à jour de la console : il ne connaît pas
        // encore ces routes, la carte resterait vide sans explication
        this.indispo = /Route inconnue|404/.test(e.message)
          ? 'Le serveur de jeu ne connaît pas encore la Carte du monde : redémarrez-le pour voir les joueurs, PNJ et créatures en direct.'
          : `Données en direct indisponibles : ${e.message}`;
        return;
      }
      if (this.choix?.type === 'joueur') await this.chargerFiche(false);
      if (this.onglet === 'journal') await this.chargerJournal();
    },
    async chargerJournal() {
      try { this.journal = (await api('/api/admin/monde/journal')).journal; } catch { /* droit absent */ }
    },

    // ---------- rendu ----------
    // entités montrées selon les calques
    filtrees() {
      const c = this.calques, garde = { [KIND.PLAYER]: c.joueurs, [KIND.NPC]: c.pnj, [KIND.MOB]: c.creatures, [KIND.DROP]: c.objets };
      const views = new Map();
      for (const [id, v] of em.views) if (garde[v.kind] ?? true) views.set(id, v);
      return { views, get: (id) => em.get(id) };
    },
    image() {
      requestAnimationFrame(() => this.image());
      if (!renderer || !em || !visible()) return;
      const now = performance.now() / 1000, dt = Math.min(0.1, now - (dernier || now));
      dernier = now; worldTime += dt;
      em.update(now - INTERP, now, dt);
      if (tirePnj) { const v = em.get(tirePnj.id); if (v) { v.buf = []; v.x = tirePnj.x; v.z = tirePnj.z; } }
      renderer.previewDaylight = this.calques.eclairage ? null : 1;
      const choisi = this.choix && this.choix.type !== 'musique' ? this.choix.id : null;
      renderer.render(this.filtrees(), worldTime, now, -1, { targetId: choisi, targetColor: '#c9a45c' });
      this.surcouches();
      this.dessinerMini();
    },
    // formes en cases -> écran (losanges et ellipses de la vue iso)
    tracer(g, f) {
      const s = renderer.scale;
      g.beginPath();
      if (f.shape === 'circle') {
        const c = renderer.w2s(+f.x, +f.z), r = +f.r || 0;
        g.ellipse(c.x, c.y, r * HW * s * Math.SQRT2, r * HH * s * Math.SQRT2, 0, 0, Math.PI * 2);
      } else {
        const x = +f.x, z = +f.z, w = +f.w || 0, h = +f.h || 0;
        [[x, z], [x + w, z], [x + w, z + h], [x, z + h]].forEach(([a, b], i) => { const p = renderer.w2s(a, b); i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y); });
        g.closePath();
      }
    },
    surcouches() {
      const g = renderer.ctx, c = this.calques;
      g.save();
      if (c.apparition) {
        const camps = Array.isArray(ov?.camps) ? ov.camps : (monde.spawnZones || []).map(s => ({ x: s.center[0], z: s.center[1], r: s.radius }));
        g.fillStyle = 'rgba(220, 80, 60, .14)'; g.strokeStyle = 'rgba(240, 110, 90, .8)'; g.lineWidth = 1.5;
        for (const k of camps) { this.tracer(g, { shape: 'circle', x: k.x, z: k.z, r: k.r || 4 }); g.fill(); g.stroke(); }
      }
      if (c.musique || brouillon) {
        g.setLineDash([6, 4]); g.lineWidth = 1.5; g.font = '12px Inter, system-ui, sans-serif'; g.textAlign = 'center';
        for (const m of [...(c.musique ? this.musZones : []), ...(brouillon ? [brouillon] : [])]) {
          const choisi = this.choix?.type === 'musique' && this.choix.id === m.id;
          g.fillStyle = choisi ? 'rgba(201, 164, 92, .18)' : 'rgba(150, 120, 230, .14)';
          g.strokeStyle = choisi ? '#c9a45c' : 'rgba(170, 140, 245, .95)';
          this.tracer(g, m); g.fill(); g.stroke();
          if (m !== brouillon) {
            const p = m.shape === 'circle' ? renderer.w2s(+m.x, +m.z) : renderer.w2s(+m.x + (+m.w || 0) / 2, +m.z + (+m.h || 0) / 2);
            const t = this.nomPiste(m.track), w = g.measureText(t).width + 10;
            g.fillStyle = 'rgba(11, 12, 15, .8)'; g.fillRect(p.x - w / 2, p.y - 9, w, 18);
            g.fillStyle = '#d6c8ff'; g.fillText(t, p.x, p.y + 4);
          }
          if (choisi && this.peut('zones_musicales')) {
            const p = this.poignee(m);
            g.setLineDash([]); g.fillStyle = '#c9a45c'; g.strokeStyle = '#0b0c0f'; g.lineWidth = 1.5;
            g.fillRect(p.x - 5, p.y - 5, 10, 10); g.strokeRect(p.x - 5, p.y - 5, 10, 10);
            g.setLineDash([6, 4]);
          }
        }
        g.setLineDash([]);
      }
      if (this.point) {
        const p = renderer.w2s(this.point.x, this.point.z);
        g.strokeStyle = '#fff'; g.lineWidth = 2;
        g.beginPath(); g.ellipse(p.x, p.y, 14, 7, 0, 0, Math.PI * 2); g.moveTo(p.x, p.y - 12); g.lineTo(p.x, p.y + 4); g.stroke();
      }
      g.restore();
    },
    dessinerMini() {
      if (!mini || !fond) return;
      const g = mini.getContext('2d'), N = monde.size, k = MINI / N;
      g.imageSmoothingEnabled = false;
      g.drawImage(fond, 0, 0, MINI, MINI);
      g.fillStyle = '#5fb3f0';
      for (const j of this.ici) g.fillRect(j.x * k - 1.5, j.z * k - 1.5, 3, 3);
      // emprise de la vue (losange : coins de l'écran ramenés en cases)
      const W = cv.width, H = cv.height;
      g.strokeStyle = '#fff'; g.lineWidth = 1; g.beginPath();
      [[0, 0], [W, 0], [W, H], [0, H]].forEach(([x, y], i) => { const m = renderer.s2w(x, y); i ? g.lineTo(m.x * k, m.z * k) : g.moveTo(m.x * k, m.z * k); });
      g.closePath(); g.stroke();
    },
    zoom(f, sx = cv.width / 2, sy = cv.height / 2) {
      if (!renderer) return;
      const avant = renderer.s2w(sx, sy);
      renderer.scale = Math.max(ECHELLE_MIN, Math.min(ECHELLE_MAX, renderer.scale * f));
      const apres = renderer.s2w(sx, sy);
      renderer.cam.x += avant.x - apres.x; renderer.cam.z += avant.z - apres.z;
    },
    viser(x, z) { if (renderer) { renderer.cam.x = x; renderer.cam.z = z; } },
    centrer() {
      const v = this.choix && this.choix.type !== 'musique' && em?.get(this.choix.id);
      const m = this.zoneMus;
      if (v) this.viser(v.x, v.z);
      else if (m) this.viser(m.shape === 'circle' ? +m.x : +m.x + (+m.w || 0) / 2, m.shape === 'circle' ? +m.z : +m.z + (+m.h || 0) / 2);
      else if (this.point) this.viser(this.point.x, this.point.z);
    },

    // ---------- interaction ----------
    brancher() {
      cv = document.getElementById('mc-carte');
      mini = document.getElementById('mc-mini');
      const pos = (e) => { const r = cv.getBoundingClientRect(); return { sx: e.clientX - r.left, sy: e.clientY - r.top }; };
      cv.addEventListener('wheel', (e) => { e.preventDefault(); const { sx, sy } = pos(e); this.zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15, sx, sy); }, { passive: false });
      cv.addEventListener('pointerdown', (e) => {
        if (!renderer || e.button > 0) return;
        cv.setPointerCapture(e.pointerId);
        const { sx, sy } = pos(e), m = renderer.s2w(sx, sy);
        if (this.outil === 'musique') { brouillon = { id: '', shape: 'rect', x0: Math.floor(m.x), z0: Math.floor(m.z), x: Math.floor(m.x), z: Math.floor(m.z), w: 1, h: 1 }; return; }
        // zone musicale choisie : la poignée la redimensionne, l'intérieur la déplace
        const zm = this.outil === 'selection' && this.peut('zones_musicales') && this.zoneMus;
        if (zm) {
          const p = this.poignee(zm);
          if (Math.abs(sx - p.x) <= 8 && Math.abs(sy - p.y) <= 8) { tireMus = { m: zm, mode: 'taille', avant: copie(zm), bouge: false }; return; }
          if (this.dans(zm, m)) { tireMus = { m: zm, mode: 'deplacer', avant: copie(zm), dx: m.x - zm.x, dz: m.z - zm.z, bouge: false }; return; }
        }
        // PNJ déjà choisi : on le saisit pour le déplacer
        if (this.outil === 'selection' && this.choix?.type === 'pnj' && this.peut('pnj_placement')) {
          const v = this.filtrees().views.get(this.choix.id);
          if (v && renderer.pickEntity({ views: new Map([[v.id, v]]) }, sx, sy, 0)) { tirePnj = { id: v.id, x: v.x, z: v.z, bouge: false }; return; }
        }
        glisse = { sx, sy, cx: renderer.cam.x, cz: renderer.cam.z, bouge: false };
      });
      cv.addEventListener('pointermove', (e) => {
        if (!renderer) return;
        const { sx, sy } = pos(e), m = renderer.s2w(sx, sy), x = Math.floor(m.x), z = Math.floor(m.z);
        this.curseur = x >= 0 && z >= 0 && x < monde.size && z < monde.size ? `${x}, ${z} · ${TILE_NAMES[monde.tile[z * monde.size + x]] || '?'}` : '';
        if (brouillon) {
          brouillon.x = Math.min(brouillon.x0, x); brouillon.z = Math.min(brouillon.z0, z);
          brouillon.w = Math.abs(x - brouillon.x0) + 1; brouillon.h = Math.abs(z - brouillon.z0) + 1;
          return;
        }
        if (tirePnj) { tirePnj.x = Math.round(m.x * 2) / 2; tirePnj.z = Math.round(m.z * 2) / 2; tirePnj.bouge = true; return; }
        if (tireMus) {
          const zm = tireMus.m, a = tireMus.avant;
          if (tireMus.mode === 'deplacer') {
            const nx = Math.round(m.x - tireMus.dx), nz = Math.round(m.z - tireMus.dz);
            tireMus.bouge ||= nx !== +a.x || nz !== +a.z;
            zm.x = nx; zm.z = nz;
          } else if (zm.shape === 'circle') {
            zm.r = Math.max(MUS_MIN / 2, Math.round(Math.hypot(m.x - zm.x, m.z - zm.z))); tireMus.bouge = true;
          } else {
            zm.w = Math.max(MUS_MIN, x - zm.x + 1); zm.h = Math.max(MUS_MIN, z - zm.z + 1); tireMus.bouge = true;
          }
          return;
        }
        if (!glisse) return;
        const dx = sx - glisse.sx, dy = sy - glisse.sy;
        if (Math.abs(dx) + Math.abs(dy) > 3) glisse.bouge = true;
        if (!glisse.bouge) return;
        // déplacement écran -> cases (inverse de la projection iso)
        const a = dx / (HW * renderer.scale), b = dy / (HH * renderer.scale);
        renderer.cam.x = glisse.cx - (a + b) / 2; renderer.cam.z = glisse.cz - (b - a) / 2;
      });
      cv.addEventListener('pointerup', (e) => {
        if (brouillon) { const b = brouillon; brouillon = null; this.creerZoneMusicale(b); return; }
        if (tirePnj) { const t = tirePnj; tirePnj = null; if (t.bouge) this.deplacerPnj(this.choix.npcId, t.x, t.z); return; }
        if (tireMus) { const t = tireMus; tireMus = null; if (t.bouge) this.formeZoneMusicale(t.m); return; }
        const g0 = glisse; glisse = null;
        if (!g0 || g0.bouge) return;
        const { sx, sy } = pos(e);
        this.cliquer(sx, sy);
      });
      mini.addEventListener('pointerdown', (e) => {
        if (!monde) return;
        const r = mini.getBoundingClientRect(), k = monde.size / r.width;
        this.viser((e.clientX - r.left) * k, (e.clientY - r.top) * k);
      });
      addEventListener('keydown', (e) => {
        if (!visible() || e.ctrlKey || e.metaKey || e.altKey || /input|select|textarea/i.test(e.target.tagName)) return;
        const o = { v: 'selection', p: 'pnj', m: 'musique' }[e.key.toLowerCase()];
        if (o) this.choisirOutil(o);
        if (e.key === 'Escape') { this.choix = null; this.point = null; }
      });
    },
    cliquer(sx, sy) {
      const m = renderer.s2w(sx, sy), ici = { x: Math.round(m.x * 2) / 2, z: Math.round(m.z * 2) / 2 };
      if (this.outil === 'pnj') { this.placerPnj(ici.x, ici.z); return; }
      const v = renderer.pickEntity(this.filtrees(), sx, sy, 0);
      if (v?.kind === KIND.PLAYER) { this.choisirJoueur(v.id); return; }
      this.onglet = 'selection';
      if (v?.kind === KIND.NPC) { this.choix = { type: 'pnj', id: v.id, nom: v.meta.name, npcId: v.meta.npcId, x: v.x, z: v.z }; return; }
      if (v?.kind === KIND.MOB) { this.choix = { type: 'creature', id: v.id, nom: v.meta.name, niveau: v.level || v.meta.level, boss: !!v.meta.boss }; return; }
      const mz = this.calques.musique && [...this.musZones].reverse().find(z => this.dans(z, m));
      if (mz) { this.choix = { type: 'musique', id: mz.id }; return; }
      this.point = ici;
      this.choix = null;
    },
    async choisirJoueur(id) {
      this.choix = { type: 'joueur', id }; this.onglet = 'selection';
      const j = this.joueurs.find(p => p.id === id);
      if (j && j.zoneId !== this.zoneId) { await this.changerZone(j.zoneId); this.choix = { type: 'joueur', id }; }
      await this.chargerFiche(true);
      if (j) this.viser(j.x, j.z);
    },
    async chargerFiche(remplir) {
      if (!this.peut('joueurs', 1) && !this.peut('sanctions', 1)) {
        const j = this.joueurs.find(p => p.id === this.choix.id);
        this.fiche = j ? { ...j, flags: {} } : null;
      } else {
        try { this.fiche = await api(`/api/admin/monde/joueur/${this.choix.id}`); }
        catch { this.choix = null; this.dire('Ce joueur n’est plus connecté.'); return; }
      }
      if (remplir || !this.dirtyEtat) this.etat = { level: this.fiche.level, gold: this.fiche.gold, hp: this.fiche.hp };
    },

    // ---------- retouches de la zone (PNJ, zones musicales), à chaud ----------
    // relit les retouches avant d'écrire : un autre écran a pu les changer
    async majOv(modif, succes) {
      try {
        const o = await api(`/api/admin/overrides/${this.zoneId}`);
        modif(o);
        await api(`/api/admin/overrides/${this.zoneId}`, 'PUT', o);
        ov = o; this.lireOv();
        this.dire('✔ ' + succes);
        await this.rafraichir();
        return true;
      } catch (e) { this.dire('✘ ' + e.message, true); return false; }
    },
    npcsDe(o) {
      if (!o.npcs || typeof o.npcs !== 'object') o.npcs = {};
      o.npcs.add ??= []; o.npcs.remove ??= []; o.npcs.move ??= []; o.npcs.edit ??= {};
      return o.npcs;
    },
    // un PNJ ajouté se déplace sur place, un PNJ par défaut reçoit une entrée `move`
    poser(o, npcId, x, z) {
      const n = this.npcsDe(o), a = n.add.find(e => e.id === npcId);
      if (a) { a.x = x; a.z = z; return; }
      const mv = n.move.find(m => m.npcId === npcId);
      if (mv) { mv.x = x; mv.z = z; } else n.move.push({ npcId, x, z });
    },
    deplacerPnj(npcId, x, z) {
      return this.majOv(o => this.poser(o, npcId, x, z), `${this.choix?.nom || npcId} déplacé en ${x}, ${z}.`);
    },
    async retirerPnj() {
      const { npcId, nom } = this.choix;
      if (!confirm(`Retirer ${nom} de ${this.nomZone(this.zoneId)} ? Il pourra être replacé avec l’outil « Placer un PNJ ».`)) return;
      if (await this.majOv(o => {
        const n = this.npcsDe(o);
        if (n.add.some(e => e.id === npcId)) n.add = n.add.filter(e => e.id !== npcId);
        else { if (!n.remove.includes(npcId)) n.remove.push(npcId); n.move = n.move.filter(m => m.npcId !== npcId); }
      }, `${nom} retiré de la carte.`)) this.choix = null;
    },
    async placerPnj(x, z) {
      const cle = this.aPlacer;
      if (!cle) { this.dire('Choisissez d’abord le PNJ à placer dans l’inspecteur.', true); return; }
      const nom = this.nomAPlacer;
      await this.majOv(o => {
        const n = this.npcsDe(o);
        if (cle.startsWith('retire:')) {
          const id = cle.slice(7);
          n.remove = n.remove.filter(r => r !== id);
          this.poser(o, id, x, z);
        } else if (cle === 'nouveau') {
          n.add.push({ id: idNeuf('pnj_'), x, z, name: 'Nouveau PNJ', role: 'bavard', look: copie(npcDefs.merchant?.look ?? null), greetings: ['Bien le bonjour.'], dialogues: [] });
        } else {
          // copie d'un modèle : apparence, rôle, étal et phrases (sans ses
          // dialogues de quête, propres au PNJ d'origine)
          const d = npcDefs[cle.slice(7)] || {};
          const champs = Object.fromEntries(['name', 'role', 'look', 'greetings', 'sells', 'teaches', 'teachesSkills', 'level', 'hp', 'stats', 'equip']
            .filter(k => d[k] !== undefined).map(k => [k, copie(d[k])]));
          n.add.push({ id: idNeuf('pnj_'), x, z, role: 'bavard', ...champs, dialogues: [] });
        }
      }, `${nom} placé en ${x}, ${z}.`);
      if (cle.startsWith('retire:')) this.aPlacer = '';
    },
    creerZoneMusicale(b) {
      if (b.w < MUS_MIN || b.h < MUS_MIN) { this.dire(`Zone trop petite : glissez sur au moins ${MUS_MIN} cases de côté.`, true); return; }
      const id = idNeuf('mus_');
      const zone = { id, shape: 'rect', x: b.x, z: b.z, w: b.w, h: b.h, track: this.groupes[0] ? { group: this.groupes[0] } : { new: null, legacy: null }, priority: 0 };
      this.majOv(o => { if (!Array.isArray(o.music)) o.music = []; o.music.push(zone); }, 'Zone musicale créée : choisissez son groupe dans l’inspecteur.')
        .then(ok => { if (ok) { this.choix = { type: 'musique', id }; this.onglet = 'selection'; } });
    },
    majZoneMusicale(champ, valeur) {
      const id = this.choix.id;
      this.majOv(o => {
        const m = (o.music || []).find(x => x.id === id);
        if (!m) throw new Error('Cette zone musicale n’existe plus.');
        if (champ === 'groupe') m.track = { group: valeur };
        else m.priority = +valeur || 0;
      }, 'Zone musicale mise à jour, appliquée aux joueurs présents.');
    },
    supprimerZoneMusicale() {
      const id = this.choix.id;
      if (!confirm('Supprimer cette zone musicale ?')) return;
      this.majOv(o => { o.music = (o.music || []).filter(x => x.id !== id); }, 'Zone musicale supprimée.')
        .then(ok => { if (ok) this.choix = null; });
    },
    dans(z, m) {
      return z.shape === 'circle' ? Math.hypot(m.x - z.x, m.z - z.z) <= +z.r
        : m.x >= z.x && m.x < +z.x + +z.w && m.z >= z.z && m.z < +z.z + +z.h;
    },
    // poignée de redimensionnement (écran) : coin opposé du rectangle, bord est du cercle
    poignee(z) {
      return z.shape === 'circle' ? renderer.w2s(+z.x + +z.r, +z.z) : renderer.w2s(+z.x + +z.w, +z.z + +z.h);
    },
    // position et taille après un glisser (rien d'autre n'est réécrit)
    formeZoneMusicale(z) {
      const forme = z.shape === 'circle' ? { x: z.x, z: z.z, r: z.r } : { x: z.x, z: z.z, w: z.w, h: z.h };
      this.majOv(o => {
        const m = (o.music || []).find(x => x.id === z.id);
        if (!m) throw new Error('Cette zone musicale n’existe plus.');
        Object.assign(m, forme);
      }, `Zone musicale ${z.shape === 'circle' ? `centrée en ${z.x}, ${z.z}, rayon ${z.r}` : `en ${z.x}, ${z.z}, ${z.w} × ${z.h} cases`}.`)
        .then(ok => { if (!ok) this.lireOv(); });
    },
    choisirZoneMusicale(id) { this.choix = { type: 'musique', id }; this.centrer(); },

    // ---------- actions sur un joueur ----------
    async agir(action, corps = {}, succes = '') {
      try {
        const r = await api(`/api/admin/monde/joueur/${this.choix.id}`, 'POST', { action, ...corps });
        this.dire('✔ ' + succes);
        await this.rafraichir();
        return r;
      } catch (e) { this.dire('✘ ' + e.message, true); return null; }
    },
    async appliquerEtat() {
      const corps = {};
      for (const k of ['level', 'gold', 'hp']) if (this.etat[k] !== '' && +this.etat[k] !== this.fiche[k]) corps[k] = +this.etat[k];
      const r = await this.agir('etat', corps, `État de ${this.fiche.name} appliqué à chaud.`);
      if (r?.joueur) { this.fiche = { ...this.fiche, ...r.joueur }; this.etat = { level: this.fiche.level, gold: this.fiche.gold, hp: this.fiche.hp }; }
    },
    annulerEtat() { this.etat = { level: this.fiche.level, gold: this.fiche.gold, hp: this.fiche.hp }; },
    async majDrapeaux(flags) {
      const r = await this.agir('drapeaux', { flags }, 'Drapeaux mis à jour.');
      if (r) this.fiche.flags = r.flags;
    },
    ajouterDrapeau() {
      const k = this.drapeauNeuf.trim();
      if (!k) return;
      this.drapeauNeuf = '';
      this.majDrapeaux({ ...this.fiche.flags, [k]: true });
    },
    retirerDrapeau(k) { const f = { ...this.fiche.flags }; delete f[k]; this.majDrapeaux(f); },
    async envoyer() {
      if (!this.texte.trim()) return;
      if (await this.agir('message', { texte: this.texte }, `Message envoyé à ${this.fiche.name}.`)) this.texte = '';
    },
    async sanction(action) {
      const nom = this.fiche.name;
      if (action === 'expulser' && !confirm(`Expulser ${nom} ?`)) return;
      if (action === 'bannir' && !confirm(`Bannir ${nom} ? Il ne pourra plus se connecter (levée dans Accès et rôles, onglet Comptes).`)) return;
      const r = await this.agir(action, action === 'muet' ? { minutes: this.muetMin } : {},
        { expulser: `${nom} expulsé.`, bannir: `${nom} banni.`, muet: this.muetMin ? `${nom} réduit au silence ${this.muetMin} min.` : `${nom} peut de nouveau parler.` }[action]);
      if (r && action !== 'muet') this.choix = null;
    },
    async entrerIci() {
      if (!this.point) { this.dire('Cliquez d’abord un point de la carte.', true); return; }
      try {
        await api('/api/admin/teleport', 'POST', { zoneId: this.zoneId, x: this.point.x, z: this.point.z });
        this.dire(`✔ Votre personnage est à ${Math.round(this.point.x)}, ${Math.round(this.point.z)}.`);
      } catch (e) { this.dire('✘ ' + e.message, true); }
    },
    async voirJournal() { this.onglet = 'journal'; await this.chargerJournal(); },

    // moteur et ressources du jeu (images de toutes les planches) : chargés à
    // la première ouverture de l'écran seulement
    init() {
      const veille = setInterval(() => { if (visible()) { clearInterval(veille); this.demarrer(); } }, 300);
    },
    async demarrer() {
      try {
        const [z, n, mu] = await Promise.all([
          api('/api/admin/content/zones'),
          api('/api/admin/content/npcs').catch(() => ({})),
          api('/api/admin/music').catch(() => ({})),
        ]);
        this.zones = z.zones || [];
        npcDefs = n.npc || {};
        this.modeles = Object.entries(npcDefs).map(([id, d]) => ({ cle: 'modele:' + id, nom: d.name || id })).sort((a, b) => a.nom.localeCompare(b.nom));
        this.groupes = Object.keys(mu.map?.groups || {}).sort();
        assets = await loadAssets();
        this.brancher();
        if (this.zones.length) await this.changerZone(this.zones[0].id);
      } catch (e) { this.dire('✘ ' + e.message, true); this.chargement = false; }
      this.image();
      setInterval(() => { if (visible()) this.rafraichir(); }, RAFRAICHIR_MS);
    },
  };
}
