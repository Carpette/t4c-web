// Quêtes de la Forge : le MODÈLE d'une quête (ce que l'admin édite) et sa
// traduction en dialogues de PNJ, seule chose que le serveur exécute
// (server/game/dialogues.js). Module pur : pas de DOM, pas d'état.
//
// Modèle, rangé dans la section `quests` des overrides de la zone :
//   { id, titre, memo, niveau, repetable, etapes: [
//       { type: 'prise',     npcId, keywords: [], reponse },    toujours la première
//       { type: 'tuer',      mob, n, progression },             objectifs, entre deux
//       { type: 'rapporter', item, n },                          dialogues
//       { type: 'lieu',      x, z, r, nom },
//       { type: 'parler',    npcId, keywords: [], reponse },
//       { type: 'rendu',     npcId, keywords: [], reponse,       toujours la dernière
//         recompenses: { gold, xp, items: [{ defId, n }], sorts: [id], tp: { zoneId, x, z } | null } },
//   ],
//   relances: [                                                 répliques hors étapes
//       { moment: 'avant'|'pendant'|'apres', npcId, keywords: [], phrases: [] } ] }
//   (phrases tirées au hasard, variables {reste}, {visites}... : shared/mots-cles.js)
//
// Traduction : chaque étape À DIALOGUE (prise, parler, rendu) pose le drapeau
// `quete:<id>:<k>` (k = 1, 2...) et exige celui du dialogue précédent. Les
// objectifs qui la suivent sont LANCÉS par ses réactions (chasse, lieu) et
// EXIGÉS par les conditions du dialogue suivant (chasses, flags, items).

export const QUEST_RE = /^quete:([^:]+):(.+)$/;
export const drapeau = (id, k) => `quete:${id}:${k}`;
const cleObjectif = (id, i) => `quete:${id}:o${i}`;

export const TYPES = {
  prise: { nom: 'Prise de quête', dialogue: true },
  tuer: { nom: 'Tuer' },
  rapporter: { nom: 'Rapporter' },
  lieu: { nom: 'Se rendre à' },
  parler: { nom: 'Parler à', dialogue: true },
  rendu: { nom: 'Rendu de quête', dialogue: true },
};
export const OBJECTIFS = ['tuer', 'rapporter', 'lieu', 'parler'];
export const MOMENTS = [
  ['avant', 'Avant la quête'], ['pendant', 'Pendant la quête'], ['apres', 'Quête rendue'],
];
export const relanceVide = (npcId) => ({ moment: 'pendant', npcId, keywords: [], phrases: [''] });
export const aDialogue = (e) => !!TYPES[e?.type]?.dialogue;

export function nouvelleQuete(id, titre, npcId) {
  return {
    id, titre: titre || id, memo: '', niveau: 1, repetable: false,
    etapes: [
      { type: 'prise', npcId, keywords: [], reponse: '' },
      { type: 'rendu', npcId, keywords: [], reponse: '', recompenses: recompensesVides() },
    ],
  };
}
export const recompensesVides = () => ({ gold: 0, xp: 0, items: [], sorts: [], tp: null });

// étape vierge d'un type donné (changement de type ou insertion)
export function etapeVide(type, npcId) {
  if (type === 'tuer') return { type, mob: '', n: 10, progression: true };
  if (type === 'rapporter') return { type, item: '', n: 1 };
  if (type === 'lieu') return { type, x: 0, z: 0, r: 3, nom: '' };
  if (type === 'rendu') return { type, npcId, keywords: [], reponse: '', recompenses: recompensesVides() };
  return { type, npcId, keywords: [], reponse: '' };
}

// id de quête tiré d'un titre : « Les rats de la ville » -> les_rats_de_la_ville
export function idDepuisTitre(titre) {
  return String(titre || '').trim().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, '_').replace(/[^a-z0-9_]/gi, '').toLowerCase().slice(0, 40);
}

