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

// sous-zones d'ambiance : mêmes dimensions/couleur de calque que la musique
const AMBIENCE_MIN_SIZE = 2;
const AMBIENCE_DEFAULT_W = 16, AMBIENCE_DEFAULT_H = 16, AMBIENCE_DEFAULT_R = 8;
const AMBIENCE_COLOR = '#5fd0a0';   // teinte du calque ambiance (vert d'eau)
const AMBIENCE_DEFAULT_TINT = 'rgba(40, 80, 50, 0.30)'; // marais verdâtre par défaut

// sources de lumière posées : rayon par défaut (px écran, comme les torches) et couleur
const LIGHT_DEFAULT_R = 300;
const LIGHT_COLOR = '#ffd36a';   // teinte du calque lumières (ambre chaud)
const LIGHT_DEFAULT_COLOR = 'rgba(255, 170, 70, 0.18)';
const LIGHT_R_MIN = 60, LIGHT_R_MAX = 900;

// calques coffres / points spéciaux : teintes et icônes
const CHEST_COLOR = '#ffae42';   // teinte du calque coffres (ambre)
const MARKER_COLORS = { spawn: '#4dff8a', exit: '#ff6a6a', teleport: '#5ab9ff' };
const MARKER_GLYPHS = { spawn: '⚑', exit: '⮌', teleport: '✦' };
const MARKER_NAMES = { spawn: 'apparition', exit: 'sortie', teleport: 'téléport' };

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
  let mode = 'paint';    // paint | erase | move | fill | select
  let palTool = { kind: 'tile', tile: TILE.GRASS }; // sélection de la palette
  let brushSize = 1;
  let hover = null;      // position monde sous le curseur (continue)
  let gesture = null;    // geste pointeur en cours (pan / paint / rect / moveProp)
  let spaceHeld = false;
  let livePlayers = [];
  // copier/coller : région sélectionnée + presse-papier interne + collage en cours
  let selection = null;  // { x0, z0, x1, z1 } (tuiles, inclus) en cours ou figée
  let clipboard = null;  // { w, h, tiles:[[dx,dz,t]], props:[{type,dx,dz,...}] }
  let pasting = false;   // collage armé : le prochain clic valide à la position du curseur
  // index des décors pour le rendu : par chunk (iso), triés (vue du dessus), gros sprites
  let chunkProps = new Map(), bigProps = [], propsByZ = [];
  let miniBase = null;   // fond de mini-carte (1 px par tuile)
  // calques d'édition « Camps », « PNJ », « Musique », « Coffres », « Points », « Ambiance », « Lumières »
  let showCamps = false, showNpcs = false, showMusic = false, showChests = false, showMarkers = false;
  let showAmbience = false, showLights = false;
  let pendingPlace = null;            // 'camp'|'npc'|'music'|'chest'|'marker'|'ambience'|'light'|'teleport-test'
  let campsList = [], npcsList = [];  // listes effectives (overrides ou défauts du worldgen)
  let musicList = [];                 // sous-zones musicales (overrides `music`)
  let chestsList = [], markersList = []; // coffres (props 'chest') et points spéciaux (overrides `markers`)
  let ambienceList = [], lightsList = []; // sous-zones d'ambiance + sources de lumière
  let dayPreview = null;              // aperçu jour/nuit éditeur : null | 'day' | 'night'
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
    if (Array.isArray(n.chests)) out.chests = n.chests;   // butin de coffres
    if (Array.isArray(n.markers)) out.markers = n.markers; // points spéciaux
    if (Array.isArray(n.ambience)) out.ambience = n.ambience; // sous-zones d'ambiance
    if (Array.isArray(n.lights)) out.lights = n.lights;   // sources de lumière
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

  // région sélectionnée (copier/coller) + fantôme du collage en cours
  function drawSelection() {
    if (selection) {
      const b = selBounds(selection);
      fillCellPath(b.x0, b.z0, b.x1 + 1, b.z1 + 1);
      ctx.globalAlpha = 0.12; ctx.fillStyle = '#7ad1ff'; ctx.fill(); ctx.globalAlpha = 1;
      ctx.strokeStyle = '#7ad1ff'; ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]); ctx.stroke(); ctx.setLineDash([]);
    }
    if (pasting && clipboard && hover) {
      const tx = Math.floor(hover.x), tz = Math.floor(hover.z);
      fillCellPath(tx, tz, tx + clipboard.w, tz + clipboard.h);
      ctx.globalAlpha = 0.18; ctx.fillStyle = '#ffd24a'; ctx.fill(); ctx.globalAlpha = 1;
      ctx.strokeStyle = '#ffd24a'; ctx.lineWidth = 1.5; ctx.stroke();
    }
  }

  // surimpressions de l'outil courant : brosse, rectangle, fantôme, gomme, déplacement
  function drawOverlays() {
    if (!hover) return;
    // pot de peinture : surligne la case visée
    if (mode === 'fill') { strokeRing(hover.x, hover.z, view.z * 0.7, CHEST_COLOR); return; }
    // sélection en cours (glisser de l'outil ⧉) : rectangle bleu animé
    if (gesture?.mode === 'select') {
      const tx = Math.floor(hover.x), tz = Math.floor(hover.z);
      const x0 = Math.min(gesture.x0, tx), x1 = Math.max(gesture.x0, tx);
      const z0 = Math.min(gesture.z0, tz), z1 = Math.max(gesture.z0, tz);
      fillCellPath(x0, z0, x1 + 1, z1 + 1);
      ctx.globalAlpha = 0.14; ctx.fillStyle = '#7ad1ff'; ctx.fill(); ctx.globalAlpha = 1;
      ctx.strokeStyle = '#7ad1ff'; ctx.lineWidth = 1.5; ctx.stroke();
      return;
    }
    // tracé d'une zone musicale / d'ambiance en cours (glisser) : aperçu du rectangle
    if (gesture?.mode === 'musicDraw' || gesture?.mode === 'ambienceDraw') {
      const col = gesture.mode === 'ambienceDraw' ? AMBIENCE_COLOR : MUSIC_COLOR;
      fillCellPath(gesture.x0, gesture.z0, hover.x, hover.z);
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = col;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.stroke();
      return;
    }
    // pose armée (➕ Camp / ➕ PNJ / ➕ Zone musicale / ➕ Coffre / ➕ Point / ➕ Ambiance / ➕ Lumière / Tester ici)
    if (pendingPlace) {
      if (pendingPlace === 'music') strokeRing(hover.x, hover.z, view.z * (MUSIC_DEFAULT_W / 2), MUSIC_COLOR);
      else if (pendingPlace === 'ambience') strokeRing(hover.x, hover.z, view.z * (AMBIENCE_DEFAULT_W / 2), AMBIENCE_COLOR);
      else if (pendingPlace === 'light') strokeRing(hover.x, hover.z, view.z * lightTileRadius(LIGHT_DEFAULT_R), LIGHT_COLOR);
      else if (pendingPlace === 'chest') strokeRing(hover.x, hover.z, view.z * 0.6, CHEST_COLOR);
      else if (pendingPlace === 'marker') strokeRing(hover.x, hover.z, view.z * 0.6, MARKER_COLORS.teleport);
      else if (pendingPlace === 'teleport-test') strokeRing(hover.x, hover.z, view.z * 0.6, '#ffd34d');
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
    markersList = Array.isArray(ov.markers) ? ov.markers : [];
    ambienceList = Array.isArray(ov.ambience) ? ov.ambience : [];
    lightsList = Array.isArray(ov.lights) ? ov.lights : [];
    // coffres effectifs : tous les props 'chest' du monde, enrichis du butin
    // personnalisé (ov.chests, indexé par case) le cas échéant
    chestsList = (world?.props || []).filter(p => p.type === 'chest').map(p => ({
      x: p.x, z: p.z,
      loot: chestLootAt(Math.floor(p.x), Math.floor(p.z)),
    }));
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

  // ---------- calque « Ambiance » : sous-zones de teinte/obscurité ----------
  // Même géométrie que les zones musicales (rect/cercle, déplacer/redimensionner)
  // + une teinte CSS et/ou une obscurité 0..1, et une priorité de chevauchement.
  // Format de stockage dans ov.ambience : { id, shape, x, z, w, h | r, tint, darkness, priority }.
  function ambienceOv() {
    if (!Array.isArray(ov.ambience)) ov.ambience = [];
    return ov.ambience;
  }
  function ambienceLabel(a) {
    const bits = [];
    if (a.darkness) bits.push(`obscurité ${Math.round(a.darkness * 100)}%`);
    if (a.tint) bits.push('teinte');
    const s = bits.join(' + ') || '(sans effet)';
    return a.priority ? `${s} [${a.priority}]` : s;
  }
  function placeAmbienceZone(shape, geom) {
    pendingPlace = null;
    pushHistory();
    const list = ambienceOv();
    const base = { id: 'amb_' + Date.now().toString(36), shape, tint: AMBIENCE_DEFAULT_TINT, darkness: 0, priority: 0 };
    list.push(shape === 'circle'
      ? { ...base, x: geom.x, z: geom.z, r: geom.r }
      : { ...base, x: geom.x, z: geom.z, w: geom.w, h: geom.h });
    refreshEditLayers();
    openAmbiencePanel(list.length - 1);
  }
  function placeAmbienceRect(x0, z0, x1, z1) {
    const x = Math.min(x0, x1), z = Math.min(z0, z1);
    const w = Math.max(AMBIENCE_MIN_SIZE, Math.abs(x1 - x0));
    const h = Math.max(AMBIENCE_MIN_SIZE, Math.abs(z1 - z0));
    placeAmbienceZone('rect', { x, z, w, h });
  }
  function placeAmbienceCircle(cx, cz, r) {
    placeAmbienceZone('circle', { x: cx, z: cz, r: Math.max(AMBIENCE_MIN_SIZE, r) });
  }
  function ambienceCenter(a) {
    return a.shape === 'circle' ? { x: a.x, z: a.z } : { x: a.x + a.w / 2, z: a.z + a.h / 2 };
  }
  function pickAmbience(wx, wz) {
    const tol = Math.max(0.8, 8 / view.z);
    for (let i = ambienceList.length - 1; i >= 0; i--) {
      const a = ambienceList[i];
      if (a.shape === 'circle') {
        if (Math.abs(Math.hypot(wx - a.x, wz - a.z) - a.r) <= tol) return { index: i, kind: 'edge' };
      } else if (Math.hypot(wx - (a.x + a.w), wz - (a.z + a.h)) <= tol * 1.5) return { index: i, kind: 'edge' };
    }
    for (let i = ambienceList.length - 1; i >= 0; i--) {
      const a = ambienceList[i];
      const inside = a.shape === 'circle'
        ? Math.hypot(wx - a.x, wz - a.z) <= a.r
        : (wx >= a.x && wx <= a.x + a.w && wz >= a.z && wz <= a.z + a.h);
      if (inside) return { index: i, kind: 'center' };
    }
    return null;
  }
  function dragAmbience(g) {
    if (!g.moved && Math.hypot(hover.x - g.w0.x, hover.z - g.w0.z) < 0.35) return;
    if (!g.pushed) { pushHistory(); g.pushed = true; }
    g.moved = true;
    const snap = (v) => Math.round(v * 2) / 2;
    const a = ambienceOv()[g.index];
    if (!a) return;
    if (g.kind === 'center') {
      const c = ambienceCenter(a);
      const dx = snap(hover.x) - c.x, dz = snap(hover.z) - c.z;
      if (a.shape === 'circle') { a.x += dx; a.z += dz; }
      else { a.x = snap(a.x + dx); a.z = snap(a.z + dz); }
    } else if (a.shape === 'circle') {
      a.r = Math.max(AMBIENCE_MIN_SIZE, snap(Math.hypot(hover.x - a.x, hover.z - a.z)));
    } else {
      a.w = Math.max(AMBIENCE_MIN_SIZE, snap(hover.x - a.x));
      a.h = Math.max(AMBIENCE_MIN_SIZE, snap(hover.z - a.z));
    }
    refreshEditLayers();
  }
  function drawAmbience() {
    if (!showAmbience) return;
    for (const a of ambienceList) {
      // remplit avec la teinte réelle de la zone (aperçu) + cadre du calque
      const fill = a.tint || AMBIENCE_COLOR;
      ctx.strokeStyle = AMBIENCE_COLOR;
      ctx.lineWidth = 2;
      if (a.shape === 'circle') {
        const s = w2s(a.x, a.z), r = a.r * view.z;
        ctx.beginPath();
        if (view.iso) ctx.ellipse(s.x, s.y, r, r / 2, 0, 0, Math.PI * 2);
        else ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
        ctx.fillStyle = fill; ctx.globalAlpha = a.tint ? 0.5 : 0.16; ctx.fill();
        ctx.globalAlpha = 1; ctx.stroke();
        const e = w2s(a.x + a.r, a.z);
        ctx.fillStyle = AMBIENCE_COLOR;
        ctx.beginPath(); ctx.arc(e.x, e.y, 4, 0, Math.PI * 2); ctx.fill();
      } else {
        fillCellPath(a.x, a.z, a.x + a.w, a.z + a.h);
        ctx.fillStyle = fill; ctx.globalAlpha = a.tint ? 0.5 : 0.16; ctx.fill();
        ctx.globalAlpha = 1; ctx.stroke();
        const e = w2s(a.x + a.w, a.z + a.h);
        ctx.fillStyle = AMBIENCE_COLOR;
        ctx.beginPath(); ctx.arc(e.x, e.y, 4, 0, Math.PI * 2); ctx.fill();
      }
      const c = ambienceCenter(a), cs = w2s(c.x, c.z);
      ctx.fillStyle = AMBIENCE_COLOR;
      ctx.beginPath(); ctx.arc(cs.x, cs.y, 4, 0, Math.PI * 2); ctx.fill();
      labelText(cs.x, cs.y - 8, ambienceLabel(a), AMBIENCE_COLOR);
    }
  }

  // ---------- calque « Lumières » : sources ponctuelles (halo paramétrable) ----------
  // Format de stockage dans ov.lights : { id, x, z, r, color, flicker }.
  function lightsOv() {
    if (!Array.isArray(ov.lights)) ov.lights = [];
    return ov.lights;
  }
  function placeLightAt(tx, tz) {
    pendingPlace = null;
    pushHistory();
    const list = lightsOv();
    list.push({ id: 'light_' + Date.now().toString(36), x: tx + 0.5, z: tz + 0.5, r: LIGHT_DEFAULT_R, color: LIGHT_DEFAULT_COLOR, flicker: true });
    refreshEditLayers();
    openLightPanel(list.length - 1);
  }
  // rayon de lumière (px écran) -> rayon visuel en tuiles (≈ GAME_PX px/tuile au zoom 1)
  function lightTileRadius(r) { return (r || LIGHT_DEFAULT_R) / GAME_PX; }
  function pickLight(wx, wz) {
    const tol = Math.max(0.8, 8 / view.z);
    // bord (redimensionnement du rayon) d'abord, puis centre (déplacement/fiche)
    for (let i = lightsList.length - 1; i >= 0; i--) {
      const l = lightsList[i];
      if (Math.abs(Math.hypot(wx - l.x, wz - l.z) - lightTileRadius(l.r)) <= tol) return { index: i, kind: 'edge' };
    }
    for (let i = lightsList.length - 1; i >= 0; i--) {
      const l = lightsList[i];
      if (Math.hypot(wx - l.x, wz - l.z) <= Math.max(1, tol)) return { index: i, kind: 'center' };
    }
    return null;
  }
  function dragLight(g) {
    if (!g.moved && Math.hypot(hover.x - g.w0.x, hover.z - g.w0.z) < 0.35) return;
    if (!g.pushed) { pushHistory(); g.pushed = true; }
    g.moved = true;
    const snap = (v) => Math.round(v * 2) / 2;
    const l = lightsOv()[g.index];
    if (!l) return;
    if (g.kind === 'center') { l.x = snap(hover.x); l.z = snap(hover.z); }
    else l.r = Math.max(LIGHT_R_MIN, Math.min(LIGHT_R_MAX, Math.round(Math.hypot(hover.x - l.x, hover.z - l.z) * GAME_PX)));
    refreshEditLayers();
  }
  function drawLights() {
    if (!showLights) return;
    for (const l of lightsList) {
      const s = w2s(l.x, l.z), r = lightTileRadius(l.r) * view.z;
      // halo de portée (cercle) + point central
      ctx.strokeStyle = LIGHT_COLOR; ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (view.iso) ctx.ellipse(s.x, s.y, r, r / 2, 0, 0, Math.PI * 2);
      else ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
      ctx.globalAlpha = 0.5; ctx.stroke(); ctx.globalAlpha = 1;
      // poignée de bord (rayon)
      const e = w2s(l.x + lightTileRadius(l.r), l.z);
      ctx.fillStyle = LIGHT_COLOR;
      ctx.beginPath(); ctx.arc(e.x, e.y, 4, 0, Math.PI * 2); ctx.fill();
      // ampoule au centre
      ctx.font = `${Math.max(12, view.z)}px sans-serif`;
      ctx.textAlign = 'center';
      labelText(s.x, s.y + view.z * 0.3, l.flicker ? '🔥' : '💡', LIGHT_COLOR);
    }
  }
  // Aperçu jour/nuit dans l'éditeur : reproduit l'éclairage du jeu sur le canvas
  // de la carte (voile d'obscurité percé par les sources de lumière + teinte et
  // obscurité des zones d'ambiance) pour juger le rendu sans lancer le jeu.
  // dayPreview = null : aucun voile (édition normale, pleine lumière).
  function drawDayNightPreview() {
    if (!dayPreview) return;
    const nightDark = dayPreview === 'night' ? 0.74 : 0.0; // jour : seules les ambiances assombrissent
    // teintes d'ambiance d'abord (sous le voile d'obscurité)
    for (const a of ambienceList) {
      if (!a.tint) continue;
      ctx.save();
      shapeClip(a);
      ctx.fillStyle = a.tint;
      ctx.fillRect(0, 0, W(), H());
      ctx.restore();
    }
    // voile d'obscurité (nuit globale + obscurité d'ambiance cumulée par zone)
    const off = document.createElement('canvas');
    off.width = W(); off.height = H();
    const l = off.getContext('2d');
    if (nightDark > 0.01) { l.fillStyle = `rgba(8, 11, 34, ${nightDark})`; l.fillRect(0, 0, W(), H()); }
    for (const a of ambienceList) {
      if (!a.darkness) continue;
      l.save(); shapeClipOn(l, a);
      l.fillStyle = `rgba(8, 11, 34, ${Math.min(1, a.darkness)})`;
      l.fillRect(0, 0, W(), H());
      l.restore();
    }
    // les sources de lumière percent le voile (halo radial)
    l.globalCompositeOperation = 'destination-out';
    for (const li of lightsList) {
      const s = w2s(li.x, li.z), r = lightTileRadius(li.r) * view.z;
      const g = l.createRadialGradient(s.x, s.y, 0, s.x, s.y, r);
      g.addColorStop(0, 'rgba(0,0,0,0.95)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      l.fillStyle = g; l.fillRect(s.x - r, s.y - r, r * 2, r * 2);
    }
    l.globalCompositeOperation = 'source-over';
    ctx.drawImage(off, 0, 0);
    // halos chauds par-dessus
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const li of lightsList) {
      const s = w2s(li.x, li.z), r = lightTileRadius(li.r) * view.z * 0.75;
      const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r);
      g.addColorStop(0, li.color || LIGHT_DEFAULT_COLOR); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(s.x - r, s.y - r, r * 2, r * 2);
    }
    ctx.restore();
  }
  // chemin de découpe d'une forme d'ambiance sur un contexte donné (aperçu)
  function shapeClipOn(g, a) {
    g.beginPath();
    if (a.shape === 'circle') {
      const s = w2s(a.x, a.z), r = a.r * view.z;
      if (view.iso) g.ellipse(s.x, s.y, r, r / 2, 0, 0, Math.PI * 2);
      else g.arc(s.x, s.y, r, 0, Math.PI * 2);
    } else {
      const p0 = w2s(a.x, a.z), p1 = w2s(a.x + a.w, a.z), p2 = w2s(a.x + a.w, a.z + a.h), p3 = w2s(a.x, a.z + a.h);
      g.moveTo(p0.x, p0.y); g.lineTo(p1.x, p1.y); g.lineTo(p2.x, p2.y); g.lineTo(p3.x, p3.y); g.closePath();
    }
    g.clip();
  }
  function shapeClip(a) { shapeClipOn(ctx, a); }

  function openLightPanel(index) {
    const l = lightsList[index];
    if (!l) return;
    closePanel();
    const rInput = h('input', { type: 'number', min: String(LIGHT_R_MIN), max: String(LIGHT_R_MAX), step: '10', value: String(Math.round(l.r || LIGHT_DEFAULT_R)), style: { width: '70px' } });
    // couleur : un sélecteur HTML #rrggbb + une opacité 0..1 (le halo est en rgba)
    const parsed = parseCssColor(l.color || LIGHT_DEFAULT_COLOR);
    const colorInput = h('input', { type: 'color', value: parsed.hex });
    const alphaInput = h('input', { type: 'number', min: '0', max: '1', step: '0.02', value: String(parsed.a), style: { width: '64px' } });
    const flickInput = h('input', { type: 'checkbox', checked: l.flicker !== false });
    flickInput.onchange = () => { flickInput.checked = flickInput.checked; };
    panelEl.append(
      panelTitle('Source de lumière'),
      h('div', { className: 'hint', textContent: 'Glissez le point pour déplacer, le bord pour régler le rayon. Le halo se rend comme une torche.' }),
      h('div', { className: 'edit-row' }, 'Rayon : ', rInput, ' px'),
      h('div', { className: 'edit-row' }, 'Couleur : ', colorInput, ' opacité ', alphaInput),
      h('label', { className: 'edit-check' }, flickInput, ' scintillement (flamme)'),
      h('div', { className: 'edit-row' },
        h('button', {
          textContent: 'Appliquer',
          onclick: () => {
            pushHistory();
            const real = lightsOv()[index];
            if (!real) return;
            real.r = Math.max(LIGHT_R_MIN, Math.min(LIGHT_R_MAX, Math.round(+rInput.value || LIGHT_DEFAULT_R)));
            real.color = hexToRgba(colorInput.value, Math.max(0, Math.min(1, +alphaInput.value || 0)));
            real.flicker = flickInput.checked;
            refreshEditLayers();
            closePanel();
            msg('✔ Lumière réglée — « Enregistrer » pour l\'appliquer au serveur.');
          },
        }),
        h('button', {
          textContent: 'Supprimer', className: 'danger',
          onclick: () => { pushHistory(); lightsOv().splice(index, 1); refreshEditLayers(); closePanel(); },
        })),
    );
    panelEl.style.display = 'block';
  }
  // fiche d'une sous-zone d'ambiance : forme, dimensions, teinte, obscurité, priorité
  function openAmbiencePanel(index) {
    const a = ambienceList[index];
    if (!a) return;
    closePanel();
    const shapeSel = h('select', {
      innerHTML: ['rect', 'circle'].map(s =>
        `<option value="${s}"${s === a.shape ? ' selected' : ''}>${s === 'rect' ? 'Rectangle' : 'Cercle'}</option>`).join(''),
    });
    const num = (val) => h('input', { type: 'number', min: String(AMBIENCE_MIN_SIZE), step: '1', value: String(Math.round(val)), style: { width: '60px' } });
    const rInput = num(a.r || AMBIENCE_DEFAULT_R);
    const wInput = num(a.w || AMBIENCE_DEFAULT_W);
    const hInput = num(a.h || AMBIENCE_DEFAULT_H);
    const sizeCircle = h('div', { className: 'edit-row' }, 'Rayon : ', rInput, ' tuiles');
    const sizeRect = h('div', { className: 'edit-row' }, 'Largeur : ', wInput, ' Hauteur : ', hInput);
    const refreshSizeRows = () => {
      sizeCircle.style.display = shapeSel.value === 'circle' ? '' : 'none';
      sizeRect.style.display = shapeSel.value === 'rect' ? '' : 'none';
    };
    refreshSizeRows();
    shapeSel.addEventListener('change', refreshSizeRows);
    // teinte : activable, couleur + opacité (la teinte stockée est en rgba)
    const tintOn = h('input', { type: 'checkbox', checked: !!a.tint });
    const tp = parseCssColor(a.tint || AMBIENCE_DEFAULT_TINT);
    const tintColor = h('input', { type: 'color', value: tp.hex });
    const tintAlpha = h('input', { type: 'number', min: '0', max: '1', step: '0.02', value: String(tp.a), style: { width: '64px' } });
    const darknessInput = h('input', { type: 'number', min: '0', max: '1', step: '0.05', value: String(a.darkness || 0), style: { width: '70px' } });
    const prioInput = h('input', { type: 'number', value: String(a.priority || 0), style: { width: '60px' } });
    panelEl.append(
      panelTitle('Zone d\'ambiance'),
      h('div', { className: 'hint', textContent: 'Teinte/obscurité appliquées par-dessus le cycle jour/nuit quand le joueur entre. Glissez le centre / le bord pour déplacer / redimensionner.' }),
      h('div', { className: 'edit-row' }, 'Forme : ', shapeSel),
      sizeCircle, sizeRect,
      h('div', { className: 'edit-row' }, h('label', { className: 'edit-check' }, tintOn, ' teinte'), ' ', tintColor, ' opacité ', tintAlpha),
      h('div', { className: 'edit-row' }, 'Obscurité (0..1) : ', darknessInput),
      h('div', { className: 'edit-row' }, 'Priorité (chevauchements) : ', prioInput),
      h('div', { className: 'edit-row' },
        h('button', {
          textContent: 'Appliquer',
          onclick: () => {
            pushHistory();
            const real = ambienceOv()[index];
            if (!real) return;
            const c = ambienceCenter(real);
            const clamp = (v) => Math.max(AMBIENCE_MIN_SIZE, Math.round(Number(v) || 0));
            if (shapeSel.value === 'circle') {
              real.shape = 'circle'; real.r = clamp(rInput.value);
              real.x = c.x; real.z = c.z; delete real.w; delete real.h;
            } else {
              real.shape = 'rect'; real.w = clamp(wInput.value); real.h = clamp(hInput.value);
              real.x = c.x - real.w / 2; real.z = c.z - real.h / 2; delete real.r;
            }
            real.tint = tintOn.checked ? hexToRgba(tintColor.value, Math.max(0, Math.min(1, +tintAlpha.value || 0))) : null;
            real.darkness = Math.max(0, Math.min(1, +darknessInput.value || 0));
            real.priority = prioInput.value | 0;
            refreshEditLayers();
            closePanel();
            msg('✔ Zone d\'ambiance modifiée — « Enregistrer » pour l\'appliquer au serveur.');
          },
        }),
        h('button', {
          textContent: 'Supprimer', className: 'danger',
          onclick: () => { pushHistory(); ambienceOv().splice(index, 1); refreshEditLayers(); closePanel(); },
        })),
    );
    panelEl.style.display = 'block';
  }

  // --- utilitaires couleur : rgba <-> #rrggbb + opacité (fiches lumière/ambiance) ---
  function parseCssColor(s) {
    const m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/i.exec(String(s || ''));
    if (m) {
      const hex = '#' + [m[1], m[2], m[3]].map(v => Math.max(0, Math.min(255, +v)).toString(16).padStart(2, '0')).join('');
      return { hex, a: m[4] != null ? Math.max(0, Math.min(1, +m[4])) : 1 };
    }
    if (/^#[0-9a-f]{6}$/i.test(s)) return { hex: s, a: 1 };
    return { hex: '#ffaa46', a: 0.18 };
  }
  function hexToRgba(hex, a) {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || ''));
    if (!m) return `rgba(255, 170, 70, ${a})`;
    return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${a})`;
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

  // ---------- calque « Coffres » : pose + édition du butin ----------
  // Un coffre EST un prop 'chest' (props.add) ; son contenu personnalisé vit
  // dans ov.chests, indexé par case. Section ABSENTE / case non listée : le
  // serveur garde le butin générique.
  function chestsOv() {
    if (!Array.isArray(ov.chests)) ov.chests = [];
    return ov.chests;
  }
  function chestLootAt(x, z) {
    return (ov.chests || []).find(c => Math.floor(+c.x) === x && Math.floor(+c.z) === z) || null;
  }
  function chestLabel(c) {
    if (!c.loot) return 'butin générique';
    const parts = [];
    const g = c.loot.gold;
    if (Array.isArray(g) && (g[0] || g[1])) parts.push(`${g[0]}-${g[1]} or`);
    if (c.loot.items?.length) parts.push(`${c.loot.items.length} objet(s)`);
    if (c.loot.reqFlag) parts.push('🔒');
    return parts.join(', ') || 'coffre vide';
  }
  // pose un coffre : prop 'chest' + entrée de butin par défaut (générique tant
  // qu'on n'a rien renseigné). Ouvre la fiche pour configurer le contenu.
  function placeChestAt(tx, tz) {
    pendingPlace = null;
    pushHistory();
    ov.props.add.push({ type: 'chest', x: tx, z: tz });
    rebuild();
    const idx = chestsList.findIndex(c => Math.floor(c.x) === tx && Math.floor(c.z) === tz);
    if (idx >= 0) openChestPanel(idx);
  }
  function pickChest(wx, wz) {
    let best = null, bd = Math.max(1.0, 10 / view.z);
    chestsList.forEach((c, index) => {
      const d = Math.hypot(c.x - wx, c.z - wz);
      if (d < bd) { bd = d; best = { chest: c, index }; }
    });
    return best;
  }
  // déplace un coffre (prop 'chest') et reporte son butin sur la nouvelle case
  function moveChestTo(index, tx, tz) {
    const c = chestsList[index];
    if (!c) return;
    const ox = Math.floor(c.x), oz = Math.floor(c.z);
    finishMove({ type: 'chest', x: c.x, z: c.z }, tx, tz); // déplace le prop (rebuild inclus)
    const loot = chestLootAt(ox, oz);
    if (loot) { loot.x = tx; loot.z = tz; }
  }
  function drawChests() {
    if (!showChests) return;
    const r = Math.max(6, view.z * 0.45);
    for (const c of chestsList) {
      const s = w2s(c.x, c.z);
      ctx.beginPath();
      ctx.rect(s.x - r, s.y - r, r * 2, r * 2);
      ctx.fillStyle = CHEST_COLOR;
      ctx.globalAlpha = 0.85; ctx.fill(); ctx.globalAlpha = 1;
      ctx.lineWidth = 1.5; ctx.strokeStyle = '#10202a'; ctx.stroke();
      ctx.font = `${Math.max(9, r * 1.1)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#10202a';
      ctx.fillText('🧰', s.x, s.y + r * 0.4);
      labelText(s.x, s.y - r - 5, chestLabel(c), CHEST_COLOR);
    }
  }
  // fiche d'un coffre : or min/max, objets (id + quantité + probabilité), clé requise
  function openChestPanel(index) {
    const c = chestsList[index];
    if (!c) return;
    closePanel();
    const tx = Math.floor(c.x), tz = Math.floor(c.z);
    const loot = c.loot || {};
    const gold = Array.isArray(loot.gold) ? [...loot.gold] : [0, 0];
    const items = structuredClone(Array.isArray(loot.items) ? loot.items : []); // état de travail
    const reqFlag = { v: typeof loot.reqFlag === 'string' ? loot.reqFlag : '' };
    const gMin = h('input', { type: 'number', min: '0', value: String(gold[0] || 0), style: { width: '70px' } });
    const gMax = h('input', { type: 'number', min: '0', value: String(gold[1] || 0), style: { width: '70px' } });
    const itemDefs = Object.entries(ITEMS).filter(([, d]) => d.slot !== 'gold' && !d.legacy);
    const rows = h('div');
    const itemOptions = (sel) => itemDefs
      .map(([id, d]) => `<option value="${id}"${id === sel ? ' selected' : ''}>${d.name}</option>`).join('');
    const renderRows = () => {
      rows.innerHTML = '';
      items.forEach((it, i) => {
        const search = h('input', { placeholder: '🔍 filtrer', value: '', style: { width: '110px' } });
        const sel = h('select', { innerHTML: itemOptions(it.defId), style: { width: '150px' } });
        sel.onchange = () => { it.defId = sel.value; };
        search.oninput = () => {
          const q = search.value.trim().toLowerCase();
          sel.innerHTML = itemDefs.filter(([id, d]) => !q || `${id} ${d.name}`.toLowerCase().includes(q) || id === it.defId)
            .map(([id, d]) => `<option value="${id}"${id === it.defId ? ' selected' : ''}>${d.name}</option>`).join('');
        };
        const n = h('input', { type: 'number', min: '1', max: '99', value: String(it.n || 1), title: 'quantité', style: { width: '48px' } });
        n.onchange = () => { it.n = Math.max(1, n.value | 0); };
        const ch = h('input', { type: 'number', min: '0', max: '1', step: '0.05', value: String(it.chance ?? 1), title: 'probabilité 0..1', style: { width: '60px' } });
        ch.onchange = () => { it.chance = Math.max(0, Math.min(1, +ch.value || 0)); };
        rows.append(h('div', { className: 'edit-dlg' },
          h('div', { className: 'edit-row' }, search, sel),
          h('div', { className: 'edit-row' }, 'n ', n, ' chance ', ch,
            h('button', { textContent: '✕', onclick: () => { items.splice(i, 1); renderRows(); } }))));
      });
    };
    renderRows();
    const flagInput = h('input', { value: reqFlag.v, placeholder: 'ex : clef_olin (vide : aucune)', style: { width: '100%' } });
    flagInput.onchange = () => { reqFlag.v = flagInput.value.trim(); };
    panelEl.append(
      panelTitle('Coffre au trésor'),
      h('div', { className: 'hint', textContent: `Case ${tx}, ${tz}. Vide : butin générique de la zone. Glissez le coffre pour le déplacer.` }),
      h('div', { className: 'edit-row' }, 'Or min ', gMin, ' max ', gMax),
      h('h4', { textContent: 'Objets (id, quantité, probabilité)' }),
      rows,
      h('button', { textContent: '+ objet', onclick: () => { items.push({ defId: itemDefs[0]?.[0], n: 1, chance: 1 }); renderRows(); } }),
      h('h4', { textContent: 'Clé requise (drapeau de quête)' }),
      flagInput,
      h('div', { className: 'edit-row' },
        h('button', {
          textContent: 'Appliquer',
          onclick: () => {
            pushHistory();
            const list = chestsOv();
            let entry = list.find(e => Math.floor(+e.x) === tx && Math.floor(+e.z) === tz);
            if (!entry) { entry = { x: tx, z: tz }; list.push(entry); }
            entry.gold = [Math.max(0, gMin.value | 0), Math.max(gMin.value | 0, gMax.value | 0)];
            entry.items = items.filter(it => ITEMS[it.defId]).map(it => ({
              defId: it.defId, n: Math.max(1, it.n | 0 || 1), chance: Math.max(0, Math.min(1, +it.chance || 0)),
            }));
            if (reqFlag.v) entry.reqFlag = reqFlag.v; else delete entry.reqFlag;
            refreshEditLayers();
            closePanel();
            msg('✔ Coffre configuré — « Enregistrer » pour l\'appliquer au serveur.');
          },
        }),
        h('button', {
          textContent: 'Supprimer', className: 'danger',
          onclick: () => {
            pushHistory();
            // retire le prop 'chest' et l'éventuelle entrée de butin
            const a0 = ov.props.add.length;
            ov.props.add = ov.props.add.filter(p => !(p.type === 'chest' && Math.floor(p.x) === tx && Math.floor(p.z) === tz));
            if (ov.props.add.length === a0) ov.props.remove.push([tx, tz]); // coffre du worldgen
            if (Array.isArray(ov.chests)) ov.chests = ov.chests.filter(e => !(Math.floor(+e.x) === tx && Math.floor(+e.z) === tz));
            rebuild();
            closePanel();
          },
        })),
    );
    panelEl.style.display = 'block';
  }

  // ---------- calque « Points spéciaux » : spawn / exit / teleport ----------
  function markersOv() {
    if (!Array.isArray(ov.markers)) ov.markers = [];
    return ov.markers;
  }
  function markerLabel(m) {
    let s = MARKER_NAMES[m.kind] || m.kind;
    if (m.target) s += ` → z${m.target.zoneId ?? '='} (${Math.floor(m.target.x)},${Math.floor(m.target.z)})`;
    return s;
  }
  function placeMarkerAt(tx, tz) {
    pendingPlace = null;
    pushHistory();
    const list = markersOv();
    list.push({ id: 'mk_' + Date.now().toString(36), kind: 'teleport', x: tx + 0.5, z: tz + 0.5, target: { zoneId: curZone, x: tx + 0.5, z: tz + 0.5 } });
    refreshEditLayers();
    openMarkerPanel(list.length - 1);
  }
  function pickMarker(wx, wz) {
    let best = null, bd = Math.max(1.0, 10 / view.z);
    markersList.forEach((m, index) => {
      const d = Math.hypot(m.x - wx, m.z - wz);
      if (d < bd) { bd = d; best = { marker: m, index }; }
    });
    return best;
  }
  function drawMarkers() {
    if (!showMarkers) return;
    const r = Math.max(6, view.z * 0.45);
    for (const m of markersList) {
      const color = MARKER_COLORS[m.kind] || '#fff';
      const s = w2s(m.x, m.z);
      ctx.beginPath();
      ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = 1.5; ctx.strokeStyle = '#10202a'; ctx.stroke();
      ctx.font = `${Math.max(10, r * 1.2)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#10202a';
      ctx.fillText(MARKER_GLYPHS[m.kind] || '?', s.x, s.y + r * 0.4);
      labelText(s.x, s.y - r - 5, markerLabel(m), color);
      // téléporteur : trait vers la destination si dans la même zone
      if (m.target && (m.target.zoneId == null || m.target.zoneId === curZone)) {
        const d = w2s(m.target.x, m.target.z);
        ctx.strokeStyle = color; ctx.globalAlpha = 0.5; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(d.x, d.y); ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
  }
  function moveMarkerTo(index, x, z) {
    const m = markersOv()[index];
    if (m) { m.x = x; m.z = z; }
  }
  // glisser un coffre ou un point spécial ; simple clic (sans mouvement) ouvre
  // la fiche au relâchement (cf. pointerup)
  function dragChestOrMarker(g) {
    if (!g.moved && Math.hypot(hover.x - g.w0.x, hover.z - g.w0.z) < 0.35) return;
    if (!g.pushed) { pushHistory(); g.pushed = true; }
    g.moved = true;
    const tx = Math.floor(hover.x), tz = Math.floor(hover.z);
    if (g.mode === 'chestMove') moveChestTo(g.index, tx, tz);
    else moveMarkerTo(g.index, tx + 0.5, tz + 0.5);
    refreshEditLayers();
  }
  // fiche d'un point spécial : type, et pour 'exit'/'teleport' la destination
  function openMarkerPanel(index) {
    const m = markersList[index];
    if (!m) return;
    closePanel();
    const kindSel = h('select', {
      innerHTML: ['spawn', 'exit', 'teleport'].map(k =>
        `<option value="${k}"${k === m.kind ? ' selected' : ''}>${MARKER_NAMES[k]}</option>`).join(''),
    });
    const target = m.target ? { ...m.target } : { zoneId: curZone, x: Math.floor(m.x) + 0.5, z: Math.floor(m.z) + 0.5 };
    const zoneSel = h('select', {
      innerHTML: zones.map(z => `<option value="${z.id}"${z.id === (target.zoneId ?? curZone) ? ' selected' : ''}>${z.id} — ${z.name}</option>`).join(''),
    });
    const txInput = h('input', { type: 'number', step: '0.5', value: String(target.x), style: { width: '70px' } });
    const tzInput = h('input', { type: 'number', step: '0.5', value: String(target.z), style: { width: '70px' } });
    const targetBox = h('div', {},
      h('h4', { textContent: 'Destination' }),
      h('div', { className: 'edit-row' }, 'Zone : ', zoneSel),
      h('div', { className: 'edit-row' }, 'x ', txInput, ' z ', tzInput),
      h('div', { className: 'hint', textContent: 'Marcher sur ce point téléporte le joueur ici.' }));
    const syncKind = () => { targetBox.style.display = kindSel.value === 'spawn' ? 'none' : ''; };
    kindSel.onchange = syncKind;
    syncKind();
    panelEl.append(
      panelTitle('Point spécial'),
      h('div', { className: 'hint', textContent: 'Glissez l\'icône pour déplacer le point. « apparition » remplace le point de spawn de la zone.' }),
      h('div', { className: 'edit-row' }, 'Type : ', kindSel),
      targetBox,
      h('div', { className: 'edit-row' },
        h('button', {
          textContent: 'Appliquer',
          onclick: () => {
            pushHistory();
            const real = markersOv()[index];
            if (!real) return;
            real.kind = kindSel.value;
            if (real.kind === 'spawn') delete real.target;
            else real.target = { zoneId: parseInt(zoneSel.value, 10), x: +txInput.value, z: +tzInput.value };
            refreshEditLayers();
            closePanel();
            msg('✔ Point spécial modifié — « Enregistrer » pour l\'appliquer au serveur.');
          },
        }),
        h('button', {
          textContent: 'Supprimer', className: 'danger',
          onclick: () => {
            pushHistory();
            markersOv().splice(index, 1);
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
    drawDayNightPreview(); // aperçu jour/nuit : voile d'obscurité + halos de lumière
    drawGrid();
    drawSelection();
    drawOverlays();
    drawCamps();
    drawNpcs();
    drawMusic();
    drawAmbience();
    drawLights();
    drawChests();
    drawMarkers();
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
  // Pot de peinture : remplit par contiguïté (4-voisins) toutes les tuiles du
  // MÊME type que la case cliquée, par la tuile sélectionnée. `global` = pas de
  // contrainte de contiguïté (toute la zone). File itérative (pas de récursion)
  // bornée à la zone entière (384² au pire). Intégré à undo/redo.
  function floodFill(cx, cz, global = false) {
    if (palTool.kind !== 'tile') return;
    const N = world.size;
    if (cx < 0 || cz < 0 || cx >= N || cz >= N) return;
    const target = world.tile[cz * N + cx];
    const replacement = palTool.tile;
    if (target === replacement) return; // rien à faire (évite une boucle vide)
    pushHistory();
    if (global) {
      for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
        if (world.tile[z * N + x] === target) {
          setTile(x, z, replacement);
          world.tile[z * N + x] = replacement; // suit l'état pour la 2e passe éventuelle
        }
      }
    } else {
      const seen = new Uint8Array(N * N);
      const queue = [cx, cz]; // file plate [x0,z0,x1,z1,...]
      seen[cz * N + cx] = 1;
      let head = 0;
      while (head < queue.length) {
        const x = queue[head++], z = queue[head++];
        setTile(x, z, replacement);
        world.tile[z * N + x] = replacement;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, nz = z + dz;
          if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
          const ni = nz * N + nx;
          if (!seen[ni] && world.tile[ni] === target) { seen[ni] = 1; queue.push(nx, nz); }
        }
      }
    }
    rebuild(); // reconstruit le monde (l'état tile a déjà été modifié, rebuild le ré-applique proprement)
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

  // ---------- copier / coller une région ----------
  // bornes normalisées (entiers, inclus) d'une sélection bornée à la zone
  function selBounds(s) {
    const N = world.size;
    return {
      x0: Math.max(0, Math.min(s.x0, s.x1)), x1: Math.min(N - 1, Math.max(s.x0, s.x1)),
      z0: Math.max(0, Math.min(s.z0, s.z1)), z1: Math.min(N - 1, Math.max(s.z0, s.z1)),
    };
  }
  // copie la région sélectionnée : tuiles ET props add à l'intérieur, en
  // coordonnées RELATIVES au coin haut-gauche (rejouables ailleurs).
  function copySelection() {
    if (!selection) { msg('Sélectionnez d\'abord une région (outil ⧉, glisser).'); return; }
    const b = selBounds(selection);
    const N = world.size;
    const tiles = [];
    for (let z = b.z0; z <= b.z1; z++) for (let x = b.x0; x <= b.x1; x++) {
      tiles.push([x - b.x0, z - b.z0, world.tile[z * N + x]]);
    }
    // décors présents dans la région (worldgen + overrides) — la pose recrée des props.add
    const props = [];
    for (const p of world.props) {
      const px = Math.floor(p.x), pz = Math.floor(p.z);
      if (px < b.x0 || px > b.x1 || pz < b.z0 || pz > b.z1) continue;
      const e = { type: p.type, dx: px - b.x0, dz: pz - b.z0 };
      if (p.v != null) e.v = p.v;
      if (Number.isFinite(p.s) && p.s !== 1) e.s = p.s;
      if (p.rot) e.rot = p.rot;
      props.push(e);
    }
    clipboard = { w: b.x1 - b.x0 + 1, h: b.z1 - b.z0 + 1, tiles, props };
    msg(`✔ Région copiée (${clipboard.w}×${clipboard.h}, ${tiles.length} tuiles, ${props.length} décors). Ctrl+V pour coller.`);
  }
  // colle le presse-papier au coin haut-gauche (tx, tz) : tuiles + props add décalés
  function pasteAt(tx, tz) {
    if (!clipboard) return;
    const N = world.size;
    pushHistory();
    for (const [dx, dz, t] of clipboard.tiles) {
      const x = tx + dx, z = tz + dz;
      if (x < 0 || z < 0 || x >= N || z >= N) continue;
      setTile(x, z, t);
    }
    for (const p of clipboard.props) {
      const x = tx + p.dx, z = tz + p.dz;
      if (x < 0 || z < 0 || x >= N || z >= N) continue;
      const e = { type: p.type, x, z };
      if (p.v != null) e.v = p.v;
      if (p.s != null) e.s = p.s;
      if (p.rot != null) e.rot = p.rot;
      ov.props.add.push(e);
    }
    rebuild();
    msg('✔ Région collée — « Enregistrer » pour l\'appliquer au serveur.');
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
    // collage en attente (Ctrl+V) : ce clic valide la pose au curseur
    if (pasting) { pasteAt(tx, tz); pasting = false; return; }
    // calques d'édition : pose armée (➕), puis saisie d'un PNJ ou d'un camp
    if (pendingPlace === 'camp') { placeCampAt(tx, tz); return; }
    if (pendingPlace === 'npc') { placeNpcAt(tx, tz); return; }
    if (pendingPlace === 'chest') { placeChestAt(tx, tz); return; }
    if (pendingPlace === 'marker') { placeMarkerAt(tx, tz); return; }
    if (pendingPlace === 'light') { placeLightAt(tx, tz); return; }
    if (pendingPlace === 'teleport-test') { teleportTestAt(tx, tz); return; }
    // pose d'une zone musicale / d'ambiance : glisser pour dessiner le rectangle (relâcher = poser)
    if (pendingPlace === 'music') { gesture = { mode: 'musicDraw', x0: wpt.x, z0: wpt.z }; return; }
    if (pendingPlace === 'ambience') { gesture = { mode: 'ambienceDraw', x0: wpt.x, z0: wpt.z }; return; }
    // pot de peinture : remplissage par contiguïté (Maj+clic : toute la zone)
    if (mode === 'fill') { floodFill(tx, tz, e.shiftKey); return; }
    // outil sélection : glisser pour définir la région à copier
    if (mode === 'select') { selection = null; gesture = { mode: 'select', x0: tx, z0: tz }; markDirty(); return; }
    // calques coffres / points : édition (clic sur l'icône) prioritaire
    if (showChests) {
      const hit = pickChest(wpt.x, wpt.z);
      if (hit) { gesture = { mode: 'chestMove', index: hit.index, w0: wpt, moved: false, pushed: false }; return; }
    }
    if (showMarkers) {
      const hit = pickMarker(wpt.x, wpt.z);
      if (hit) { gesture = { mode: 'markerMove', index: hit.index, w0: wpt, moved: false, pushed: false }; return; }
    }
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
    if (showLights) {
      const hit = pickLight(wpt.x, wpt.z);
      if (hit) { gesture = { mode: 'lightEdit', kind: hit.kind, index: hit.index, w0: wpt, moved: false, pushed: false }; return; }
    }
    if (showAmbience) {
      const hit = pickAmbience(wpt.x, wpt.z);
      if (hit) { gesture = { mode: 'ambienceEdit', kind: hit.kind, index: hit.index, w0: wpt, moved: false, pushed: false }; return; }
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
    } else if (gesture?.mode === 'ambienceEdit') {
      dragAmbience(gesture);
    } else if (gesture?.mode === 'lightEdit') {
      dragLight(gesture);
    } else if (gesture?.mode === 'chestMove' || gesture?.mode === 'markerMove') {
      dragChestOrMarker(gesture);
    }
    // musicDraw / select : l'aperçu du rectangle est dessiné par drawOverlays (markDirty)
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
    } else if (gesture.mode === 'ambienceDraw' && hover) {
      const dx = Math.abs(hover.x - gesture.x0), dz = Math.abs(hover.z - gesture.z0);
      if (dx >= AMBIENCE_MIN_SIZE || dz >= AMBIENCE_MIN_SIZE) placeAmbienceRect(gesture.x0, gesture.z0, hover.x, hover.z);
      else placeAmbienceRect(gesture.x0 - AMBIENCE_DEFAULT_W / 2, gesture.z0 - AMBIENCE_DEFAULT_H / 2,
        gesture.x0 + AMBIENCE_DEFAULT_W / 2, gesture.z0 + AMBIENCE_DEFAULT_H / 2);
    } else if (gesture.mode === 'ambienceEdit' && !gesture.moved) {
      openAmbiencePanel(gesture.index); // simple clic : la fiche de la zone d'ambiance
    } else if (gesture.mode === 'lightEdit' && !gesture.moved) {
      openLightPanel(gesture.index); // simple clic : la fiche de la lumière
    } else if (gesture.mode === 'select' && hover) {
      // fige la région sélectionnée (prête à copier)
      selection = { x0: gesture.x0, z0: gesture.z0, x1: Math.floor(hover.x), z1: Math.floor(hover.z) };
      msg('Région sélectionnée — Ctrl+C pour copier, Échap pour annuler.');
    } else if (gesture.mode === 'chestMove' && !gesture.moved) {
      openChestPanel(gesture.index); // simple clic : la fiche du coffre
    } else if (gesture.mode === 'markerMove' && !gesture.moved) {
      openMarkerPanel(gesture.index); // simple clic : la fiche du point spécial
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
    // copier / coller une région (presse-papier interne)
    else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyC') { e.preventDefault?.(); copySelection(); }
    else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyV') {
      e.preventDefault?.();
      if (clipboard) { pasting = true; msg('Collage : cliquez pour valider la position (Échap pour annuler).'); markDirty(); }
    }
    // Échap : annule sélection et collage en cours
    else if (e.code === 'Escape') { selection = null; pasting = false; pendingPlace = null; markDirty(); }
  });
  window.addEventListener('keyup', (e) => { if (e.code === 'Space') spaceHeld = false; });

  // ====================================================================
  // ÉDITEUR DE QUÊTES — couche d'édition de HAUT NIVEAU au-dessus des
  // structures existantes (dialogues de PNJ + drapeaux + reqFlag des coffres).
  // N'invente AUCUN moteur de quêtes côté serveur : tout repose sur les
  // drapeaux `p.flags` déjà gérés par server/game/dialogues.js et openChest.
  //
  // Convention : une quête = un préfixe de drapeau `quete:<id>:<n>`. Chaque
  // ÉTAPE n pose le drapeau `quete:<id>:<n>` et peut exiger celui de l'étape
  // précédente. Au chargement, on REMONTE les quêtes en scannant ces drapeaux
  // dans les dialogues (réactions/conditions) et les coffres (reqFlag).
  // ====================================================================
  const QUEST_RE = /^quete:([^:]+):(.+)$/;
  const questFlag = (id, n) => `quete:${id}:${n}`;

  // dialogues effectifs d'un PNJ (lecture) : custom -> def.dialogues ;
  // par défaut -> edit.dialogues sinon les dialogues de base
  function npcDialoguesRead(npcId) {
    const n = npcsList.find(e => e.npcId === npcId);
    return n && Array.isArray(n.def.dialogues) ? n.def.dialogues : [];
  }
  // écrit (ajoute/remplace) un dialogue sur un PNJ, repéré par le drapeau qu'il
  // pose (sa « signature » de quête) : custom -> entrée add ; défaut -> edit patch.
  function npcWriteQuestDialogue(npcId, setFlag, dlg) {
    const n = npcsList.find(e => e.npcId === npcId);
    if (!n) return;
    const o = npcsOv();
    let target; // objet portant le tableau dialogues
    if (n.custom) {
      target = o.add.find(e => e.id === npcId);
      if (!target) return;
    } else {
      o.edit ||= {};
      if (!o.edit[npcId]) {
        // patch initial : on repart des champs de base du PNJ pour ne rien perdre
        o.edit[npcId] = {
          name: n.def.name, role: npcRole(n.def),
          greetings: Array.isArray(n.def.greetings) ? [...n.def.greetings] : [],
          dialogues: structuredClone(Array.isArray(n.def.dialogues) ? n.def.dialogues : []),
        };
        if (Array.isArray(n.def.sells)) o.edit[npcId].sells = [...n.def.sells];
        if (Array.isArray(n.def.teaches)) o.edit[npcId].teaches = [...n.def.teaches];
      }
      target = o.edit[npcId];
    }
    target.dialogues ||= [];
    const i = target.dialogues.findIndex(d =>
      Array.isArray(d.reactions) && d.reactions.some(r => r.type === 'flag' && r.key === setFlag));
    if (i >= 0) target.dialogues[i] = dlg; else target.dialogues.push(dlg);
  }
  // retire le dialogue d'un PNJ qui pose un drapeau donné (suppression d'étape)
  function npcRemoveQuestDialogue(npcId, setFlag) {
    const o = npcsOv();
    const fromArr = (arr) => {
      if (!Array.isArray(arr)) return;
      const i = arr.findIndex(d => Array.isArray(d.reactions) && d.reactions.some(r => r.type === 'flag' && r.key === setFlag));
      if (i >= 0) arr.splice(i, 1);
    };
    o.add?.forEach(a => fromArr(a.dialogues));
    if (o.edit) for (const k of Object.keys(o.edit)) fromArr(o.edit[k].dialogues);
  }

  // Construit un dialogue T4C à partir d'une étape de quête.
  function buildStepDialogue(step) {
    const conditions = {};
    if (step.reqFlag) conditions.flag = step.reqFlag;          // exige l'étape précédente
    if (step.reqLevel > 0) conditions.level = step.reqLevel | 0;
    if (step.reqItem) { conditions.item = step.reqItem; if (step.consume) conditions.consume = true; }
    const reactions = [{ type: 'flag', key: step.flag }];       // pose le drapeau d'étape
    if (step.gold > 0) reactions.push({ type: 'gold', amount: step.gold | 0 });
    if (step.itemDefId) reactions.push({ type: 'item', defId: step.itemDefId, n: Math.max(1, step.itemN | 0 || 1) });
    if (step.xp > 0) reactions.push({ type: 'xp', amount: step.xp | 0 });
    if (step.tp && Number.isFinite(+step.tp.x) && Number.isFinite(+step.tp.z)) {
      reactions.push({ type: 'teleport', zoneId: step.tp.zoneId ?? undefined, x: +step.tp.x, z: +step.tp.z });
    }
    const dlg = { keywords: step.keywords.length ? step.keywords : ['quete'], reponse: step.reponse || '...', reactions };
    if (Object.keys(conditions).length) dlg.conditions = conditions;
    return dlg;
  }

  // Scanne les overrides de la zone et REMONTE les quêtes (groupées par id de
  // drapeau `quete:<id>:*`). Pour chaque drapeau on note qui le POSE (réaction
  // flag d'un dialogue PNJ) et qui le REQUIERT (condition d'un dialogue, reqFlag
  // d'un coffre). Sert à l'affichage de la chaîne ET à la validation d'intégrité.
  function scanQuests() {
    const quests = new Map(); // id -> { id, setters:Map(flag->{npcId,dlg}), refs:[{flag,kind,...}] }
    const get = (id) => {
      if (!quests.has(id)) quests.set(id, { id, flags: new Map(), refs: [] });
      return quests.get(id);
    };
    // dialogues de tous les PNJ effectifs
    for (const n of npcsList) {
      for (const dlg of Array.isArray(n.def.dialogues) ? n.def.dialogues : []) {
        for (const r of Array.isArray(dlg.reactions) ? dlg.reactions : []) {
          const m = r.type === 'flag' && QUEST_RE.exec(r.key || '');
          if (m) get(m[1]).flags.set(r.key, { npcId: n.npcId, npcName: n.def.name || n.npcId, dlg, set: true });
        }
        const cm = dlg.conditions?.flag && QUEST_RE.exec(dlg.conditions.flag);
        if (cm) get(cm[1]).refs.push({ flag: dlg.conditions.flag, kind: 'npc', npcId: n.npcId, npcName: n.def.name || n.npcId });
      }
    }
    // coffres (reqFlag) : référence un drapeau de quête. On lit directement
    // ov.chests (vérité des verrous), qu'un prop 'chest' existe ou non sur la case.
    for (const c of Array.isArray(ov.chests) ? ov.chests : []) {
      const f = c.reqFlag;
      const m = f && QUEST_RE.exec(f);
      if (m) get(m[1]).refs.push({ flag: f, kind: 'chest', x: Math.floor(+c.x), z: Math.floor(+c.z) });
    }
    return quests;
  }

  // Validation d'intégrité d'une quête : drapeaux EXIGÉS mais jamais POSÉS
  // (étape inatteignable) et drapeaux POSÉS mais jamais EXIGÉS (sans effet).
  function questIntegrity(q) {
    const set = new Set(q.flags.keys());
    const required = new Set(q.refs.map(r => r.flag));
    const orphanRefs = [...required].filter(f => !set.has(f));   // exigés sans poseur
    const deadFlags = [...set].filter(f => !required.has(f));    // posés sans usage
    return { orphanRefs, deadFlags };
  }

  // ---------- panneau « Quêtes » (vue de chaîne + édition par maillon) ----------
  const questPanel = $('quest-panel');
  let questModel = null; // quête en cours d'édition : { id, title, desc, steps:[] }

  function closeQuests() { questPanel.style.display = 'none'; questPanel.innerHTML = ''; questModel = null; markDirty(); }

  function openQuestEditor() {
    closePanel();
    questModel = null;
    renderQuestList();
    questPanel.style.display = 'block';
  }

  // liste des quêtes existantes (remontées du scan) + création
  function renderQuestList() {
    questPanel.innerHTML = '';
    questPanel.append(panelTitleEl('🗺 Éditeur de quêtes — zone ' + curZone, closeQuests));
    questPanel.append(h('div', { className: 'hint', textContent:
      'Une quête regroupe des étapes reliées par des drapeaux quete:<id>:<n>. Chaque étape : un PNJ (mot-clé) ou un coffre (verrou) → conditions → effets (drapeau, or/objet/xp, téléport). « Enregistrer la carte » applique au serveur.' }));
    const quests = scanQuests();
    const list = h('div');
    if (!quests.size) list.append(h('div', { className: 'hint', textContent: 'Aucune quête dans cette zone pour l\'instant.' }));
    for (const q of quests.values()) {
      const integ = questIntegrity(q);
      const card = h('div', { className: 'quest-card' });
      card.append(h('div', { className: 'edit-row' },
        h('b', { textContent: `Quête « ${q.id} »` }),
        h('span', { className: 'hint', textContent: `${q.flags.size} étape(s), ${q.refs.length} référence(s)` }),
        h('button', { textContent: 'Éditer', onclick: () => openQuestForm(q.id) })));
      // chaîne lisible : PNJ A (mot-clé) -> pose qN -> coffre exige qN ...
      card.append(renderChain(q));
      // intégrité
      if (integ.orphanRefs.length) card.append(h('div', { className: 'quest-bad', textContent:
        '⚠ Drapeaux exigés mais jamais posés (étape inatteignable) : ' + integ.orphanRefs.join(', ') }));
      if (integ.deadFlags.length) card.append(h('div', { className: 'quest-warn', textContent:
        '○ Drapeaux posés mais jamais exigés (sans effet) : ' + integ.deadFlags.join(', ') }));
      if (!integ.orphanRefs.length && !integ.deadFlags.length) card.append(h('div', { className: 'quest-ok', textContent: '✔ Intégrité : aucune incohérence détectée.' }));
      list.append(card);
    }
    questPanel.append(list);
    // création d'une nouvelle quête
    const idIn = h('input', { placeholder: 'id (ex : olin)', style: { width: '120px' } });
    const titleIn = h('input', { placeholder: 'titre', style: { width: '180px' } });
    questPanel.append(h('h3', { textContent: 'Nouvelle quête' }),
      h('div', { className: 'edit-row' }, 'id : ', idIn, ' titre : ', titleIn,
        h('button', { textContent: '+ créer', onclick: () => {
          const id = (idIn.value || '').trim().replace(/[^a-z0-9_]/gi, '').toLowerCase();
          if (!id) { msg('Donnez un id de quête (lettres/chiffres).'); return; }
          questModel = { id, title: titleIn.value.trim() || id, desc: '', steps: [] };
          renderQuestForm();
        } })));
  }

  // affiche la chaîne d'une quête remontée du scan (maillons ordonnés par drapeau)
  function renderChain(q) {
    const chain = h('div', { className: 'quest-chain' });
    const flags = [...q.flags.entries()].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));
    if (!flags.length) { chain.append(h('span', { className: 'hint', textContent: '(aucune étape posée)' })); return chain; }
    flags.forEach(([flag, info], i) => {
      if (i) chain.append(h('span', { className: 'quest-arrow', textContent: '→' }));
      const dlg = info.dlg;
      const kw = (dlg.keywords || [])[0] || '?';
      const cond = dlg.conditions?.flag ? ` exige ${shortFlag(dlg.conditions.flag)}` : '';
      const rew = (dlg.reactions || []).filter(r => r.type !== 'flag')
        .map(r => r.type === 'gold' ? `${r.amount} or` : r.type === 'xp' ? `${r.amount} xp` : r.type === 'item' ? `${r.n || 1}× ${r.defId}` : r.type === 'teleport' ? 'téléport' : r.type).join(', ');
      chain.append(h('span', { className: 'quest-link', textContent:
        `${info.npcName} (« ${kw} »)${cond} → pose ${shortFlag(flag)}${rew ? ' + ' + rew : ''}` }));
    });
    // coffres qui référencent un drapeau de la quête
    for (const r of q.refs.filter(r => r.kind === 'chest')) {
      chain.append(h('span', { className: 'quest-arrow', textContent: '→' }));
      chain.append(h('span', { className: 'quest-link', textContent: `🧰 coffre (${r.x},${r.z}) exige ${shortFlag(r.flag)}` }));
    }
    return chain;
  }
  const shortFlag = (f) => { const m = QUEST_RE.exec(f); return m ? `q${m[2]}` : f; };

  // formulaire d'édition d'une quête (liste d'étapes éditables -> génération)
  function openQuestForm(id) {
    // recharge le modèle depuis le scan (chaque drapeau posé = une étape)
    const q = scanQuests().get(id);
    const steps = [];
    if (q) {
      const flags = [...q.flags.entries()].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));
      for (const [flag, info] of flags) {
        const dlg = info.dlg;
        const reac = dlg.reactions || [];
        const gold = reac.find(r => r.type === 'gold');
        const item = reac.find(r => r.type === 'item');
        const xp = reac.find(r => r.type === 'xp');
        const tp = reac.find(r => r.type === 'teleport');
        const m = QUEST_RE.exec(flag);
        steps.push({
          n: m ? m[2] : String(steps.length + 1), flag,
          npcId: info.npcId, keywords: dlg.keywords || [], reponse: dlg.reponse || '',
          reqFlag: dlg.conditions?.flag || '', reqLevel: dlg.conditions?.level || 0,
          reqItem: dlg.conditions?.item || '', consume: !!dlg.conditions?.consume,
          gold: gold?.amount || 0, itemDefId: item?.defId || '', itemN: item?.n || 1,
          xp: xp?.amount || 0, tp: tp ? { zoneId: tp.zoneId ?? curZone, x: tp.x, z: tp.z } : null,
        });
      }
    }
    questModel = { id, title: id, desc: '', steps };
    renderQuestForm();
  }

  function renderQuestForm() {
    const m2 = questModel;
    questPanel.innerHTML = '';
    questPanel.append(panelTitleEl(`🗺 Quête « ${m2.id} »`, closeQuests));
    questPanel.append(h('button', { textContent: '← Liste des quêtes', onclick: renderQuestList }));
    const descIn = h('textarea', { value: m2.desc || '', placeholder: 'description (mémo d\'édition)', style: { width: '100%', height: '36px' } });
    descIn.onchange = () => { m2.desc = descIn.value; };
    questPanel.append(h('h3', { textContent: 'Description' }), descIn);
    const npcOptions = npcsList.map(n => `<option value="${n.npcId}">${n.def.name || n.npcId}</option>`).join('');
    const itemDefs = Object.entries(ITEMS).filter(([, d]) => d.slot !== 'gold' && !d.legacy);
    const itemOpts = (sel) => '<option value="">— aucun —</option>' + itemDefs.map(([id, d]) => `<option value="${id}"${id === sel ? ' selected' : ''}>${d.name}</option>`).join('');
    const stepsBox = h('div');
    const renderSteps = () => {
      stepsBox.innerHTML = '';
      m2.steps.forEach((s, i) => {
        s.flag = questFlag(m2.id, s.n || (i + 1));
        const card = h('div', { className: 'quest-step' });
        // déclencheur : PNJ (mot-clé). Le coffre se gère par son reqFlag dans sa fiche.
        const npcSel = h('select', { innerHTML: npcOptions });
        npcSel.value = s.npcId || npcsList[0]?.npcId || '';
        npcSel.onchange = () => { s.npcId = npcSel.value; };
        if (!s.npcId) s.npcId = npcSel.value;
        const kwIn = h('input', { value: (s.keywords || []).join(', '), placeholder: 'mots-clés', style: { width: '160px' } });
        kwIn.onchange = () => { s.keywords = kwIn.value.split(',').map(x => x.trim()).filter(Boolean); };
        const repIn = h('textarea', { value: s.reponse || '', placeholder: 'réponse du PNJ', style: { width: '100%', height: '34px' } });
        repIn.onchange = () => { s.reponse = repIn.value; };
        // conditions
        const reqFlagIn = h('input', { value: s.reqFlag || '', placeholder: 'drapeau requis (vide = aucun)', style: { width: '180px' } });
        reqFlagIn.onchange = () => { s.reqFlag = reqFlagIn.value.trim(); };
        const prevBtn = h('button', { textContent: '⟵ étape préc.', title: 'exiger le drapeau de l\'étape précédente',
          onclick: () => { if (i > 0) { s.reqFlag = m2.steps[i - 1].flag; renderSteps(); } } });
        const lvlIn = h('input', { type: 'number', min: '0', value: String(s.reqLevel || 0), style: { width: '54px' } });
        lvlIn.onchange = () => { s.reqLevel = Math.max(0, lvlIn.value | 0); };
        const itemSel = h('select', { innerHTML: itemOpts(s.reqItem) });
        itemSel.onchange = () => { s.reqItem = itemSel.value; };
        const consumeCb = h('input', { type: 'checkbox', checked: !!s.consume });
        consumeCb.onchange = () => { s.consume = consumeCb.checked; };
        // effets
        const goldIn = h('input', { type: 'number', min: '0', value: String(s.gold || 0), style: { width: '70px' } });
        goldIn.onchange = () => { s.gold = Math.max(0, goldIn.value | 0); };
        const rewSel = h('select', { innerHTML: itemOpts(s.itemDefId) });
        rewSel.onchange = () => { s.itemDefId = rewSel.value; };
        const rewN = h('input', { type: 'number', min: '1', value: String(s.itemN || 1), style: { width: '48px' } });
        rewN.onchange = () => { s.itemN = Math.max(1, rewN.value | 0); };
        const xpIn = h('input', { type: 'number', min: '0', value: String(s.xp || 0), style: { width: '70px' } });
        xpIn.onchange = () => { s.xp = Math.max(0, xpIn.value | 0); };
        const tpOn = h('input', { type: 'checkbox', checked: !!s.tp });
        const tpZone = h('select', { innerHTML: zones.map(z => `<option value="${z.id}"${(s.tp?.zoneId ?? curZone) === z.id ? ' selected' : ''}>${z.id} — ${z.name}</option>`).join('') });
        const tpX = h('input', { type: 'number', step: '0.5', value: String(s.tp?.x ?? ''), style: { width: '64px' } });
        const tpZ = h('input', { type: 'number', step: '0.5', value: String(s.tp?.z ?? ''), style: { width: '64px' } });
        const syncTp = () => {
          s.tp = tpOn.checked ? { zoneId: parseInt(tpZone.value, 10), x: +tpX.value, z: +tpZ.value } : null;
        };
        tpOn.onchange = syncTp; tpZone.onchange = syncTp; tpX.onchange = syncTp; tpZ.onchange = syncTp;
        card.append(
          h('div', { className: 'edit-row' }, h('b', { textContent: `Étape ${s.n || (i + 1)} → pose ${shortFlag(s.flag)}` }),
            h('button', { textContent: '✕', onclick: () => { m2.steps.splice(i, 1); renderSteps(); } })),
          h('div', { className: 'edit-row' }, 'Déclencheur — PNJ : ', npcSel, ' mot-clé : ', kwIn),
          repIn,
          h('h4', { textContent: 'Conditions' }),
          h('div', { className: 'edit-row' }, 'drapeau requis : ', reqFlagIn, prevBtn),
          h('div', { className: 'edit-row' }, 'niveau ≥ ', lvlIn, ' objet : ', itemSel, h('label', { className: 'edit-check' }, consumeCb, ' consommé')),
          h('h4', { textContent: 'Effets (récompenses, une seule fois sauf répétable)' }),
          h('div', { className: 'edit-row' }, 'or ', goldIn, ' objet ', rewSel, ' ×', rewN, ' xp ', xpIn),
          h('div', { className: 'edit-row' }, h('label', { className: 'edit-check' }, tpOn, ' téléport'), ' zone ', tpZone, ' x ', tpX, ' z ', tpZ));
        stepsBox.append(card);
      });
    };
    renderSteps();
    questPanel.append(h('h3', { textContent: 'Étapes (chaîne)' }), stepsBox);
    questPanel.append(h('button', { textContent: '+ étape', onclick: () => {
      const n = m2.steps.length + 1;
      const prev = m2.steps[m2.steps.length - 1];
      m2.steps.push({ n: String(n), flag: questFlag(m2.id, n), npcId: npcsList[0]?.npcId || '', keywords: [], reponse: '',
        reqFlag: prev ? prev.flag : '', reqLevel: 0, reqItem: '', consume: false, gold: 0, itemDefId: '', itemN: 1, xp: 0, tp: null });
      renderSteps();
    } }));
    questPanel.append(h('div', { className: 'edit-row', style: { marginTop: '10px' } },
      h('button', { textContent: '✔ Générer / mettre à jour', onclick: () => { generateQuest(m2); } }),
      h('button', { textContent: '↩ Annuler', onclick: renderQuestList })));
  }

  // GÉNÈRE les dialogues PNJ (et leurs flags/reqFlag) à partir du modèle de quête.
  function generateQuest(m2) {
    if (!m2.steps.length) { msg('Ajoutez au moins une étape.'); return; }
    pushHistory();
    for (const s of m2.steps) {
      s.flag = questFlag(m2.id, s.n);
      if (!s.npcId) continue;
      npcWriteQuestDialogue(s.npcId, s.flag, buildStepDialogue(s));
    }
    refreshEditLayers();
    msg(`✔ Quête « ${m2.id} » générée (${m2.steps.length} étape(s)) — « Enregistrer » pour l'appliquer au serveur.`);
    renderQuestList();
  }

  // titre de panneau réutilisable avec bouton de fermeture personnalisé
  function panelTitleEl(text, onClose) {
    return h('div', { className: 'edit-panel-title' },
      h('span', { textContent: text }),
      h('button', { textContent: '✕', onclick: onClose }));
  }

  // ---------- barre d'outils ----------
  function setMode(m) {
    mode = m;
    if (m !== 'select') selection = null; // quitter l'outil sélection efface la région
    pasting = false;
    $('tool-paint').classList.toggle('active', m === 'paint');
    $('tool-fill')?.classList.toggle('active', m === 'fill');
    $('tool-select')?.classList.toggle('active', m === 'select');
    $('tool-erase').classList.toggle('active', m === 'erase');
    $('tool-move').classList.toggle('active', m === 'move');
    markDirty();
  }
  $('tool-paint').onclick = () => setMode('paint');
  $('tool-fill')?.addEventListener('click', () => setMode('fill'));
  $('tool-select')?.addEventListener('click', () => { setMode('select'); msg('Glissez pour sélectionner une région, puis Ctrl+C / Ctrl+V.'); });
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
  // calques Ambiance / Lumières
  $('layer-ambience')?.addEventListener('change', () => { showAmbience = $('layer-ambience').checked; markDirty(); });
  $('layer-lights')?.addEventListener('change', () => { showLights = $('layer-lights').checked; markDirty(); });
  $('add-ambience')?.addEventListener('click', () => {
    $('layer-ambience').checked = true; showAmbience = true;
    pendingPlace = 'ambience';
    msg('Glissez sur la carte pour dessiner la zone d\'ambiance (teinte/obscurité ; passable en cercle dans la fiche).');
  });
  $('add-light')?.addEventListener('click', () => {
    $('layer-lights').checked = true; showLights = true;
    pendingPlace = 'light';
    msg('Cliquez sur la carte pour poser une source de lumière (sa fiche règle rayon/couleur/scintillement).');
  });
  // aperçu jour/nuit : bascule l'éclairage de l'éditeur sans lancer le jeu
  $('preview-daynight')?.addEventListener('click', () => {
    dayPreview = dayPreview === 'night' ? null : (dayPreview === 'day' ? 'night' : 'day');
    const label = dayPreview === 'day' ? '☀ Aperçu : jour' : dayPreview === 'night' ? '🌙 Aperçu : nuit' : '🌓 Aperçu jour/nuit';
    const btn = $('preview-daynight');
    if (btn) btn.textContent = label;
    markDirty();
  });
  // calques Coffres / Points spéciaux
  $('layer-chests')?.addEventListener('change', () => { showChests = $('layer-chests').checked; markDirty(); });
  $('layer-markers')?.addEventListener('change', () => { showMarkers = $('layer-markers').checked; markDirty(); });
  $('add-chest')?.addEventListener('click', () => {
    $('layer-chests').checked = true; showChests = true;
    pendingPlace = 'chest';
    msg('Cliquez sur la carte pour poser le coffre (sa fiche configure le contenu).');
  });
  $('add-marker')?.addEventListener('click', () => {
    $('layer-markers').checked = true; showMarkers = true;
    pendingPlace = 'marker';
    msg('Cliquez sur la carte pour poser le point spécial (sa fiche choisit le type et la destination).');
  });
  // éditeur de quêtes : ouvre le panneau de chaîne (vue de haut niveau)
  $('open-quests')?.addEventListener('click', openQuestEditor);
  // « Tester ici » : arme le prochain clic pour téléporter le perso connecté en jeu
  $('tp-here')?.addEventListener('click', () => {
    pendingPlace = 'teleport-test';
    msg('Cliquez sur la carte : votre personnage connecté en jeu y sera téléporté.');
  });
  // téléporte le personnage EN LIGNE de ce compte admin sur la case cliquée
  async function teleportTestAt(tx, tz) {
    pendingPlace = null;
    try {
      await api('/api/admin/teleport', 'POST', { zoneId: curZone, x: tx + 0.5, z: tz + 0.5 });
      msg(`✔ Personnage téléporté en ${tx}, ${tz}.`);
    } catch (e) { msg('✘ ' + e.message); }
  }

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
    closeQuests();
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
    setMode,
    rebuildNow: rebuild,
    // pot de peinture / copier-coller
    floodFill,
    selectRegion: (x0, z0, x1, z1) => { selection = { x0, z0, x1, z1 }; markDirty(); },
    copySelection,
    getClipboard: () => clipboard,
    pasteAt,
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
    // calques coffres / points spéciaux
    getChests: () => chestsList,
    getMarkers: () => markersList,
    placeChestAt,
    placeMarkerAt,
    openChestPanel,
    openMarkerPanel,
    // calques ambiance / lumières + aperçu jour/nuit
    getAmbience: () => ambienceList,
    getLights: () => lightsList,
    placeAmbienceRect,
    placeAmbienceCircle,
    placeLightAt,
    openAmbiencePanel,
    openLightPanel,
    setDayPreview: (v) => { dayPreview = v; markDirty(); },
    getDayPreview: () => dayPreview,
    // éditeur de quêtes (vue de haut niveau au-dessus des dialogues + flags)
    openQuestEditor,
    scanQuests: () => scanQuests(),
    questIntegrity: (id) => { const q = scanQuests().get(id); return q ? questIntegrity(q) : null; },
    generateQuest,           // génère/met à jour les dialogues d'une quête (modèle d'étapes)
    questFlag,
  };
}
