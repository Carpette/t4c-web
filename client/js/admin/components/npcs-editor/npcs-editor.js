// Forge, PNJ : fiche des personnages non joueurs (content/npcs.json), d'après
// la maquette : onglets, dialogues à mots-clés aux conditions et réactions
// structurées, position dans le monde et simulateur de dialogue. Le
// simulateur applique les règles du serveur (shared/mots-cles.js).
import { ITEMS } from '../../../../shared/defs.js';
import { STATS } from '../../../../shared/constants.js';
import { containsKeyword, conditionBloquante, rootKeywordsHint } from '../../../../shared/mots-cles.js';
import { dessinerPersonnage, chargerRessources, copie, norm } from '../../forge.js';
import { allerA, ecranParId, peutVoir } from '../../console.js';
import { montrerPointSurCarte } from '../monde-carte/monde-carte.js';

const ROLES = [['merchant', 'Marchand'], ['teacher', 'Entraîneur'], ['bavard', 'Bavard']];
const NOMS_STATS = { str: 'Force', end: 'Endurance', agi: 'Agilité', int: 'Intelligence', wis: 'Sagesse' };
const COUCHES = [['chest', 'Torse'], ['head', 'Tête'], ['legs', 'Jambes'], ['hands', 'Mains'], ['feet', 'Pieds'], ['main', 'Main droite'], ['off', 'Main gauche']];

// conditions d'un dialogue (objet `conditions`, cf. server/game/dialogues.js)
const CONDITIONS = [
  { k: 'flag', nom: 'Drapeau posé', champ: 'texte', defaut: 'drapeau' },
  { k: 'notFlag', nom: 'Drapeau absent', champ: 'texte', defaut: 'drapeau' },
  { k: 'level', nom: 'Niveau minimal', champ: 'nombre', defaut: 5 },
  { k: 'item', nom: 'Possède l’objet', champ: 'objet', defaut: 'potion_vie', option: ['consume', 'le reprendre'] },
  { k: 'gold', nom: 'Or minimum', champ: 'nombre', defaut: 100, option: ['consumeGold', 'le prélever'] },
  { k: 'cursed', nom: 'Est maudit', champ: null, defaut: true },
  { k: 'notCursed', nom: 'N’est pas maudit', champ: null, defaut: true },
];
// réactions (liste `reactions`) : champs [clé, libellé, type]
const REACTIONS = [
  { type: 'flag', nom: 'Poser le drapeau', champs: [['key', '', 'texte']], defaut: { key: 'drapeau' } },
  { type: 'unflag', nom: 'Retirer le drapeau', champs: [['key', '', 'texte']], defaut: { key: 'drapeau' } },
  { type: 'gold', nom: 'Donner de l’or', champs: [['amount', 'PO', 'nombre']], defaut: { amount: 10 } },
  { type: 'xp', nom: 'Donner de l’expérience', champs: [['amount', 'XP', 'nombre']], defaut: { amount: 50 } },
  { type: 'item', nom: 'Donner un objet', champs: [['defId', '', 'objet'], ['n', '×', 'nombre']], defaut: { defId: 'potion_vie', n: 1 } },
  { type: 'teleport', nom: 'Téléporter', champs: [['zoneId', 'zone', 'nombre'], ['x', 'x', 'nombre'], ['z', 'z', 'nombre']], defaut: { zoneId: 0, x: 64, z: 64 } },
  { type: 'heal', nom: 'Soigner entièrement', champs: [], defaut: {} },
  { type: 'cleanse', nom: 'Lever la malédiction', champs: [], defaut: {} },
  { type: 'buff', nom: 'Bénir', champs: [['power', 'puissance', 'nombre'], ['duration', 's', 'nombre']], defaut: { effect: 'defense_boost', power: 3, duration: 600 } },
];
const RECOMPENSES = new Set(['gold', 'item', 'xp']);