// Traduit une quête en dialogues : [{ npcId, flag, dlg }], dans l'ordre des étapes.
export function compiler(q, zoneId) {
  const out = [];
  const dialogues = [];          // indices des étapes à dialogue
  q.etapes.forEach((e, i) => { if (aDialogue(e)) dialogues.push(i); });
  const relances = (q.relances || []).filter(r => r.npcId && r.keywords?.length && r.phrases?.some(t => String(t).trim()));
  const pendant = relances.some(r => r.moment === 'pendant');
  // objets à rapporter, pour les variables {objet}, {manque}...
  const suivi = q.etapes.filter(e => e.type === 'rapporter' && e.item).map(e => ({ item: e.item, n: Math.max(1, e.n | 0) }));
  const cles = [];               // tout ce qu'une quête répétable doit effacer
  q.etapes.forEach((e, i) => {
    if (e.type === 'tuer' || e.type === 'lieu') cles.push(cleObjectif(q.id, i));
  });
  dialogues.forEach((i, k) => cles.push(drapeau(q.id, k + 1)));

  dialogues.forEach((i, k) => {
    const e = q.etapes[i];
    const flag = drapeau(q.id, k + 1);
    const conditions = {};
    if (k > 0) conditions.flag = drapeau(q.id, k);
    else {
      if (q.niveau > 1) conditions.level = q.niveau | 0;
      // rendue (et non répétable), la quête ne se reprend plus : sans cela,
      // redire le mot-clé relancerait ses chasses. Avec des relances « pendant »,
      // la prise ne se rejoue pas non plus en cours de quête : la relance répond
      if (pendant) conditions.notFlag = flag;
      else if (!q.repetable) conditions.notFlag = drapeau(q.id, dialogues.length);
    }
    // objectifs depuis le dialogue précédent : exigés ici
    const debut = k > 0 ? dialogues[k - 1] + 1 : 0;
    const chasses = [], flags = [], items = [];
    for (let j = debut; j < i; j++) {
      const o = q.etapes[j];
      if (o.type === 'tuer' && o.mob) chasses.push(cleObjectif(q.id, j));
      if (o.type === 'lieu') flags.push(cleObjectif(q.id, j));
      if (o.type === 'rapporter' && o.item) items.push({ item: o.item, n: Math.max(1, o.n | 0), consume: true });
    }
    if (chasses.length) conditions.chasses = chasses;
    if (flags.length) conditions.flags = flags;
    if (items.length) conditions.items = items;

    const reactions = [{ type: 'flag', key: flag }];
    // objectifs jusqu'au dialogue suivant : lancés ici
    const fin = k + 1 < dialogues.length ? dialogues[k + 1] : q.etapes.length;
    for (let j = i + 1; j < fin; j++) {
      const o = q.etapes[j];
      if (o.type === 'tuer' && o.mob) {
        const r = { type: 'chasse', key: cleObjectif(q.id, j), mob: o.mob, n: Math.max(1, o.n | 0) };
        if (o.progression === false) r.silencieux = true;
        reactions.push(r);
      }
      if (o.type === 'lieu') {
        const r = { type: 'lieu', key: cleObjectif(q.id, j), zoneId, x: +o.x || 0, z: +o.z || 0, r: Math.max(1, +o.r || 3) };
        if (o.nom) r.nom = o.nom;
        reactions.push(r);
      }
    }
    if (e.type === 'rendu') {
      const rc = e.recompenses || {};
      if (rc.gold > 0) reactions.push({ type: 'gold', amount: rc.gold | 0 });
      if (rc.xp > 0) reactions.push({ type: 'xp', amount: rc.xp | 0 });
      for (const it of rc.items || []) if (it.defId) reactions.push({ type: 'item', defId: it.defId, n: Math.max(1, it.n | 0) });
      for (const s of rc.sorts || []) if (s) reactions.push({ type: 'sort', spellId: s });
      if (rc.tp && Number.isFinite(+rc.tp.x) && Number.isFinite(+rc.tp.z)) {
        reactions.push({ type: 'teleport', zoneId: rc.tp.zoneId ?? zoneId, x: +rc.tp.x, z: +rc.tp.z });
      }
    }
    // quête répétable : rendue, elle efface sa progression et repart de zéro
    if (q.repetable && k === dialogues.length - 1) for (const key of cles) reactions.push({ type: 'unflag', key });

    const dlg = { keywords: e.keywords?.length ? [...e.keywords] : ['quete'], reponse: e.reponse || '...', reactions, quete: q.id };
    if (Object.keys(conditions).length) dlg.conditions = conditions;
    if (q.repetable) dlg.repeatable = true;
    if (suivi.length) dlg.suivi = { items: suivi };
    out.push({ npcId: e.npcId, flag, dlg });
  });

  // relances : rangées APRÈS les étapes chez le PNJ, elles ne répondent que
  // si aucune étape ne le fait (mêmes mots-clés possibles)
  const premier = drapeau(q.id, 1), dernier = drapeau(q.id, dialogues.length);
  for (const r of relances) {
    const phrases = r.phrases.map(t => String(t).trim()).filter(Boolean);
    const conditions = r.moment === 'avant' ? { notFlag: premier }
      : r.moment === 'apres' ? { flag: dernier }
      : { flag: premier, notFlag: dernier };
    const dlg = { keywords: [...r.keywords], reponse: phrases[0], reactions: [], conditions, quete: q.id, relance: true };
    if (phrases.length > 1) dlg.reponses = phrases;
    if (suivi.length) dlg.suivi = { items: suivi };
    out.push({ npcId: r.npcId, flag: null, dlg });
  }
  return out;
}

