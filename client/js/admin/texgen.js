// Générateur de matériaux CÔTÉ NAVIGATEUR : à partir d'une TEXTURE carrée
// tuilable (photo CC0, IA en mode tiling...), fabrique les pièces de jeu —
//   murs   : 10 pièces d'arête (ex/ez/poteau/tour/6 pignons), mêmes frames que
//            les wall_proc_* bakés (l'outil de tracé fonctionne tel quel) ;
//   toits  : 6 pièces (faîtes + pans avant/arrière en x et z) ;
//   sols   : 16 variantes sans couture (grille 4x4, choix par position) + 8 bords.
// Portage canvas de tools/poc/materials.py + floors.py : le CODE gère la
// structure (projection, orientation, ancres), la texture apporte la qualité.
// Tout est calculé sur ImageData (aucune dépendance, offline).

export const HW = 96, HH = 48;               // demi-tuile écran (renderer.js)
const CW = 340, CH = 340, OXo = 170, OYo = 230; // canvas de travail + origine
const SH_TOP = 1.04, SH_SE = 0.9, SH_SW = 0.66; // ombrage directionnel constant
const WALL_H = 78, WALL_T = 0.14, WALL_CP = 9;  // hauteur / épaisseur / parapet
const HB = 86, RISE = 46, OVER = 0.15;          // toits : base, faîte, débord
const SH_ROOF_AV = 0.98, SH_ROOF_AR = 0.78;
const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];

// ---------- lecture de la texture source ----------
// Renvoie { data, w, h } (RGBA) ; l'image est rééchantillonnée à 512px si besoin.
export function readTexture(img, size = 512) {
  const cv = document.createElement('canvas');
  cv.width = size; cv.height = size;
  const g = cv.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingEnabled = true;
  g.drawImage(img, 0, 0, size, size);
  return { data: g.getImageData(0, 0, size, size).data, w: size, h: size };
}

// Test de couture : décale la texture de moitié et mesure la discontinuité
// moyenne le long des axes centraux. Renvoyé à l'UI comme avertissement.
export function seamScore(tex) {
  const { data, w, h } = tex;
  let d = 0, n = 0;
  for (let y = 0; y < h; y++) {          // couture verticale (bord gauche vs droit)
    const a = (y * w + 0) * 4, b = (y * w + (w - 1)) * 4;
    d += Math.abs(data[a] - data[b]) + Math.abs(data[a + 1] - data[b + 1]) + Math.abs(data[a + 2] - data[b + 2]);
    n++;
  }
  for (let x = 0; x < w; x++) {          // couture horizontale
    const a = (0 * w + x) * 4, b = ((h - 1) * w + x) * 4;
    d += Math.abs(data[a] - data[b]) + Math.abs(data[a + 1] - data[b + 1]) + Math.abs(data[a + 2] - data[b + 2]);
    n++;
  }
  return d / (n * 3); // 0 = parfait ; > ~25 : couture probablement visible
}

// Correction de couture : fondu croisé des bords (rend la texture tuilable).
export function makeSeamless(tex, band = 0.12) {
  const { data, w, h } = tex;
  const out = new Uint8ClampedArray(data);
  const bw = Math.floor(w * band), bh = Math.floor(h * band);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < bw; x++) {
      const t = 0.5 - 0.5 * (x / bw);      // 0.5 au bord -> 0 au fond de bande
      const i = (y * w + x) * 4, j = (y * w + (w - 1 - x)) * 4;
      for (let c = 0; c < 3; c++) {
        const a = data[i + c], b = data[j + c];
        out[i + c] = a * (1 - t) + b * t;
        out[j + c] = b * (1 - t) + a * t;
      }
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < bh; y++) {
      const t = 0.5 - 0.5 * (y / bh);
      const i = (y * w + x) * 4, j = ((h - 1 - y) * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        const a = out[i + c], b = out[j + c];
        out[i + c] = a * (1 - t) + b * t;
        out[j + c] = b * (1 - t) + a * t;
      }
    }
  }
  return { data: out, w, h };
}