export function NpcsEditorController(api) {
  let fichier = { npc: {} };   // content/npcs.json tel que sur disque
  let reference = '';

  return {
    ROLES, NOMS_STATS, COUCHES, CONDITIONS, REACTIONS, STATS,
    npcs: {}, q: '', courant: null, fiche: null, nouveau: false, nouvelId: '',
    onglet: 'dialogues', dlgOuvert: 0, voirJson: false, motCle: '',
    spells: [], skills: [], positions: [], couchesDispo: [],
    objets: Object.entries(ITEMS).filter(([, d]) => d.slot !== 'gold').map(([id, d]) => ({ id, name: d.name })).sort((a, b) => a.name.localeCompare(b.name)),
    message: '', erreur: false,
    sim: { flags: {}, level: 1, gold: 0, objets: {}, maudit: false, recus: {} }, journal: [], phrase: '',

    // ---------- liste ----------
    get liste() {
      const q = norm(this.q.trim());
      return Object.entries(this.npcs).filter(([id, n]) => !q || norm(n.name).includes(q) || id.includes(q))
        .map(([id, n]) => ({ id, name: n.name, role: this.nomRole(n) }));
    },
    nomRole(n) { return ROLES.find(r => r[0] === (n.role || (n.teacher ? 'teacher' : 'merchant')))?.[1] || n.role; },
    get sale() { return !!this.fiche && JSON.stringify(this.fiche) !== reference; },
    get sousTitre() {
      const f = this.fiche;
      return f ? `${this.nomRole(f)} · niveau ${f.level || 1} · ${f.hp || 100} PV` : '';
    },
    get indice() { return this.fiche ? rootKeywordsHint(this.fiche) : null; },
    get nbEnseignement() { return Object.keys(this.fiche?.teachesSpells || {}).length + Object.keys(this.fiche?.teachesSkills || {}).length; },
    get voitCarte() { return peutVoir(ecranParId('carte')); },
    voirSurCarte(p) { allerA('carte'); montrerPointSurCarte(p.zoneId, p.x, p.z); },
    get ouCa() { return this.positions.filter(p => p.npcId === (this.nouveau ? null : this.courant)); },

    dire(t, err = false) { this.message = t; this.erreur = err; },

    ouvrir(id) {
      if (this.sale && id !== this.courant && !confirm('Abandonner les modifications de ce PNJ ?')) return;
      const n = this.npcs[id];
      if (!n) return;
      this.courant = id; this.nouveau = false;
      this.fiche = copie(n);
      const f = this.fiche;
      f.stats ||= { str: 10, end: 10, agi: 10, int: 10, wis: 10 };
      f.greetings ||= []; f.dialogues ||= []; f.teachesSpells ||= {}; f.teachesSkills ||= {};
      f.look ||= {};
      reference = JSON.stringify(f);
      this.dlgOuvert = 0; this.voirJson = false;
      this.reinitSim();
      this.dire('');
      this.portrait();
    },

    nouveauPnj(base = null) {
      if (this.sale && !confirm('Abandonner les modifications de ce PNJ ?')) return;
      const f = base ? { ...copie(base), name: `${base.name} (copie)` } : {
        name: 'Nouveau PNJ', role: 'bavard', stats: { str: 10, end: 10, agi: 10, int: 10, wis: 10 }, equip: {},
        level: 1, hp: 100, greetings: ['Bien le bonjour.'], dialogues: [], teachesSpells: {}, teachesSkills: {}, look: {},
      };
      let n = 1, racine = base ? this.courant : 'pnj';
      while (this.npcs[`${racine}_${n}`]) n++;
      this.nouvelId = `${racine}_${n}`;
      this.fiche = f; this.nouveau = true; this.onglet = 'general';
      reference = '';
      this.reinitSim();
      this.dire('Nouveau PNJ : choisissez son identifiant, puis enregistrez. Placez-le ensuite dans Zones et terrain.');
      this.portrait();
    },

    portrait() {
      setTimeout(() => {
        const look = this.fiche?.look;
        for (const [sel, buste] of [['#pnj-portrait', true], ['#pnj-apparence', false]]) {
          const cv = document.querySelector(sel);
          if (cv) dessinerPersonnage(cv, look, buste);
        }
      }, 0);
    },
    couche(k, v) { if (v) this.fiche.look[k] = v; else delete this.fiche.look[k]; this.portrait(); },

    // ---------- enseignement ----------
    nomSort(id) { return this.spells.find(s => s.id === id)?.name || id; },
    nomComp(id) { return this.skills.find(s => s.id === id)?.name || id; },
    get sortsDispo() { return this.spells.filter(s => this.fiche?.teachesSpells?.[s.id] === undefined); },
    get compsDispo() { return this.skills.filter(s => this.fiche?.teachesSkills?.[s.id] === undefined); },
    ajouterSort(id) { if (id) this.fiche.teachesSpells = { ...this.fiche.teachesSpells, [id]: 100 }; },
    retirerSort(id) { const t = { ...this.fiche.teachesSpells }; delete t[id]; this.fiche.teachesSpells = t; },
    ajouterComp(id) { if (id) this.fiche.teachesSkills = { ...this.fiche.teachesSkills, [id]: { learnCost: 100, trainCost: 10 } }; },
    retirerComp(id) { const t = { ...this.fiche.teachesSkills }; delete t[id]; this.fiche.teachesSkills = t; },
    // étal : liste explicite d'objets (sinon objets du palier de la zone)
    ajouterVente(id) { if (id) this.fiche.sells = [...new Set([...(this.fiche.sells || []), id])]; },
    retirerVente(id) { this.fiche.sells = this.fiche.sells.filter(x => x !== id); if (!this.fiche.sells.length) delete this.fiche.sells; },
    nomObjet(id) { return ITEMS[id]?.name || id; },

    // ---------- dialogues ----------
    ajouterDialogue() {
      this.fiche.dialogues.push({ keywords: [], reponse: '' });
      this.dlgOuvert = this.fiche.dialogues.length - 1;
    },
    supprimerDialogue(i) {
      if (!confirm('Supprimer ce dialogue ?')) return;
      this.fiche.dialogues.splice(i, 1);
      this.dlgOuvert = Math.max(0, Math.min(this.dlgOuvert, this.fiche.dialogues.length - 1));
    },
    deplacer(i, d) {
      const l = this.fiche.dialogues, j = i + d;
      if (j < 0 || j >= l.length) return;
      [l[i], l[j]] = [l[j], l[i]];
      this.dlgOuvert = j;
    },
    ajouterMotCle(dlg) {
      const nouveaux = this.motCle.split(',').map(s => s.trim()).filter(Boolean);
      dlg.keywords = [...new Set([...(dlg.keywords || []), ...nouveaux])];
      this.motCle = '';
    },
    conditionsDe(dlg) { return CONDITIONS.filter(c => dlg.conditions && dlg.conditions[c.k] != null && dlg.conditions[c.k] !== false); },
    conditionsLibres(dlg) { return CONDITIONS.filter(c => !(dlg.conditions && dlg.conditions[c.k] != null && dlg.conditions[c.k] !== false)); },
    ajouterCondition(dlg, k) {
      const c = CONDITIONS.find(x => x.k === k);
      if (c) dlg.conditions = { ...(dlg.conditions || {}), [k]: c.defaut };
    },
    retirerCondition(dlg, c) {
      const o = { ...dlg.conditions };
      delete o[c.k];
      if (c.option) delete o[c.option[0]];
      if (Object.keys(o).length) dlg.conditions = o; else delete dlg.conditions;
    },
    fixerCondition(dlg, c, v) { dlg.conditions = { ...dlg.conditions, [c.k]: c.champ === 'nombre' ? Math.max(0, +v | 0) : v.trim() }; },
    optionCondition(dlg, c, on) {
      const o = { ...dlg.conditions };
      if (on) o[c.option[0]] = true; else delete o[c.option[0]];
      dlg.conditions = o;
    },
    reaction(type) { return REACTIONS.find(r => r.type === type) || { nom: type, champs: [] }; },
    ajouterReaction(dlg, type) {
      const r = REACTIONS.find(x => x.type === type);
      if (r) dlg.reactions = [...(dlg.reactions || []), { type, ...copie(r.defaut) }];
    },
    retirerReaction(dlg, i) { dlg.reactions.splice(i, 1); if (!dlg.reactions.length) delete dlg.reactions; },
    fixerChamp(r, champ, v) { r[champ[0]] = champ[2] === 'nombre' ? (v === '' ? undefined : +v) : v.trim(); },
    resume(dlg) { const t = dlg.reponse || ''; return t.length > 90 ? t.slice(0, 90) + '…' : t; },
    // un dialogue sans flag ni drapeau absent est-il masqué par un précédent aux mêmes mots-clés ?
    masque(i) {
      const d = this.fiche.dialogues[i];
      return this.fiche.dialogues.slice(0, i).some(p => !p.conditions && (p.keywords || []).some(k => (d.keywords || []).includes(k)));
    },

    // ---------- ambiance ----------
    ajouterPhrase() { this.fiche.greetings.push(''); },
    retirerPhrase(i) { this.fiche.greetings.splice(i, 1); },

    // ---------- simulateur ----------
    get drapeauxSim() {
      const s = new Set();
      for (const d of this.fiche?.dialogues || []) {
        if (d.conditions?.flag) s.add(d.conditions.flag);
        if (d.conditions?.notFlag) s.add(d.conditions.notFlag);
        for (const r of d.reactions || []) if (r.type === 'flag' && r.key) s.add(r.key);
      }
      return [...s];
    },
    get objetsSim() { return [...new Set((this.fiche?.dialogues || []).map(d => d.conditions?.item).filter(Boolean))]; },
    get maleficeSim() { return (this.fiche?.dialogues || []).some(d => d.conditions?.cursed || d.conditions?.notCursed); },
    reinitSim() { this.sim = { flags: {}, level: 1, gold: 0, objets: {}, maudit: false, recus: {} }; this.journal = []; },
    parler() {
      const texte = this.phrase.trim();
      if (!texte || !this.fiche) return;
      this.phrase = '';
      this.journal.push({ qui: 'joueur', texte });
      const s = this.sim;
      const etat = { flags: s.flags, level: s.level, gold: s.gold, aObjet: (id) => !!s.objets[id], maudit: () => s.maudit };
      const dialogues = this.fiche.dialogues || [];
      let bloque = null;
      for (let i = 0; i < dialogues.length; i++) {
        const d = dialogues[i];
        if (!(d.keywords || []).some(k => containsKeyword(texte, k))) continue;
        const raison = conditionBloquante(d.conditions, etat);
        if (raison) { bloque ||= `dialogue ${i + 1} : ${raison}`; continue; }
        this.journal.push({ qui: 'pnj', texte: d.reponse || '...' });
        this.journal.push({ qui: 'note', texte: this.appliquerSim(d, i) || 'Aucun effet.' });
        return;
      }
      this.journal.push({ qui: 'note', texte: bloque ? `Aucune réponse : ${bloque}.` : 'Aucun mot-clé reconnu : le PNJ ne répond pas.' });
    },
    // effets d'un dialogue sur l'état simulé, résumés comme en jeu
    appliquerSim(d, i) {
      const s = this.sim, effets = [];
      if (d.conditions?.gold && d.conditions.consumeGold) { s.gold -= d.conditions.gold; effets.push(`−${d.conditions.gold} PO`); }
      if (d.conditions?.item && d.conditions.consume) { s.objets = { ...s.objets, [d.conditions.item]: false }; effets.push(`${this.nomObjet(d.conditions.item)} repris`); }
      const dejaRecu = !d.repeatable && s.recus[i];
      for (const r of d.reactions || []) {
        if (RECOMPENSES.has(r.type) && dejaRecu) continue;
        if (r.type === 'gold') { s.gold += r.amount | 0; effets.push(`+${r.amount} PO`); }
        if (r.type === 'xp') effets.push(`+${r.amount} XP`);
        if (r.type === 'item') effets.push(`${this.nomObjet(r.defId)}${r.n > 1 ? ' ×' + r.n : ''}`);
        if (r.type === 'flag') { s.flags = { ...s.flags, [r.key]: true }; effets.push(`drapeau ${r.key} posé`); }
        if (r.type === 'unflag') { const f = { ...s.flags }; delete f[r.key]; s.flags = f; effets.push(`drapeau ${r.key} retiré`); }
        if (r.type === 'teleport') effets.push(`téléporté (zone ${r.zoneId ?? 'actuelle'}, ${r.x}, ${r.z})`);
        if (r.type === 'heal') effets.push('soigné');
        if (r.type === 'cleanse') { s.maudit = false; effets.push('malédiction levée'); }
        if (r.type === 'buff') effets.push(`béni ${r.duration || 600} s`);
      }
      if ((d.reactions || []).some(r => RECOMPENSES.has(r.type))) {
        if (dejaRecu) effets.push('récompenses déjà reçues');
        else s.recus = { ...s.recus, [i]: true };
      }
      return effets.join(' · ');
    },

    // ---------- enregistrement ----------
    async enregistrer() {
      const id = this.nouveau ? this.nouvelId.trim().toLowerCase() : this.courant;
      if (!/^[a-z0-9_]{1,40}$/.test(id)) { this.dire('Identifiant : minuscules, chiffres et _ uniquement.', true); return; }
      if (this.nouveau && this.npcs[id]) { this.dire(`L’identifiant « ${id} » existe déjà.`, true); return; }
      if (!this.fiche.name?.trim()) { this.dire('Le nom est obligatoire.', true); return; }
      const fiche = copie(this.fiche);
      fiche.greetings = fiche.greetings.map(s => s.trim()).filter(Boolean);
      if (!Object.keys(fiche.look || {}).length) delete fiche.look;
      const npc = { ...this.npcs, [id]: fiche };
      try {
        await api('/api/admin/content/npcs', 'PUT', { ...fichier, npc });
        fichier = { ...fichier, npc }; this.npcs = npc;
        this.nouveau = false; reference = '';
        this.ouvrir(id);
        this.dire('Enregistré. Les PNJ en jeu adoptent la fiche immédiatement.');
        this.chargerPositions();
      } catch (e) { this.dire(e.message, true); }
    },

    async supprimer() {
      if (this.nouveau) { this.nouveau = false; reference = ''; this.fiche = null; this.ouvrir(this.courant || Object.keys(this.npcs)[0]); return; }
      if (this.courant === 'merchant') { this.dire('« merchant » sert de modèle aux PNJ ajoutés sur la carte : il ne peut pas être supprimé.', true); return; }
      if (!confirm(`Supprimer le PNJ ${this.fiche.name} (${this.courant}) ?`)) return;
      const npc = { ...this.npcs };
      delete npc[this.courant];
      try {
        await api('/api/admin/content/npcs', 'PUT', { ...fichier, npc });
        fichier = { ...fichier, npc }; this.npcs = npc;
        reference = JSON.stringify(this.fiche);
        this.ouvrir(Object.keys(npc)[0]);
        this.dire('PNJ supprimé.');
      } catch (e) { this.dire(e.message, true); }
    },

    async chargerPositions() {
      try { this.positions = (await api('/api/admin/npcs/positions')).pnj; } catch { this.positions = []; }
    },

    async init() {
      try {
        fichier = await api('/api/admin/content/npcs');
        this.npcs = fichier.npc || {};
      } catch (e) { this.dire(e.message, true); }
      try { this.spells = (await api('/api/admin/content/spells')).spells || []; } catch { /* lecture réservée */ }
      try { this.skills = (await api('/api/admin/content/skills')).skills || []; } catch { /* lecture réservée */ }
      this.couchesDispo = Object.keys((await chargerRessources()).manifest.avatar.male).sort();
      this.chargerPositions();
      const premier = Object.keys(this.npcs)[0];
      if (premier) this.ouvrir(premier);
    },
  };
}
