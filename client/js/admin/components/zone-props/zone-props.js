// Forge, Zones : onglet « Propriétés et créatures », d'après la maquette.
// Édite content/zones.json (identité, génération, teinte, boss, créatures) ;
// le serveur valide (validerZones) et ces valeurs prennent effet au
// redémarrage. Le terrain lui-même se retouche dans l'onglet Terrain.
import { MOBS } from '../../../../shared/defs.js';
import { copie, norm } from '../../forge.js';
import { generateWorld } from '../../../../shared/worldgen.js';
import { applyOverrides } from '../../../../shared/overrides.js';
import { TILE_COLORS } from '../../palette.js';

const rgb = (hex) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));

// teinte « rgba(r, g, b, a) » <-> couleur + opacité
const lireTeinte = (t) => {
  const m = String(t || '').match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/);
  if (!m) return { couleur: '#ffffff', alpha: 0 };
  const hex = [m[1], m[2], m[3]].map(v => (+v).toString(16).padStart(2, '0')).join('');
  return { couleur: '#' + hex, alpha: m[4] == null ? 1 : +m[4] };
};
const ecrireTeinte = (couleur, alpha) => {
  const n = parseInt(couleur.slice(1), 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${Math.round(alpha * 100) / 100})`;
};

export function ZonePropsController(api) {
  let fichier = null, reference = '', minuteur = null;

  return {
    zones: [], courant: null, fiche: null, ajout: '', q: '', brouillon: null, // numéro de la zone créée, pas encore enregistrée
    musique: null, joueurs: [], pnj: [], message: '', erreur: false,

    get sale() { return !!this.fiche && JSON.stringify(this.fiche) !== reference; },
    get creatures() {
      // niveau en jeu = niveau de base + (minimum de la zone - 1), cf. scaleMob
      return (this.fiche?.mobs || []).map(id => ({ id, name: MOBS[id]?.name || id, level: (MOBS[id]?.level | 0) + this.decalage, inconnu: !MOBS[id] }));
    },
    get decalage() { return Math.max(0, (this.fiche?.levels?.[0] || 1) - 1); },
    get tropForts() { return this.creatures.filter(c => !c.inconnu && c.level > this.fiche.levels[1]); },
    get disponibles() {
      const q = norm(this.q.trim());
      return Object.entries(MOBS)
        .filter(([id, m]) => !this.fiche?.mobs.includes(id) && (!q || norm(m.name).includes(q) || id.includes(q)))
        .map(([id, m]) => ({ id, name: m.name, level: (m.level | 0) + this.decalage }))
        .sort((x, y) => x.level - y.level || x.name.localeCompare(y.name, 'fr'));
    },
    get bossDispo() {
      return Object.entries(MOBS).map(([id, m]) => ({ id, name: m.name, level: m.level | 0 })).sort((x, y) => x.level - y.level);
    },
    get teinte() { return lireTeinte(this.fiche?.tint); },
    get presents() { return this.joueurs.filter(p => p.zoneId === this.courant && !p.trial).length; },
    get pnjPlaces() { return this.pnj.filter(n => n.zoneId === this.courant).length; },
    get groupeMusique() {
      const s = this.musique?.map?.zones?.[this.courant];
      if (!s) return { nom: 'Aucune', detail: '' };
      if (s.group) return { nom: s.group, detail: `${this.musique.map.groups?.[s.group]?.new?.length || 0} pistes` };
      return { nom: s.new || s.legacy || 'Silence', detail: 'piste seule' };
    },
    etiquette(z) { return `${z.id} · ${z.name} (niv. ${z.levels[0]} à ${z.levels[1]})${z.id === this.brouillon ? ' · non enregistrée' : ''}`; },

    dire(t, err = false) { this.message = t; this.erreur = err; },

    ouvrir(id) {
      if (this.sale && id !== this.courant && !confirm('Abandonner les modifications de cette zone ?')) {
        const s = document.getElementById('zp-zone'); if (s) s.value = String(this.courant);
        return;
      }
      if (this.brouillon !== null && +id !== this.brouillon) { this.zones = this.zones.filter(z => z.id !== this.brouillon); this.brouillon = null; }
      this.courant = +id;
      const z = this.zones.find(x => x.id === +id);
      this.fiche = copie(z); reference = JSON.stringify(this.fiche);
      this.ajout = ''; this.dire('');
      this.apercu();
    },
    annuler() {
      if (this.courant === this.brouillon) { this.ouvrir(this.zones[0].id); return; }
      reference = ''; this.ouvrir(this.courant);
    },
    // nouvelle zone à la suite des autres : ses niveaux prolongent la
    // dernière, ses créatures en sont reprises ; générée au redémarrage
    nouvelle() {
      if (this.sale && !confirm('Abandonner les modifications de cette zone ?')) return;
      reference = '';
      const der = this.zones.at(-1), id = this.zones.length;
      this.zones = [...this.zones.filter(z => z.id !== this.brouillon), {
        id, name: 'Nouvelle zone', levels: [der.levels[1], Math.min(der.levels[1] + 25, 200)],
        seed: Math.floor(Math.random() * 1e7), tint: null, mobs: [...der.mobs], boss: null,
      }];
      this.brouillon = null; this.ouvrir(id); this.brouillon = id;
      reference = '';
      this.dire('Nouvelle zone : enregistrez-la, elle sera générée au prochain redémarrage du serveur.');
    },
    niveau(i, v) { const n = Math.round(+v); if (Number.isFinite(n)) this.fiche.levels[i] = n; },
    graine(v) { const n = Math.round(+v); if (Number.isFinite(n)) { this.fiche.seed = n; this.apercu(); } },
    nouvelleGraine() { this.fiche.seed = Math.floor(Math.random() * 1e7); this.apercu(); },
    carte(v) { this.fiche.map = v || undefined; this.apercu(); },

    // minicarte du résumé : la zone telle que la génère le serveur (graine ou
    // carte dessinée + retouches), PNJ et joueurs présents en points
    apercu() {
      clearTimeout(minuteur);
      minuteur = setTimeout(async () => {
        const cv = document.getElementById('zp-mini'), f = this.fiche;
        if (!cv || !f) return;
        let ov = null;
        if (f.id !== this.brouillon) try { ov = await api(`/api/admin/overrides/${f.id}`); } catch { /* sans retouches */ }
        if (this.fiche !== f) return;
        const monde = applyOverrides(generateWorld(f.seed, f.map), ov), N = monde.size;
        const fond = document.createElement('canvas'); fond.width = fond.height = N;
        const fg = fond.getContext('2d'), img = fg.createImageData(N, N);
        const couleurs = Object.fromEntries(Object.entries(TILE_COLORS).map(([t, h]) => [t, rgb(h)]));
        for (let i = 0; i < N * N; i++) img.data.set([...(couleurs[monde.tile[i]] || [255, 0, 255]), 255], i * 4);
        fg.putImageData(img, 0, 0);
        const g = cv.getContext('2d'), k = cv.width / N;
        g.imageSmoothingEnabled = false;
        g.drawImage(fond, 0, 0, cv.width, cv.height);
        const point = (x, z, c) => { g.fillStyle = c; g.beginPath(); g.arc(x * k, z * k, 2.5, 0, 7); g.fill(); };
        for (const n of this.pnj) if (n.zoneId === f.id && n.x != null) point(n.x, n.z, '#e9c46a');
        for (const p of this.joueurs) if (p.zoneId === f.id && !p.trial && p.x != null) point(p.x, p.z, '#5ec27a');
      }, 250);
    },
    fixerTeinte(couleur, alpha) {
      this.fiche.tint = +alpha > 0 ? ecrireTeinte(couleur, +alpha) : null;
    },
    ajouter() { if (this.ajout && !this.fiche.mobs.includes(this.ajout)) this.fiche.mobs.push(this.ajout); this.ajout = ''; },
    retirer(id) { this.fiche.mobs = this.fiche.mobs.filter(x => x !== id); },
    activerBoss(on) {
      if (on) this.fiche.boss = { defId: this.creatures.at(-1)?.id || 'rat', name: 'Nouveau boss', respawnMs: 3600000 };
      else this.fiche.boss = null;
    },
    bossMinutes(v) { const n = +v; if (n > 0) this.fiche.boss.respawnMs = Math.round(n * 60000); },

    async enregistrer() {
      const zones = this.zones.map(z => z.id === this.courant ? copie(this.fiche) : z);
      try {
        const r = await api('/api/admin/content/zones', 'PUT', { ...fichier, zones });
        fichier = { ...fichier, zones }; this.zones = zones;
        reference = JSON.stringify(this.fiche);
        const creee = this.brouillon === this.courant;
        this.brouillon = null;
        this.dire(creee ? `✔ ${this.fiche.name} créée : elle sera générée au prochain redémarrage du serveur (Publication).` : `✔ ${this.fiche.name} enregistrée. ${r.note || ''}`);
        window.dispatchEvent(new CustomEvent('t4c:contenu', { detail: { nom: 'zones', source: 'proprietes' } }));
      } catch (e) { this.dire('✘ ' + e.message, true); }
    },

    async init() {
      try {
        fichier = await api('/api/admin/content/zones');
        this.zones = fichier.zones || [];
        if (this.zones.length) this.ouvrir(this.zones[0].id);
      } catch (e) { this.dire('✘ ' + e.message, true); }
      // contexte facultatif (selon les droits du compte)
      try { this.musique = await api('/api/admin/music'); } catch { /* sans musique */ }
      try { this.joueurs = (await api('/api/admin/players')).players || []; } catch { /* sans joueurs */ }
      try { this.pnj = (await api('/api/admin/npcs/positions')).pnj || []; } catch { /* sans PNJ */ }
      this.apercu();
    },
  };
}
