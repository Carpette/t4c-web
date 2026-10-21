// Forge, Musiques : d'après la maquette. Groupes de pistes (pack « nouvelles »
// tiré au sort + piste legacy), emplacements (connexion, Épreuve, zones),
// import de fichiers et lecteur de pré-écoute commun.
import { copie } from '../../forge.js';

const VOLUME = 't4c-admin-volume';
const duree = (s) => Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '';
const lireB64 = (f) => new Promise((ok, ko) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result).split(',')[1] || '');
  r.onerror = () => ko(new Error(`lecture de ${f.name} impossible`));
  r.readAsDataURL(f);
});

export function MusicsController(api) {
  let reference = '', audio = null;

  return {
    fichiers: [], carte: { login: {}, trial: {}, zones: {}, groups: {} }, zones: [], sousZones: [],
    vue: 'groupe', courant: null, ajout: '', durees: {}, message: '', erreur: false, envoi: '',
    lecture: { fichier: '', joue: false, t: 0, d: 0, volume: 70 },

    // ---------- lectures ----------
    get groupes() {
      return Object.keys(this.carte.groups || {}).sort((a, b) => a.localeCompare(b, 'fr')).map(id => {
        const g = this.carte.groups[id], u = this.usages(id);
        return { id, n: g.new?.length || 0, resume: u.length ? u[0].court + (u.length > 1 ? ` +${u.length - 1}` : '') : 'non utilisé' };
      });
    },
    get groupe() { return this.carte.groups?.[this.courant] || null; },
    get emplacements() {
      return [['login', 'Écran de connexion'], ['trial', 'L’Épreuve'],
        ...this.zones.map(z => [String(z.id), z.name])].map(([k, nom]) => ({ k, nom }));
    },
    get sale() { return JSON.stringify(this.carte) !== reference; },
    get ajouts() { // pistes ajoutées au groupe ouvert depuis le dernier enregistrement
      if (!this.groupe) return [];
      const avant = JSON.parse(reference || '{}').groups?.[this.courant]?.new || [];
      return this.groupe.new.filter(f => !avant.includes(f));
    },
    get etat() {
      if (!this.groupe) return '';
      if (!JSON.parse(reference || '{}').groups?.[this.courant]) return 'Brouillon · nouveau groupe';
      const n = this.ajouts.length;
      return this.sale ? `Brouillon${n ? ` · ${n} piste${n > 1 ? 's' : ''} ajoutée${n > 1 ? 's' : ''}` : ''}` : 'Enregistré';
    },
    get disponibles() { return this.fichiers.filter(f => !this.groupe?.new.includes(f)); },
    get progression() { return this.lecture.d ? Math.min(100, (this.lecture.t / this.lecture.d) * 100) : 0; },

    slot(k) { return k === 'login' || k === 'trial' ? this.carte[k] : this.carte.zones[k]; },
    // où un groupe est joué : emplacements de music.json et sous-zones de la carte
    usages(id) {
      const out = [];
      for (const e of this.emplacements) if (this.slot(e.k)?.group === id) {
        out.push({ nom: /^\d+$/.test(e.k) ? `${e.nom}, toute la zone` : e.nom, court: /^\d+$/.test(e.k) ? `défaut d’${e.nom}` : e.nom, ou: 'emplacement' });
      }
      for (const s of this.sousZones) if (s.track?.group === id) out.push({ nom: `${s.zone}, zone « ${s.id} »`, court: 'zone musicale', ou: 'sur la carte' });
      return out;
    },
    duree(f) { return duree(this.durees[f]); },
    temps(s) { return s ? duree(s) : ''; },

    dire(t, err = false) { this.message = t; this.erreur = err; },

    // ---------- groupes ----------
    ouvrir(id) { this.vue = 'groupe'; this.courant = id; this.ajout = ''; this.mesurer(); },
    nouveau() {
      let n = 1, id = 'Nouveau groupe';
      while (this.carte.groups[id]) id = `Nouveau groupe ${++n}`;
      this.carte.groups[id] = { new: [], legacy: null };
      this.ouvrir(id);
    },
    renommer() {
      const ancien = this.courant, id = (prompt('Nouveau nom du groupe', ancien) || '').trim();
      if (!id || id === ancien) return;
      if (this.carte.groups[id]) { this.dire(`✘ Le groupe « ${id} » existe déjà.`, true); return; }
      // les sous-zones de la carte pointent le groupe par son nom : on ne les réécrit pas d'ici
      const carte = this.sousZones.filter(s => s.track?.group === ancien);
      if (carte.length) { this.dire(`✘ Utilisé par ${carte.length} zone(s) musicale(s) de la carte : renommez-les d’abord dans Zones et terrain.`, true); return; }
      const g = this.carte.groups[ancien];
      delete this.carte.groups[ancien];
      this.carte.groups[id] = g;
      for (const e of this.emplacements) if (this.slot(e.k)?.group === ancien) this.slot(e.k).group = id;
      this.courant = id;
    },
    supprimer() {
      const u = this.usages(this.courant);
      if (u.length) { this.dire(`✘ Encore joué dans : ${u.map(x => x.nom).join(', ')}.`, true); return; }
      if (!confirm(`Supprimer le groupe « ${this.courant} » ?`)) return;
      delete this.carte.groups[this.courant];
      this.courant = this.groupes[0]?.id || null;
      if (!this.courant) this.vue = 'emplacements';
    },
    ajouter() { if (this.ajout) { this.groupe.new.push(this.ajout); this.ajout = ''; this.mesurer(); } },
    retirer(i) { this.groupe.new.splice(i, 1); },

    // ---------- emplacements ----------
    // un emplacement joue un groupe, ou une piste seule (nouvelle + legacy)
    choisirGroupe(k, id) {
      const s = this.slot(k);
      if (id) { s.group = id; delete s.new; delete s.legacy; } else { delete s.group; s.new ??= null; s.legacy ??= null; }
    },
    piste(k, variante, f) { this.slot(k)[variante] = f || null; },

    // ---------- lecteur ----------
    jouer(f) {
      if (!f) return;
      if (!audio) {
        audio = new Audio();
        audio.addEventListener('timeupdate', () => { this.lecture.t = audio.currentTime; });
        audio.addEventListener('loadedmetadata', () => { this.lecture.d = audio.duration; });
        audio.addEventListener('play', () => { this.lecture.joue = true; });
        audio.addEventListener('pause', () => { this.lecture.joue = false; });
        audio.addEventListener('ended', () => { this.lecture.joue = false; });
      }
      audio.volume = this.lecture.volume / 100;
      if (this.lecture.fichier === f) { if (audio.paused) audio.play().catch(() => {}); else audio.pause(); return; }
      this.lecture.fichier = f; this.lecture.t = 0; this.lecture.d = this.durees[f] || 0;
      audio.src = `/assets/music/${encodeURIComponent(f)}`;
      audio.play().catch(() => {});
    },
    basculer() { if (this.lecture.fichier) this.jouer(this.lecture.fichier); },
    chercher(e) {
      if (!audio || !this.lecture.d) return;
      const r = e.currentTarget.getBoundingClientRect();
      audio.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * this.lecture.d;
    },
    volume(v) {
      this.lecture.volume = +v;
      if (audio) audio.volume = v / 100;
      try { localStorage.setItem(VOLUME, String(v)); } catch { /* réglage de session */ }
    },
    // durées des pistes affichées, lues dans les métadonnées (une fois par fichier)
    mesurer() {
      const liste = [...(this.groupe?.new || []), this.groupe?.legacy].filter(f => f && !(f in this.durees));
      for (const f of liste) {
        this.durees[f] = NaN;
        const a = new Audio();
        a.preload = 'metadata';
        a.addEventListener('loadedmetadata', () => { this.durees[f] = a.duration; a.src = ''; }, { once: true });
        a.src = `/assets/music/${encodeURIComponent(f)}`;
      }
    },

    // ---------- import ----------
    async importer(e) {
      const liste = [...(e.target.files || [])];
      e.target.value = '';
      const faits = [], echecs = [];
      for (const [i, f] of liste.entries()) {
        this.envoi = `Import ${i + 1}/${liste.length} : ${f.name}`;
        try {
          if (f.size > 28e6) throw new Error('plus de 28 Mo');
          const r = await api('/api/admin/music/upload', 'POST', { name: f.name, data: await lireB64(f) });
          faits.push(r.file);
        } catch (err) { echecs.push(`${f.name} (${err.message})`); }
      }
      this.envoi = '';
      if (faits.length) {
        this.fichiers = [...new Set([...this.fichiers, ...faits])].sort();
        if (this.groupe && this.vue === 'groupe') { this.groupe.new.push(...faits.filter(f => !this.groupe.new.includes(f))); this.mesurer(); }
      }
      const ok = faits.length ? `✔ ${faits.length} piste${faits.length > 1 ? 's' : ''} importée${faits.length > 1 ? 's' : ''}${this.groupe && this.vue === 'groupe' ? ` et ajoutée${faits.length > 1 ? 's' : ''} à « ${this.courant} »` : ''}.` : '';
      this.dire([ok, echecs.length ? `✘ Refusé : ${echecs.join(', ')}.` : ''].filter(Boolean).join(' '), !!echecs.length);
    },

    // ---------- enregistrement ----------
    async enregistrer() {
      const vides = Object.entries(this.carte.groups).filter(([, g]) => !g.new.length && !g.legacy).map(([id]) => id);
      if (vides.length) { this.dire(`✘ Groupe vide (le serveur l’ignorerait) : ${vides.join(', ')}. Ajoutez une piste ou supprimez-le.`, true); return; }
      try {
        await api('/api/admin/music', 'PUT', this.carte);
        reference = JSON.stringify(this.carte);
        this.dire('✔ Musiques enregistrées, appliquées aux joueurs connectés.');
      } catch (err) { this.dire('✘ ' + err.message, true); }
    },
    annuler() {
      this.carte = JSON.parse(reference);
      if (!this.carte.groups[this.courant]) this.courant = this.groupes[0]?.id || null;
      this.dire('');
    },

    async init() {
      try { this.lecture.volume = +(localStorage.getItem(VOLUME) ?? 70) || 0; } catch { /* défaut */ }
      try {
        const [m, z] = await Promise.all([api('/api/admin/music'), api('/api/admin/content/zones')]);
        this.fichiers = m.files || []; this.sousZones = m.sousZones || [];
        this.zones = z.zones || [];
        const c = copie(m.map || {});
        c.groups ||= {}; c.zones ||= {};
        for (const g of Object.values(c.groups)) g.new = Array.isArray(g.new) ? g.new : [];
        // forme normalisée (comme l'enregistre le serveur) : le premier état n'est pas « modifié »
        const norme = (s) => typeof s?.group === 'string' ? { group: s.group } : { legacy: s?.legacy || null, new: s?.new || null };
        c.login = norme(c.login); c.trial = norme(c.trial);
        for (const zn of this.zones) c.zones[zn.id] = norme(c.zones[zn.id]);
        this.carte = c; reference = JSON.stringify(c);
        if (this.groupes[0]) this.ouvrir(this.groupes[0].id); else this.vue = 'emplacements';
      } catch (err) { this.dire('✘ ' + err.message, true); }
      window.addEventListener('beforeunload', (e) => { if (this.sale) e.preventDefault(); });
    },
  };
}
