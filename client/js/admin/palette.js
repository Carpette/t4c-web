// Palette de l'éditeur de carte : toute la base graphique du jeu, rangée par
// TYPE D'OBJET (sols, murs, toits...) quelle que soit sa provenance (Flare,
// atelier, murs IA) : qui cherche un mur trouve tous les murs. La provenance
// ne sert plus que de sous-titre (« style neige », matériau) et de mot-clé.
// — une catégorie affichée à la fois (pastilles), ou la recherche sur tout ;
// — vignettes en grille, dessinées quand elles deviennent visibles ;
// — encadré « Sélection » épinglé : ce qui sera posé, toujours sous les yeux ;
// — options de pose (échelle, miroir). La sélection devient l'outil de pose
//   de l'éditeur (editor.js).
import { TILE } from '../../../shared/worldgen.js';
import {
  FLOOR_IDS, PROP_TYPES, isScalableProp, isFlippableProp,
  TILESET_PROP_FAMILIES, tilesetPropId,
  GRASS_PROP_TYPE, GRASS_PROP_LABEL, grasslandPropId, classifyGrasslandFrame,
  WALL_MATERIALS, wallPropId,
  FLOOR_MATERIALS, floorPropId,
  ROOF_MATERIALS, roofPropId,
  userPropId,
} from '../render2d/decormap.js';

// matériaux déclarés + matériaux découverts au MANIFESTE (créés à chaud dans
// l'atelier, tilesets « <prefix><clé> ») : [clé, libellé], sans doublon.
function withDynamicMaterials(declared, tilesets, prefix) {
  const known = new Set(declared.map(([m]) => prefix + m));
  const extra = Object.keys(tilesets || {})
    .filter(k => k.startsWith(prefix) && !known.has(k) && tilesets[k]?.tiles)
    .sort()
    .map(k => [k.slice(prefix.length), tilesets[k].label || k.slice(prefix.length)]);
  return declared.concat(extra);
}
import { resolveTile } from '../render2d/assets.js';

// couleurs d'aplat (rendu rapide à faible zoom + repli sans assets)
import { TILE_COLORS } from '../render2d/couleurs-tuiles.js';
export { TILE_COLORS };
export const TILE_NAMES = {
  [TILE.GRASS]: 'herbe', [TILE.FOREST]: 'forêt', [TILE.PATH]: 'chemin', [TILE.COBBLE]: 'pavés',
  [TILE.SAND]: 'terre', [TILE.GRAVE]: 'cimetière', [TILE.ROCK]: 'roche (bloquant)', [TILE.WATER]: 'eau (bloquant)',
};
export const TILE_ORDER = [TILE.GRASS, TILE.FOREST, TILE.PATH, TILE.COBBLE, TILE.SAND, TILE.GRAVE, TILE.ROCK, TILE.WATER];

// glyphes de secours (faible zoom et palette sans assets)
export const PROP_GLYPHS = {
  tree: ['♣', '#7ac87a'], rock: ['●', '#aaa'], house: ['⌂', '#e8c890'], torch: ['✶', '#ffaa33'],
  grave: ['✝', '#ccc'], well: ['◎', '#9ad'], obelisk: ['▲', '#9af'], trialgate: ['◈', '#c9f'], exitgate: ['◈', '#9fd'],
  bank: ['▣', '#fc6'], chest: ['▢', '#fa0'], cave: ['Ω', '#ff6'],
  wall: ['▮', '#ca8'], fence: ['╪', '#b97'], ruin: ['⌐', '#987'], bridge: ['≡', '#a86'],
  [GRASS_PROP_TYPE]: ['⌂', '#dcb37a'],
};

const THUMB = 64; // côté interne d'une vignette (px), affichée à la largeur de la grille
const RESULTATS_MAX = 400; // recherche : au-delà, on invite à affiner

