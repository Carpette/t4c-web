// Coque de la console : en-tête (espaces Monde / Forge, recherche, état du
// serveur, compte), navigation de l'espace courant et palette de commandes
// (Ctrl K). L'écran affiché vit dans consoleEtat (admin/console.js), partagé
// avec l'en-tête de page.
import { ECRANS, ESPACES, ICONES, consoleEtat, peutVoir, allerA, ecranParId, ecranDepuisAdresse } from '../../console.js';
import { montrerJoueurSurCarte, montrerPointSurCarte } from '../monde-carte/monde-carte.js';

const RAFRAICHISSEMENT = 15000; // joueurs connectés (ms)
const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// découpe un libellé autour de la première occurrence (sans accents ni casse)
function surligner(nom, q) {
  const i = q ? norm(nom).indexOf(q) : -1;
  if (i < 0) return { avant: nom, trouve: '', apres: '' };
  return { avant: nom.slice(0, i), trouve: nom.slice(i, i + q.length), apres: nom.slice(i + q.length) };
}

export function ConsoleController(api) {
  let minuteurAvis = 0;
  return {
    etat: consoleEtat,
    // espaces où le compte a au moins un écran (un animateur ne voit pas la Forge)
    get espaces() { return ESPACES.filter(s => ECRANS.some(e => e.espace === s.id && !e.bientot && peutVoir(e))); },
    icones: ICONES,
    palette: false, requete: '', choix: 0, avis: null,

    get ecranCourant() { return ecranParId(this.etat.ecran); },
    get espace() { return this.ecranCourant?.espace || 'forge'; },
    get nomEspace() { return ESPACES.find(s => s.id === this.espace).nom; },
    get visibles() { return ECRANS.filter(e => e.espace === this.espace && peutVoir(e)); },
    get pied() { return this.visibles.filter(e => e.pied); },
    // écrans de l'espace, regroupés par section dans l'ordre de déclaration
    get groupes() {
      const out = [];
      for (const e of this.visibles.filter(x => !x.pied)) {
        const g = out.at(-1);
        if (g && g.section === e.section) g.ecrans.push(e);
        else out.push({ section: e.section, ecrans: [e] });
      }
      return out;
    },

    async init() {
      try { this.etat.moi = await api('/api/admin/me'); } catch { /* session expirée : admin.js gère */ }
      const { id, sous } = ecranDepuisAdresse();
      // par défaut : la Forge (zones), sinon le premier écran utilisable
      const depart = id && peutVoir(ecranParId(id)) ? id
        : peutVoir(ecranParId('zones')) ? 'zones' : (ECRANS.find(e => peutVoir(e) && !e.bientot)?.id || 'zones');
      allerA(depart, sous);
      // adresse changée à la main ou lien vers un écran (#sorts/spells-table)
      window.addEventListener('hashchange', () => {
        const a = ecranDepuisAdresse();
        if (a.id && peutVoir(ecranParId(a.id))) allerA(a.id, a.sous);
      });
      document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.code === 'KeyK') {
          e.preventDefault();
          this.palette ? this.fermerPalette() : this.ouvrirPalette();
        }
      });
      // joueurs connectés : pour qui voit la carte ou les joueurs (route du serveur)
      if (peutVoir(ecranParId('carte')) || peutVoir(ecranParId('joueurs'))) {
        this.joueurs();
        setInterval(() => this.joueurs(), RAFRAICHISSEMENT);
      }
      // modifications depuis la dernière version (pied de la barre latérale)
      if (this.etat.moi?.isAdmin || this.etat.moi?.publier) {
        this.enAttente();
        setInterval(() => this.enAttente(), RAFRAICHISSEMENT);
      }
    },
    async enAttente() {
      try { this.etat.enAttente = (await api('/api/admin/publication/compte')).n; } catch { /* serveur ancien */ }
    },

    async joueurs() {
      try {
        const r = await api('/api/admin/players');
        this.etat.enLigne = r.players;
        this.etat.serveurOk = true;
      } catch {
        this.etat.serveurOk = false;
      }
    },

    // droit précis (actions sur un joueur : joueurs, sanctions)
    peut(droit, n = 2) { const m = this.etat.moi; return !!m && (m.isAdmin || (m.droits?.[droit] | 0) >= n); },
    // résultat d'une action lancée depuis la palette (qui s'est refermée)
    aviser(texte, erreur = false) {
      this.avis = { texte, erreur };
      clearTimeout(minuteurAvis);
      minuteurAvis = setTimeout(() => { this.avis = null; }, 5000);
    },

    pluriel(n, mot) { return `${n} ${mot}${n > 1 ? 's' : ''}`; },

    aller(id, sous) { allerA(id, sous); },

    changerEspace(id) {
      if (id === this.espace) return;
      const s = ESPACES.find(x => x.id === id);
      const cible = peutVoir(ecranParId(s.defaut)) ? s.defaut : ECRANS.find(e => e.espace === id && peutVoir(e))?.id;
      if (cible) allerA(cible);
    },

    // ---------- palette de commandes ----------
    ouvrirPalette() {
      this.palette = true; this.requete = ''; this.choix = 0;
      setTimeout(() => document.getElementById('cs-cmd')?.focus(), 0);
    },
    fermerPalette() { this.palette = false; },

    // résultats groupés ; « rang » numérote les lignes pour le clavier
    get resultats() {
      let q = this.requete.trim();
      const prefixe = /^[@#>:]/.test(q) ? q[0] : '';
      q = norm(q.slice(prefixe ? 1 : 0).trim());
      const garde = (nom) => !q || norm(nom).includes(q);
      const groupes = [];

      const carte = peutVoir(ecranParId('carte'));
      // « :x, z » ou « :zone x z » : un point de la carte
      if (prefixe === ':') {
        const n = q.match(/-?\d+(?:\.\d+)?/g)?.map(Number) || [];
        if (carte && (n.length === 2 || n.length === 3)) {
          const [zoneId, x, z] = n.length === 3 ? n : [null, ...n];
          groupes.push({ groupe: 'Coordonnées', items: [{
            nom: `Aller en ${x}, ${z}`, icone: 'carte', detail: zoneId == null ? 'Zone affichée sur la carte' : `Zone ${zoneId}`,
            indice: 'Carte du monde', faire: () => { allerA('carte'); montrerPointSurCarte(zoneId, x, z); },
          }] });
        }
        q = '';
      }
      if (!prefixe || prefixe === '@') {
        const trouves = (this.etat.enLigne || []).filter(p => garde(p.name)).slice(0, 6);
        const items = trouves.map(p => ({
          joueur: true, nom: p.name, indice: carte ? 'Entrée : aller à lui' : 'Ouvrir Joueurs',
          faire: carte ? () => { allerA('carte'); montrerJoueurSurCarte(p.id); } : () => allerA('joueurs'),
          detail: `En ligne · niveau ${p.level} · zone ${p.zoneId}, ${Math.round(p.x)}, ${Math.round(p.z)}`,
        }));
        if (items.length) groupes.push({ groupe: 'Joueurs en ligne', items });
        // un seul joueur trouvé : ses actions directes
        const p = q && trouves.length === 1 ? trouves[0] : null;
        if (p) {
          const actions = [
            this.peut('joueurs') && { nom: 'L’amener à moi', icone: 'entrer', indice: 'Près de votre personnage en jeu',
              faire: () => this.agir(p, 'amener', `${p.name} amené près de vous.`) },
            this.peut('joueurs') && carte && { nom: 'Modifier niveau, vie ou or', icone: 'joueurs', indice: 'Carte du monde',
              faire: () => { allerA('carte'); montrerJoueurSurCarte(p.id); } },
            this.peut('sanctions') && { nom: 'Expulser du serveur', icone: 'sortir', indice: '',
              faire: () => confirm(`Expulser ${p.name} ?`) && this.agir(p, 'expulser', `${p.name} expulsé.`) },
          ].filter(Boolean);
          // les libellés d'action ne contiennent pas la recherche : pas de surlignage
          if (actions.length) groupes.push({ groupe: `Actions sur ${p.name}`, items: actions, brut: true });
        }
      }
      if (!prefixe || prefixe === '#') {
        const items = ECRANS.filter(e => peutVoir(e) && garde(e.nom)).map(e => ({
          nom: e.nom, icone: e.icone, detail: e.bientot ? 'Bientôt' : '',
          indice: ESPACES.find(s => s.id === e.espace).nom, faire: () => allerA(e.id),
        }));
        // sous-écrans (Atelier 2D, Matériaux, Atelier 3D) : cherchables directement
        for (const e of ECRANS.filter(x => x.sous && peutVoir(x))) {
          for (const s of e.sous.filter(x => q && garde(x.nom))) {
            items.push({ nom: s.nom, icone: e.icone, detail: e.nom, indice: 'Forge', faire: () => allerA(e.id, s.tab) });
          }
        }
        if (items.length) groupes.push({ groupe: 'Écrans', items });
      }
      if (!prefixe || prefixe === '>') {
        const items = [
          { nom: 'Entrer en jeu', icone: 'entrer', indice: 'Nouvel onglet', faire: () => window.open('/', '_blank', 'noopener') },
          ...ESPACES.filter(s => s.id !== this.espace).map(s => ({
            nom: `Aller dans ${s.nom}`, icone: s.id === 'monde' ? 'carte' : 'zones', indice: '', faire: () => this.changerEspace(s.id),
          })),
          { nom: 'Se déconnecter', icone: 'sortir', indice: '', faire: () => document.getElementById('logout-button')?.click() },
        ].filter(a => garde(a.nom));
        if (items.length) groupes.push({ groupe: 'Actions', items });
      }

      let rang = 0;
      for (const g of groupes) for (const it of g.items) Object.assign(it, surligner(it.nom, g.brut ? '' : q), { rang: rang++ });
      return groupes;
    },

    async agir(p, action, ok) {
      try {
        await api(`/api/admin/monde/joueur/${p.id}`, 'POST', { action });
        this.aviser('✔ ' + ok);
        this.joueurs();
      } catch (e) { this.aviser('✘ ' + e.message, true); }
    },

    executer(r) {
      this.fermerPalette();
      r.faire();
    },

    clavierPalette(e) {
      const tous = this.resultats.flatMap(g => g.items);
      if (e.key === 'Escape') { e.preventDefault(); this.fermerPalette(); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!tous.length) return;
        this.choix = (this.choix + (e.key === 'ArrowDown' ? 1 : -1) + tous.length) % tous.length;
        setTimeout(() => document.querySelector(`.cs-res[data-rang="${this.choix}"]`)?.scrollIntoView({ block: 'nearest' }), 0);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const r = tous.find(x => x.rang === this.choix);
        if (r) this.executer(r);
      }
    },
  };
}