// version éclaircie (chemin de ronde / faîtage) : simple gain
function lightened(tex, k = 1.22) {
  const out = new Uint8ClampedArray(tex.data);
  for (let i = 0; i < out.length; i += 4) {
    out[i] = Math.min(255, out[i] * k);
    out[i + 1] = Math.min(255, out[i + 1] * k);
    out[i + 2] = Math.min(255, out[i + 2] * k);
  }
  return { data: out, w: tex.w, h: tex.h };
}

// ---------- rasterisation d'un quad texturé (portage de fill_quad) ----------
function w2s(x, z) { return [(x - z) * HW, (x + z) * HH]; }
function Pt(x, z, y = 0) { const [sx, sy] = w2s(x, z); return [sx + OXo, sy + OYo - y]; }

// quad = [bl, br, tr, tl] ; s le long de bl->br (wrap), t de bl->tl (hauteur)
function fillQuad(buf, quad, tex, shade, { ao = 0, wrap = 1, vgrad = 0.12 } = {}) {
  const [bl, br, tr, tl] = quad;
  const e1 = [br[0] - bl[0], br[1] - bl[1]], e2 = [tl[0] - bl[0], tl[1] - bl[1]];
  const det = e1[0] * e2[1] - e1[1] * e2[0];
  if (Math.abs(det) < 1e-6) return;
  const i00 = e2[1] / det, i01 = -e2[0] / det, i10 = -e1[1] / det, i11 = e1[0] / det;
  const xs = [bl[0], br[0], tr[0], tl[0]], ys = [bl[1], br[1], tr[1], tl[1]];
  const x0 = Math.max(0, Math.floor(Math.min(...xs))), x1 = Math.min(CW, Math.ceil(Math.max(...xs)));
  const y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(CH, Math.ceil(Math.max(...ys)));
  const { data, w: TWd, h: THd } = tex;
  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      const rx = px + 0.5 - bl[0], ry = py + 0.5 - bl[1];
      const s = i00 * rx + i01 * ry, t = i10 * rx + i11 * ry;
      if (s < 0 || s > 1 || t < 0 || t > 1) continue;
      const tsx = Math.min(TWd - 1, Math.floor(((s * wrap) % 1 + 1) % 1 * TWd));
      const tc = Math.max(0, Math.min(1, t));
      const tsy = Math.min(THd - 1, Math.floor((1 - tc) * (THd - 1)));
      const si = (tsy * TWd + tsx) * 4;
      let sh = shade * (1 - ao * (1 - tc));
      if (tc < 0.04) sh *= 0.6;                     // ligne de contact au sol
      sh *= (1 - vgrad * (1 - tc) * 0);             // (vgrad replié dans ao)
      const di = (py * CW + px) * 4;
      buf[di] = Math.min(255, data[si] * sh);
      buf[di + 1] = Math.min(255, data[si + 1] * sh);
      buf[di + 2] = Math.min(255, data[si + 2] * sh);
      buf[di + 3] = 255;
    }
  }
}

function newBuf() { return new Uint8ClampedArray(CW * CH * 4); }

// rogne le buffer sur son contenu et renvoie { canvas, ox, oy } (ancre au point de pose)
function cropAt(buf, ax, az) {
  let x0 = CW, x1 = 0, y0 = CH, y1 = 0;
  for (let y = 0; y < CH; y++) {
    for (let x = 0; x < CW; x++) {
      if (buf[(y * CW + x) * 4 + 3] > 0) {
        if (x < x0) x0 = x; if (x + 1 > x1) x1 = x + 1;
        if (y < y0) y0 = y; if (y + 1 > y1) y1 = y + 1;
      }
    }
  }
  if (x1 <= x0) { x0 = 0; x1 = 1; y0 = 0; y1 = 1; }
  const w = x1 - x0, h = y1 - y0;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const g = cv.getContext('2d');
  const img = new ImageData(w, h);
  for (let y = 0; y < h; y++) {
    img.data.set(buf.subarray(((y + y0) * CW + x0) * 4, ((y + y0) * CW + x1) * 4), y * w * 4);
  }
  g.putImageData(img, 0, 0);
  const [gx, gy] = w2s(ax, az);
  return { canvas: cv, ox: Math.round(gx + OXo - x0), oy: Math.round(gy + OYo - y0) };
}

