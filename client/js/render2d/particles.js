// Système de particules canvas 2D des effets visuels (sorts, auras, événements).
// Pools fixes pré-alloués : AUCUNE allocation par particule, on recycle les
// emplacements les plus anciens. Coordonnées monde (x, z) + hauteur écran (h,
// en pixels non zoomés) ; une particule peut être ACCROCHÉE à une ancre (vue
// d'entité, { x, z }) : elle suit alors le personnage qui se déplace.
//
// Coût de rendu : chaque forme est précalculée une fois par couleur en petite
// image (drawImage), au lieu d'un tracé de cercle par particule ; les
// « primitives » (bulle, anneau, lueur) coûtent un seul drawImage pour tout un
// effet. Quand l'écran est chargé (15 joueurs sous aura...), les émissions
// continues ralentissent d'elles-mêmes (facteurCharge).
import { settings } from '../settings.js';
import { elementCanonique } from '../../../shared/constants.js';

const MAX = 1600;      // particules simultanées
const MAX_PRIM = 96;   // primitives simultanées (bulles, anneaux, lueurs)
const HW = 96, HH = 48; // demi-tuile écran (renderer.js)
const RAC2 = Math.SQRT2;
const FONDU_FIN = 0.25; // s : disparition d'une primitive persistante arrêtée

// Densité FX choisie dans les paramètres (0..1) : chaque émetteur multiplie son
// nombre de particules par ce facteur. 0 = aucune particule ; sinon au moins 1
// (un effet ne disparaît jamais totalement tant que la densité est > 0).
function densite() {
  return Number.isFinite(+settings.fxDensity) ? Math.max(0, Math.min(1, +settings.fxDensity)) : 1;
}
function densify(count) {
  const d = densite();
  if (d <= 0) return 0;
  return Math.max(1, Math.round(count * d));
}

