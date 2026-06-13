// Palette de l'éditeur de carte : toute la base graphique du jeu.
// — les 8 types de tuiles de sol (aperçu sprite Flare + couleur de repli) ;
// — TOUS les types de props avec leurs variantes explicites (vignettes sprite) ;
// — recherche/filtre, et options de pose (variante aléatoire, échelle, miroir).
// La sélection devient l'outil de pose de l'éditeur (editor.js).
import { TILE } from '../../../shared/worldgen.js';
import {
  FLOOR_IDS, PROP_TYPES, SCALABLE_PROPS, FLIPPABLE_PROPS,
  TILESET_PROP_FAMILIES, tilesetPropId,
} from '../render2d/decormap.js';
import { resolveTile } from '../render2d/assets.js';

// couleurs d'aplat (rendu rapide à faible zoom + repli sans assets)
export const TILE_COLORS = {
  [TILE.WATER]: '#2a4a66', [TILE.SAND]: '#d8c890', [TILE.GRASS]: '#55844a',
  [TILE.FOREST]: '#3a6435', [TILE.ROCK]: '#7d7d7a', [TILE.COBBLE]: '#9a9590',
  [TILE.PATH]: '#9a8560', [TILE.GRAVE]: '#6a5f52',
};
export const TILE_NAMES = {
  [TILE.GRASS]: 'herbe', [TILE.FOREST]: 'forêt', [TILE.PATH]: 'chemin', [TILE.COBBLE]: 'pavés',
  [TILE.SAND]: 'terre', [TILE.GRAVE]: 'cimetière', [TILE.ROCK]: 'roche (bloquant)', [TILE.WATER]: 'eau (bloquant)',
};
export const TILE_ORDER = [TILE.GRASS, TILE.FOREST, TILE.PATH, TILE.COBBLE, TILE.SAND, TILE.GRAVE, TILE.ROCK, TILE.WATER];

// glyphes de secours (faible zoom et palette sans assets)
export const PROP_GLYPHS = {
  tree: ['🌲', '#7ac87a'], rock: ['●', '#aaa'], house: ['⌂', '#e8c890'], torch: ['✶', '#ffaa33'],
  grave: ['✝', '#ccc'], well: ['◎', '#9ad'], obelisk: ['▲', '#9af'], trialgate: ['◈', '#c9f'], exitgate: ['◈', '#9fd'],
  bank: ['▣', '#fc6'], chest: ['▢', '#fa0'], cave: ['Ω', '#ff6'],
  wall: ['▮', '#ca8'], fence: ['╪', '#b97'], ruin: ['⌐', '#987'], bridge: ['≡', '#a86'],
};

const THUMB = 72; // côté d'une vignette (px) — assez grand pour distinguer la tuile

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