// ---------- pièces de MUR (mêmes frames que wall_proc_* : cf. materials.py) ----------
function edgeX(buf, tex, cap, H, t, cp) {
  fillQuad(buf, [Pt(0, -t, H), Pt(1, -t, H), Pt(1, -t, H + cp), Pt(0, -t, H + cp)], cap, SH_SW * 0.9, { wrap: 1.1 });
  fillQuad(buf, [Pt(0, -t, H), Pt(1, -t, H), Pt(1, t, H), Pt(0, t, H)], cap, SH_TOP, { wrap: 1.1 });
  fillQuad(buf, [Pt(0, t, 0), Pt(1, t, 0), Pt(1, t, H), Pt(0, t, H)], tex, SH_SW, { ao: 0.4, wrap: 1.1 });
  fillQuad(buf, [Pt(0, t, H), Pt(1, t, H), Pt(1, t, H + cp), Pt(0, t, H + cp)], cap, SH_SW * 1.06, { wrap: 1.1 });
}
function edgeZ(buf, tex, cap, H, t, cp) {
  fillQuad(buf, [Pt(-t, 0, H), Pt(-t, 1, H), Pt(-t, 1, H + cp), Pt(-t, 0, H + cp)], cap, SH_SE * 0.9, { wrap: 1.1 });
  fillQuad(buf, [Pt(-t, 0, H), Pt(-t, 1, H), Pt(t, 1, H), Pt(t, 0, H)], cap, SH_TOP, { wrap: 1.1 });
  fillQuad(buf, [Pt(t, 0, 0), Pt(t, 1, 0), Pt(t, 1, H), Pt(t, 0, H)], tex, SH_SE, { ao: 0.4, wrap: 1.1 });
  fillQuad(buf, [Pt(t, 0, H), Pt(t, 1, H), Pt(t, 1, H + cp), Pt(t, 0, H + cp)], cap, SH_SE * 1.06, { wrap: 1.1 });
}
function post(buf, tex, cap, H, t, cp) {
  fillQuad(buf, [Pt(-t, -t, H), Pt(t, -t, H), Pt(t, t, H), Pt(-t, t, H)], cap, SH_TOP);
  fillQuad(buf, [Pt(-t, t, 0), Pt(t, t, 0), Pt(t, t, H), Pt(-t, t, H)], tex, SH_SW, { ao: 0.4 });
  fillQuad(buf, [Pt(t, -t, 0), Pt(t, t, 0), Pt(t, t, H), Pt(t, -t, H)], tex, SH_SE, { ao: 0.4 });
  fillQuad(buf, [Pt(-t, t, H), Pt(t, t, H), Pt(t, t, H + cp), Pt(-t, t, H + cp)], cap, SH_SW * 1.06);
}
function tour(buf, tex, cap, H) {
  const tt = 0.34, Ht = H + 30;
  fillQuad(buf, [Pt(-tt, tt, 0), Pt(tt, tt, 0), Pt(tt, tt, Ht), Pt(-tt, tt, Ht)], tex, SH_SW, { ao: 0.45 });
  fillQuad(buf, [Pt(tt, -tt, 0), Pt(tt, tt, 0), Pt(tt, tt, Ht), Pt(tt, -tt, Ht)], tex, SH_SE, { ao: 0.45 });
  fillQuad(buf, [Pt(-tt, -tt, Ht), Pt(tt, -tt, Ht), Pt(tt, tt, Ht), Pt(-tt, tt, Ht)], cap, SH_TOP);
  for (const fx of [-tt, -0.06, tt - 0.12]) {
    fillQuad(buf, [Pt(fx, tt, Ht), Pt(fx + 0.12, tt, Ht), Pt(fx + 0.12, tt, Ht + 16), Pt(fx, tt, Ht + 16)], cap, SH_SW * 1.05);
  }
}
function pignon(buf, tex, axis, shape, t) {
  const SH = axis === 'ez' ? SH_SE : SH_SW;
  const Q = (a, y) => axis === 'ez' ? Pt(t, a, y) : Pt(a, t, y);
  let quad;
  if (shape === 'plein') quad = [Q(0, HB), Q(1, HB), Q(0.5, HB + RISE), Q(0.5, HB + RISE)];
  else if (shape === 'mont') quad = [Q(0, HB), Q(1, HB), Q(1, HB + RISE), Q(1, HB + RISE)];
  else quad = [Q(0, HB), Q(1, HB), Q(0, HB + RISE), Q(0, HB + RISE)];
  fillQuad(buf, quad, tex, SH, { wrap: 1.1 });
}