// Ce qui empêche la quête de fonctionner en jeu (liste vide : valide).
// ctx : { npcs: Set d'ids, mobs, items, sorts (objets indexés par id) }
export function problemes(q, ctx) {
  const p = [];
  const E = q.etapes || [];
  if (E[0]?.type !== 'prise') p.push('La première étape doit être une prise de quête.');
  if (E.length < 2 || E[E.length - 1]?.type !== 'rendu') p.push('La dernière étape doit être un rendu de quête.');
  E.forEach((e, i) => {
    const n = `Étape ${i + 1}`;
    if (aDialogue(e)) {
      if (!e.npcId || !ctx.npcs.has(e.npcId)) p.push(`${n} : PNJ absent de la zone.`);
      if (!e.keywords?.length) p.push(`${n} : aucun mot-clé.`);
      if (!String(e.reponse || '').trim()) p.push(`${n} : le PNJ ne répond rien.`);
    }
    if (e.type === 'tuer' && !ctx.mobs[e.mob]) p.push(`${n} : créature à choisir.`);
    if (e.type === 'rapporter' && !ctx.items[e.item]) p.push(`${n} : objet à choisir.`);
    if (e.type === 'lieu' && !(Number.isFinite(+e.x) && Number.isFinite(+e.z))) p.push(`${n} : lieu sans coordonnées.`);
    for (const it of e.recompenses?.items || []) if (!ctx.items[it.defId]) p.push(`${n} : objet de récompense à choisir.`);
    for (const s of e.recompenses?.sorts || []) if (!ctx.sorts[s]) p.push(`${n} : sort de récompense inconnu.`);
  });
  (q.relances || []).forEach((r, i) => {
    const n = `Relance ${i + 1}`;
    if (!r.npcId || !ctx.npcs.has(r.npcId)) p.push(`${n} : PNJ absent de la zone.`);
    if (!r.keywords?.length) p.push(`${n} : aucun mot-clé.`);
    if (!r.phrases?.some(t => String(t).trim())) p.push(`${n} : aucune phrase.`);
    if (r.moment === 'apres' && q.repetable) p.push(`${n} : une quête répétable repart à zéro une fois rendue, « Quête rendue » ne s'affiche jamais.`);
  });
  return p;
}

// Quête d'avant le modèle (dialogues seuls, éditeur de carte ou fiche PNJ) :
// reconstruit un modèle à partir des drapeaux `quete:<id>:<k>` qu'elle pose.
// `poseurs` : Map(flag -> { npcId, dlg }) ; `reactions` : toutes les réactions
// des dialogues de la quête (pour retrouver le monstre d'une chasse).
export function depuisDialogues(id, poseurs, reactions) {
  const chasse = new Map(), lieu = new Map();
  for (const r of reactions) {
    if (r.type === 'chasse') chasse.set(r.key, r);
    if (r.type === 'lieu') lieu.set(r.key, r);
  }
  const flags = [...poseurs.entries()].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));
  const etapes = [];
  let niveau = 1, repetable = false;
  flags.forEach(([, { npcId, dlg }], k) => {
    const c = dlg.conditions || {};
    if (k === 0 && c.level) niveau = c.level;
    if (dlg.repeatable) repetable = true;
    for (const key of [c.chasse, ...(c.chasses || [])]) {
      const r = key && chasse.get(key);
      if (r) etapes.push({ type: 'tuer', mob: r.mob, n: r.n, progression: !r.silencieux });
    }
    for (const key of c.flags || []) {
      const r = lieu.get(key);
      if (r) etapes.push({ type: 'lieu', x: r.x, z: r.z, r: r.r, nom: r.nom || '' });
    }
    if (c.item) etapes.push({ type: 'rapporter', item: c.item, n: c.n || 1 });
    for (const o of c.items || []) etapes.push({ type: 'rapporter', item: o.item, n: o.n || 1 });
    const type = k === 0 ? 'prise' : k === flags.length - 1 ? 'rendu' : 'parler';
    const e = { type, npcId, keywords: [...(dlg.keywords || [])], reponse: dlg.reponse || '' };
    if (type === 'rendu') {
      const rc = recompensesVides();
      for (const r of dlg.reactions || []) {
        if (r.type === 'gold') rc.gold += r.amount | 0;
        if (r.type === 'xp') rc.xp += r.amount | 0;
        if (r.type === 'item') rc.items.push({ defId: r.defId, n: r.n || 1 });
        if (r.type === 'sort') rc.sorts.push(r.spellId);
        if (r.type === 'teleport') rc.tp = { zoneId: r.zoneId, x: r.x, z: r.z };
      }
      e.recompenses = rc;
    }
    etapes.push(e);
  });
  return { id, titre: id, memo: '', niveau, repetable, etapes };
}