// dessine un sprite du tileset, ajusté au cadre de la vignette
function drawThumb(canvas, assets, tileId) {
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, canvas.width, canvas.height);
  const r = resolveTile(assets, tileId, assets.grass, assets.water);
  if (!r || !r.img) return false;
  const img = r.img;
  const [x, y, w, h] = r.rect;
  const k = Math.min(canvas.width / w, canvas.height / h);
  g.imageSmoothingEnabled = true;
  g.drawImage(img, x, y, w, h, (canvas.width - w * k) / 2, (canvas.height - h * k) / 2, w * k, h * k);
  return true;
}

// catégories (types d'objet), dans l'ordre d'affichage
const CATEGORIES = [
  ['sols', 'Sols'], ['murs', 'Murs'], ['toits', 'Toits'], ['barrieres', 'Barrières et ponts'],
  ['batiments', 'Bâtiments'], ['vegetation', 'Végétation'], ['rochers', 'Rochers et falaises'],
  ['objets', 'Objets et mobilier'], ['speciaux', 'Points spéciaux'], ['decors3d', 'Décors 3D'],
];
const NOM_CATEGORIE = Object.fromEntries(CATEGORIES);
// props d'Arakas -> catégorie
const CAT_PROP = {
  tree: 'vegetation', rock: 'rochers', cave: 'rochers', grave: 'objets', ruin: 'objets',
  wall: 'murs', fence: 'barrieres', bridge: 'barrieres', torch: 'objets', house: 'batiments',
  well: 'speciaux', obelisk: 'speciaux', trialgate: 'speciaux', exitgate: 'speciaux', chest: 'speciaux', bank: 'speciaux',
};
// classement des frames Flare (ts.types / classifyGrasslandFrame) -> catégorie.
// Ce classement est GÉOMÉTRIQUE (taille du sprite, cf. build-manifest.js) : une
// plante haute peut passer pour un mur. Ces frames viennent donc APRÈS les
// éléments nommés, sous un sous-titre qui le dit, avec un libellé neutre.
const CAT_FRAME = { sol: 'sols', mur: 'murs', objet: 'objets', bati: 'batiments' };
// la provenance devient un « style » (sous-titre), pas un classement
const STYLE_FLARE = { cave: 'caverne', dungeon: 'donjon', snow: 'neige', ruins: 'ruines' };