export const WALL_KINDS = [
  ['ex', 'Mur ↘ (arête)'], ['ez', 'Mur ↙ (arête)'],
  ['post', 'Poteau / jonction'], ['tour', 'Tour'],
  ['pignon_ez', 'Pignon ↙ plein'], ['pignon_ez_mont', 'Pignon ↙ montant'], ['pignon_ez_desc', 'Pignon ↙ descendant'],
  ['pignon_ex', 'Pignon ↘ plein'], ['pignon_ex_mont', 'Pignon ↘ montant'], ['pignon_ex_desc', 'Pignon ↘ descendant'],
];
export function wallPieces(tex) {
  const cap = lightened(tex);
  return WALL_KINDS.map(([kind, name]) => {
    const buf = newBuf();
    let a = [0, 0];
    if (kind === 'ex') { edgeX(buf, tex, cap, WALL_H, WALL_T, WALL_CP); a = [0.5, 0]; }
    else if (kind === 'ez') { edgeZ(buf, tex, cap, WALL_H, WALL_T, WALL_CP); a = [0, 0.5]; }
    else if (kind === 'tour') { tour(buf, tex, cap, WALL_H); a = [0, 0]; }
    else if (kind.startsWith('pignon_')) {
      const axis = kind.startsWith('pignon_ez') ? 'ez' : 'ex';
      const shape = (kind === 'pignon_ez' || kind === 'pignon_ex') ? 'plein' : (kind.endsWith('mont') ? 'mont' : 'desc');
      pignon(buf, tex, axis, shape, WALL_T);
      a = axis === 'ez' ? [0, 0.5] : [0.5, 0];
    } else { post(buf, tex, cap, WALL_H, WALL_T, WALL_CP); a = [0, 0]; }
    return { name, ...cropAt(buf, a[0], a[1]) };
  });
}

// ---------- pièces de TOIT ----------
export const ROOF_KINDS = [
  ['faite_x', 'Faîte ↘ (2 pans)'], ['faite_z', 'Faîte ↙ (2 pans)'],
  ['pan_x_av', 'Pan ↘ avant'], ['pan_x_ar', 'Pan ↘ arrière'],
  ['pan_z_av', 'Pan ↙ avant'], ['pan_z_ar', 'Pan ↙ arrière'],
];
export function roofPieces(tex) {
  const o = OVER;
  const Q = {
    faite_x: [[[-o, .5, HB + RISE], [1 + o, .5, HB + RISE], [1 + o, -o, HB], [-o, -o, HB], SH_ROOF_AR],
              [[-o, .5, HB + RISE], [1 + o, .5, HB + RISE], [1 + o, 1 + o, HB], [-o, 1 + o, HB], SH_ROOF_AV]],
    faite_z: [[[.5, -o, HB + RISE], [.5, 1 + o, HB + RISE], [-o, 1 + o, HB], [-o, -o, HB], SH_ROOF_AR],
              [[.5, -o, HB + RISE], [.5, 1 + o, HB + RISE], [1 + o, 1 + o, HB], [1 + o, -o, HB], SH_ROOF_AV]],
    pan_x_av: [[[-o, 0, HB + RISE], [1 + o, 0, HB + RISE], [1 + o, 1 + o, HB], [-o, 1 + o, HB], SH_ROOF_AV]],
    pan_x_ar: [[[-o, 1, HB + RISE], [1 + o, 1, HB + RISE], [1 + o, -o, HB], [-o, -o, HB], SH_ROOF_AR]],
    pan_z_av: [[[0, -o, HB + RISE], [0, 1 + o, HB + RISE], [1 + o, 1 + o, HB], [1 + o, -o, HB], SH_ROOF_AV]],
    pan_z_ar: [[[1, -o, HB + RISE], [1, 1 + o, HB + RISE], [-o, 1 + o, HB], [-o, -o, HB], SH_ROOF_AR]],
  };
  return ROOF_KINDS.map(([kind, name]) => {
    const buf = newBuf();
    for (const [a, b, c, d, sh] of Q[kind]) {
      fillQuad(buf, [Pt(...a), Pt(...b), Pt(...c), Pt(...d)], tex, sh, { wrap: 1.2 });
    }
    return { name, ...cropAt(buf, 0.5, 0.5) };
  });
}

