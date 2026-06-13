// Éditeur de carte de l'administration : un vrai outil de cartographie.
// — navigation : zoom molette centré sur le curseur, pan (clic milieu / clic
//   droit / Espace+glisser), mini-carte cliquable, coordonnées sous le curseur ;
// — rendu : aplats de couleur à faible zoom, vrais sprites Flare au-delà d'un
//   seuil (mêmes tuiles/décors que le jeu via buildDecor), cache de rendu par
//   chunks (LRU) pour rester fluide sur les cartes 384×384 ;
// — outils : pinceau de tuiles à taille réglable, rectangle (Maj), pipette
//   (Alt+clic), gomme et déplacement de décors, annuler/rétablir (Ctrl+Z),
//   export/import JSON des overrides de la zone ;
// — calques d'édition : « Camps » (zones de spawn par mouvement : cercles
//   colorés à déplacer/redimensionner/composer) et « PNJ » (vignettes à
//   glisser, fiche d'édition : nom, look, rôle, étal, dialogues à mots-clés) ;
// — la palette (palette.js) fournit la tuile ou le décor à poser.
import { generateWorld, TILE, defaultNpcSpots, SPAWN_ZONES } from '../../../shared/worldgen.js';
import { MOBS, ITEMS } from '../../../shared/defs.js';
import { applyOverrides } from '../../../shared/overrides.js';
import { buildDecor } from '../render2d/decor.js';
import { PROP_TYPES, propScale, propFlip } from '../render2d/decormap.js';
import { buildPalette, TILE_COLORS, TILE_NAMES, PROP_GLYPHS } from './palette.js';

// --- réglages du rendu ---
const ZOOM_MAX = 48;       // px/tuile maximum
const SPRITE_ZOOM = 12;    // seuil de zoom au-delà duquel on dessine les vrais sprites
const CHUNK = 16;          // côté d'un chunk de rendu sprite (tuiles)
const FLAT_CHUNK = 32;     // côté d'un chunk d'aplats (tuiles)
const FLAT_RES = 4;        // px/tuile des chunks d'aplats
const ZQ_LEVELS = [12, 16, 24, 32, 48]; // résolutions quantifiées des chunks sprites
const CACHE_MAX = 64;      // chunks gardés en mémoire (éviction LRU)
const GAME_PX = 96;        // px écran par pas de tuile dans le jeu (échelle sprite 1)
// marges des chunks iso (en tuiles) : débord des sprites hauts/larges
const ISO_MX = 2.5, ISO_MT = 6, ISO_MB = 1.5;
const HISTORY_MAX = 100;   // pas d'annulation conservés
const REBUILD_DELAY = 150; // ms après la fin d'un trait avant reconstruction complète

// rayon par défaut d'un camp fraîchement posé (tuiles) et bornes d'édition
const CAMP_DEFAULT_RADIUS = 8;
const CAMP_RADIUS_MIN = 1, CAMP_RADIUS_MAX = 40;

// sous-zones musicales : dimensions minimales (tuiles) et couleur du calque
const MUSIC_MIN_SIZE = 2;        // côté/rayon minimal d'une sous-zone musicale
const MUSIC_DEFAULT_W = 16, MUSIC_DEFAULT_H = 16, MUSIC_DEFAULT_R = 8;
const MUSIC_COLOR = '#c77dff';   // teinte du calque musique (violet)

