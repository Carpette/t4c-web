// Monde, Carte du monde : d'après la maquette. La zone vue du dessus (même
// générateur que le jeu + retouches de la zone), joueurs et PNJ en direct,
// zones musicales et d'apparition ; inspecteur du joueur choisi (aller à
// lui, l'amener, message, état à chaud, drapeaux, sanctions) et journal.
import { generateWorld } from '../../../../shared/worldgen.js';
import { applyOverrides } from '../../../../shared/overrides.js';
import { TILE_COLORS, TILE_NAMES } from '../../palette.js';
import { consoleEtat } from '../../console.js';

const RAFRAICHIR_MS = 2000;
const rgb = (hex) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const duree = (ms) => {
  const m = Math.max(0, Math.round(ms / 60000));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
};

export function MondeCarteController(api) {
  // hors réactivité : gros tableaux et canevas
  let monde = null, ov = null, fond = null, cv = null, g = null, glisse = null;
  const vue = { x: 0, z: 0, k: 2 }; // centre (cases) et échelle (px par case)

  return {
    zones: [], zoneId: 0, chargement: true,
    calques: { terrain: true, pnj: true, joueurs: true, musique: true, apparition: false, noms: true },
    joueurs: [], pnj: [], musique: null, groupes: {}, journal: [],
    onglet: 'selection', choix: null, fiche: null, etat: { level: '', gold: '', hp: '' }, drapeauNeuf: '',
    point: null, curseur: '', message: '', erreur: false, muetMin: 15, texte: '',

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
    pct(a, b) { return b ? Math.max(0, Math.min(100, (a / b) * 100)) : 0; },
    depuis(t) { return t ? duree(Date.now() - t) : ''; },
    restant(t) { return duree(t - Date.now()); },
    heure(t) { return new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); },
    nomZone(id) { return this.zones.find(z => z.id === id)?.name ?? `zone ${id}`; },

    dire(t, err = false) { this.message = t; this.erreur = err; },

    // ---------- zone ----------
    async changerZone(id) {
      this.zoneId = +id; this.chargement = true; this.point = null;
      const z = this.zones.find(x => x.id === this.zoneId);
      try { ov = await api(`/api/admin/overrides/${this.zoneId}`); } catch { ov = null; }
      // laisse le navigateur peindre « chargement » : la génération prend ~250 ms
      await new Promise(r => setTimeout(r, 0));
      monde = applyOverrides(generateWorld(z.seed, z.map), ov);
      const N = monde.size;
      fond = document.createElement('canvas'); fond.width = fond.height = N;
      const fg = fond.getContext('2d'), img = fg.createImageData(N, N);
      const couleurs = Object.fromEntries(Object.entries(TILE_COLORS).map(([t, h]) => [t, rgb(h)]));
      for (let i = 0; i < N * N; i++) {
        const [r, gg, b] = couleurs[monde.tile[i]] || [255, 0, 255];
        img.data.set([r, gg, b, 255], i * 4);
      }
      fg.putImageData(img, 0, 0);
      vue.x = monde.spawnPoint?.x ?? N / 2; vue.z = monde.spawnPoint?.z ?? N / 2;
      vue.k = Math.max(1, Math.min(6, (cv?.width || 900) / 180));
      this.chargement = false;
      await this.rafraichir();
    },
    async rafraichir() {
      try {
        const d = await api(`/api/admin/monde/zone/${this.zoneId}`);
        this.joueurs = d.joueurs; this.pnj = d.pnj; this.musique = d.musique;
      } catch (e) { this.dire('✘ ' + e.message, true); }
      if (this.choix?.type === 'joueur') await this.chargerFiche(false);
      if (this.onglet === 'journal') await this.chargerJournal();
      this.dessiner();
    },
    async chargerJournal() {
      try { this.journal = (await api('/api/admin/monde/journal')).journal; } catch { /* droit absent */ }
    },

    // ---------- dessin ----------
    versEcran(x, z) { return { x: cv.width / 2 + (x - vue.x) * vue.k, y: cv.height / 2 + (z - vue.z) * vue.k }; },
    versMonde(sx, sy) { return { x: vue.x + (sx - cv.width / 2) / vue.k, z: vue.z + (sy - cv.height / 2) / vue.k }; },
    dessiner() {
      if (!g || !monde) return;
      const W = cv.width, H = cv.height, N = monde.size, c = this.calques;
      g.fillStyle = '#0b0c0f'; g.fillRect(0, 0, W, H);
      const o = this.versEcran(0, 0);
      if (c.terrain) { g.imageSmoothingEnabled = false; g.drawImage(fond, o.x, o.y, N * vue.k, N * vue.k); }
      else { g.strokeStyle = '#2a2e36'; g.strokeRect(o.x, o.y, N * vue.k, N * vue.k); }
      // zones d'apparition : camps posés sur la carte, sinon ceux du générateur
      if (c.apparition) {
        const camps = Array.isArray(ov?.camps) ? ov.camps.map(k => ({ x: k.x, z: k.z, r: k.r || 4 }))
          : (monde.spawnZones || []).map(s => ({ x: s.center[0], z: s.center[1], r: s.radius }));
        g.fillStyle = 'rgba(220, 80, 60, .18)'; g.strokeStyle = 'rgba(240, 110, 90, .7)';
        for (const s of camps) { const p = this.versEcran(s.x, s.z); g.beginPath(); g.arc(p.x, p.y, s.r * vue.k, 0, 7); g.fill(); g.stroke(); }
      }
      if (c.musique) {
        g.strokeStyle = 'rgba(150, 120, 230, .9)'; g.fillStyle = 'rgba(150, 120, 230, .12)'; g.setLineDash([5, 4]);
        for (const m of ov?.music || []) {
          const p = this.versEcran(+m.x, +m.z);
          g.beginPath();
          if (m.shape === 'circle') g.arc(p.x, p.y, (+m.r || 0) * vue.k, 0, 7); else g.rect(p.x, p.y, (+m.w || 0) * vue.k, (+m.h || 0) * vue.k);
          g.fill(); g.stroke();
        }
        g.setLineDash([]);
      }
      g.font = '12px Inter, system-ui, sans-serif'; g.textAlign = 'center';
      const etiquette = (p, txt, coul) => {
        if (!c.noms) return;
        const w = g.measureText(txt).width + 8;
        g.fillStyle = 'rgba(11, 12, 15, .8)'; g.fillRect(p.x - w / 2, p.y - 24, w, 16);
        g.fillStyle = coul; g.fillText(txt, p.x, p.y - 12);
      };
      if (c.pnj) for (const n of this.pnj) {
        const p = this.versEcran(n.x, n.z);
        g.fillStyle = '#e8c37a'; g.beginPath(); g.moveTo(p.x, p.y - 6); g.lineTo(p.x + 5, p.y); g.lineTo(p.x, p.y + 6); g.lineTo(p.x - 5, p.y); g.fill();
        // noms des PNJ à partir d'un zoom lisible : ils se chevauchent au village sinon
        if (vue.k >= 6 || this.choix?.id === n.id) etiquette(p, n.name, '#e8c37a');
      }
      if (c.joueurs) for (const j of this.ici) {
        const p = this.versEcran(j.x, j.z), choisi = this.choix?.type === 'joueur' && this.choix.id === j.id;
        g.fillStyle = j.admin ? '#c9a45c' : '#5fb3f0';
        g.beginPath(); g.arc(p.x, p.y, choisi ? 7 : 5, 0, 7); g.fill();
        if (choisi) { g.strokeStyle = '#fff'; g.lineWidth = 2; g.stroke(); g.lineWidth = 1; }
        etiquette(p, j.name, '#cfe8ff');
      }
      if (this.point) {
        const p = this.versEcran(this.point.x, this.point.z);
        g.strokeStyle = '#fff'; g.beginPath(); g.moveTo(p.x - 7, p.y); g.lineTo(p.x + 7, p.y); g.moveTo(p.x, p.y - 7); g.lineTo(p.x, p.y + 7); g.stroke();
      }
    },
    zoom(f, sx = cv.width / 2, sy = cv.height / 2) {
      const avant = this.versMonde(sx, sy);
      vue.k = Math.max(0.5, Math.min(24, vue.k * f));
      const apres = this.versMonde(sx, sy);
      vue.x += avant.x - apres.x; vue.z += avant.z - apres.z;
      this.dessiner();
    },
    centrer() {
      const j = this.choix?.type === 'joueur' && this.joueurs.find(p => p.id === this.choix.id);
      const cible = j && j.zoneId === this.zoneId ? j : this.point;
      if (!cible) return;
      vue.x = cible.x; vue.z = cible.z; this.dessiner();
    },

    // ---------- interaction ----------
    brancher() {
      cv = document.getElementById('mc-carte');
      if (!cv) return;
      g = cv.getContext('2d');
      const ajuster = () => { const l = Math.round(cv.clientWidth); if (l > 0 && l !== cv.width) { cv.width = l; this.dessiner(); } };
      if (typeof ResizeObserver === 'function') new ResizeObserver(ajuster).observe(cv);
      cv.addEventListener('wheel', (e) => { e.preventDefault(); const r = cv.getBoundingClientRect(); this.zoom(e.deltaY < 0 ? 1.2 : 1 / 1.2, e.clientX - r.left, e.clientY - r.top); }, { passive: false });
      cv.addEventListener('pointerdown', (e) => { glisse = { x: e.clientX, y: e.clientY, vx: vue.x, vz: vue.z, bouge: false }; cv.setPointerCapture(e.pointerId); });
      cv.addEventListener('pointermove', (e) => {
        const r = cv.getBoundingClientRect(), m = this.versMonde(e.clientX - r.left, e.clientY - r.top);
        if (monde) {
          const x = Math.floor(m.x), z = Math.floor(m.z);
          this.curseur = x >= 0 && z >= 0 && x < monde.size && z < monde.size ? `${x}, ${z} · ${TILE_NAMES[monde.tile[z * monde.size + x]] || '?'}` : '';
        }
        if (!glisse) return;
        const dx = e.clientX - glisse.x, dy = e.clientY - glisse.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) glisse.bouge = true;
        if (glisse.bouge) { vue.x = glisse.vx - dx / vue.k; vue.z = glisse.vz - dy / vue.k; this.dessiner(); }
      });
      cv.addEventListener('pointerup', (e) => {
        const g0 = glisse; glisse = null;
        if (!g0 || g0.bouge) return;
        const r = cv.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top;
        this.cliquer(sx, sy);
      });
      ajuster();
    },
    cliquer(sx, sy) {
      const proche = (liste) => liste.map(o => ({ o, d: Math.hypot(this.versEcran(o.x, o.z).x - sx, this.versEcran(o.x, o.z).y - sy) }))
        .filter(x => x.d < 10).sort((a, b) => a.d - b.d)[0]?.o;
      const j = this.calques.joueurs && proche(this.ici);
      if (j) { this.choisirJoueur(j.id); return; }
      const n = this.calques.pnj && proche(this.pnj);
      if (n) { this.choix = { type: 'pnj', id: n.id, nom: n.name, npcId: n.npcId, x: n.x, z: n.z }; this.onglet = 'selection'; this.dessiner(); return; }
      const m = this.versMonde(sx, sy);
      this.point = { x: Math.round(m.x * 10) / 10, z: Math.round(m.z * 10) / 10 };
      this.choix = null;
      this.dessiner();
    },
    async choisirJoueur(id) {
      this.choix = { type: 'joueur', id }; this.onglet = 'selection';
      const j = this.joueurs.find(p => p.id === id);
      if (j && j.zoneId !== this.zoneId) await this.changerZone(j.zoneId);
      await this.chargerFiche(true);
      this.centrer();
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

    // ---------- actions ----------
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

    async init() {
      try {
        this.zones = (await api('/api/admin/content/zones')).zones || [];
        this.brancher();
        if (this.zones.length) await this.changerZone(this.zones[0].id);
      } catch (e) { this.dire('✘ ' + e.message, true); }
      // rafraîchi seulement quand l'écran est affiché
      setInterval(() => {
        if (document.getElementById('tab-monde-carte')?.classList.contains('visible') && !document.hidden) this.rafraichir();
      }, RAFRAICHIR_MS);
    },
  };
}