// ---------- SOLS : 16 variantes (grille 4x4) + 8 bords tramés ----------
const FLOOR_EDGES = ['N', 'S', 'O', 'E', 'NO', 'NE', 'SO', 'SE'];
export function floorPieces(tex) {
  const P = 4, UNIT = Math.floor(tex.w / P);
  const out = [];
  const mkTile = (tx, tz, maskKind) => {
    const cv = document.createElement('canvas');
    cv.width = 2 * HW; cv.height = 2 * HH;
    const g = cv.getContext('2d');
    const img = new ImageData(2 * HW, 2 * HH);
    for (let py = 0; py < 2 * HH; py++) {
      for (let px = 0; px < 2 * HW; px++) {
        const A = (px + 0.5 - HW) / HW, B = (py + 0.5) / HH;
        const u = (A + B) / 2, v = (B - A) / 2;
        if (u < 0 || u >= 1 || v < 0 || v >= 1) continue;
        let alpha = 255;
        if (maskKind) {
          let m;
          if (maskKind === 'N') m = Math.min(1, (1 - v) * 2.2);
          else if (maskKind === 'S') m = Math.min(1, v * 2.2);
          else if (maskKind === 'O') m = Math.min(1, (1 - u) * 2.2);
          else if (maskKind === 'E') m = Math.min(1, u * 2.2);
          else if (maskKind === 'NO') m = Math.min(1, Math.min(1 - u, 1 - v) * 2.6);
          else if (maskKind === 'NE') m = Math.min(1, Math.min(u, 1 - v) * 2.6);
          else if (maskKind === 'SO') m = Math.min(1, Math.min(1 - u, v) * 2.6);
          else m = Math.min(1, Math.min(u, v) * 2.6);
          alpha = m > (BAYER[py % 4][px % 4] / 16) ? 255 : 0;
          if (!alpha) continue;
        }
        const sx = Math.floor(((tx + u) * UNIT) % tex.w);
        const sy = Math.floor(((tz + v) * UNIT) % tex.h);
        const si = (sy * tex.w + sx) * 4, di = (py * 2 * HW + px) * 4;
        img.data[di] = tex.data[si]; img.data[di + 1] = tex.data[si + 1];
        img.data[di + 2] = tex.data[si + 2]; img.data[di + 3] = alpha;
      }
    }
    g.putImageData(img, 0, 0);
    return { canvas: cv, ox: HW, oy: HH };
  };
  for (let tz = 0; tz < P; tz++) {
    for (let tx = 0; tx < P; tx++) out.push({ name: `variante ${tz * P + tx + 1}`, ...mkTile(tx, tz, null) });
  }
  for (const k of FLOOR_EDGES) out.push({ name: `bord ${k}`, ...mkTile(0, 0, k) });
  return out;
}

// ---------- assemblage de l'atlas + payload pour POST /api/admin/tiles ----------
export function buildAtlas(pieces, pad = 2, cols = 6) {
  const tw = Math.max(...pieces.map(p => p.canvas.width));
  const th = Math.max(...pieces.map(p => p.canvas.height));
  const rows = Math.ceil(pieces.length / cols);
  const cv = document.createElement('canvas');
  cv.width = cols * (tw + pad) - pad;
  cv.height = rows * (th + pad) - pad;
  const g = cv.getContext('2d');
  const tiles = {}, names = [];
  pieces.forEach((p, i) => {
    const x = (i % cols) * (tw + pad), y = Math.floor(i / cols) * (th + pad);
    g.drawImage(p.canvas, x, y);
    tiles[String(i)] = [x, y, p.canvas.width, p.canvas.height, p.ox, p.oy];
    names.push(p.name);
  });
  return { canvas: cv, tiles, names, dataBase64: cv.toDataURL('image/png').split(',')[1] };
}