// recherche insensible à la casse et aux accents
const norm = (t) => String(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// clé d'une sélection, pour retrouver sa vignette
const cleDe = (t) => (t.kind === 'tile' ? `t:${t.tile}` : `p:${t.type}:${t.v ?? '*'}`);

// Inventaire de tout ce qui se pose : [{ cle, cat, groupe, label, tileId,
// glyph, color, swatch, outil, texte }], dans l'ordre d'affichage.
function inventaire(assets) {
  const out = [];
  const tilesets = assets?.manifest?.tilesets || {};
  const ajouter = (it) => {
    it.cle = cleDe(it.outil);
    it.texte = norm([it.label, it.groupe, NOM_CATEGORIE[it.cat], it.motsCles || ''].join(' '));
    out.push(it);
  };
  const frames = (ts) => Object.keys(ts?.tiles || {}).map(Number).sort((a, b) => a - b);

  // sols peints (terrain) : en tête, c'est le plus utilisé
  for (const t of TILE_ORDER) {
    ajouter({ cat: 'sols', groupe: 'Terrain', label: TILE_NAMES[t], tileId: FLOOR_IDS[t][0],
      swatch: assets ? null : TILE_COLORS[t], outil: { kind: 'tile', tile: t } });
  }
  // props d'Arakas, variante par variante
  for (const [type, def] of Object.entries(PROP_TYPES)) {
    const cat = CAT_PROP[type] || 'objets';
    const groupe = def.label[0].toUpperCase() + def.label.slice(1);
    const [glyph, color] = PROP_GLYPHS[type] || ['?', '#fff'];
    const multi = def.variants.length > 1 || def.random;
    if (def.random && def.variants.length > 1) {
      ajouter({ cat, groupe, label: `${def.label} (au hasard)`, glyph: '?', color: '#ffd24a',
        motsCles: type, outil: { kind: 'prop', type, v: null } });
    }
    for (const va of def.variants) {
      // les pans de toiture rangés parmi les « murs » historiques vont aux toits
      const c = type === 'wall' && /toit|pan /.test(va.label) ? 'toits' : cat;
      ajouter({ cat: c, groupe, label: va.label, tileId: va.id, glyph, color,
        motsCles: type, outil: { kind: 'prop', type, v: multi ? va.v : null } });
    }
  }
  // dalles de sol (atelier) : « au hasard » = variante par position, sans couture
  for (const [mat, label] of withDynamicMaterials(FLOOR_MATERIALS, tilesets, 'floor_')) {
    const type = `floor_${mat}`, ts = tilesets[type];
    if (!ts?.tiles) continue;
    const names = ts.names || [];
    ajouter({ cat: 'sols', groupe: `Dalles ${label}`, label: `${label} (au hasard)`, tileId: floorPropId(type, 0),
      glyph: '▦', color: '#8c6', motsCles: 'dalle ' + type, outil: { kind: 'prop', type, v: null } });
    for (const n of frames(ts)) {
      ajouter({ cat: 'sols', groupe: `Dalles ${label}`, label: names[n] || `pièce ${n}`, tileId: floorPropId(type, n),
        glyph: '▦', color: '#8c6', motsCles: 'dalle ' + type, outil: { kind: 'prop', type, v: n } });
    }
  }
  // murs : pièces par matériau (murs IA et murs d'arête procéduraux)
  for (const [mat, label] of withDynamicMaterials(WALL_MATERIALS, tilesets, 'wall_')) {
    const type = `wall_${mat}`, ts = tilesets[type];
    if (!ts?.tiles) continue;
    const names = ts.names || [];
    for (const n of frames(ts)) {
      ajouter({ cat: 'murs', groupe: label, label: names[n] || `pièce ${n}`, tileId: wallPropId(type, n),
        glyph: '▮', color: '#ca8', motsCles: 'mur ' + type, outil: { kind: 'prop', type, v: n } });
    }
  }
  // toits (atelier)
  for (const [mat, label] of withDynamicMaterials(ROOF_MATERIALS, tilesets, 'roof_')) {
    const type = `roof_${mat}`, ts = tilesets[type];
    if (!ts?.tiles) continue;
    const names = ts.names || [];
    for (const n of frames(ts)) {
      ajouter({ cat: 'toits', groupe: label, label: names[n] || `pièce ${n}`, tileId: roofPropId(type, n),
        glyph: '⌂', color: '#d86', motsCles: 'toit ' + type, outil: { kind: 'prop', type, v: n } });
    }
  }
  // tilesets Flare : chaque frame va dans la catégorie de son type (sol/mur/objet)
  for (const [type, prefix, , [glyph, color]] of TILESET_PROP_FAMILIES) {
    const ts = tilesets[prefix];
    if (!ts?.tiles) continue;
    const style = STYLE_FLARE[prefix] || prefix;
    for (const n of frames(ts)) {
      const t = ts.types?.[n] || 'objet';
      ajouter({ cat: CAT_FRAME[t] || 'objets', groupe: `Style ${style} (classement automatique)`, label: `${style} n° ${n}`,
        tileId: tilesetPropId(type, n), glyph, color, motsCles: `${type} ${prefix}`, outil: { kind: 'prop', type, v: n } });
    }
  }
  // tileset des plaines (ids numériques) : classé par la géométrie des frames ;
  // les transitions de berge (144-191) n'ont pas de sens isolées
  {
    const grass = assets?.manifest?.tiles || {};
    const [glyph, color] = PROP_GLYPHS[GRASS_PROP_TYPE];
    const ids = Object.keys(grass).filter(f => /^\d+$/.test(f) && !(+f >= 144 && +f <= 191))
      .map(Number).sort((a, b) => a - b);
    for (const n of ids) {
      const t = classifyGrasslandFrame(grass[n]);
      ajouter({ cat: CAT_FRAME[t] || 'objets', groupe: 'Style plaines (classement automatique)', label: `plaines n° ${n}`,
        tileId: grasslandPropId(n), glyph, color, motsCles: `${GRASS_PROP_TYPE} grassland ${GRASS_PROP_LABEL}`,
        outil: { kind: 'prop', type: GRASS_PROP_TYPE, v: n } });
    }
  }
  // décors 3D (atelier) : un modèle par sous-titre, une vignette par orientation
  for (const type of Object.keys(tilesets).filter(k => k.startsWith('user_')).sort()) {
    const ts = tilesets[type];
    if (!ts?.tiles || (ts.family || 'objet') !== 'objet') continue;
    const label = ts.label || type.slice(5), names = ts.names || [];
    for (const n of frames(ts)) {
      ajouter({ cat: 'decors3d', groupe: label, label: names[n] || `orientation ${n + 1}`, tileId: userPropId(type, n),
        glyph: '◆', color: '#9bd', motsCles: 'decor 3d atelier ' + type, outil: { kind: 'prop', type, v: n } });
    }
  }
  return out;
}

// Construit la palette dans `container`. `assets` peut être null (mode dégradé :
// vignettes en glyphes). `onSelect(tool)` est appelé à chaque sélection avec
// { kind:'tile', tile } ou { kind:'prop', type, v|null, s, flip }.
export function buildPalette({ container, assets, onSelect }) {
  const doc = container.ownerDocument || document;
  const win = doc.defaultView || globalThis;
  const el = (tag, cls, text) => {
    const e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };

  // éléments nommés d'abord, frames à classement automatique ensuite (tri stable)
  const items = inventaire(assets).sort((a, b) => a.groupe.endsWith('automatique)') - b.groupe.endsWith('automatique)'));
  const parCle = new Map(items.map(it => [it.cle, it]));
  const compte = {};
  for (const it of items) compte[it.cat] = (compte[it.cat] || 0) + 1;

  // état : sélection, options de pose, catégorie affichée (mémorisée)
  let current = { kind: 'tile', tile: TILE.GRASS };
  const opts = { s: 1, flip: false };
  const CAT_KEY = 'palCategorie';
  let categorie = 'sols';
  try { const c = localStorage.getItem(CAT_KEY); if (NOM_CATEGORIE[c]) categorie = c; } catch { /* stockage indispo */ }

  const root = el('div', 'pal-root');
  container.innerHTML = '';
  container.appendChild(root);

  // --- en-tête épinglé : sélection courante, recherche, catégories, options ---
  const header = el('div', 'pal-header');
  root.appendChild(header);

  const sel = el('div', 'pal-sel');
  sel.setAttribute?.('aria-live', 'polite');
  const selCv = el('canvas');
  selCv.width = selCv.height = THUMB;
  const selTxt = el('div', 'pal-sel-txt');
  const selNom = el('div', 'pal-sel-nom');
  const selCat = el('div', 'pal-sel-cat');
  selTxt.append(selNom, selCat);
  sel.append(selCv, selTxt);
  header.appendChild(sel);

  const search = el('input', 'pal-search');
  search.type = 'search';
  search.placeholder = 'Chercher dans tout (mur, arbre, neige...)';
  search.setAttribute?.('aria-label', 'Chercher un élément à poser');
  header.appendChild(search);

  const cats = el('div', 'pal-cats');
  cats.setAttribute?.('role', 'tablist');
  const boutonsCat = {};
  for (const [id, nom] of CATEGORIES) {
    if (!compte[id]) continue;
    const b = el('button', 'pal-cat');
    b.type = 'button';
    b.append(el('span', null, nom), el('span', 'pal-cat-n', String(compte[id])));
    b.onclick = () => { search.value = ''; choisirCategorie(id); };
    boutonsCat[id] = b;
    cats.appendChild(b);
  }
  header.appendChild(cats);

  const optBox = el('div', 'pal-options');
  const sRow = el('label', 'pal-opt', 'Échelle ');
  const sInput = el('input');
  sInput.type = 'range'; sInput.min = '0.25'; sInput.max = '3'; sInput.step = '0.05'; sInput.value = '1';
  const sVal = el('span', null, '×1.00');
  sRow.append(sInput, sVal);
  sInput.oninput = () => { opts.s = parseFloat(sInput.value); sVal.textContent = '×' + opts.s.toFixed(2); emit(); };
  const fRow = el('label', 'pal-opt');
  const fInput = el('input');
  fInput.type = 'checkbox';
  fRow.append(fInput, doc.createTextNode(' Miroir'));
  fInput.onchange = () => { opts.flip = !!fInput.checked; emit(); };
  optBox.append(sRow, fRow);
  header.appendChild(optBox);

  const liste = el('div', 'pal-liste');
  root.appendChild(liste);

  // --- vignettes : dessinées à leur apparition (des milliers de canvas
  // d'avance coûtaient des dizaines de Mo et une longue construction) ---
  const aDessiner = new WeakMap();
  const io = typeof win.IntersectionObserver === 'function'
    ? new win.IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        io.unobserve(e.target);
        aDessiner.get(e.target)?.();
      }
    }, { rootMargin: '200px' })
    : null;
  function vignette(cv, it) {
    const dessiner = () => {
      if (assets && it.tileId != null && drawThumb(cv, assets, it.tileId)) return;
      const g = cv.getContext('2d');
      g.clearRect?.(0, 0, cv.width, cv.height);
      g.font = '26px sans-serif'; g.textAlign = 'center'; g.fillStyle = it.color || '#fff';
      g.fillText(it.glyph || '?', THUMB / 2, THUMB / 2 + 9);
    };
    if (io) { aDessiner.set(cv, dessiner); io.observe(cv); } else dessiner();
  }

  let puces = []; // vignettes affichées : { div, cle }
  function puce(it) {
    const div = el('button', 'pal-chip');
    div.type = 'button';
    div.title = `${it.label} — ${it.groupe}`;
    if (it.swatch) {
      const sw = el('div', 'pal-swatch');
      sw.style.background = it.swatch;
      div.appendChild(sw);
    } else {
      const cv = el('canvas');
      cv.width = cv.height = THUMB;
      div.appendChild(cv);
      vignette(cv, it);
    }
    div.appendChild(el('div', 'pal-chip-label', it.label));
    div.onclick = () => { current = { ...it.outil }; emit(); };
    puces.push({ div, cle: it.cle });
    return div;
  }

  // affiche une liste d'éléments groupés par sous-titre (et par catégorie en recherche)
  function afficher(liste_, avecCategorie) {
    liste.innerHTML = '';
    puces = [];
    let cat = null, groupe = null, grille = null;
    for (const it of liste_) {
      if (avecCategorie && it.cat !== cat) {
        cat = it.cat; groupe = null;
        liste.appendChild(el('h3', 'pal-titre-cat', NOM_CATEGORIE[cat]));
      }
      if (it.groupe !== groupe) {
        groupe = it.groupe;
        liste.appendChild(el('h4', 'pal-groupe', groupe));
        grille = el('div', 'pal-grid');
        liste.appendChild(grille);
      }
      grille.appendChild(puce(it));
    }
    if (!liste_.length) liste.appendChild(el('p', 'pal-vide', 'Aucun élément ne correspond.'));
    surligner();
  }

  function choisirCategorie(id) {
    categorie = id;
    try { localStorage.setItem(CAT_KEY, id); } catch { /* stockage indispo */ }
    rendre();
  }
  function rendre() {
    const mots = norm(search.value.trim()).split(/\s+/).filter(Boolean);
    for (const [id, b] of Object.entries(boutonsCat)) b.classList.toggle('active', !mots.length && id === categorie);
    if (!mots.length) { afficher(items.filter(it => it.cat === categorie), false); return; }
    // recherche : tous les mots, dans toutes les catégories, rangés par catégorie
    const ordre = Object.fromEntries(CATEGORIES.map(([id], i) => [id, i]));
    const trouves = items.filter(it => mots.every(m => it.texte.includes(m)))
      .sort((a, b) => ordre[a.cat] - ordre[b.cat]);
    afficher(trouves.slice(0, RESULTATS_MAX), true);
    if (trouves.length > RESULTATS_MAX) {
      liste.appendChild(el('p', 'pal-vide', `${trouves.length - RESULTATS_MAX} autres résultats : précisez la recherche.`));
    }
  }
  search.oninput = rendre;
  search.onkeydown = (e) => { if (e.key === 'Escape') { search.value = ''; rendre(); } };

  // élément de la palette correspondant à la sélection (variante inconnue :
  // premier élément du même type, pour la catégorie et l'aperçu)
  function itemCourant() {
    return parCle.get(cleDe(current))
      || (current.kind === 'prop' ? items.find(it => it.outil.type === current.type) : null);
  }
  function surligner() {
    const cle = cleDe(current);
    for (const p of puces) {
      const actif = p.cle === cle;
      p.div.classList.toggle('active', actif);
      p.div.setAttribute?.('aria-pressed', actif ? 'true' : 'false');
    }
  }
  function majSelection() {
    const it = itemCourant();
    const exact = it && it.cle === cleDe(current);
    selNom.textContent = exact ? it.label : current.kind === 'prop' ? `${current.type} ${current.v ?? ''}` : '?';
    selCat.textContent = it ? `${NOM_CATEGORIE[it.cat]} · ${it.groupe}` : '';
    const g = selCv.getContext('2d');
    g.clearRect?.(0, 0, THUMB, THUMB);
    if (it?.swatch) { g.fillStyle = it.swatch; g.fillRect(0, 0, THUMB, THUMB); }
    else if (!(assets && it?.tileId != null && exact && drawThumb(selCv, assets, it.tileId))) {
      g.font = '26px sans-serif'; g.textAlign = 'center'; g.fillStyle = it?.color || '#fff';
      g.fillText(it?.glyph || '?', THUMB / 2, THUMB / 2 + 9);
    }
  }

  function refreshOptions() {
    const isProp = current.kind === 'prop';
    const echelle = isProp && isScalableProp(current.type), miroir = isProp && isFlippableProp(current.type);
    sRow.style.display = echelle ? '' : 'none';
    fRow.style.display = miroir ? '' : 'none';
    optBox.style.display = echelle || miroir ? '' : 'none';
  }

  function emit() {
    refreshOptions();
    surligner();
    majSelection();
    onSelect(current.kind === 'tile'
      ? { ...current }
      : { ...current, s: isScalableProp(current.type) ? opts.s : 1, flip: isFlippableProp(current.type) && opts.flip });
  }
  // sélection venue de la carte (pipette, R) : on montre sa vignette
  function montrer() {
    const it = itemCourant();
    if (it && !search.value.trim() && it.cat !== categorie) choisirCategorie(it.cat);
    puces.find(p => p.div.classList.contains('active'))?.div.scrollIntoView?.({ block: 'nearest' });
  }

  rendre();
  emit(); // sélection initiale : herbe

  return {
    // pipette : sélectionne une tuile depuis la carte
    selectTile(t) { current = { kind: 'tile', tile: t }; emit(); montrer(); },
    // pipette / rotation : sélectionne un prop (variante/échelle/miroir repris)
    // (tout type de prop : Arakas, tilesets Flare, murs, toits, atelier 3D)
    selectProp(type, v = null, s = 1, flip = false) {
      if (!type) return;
      current = { kind: 'prop', type, v };
      opts.s = s; sInput.value = String(s); sVal.textContent = '×' + s.toFixed(2);
      opts.flip = flip; fInput.checked = flip;
      emit();
      montrer();
    },
    getSelection() { return { ...current }; },
    // catégories présentes (tests, raccourcis)
    categories() { return Object.keys(boutonsCat); },
    choisirCategorie,
  };
}