// Construit la palette dans `container`. `assets` peut être null (mode dégradé :
// vignettes en glyphes). `onSelect(tool)` est appelé à chaque sélection avec
// { kind:'tile', tile } ou { kind:'prop', type, v|null, s, flip }.
export function buildPalette({ container, assets, onSelect }) {
  const doc = container.ownerDocument || document;
  const el = (tag, cls, text) => {
    const e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };

  // état de la sélection courante
  let current = { kind: 'tile', tile: TILE.GRASS };
  const opts = { s: 1, flip: false }; // options de pose des props
  const chips = []; // toutes les vignettes cliquables, pour le surlignage

  const root = el('div', 'pal-root');
  container.innerHTML = '';
  container.appendChild(root);

  // --- recherche ---
  const search = el('input', 'pal-search');
  search.placeholder = '🔍 filtrer (arbre, mur, pont...)';
  root.appendChild(search);

  // --- options de pose (props) ---
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
  fRow.append(fInput, doc.createTextNode(' Miroir horizontal'));
  fInput.onchange = () => { opts.flip = !!fInput.checked; emit(); };
  optBox.append(sRow, fRow);
  root.appendChild(optBox);

  function refreshOptions() {
    const isProp = current.kind === 'prop';
    sRow.style.display = isProp && SCALABLE_PROPS.has(current.type) ? '' : 'none';
    fRow.style.display = isProp && FLIPPABLE_PROPS.has(current.type) ? '' : 'none';
  }

  function emit() {
    refreshOptions();
    for (const c of chips) c.div.classList.toggle('active', c.match(current));
    onSelect(current.kind === 'tile'
      ? { ...current }
      : { ...current, s: SCALABLE_PROPS.has(current.type) ? opts.s : 1, flip: FLIPPABLE_PROPS.has(current.type) && opts.flip });
  }

  // vignette générique : aperçu (sprite ou glyphe) + libellé en infobulle
  function makeChip({ label, tileId, glyph, color, swatch }, select, match) {
    const div = el('div', 'pal-chip');
    div.title = label;
    if (swatch) {
      const sw = el('div', 'pal-swatch');
      sw.style.background = swatch;
      div.appendChild(sw);
    } else {
      const cv = el('canvas');
      cv.width = THUMB; cv.height = THUMB;
      let drawn = false;
      if (assets && tileId != null) drawn = drawThumb(cv, assets, tileId);
      if (!drawn) {
        const g = cv.getContext('2d');
        g.font = '26px sans-serif'; g.textAlign = 'center'; g.fillStyle = color || '#fff';
        g.fillText(glyph || '?', THUMB / 2, THUMB / 2 + 9);
      }
      div.appendChild(cv);
    }
    div.appendChild(el('div', 'pal-chip-label', label));
    div.onclick = () => { current = select(); emit(); };
    chips.push({ div, match });
    return div;
  }

  // --- état d'ouverture des thèmes (accordéon), mémorisé entre sessions ---
  const OPEN_KEY = 'palAccordionOpen';
  let openState = {};
  try { openState = JSON.parse(localStorage.getItem(OPEN_KEY) || '{}') || {}; } catch { openState = {}; }
  const saveOpen = () => { try { localStorage.setItem(OPEN_KEY, JSON.stringify(openState)); } catch { /* stockage indispo */ } };

  // Crée un thème repliable (accordéon). `id` sert à mémoriser l'état ;
  // `count` est affiché à droite de l'en-tête. Retourne le conteneur de corps
  // dans lequel ajouter des sous-sections. Plusieurs thèmes peuvent être ouverts.
  const themes = []; // { theme, head, body, text } pour le filtre et l'aplatissement
  function makeTheme(id, label, count) {
    const theme = el('div', 'pal-theme');
    const head = el('button', 'pal-theme-head');
    head.type = 'button';
    const chevron = el('span', 'pal-theme-chevron', '▶');
    head.append(chevron, doc.createTextNode(label));
    if (count != null) head.appendChild(el('span', 'pal-theme-count', String(count)));
    const body = el('div', 'pal-theme-body');
    theme.append(head, body);
    const open = openState[id] ?? false;
    theme.classList.toggle('open', open);
    head.onclick = () => {
      const now = !theme.classList.contains('open');
      theme.classList.toggle('open', now);
      openState[id] = now;
      saveOpen();
    };
    root.appendChild(theme);
    themes.push({ id, theme, head, body });
    return body;
  }

  // Sous-section « type » (Sols / Murs & falaises / Mobilier & objets) à
  // l'intérieur d'un thème : un titre + une rangée de vignettes.
  function makeSubsection(body, title) {
    const sub = el('div', 'pal-subsec');
    sub.appendChild(el('h4', null, title));
    const row = el('div', 'pal-row');
    sub.appendChild(row);
    body.appendChild(sub);
    return { sub, row };
  }

  // --- section sols ---
  const groups = []; // { div, text } pour le filtre
  {
    const g = el('div', 'pal-group');
    g.appendChild(el('h3', null, 'Sols'));
    const row = el('div', 'pal-row');
    for (const t of TILE_ORDER) {
      row.appendChild(makeChip(
        { label: TILE_NAMES[t], tileId: FLOOR_IDS[t][0], swatch: assets ? null : TILE_COLORS[t] },
        () => ({ kind: 'tile', tile: t }),
        (cur) => cur.kind === 'tile' && cur.tile === t,
      ));
    }
    g.appendChild(row);
    root.appendChild(g);
    groups.push({ div: g, text: 'sols ' + TILE_ORDER.map(t => TILE_NAMES[t]).join(' ') });
  }

  // --- sections props : un groupe par type, toutes variantes en vignettes ---
  for (const [type, def] of Object.entries(PROP_TYPES)) {
    const g = el('div', 'pal-group');
    g.appendChild(el('h3', null, def.label));
    const row = el('div', 'pal-row');
    if (def.random && def.variants.length > 1) {
      row.appendChild(makeChip(
        { label: `${def.label} — variante aléatoire`, glyph: '🎲', color: '#ffd24a' },
        () => ({ kind: 'prop', type, v: null }),
        (cur) => cur.kind === 'prop' && cur.type === type && cur.v == null,
      ));
    }
    for (const va of def.variants) {
      const [glyph, color] = PROP_GLYPHS[type] || ['?', '#fff'];
      row.appendChild(makeChip(
        { label: va.label, tileId: va.id, glyph, color },
        () => ({ kind: 'prop', type, v: def.variants.length > 1 || def.random ? va.v : null }),
        (cur) => cur.kind === 'prop' && cur.type === type && cur.v === (def.variants.length > 1 || def.random ? va.v : null),
      ));
    }
    g.appendChild(row);
    root.appendChild(g);
    groups.push({ div: g, text: (type + ' ' + def.label + ' ' + def.variants.map(v => v.label).join(' ')).toLowerCase() });
  }

  // --- thèmes Flare additionnels : un ACCORDÉON par famille, sous-sections par type ---
  // Énumère toutes les frames du tileset depuis le manifeste (cave/dungeon/ruins/
  // neige) et les répartit en 3 sous-sections selon `ts.types[frame]` (sol/mur/objet,
  // calculé par build-manifest.js). La pose enregistre un prop { type, v:frame }
  // dont l'id de tuile rendu est « prefix:frame » (voir decormap.tilesetPropId).
  const tilesets = assets?.manifest?.tilesets || {};
  // libellés des sous-sections + ordre d'affichage des types
  const TYPE_SUBSECTIONS = [
    ['sol', 'Sols'],
    ['mur', 'Murs & falaises'],
    ['objet', 'Mobilier & objets'],
  ];
  for (const [type, prefix, label, [glyph, color]] of TILESET_PROP_FAMILIES) {
    const ts = tilesets[prefix];
    if (!ts || !ts.tiles) continue;
    const frames = Object.keys(ts.tiles).sort((a, b) => Number(a) - Number(b));
    if (!frames.length) continue;
    const ttypes = ts.types || {};
    const body = makeTheme('flare:' + prefix, label, frames.length);
    const subGroups = []; // { div, text } pour le filtre (granularité sous-section)
    for (const [tkey, subLabel] of TYPE_SUBSECTIONS) {
      const inSec = frames.filter(f => (ttypes[f] || 'objet') === tkey);
      if (!inSec.length) continue;
      const { sub, row } = makeSubsection(body, `${subLabel} (${inSec.length})`);
      for (const frame of inSec) {
        const n = Number(frame);
        const tileId = tilesetPropId(type, n); // « prefix:frame »
        row.appendChild(makeChip(
          { label: `${label} — ${subLabel} ${frame}`, tileId, glyph, color },
          () => ({ kind: 'prop', type, v: n }),
          (cur) => cur.kind === 'prop' && cur.type === type && cur.v === n,
        ));
      }
      subGroups.push({ div: sub, text: (type + ' ' + prefix + ' ' + label + ' ' + subLabel).toLowerCase() });
    }
    // un thème compte comme un « groupe » pour le filtre : visible si l'une de
    // ses sous-sections matche ; aplati (déplié) quand une recherche est active.
    themes[themes.length - 1].subGroups = subGroups;
    themes[themes.length - 1].text = (type + ' ' + prefix + ' ' + label).toLowerCase();
  }

  search.oninput = () => {
    const q = search.value.trim().toLowerCase();
    // groupes plats (sols + props d'Arakas)
    for (const grp of groups) grp.div.style.display = !q || grp.text.includes(q) ? '' : 'none';
    // thèmes Flare : recherche active -> on aplatit (déplie tout) et on filtre
    // par sous-section ; recherche vide -> on restaure l'état d'accordéon mémorisé.
    for (const t of themes) {
      const subs = t.subGroups || [];
      let anyMatch = false;
      for (const s of subs) {
        const show = !q || s.text.includes(q) || (t.text || '').includes(q);
        s.div.style.display = show ? '' : 'none';
        if (show) anyMatch = true;
      }
      if (q) {
        t.theme.style.display = anyMatch ? '' : 'none';
        t.theme.classList.add('open'); // aplatit l'accordéon pour montrer les résultats
      } else {
        t.theme.style.display = '';
        t.theme.classList.toggle('open', openState[t.id] ?? false); // restaure l'état mémorisé
      }
    }
  };

  emit(); // sélection initiale : herbe

  return {
    // pipette : sélectionne une tuile depuis la carte
    selectTile(t) { current = { kind: 'tile', tile: t }; emit(); },
    // pipette : sélectionne un prop (variante/échelle/miroir repris du prop visé)
    selectProp(type, v = null, s = 1, flip = false) {
      if (!PROP_TYPES[type]) return;
      current = { kind: 'prop', type, v };
      opts.s = s; sInput.value = String(s); sVal.textContent = '×' + s.toFixed(2);
      opts.flip = flip; fInput.checked = flip;
      emit();
    },
    getSelection() { return { ...current } },
  };
}