export async function initMapEditor({ api, zones, npcDefs = {}, spells = [], musicFiles = [] }) {
  const $ = (id) => document.getElementById(id);
  const canvas = $('map-canvas');
  const ctx = canvas.getContext('2d');
  const mini = $('map-mini');
  const mctx = mini.getContext('2d');
  const msg = (t) => { $('map-msg').textContent = t; };
  const W = () => canvas.width, H = () => canvas.height;

  // ---------- état ----------
  let curZone = zones[0]?.id ?? 0;
  let baseWorld = null;   // monde régénéré sans overrides
  let world = null;       // monde avec overrides appliqués
  let decor = null;       // habillage Flare (ids de sol + sprites de décors)
  let ov = emptyOv();
  let tileKeyIndex = new Map(); // "x,z" -> index dans ov.tiles (peinture en O(1))
  let history = [], redoStack = [];
  let pendingTiles = []; // cases peintes pendant le trait, avant reconstruction
  let rebuildTimer = null;
  let dirty = true;      // une frame doit être redessinée
  let mode = 'paint';    // paint | erase | move
  let palTool = { kind: 'tile', tile: TILE.GRASS }; // sélection de la palette
  let brushSize = 1;
  let hover = null;      // position monde sous le curseur (continue)
  let gesture = null;    // geste pointeur en cours (pan / paint / rect / moveProp)
  let spaceHeld = false;
  let livePlayers = [];
  // index des décors pour le rendu : par chunk (iso), triés (vue du dessus), gros sprites
  let chunkProps = new Map(), bigProps = [], propsByZ = [];
  let miniBase = null;   // fond de mini-carte (1 px par tuile)
  // calques d'édition « Camps » (zones de spawn), « PNJ » et « Musique »
  let showCamps = false, showNpcs = false, showMusic = false;
  let pendingPlace = null;            // 'camp' | 'npc' | 'music' : le prochain geste pose l'élément
  let campsList = [], npcsList = [];  // listes effectives (overrides ou défauts du worldgen)
  let musicList = [];                 // sous-zones musicales (overrides `music`)
  const NPC_ROLE_COLORS = { merchant: '#ffd24a', teacher: '#7ad1ff', bavard: '#8ae88a' };
  const NPC_ROLE_NAMES = { merchant: 'marchand', teacher: 'enseignant', bavard: 'bavard' };

  // vue : z = px/tuile ; (cx, cz) = tuile au centre du canvas ; iso = vue jeu
  const view = { z: 4, cx: 64, cz: 64, iso: false };

  function emptyOv() { return { tiles: [], props: { add: [], remove: [] } }; }
  function normalizeOv(o) {
    const n = o && typeof o === 'object' ? o : {};
    const out = {
      tiles: Array.isArray(n.tiles) ? n.tiles : [],
      props: { add: n.props?.add ?? [], remove: n.props?.remove ?? [] },
    };
    // sections optionnelles : ABSENTES, les défauts du worldgen restent en vigueur
    if (Array.isArray(n.camps)) out.camps = n.camps;
    if (n.npcs && typeof n.npcs === 'object') out.npcs = n.npcs;
    if (Array.isArray(n.music)) out.music = n.music; // sous-zones musicales
    return out;
  }

  // ---------- assets Flare (manifest + tilesets) ; en cas d'échec : aplats ----------
  let assets = null;
  try {
    const manifest = await (await fetch('/assets/manifest.json')).json();
    const load = (p) => new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => rej(new Error('image manquante : ' + p));
      img.src = '/assets/' + p;
    });
    const [grass, water] = await Promise.all([
      load('tilesets/tileset_grassland.png'),
      load('tilesets/tileset_grassland_water.png'),
    ]);
    assets = { manifest, grass, water };
  } catch { /* mode dégradé : aplats + glyphes */ }

  // ---------- projections vue du dessus / iso ----------
  function w2s(wx, wz) {
    if (view.iso) {
      return {
        x: ((wx - wz) - (view.cx - view.cz)) * view.z + W() / 2,
        y: ((wx + wz) - (view.cx + view.cz)) * view.z / 2 + H() / 2,
      };
    }
    return { x: (wx - view.cx) * view.z + W() / 2, y: (wz - view.cz) * view.z + H() / 2 };
  }
  function s2w(px, py) {
    if (view.iso) {
      const a = (px - W() / 2) / view.z + (view.cx - view.cz);       // x - z
      const b = (py - H() / 2) / (view.z / 2) + (view.cx + view.cz); // x + z
      return { x: (a + b) / 2, z: (b - a) / 2 };
    }
    return { x: (px - W() / 2) / view.z + view.cx, z: (py - H() / 2) / view.z + view.cz };
  }
  // recentre la vue pour que le point monde (wx, wz) tombe au pixel (px, py)
  function anchorView(wx, wz, px, py) {
    if (view.iso) {
      const a = wx - wz - (px - W() / 2) / view.z;
      const b = wx + wz - (py - H() / 2) / (view.z / 2);
      view.cx = (a + b) / 2; view.cz = (b - a) / 2;
    } else {
      view.cx = wx - (px - W() / 2) / view.z;
      view.cz = wz - (py - H() / 2) / view.z;
    }
    const N = world ? world.size : 128;
    view.cx = Math.min(N + 16, Math.max(-16, view.cx));
    view.cz = Math.min(N + 16, Math.max(-16, view.cz));
  }
  function fitZoom() { return Math.max(1, Math.min(W(), H()) / (world ? world.size : 128)); }
  function mousePos(e) {
    const r = canvas.getBoundingClientRect();
    return {
      px: (e.clientX - r.left) * (canvas.width / (r.width || canvas.width)),
      py: (e.clientY - r.top) * (canvas.height / (r.height || canvas.height)),
    };
  }
  // bornes (en tuiles) de la zone visible, pour le culling
  function visibleTileBounds(margin = 0) {
    const cs = [s2w(0, 0), s2w(W(), 0), s2w(0, H()), s2w(W(), H())];
    const N = world.size;
    return {
      minX: Math.max(0, Math.floor(Math.min(...cs.map(c => c.x))) - margin),
      maxX: Math.min(N, Math.ceil(Math.max(...cs.map(c => c.x))) + margin),
      minZ: Math.max(0, Math.floor(Math.min(...cs.map(c => c.z))) - margin),
      maxZ: Math.min(N, Math.ceil(Math.max(...cs.map(c => c.z))) + margin),
    };
  }

  // ---------- palette ----------
  const palette = buildPalette({
    container: $('map-palette'),
    assets,
    onSelect: (tool) => { palTool = tool; setMode('paint'); },
  });

  // ---------- cache de chunks (LRU) ----------
  const chunkCache = new Map();
  function cachedChunk(key, make) {
    let c = chunkCache.get(key);
    if (c) { chunkCache.delete(key); chunkCache.set(key, c); return c; } // rafraîchit le LRU
    c = make();
    chunkCache.set(key, c);
    if (chunkCache.size > CACHE_MAX) chunkCache.delete(chunkCache.keys().next().value);
    return c;
  }

  // dessine une tuile/un sprite du tileset dans un contexte donné (ancrage px, py)
  function drawTileInto(g, id, px, py, k, flip = false) {
    if (!assets) return;
    let rect = assets.manifest.tiles[id], img = assets.grass;
    if (!rect) { rect = assets.manifest.waterTiles[id]; img = assets.water; }
    if (!rect) return;
    const [x, y, w, h, ox, oy] = rect;
    if (flip) {
      g.save(); g.translate(px, 0); g.scale(-1, 1);
      g.drawImage(img, x, y, w, h, -ox * k, py - oy * k, w * k, h * k);
      g.restore();
    } else {
      g.drawImage(img, x, y, w, h, px - ox * k, py - oy * k, w * k, h * k);
    }
  }

  // chunk d'aplats : couleurs de tuiles à résolution fixe (rapide, faible zoom)
  function renderFlatChunk(cx, cz) {
    const c = document.createElement('canvas');
    c.width = c.height = FLAT_CHUNK * FLAT_RES;
    const g = c.getContext('2d');
    const N = world.size;
    for (let dz = 0; dz < FLAT_CHUNK; dz++) {
      const z = cz * FLAT_CHUNK + dz;
      if (z >= N) break;
      for (let dx = 0; dx < FLAT_CHUNK; dx++) {
        const x = cx * FLAT_CHUNK + dx;
        if (x >= N) break;
        g.fillStyle = TILE_COLORS[world.tile[z * N + x]] || '#f0f';
        g.fillRect(dx * FLAT_RES, dz * FLAT_RES, FLAT_RES, FLAT_RES);
      }
    }
    return c;
  }

  // chunk vue du dessus : cœur des tuiles Flare (rectangle inscrit du losange)
  // étiré dans chaque case — la vraie texture du sol, lisible en orthogonal
  function renderTopChunk(cx, cz, zq) {
    const c = document.createElement('canvas');
    c.width = c.height = CHUNK * zq;
    const g = c.getContext('2d');
    const N = world.size, m = assets.manifest;
    for (let dz = 0; dz < CHUNK; dz++) {
      const z = cz * CHUNK + dz;
      if (z >= N) break;
      for (let dx = 0; dx < CHUNK; dx++) {
        const x = cx * CHUNK + dx;
        if (x >= N) break;
        const id = decor.floor[z * N + x];
        let rect = m.tiles[id], img = assets.grass;
        if (!rect) { rect = m.waterTiles[id]; img = assets.water; }
        if (!rect) {
          g.fillStyle = TILE_COLORS[world.tile[z * N + x]] || '#f0f';
          g.fillRect(dx * zq, dz * zq, zq, zq);
          continue;
        }
        const [sx, sy, w, h] = rect;
        g.drawImage(img, sx + w * 0.25, sy + h * 0.25, w * 0.5, h * 0.5, dx * zq, dz * zq, zq, zq);
      }
    }
    return c;
  }

  // chunk iso : sols en losanges + décors triés en profondeur, comme en jeu
  function renderIsoChunk(cx, cz, zq) {
    const c = document.createElement('canvas');
    c.width = (CHUNK * 2 + ISO_MX * 2) * zq;
    c.height = (CHUNK + ISO_MT + ISO_MB) * zq;
    const g = c.getContext('2d');
    const N = world.size;
    const X0 = cx * CHUNK, Z0 = cz * CHUNK;
    const ox0 = (CHUNK + ISO_MX) * zq, oy0 = ISO_MT * zq;
    const lx = (wx, wz) => ((wx - X0) - (wz - Z0)) * zq + ox0;
    const ly = (wx, wz) => ((wx - X0) + (wz - Z0)) * zq / 2 + oy0;
    const k = zq / GAME_PX;
    // sols, du fond vers l'avant
    for (let sum = 0; sum <= (CHUNK - 1) * 2; sum++) {
      for (let dx = Math.max(0, sum - CHUNK + 1); dx <= Math.min(CHUNK - 1, sum); dx++) {
        const dz = sum - dx;
        const x = X0 + dx, z = Z0 + dz;
        if (x >= N || z >= N) continue;
        drawTileInto(g, decor.floor[z * N + x], lx(x + 0.5, z + 0.5), ly(x + 0.5, z + 0.5), k);
      }
    }
    // décors ancrés dans le chunk (les « gros » sont dessinés par frame, au-dessus)
    for (const p of chunkProps.get(cx + ':' + cz) || []) {
      drawTileInto(g, p.tileId, lx(p.x, p.z), ly(p.x, p.z), k * (p.s || 1), p.flip);
    }
    return c;
  }

  // ---------- passes de rendu ----------
  function drawFlatLayer() {
    const N = world.size, nc = Math.ceil(N / FLAT_CHUNK);
    const k = view.z / FLAT_RES;
    ctx.imageSmoothingEnabled = view.z < FLAT_RES; // lissé en dézoom, net en zoom
    for (let cz = 0; cz < nc; cz++) {
      for (let cx = 0; cx < nc; cx++) {
        const X0 = cx * FLAT_CHUNK, Z0 = cz * FLAT_CHUNK;
        const cs = [w2s(X0, Z0), w2s(X0 + FLAT_CHUNK, Z0), w2s(X0, Z0 + FLAT_CHUNK), w2s(X0 + FLAT_CHUNK, Z0 + FLAT_CHUNK)];
        if (Math.max(...cs.map(p => p.x)) < 0 || Math.min(...cs.map(p => p.x)) > W()
          || Math.max(...cs.map(p => p.y)) < 0 || Math.min(...cs.map(p => p.y)) > H()) continue;
        const c = cachedChunk(`f:${cx}:${cz}`, () => renderFlatChunk(cx, cz));
        const o = w2s(X0, Z0);
        if (view.iso) {
          // les cases carrées du chunk deviennent des losanges via la matrice iso
          ctx.setTransform(k, k / 2, -k, k / 2, o.x, o.y);
          ctx.drawImage(c, 0, 0);
          ctx.setTransform(1, 0, 0, 1, 0, 0);
        } else {
          ctx.drawImage(c, o.x, o.y, c.width * k, c.height * k);
        }
      }
    }
    ctx.imageSmoothingEnabled = true;
  }

  // décors en glyphes colorés (mode aplats)
  function drawGlyphProps() {
    const b = visibleTileBounds(3);
    ctx.font = `${Math.max(7, view.z * 1.2)}px sans-serif`;
    ctx.textAlign = 'center';
    for (const p of world.props) {
      if (p.x < b.minX || p.x > b.maxX || p.z < b.minZ || p.z > b.maxZ) continue;
      const [glyph, color] = PROP_GLYPHS[p.type] || ['?', '#fff'];
      const s = w2s(p.x, p.z);
      ctx.fillStyle = color;
      ctx.fillText(glyph, s.x, s.y + view.z * 0.3);
    }
  }

  function drawTopSprites() {
    const zq = ZQ_LEVELS.find(l => l >= view.z) ?? ZQ_LEVELS[ZQ_LEVELS.length - 1];
    const N = world.size, nc = Math.ceil(N / CHUNK), k = view.z / zq;
    for (let cz = 0; cz < nc; cz++) {
      for (let cx = 0; cx < nc; cx++) {
        const o = w2s(cx * CHUNK, cz * CHUNK);
        const side = CHUNK * view.z;
        if (o.x > W() || o.y > H() || o.x + side < 0 || o.y + side < 0) continue;
        const c = cachedChunk(`t:${zq}:${cx}:${cz}`, () => renderTopChunk(cx, cz, zq));
        ctx.drawImage(c, o.x, o.y, c.width * k, c.height * k);
      }
    }
    // décors : sprites ancrés au sol, triés par profondeur (z croissant)
    const b = visibleTileBounds(0);
    const ks = view.z / GAME_PX;
    for (const p of propsByZ) {
      // marge basse généreuse : un sprite haut ancré sous l'écran y dépasse encore
      if (p.x < b.minX - 5 || p.x > b.maxX + 5 || p.z < b.minZ - 1 || p.z > b.maxZ + 10) continue;
      const s = w2s(p.x, p.z);
      drawTileInto(ctx, p.tileId, s.x, s.y, ks * (p.s || 1), p.flip);
    }
  }

  function drawIsoSprites() {
    const zq = ZQ_LEVELS.find(l => l >= view.z) ?? ZQ_LEVELS[ZQ_LEVELS.length - 1];
    const k = view.z / zq;
    const nc = Math.ceil(world.size / CHUNK);
    const cw = (CHUNK * 2 + ISO_MX * 2) * zq * k, ch = (CHUNK + ISO_MT + ISO_MB) * zq * k;
    const list = [];
    for (let cz = 0; cz < nc; cz++) {
      for (let cx = 0; cx < nc; cx++) {
        const o = w2s(cx * CHUNK, cz * CHUNK);
        const sx = o.x - (CHUNK + ISO_MX) * zq * k, sy = o.y - ISO_MT * zq * k;
        if (sx > W() || sx + cw < 0 || sy > H() || sy + ch < 0) continue;
        list.push({ cx, cz, sx, sy });
      }
    }
    list.sort((a, b) => (a.cx + a.cz) - (b.cx + b.cz)); // du fond vers l'avant
    for (const it of list) {
      const c = cachedChunk(`i:${zq}:${it.cx}:${it.cz}`, () => renderIsoChunk(it.cx, it.cz, zq));
      ctx.drawImage(c, it.sx, it.sy, c.width * k, c.height * k);
    }
    // gros sprites (maisons) par frame : leur débord excéderait les marges de chunk
    const ks = view.z / GAME_PX;
    for (const p of bigProps) {
      const s = w2s(p.x, p.z);
      if (s.x + 6 * view.z < 0 || s.x - 6 * view.z > W() || s.y + 2 * view.z < 0 || s.y - 10 * view.z > H()) continue;
      drawTileInto(ctx, p.tileId, s.x, s.y, ks * (p.s || 1), p.flip);
    }
  }

  function fillCellPath(x0, z0, x1, z1) {
    const p0 = w2s(x0, z0), p1 = w2s(x1, z0), p2 = w2s(x1, z1), p3 = w2s(x0, z1);
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.lineTo(p3.x, p3.y);
    ctx.closePath();
  }

  function drawPendingTiles() {
    for (const [x, z, t] of pendingTiles) {
      fillCellPath(x, z, x + 1, z + 1);
      ctx.fillStyle = TILE_COLORS[t] || '#f0f';
      ctx.fill();
    }
  }

  function drawGrid() {
    if (view.z < 16) return;
    const b = visibleTileBounds(1);
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = b.minX; x <= b.maxX; x++) {
      const a = w2s(x, b.minZ), c = w2s(x, b.maxZ);
      ctx.moveTo(a.x, a.y); ctx.lineTo(c.x, c.y);
    }
    for (let z = b.minZ; z <= b.maxZ; z++) {
      const a = w2s(b.minX, z), c = w2s(b.maxX, z);
      ctx.moveTo(a.x, a.y); ctx.lineTo(c.x, c.y);
    }
    ctx.stroke();
  }

  function strokeRing(wx, wz, r, color) {
    const c = w2s(wx, wz);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (view.iso) ctx.ellipse(c.x, c.y, r, r / 2, 0, 0, Math.PI * 2);
    else ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  // surimpressions de l'outil courant : brosse, rectangle, fantôme, gomme, déplacement
  function drawOverlays() {
    if (!hover) return;
    // tracé d'une zone musicale en cours (glisser) : aperçu du rectangle
    if (gesture?.mode === 'musicDraw') {
      fillCellPath(gesture.x0, gesture.z0, hover.x, hover.z);
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = MUSIC_COLOR;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = MUSIC_COLOR; ctx.lineWidth = 1.5; ctx.stroke();
      return;
    }
    // pose armée (➕ Camp / ➕ PNJ / ➕ Zone musicale) : aperçu sous le curseur
    if (pendingPlace) {
      if (pendingPlace === 'music') strokeRing(hover.x, hover.z, view.z * (MUSIC_DEFAULT_W / 2), MUSIC_COLOR);
      else strokeRing(hover.x, hover.z, view.z * (pendingPlace === 'camp' ? CAMP_DEFAULT_RADIUS : 0.6), '#8ae88a');
      return;
    }
    const tx = Math.floor(hover.x), tz = Math.floor(hover.z);
    if (gesture?.mode === 'rect') {
      const x0 = Math.min(gesture.x0, tx), x1 = Math.max(gesture.x0, tx);
      const z0 = Math.min(gesture.z0, tz), z1 = Math.max(gesture.z0, tz);
      fillCellPath(x0, z0, x1 + 1, z1 + 1);
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = TILE_COLORS[palTool.tile] || '#fff';
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#ffd24a'; ctx.lineWidth = 1.5; ctx.stroke();
      return;
    }
    if (mode === 'erase') { strokeRing(hover.x, hover.z, view.z, '#ff6a6a'); return; }
    if (mode === 'move') {
      const p = gesture?.mode === 'moveProp' ? gesture.prop : pickWorldProp(hover.x, hover.z);
      if (p) {
        const at = gesture?.mode === 'moveProp' ? { x: tx + 0.5, z: tz + 0.5 } : { x: p.x, z: p.z };
        strokeRing(at.x, at.z, view.z * 0.6, '#7ad1ff');
      }
      return;
    }
    if (palTool.kind === 'tile') {
      const half = Math.floor(brushSize / 2);
      fillCellPath(tx - half, tz - half, tx + half + 1, tz + half + 1);
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = TILE_COLORS[palTool.tile] || '#fff';
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#ffd24a'; ctx.lineWidth = 1.5; ctx.stroke();
    } else {
      // fantôme du décor à poser
      const def = PROP_TYPES[palTool.type];
      if (!def) return;
      const id = (palTool.v != null ? def.variants.find(va => va.v === palTool.v)?.id : null) ?? def.variants[0].id;
      const c = w2s(tx + 0.5, tz + 0.5);
      ctx.globalAlpha = 0.65;
      if (assets && view.z >= SPRITE_ZOOM) {
        drawTileInto(ctx, id, c.x, c.y, (view.z / GAME_PX) * (palTool.s || 1), palTool.flip);
      } else {
        const [glyph, color] = PROP_GLYPHS[palTool.type] || ['?', '#fff'];
        ctx.font = `${Math.max(10, view.z * 1.2)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillStyle = color;
        ctx.fillText(glyph, c.x, c.y + view.z * 0.3);
      }
      ctx.globalAlpha = 1;
      fillCellPath(tx, tz, tx + 1, tz + 1);
      ctx.strokeStyle = '#ffd24a'; ctx.lineWidth = 1.5; ctx.stroke();
    }
  }

  function drawPlayers() {
    if (!$('show-players').checked) return;
    const showNames = $('show-player-names').checked;
    const r = Math.max(3, view.z * 0.35);
    for (const p of livePlayers) {
      if (p.zoneId !== curZone || p.trial) continue; // l'Épreuve est une carte instanciée à part
      const s = w2s(p.x, p.z);
      ctx.beginPath();
      ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
      ctx.fillStyle = p.admin ? '#ffd34d' : '#4dff6a';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#10202a';
      ctx.stroke();
      if (showNames) {
        ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'center';
        const label = `${p.name} (${p.level})`;
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,0,0,0.85)';
        ctx.strokeText(label, s.x, s.y - r - 4);
        ctx.fillStyle = '#fff';
        ctx.fillText(label, s.x, s.y - r - 4);
      }
    }
  }

  function drawCompass() {
    // boussole : le nord de la grille part vers le haut-droite, comme en jeu
    ctx.font = 'bold 14px sans-serif';
    ctx.fillStyle = '#ffd34d';
    ctx.textAlign = 'left';
    ctx.fillText('N ↗', 10, 20);
  }

  // ---------- calques d'édition : camps de spawn et PNJ ----------
  // couleur stable par monstre (le cercle d'un camp prend celle du dominant)
  const mobColorCache = {};
  function mobColor(defId) {
    if (!mobColorCache[defId]) {
      let hash = 0;
      for (const ch of String(defId)) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
      mobColorCache[defId] = `hsl(${hash % 360}, 75%, 62%)`;
    }
    return mobColorCache[defId];
  }
  const isWalkableBase = (x, z) => {
    const N = baseWorld.size, X = Math.floor(x), Z = Math.floor(z);
    return X >= 0 && Z >= 0 && X < N && Z < N && baseWorld.walk[Z * N + X] === 1;
  };

  // camps par défaut du worldgen, au format des overrides {id, x, z, r, mobs}
  function defaultCamps() {
    return (baseWorld.spawnZones || SPAWN_ZONES).map((s, i) => ({
      id: `defaut-${i}`,
      x: s.center[0] + 0.5, z: s.center[1] + 0.5, r: s.radius,
      mobs: { [s.mob]: s.count },
    }));
  }
  // première retouche : matérialise les camps par défaut dans les overrides
  // (déplacer ou supprimer un camp ne doit pas effacer les autres)
  function materializeCamps() {
    if (!Array.isArray(ov.camps)) ov.camps = defaultCamps().map(c => ({ ...c, mobs: { ...c.mobs } }));
    return ov.camps;
  }
  function npcsOv() {
    if (!ov.npcs || typeof ov.npcs !== 'object') ov.npcs = {};
    ov.npcs.add ??= []; ov.npcs.remove ??= []; ov.npcs.move ??= []; ov.npcs.edit ??= {};
    return ov.npcs;
  }
  const npcRole = (def) => def.role || (def.teacher ? 'teacher' : 'merchant');

  // PNJ effectifs : défauts du worldgen (retirés/déplacés/édités) + ajouts
  function effectiveNpcs() {
    const o = ov.npcs || {};
    const removed = new Set(o.remove || []);
    const moved = new Map((o.move || []).map(m => [m.npcId, m]));
    const out = [];
    for (const spot of defaultNpcSpots(baseWorld, isWalkableBase)) {
      if (removed.has(spot.npcId)) continue;
      const base = npcDefs[spot.npcId] || npcDefs.merchant || { name: spot.npcId };
      const at = moved.get(spot.npcId) || spot;
      out.push({ npcId: spot.npcId, custom: false, def: { ...base, ...(o.edit?.[spot.npcId] || {}) }, x: at.x, z: at.z });
    }
    for (const a of o.add || []) out.push({ npcId: a.id, custom: true, def: a, x: a.x, z: a.z });
    return out;
  }
  function refreshEditLayers() {
    campsList = Array.isArray(ov.camps) ? ov.camps : defaultCamps();
    npcsList = effectiveNpcs();
    musicList = Array.isArray(ov.music) ? ov.music : [];
    markDirty();
  }

  // ---------- calque « Musique » : sous-zones musicales dessinées ----------
  // Une sous-zone = forme (rect/cercle) + piste { legacy, new } + priorité.
  // Format de stockage dans ov.music : { id, shape, x, z, w, h | r, track, priority }.
  function musicOv() {
    if (!Array.isArray(ov.music)) ov.music = [];
    return ov.music;
  }
  function musicLabel(m) {
    const f = m.track?.new || m.track?.legacy;
    const name = f ? f.replace(/\.(mp3|ogg)$/i, '') : '(silence)';
    return m.priority ? `${name} [${m.priority}]` : name;
  }
  // pose une sous-zone musicale (rectangle ou cercle) et ouvre sa fiche
  function placeMusicZone(shape, geom) {
    pendingPlace = null;
    pushHistory();
    const list = musicOv();
    const base = {
      id: 'music_' + Date.now().toString(36),
      shape,
      track: musicFiles[0] ? { legacy: null, new: musicFiles[0] } : { legacy: null, new: null },
      priority: 0,
    };
    list.push(shape === 'circle'
      ? { ...base, x: geom.x, z: geom.z, r: geom.r }
      : { ...base, x: geom.x, z: geom.z, w: geom.w, h: geom.h });
    refreshEditLayers();
    openMusicPanel(list.length - 1);
  }
  function placeMusicRect(x0, z0, x1, z1) {
    const x = Math.min(x0, x1), z = Math.min(z0, z1);
    const w = Math.max(MUSIC_MIN_SIZE, Math.abs(x1 - x0));
    const h = Math.max(MUSIC_MIN_SIZE, Math.abs(z1 - z0));
    placeMusicZone('rect', { x, z, w, h });
  }
  function placeMusicCircle(cx, cz, r) {
    placeMusicZone('circle', { x: cx, z: cz, r: Math.max(MUSIC_MIN_SIZE, r) });
  }
  // centre géométrique d'une sous-zone (poignée de déplacement)
  function musicCenter(m) {
    return m.shape === 'circle' ? { x: m.x, z: m.z } : { x: m.x + m.w / 2, z: m.z + m.h / 2 };
  }
  // sélection au pointeur : bord (redimensionnement) ou intérieur (déplacement/fiche)
  function pickMusic(wx, wz) {
    const tol = Math.max(0.8, 8 / view.z);
    // bords d'abord (redimensionnement) — du dessus vers le dessous
    for (let i = musicList.length - 1; i >= 0; i--) {
      const m = musicList[i];
      if (m.shape === 'circle') {
        if (Math.abs(Math.hypot(wx - m.x, wz - m.z) - m.r) <= tol) return { index: i, kind: 'edge' };
      } else {
        // proche du coin bas-droit -> redimensionnement
        if (Math.hypot(wx - (m.x + m.w), wz - (m.z + m.h)) <= tol * 1.5) return { index: i, kind: 'edge' };
      }
    }
    // intérieur (déplacement / ouverture de fiche)
    for (let i = musicList.length - 1; i >= 0; i--) {
      const m = musicList[i];
      const inside = m.shape === 'circle'
        ? Math.hypot(wx - m.x, wz - m.z) <= m.r
        : (wx >= m.x && wx <= m.x + m.w && wz >= m.z && wz <= m.z + m.h);
      if (inside) return { index: i, kind: 'center' };
    }
    return null;
  }
  // glisser : déplacement (centre) ou redimensionnement (bord)
  function dragMusic(g) {
    if (!g.moved && Math.hypot(hover.x - g.w0.x, hover.z - g.w0.z) < 0.35) return;
    if (!g.pushed) { pushHistory(); g.pushed = true; }
    g.moved = true;
    const snap = (v) => Math.round(v * 2) / 2;
    const m = musicOv()[g.index];
    if (!m) return;
    if (g.kind === 'center') {
      const c = musicCenter(m);
      const dx = snap(hover.x) - c.x, dz = snap(hover.z) - c.z;
      if (m.shape === 'circle') { m.x += dx; m.z += dz; }
      else { m.x = snap(m.x + dx); m.z = snap(m.z + dz); }
    } else if (m.shape === 'circle') {
      m.r = Math.max(MUSIC_MIN_SIZE, snap(Math.hypot(hover.x - m.x, hover.z - m.z)));
    } else {
      m.w = Math.max(MUSIC_MIN_SIZE, snap(hover.x - m.x));
      m.h = Math.max(MUSIC_MIN_SIZE, snap(hover.z - m.z));
    }
    refreshEditLayers();
  }

  function campLabel(c) {
    const parts = Object.entries(c.mobs || {}).map(([d, n]) => `${n}× ${MOBS[d]?.name || d}`);
    return parts.join(', ') || '(vide)';
  }
  function dominantMob(c) {
    let best = null, bn = -1;
    for (const [d, n] of Object.entries(c.mobs || {})) if (n > bn) { bn = n; best = d; }
    return best;
  }
  function labelText(x, y, label, color = '#fff') {
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeText(label, x, y);
    ctx.fillStyle = color;
    ctx.fillText(label, x, y);
  }
  function drawCamps() {
    if (!showCamps) return;
    for (const c of campsList) {
      const color = mobColor(dominantMob(c) || '?');
      const s = w2s(c.x, c.z);
      const r = c.r * view.z;
      ctx.beginPath();
      if (view.iso) ctx.ellipse(s.x, s.y, r, r / 2, 0, 0, Math.PI * 2);
      else ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = color;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.lineWidth = 2;
      ctx.strokeStyle = color;
      ctx.stroke();
      // poignée centrale (déplacement) + étiquette de composition
      ctx.beginPath();
      ctx.arc(s.x, s.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      labelText(s.x, s.y - (view.iso ? r / 2 : r) - 6, campLabel(c), color);
    }
  }
  function drawNpcs() {
    if (!showNpcs) return;
    const r = Math.max(5, view.z * 0.4);
    for (const n of npcsList) {
      const s = w2s(n.x, n.z);
      const color = NPC_ROLE_COLORS[npcRole(n.def)] || '#fff';
      ctx.beginPath();
      ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#10202a';
      ctx.stroke();
      ctx.font = `${Math.max(9, r * 1.2)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#10202a';
      ctx.fillText('☻', s.x, s.y + r * 0.45);
      labelText(s.x, s.y - r - 5, n.def.name || n.npcId, color);
    }
  }
  // sous-zones musicales : forme semi-transparente colorée + étiquette (fichier)
  function drawMusic() {
    if (!showMusic) return;
    for (const m of musicList) {
      ctx.fillStyle = MUSIC_COLOR;
      ctx.strokeStyle = MUSIC_COLOR;
      ctx.lineWidth = 2;
      if (m.shape === 'circle') {
        const s = w2s(m.x, m.z), r = m.r * view.z;
        ctx.beginPath();
        if (view.iso) ctx.ellipse(s.x, s.y, r, r / 2, 0, 0, Math.PI * 2);
        else ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
        ctx.globalAlpha = 0.16; ctx.fill();
        ctx.globalAlpha = 1; ctx.stroke();
        // poignée de bord (redimensionnement)
        const e = w2s(m.x + m.r, m.z);
        ctx.beginPath(); ctx.arc(e.x, e.y, 4, 0, Math.PI * 2); ctx.fill();
      } else {
        fillCellPath(m.x, m.z, m.x + m.w, m.z + m.h);
        ctx.globalAlpha = 0.16; ctx.fill();
        ctx.globalAlpha = 1; ctx.stroke();
        // poignée de coin bas-droit (redimensionnement)
        const e = w2s(m.x + m.w, m.z + m.h);
        ctx.beginPath(); ctx.arc(e.x, e.y, 4, 0, Math.PI * 2); ctx.fill();
      }
      // poignée centrale (déplacement) + étiquette
      const c = musicCenter(m), cs = w2s(c.x, c.z);
      ctx.beginPath(); ctx.arc(cs.x, cs.y, 4, 0, Math.PI * 2); ctx.fill();
      labelText(cs.x, cs.y - 8, musicLabel(m), MUSIC_COLOR);
    }
  }

  // sélection au pointeur : PNJ (cible ponctuelle), camp par le bord (rayon)
  // ou par l'intérieur (déplacement / fiche)
  function pickNpc(wx, wz) {
    let best = null, bd = Math.max(1.2, 10 / view.z);
    npcsList.forEach((n, index) => {
      const d = Math.hypot(n.x - wx, n.z - wz);
      if (d < bd) { bd = d; best = { npc: n, index }; }
    });
    return best;
  }
  function pickCamp(wx, wz) {
    const tol = Math.max(0.8, 8 / view.z);
    for (let i = campsList.length - 1; i >= 0; i--) {
      const c = campsList[i];
      if (Math.abs(Math.hypot(c.x - wx, c.z - wz) - c.r) <= tol) return { index: i, kind: 'edge' };
    }
    for (let i = campsList.length - 1; i >= 0; i--) {
      const c = campsList[i];
      if (Math.hypot(c.x - wx, c.z - wz) <= c.r) return { index: i, kind: 'center' };
    }
    return null;
  }

  function placeCampAt(tx, tz) {
    pendingPlace = null;
    pushHistory();
    const camps = materializeCamps();
    camps.push({
      id: 'camp_' + Date.now().toString(36),
      x: tx + 0.5, z: tz + 0.5, r: CAMP_DEFAULT_RADIUS,
      mobs: { rat: 3 },
    });
    refreshEditLayers();
    openCampPanel(camps.length - 1);
  }
  function placeNpcAt(tx, tz) {
    pendingPlace = null;
    pushHistory();
    npcsOv().add.push({
      id: 'pnj_' + Date.now().toString(36),
      x: tx + 0.5, z: tz + 0.5,
      name: 'Nouveau PNJ', role: 'bavard',
      look: structuredClone(npcDefs.merchant?.look ?? null),
      greetings: ['Bien le bonjour.'],
      dialogues: [],
    });
    refreshEditLayers();
    openNpcPanel(npcsList.length - 1);
  }
  // déplacement d'un PNJ : un ajout est déplacé sur place, un PNJ par défaut
  // reçoit (ou met à jour) une entrée `move` des overrides
  function moveNpcTo(index, x, z) {
    const n = npcsList[index];
    if (!n) return;
    if (n.custom) {
      const a = npcsOv().add.find(e => e.id === n.npcId);
      if (a) { a.x = x; a.z = z; }
    } else {
      const o = npcsOv();
      let mv = o.move.find(m => m.npcId === n.npcId);
      if (!mv) o.move.push(mv = { npcId: n.npcId, x, z });
      mv.x = x; mv.z = z;
    }
  }
  // glisser en cours sur un camp (centre/bord) ou un PNJ ; un simple clic
  // (sans mouvement) ouvre la fiche au relâchement (cf. pointerup)
  function dragEditLayer(g) {
    if (!g.moved && Math.hypot(hover.x - g.w0.x, hover.z - g.w0.z) < 0.35) return;
    if (!g.pushed) {
      pushHistory();
      if (g.mode !== 'npcMove') materializeCamps();
      g.pushed = true;
    }
    g.moved = true;
    const snap = (v) => Math.round(v * 2) / 2; // pose à la demi-tuile
    if (g.mode === 'npcMove') {
      moveNpcTo(g.index, snap(hover.x), snap(hover.z));
    } else {
      const c = ov.camps[g.index];
      if (!c) return;
      if (g.mode === 'campMove') { c.x = snap(hover.x); c.z = snap(hover.z); }
      else c.r = Math.max(CAMP_RADIUS_MIN, Math.min(CAMP_RADIUS_MAX, snap(Math.hypot(hover.x - c.x, hover.z - c.z))));
    }
    refreshEditLayers();
  }

  // ---------- panneaux d'édition (fiche camp / fiche PNJ) ----------
  const panelEl = $('edit-panel');
  function closePanel() { panelEl.style.display = 'none'; panelEl.innerHTML = ''; markDirty(); }
  // petit constructeur de DOM : h('tag', props, ...enfants)
  function h(tag, props = {}, ...kids) {
    const e = document.createElement(tag);
    const { style, ...rest } = props;
    Object.assign(e, rest);
    if (style) Object.assign(e.style, style);
    for (const k of kids) if (k != null) e.append(k);
    return e;
  }
  function panelTitle(text) {
    return h('div', { className: 'edit-panel-title' },
      h('b', { textContent: text }),
      h('button', { textContent: '✕', onclick: closePanel }));
  }

  // fiche d'un camp : composition (monstre × quantité), rayon, suppression
  function openCampPanel(index) {
    const camp = campsList[index];
    if (!camp) return;
    closePanel();
    const mobs = Object.entries(camp.mobs || {}); // état de travail [defId, n]
    const mobOptions = (sel) => Object.entries(MOBS)
      .map(([id, d]) => `<option value="${id}"${id === sel ? ' selected' : ''}>${d.name}</option>`).join('');
    const rows = h('div');
    const renderRows = () => {
      rows.innerHTML = '';
      mobs.forEach((m, i) => {
        const sel = h('select', { innerHTML: mobOptions(m[0]) });
        sel.onchange = () => { m[0] = sel.value; };
        const num = h('input', { type: 'number', min: '1', max: '50', value: String(m[1]), style: { width: '54px' } });
        num.onchange = () => { m[1] = Math.max(1, num.value | 0); };
        rows.append(h('div', { className: 'edit-row' }, sel, num,
          h('button', { textContent: '✕', onclick: () => { mobs.splice(i, 1); renderRows(); } })));
      });
    };
    renderRows();
    const rInput = h('input', { type: 'number', min: String(CAMP_RADIUS_MIN), max: String(CAMP_RADIUS_MAX), value: String(camp.r), style: { width: '60px' } });
    panelEl.append(
      panelTitle('Camp de monstres'),
      h('div', { className: 'hint', textContent: 'Glissez le centre pour déplacer le camp, son bord pour le redimensionner.' }),
      rows,
      h('button', { textContent: '+ monstre', onclick: () => { mobs.push(['rat', 1]); renderRows(); } }),
      h('div', { className: 'edit-row' }, 'Rayon : ', rInput),
      h('div', { className: 'edit-row' },
        h('button', {
          textContent: 'Appliquer',
          onclick: () => {
            pushHistory();
            const real = materializeCamps()[index];
            if (!real) return;
            real.r = Math.max(CAMP_RADIUS_MIN, Math.min(CAMP_RADIUS_MAX, rInput.value | 0 || CAMP_RADIUS_MIN));
            real.mobs = Object.fromEntries(mobs.filter(([d, n]) => MOBS[d] && n > 0));
            refreshEditLayers();
            closePanel();
            msg('✔ Camp modifié — « Enregistrer » pour l\'appliquer au serveur.');
          },
        }),
        h('button', {
          textContent: 'Supprimer', className: 'danger',
          onclick: () => {
            pushHistory();
            materializeCamps().splice(index, 1);
            refreshEditLayers();
            closePanel();
          },
        })),
    );
    panelEl.style.display = 'block';
  }

  // fiche d'un PNJ : identité, look, rôle, étal/répertoire, phrases, dialogues
  function openNpcPanel(index) {
    const n = npcsList[index];
    if (!n) return;
    closePanel();
    const def = n.def;
    const nameInput = h('input', { value: def.name || '', style: { width: '100%' } });
    // look : repris d'un des PNJ existants (zones.json)
    const curLook = JSON.stringify(def.look ?? null);
    const lookSel = h('select', {
      innerHTML: Object.keys(npcDefs).map(k =>
        `<option value="${k}"${JSON.stringify(npcDefs[k].look ?? null) === curLook ? ' selected' : ''}>${npcDefs[k].name}</option>`).join(''),
    });
    const roleSel = h('select', {
      innerHTML: ['merchant', 'teacher', 'bavard'].map(r =>
        `<option value="${r}"${r === npcRole(def) ? ' selected' : ''}>${NPC_ROLE_NAMES[r]}</option>`).join(''),
    });
    // sorts enseignés (rôle enseignant) — vide : répertoire `vendor` historique
    const teaches = new Set(Array.isArray(def.teaches) ? def.teaches : []);
    const teachesBox = h('div', { className: 'edit-list' });
    for (const sp of spells) {
      const cb = h('input', { type: 'checkbox', checked: teaches.has(sp.id) });
      cb.onchange = () => { cb.checked ? teaches.add(sp.id) : teaches.delete(sp.id); };
      teachesBox.append(h('label', { className: 'edit-check' }, cb, ` ${sp.name}`));
    }
    // objets vendus (rôle marchand) — vide : étal standard de la zone
    const sells = new Set(Array.isArray(def.sells) ? def.sells : []);
    const sellSearch = h('input', { placeholder: '🔍 filtrer les objets', style: { width: '100%' } });
    const sellBox = h('div', { className: 'edit-list' });
    const itemDefs = Object.entries(ITEMS).filter(([, d]) => d.slot !== 'gold' && !d.legacy);
    const renderSells = () => {
      const q = sellSearch.value.trim().toLowerCase();
      sellBox.innerHTML = '';
      for (const [id, d] of itemDefs) {
        if (q && !(`${id} ${d.name}`.toLowerCase().includes(q)) && !sells.has(id)) continue;
        const cb = h('input', { type: 'checkbox', checked: sells.has(id) });
        cb.onchange = () => { cb.checked ? sells.add(id) : sells.delete(id); };
        sellBox.append(h('label', { className: 'edit-check' }, cb, ` ${d.name}`));
      }
    };
    sellSearch.oninput = renderSells;
    renderSells();
    const teachesWrap = h('div', {}, h('h4', { textContent: 'Sorts enseignés (vide : répertoire attitré)' }), teachesBox);
    const sellsWrap = h('div', {}, h('h4', { textContent: 'Objets vendus (vide : étal standard de la zone)' }), sellSearch, sellBox);
    const syncRole = () => {
      teachesWrap.style.display = roleSel.value === 'teacher' ? '' : 'none';
      sellsWrap.style.display = roleSel.value === 'merchant' ? '' : 'none';
    };
    roleSel.onchange = syncRole;
    syncRole();
    // phrases d'ambiance (chat local au salut) : une par ligne
    const greetArea = h('textarea', {
      value: (def.greetings || []).join('\n'),
      style: { width: '100%', height: '54px' },
    });
    // dialogues à mots-clés (cf. server/game/dialogues.js pour le format)
    const dialogues = structuredClone(Array.isArray(def.dialogues) ? def.dialogues : []);
    const dlgBox = h('div');
    const jsonField = (dlg, key, placeholder) => {
      const input = h('input', { value: dlg[key] ? JSON.stringify(dlg[key]) : '', placeholder, style: { width: '100%' } });
      input.onchange = () => {
        try {
          dlg[key] = input.value.trim() ? JSON.parse(input.value) : undefined;
          input.style.borderColor = '';
        } catch { input.style.borderColor = '#e86a6a'; }
      };
      return input;
    };
    const renderDialogues = () => {
      dlgBox.innerHTML = '';
      dialogues.forEach((dlg, i) => {
        const kw = h('input', { value: (dlg.keywords || []).join(', '), placeholder: 'mots-clés (séparés par des virgules)', style: { width: '100%' } });
        kw.onchange = () => { dlg.keywords = kw.value.split(',').map(s => s.trim()).filter(Boolean); };
        const rep = h('textarea', { value: dlg.reponse || '', placeholder: 'réponse du PNJ', style: { width: '100%', height: '36px' } });
        rep.onchange = () => { dlg.reponse = rep.value; };
        const rpt = h('input', { type: 'checkbox', checked: dlg.repeatable === true });
        rpt.onchange = () => { dlg.repeatable = rpt.checked || undefined; };
        dlgBox.append(h('div', { className: 'edit-dlg' },
          h('div', { className: 'edit-row' }, h('b', { textContent: `Dialogue ${i + 1}` }),
            h('button', { textContent: '✕', onclick: () => { dialogues.splice(i, 1); renderDialogues(); } })),
          kw, rep,
          jsonField(dlg, 'conditions', 'conditions JSON — ex {"flag":"clef"} {"item":"potion_vie","consume":true}'),
          jsonField(dlg, 'reactions', 'réactions JSON — ex [{"type":"gold","amount":50},{"type":"flag","key":"clef"}]'),
          h('label', { className: 'edit-check' }, rpt, ' récompenses répétables')));
      });
    };
    renderDialogues();
    panelEl.append(
      panelTitle(`PNJ — ${def.name || n.npcId}`),
      h('div', { className: 'hint', textContent: 'Glissez la vignette sur la carte pour déplacer le PNJ.' }),
      h('div', { className: 'edit-row' }, 'Nom : ', nameInput),
      h('div', { className: 'edit-row' }, 'Look : ', lookSel),
      h('div', { className: 'edit-row' }, 'Rôle : ', roleSel),
      teachesWrap, sellsWrap,
      h('h4', { textContent: 'Phrases d\'ambiance (une par ligne)' }), greetArea,
      h('h4', { textContent: 'Dialogues à mots-clés' }), dlgBox,
      h('button', { textContent: '+ dialogue', onclick: () => { dialogues.push({ keywords: [], reponse: '' }); renderDialogues(); } }),
      h('div', { className: 'edit-row' },
        h('button', {
          textContent: 'Appliquer',
          onclick: () => {
            pushHistory();
            const patch = {
              name: nameInput.value.trim() || def.name || n.npcId,
              look: structuredClone(npcDefs[lookSel.value]?.look ?? null),
              role: roleSel.value,
              greetings: greetArea.value.split('\n').map(s => s.trim()).filter(Boolean),
              dialogues,
            };
            if (roleSel.value === 'teacher' && teaches.size) patch.teaches = [...teaches];
            if (roleSel.value === 'merchant' && sells.size) patch.sells = [...sells];
            if (n.custom) {
              const a = npcsOv().add.find(e => e.id === n.npcId);
              if (a) Object.assign(a, patch);
            } else {
              npcsOv().edit[n.npcId] = patch;
            }
            refreshEditLayers();
            closePanel();
            msg('✔ PNJ modifié — « Enregistrer » pour l\'appliquer au serveur.');
          },
        }),
        h('button', {
          textContent: 'Supprimer', className: 'danger',
          onclick: () => {
            pushHistory();
            const o = npcsOv();
            if (n.custom) o.add = o.add.filter(e => e.id !== n.npcId);
            else {
              if (!o.remove.includes(n.npcId)) o.remove.push(n.npcId);
              o.move = o.move.filter(m => m.npcId !== n.npcId);
              delete o.edit[n.npcId];
            }
            refreshEditLayers();
            closePanel();
          },
        })),
    );
    panelEl.style.display = 'block';
  }

  // fiche d'une sous-zone musicale : forme, piste (new/legacy + pré-écoute),
  // priorité, suppression
  function openMusicPanel(index) {
    const m = musicList[index];
    if (!m) return;
    closePanel();
    const track = { legacy: m.track?.legacy || null, new: m.track?.new || null };
    // sélecteur d'un fichier (variante) + bouton de pré-écoute
    const fileRow = (variant, label) => {
      const sel = h('select', { style: { width: '170px' } });
      sel.innerHTML = '<option value="">— silence —</option>' +
        musicFiles.map(f => `<option value="${f}"${track[variant] === f ? ' selected' : ''}>${f}</option>`).join('');
      sel.onchange = () => { track[variant] = sel.value || null; };
      const play = h('button', {
        textContent: '▶', title: 'Pré-écouter',
        onclick: () => {
          if (!sel.value) return;
          const a = document.getElementById('music-preview');
          if (a) { a.src = `/assets/music/${encodeURIComponent(sel.value)}`; a.play?.(); }
        },
      });
      return h('div', { className: 'edit-row' }, label, sel, play);
    };
    const shapeSel = h('select', {
      innerHTML: ['rect', 'circle'].map(s =>
        `<option value="${s}"${s === m.shape ? ' selected' : ''}>${s === 'rect' ? 'Rectangle' : 'Cercle'}</option>`).join(''),
    });
    const prioInput = h('input', { type: 'number', value: String(m.priority || 0), style: { width: '60px' } });
    // dimensions numériques (en tuiles) : rayon pour un cercle, largeur×hauteur
    // pour un rectangle — alternative précise au redimensionnement à la souris
    const num = (val) => h('input', { type: 'number', min: String(MUSIC_MIN_SIZE), step: '1', value: String(Math.round(val)), style: { width: '60px' } });
    const rInput = num(m.r || MUSIC_DEFAULT_R);
    const wInput = num(m.w || MUSIC_DEFAULT_W);
    const hInput = num(m.h || MUSIC_DEFAULT_H);
    const sizeCircle = h('div', { className: 'edit-row' }, 'Rayon : ', rInput, ' tuiles');
    const sizeRect = h('div', { className: 'edit-row' }, 'Largeur : ', wInput, ' Hauteur : ', hInput);
    const refreshSizeRows = () => {
      sizeCircle.style.display = shapeSel.value === 'circle' ? '' : 'none';
      sizeRect.style.display = shapeSel.value === 'rect' ? '' : 'none';
    };
    refreshSizeRows();
    shapeSel.addEventListener('change', refreshSizeRows);
    panelEl.append(
      panelTitle('Zone musicale'),
      h('div', { className: 'hint', textContent: 'Réglez les dimensions ci-dessous, ou glissez le centre pour déplacer et le bord (ou le coin) pour redimensionner.' }),
      h('div', { className: 'edit-row' }, 'Forme : ', shapeSel),
      sizeCircle, sizeRect,
      fileRow('new', 'Nouvelle : '),
      fileRow('legacy', 'Ancienne (legacy) : '),
      h('div', { className: 'edit-row' }, 'Priorité (chevauchements) : ', prioInput),
      h('div', { className: 'edit-row' },
        h('button', {
          textContent: 'Appliquer',
          onclick: () => {
            pushHistory();
            const real = musicOv()[index];
            if (!real) return;
            const c = musicCenter(real); // centre conservé quels que soient forme/taille
            const clamp = (v) => Math.max(MUSIC_MIN_SIZE, Math.round(Number(v) || 0));
            if (shapeSel.value === 'circle') {
              real.shape = 'circle';
              real.r = clamp(rInput.value);
              real.x = c.x; real.z = c.z;            // centre du cercle
              delete real.w; delete real.h;
            } else {
              real.shape = 'rect';
              real.w = clamp(wInput.value); real.h = clamp(hInput.value);
              real.x = c.x - real.w / 2; real.z = c.z - real.h / 2; // recentré
              delete real.r;
            }
            real.track = { legacy: track.legacy, new: track.new };
            real.priority = prioInput.value | 0;
            refreshEditLayers();
            closePanel();
            msg('✔ Zone musicale modifiée — « Enregistrer » pour l\'appliquer au serveur.');
          },
        }),
        h('button', {
          textContent: 'Supprimer', className: 'danger',
          onclick: () => {
            pushHistory();
            musicOv().splice(index, 1);
            refreshEditLayers();
            closePanel();
          },
        })),
    );
    panelEl.style.display = 'block';
  }

  // ---------- mini-carte ----------
  const TILE_RGB = {};
  for (const [t, hex] of Object.entries(TILE_COLORS)) {
    TILE_RGB[t] = [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
  }
  function renderMiniBase() {
    const N = world.size;
    miniBase = document.createElement('canvas');
    miniBase.width = miniBase.height = N;
    const g = miniBase.getContext('2d');
    const img = g.createImageData(N, N);
    for (let i = 0; i < N * N; i++) {
      const [r, gr, b] = TILE_RGB[world.tile[i]] || [255, 0, 255];
      img.data[i * 4] = r; img.data[i * 4 + 1] = gr; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }
  function drawMini() {
    mctx.fillStyle = '#000';
    mctx.fillRect(0, 0, mini.width, mini.height);
    if (miniBase) {
      mctx.imageSmoothingEnabled = false;
      mctx.drawImage(miniBase, 0, 0, mini.width, mini.height);
    }
    // emprise de la vue : projection inverse des 4 coins du canvas
    const k = mini.width / world.size;
    const cs = [s2w(0, 0), s2w(W(), 0), s2w(W(), H()), s2w(0, H())];
    mctx.strokeStyle = '#ffd24a';
    mctx.lineWidth = 1.5;
    mctx.beginPath();
    cs.forEach((c, i) => mctx[i ? 'lineTo' : 'moveTo'](c.x * k, c.z * k));
    mctx.closePath();
    mctx.stroke();
  }
  let miniDrag = false;
  function miniJump(e) {
    const r = mini.getBoundingClientRect();
    view.cx = (e.clientX - r.left) * (world.size / (r.width || mini.width));
    view.cz = (e.clientY - r.top) * (world.size / (r.height || mini.height));
    markDirty();
  }
  mini.addEventListener('pointerdown', (e) => { miniDrag = true; miniJump(e); e.preventDefault?.(); });
  mini.addEventListener('pointermove', (e) => { if (miniDrag) miniJump(e); });

  // ---------- frame ----------
  function markDirty() { dirty = true; }
  function draw() {
    if (!world) return;
    const sprites = assets && decor && view.z >= SPRITE_ZOOM;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0a0814';
    ctx.fillRect(0, 0, W(), H());
    if (!sprites) drawFlatLayer();
    else if (view.iso) drawIsoSprites();
    else drawTopSprites();
    drawPendingTiles();
    if (!sprites) drawGlyphProps();
    drawGrid();
    drawOverlays();
    drawCamps();
    drawNpcs();
    drawMusic();
    drawPlayers();
    if (view.iso) drawCompass();
    drawMini();
  }
  (function loop() {
    if (dirty) {
      dirty = false;
      try { draw(); } catch (e) { console.error('éditeur :', e); }
    }
    requestAnimationFrame(loop);
  })();

  // ---------- édition ----------
  function pushHistory() {
    history.push(JSON.stringify(ov));
    if (history.length > HISTORY_MAX) history.shift();
    redoStack = [];
  }
  function undo() {
    if (!history.length) return;
    redoStack.push(JSON.stringify(ov));
    ov = JSON.parse(history.pop());
    rebuildTileIndex();
    closePanel(); // la fiche ouverte pourrait viser un élément disparu
    rebuild();
  }
  function redo() {
    if (!redoStack.length) return;
    history.push(JSON.stringify(ov));
    ov = JSON.parse(redoStack.pop());
    rebuildTileIndex();
    closePanel();
    rebuild();
  }

  function rebuildTileIndex() {
    tileKeyIndex = new Map();
    ov.tiles.forEach(([x, z], i) => tileKeyIndex.set(x + ',' + z, i));
  }
  function setTile(x, z, t) {
    const key = x + ',' + z;
    const i = tileKeyIndex.get(key);
    if (i != null) ov.tiles[i] = [x, z, t];
    else { tileKeyIndex.set(key, ov.tiles.length); ov.tiles.push([x, z, t]); }
  }
  function paintCells(cx, cz) {
    const N = world.size, half = Math.floor(brushSize / 2);
    for (let dz = -half; dz <= half; dz++) {
      for (let dx = -half; dx <= half; dx++) {
        const x = cx + dx, z = cz + dz;
        if (x < 0 || z < 0 || x >= N || z >= N) continue;
        setTile(x, z, palTool.tile);
        pendingTiles.push([x, z, palTool.tile]);
      }
    }
    scheduleRebuild();
    markDirty();
  }
  function addPropAt(x, z) {
    const e = { type: palTool.type, x, z };
    if (palTool.v != null) e.v = palTool.v;
    if (palTool.s && palTool.s !== 1) e.s = palTool.s;
    if (palTool.flip) e.rot = Math.PI; // miroir horizontal (cf. propFlip, decormap.js)
    ov.props.add.push(e);
    rebuild();
  }
  function erasePropAt(x, z) {
    // si on supprime un décor qu'on venait d'ajouter, on retire l'ajout
    const before = ov.props.add.length;
    ov.props.add = ov.props.add.filter(p => Math.hypot(p.x - x, p.z - z) >= 1);
    if (ov.props.add.length === before) ov.props.remove.push([x, z]);
    rebuild();
  }
  function pickWorldProp(wx, wz, maxDist = 1.5) {
    let best = null, bd = maxDist;
    for (const p of world.props) {
      const d = Math.hypot(p.x - wx, p.z - wz);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }
  // déplacement : un ajout d'override est déplacé sur place ; un décor de la
  // génération de base est retiré puis re-posé (variante/échelle conservées)
  function finishMove(p, nx, nz) {
    const a = ov.props.add.find(e => e.type === p.type && e.x === p.x - 0.5 && e.z === p.z - 0.5);
    if (a) { a.x = nx; a.z = nz; }
    else {
      ov.props.remove.push([Math.floor(p.x), Math.floor(p.z)]);
      const e = { type: p.type, x: nx, z: nz };
      if (p.v != null) e.v = p.v;
      if (Number.isFinite(p.s) && p.s !== 1) e.s = p.s;
      if (p.rot) e.rot = p.rot;
      ov.props.add.push(e);
    }
    rebuild();
  }
  function pipette(wpt) {
    const p = pickWorldProp(wpt.x, wpt.z, 1.2);
    if (p && PROP_TYPES[p.type]) {
      palette.selectProp(p.type, p.v ?? null, propScale(p), propFlip(p));
    } else {
      const N = world.size, tx = Math.floor(wpt.x), tz = Math.floor(wpt.z);
      if (tx >= 0 && tz >= 0 && tx < N && tz < N) palette.selectTile(world.tile[tz * N + tx]);
    }
  }

  // index des décors par chunk + tris pour le rendu
  function indexProps() {
    chunkProps = new Map(); bigProps = []; propsByZ = [];
    if (!decor) return;
    for (const p of decor.props) {
      if (p.big) { bigProps.push(p); continue; }
      const key = Math.floor(p.x / CHUNK) + ':' + Math.floor(p.z / CHUNK);
      let list = chunkProps.get(key);
      if (!list) chunkProps.set(key, list = []);
      list.push(p);
    }
    for (const list of chunkProps.values()) list.sort((a, b) => (a.x + a.z) - (b.x + b.z));
    bigProps.sort((a, b) => (a.x + a.z) - (b.x + b.z));
    propsByZ = decor.props.slice().sort((a, b) => a.z - b.z || a.x - b.x);
  }

  // reconstruction complète : overrides appliqués, habillage, caches invalidés
  function rebuild() {
    clearTimeout(rebuildTimer);
    rebuildTimer = null;
    world = applyOverrides(structuredClone(baseWorld), ov);
    decor = buildDecor(world);
    indexProps();
    chunkCache.clear();
    pendingTiles = [];
    renderMiniBase();
    refreshEditLayers(); // camps et PNJ suivent les overrides (undo/redo compris)
    markDirty();
  }
  // pendant un trait de pinceau : retour visuel immédiat (pendingTiles),
  // reconstruction différée pour rester fluide sur les cartes 384×384
  function scheduleRebuild() {
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(rebuild, REBUILD_DELAY);
  }

  // ---------- souris / clavier ----------
  function updateCoords() {
    if (!hover || !world) return;
    const tx = Math.floor(hover.x), tz = Math.floor(hover.z), N = world.size;
    $('map-coords').textContent = (tx >= 0 && tz >= 0 && tx < N && tz < N)
      ? `${tx}, ${tz} — ${TILE_NAMES[world.tile[tz * N + tx]] || '?'}`
      : '—';
  }

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const { px, py } = mousePos(e);
    const wpt = s2w(px, py);
    const f = e.deltaY < 0 ? 1.18 : 1 / 1.18;
    view.z = Math.min(ZOOM_MAX, Math.max(fitZoom() * 0.9, view.z * f));
    anchorView(wpt.x, wpt.z, px, py); // zoom centré sur le curseur
    markDirty();
  }, { passive: false });

  canvas.addEventListener('pointerdown', (e) => {
    const { px, py } = mousePos(e);
    const wpt = s2w(px, py);
    hover = wpt;
    // déplacement de la vue : clic milieu, clic droit, ou Espace maintenu
    if (e.button === 1 || e.button === 2 || spaceHeld) {
      gesture = { mode: 'pan', w0: wpt };
      e.preventDefault?.();
      return;
    }
    if (e.button !== 0 || !world) return;
    if (e.altKey) { pipette(wpt); return; } // pipette
    const N = world.size, tx = Math.floor(wpt.x), tz = Math.floor(wpt.z);
    if (tx < 0 || tz < 0 || tx >= N || tz >= N) return;
    // calques d'édition : pose armée (➕), puis saisie d'un PNJ ou d'un camp
    if (pendingPlace === 'camp') { placeCampAt(tx, tz); return; }
    if (pendingPlace === 'npc') { placeNpcAt(tx, tz); return; }
    // pose d'une zone musicale : glisser pour dessiner le rectangle (relâcher = poser)
    if (pendingPlace === 'music') { gesture = { mode: 'musicDraw', x0: wpt.x, z0: wpt.z }; return; }
    if (showNpcs) {
      const hit = pickNpc(wpt.x, wpt.z);
      if (hit) { gesture = { mode: 'npcMove', index: hit.index, w0: wpt, moved: false, pushed: false }; return; }
    }
    if (showMusic) {
      const hit = pickMusic(wpt.x, wpt.z);
      if (hit) {
        gesture = { mode: 'musicEdit', kind: hit.kind, index: hit.index, w0: wpt, moved: false, pushed: false };
        return;
      }
    }
    if (showCamps) {
      const hit = pickCamp(wpt.x, wpt.z);
      if (hit) {
        gesture = { mode: hit.kind === 'edge' ? 'campResize' : 'campMove', index: hit.index, w0: wpt, moved: false, pushed: false };
        return;
      }
    }
    if (mode === 'erase') { pushHistory(); erasePropAt(tx, tz); return; }
    if (mode === 'move') {
      const p = pickWorldProp(wpt.x, wpt.z);
      if (p) gesture = { mode: 'moveProp', prop: p };
      return;
    }
    if (palTool.kind === 'tile') {
      if (e.shiftKey) { gesture = { mode: 'rect', x0: tx, z0: tz }; return; } // rectangle
      pushHistory();
      gesture = { mode: 'paint' };
      paintCells(tx, tz);
    } else {
      pushHistory();
      addPropAt(tx, tz);
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    const { px, py } = mousePos(e);
    hover = s2w(px, py);
    updateCoords();
    if (gesture?.mode === 'pan') {
      anchorView(gesture.w0.x, gesture.w0.z, px, py); // le point saisi suit le curseur
    } else if (gesture?.mode === 'paint') {
      paintCells(Math.floor(hover.x), Math.floor(hover.z));
    } else if (gesture?.mode === 'campMove' || gesture?.mode === 'campResize' || gesture?.mode === 'npcMove') {
      dragEditLayer(gesture);
    } else if (gesture?.mode === 'musicEdit') {
      dragMusic(gesture);
    }
    // musicDraw : l'aperçu du rectangle est dessiné par drawOverlays (markDirty)
    markDirty();
  });

  window.addEventListener('pointerup', () => {
    miniDrag = false;
    if (!gesture) return;
    if (gesture.mode === 'rect' && hover) {
      pushHistory();
      const tx = Math.floor(hover.x), tz = Math.floor(hover.z), N = world.size;
      const x0 = Math.max(0, Math.min(gesture.x0, tx)), x1 = Math.min(N - 1, Math.max(gesture.x0, tx));
      const z0 = Math.max(0, Math.min(gesture.z0, tz)), z1 = Math.min(N - 1, Math.max(gesture.z0, tz));
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) {
          setTile(x, z, palTool.tile);
          pendingTiles.push([x, z, palTool.tile]);
        }
      }
      scheduleRebuild();
    } else if (gesture.mode === 'moveProp' && hover) {
      const tx = Math.floor(hover.x), tz = Math.floor(hover.z), N = world.size;
      if (tx >= 0 && tz >= 0 && tx < N && tz < N) {
        pushHistory();
        finishMove(gesture.prop, tx, tz);
      }
    } else if (gesture.mode === 'npcMove' && !gesture.moved) {
      openNpcPanel(gesture.index); // simple clic : la fiche du PNJ
    } else if ((gesture.mode === 'campMove' || gesture.mode === 'campResize') && !gesture.moved) {
      openCampPanel(gesture.index); // simple clic : la fiche du camp
    } else if (gesture.mode === 'musicDraw' && hover) {
      // glisser = rectangle dessiné ; simple clic (sans déplacement réel) =
      // rectangle de taille par défaut centré sur le point
      const dx = Math.abs(hover.x - gesture.x0), dz = Math.abs(hover.z - gesture.z0);
      if (dx >= MUSIC_MIN_SIZE || dz >= MUSIC_MIN_SIZE) placeMusicRect(gesture.x0, gesture.z0, hover.x, hover.z);
      else placeMusicRect(gesture.x0 - MUSIC_DEFAULT_W / 2, gesture.z0 - MUSIC_DEFAULT_H / 2,
        gesture.x0 + MUSIC_DEFAULT_W / 2, gesture.z0 + MUSIC_DEFAULT_H / 2);
    } else if (gesture.mode === 'musicEdit' && !gesture.moved) {
      openMusicPanel(gesture.index); // simple clic : la fiche de la zone musicale
    }
    gesture = null;
    markDirty();
  });

  window.addEventListener('keydown', (e) => {
    const t = document.activeElement?.tagName;
    if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT') return;
    if (e.code === 'Space') { spaceHeld = true; e.preventDefault?.(); }
    else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
      e.preventDefault?.();
      if (e.shiftKey) redo(); else undo();
    } else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyY') { e.preventDefault?.(); redo(); }
  });
  window.addEventListener('keyup', (e) => { if (e.code === 'Space') spaceHeld = false; });

  // ---------- barre d'outils ----------
  function setMode(m) {
    mode = m;
    $('tool-paint').classList.toggle('active', m === 'paint');
    $('tool-erase').classList.toggle('active', m === 'erase');
    $('tool-move').classList.toggle('active', m === 'move');
    markDirty();
  }
  $('tool-paint').onclick = () => setMode('paint');
  $('tool-erase').onclick = () => setMode('erase');
  $('tool-move').onclick = () => setMode('move');
  $('brush-size').onchange = () => { brushSize = parseInt($('brush-size').value, 10) || 1; };
  $('undo-map').onclick = undo;
  $('redo-map').onclick = redo;
  $('iso-view').onchange = () => { view.iso = $('iso-view').checked; markDirty(); };
  $('show-players').onchange = () => { $('players-info').textContent = ''; pollPlayers(); };
  $('show-player-names').onchange = () => markDirty();
  // calques Camps / PNJ / Musique : affichage + pose armée (le prochain geste pose l'élément)
  $('layer-camps').onchange = () => { showCamps = $('layer-camps').checked; markDirty(); };
  $('layer-npcs').onchange = () => { showNpcs = $('layer-npcs').checked; markDirty(); };
  $('layer-music')?.addEventListener('change', () => { showMusic = $('layer-music').checked; markDirty(); });
  $('add-camp').onclick = () => {
    $('layer-camps').checked = true; showCamps = true;
    pendingPlace = 'camp';
    msg('Cliquez sur la carte pour poser le camp.');
  };
  $('add-npc').onclick = () => {
    $('layer-npcs').checked = true; showNpcs = true;
    pendingPlace = 'npc';
    msg('Cliquez sur la carte pour poser le PNJ.');
  };
  $('add-music')?.addEventListener('click', () => {
    $('layer-music').checked = true; showMusic = true;
    pendingPlace = 'music';
    msg('Glissez sur la carte pour dessiner la zone musicale (la fiche permet de la passer en cercle).');
  });

  $('save-map').onclick = async () => {
    try {
      await api(`/api/admin/overrides/${curZone}`, 'PUT', ov);
      msg('✔ Enregistré et appliqué au serveur.');
    } catch (e) { msg('✘ ' + e.message); }
  };
  $('reset-map').onclick = async () => {
    if (!confirm('Effacer toutes les modifications de cette zone ?')) return;
    pushHistory(); // la réinitialisation reste annulable localement (puis Enregistrer)
    ov = emptyOv();
    rebuildTileIndex();
    try { await api(`/api/admin/overrides/${curZone}`, 'PUT', ov); } catch (e) { msg('✘ ' + e.message); }
    rebuild();
  };
  $('export-map').onclick = () => {
    const blob = new Blob([JSON.stringify(ov, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `overrides_zone${curZone}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  $('import-map').onclick = () => $('import-file').click();
  $('import-file').onchange = async () => {
    const f = $('import-file').files?.[0];
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      pushHistory();
      ov = normalizeOv(data);
      rebuildTileIndex();
      rebuild();
      msg("✔ Fichier importé — « Enregistrer » pour l'appliquer au serveur.");
    } catch (e) { msg('✘ Import impossible : ' + e.message); }
    $('import-file').value = '';
  };

  const sel = $('map-zone');
  sel.innerHTML = zones.map(z => `<option value="${z.id}">${z.id} — ${z.name} (${z.levels[0]}-${z.levels[1]})</option>`).join('');
  sel.onchange = () => loadZone(parseInt(sel.value, 10));

  // ---------- joueurs en direct ----------
  async function pollPlayers() {
    if (!$('show-players').checked) { livePlayers = []; markDirty(); return; }
    try {
      const { players } = await api('/api/admin/players');
      livePlayers = players;
      const here = players.filter(p => p.zoneId === curZone && !p.trial).length;
      const trials = players.filter(p => p.trial);
      const elsewhere = players.length - here - trials.length;
      $('players-info').textContent = players.length
        ? `${players.length} en ligne — ${here} sur cette carte`
          + (elsewhere ? `, ${elsewhere} ailleurs` : '')
          + (trials.length ? `, en Épreuve : ${trials.map(p => `${p.name} (z${p.zoneId})`).join(', ')}` : '')
        : 'aucun joueur en ligne';
    } catch { /* session expirée ou serveur indisponible : on garde l'affichage */ }
    markDirty();
  }
  setInterval(pollPlayers, 2000);

  // ---------- chargement de zone ----------
  async function loadZone(id) {
    curZone = id;
    msg('Génération de la carte…');
    await new Promise(r => setTimeout(r, 20));
    const def = zones.find(z => z.id === id);
    const w = generateWorld(def.seed, def.map);
    // structuredClone ne passe pas les fonctions : on garde un objet simple
    // (avec les défauts de peuplement : camps du worldgen et spots de PNJ)
    baseWorld = {
      size: w.size, tile: w.tile, walk: w.walk, props: w.props, height: w.height, kind: w.kind,
      spawnZones: w.spawnZones || null, npcSpots: w.npcSpots || null, village: w.village,
    };
    closePanel();
    pendingPlace = null;
    try { ov = normalizeOv(await api(`/api/admin/overrides/${id}`)); } catch { ov = emptyOv(); }
    history = []; redoStack = [];
    rebuildTileIndex();
    rebuild();
    view.iso = $('iso-view').checked;
    view.z = fitZoom();
    view.cx = w.size / 2;
    view.cz = w.size / 2;
    msg('');
    markDirty();
  }

  await loadZone(curZone);
  pollPlayers();

  // poignées pour les tests headless (et le débogage console)
  return {
    getOverrides: () => ov,
    getView: () => view,
    loadZone,
    undo,
    redo,
    paintAt: (x, z) => { pushHistory(); paintCells(x, z); },
    setTool: (t) => { palTool = t; setMode('paint'); },
    rebuildNow: rebuild,
    // calques camps / PNJ / musique
    getCamps: () => campsList,
    getNpcs: () => npcsList,
    getMusicZones: () => musicList,
    placeCampAt,
    placeNpcAt,
    placeMusicRect,
    placeMusicCircle,
    openCampPanel,
    openNpcPanel,
    openMusicPanel,
  };
}
