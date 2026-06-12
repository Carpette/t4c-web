// Éditeur de carte de l'administration : un vrai outil de cartographie.
// — navigation : zoom molette centré sur le curseur, pan (clic milieu / clic
//   droit / Espace+glisser), mini-carte cliquable, coordonnées sous le curseur ;
// — rendu : aplats de couleur à faible zoom, vrais sprites Flare au-delà d'un
//   seuil (mêmes tuiles/décors que le jeu via buildDecor), cache de rendu par
//   chunks (LRU) pour rester fluide sur les cartes 384×384 ;
// — outils : pinceau de tuiles à taille réglable, rectangle (Maj), pipette
//   (Alt+clic), gomme et déplacement de décors, annuler/rétablir (Ctrl+Z),
//   export/import JSON des overrides de la zone ;
// — la palette (palette.js) fournit la tuile ou le décor à poser.
import { generateWorld, TILE } from '../../../shared/worldgen.js';
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

export async function initMapEditor({ api, zones }) {
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

  // vue : z = px/tuile ; (cx, cz) = tuile au centre du canvas ; iso = vue jeu
  const view = { z: 4, cx: 64, cz: 64, iso: false };

  function emptyOv() { return { tiles: [], props: { add: [], remove: [] } }; }
  function normalizeOv(o) {
    const n = o && typeof o === 'object' ? o : {};
    return {
      tiles: Array.isArray(n.tiles) ? n.tiles : [],
      props: { add: n.props?.add ?? [], remove: n.props?.remove ?? [] },
    };
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
    rebuild();
  }
  function redo() {
    if (!redoStack.length) return;
    history.push(JSON.stringify(ov));
    ov = JSON.parse(redoStack.pop());
    rebuildTileIndex();
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
    }
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
    baseWorld = { size: w.size, tile: w.tile, walk: w.walk, props: w.props, height: w.height, kind: w.kind };
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
  };
}