// ---------- images précalculées ----------
const rgb = (hex) => {
  let h = String(hex || '#ffffff').replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

// « Couleur du sort » : l'entrée COULEUR_SORT d'une liste de couleurs est
// remplacée par la couleur du sort qui joue l'effet (les autres restent) ;
// sans sort coloré, elle prend la première autre couleur de la couche.
export const COULEUR_SORT = 'sort';
function couleursDe(L, teinte) {
  const c = L.colors?.length ? L.colors : ['#ffffff'];
  if (!c.includes(COULEUR_SORT)) return c;
  const repli = teinte || c.find(x => x !== COULEUR_SORT) || '#ffffff';
  return c.map(x => (x === COULEUR_SORT ? repli : x));
}
const cache = new Map();
function toile(n) {
  const cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(n, n) : Object.assign(document.createElement('canvas'), { width: n, height: n });
  return [cv, cv.getContext('2d')];
}
// formes de particule (32 px) et de primitive (128 px), une par couleur
export const FORMES = [['doux', 'Lueur douce'], ['net', 'Disque net'], ['etincelle', 'Étincelle (traînée)'], ['etoile', 'Étoile'], ['anneau', 'Anneau'], ['fumee', 'Fumée']];
function sprite(forme, couleur) {
  const cle = forme + couleur;
  let cv = cache.get(cle);
  if (cv) return cv;
  const c = rgb(couleur);
  const grand = forme === 'bulle' || forme === 'sol' || forme === 'lueur';
  const N = grand ? 128 : 32, m = N / 2;
  let g;
  [cv, g] = toile(N);
  const radial = (r0, stops) => {
    const gr = g.createRadialGradient(m, m, r0, m, m, m);
    for (const [o, a] of stops) gr.addColorStop(o, rgba(c, a));
    g.fillStyle = gr; g.fillRect(0, 0, N, N);
  };
  if (forme === 'net') { g.fillStyle = rgba(c, 1); g.beginPath(); g.arc(m, m, m - 1, 0, Math.PI * 2); g.fill(); }
  else if (forme === 'doux' || forme === 'lueur') radial(0, [[0, 1], [0.35, 0.75], [1, 0]]);
  else if (forme === 'fumee') radial(0, [[0, 0.55], [0.5, 0.3], [1, 0]]);
  else if (forme === 'anneau') radial(0, [[0, 0], [0.55, 0], [0.75, 1], [0.95, 0], [1, 0]]);
  else if (forme === 'etoile') {
    radial(0, [[0, 1], [0.25, 0.5], [0.5, 0]]);
    g.fillStyle = rgba(c, 0.9);
    g.fillRect(m - 1, 1, 2, N - 2); g.fillRect(1, m - 1, N - 2, 2);
  } else if (forme === 'bulle') {
    // sphère translucide : centre presque vide, liseré marqué (effet de bord), reflet
    radial(0, [[0, 0.06], [0.7, 0.12], [0.9, 0.45], [0.97, 0.85], [1, 0]]);
    const h = g.createRadialGradient(m * 0.65, m * 0.6, 0, m * 0.65, m * 0.6, m * 0.35);
    h.addColorStop(0, 'rgba(255,255,255,0.45)'); h.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = h; g.fillRect(0, 0, N, N);
  } else if (forme === 'sol') radial(0, [[0, 0], [0.7, 0], [0.86, 1], [1, 0]]);
  cache.set(cle, cv);
  return cv;
}

// ---------- normalisation d'un effet (formats ancien et nouveau) ----------
// Effet : { mode: 'ponctuel' | 'persistant', duree, couches: [couche...] }.
// Couche « particules » : forme d'apparition (spawn), mouvement, physique,
// couleurs ; couches « bulle » / « anneau » / « lueur » : une primitive.
// L'ancien format (une seule nappe de particules, champs à plat) devient une
// couche ; sa densité valait « par image » : 60/s en continu, ×3 en gerbe.
const CONTINUS = /_trail$|^proj_|^sol_|_stream$/;
export const modeParDefaut = (def) => (def?.mode || (CONTINUS.test(def?.id || '') ? 'persistant' : 'ponctuel'));
export function coucheDepuisAncien(def) {
  const d = Math.max(1, Math.round(+def.density || 1));
  return {
    type: 'particules', ancien: true,
    spawn: def.spawn || 'point', movement: def.movement || 'outward', radius: def.radius ?? 0.1,
    offsetX: def.offsetX || 0, offsetZ: def.offsetZ || 0, offsetH: def.offsetH || 0,
    colors: def.colors?.length ? [...def.colors] : ['#ffffff'],
    size: def.size ?? 2, gravity: def.gravity || 0, speed: def.speed ?? 1, life: def.life ?? 0.5, drag: def.drag ?? 0.98,
    rate: d * 60, burst: d * 3, forme: 'net', fusion: 'additif', alpha: 'fondu',
  };
}
const cacheNorm = new WeakMap();
export function normaliserEffet(def, frais = false) {
  if (!def) return null;
  if (!frais) { const c = cacheNorm.get(def); if (c) return c; }
  const n = {
    mode: modeParDefaut(def),
    duree: +def.duree || 0,
    couches: Array.isArray(def.couches) ? def.couches.filter(c => c && !c.masque) : [coucheDepuisAncien(def)],
  };
  if (!frais) cacheNorm.set(def, n);
  return n;
}
// durée de vie maximale d'une particule ou primitive de l'effet (s)
function vieMax(eff) {
  let m = 0;
  for (const c of eff.couches) m = Math.max(m, (+c.delai || 0) + (+c.life || 0.5) * 1.2);
  return m;
}

export class Particles {
  constructor() {
    this.pool = [];
    for (let i = 0; i < MAX; i++) {
      this.pool.push({
        on: false, ax: null, x: 0, z: 0, h: 0, vx: 0, vz: 0, vh: 0, g: 0, px: 0, pz: 0, ph: 0,
        age: 0, life: 1, size: 3, size1: -1, grow: 0, drag: 1, alpha: 0, opa: 1, add: true, etin: false,
        sprs: null, si: 0, deg: false, col: '#fff', k: 1,
        orb: false, cx: 0, cz: 0, ang: 0, rad: 0, w: 0, vr: 0,
      });
    }
    this.prims = [];
    for (let i = 0; i < MAX_PRIM; i++) {
      this.prims.push({ on: false, type: 0, ax: null, x: 0, z: 0, h: 0, r: 0, r1: 1, spr: null, opa: 1, add: true, age: 0, life: 1, fin: -1, pulse: 0, freq: 1, pid: 0 });
    }
    this.cursor = 0; this.pcursor = 0;
    this.actifs = 0;
    this.instances = []; // effets ponctuels en cours (gerbes retardées, émission sur une durée)
  }

  // tout effacer (aperçus de l'administration)
  vider() {
    for (const q of this.pool) q.on = false;
    for (const pr of this.prims) pr.on = false;
    this.instances.length = 0; this.actifs = 0;
  }

  // part de la réserve occupée (0..1) : sert à ralentir les émissions continues
  charge() { return this.actifs / MAX; }
  facteurCharge() {
    const c = this.charge();
    return c < 0.6 ? 1 : Math.max(0.15, (1 - c) / 0.4);
  }

  // particule : champs historiques (x, z, h, vx, vz, vh, g, life, size, color,
  // grow, drag) + nouveaux (ancre, forme, fusion, alpha, opa, size1, sprs/deg, orbite)
  spawn(o) {
    const q = this.pool[this.cursor];
    this.cursor = (this.cursor + 1) % MAX;
    q.on = true; q.age = 0;
    q.ax = o.ancre || null;
    q.x = o.x; q.z = o.z; q.h = o.h || 0;
    q.px = q.x; q.pz = q.z; q.ph = q.h;
    q.vx = o.vx || 0; q.vz = o.vz || 0; q.vh = o.vh || 0;
    q.g = o.g || 0; q.life = o.life || 0.6; q.size = o.size || 3;
    q.grow = o.grow || 0; q.size1 = o.size1 ?? -1; q.drag = o.drag ?? 1;
    q.col = o.color || '#fff';
    q.etin = o.forme === 'etincelle';
    q.sprs = o.sprs || null; q.deg = !!o.deg; q.si = o.si || 0;
    if (!q.sprs) { q.sprs = [sprite(o.forme && o.forme !== 'etincelle' ? o.forme : 'net', q.col)]; q.si = 0; }
    q.k = o.forme && o.forme !== 'net' && o.forme !== 'etincelle' ? 1.6 : 1;
    q.add = o.fusion !== 'normal';
    q.alpha = o.alpha === 'entree' ? 1 : o.alpha === 'scintille' ? 2 : o.alpha === 'constant' ? 3 : 0;
    q.opa = o.opa ?? 1;
    q.orb = !!o.orb;
    if (q.orb) { q.cx = o.cx; q.cz = o.cz; q.ang = o.ang; q.rad = o.rad; q.w = o.w; q.vr = o.vr || 0; }
    return q;
  }

  // primitive : 1 bulle, 2 anneau au sol, 3 lueur
  primitive(o) {
    let pr = null;
    for (let i = 0; i < MAX_PRIM; i++) {
      const c = this.prims[(this.pcursor + i) % MAX_PRIM];
      if (!c.on) { pr = c; this.pcursor = (this.pcursor + i + 1) % MAX_PRIM; break; }
    }
    if (!pr) { pr = this.prims[this.pcursor]; this.pcursor = (this.pcursor + 1) % MAX_PRIM; }
    pr.on = true; pr.age = 0; pr.fin = -1; pr.pid++;
    pr.type = o.type; pr.ax = o.ancre || null; pr.x = o.x; pr.z = o.z; pr.h = o.h || 0;
    pr.r = o.r; pr.r1 = o.r1 ?? 1; pr.opa = o.opa ?? 1; pr.add = o.fusion !== 'normal';
    pr.life = o.life ?? Infinity; pr.pulse = o.pulse || 0; pr.freq = o.freq || 1;
    pr.spr = sprite(o.type === 1 ? 'bulle' : o.type === 2 ? 'sol' : 'lueur', o.couleur || '#ffffff');
    return pr;
  }

  update(dt) {
    // effets ponctuels en cours : gerbes retardées, émission sur une durée
    if (this.instances.length) {
      let k = 0;
      for (const ins of this.instances) {
        ins.t += dt;
        avancerInstance(this, ins, dt);
        if (ins.t < ins.fin) this.instances[k++] = ins;
      }
      this.instances.length = k;
    }
    let n = 0;
    for (const q of this.pool) {
      if (!q.on) continue;
      q.age += dt;
      if (q.age >= q.life) { q.on = false; continue; }
      n++;
      q.px = q.x; q.pz = q.z; q.ph = q.h;
      if (q.orb) {
        q.ang += q.w * dt; q.rad = Math.max(0, q.rad + q.vr * dt);
        q.x = q.cx + Math.cos(q.ang) * q.rad; q.z = q.cz + Math.sin(q.ang) * q.rad;
      } else {
        q.x += q.vx * dt; q.z += q.vz * dt;
        if (q.drag !== 1) { q.vx *= q.drag; q.vz *= q.drag; }
      }
      q.h += q.vh * dt;
      q.vh -= q.g * dt;
    }
    this.actifs = n;
    for (const pr of this.prims) {
      if (!pr.on) continue;
      pr.age += dt;
      if (pr.age >= pr.life || (pr.fin >= 0 && pr.age - pr.fin >= FONDU_FIN)) pr.on = false;
    }
  }

  // w2s : (x, z) -> {x, y} écran ; s : zoom
  draw(ctx, w2s, s) {
    const W = ctx.canvas.width, H = ctx.canvas.height, M = 80;
    const o = w2s(0, 0), ox = o.x, oy = o.y;
    // projection inline (évite un objet par particule) : w2s est affine
    const kx = w2s(1, 0), kz = w2s(0, 1);
    const xx = kx.x - ox, xy = kx.y - oy, zx = kz.x - ox, zy = kz.y - oy;
    const hws = xx * RAC2; // rayon écran d'une sphère d'une case (cf. emettre : V)
    ctx.save();
    for (let passe = 0; passe < 2; passe++) {
      const add = passe === 1;
      ctx.globalCompositeOperation = add ? 'lighter' : 'source-over';
      // primitives d'abord (fond de l'effet), puis particules
      for (const pr of this.prims) {
        if (!pr.on || pr.add !== add) continue;
        const ax = pr.ax ? pr.ax.x : 0, az = pr.ax ? pr.ax.z : 0;
        const wx = ax + pr.x, wz = az + pr.z;
        const sx = ox + wx * xx + wz * zx, sy = oy + wx * xy + wz * zy;
        const t = pr.life === Infinity ? 0 : pr.age / pr.life;
        const onde = 1 + (pr.r1 - 1) * t;
        const pul = pr.pulse ? Math.sin(pr.age * pr.freq * Math.PI * 2) : 0;
        let a = pr.opa * Math.min(1, pr.age / 0.15);
        if (pr.life !== Infinity) a *= 1 - t * t;
        if (pr.fin >= 0) a *= Math.max(0, 1 - (pr.age - pr.fin) / FONDU_FIN);
        a *= 1 + pul * pr.pulse * 0.5;
        if (a <= 0.004) continue;
        const R = pr.r * hws * onde * (1 + pul * pr.pulse * 0.15);
        const cy = sy - pr.h * s;
        if (sx + R < -M || sx - R > W + M || cy + R < -M || cy - R > H + M) continue;
        ctx.globalAlpha = Math.min(1, a);
        if (pr.type === 2) ctx.drawImage(pr.spr, sx - R, cy - R / 2, R * 2, R);
        else ctx.drawImage(pr.spr, sx - R, cy - R, R * 2, R * 2);
      }
      for (const q of this.pool) {
        if (!q.on || q.add !== add) continue;
        const ax = q.ax ? q.ax.x : 0, az = q.ax ? q.ax.z : 0;
        const wx = ax + q.x, wz = az + q.z;
        const sx = ox + wx * xx + wz * zx, sy = oy + wx * xy + wz * zy - q.h * s;
        if (sx < -M || sx > W + M || sy < -M || sy > H + M) continue;
        const t = q.age / q.life;
        let a = q.alpha === 0 ? (1 - t) * 0.9
          : q.alpha === 1 ? Math.sin(Math.PI * t) * 0.95
          : q.alpha === 2 ? (1 - t) * (0.35 + Math.random() * 0.65)
          : (t < 0.85 ? 0.9 : (1 - t) / 0.15 * 0.9);
        a *= q.opa;
        if (a <= 0.004) continue;
        const r = q.size1 < 0
          ? Math.max(0.4, q.size * s * (1 + q.grow * t) * (1 - t * 0.6))
          : Math.max(0.4, q.size * s * (1 + (q.size1 - 1) * t));
        ctx.globalAlpha = a;
        if (q.etin) {
          // étincelle : trait entre la position précédente et l'actuelle, étiré
          const pwx = ax + q.px, pwz = az + q.pz;
          const px = ox + pwx * xx + pwz * zx, py = oy + pwx * xy + pwz * zy - q.ph * s;
          const ex = sx + (px - sx) * 4, ey = sy + (py - sy) * 4;
          ctx.strokeStyle = q.col; ctx.lineWidth = Math.max(1, r * 0.8);
          ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(sx, sy); ctx.stroke();
          continue;
        }
        const spr = q.deg ? q.sprs[Math.min(q.sprs.length - 1, (t * q.sprs.length) | 0)] : q.sprs[q.si];
        const d = r * q.k; // les formes douces paraissent plus petites qu'un disque net
        ctx.drawImage(spr, sx - d, sy - d, d * 2, d * 2);
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }
}

// ---------- émission d'une couche de particules ----------
// (bx, bz) : centre (monde, ou local si ancre) ; n : nombre de particules
function emettre(P, L, n, bx, bz, ancre, rayon, teinte) {
  if (n <= 0) return;
  const radius = rayon ?? (+L.radius || 0.1);
  const size = +L.size || 2, gravity = +L.gravity || 0, speed = L.speed != null ? +L.speed : 1, life = +L.life || 0.5;
  const drag = L.drag ?? 0.98;
  const cx = bx + (+L.offsetX || 0), cz = bz + (+L.offsetZ || 0), offH = +L.offsetH || 0;
  const colors = couleursDe(L, teinte);
  const forme = L.forme || 'net';
  const sprs = forme === 'etincelle' ? null : colors.map(c => sprite(forme, c));
  const deg = !!L.degrade && colors.length > 1;
  const nouveau = !L.ancien;
  const haut = +L.hauteur || 60;
  const V = radius * RAC2 * HW; // demi-hauteur écran d'une sphère de ce rayon
  const mv = L.movement || 'outward';
  for (let i = 0; i < n; i++) {
    let px = cx, pz = cz, ph = (nouveau ? 0 : 18) + offH;
    let vx = 0, vz = 0, vh = 0;
    const angle = Math.random() * Math.PI * 2;
    let dx = 0, dz = 0, dh = 0; // direction depuis le centre (mouvements radiaux)
    switch (L.spawn) {
      case 'ring': px = cx + Math.cos(angle) * radius; pz = cz + Math.sin(angle) * radius; ph = 2 + offH; dx = Math.cos(angle); dz = Math.sin(angle); break;
      case 'circle': { const d = Math.sqrt(Math.random()) * radius; px = cx + Math.cos(angle) * d; pz = cz + Math.sin(angle) * d; ph = 2 + offH; dx = Math.cos(angle); dz = Math.sin(angle); break; }
      case 'sphere': { // ancien : coquille aplatie autour du torse
        const elev = (Math.random() - 0.5) * Math.PI, r = radius * Math.cos(elev);
        px = cx + Math.cos(angle) * r; pz = cz + Math.sin(angle) * r; ph = 18 + offH + Math.sin(elev) * radius * 60;
        dx = Math.cos(angle); dz = Math.sin(angle); break;
      }
      case 'coquille': case 'boule': { // vraie sphère (surface ou volume), ronde à l'écran
        const u = Math.random() * 2 - 1, c = Math.sqrt(1 - u * u);
        const k = L.spawn === 'boule' ? Math.cbrt(Math.random()) : 1;
        dx = Math.cos(angle) * c; dz = Math.sin(angle) * c; dh = u;
        px = cx + dx * radius * k; pz = cz + dz * radius * k; ph = offH + u * V * k; break;
      }
      case 'colonne': px = cx + Math.cos(angle) * radius; pz = cz + Math.sin(angle) * radius; ph = offH + Math.random() * haut; dx = Math.cos(angle); dz = Math.sin(angle); break;
      default: dx = Math.cos(angle); dz = Math.sin(angle); // point
    }
    const o = {
      ancre, x: px, z: pz, h: ph, vx: 0, vz: 0, vh: 0, g: gravity,
      life: life * (0.8 + Math.random() * 0.4), size, drag,
      forme, fusion: L.fusion, alpha: L.alpha, opa: L.opacite ?? 1,
      size1: L.sizeEnd ?? (nouveau ? 1 : -1),
      sprs, deg, si: (Math.random() * colors.length) | 0,
      color: colors[(Math.random() * colors.length) | 0],
    };
    if (mv === 'outward') {
      const a = (!L.spawn || L.spawn === 'point') ? Math.random() * Math.PI * 2 : angle;
      const f = speed * (0.8 + Math.random() * 0.4) * 1.5;
      if (nouveau && dh) { vx = dx * f; vz = dz * f; vh = dh * f * RAC2 * HW; }
      else { vx = Math.cos(a) * f; vz = Math.sin(a) * f; if (L.spawn === 'sphere') vh = Math.sin((Math.random() - 0.5) * Math.PI) * f; }
    } else if (mv === 'upward') {
      vh = speed * 15 * (0.8 + Math.random() * 0.4);
    } else if (mv === 'orbit') { // ancien : départ tangent
      const f = speed * 1.5;
      vx = Math.cos(angle + Math.PI / 2) * f; vz = Math.sin(angle + Math.PI / 2) * f;
    } else if (mv === 'random') {
      const f = speed * 1.5;
      vx = (Math.random() - 0.5) * f * 2; vz = (Math.random() - 0.5) * f * 2; vh = (Math.random() - 0.5) * f * 2;
    } else if (mv === 'orbite' || mv === 'spirale') { // vraie rotation autour du centre
      const rad = Math.hypot(px - cx, pz - cz) || radius || 0.3;
      o.orb = true; o.cx = cx; o.cz = cz; o.ang = Math.atan2(pz - cz, px - cx); o.rad = rad;
      o.w = (speed * 1.5) / Math.max(0.2, rad);
      if (mv === 'spirale') vh = speed * 15 * (0.8 + Math.random() * 0.4);
    } else if (mv === 'aspiration') { // vers le centre, arrivée en fin de vie
      vx = (cx - px) / o.life; vz = (cz - pz) / o.life; vh = ((offH + (nouveau ? 0 : 18)) - ph) / o.life;
      o.g = 0; o.drag = 1;
    }
    o.vx = vx; o.vz = vz; o.vh = vh;
    P.spawn(o);
  }
}

const TYPES_PRIM = { bulle: 1, anneau: 2, lueur: 3 };
function poserPrimitive(P, L, bx, bz, ancre, ponctuel, rayon, teinte) {
  return P.primitive({
    type: TYPES_PRIM[L.type], ancre, x: bx + (+L.offsetX || 0), z: bz + (+L.offsetZ || 0), h: +L.offsetH || 0,
    r: rayon ?? (+L.radius || 0.5), r1: ponctuel ? (L.radiusEnd ?? 1) : 1,
    couleur: couleursDe(L, teinte)[0], opa: L.opacite ?? 0.8, fusion: L.fusion,
    life: ponctuel ? (+L.life || 0.6) : Infinity, pulse: +L.pulse || 0, freq: +L.freq || 1,
  });
}

// ---------- lecture d'un effet ----------
// Ponctuel : joué une fois (gerbes, émission pendant `duree`, primitives qui
// vivent `life`). Un effet persistant demandé ponctuellement (sort sans aura)
// est entretenu 1,5 s.
function avancerInstance(P, ins, dt) {
  const { eff } = ins;
  const fac = ins.raw ? 1 : densite();
  eff.couches.forEach((L, i) => {
    const d = +L.delai || 0;
    if (ins.t < d) return;
    const prim = L.type && L.type !== 'particules';
    if (!ins.fait[i]) {
      ins.fait[i] = true;
      if (prim) {
        if (fac > 0) {
          const pr = poserPrimitive(P, L, ins.bx, ins.bz, ins.ancre, !ins.persistant, ins.rayon, ins.teinte);
          if (ins.persistant) ins.prims.push({ pr, pid: pr.pid });
        }
      }
      else if (!ins.persistant) {
        const b = Math.round(+L.burst || 0);
        emettre(P, L, ins.raw ? b : densify(b), ins.bx, ins.bz, ins.ancre, ins.rayon, ins.teinte);
      }
    }
    if (!prim && ins.t <= d + ins.duree) {
      ins.acc[i] = (ins.acc[i] || 0) + (+L.rate || 0) * dt * fac;
      const n = ins.acc[i] | 0;
      ins.acc[i] -= n;
      emettre(P, L, n, ins.bx, ins.bz, ins.ancre, ins.rayon, ins.teinte);
    }
  });
  // primitives d'un persistant joué ponctuellement : fondu à la fin
  if (ins.persistant && ins.t >= ins.duree && ins.prims.length) arreterEffet(P, ins);
}

export function jouerEffet(P, def, x, z, opts = {}) {
  if (!P || !def) return;
  const eff = normaliserEffet(def, opts.frais);
  if (!eff?.couches.length) return;
  const persistant = eff.mode === 'persistant';
  const ins = {
    eff, persistant, raw: !!opts.raw, ancre: opts.ancre || null, rayon: opts.rayon, teinte: opts.teinte || null,
    bx: opts.ancre ? 0 : x, bz: opts.ancre ? 0 : z,
    t: 0, duree: persistant ? 1.5 : eff.duree, acc: [], fait: [], prims: [],
  };
  ins.fin = ins.duree + vieMax(eff) + FONDU_FIN;
  avancerInstance(P, ins, 0);
  P.instances.push(ins);
}

// opts.teinte : couleur du sort, appliquée aux couches réglées sur « couleur du sort ».
// Persistant : appelé à chaque image par son hôte (aura, traînée, zone) avec
// un état propre à cet hôte ; arreterEffet() fait disparaître ses primitives.
// Un effet ponctuel entretenu ainsi est rejoué en boucle.
export function entretenirEffet(P, def, etat, x, z, dt, opts = {}) {
  if (!P || !def || !etat) return;
  const eff = normaliserEffet(def, opts.frais);
  if (!eff?.couches.length) return;
  etat.t = (etat.t || 0) + dt;
  if (eff.mode !== 'persistant') {
    if (etat.t >= (etat.prochain || 0)) {
      jouerEffet(P, def, x, z, opts);
      etat.prochain = etat.t + Math.max(0.4, eff.duree + vieMax(eff));
    }
    return;
  }
  const ancre = opts.ancre || null;
  const bx = ancre ? 0 : x, bz = ancre ? 0 : z;
  const fac = (opts.raw ? 1 : densite()) * (opts.raw ? 1 : P.facteurCharge());
  etat.acc ||= []; etat.prims ||= [];
  eff.couches.forEach((L, i) => {
    if (etat.t < (+L.delai || 0)) return;
    if (L.type && L.type !== 'particules') {
      const tenue = etat.prims[i];
      // primitive vivante (même identité) : on la recale sur l'hôte
      if (tenue && tenue.pr.on && tenue.pr.pid === tenue.pid && tenue.pr.fin < 0) {
        if (!ancre) { tenue.pr.x = bx + (+L.offsetX || 0); tenue.pr.z = bz + (+L.offsetZ || 0); }
        if (opts.rayon != null) tenue.pr.r = opts.rayon;
        return;
      }
      if (densite() > 0 || opts.raw) { const pr = poserPrimitive(P, L, bx, bz, ancre, false, opts.rayon, opts.teinte); etat.prims[i] = { pr, pid: pr.pid }; }
      return;
    }
    etat.acc[i] = (etat.acc[i] || 0) + (+L.rate || 0) * dt * fac;
    const n = etat.acc[i] | 0;
    etat.acc[i] -= n;
    emettre(P, L, n, bx, bz, ancre, opts.rayon, opts.teinte);
  });
}
export function arreterEffet(P, etat) {
  if (!etat?.prims) return;
  for (const t of etat.prims) if (t && t.pr.on && t.pr.pid === t.pid && t.pr.fin < 0) t.pr.fin = t.pr.age;
  etat.prims = [];
}

// Compatibilité : ancien point d'entrée (burst = joué une fois, sinon une
// image d'émission continue, état gardé par effet)
const etatsCompat = new WeakMap();
export function emitFromDef(P, def, x, z, opts = {}) {
  if (!P || !def) return;
  if (opts.burst) { jouerEffet(P, def, x, z, opts); return; }
  let e = etatsCompat.get(def);
  if (!e) { e = {}; etatsCompat.set(def, e); }
  entretenirEffet(P, def, e, x, z, opts.dt ?? 1 / 60, opts);
}

// estimation du coût d'un effet : particules vivantes en régime établi
export function coutEffet(def) {
  const eff = normaliserEffet(def, true);
  if (!eff) return { particules: 0, primitives: 0 };
  let p = 0, pr = 0;
  for (const L of eff.couches) {
    if (L.type && L.type !== 'particules') { pr++; continue; }
    const vie = +L.life || 0.5;
    p += eff.mode === 'persistant' ? (+L.rate || 0) * vie : (+L.burst || 0) + (+L.rate || 0) * Math.min(vie, eff.duree || 0);
  }
  return { particules: Math.round(p), primitives: pr };
}

// Palettes et comportements par style (élément, ou poison/drain dérivés)
export const FX_STYLES = {
  fire:    { colors: ['#ff5010', '#ff9040', '#ffd24a'], rise: 55,  spread: 1.6, size: 3.5 },
  water:   { colors: ['#bfeaff', '#9fd4ff', '#ffffff'], rise: 25,  spread: 1.4, size: 2.6 },
  air:     { colors: ['#e8f4ff', '#9fe4ff', '#ffffff'], rise: 40,  spread: 1.8, size: 2.2 },
  earth:   { colors: ['#b89868', '#8a6a48', '#d8c8a8'], rise: 30,  spread: 1.8, size: 3.2 },
  light:   { colors: ['#fff4c8', '#ffe9a8', '#ffffff'], rise: 60,  spread: 1.0, size: 3.0 },
  arcane:  { colors: ['#b040b0', '#7a2090', '#d070d0'], rise: 35,  spread: 1.4, size: 3.0 },
  neutre:  { colors: ['#d8b8ff', '#ffffff', '#c8a8ff'], rise: 35,  spread: 1.4, size: 2.8 },
  poison:  { colors: ['#7ec850', '#a0d870', '#4e8a30'], rise: 45,  spread: 1.0, size: 3.0 },
  drain:   { colors: ['#5a1a6a', '#902090', '#30103a'], rise: 20,  spread: 0.8, size: 3.4 },
};

export function styleOf(element) {
  return FX_STYLES[elementCanonique(element)] || FX_STYLES.neutre;
}

const pick = (a) => a[(Math.random() * a.length) | 0];

// Traînée d'un projectile (appelée chaque frame à la position de la tête)
export function emitTrail(P, element, x, z, h = 40) {
  const st = styleOf(element);
  for (let i = 0, n = densify(2); i < n; i++) {
    P.spawn({
      x, z, h: h + (Math.random() - 0.5) * 10,
      vx: (Math.random() - 0.5) * st.spread, vz: (Math.random() - 0.5) * st.spread,
      vh: st.rise * (0.2 + Math.random() * 0.4), g: st === FX_STYLES.earth ? 80 : 0,
      life: 0.3 + Math.random() * 0.25, size: st.size, color: pick(st.colors),
    });
  }
}

// Gerbe d'impact à l'arrivée d'un projectile
export function emitImpact(P, element, x, z) {
  const st = styleOf(element);
  for (let i = 0, n = densify(14); i < n; i++) {
    const a = Math.random() * Math.PI * 2, v = 1 + Math.random() * 2.4;
    P.spawn({
      x, z, h: 30 + Math.random() * 20,
      vx: Math.cos(a) * v * st.spread, vz: Math.sin(a) * v * st.spread,
      vh: st.rise * (0.4 + Math.random()), g: 140,
      life: 0.35 + Math.random() * 0.35, size: st.size * (0.8 + Math.random() * 0.6),
      color: pick(st.colors), drag: 0.96,
    });
  }
}

// Onde au sol + particules pour les zones d'effet
export function emitGround(P, element, x, z, radius = 3) {
  const st = styleOf(element);
  const n = densify(Math.min(40, 12 + radius * 7));
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * radius;
    P.spawn({
      x: x + Math.cos(a) * d, z: z + Math.sin(a) * d, h: 0,
      vx: 0, vz: 0,
      vh: st.rise * (0.5 + Math.random() * 0.9), g: st === FX_STYLES.earth ? 160 : 30,
      life: 0.5 + Math.random() * 0.5, size: st.size * (0.8 + Math.random() * 0.8),
      color: pick(st.colors), grow: st === FX_STYLES.fire ? 0.6 : 0,
    });
  }
}

// Halo doux montant (soins / lumière)
export function emitHeal(P, x, z) {
  const st = FX_STYLES.light;
  for (let i = 0, n = densify(10); i < n; i++) {
    const a = Math.random() * Math.PI * 2, d = 0.3 + Math.random() * 0.6;
    P.spawn({
      x: x + Math.cos(a) * d, z: z + Math.sin(a) * d, h: 5 + Math.random() * 25,
      vx: 0, vz: 0, vh: 35 + Math.random() * 30, g: -10,
      life: 0.7 + Math.random() * 0.4, size: 2.6, color: i % 3 ? '#8af88a' : pick(st.colors),
    });
  }
}

// Anneau lumineux ascendant (buffs)
export function emitBuff(P, x, z, color = '#ffe48a') {
  const n = densify(16);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    P.spawn({
      x: x + Math.cos(a) * 0.7, z: z + Math.sin(a) * 0.7, h: 2,
      vx: Math.cos(a) * 0.4, vz: Math.sin(a) * 0.4, vh: 60 + Math.random() * 20,
      life: 0.6 + Math.random() * 0.2, size: 2.6, color,
    });
  }
}

// Bulle de protection : sphère scintillante qui enveloppe la cible à
// l'application d'un buff défensif, puis se dissipe (purement visuel, ~0,8 s)
export function emitShield(P, x, z, color = '#9ad4ff') {
  const R = 1.1;
  for (let i = 0, n = densify(30); i < n; i++) {
    // point sur la sphère : azimut + élévation -> coquille autour du buste
    const a = Math.random() * Math.PI * 2;
    const e = (Math.random() - 0.5) * Math.PI;
    const r = R * Math.cos(e);
    P.spawn({
      x: x + Math.cos(a) * r, z: z + Math.sin(a) * r,
      h: 30 + Math.sin(e) * 34,
      // gonflement léger vers l'extérieur, aucune gravité : la bulle se dissout sur place
      vx: Math.cos(a) * 0.35, vz: Math.sin(a) * 0.35, vh: Math.sin(e) * 10, g: 0,
      life: 0.55 + Math.random() * 0.35, size: 2.4,
      color: i % 4 ? color : '#ffffff',
    });
  }
}

// Volutes sombres qui s'accrochent à la cible (malédiction)
export function emitCurse(P, x, z) {
  const st = FX_STYLES.drain;
  for (let i = 0, n = densify(12); i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    P.spawn({
      x: x + Math.cos(a) * 0.5, z: z + Math.sin(a) * 0.5, h: 10 + Math.random() * 40,
      vx: Math.cos(a + 1.6) * 0.8, vz: Math.sin(a + 1.6) * 0.8, vh: 18,
      life: 0.8 + Math.random() * 0.4, size: 3.4, color: pick(st.colors),
    });
  }
}

// Poussière de mort d'un monstre
export function emitDeath(P, x, z) {
  for (let i = 0, n = densify(10); i < n; i++) {
    const a = Math.random() * Math.PI * 2, v = 0.6 + Math.random() * 1.2;
    P.spawn({
      x, z, h: 12 + Math.random() * 18,
      vx: Math.cos(a) * v, vz: Math.sin(a) * v, vh: 24, g: 60,
      life: 0.5 + Math.random() * 0.3, size: 2.6, color: i % 2 ? '#8a8a8a' : '#c8c8c8',
    });
  }
}
