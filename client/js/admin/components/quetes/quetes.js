// Forge, Zones : onglet « Quêtes », d'après la maquette. On édite le MODÈLE
// d'une quête (prise, objectifs, rendu) ; client/js/admin/quetes.js le
// traduit en dialogues de PNJ. Les retouches passent par l'éditeur de carte
// (seul détenteur des retouches de la zone), qui les enregistre tout seul.
import { MOBS, ITEMS } from '../../../../shared/defs.js';
import { containsKeyword, conditionBloquante, choisirReponse, remplirPhrase, VARIABLES_PHRASE } from '../../../../shared/mots-cles.js';
import { editeurCarte } from '../../editor.js';
import { signalerAttente } from '../../console.js';
import { copie, norm } from '../../forge.js';
import {
  TYPES, OBJECTIFS, MOMENTS, relanceVide, aDialogue, compiler, problemes, nouvelleQuete, etapeVide, idDepuisTitre, drapeau,
} from '../../quetes.js';

const RETARD_APPLICATION = 400; // ms sans frappe avant de traduire en dialogues
let sequence = 0;

export function QuetesController(api) {
  let ed = null, minuteur = null;
  const simVide = () => ({ flags: {}, chasses: {}, objets: {}, visites: 0, journal: [] });
  let saisie = null; // dernière phrase de relance touchée : { r, k } (insertion de variable)

  return {
    zones: [], zone: null, liste: [], courante: null, q: null, filtre: '',
    npcs: [], sorts: [], joueurs: [], sim: simVide(), phrase: '', json: false, pret: false,

    mobs: Object.entries(MOBS).map(([id, m]) => ({ id, name: m.name || id })).sort((a, b) => a.name.localeCompare(b.name, 'fr')),
    objets: Object.entries(ITEMS).filter(([, d]) => d.slot !== 'gold' && !d.legacy)
      .map(([id, d]) => ({ id, name: d.name || id })).sort((a, b) => a.name.localeCompare(b.name, 'fr')),
    TYPES, OBJECTIFS, MOMENTS, VARIABLES: VARIABLES_PHRASE,

    async init() {
      try { this.sorts = ((await api('/api/admin/content/spells')).spells || []).map(s => ({ id: s.id, name: s.name || s.id })); } catch { /* sorts indisponibles */ }
      // menu « … » : se referme au clic ailleurs ou après un choix
      document.addEventListener('click', (e) => {
        for (const d of document.querySelectorAll('#tab-quetes details.cs-menu[open]')) {
          if (!d.contains(e.target) || e.target.closest('button')) d.open = false;
        }
      });
      ed = await editeurCarte;
      this.zones = ed.zones();
      this.recharger();
      this.pret = true;
      // l'onglet redevient visible : la carte a pu changer de zone ou de PNJ
      const tab = document.getElementById('tab-quetes');
      if (tab) new MutationObserver(() => { if (tab.classList.contains('visible')) this.recharger(); })
        .observe(tab, { attributes: true, attributeFilter: ['class'] });
    },

    // ---------- zone et liste ----------
    recharger() {
      if (!ed) return;
      this.zone = ed.zoneCourante();
      this.npcs = ed.getNpcs().map(n => ({ npcId: n.npcId, name: n.def.name || n.npcId, x: Math.round(n.x), z: Math.round(n.z) }));
      this.liste = ed.quetesZone();
      if (this.q && !this.liste.some(x => x.id === this.q.id)) this.q = null;
      if (!this.q && this.liste.length) this.ouvrir(this.liste[0].id);
      this.chargerJoueurs();
    },
    async changerZone(id) {
      this.appliquerMaintenant();
      this.q = null;
      await ed.loadZone(+id);
      this.recharger();
    },
    async chargerJoueurs() {
      try { this.joueurs = (await api('/api/admin/characters')).characters || []; } catch { this.joueurs = []; }
    },
    get zoneDef() { return this.zones.find(z => z.id === this.zone); },
    get visibles() {
      const f = norm(this.filtre.trim());
      if (!f) return this.liste;
      return this.liste.filter(q => norm(q.titre).includes(f) || q.etapes.some(e =>
        norm(this.nomPnj(e.npcId)).includes(f) || norm(MOBS[e.mob]?.name || '').includes(f)));
    },
    resume(q) {
      const pnj = [...new Set(q.etapes.filter(aDialogue).map(e => this.nomPnj(e.npcId)))].join(', ');
      return [pnj, `niv. ${q.niveau || 1}`, q.repetable ? 'répétable' : `${q.etapes.length} étapes`].filter(Boolean).join(' · ');
    },
    pips(q) {
      const pb = this.problemesDe(q);
      return q.etapes.map((e, i) => pb.some(p => p.startsWith(`Étape ${i + 1} `)) ? 'err' : (this.q?.id === q.id ? 'or' : ''));
    },

    // ---------- quête courante ----------
    ouvrir(id) {
      this.appliquerMaintenant();
      const q = this.liste.find(x => x.id === id);
      this.q = q ? copie(q) : null;
      this.courante = id;
      this.json = false;
      this.sim = simVide();
    },
    nouvelle() {
      const base = 'nouvelle_quete';
      let id = base, k = 2;
      while (this.liste.some(q => q.id === id)) id = `${base}_${k++}`;
      const q = nouvelleQuete(id, 'Nouvelle quête', this.npcs[0]?.npcId || '');
      this.liste.push(q);
      this.ouvrir(id);
      this.modifie();
    },
    dupliquer() {
      if (!this.q) return;
      let id = idDepuisTitre(this.q.id + '_copie'), k = 2;
      while (this.liste.some(q => q.id === id)) id = `${this.q.id}_copie_${k++}`;
      const q = { ...copie(this.q), id, titre: this.q.titre + ' (copie)' };
      delete q.ancienne;
      this.liste.push(q);
      this.ouvrir(id);
      this.modifie();
    },
    supprimer() {
      if (!this.q || !confirm(`Supprimer la quête « ${this.q.titre} » et ses dialogues ?`)) return;
      clearTimeout(minuteur); minuteur = null;
      ed.supprimerQuete(this.q.id);
      this.q = null;
      this.recharger();
    },
    // toute retouche : traduite en dialogues après une courte pause de frappe
    modifie() {
      if (!this.q) return;
      const i = this.liste.findIndex(x => x.id === this.q.id);
      if (i >= 0) this.liste[i] = copie(this.q);
      clearTimeout(minuteur);
      signalerAttente('quetes', true);
      minuteur = setTimeout(() => this.appliquerMaintenant(), RETARD_APPLICATION);
    },
    appliquerMaintenant() {
      if (!minuteur || !this.q) return;
      clearTimeout(minuteur); minuteur = null;
      ed.appliquerQuete(this.q);
      signalerAttente('quetes', false);
      signalerAttente('carte', true); // la carte l'enverra à son prochain passage
      delete this.q.ancienne;
    },

    // ---------- étapes ----------
    numero(i) { return i + 1; },
    // clé stable d'une étape : insérer ou retirer ne recycle pas le rendu d'une
    // autre (champ « _k », ignoré à l'enregistrement)
    cle(e) { return e._k ||= ++sequence; },
    estObjectif(e) { return OBJECTIFS.includes(e.type); },
    changerType(i, type) {
      const e = this.q.etapes[i];
      if (e.type === type) return;
      this.q.etapes[i] = etapeVide(type, e.npcId || this.q.etapes[0]?.npcId);
      this.modifie();
    },
    inserer(i) {
      this.q.etapes.splice(i, 0, etapeVide('tuer'));
      this.modifie();
    },
    retirer(i) { this.q.etapes.splice(i, 1); this.modifie(); },
    ajouterMot(e, ev) {
      const v = ev.target.value.split(',').map(s => s.trim()).filter(Boolean);
      ev.target.value = '';
      for (const m of v) if (!e.keywords.includes(m)) e.keywords.push(m);
      if (v.length) this.modifie();
    },
    retirerMot(e, k) { e.keywords.splice(k, 1); this.modifie(); },
    couleurType(e) {
      return { prise: '#e2c27f', rendu: '#8fd1a8' }[e.type] || '#a9cdf0';
    },
    presentDansZone(mob) { return !!this.zoneDef?.mobs?.includes(mob); },

    // ---------- relances (répliques hors étapes) ----------
    get relances() { return this.q?.relances || []; },
    ajouterRelance() {
      (this.q.relances ||= []).push(relanceVide(this.q.etapes[0]?.npcId || this.npcs[0]?.npcId || ''));
      this.modifie();
    },
    retirerRelance(i) { this.q.relances.splice(i, 1); this.modifie(); },
    ajouterPhrase(r) { r.phrases.push(''); this.modifie(); },
    retirerPhrase(r, k) { r.phrases.splice(k, 1); if (!r.phrases.length) r.phrases.push(''); this.modifie(); },
    retenir(r, k) { saisie = { r, k }; },
    // variable cliquée : insérée dans la dernière phrase touchée (sinon la première)
    insererVariable(r, v) {
      const k = saisie?.r === r ? saisie.k : 0;
      const el = document.getElementById(`q-ph-${this.relances.indexOf(r)}-${k}`);
      const t = r.phrases[k] || '', pos = el?.selectionStart ?? t.length;
      r.phrases[k] = t.slice(0, pos) + `{${v}}` + t.slice(el?.selectionEnd ?? pos);
      this.modifie();
      requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(pos + v.length + 2, pos + v.length + 2); });
    },

    // ---------- récompenses ----------
    ajouterRecompense(e, sorte) {
      const rc = e.recompenses;
      if (sorte === 'gold') rc.gold = rc.gold || 100;
      if (sorte === 'xp') rc.xp = rc.xp || 100;
      if (sorte === 'item') rc.items.push({ defId: this.objets[0]?.id || '', n: 1 });
      if (sorte === 'sort') rc.sorts.push(this.sorts[0]?.id || '');
      if (sorte === 'tp') rc.tp = { zoneId: this.zone, x: 0, z: 0 };
      this.modifie();
    },
    retirerRecompense(e, sorte, k) {
      const rc = e.recompenses;
      if (sorte === 'gold') rc.gold = 0;
      if (sorte === 'xp') rc.xp = 0;
      if (sorte === 'item') rc.items.splice(k, 1);
      if (sorte === 'sort') rc.sorts.splice(k, 1);
      if (sorte === 'tp') rc.tp = null;
      this.modifie();
    },

    // ---------- validité ----------
    problemesDe(q) {
      return problemes(q, {
        npcs: new Set(this.npcs.map(n => n.npcId)), mobs: MOBS, items: ITEMS,
        sorts: Object.fromEntries(this.sorts.map(s => [s.id, s])),
      });
    },
    get pb() { return this.q ? this.problemesDe(this.q) : []; },
    get compile() { return this.q ? compiler(this.q, this.zone) : []; },
    get drapeaux() { return this.compile.map(c => c.flag); },
    nomPnj(id) { return this.npcs.find(n => n.npcId === id)?.name || id || '?'; },

    // ---------- contexte ----------
    get pnjDeLaQuete() {
      const ids = [...new Set(this.q?.etapes.filter(aDialogue).map(e => e.npcId) || [])];
      return ids.map(id => this.npcs.find(n => n.npcId === id) || { npcId: id, name: id, absent: true });
    },
    get creaturesDeLaQuete() {
      return [...new Set(this.q?.etapes.filter(e => e.type === 'tuer' && e.mob).map(e => e.mob) || [])]
        .map(id => ({ id, name: MOBS[id]?.name || id, present: this.presentDansZone(id) }));
    },
    // personnages ayant commencé la quête (drapeaux enregistrés)
    get enCours() {
      if (!this.q) return [];
      const flags = this.drapeaux;
      return this.joueurs.filter(j => j.char && flags.some(f => j.char.flags?.[f])).map(j => {
        const k = flags.filter(f => j.char.flags[f]).length;
        const ch = Object.entries(j.char.chasses || {}).find(([key]) => key.startsWith(`quete:${this.q.id}:`))?.[1];
        return { nom: j.char.name, etat: k === flags.length ? 'terminée' : `étape ${k}${ch ? ` · ${ch.tues} / ${ch.n}` : ''}` };
      });
    },

    // ---------- simulateur « Jouer la quête » ----------
    cleEtape(i) {
      const k = this.q.etapes.slice(0, i + 1).filter(aDialogue).length;
      return aDialogue(this.q.etapes[i]) ? drapeau(this.q.id, k) : `quete:${this.q.id}:o${i}`;
    },
    statut(i) {
      const e = this.q.etapes[i], s = this.sim, key = this.cleEtape(i);
      // un dialogue plus loin déjà passé : tout ce qui le précède est fait
      if (this.q.etapes.some((x, j) => j > i && aDialogue(x) && s.flags[this.cleEtape(j)])) return 'fait';
      if (aDialogue(e) || e.type === 'lieu') return s.flags[key] ? 'fait' : null;
      if (e.type === 'tuer') { const c = s.chasses[key]; return c && c.tues >= c.n ? 'fait' : null; }
      if (e.type === 'rapporter') return (s.objets[e.item] || 0) >= e.n ? 'fait' : null;
      return null;
    },
    get etapeCourante() { return this.q ? this.q.etapes.findIndex((e, i) => !this.statut(i)) : -1; },
    libelleEtape(e) {
      if (e.type === 'tuer') return `Tuer ${e.n} ${MOBS[e.mob]?.name || '?'}`;
      if (e.type === 'rapporter') return `Rapporter ${e.n} ${ITEMS[e.item]?.name || '?'}`;
      if (e.type === 'lieu') return `Se rendre à ${e.nom || `${e.x}, ${e.z}`}`;
      if (e.type === 'parler') return `Parler à ${this.nomPnj(e.npcId)}`;
      return TYPES[e.type].nom;
    },
    progression(i) {
      const e = this.q.etapes[i];
      if (e.type === 'tuer') { const c = this.sim.chasses[this.cleEtape(i)]; return c ? `${c.tues} / ${c.n}` : ''; }
      if (e.type === 'rapporter') return `${this.sim.objets[e.item] || 0} / ${e.n}`;
      return this.statut(i) ? 'fait' : '';
    },
    recommencer() { this.sim = simVide(); },
    // fait avancer l'étape courante comme le ferait le joueur
    validerEtape() {
      const i = this.etapeCourante;
      if (i < 0) return;
      const e = this.q.etapes[i], key = this.cleEtape(i);
      if (aDialogue(e)) { this.dire(e.keywords[0] || 'quete'); return; }
      if (e.type === 'tuer') {
        const c = this.sim.chasses[key];
        if (!c) { this.sim.journal.push({ qui: 'note', texte: 'La chasse n’est pas lancée : parlez d’abord au PNJ.' }); return; }
        c.tues = c.n;
        this.sim.journal.push({ qui: 'note', texte: `${MOBS[e.mob]?.name || e.mob} : ${c.n} / ${c.n}` });
      }
      if (e.type === 'rapporter') { this.sim.objets[e.item] = Math.max(this.sim.objets[e.item] || 0, e.n); this.sim.journal.push({ qui: 'note', texte: `Ramassé : ${ITEMS[e.item]?.name || e.item} ×${e.n}` }); }
      if (e.type === 'lieu') { this.sim.flags[key] = true; this.sim.journal.push({ qui: 'note', texte: `Arrivé : ${e.nom || `${e.x}, ${e.z}`}` }); }
    },
    tuerUn(i) {
      const c = this.sim.chasses[this.cleEtape(i)];
      if (c && c.tues < c.n) c.tues++;
    },
    parler() { const t = this.phrase.trim(); this.phrase = ''; if (t) this.dire(t); },
    // même règle que le serveur : le premier dialogue (le plus avancé d'abord)
    // dont le mot-clé et les conditions passent répond
    dire(texte) {
      const s = this.sim;
      s.journal.push({ qui: 'moi', texte });
      const etat = {
        flags: s.flags, level: 99, gold: 0, maudit: () => false,
        aObjet: (id, n = 1) => (s.objets[id] || 0) >= n,
        chasse: (key) => s.chasses[key] || null,
      };
      let bloque = null;
      // ordre du serveur : étapes (la plus avancée d'abord), puis relances
      const etapes = this.compile.filter(c => !c.dlg.relance).reverse(), relances = this.compile.filter(c => c.dlg.relance);
      for (const { npcId, dlg } of [...etapes, ...relances]) {
        if (!dlg.keywords.some(k => containsKeyword(texte, k))) continue;
        const raison = conditionBloquante(dlg.conditions, etat);
        if (raison) { bloque ||= `${this.nomPnj(npcId)} ne répond pas encore : ${raison}.`; continue; }
        if (dlg.relance) s.visites++;
        s.journal.push({ qui: 'pnj', nom: this.nomPnj(npcId), texte: remplirPhrase(choisirReponse(dlg), this.variablesSim(npcId, dlg)) });
        this.appliquerSim(dlg);
        return;
      }
      s.journal.push({ qui: 'note', texte: bloque || 'Aucun mot-clé reconnu.' });
    },
    // mêmes variables que le serveur (dialogues.js, variablesPhrase), sur l'état simulé
    variablesSim(npcId, dlg) {
      const s = this.sim;
      const chasses = Object.values(s.chasses);
      const ch = chasses.find(c => c.tues < c.n) || chasses[chasses.length - 1];
      const objets = (dlg.suivi?.items || []).map(o => ({ ...o, possede: s.objets[o.item] || 0 }));
      const ob = objets.find(o => o.possede < o.n) || objets[objets.length - 1];
      const lieu = this.q.etapes.find((e, i) => e.type === 'lieu' && !this.statut(i));
      return {
        joueur: 'Testeur', pnj: this.nomPnj(npcId), niveau: this.q.niveau || 1, or: 0,
        tues: ch?.tues ?? 0, total: ch?.n ?? 0, reste: ch ? Math.max(0, ch.n - ch.tues) : 0, monstre: ch ? (MOBS[ch.mob]?.name || ch.mob) : '',
        objet: ob ? (ITEMS[ob.item]?.name || ob.item) : '', possede: ob?.possede ?? 0, requis: ob?.n ?? 0, manque: ob ? Math.max(0, ob.n - ob.possede) : 0,
        lieu: lieu?.nom || '', visites: s.visites, moment: 'matin',
      };
    },
    appliquerSim(dlg) {
      const s = this.sim, c = dlg.conditions || {}, notes = [];
      for (const o of c.items || []) if (o.consume) s.objets[o.item] = Math.max(0, (s.objets[o.item] || 0) - o.n);
      for (const key of c.chasses || []) delete s.chasses[key];
      for (const r of dlg.reactions) {
        if (r.type === 'flag') s.flags[r.key] = true;
        if (r.type === 'unflag') { delete s.flags[r.key]; delete s.chasses[r.key]; }
        if (r.type === 'chasse' && !s.chasses[r.key]) { s.chasses[r.key] = { tues: 0, n: r.n, mob: r.mob }; notes.push(`Objectif : tuer ${r.n} ${MOBS[r.mob]?.name || r.mob}`); }
        if (r.type === 'lieu') notes.push(`Objectif : se rendre à ${r.nom || `${r.x}, ${r.z}`}`);
        if (r.type === 'gold') notes.push(`+${r.amount} PO`);
        if (r.type === 'xp') notes.push(`+${r.amount} XP`);
        if (r.type === 'item') notes.push(`Reçu : ${ITEMS[r.defId]?.name || r.defId} ×${r.n || 1}`);
        if (r.type === 'sort') notes.push(`Sort appris : ${this.sorts.find(x => x.id === r.spellId)?.name || r.spellId}`);
        if (r.type === 'teleport') notes.push(`Téléporté (zone ${r.zoneId}, ${r.x}, ${r.z})`);
      }
      if (dlg.reactions.some(r => r.type === 'unflag')) notes.push('La quête repart de zéro (répétable).');
      if (notes.length) s.journal.push({ qui: 'note', texte: notes.join(' · ') });
    },
  };
}
