// Rendu isométrique 2D : sols, décors, entités triées en profondeur,
// éclairage simulé (nuit teintée + halos de lumière), à la manière des RPG iso classiques.
import { DAY_LENGTH } from '../../../shared/constants.js';
import { settings, ZOOM_MIN, ZOOM_MAX } from '../settings.js';
import {
  Particles, emitTrail, emitImpact, emitGround, emitHeal, emitBuff, emitCurse, emitDeath, emitShield,
} from './particles.js';

export const HW = 96, HH = 48; // demi-tuile écran (tuile logique 192x96)
// pénombre minimale des cavernes : il y fait nuit quel que soit le soleil —
// torches rares et sort Lumière deviennent indispensables
const CAVE_DARKNESS = 0.72;

export class Renderer {
  constructor(canvas, assets, world, decor) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.assets = assets;
    this.world = world;
    this.decor = decor;
    this.cam = { x: world.spawnPoint.x, z: world.spawnPoint.z };
    // zoom initial = « zoom par défaut » des paramètres (la molette ajuste ensuite)
    const z0 = +settings.defaultZoom;
    this.scale = Number.isFinite(z0) ? Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z0)) : 1;
    this.grass = assets.images.get('tilesets/tileset_grassland.png');
    this.water = assets.images.get('tilesets/tileset_grassland_water.png');

    // canvas d'éclairage
    this.lightCanvas = document.createElement('canvas');
    this.lctx = this.lightCanvas.getContext('2d');

    this.tint = null;   // voile coloré propre à la zone
    // ambiance de sous-zone courante ({ tint, darkness }) poussée par le serveur :
    // teinte/obscurité appliquées PAR-DESSUS le cycle jour/nuit (null = aucune)
    this.ambience = null;
    // aperçu jour/nuit forcé (éditeur) : null = horloge réelle, sinon 0..1
    this.previewDaylight = null;
    this.fx = [];       // effets éphémères (projectiles, zones d'effet)
    this.particles = new Particles(); // flammèches, éclats, bulles... (pool fixe)
    this._fxClock = 0;  // horloge des particules (dt borné)
    this.setWorld(world, decor);

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  // change de monde (téléportation entre zones)
  setWorld(world, decor, tint = null) {
    this.world = world;
    this.decor = decor;
    this.tint = tint;
    this.ambience = null; // le serveur repousse l'ambiance d'arrivée (message `zone`)
    this.cam = { x: world.spawnPoint.x, z: world.spawnPoint.z };
    this.props = decor.props.map(p => ({
      ...p,
      sx: (p.x - p.z) * HW,
      sy: (p.x + p.z) * HH,
    })).sort((a, b) => a.sy - b.sy);
  }

  addFx(fx) {
    this.fx.push({ ...fx, start: performance.now() / 1000 });
  }

  // Effet ponctuel sur une entité (soin, buff, malédiction, mort) : particules
  fxAt(kind, x, z, color) {
    if (kind === 'heal') emitHeal(this.particles, x, z);
    else if (kind === 'buff') emitBuff(this.particles, x, z, color);
    else if (kind === 'shield') emitShield(this.particles, x, z, color);
    else if (kind === 'curse') emitCurse(this.particles, x, z);
    else if (kind === 'die') emitDeath(this.particles, x, z);
    else if (kind === 'levelup') emitBuff(this.particles, x, z, '#ffd24a');
  }

  resize() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
    this.lightCanvas.width = this.canvas.width;
    this.lightCanvas.height = this.canvas.height;
  }

  zoom(delta) {
    this.scale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, this.scale * (delta > 0 ? 0.9 : 1.1)));
  }

  follow(x, z) {
    this.cam.x += (x - this.cam.x) * 0.12;
    this.cam.z += (z - this.cam.z) * 0.12;
  }

  // monde -> écran
  w2s(x, z) {
    const s = this.scale;
    return {
      x: ((x - z) - (this.cam.x - this.cam.z)) * HW * s + this.canvas.width / 2,
      y: ((x + z) - (this.cam.x + this.cam.z)) * HH * s + this.canvas.height / 2,
    };
  }
  // écran -> monde
  s2w(px, py) {
    const s = this.scale;
    const a = (px - this.canvas.width / 2) / (HW * s) + (this.cam.x - this.cam.z);
    const b = (py - this.canvas.height / 2) / (HH * s) + (this.cam.x + this.cam.z);
    return { x: (a + b) / 2, z: (b - a) / 2 };
  }

  // dessine une tuile/un sprite du tileset à l'ancrage (px, py).
  // k : échelle propre au prop (1 par défaut) ; flip : miroir horizontal
  // autour de l'ancrage (la « rotation » des sprites iso pré-rendus).
  drawTile(id, px, py, k = 1, flip = false) {
    const m = this.assets.manifest;
    let rect = m.tiles[id], img = this.grass;
    if (!rect) { rect = m.waterTiles[id]; img = this.water; }
    if (!rect) return;
    const [x, y, w, h, ox, oy] = rect;
    const s = this.scale * k;
    if (flip) {
      const ctx = this.ctx;
      ctx.save();
      ctx.translate(px, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(img, x, y, w, h, -ox * s, py - oy * s, w * s, h * s);
      ctx.restore();
    } else {
      this.ctx.drawImage(img, x, y, w, h, px - ox * s, py - oy * s, w * s, h * s);
    }
  }

  // cercle de sélection au sol (sous les pieds d'une entité)
  drawSelCircle(px, py, s, color, pulse, now) {
    const ctx = this.ctx;
    const a = pulse ? 0.55 + Math.sin(now * 6) * 0.25 : 0.45;
    const r = (pulse ? 46 + Math.sin(now * 6) * 3 : 42) * s;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.strokeStyle = color;
    ctx.lineWidth = 3 * s;
    ctx.beginPath();
    ctx.ellipse(px, py + 4 * s, r, r / 2, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = a * 0.25;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(px, py + 4 * s, r, r / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  render(em, worldTime, now, selfId, hl = {}) {
    const ctx = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;
    const s = this.scale;
    const frac = (worldTime % DAY_LENGTH) / DAY_LENGTH;
    const sunHeight = Math.sin((frac - 0.25) * Math.PI * 2);
    // aperçu jour/nuit forcé (éditeur) : court-circuite l'horloge réelle
    const daylight = this.previewDaylight != null
      ? this.previewDaylight
      : Math.max(0, Math.min(1, sunHeight * 1.6 + 0.1));

    ctx.fillStyle = '#06070c';
    ctx.fillRect(0, 0, W, H);

    // --- Sols : zone de tuiles visible ---
    const margin = 3;
    const corners = [this.s2w(0, 0), this.s2w(W, 0), this.s2w(0, H), this.s2w(W, H)];
    const minX = Math.max(0, Math.floor(Math.min(...corners.map(c => c.x))) - margin);
    const maxX = Math.min(this.world.size - 1, Math.ceil(Math.max(...corners.map(c => c.x))) + margin);
    const minZ = Math.max(0, Math.floor(Math.min(...corners.map(c => c.z))) - margin);
    const maxZ = Math.min(this.world.size - 1, Math.ceil(Math.max(...corners.map(c => c.z))) + margin);
    const N = this.world.size;
    for (let sum = minX + minZ; sum <= maxX + maxZ; sum++) {
      for (let x = Math.max(minX, sum - maxZ); x <= Math.min(maxX, sum - minZ); x++) {
        const z = sum - x;
        const p = this.w2s(x + 0.5, z + 0.5);
        if (p.x < -200 * s || p.x > W + 200 * s || p.y < -150 * s || p.y > H + 150 * s) continue;
        this.drawTile(this.decor.floor[z * N + x], p.x, p.y);
      }
    }

    // --- Objets + entités triés en profondeur ---
    const camSx = (this.cam.x - this.cam.z) * HW, camSy = (this.cam.x + this.cam.z) * HH;
    const viewL = camSx - (W / 2 + 600) / s, viewR = camSx + (W / 2 + 600) / s;
    const viewT = camSy - (H / 2 + 800) / s, viewB = camSy + (H / 2 + 400) / s;

    const drawables = [];
    for (const p of this.props) {
      if (p.sx < viewL || p.sx > viewR || p.sy < viewT || p.sy > viewB) continue;
      drawables.push({ sy: p.sy, prop: p });
    }
    for (const v of em.views.values()) {
      const sy = (v.x + v.z) * HH;
      const sx = (v.x - v.z) * HW;
      if (sx < viewL || sx > viewR || sy < viewT || sy > viewB) continue;
      // les cadavres passent nettement sous tout (drops et vivants visibles par-dessus)
      drawables.push({ sy: sy + (v.isDead?.() ? -96 : 0), view: v });
    }
    drawables.sort((a, b) => a.sy - b.sy);
    for (const d of drawables) {
      if (d.prop) {
        const p = this.w2s(d.prop.x, d.prop.z);
        this.drawTile(d.prop.tileId, p.x, p.y, d.prop.s || 1, d.prop.flip);
      } else {
        const p = this.w2s(d.view.x, d.view.z);
        // surlignement : cible en cours (pulsant) ou entité survolée
        if (hl.targetId === d.view.id && !d.view.isDead?.()) {
          this.drawSelCircle(p.x, p.y, s, hl.targetColor || '#ff5040', true, now);
        } else if (hl.hoverId === d.view.id && !d.view.isDead?.()) {
          this.drawSelCircle(p.x, p.y, s, hl.hoverColor || '#ffd24a', false, now);
        }
        d.view.draw(ctx, this.assets, p.x, p.y, s);
      }
    }

    // --- Effets de sorts (projectiles, éclairs, zones d'effet) + particules ---
    const fnow = performance.now() / 1000;
    const fdt = Math.min(0.05, this._fxClock ? fnow - this._fxClock : 0.016);
    this._fxClock = fnow;
    const keep = [];
    for (const f of this.fx) {
      if (fnow - f.start >= (f.dur || 0.45)) {
        // l'impact d'un projectile éclate en gerbe à l'arrivée
        if (f.type === 'proj') emitImpact(this.particles, f.element, f.x1, f.z1);
        continue;
      }
      keep.push(f);
    }
    this.fx = keep;
    for (const f of this.fx) {
      const t = (fnow - f.start) / (f.dur || 0.45);
      if (f.type === 'proj') {
        const a = this.w2s(f.x0, f.z0), b = this.w2s(f.x1, f.z1);
        const px = a.x + (b.x - a.x) * t, py = a.y + (b.y - a.y) * t - 40 * s;
        // traînée de particules à la position courante de la tête
        const wx = f.x0 + (f.x1 - f.x0) * t, wz = f.z0 + (f.z1 - f.z0) * t;
        emitTrail(this.particles, f.element, wx, wz);
        ctx.globalCompositeOperation = 'lighter';
        const g = ctx.createRadialGradient(px, py, 0, px, py, 14 * s);
        g.addColorStop(0, f.color || '#aaddff');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(px - 16 * s, py - 16 * s, 32 * s, 32 * s);
        ctx.globalCompositeOperation = 'source-over';
      } else if (f.type === 'zap') {
        // éclair : zigzag lumineux bref entre lanceur et cible (pas un projectile)
        const a = this.w2s(f.x0, f.z0), b = this.w2s(f.x1, f.z1);
        const ax = a.x, ay = a.y - 50 * s, bx = b.x, by = b.y - 40 * s;
        const segs = 7;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 1 - t;
        for (const [w, col] of [[5 * s, f.color || '#9fe4ff'], [2 * s, '#ffffff']]) {
          ctx.strokeStyle = col;
          ctx.lineWidth = w;
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          for (let i = 1; i < segs; i++) {
            const tt = i / segs;
            // zigzag pseudo-aléatoire qui scintille avec le temps
            const j = Math.sin(i * 12.9898 + Math.floor(fnow * 30) * 78.233) * 0.5;
            ctx.lineTo(ax + (bx - ax) * tt + j * 26 * s, ay + (by - ay) * tt + j * 16 * s);
          }
          ctx.lineTo(bx, by);
          ctx.stroke();
        }
        ctx.restore();
        if (!f._sparked) { f._sparked = true; emitImpact(this.particles, 'air', f.x1, f.z1); }
      } else if (f.type === 'aoe') {
        if (!f._burst) { f._burst = true; emitGround(this.particles, f.element, f.x, f.z, f.radius || 3); }
        const c = this.w2s(f.x, f.z);
        const r = (f.radius || 3) * HW * s * Math.min(1, t * 1.6);
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = f.color || '#ff8040';
        ctx.globalAlpha = 1 - t;
        ctx.lineWidth = 5 * s;
        ctx.beginPath();
        ctx.ellipse(c.x, c.y, r, r / 2, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      }
    }
    this.particles.update(fdt);
    this.particles.draw(ctx, (x, z) => this.w2s(x, z), s);

    // --- Voile coloré de la zone, puis teinte d'ambiance de sous-zone ---
    if (this.tint) {
      ctx.fillStyle = this.tint;
      ctx.fillRect(0, 0, W, H);
    }
    if (this.ambience?.tint) {
      ctx.fillStyle = this.ambience.tint;
      ctx.fillRect(0, 0, W, H);
    }

    // --- Éclairage : obscurité + trous de lumière ---
    // l'obscurité d'ambiance de sous-zone s'ajoute à la nuit (cumul borné à 1)
    const ambDark = Math.max(0, Math.min(1, this.ambience?.darkness || 0));
    const outdoorDarkness = Math.min(1, (1 - daylight) * 0.78 + ambDark);
    const darkness = this.world.kind === 'cave' ? Math.max(CAVE_DARKNESS, outdoorDarkness) : outdoorDarkness;
    if (darkness > 0.02) {
      const l = this.lctx;
      l.globalCompositeOperation = 'source-over';
      l.clearRect(0, 0, W, H);
      l.fillStyle = `rgba(8, 11, 34, ${darkness})`;
      l.fillRect(0, 0, W, H);
      l.globalCompositeOperation = 'destination-out';
      const punch = (px, py, r, strength) => {
        const g = l.createRadialGradient(px, py, 0, px, py, r);
        g.addColorStop(0, `rgba(0,0,0,${strength})`);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        l.fillStyle = g;
        l.fillRect(px - r, py - r, r * 2, r * 2);
      };
      this._lightPts = [];
      for (const li of this.decor.lights) {
        const p = this.w2s(li.x, li.z);
        if (p.x < -400 || p.x > W + 400 || p.y < -400 || p.y > H + 400) continue;
        const fl = li.flicker ? 1 + Math.sin(now * 9 + li.x * 7) * 0.08 : 1;
        const r = li.r * fl * s;
        punch(p.x, p.y - 20 * s, r, 0.97);
        this._lightPts.push({ x: p.x, y: p.y - 20 * s, r, color: li.color });
      }
      const self = em.get(selfId);
      if (self) {
        const p = this.w2s(self.x, self.z);
        if (hl.selfLight) {
          // sort Lumière : éclaire largement le lanceur, avec un léger halo doré
          punch(p.x, p.y - 40 * s, 520 * s, 0.95);
          this._lightPts.push({ x: p.x, y: p.y - 40 * s, r: 320 * s, color: 'rgba(255, 220, 130, 0.10)' });
        } else {
          punch(p.x, p.y - 40 * s, 230 * s, 0.8);
        }
      }
      ctx.drawImage(this.lightCanvas, 0, 0);

      // halos chauds (ou colorés) par-dessus
      ctx.globalCompositeOperation = 'lighter';
      for (const lp of this._lightPts) {
        const g = ctx.createRadialGradient(lp.x, lp.y, 0, lp.x, lp.y, lp.r * 0.75);
        g.addColorStop(0, lp.color || 'rgba(255, 150, 50, 0.16)');
        g.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = g;
        ctx.fillRect(lp.x - lp.r, lp.y - lp.r, lp.r * 2, lp.r * 2);
      }
      ctx.globalCompositeOperation = 'source-over';
    } else if (daylight < 0.55) {
      // aube / crépuscule : voile orangé léger
      ctx.fillStyle = `rgba(255, 140, 60, ${(0.55 - daylight) * 0.12})`;
      ctx.fillRect(0, 0, W, H);
    }

    // --- Plaques de nom + barres de vie (au-dessus de l'éclairage) ---
    for (const d of drawables) {
      if (d.view) {
        const p = this.w2s(d.view.x, d.view.z);
        d.view.drawOverlay(ctx, p.x, p.y, s, selfId);
      }
    }

    // --- Luminosité / gamma : voile global appliqué TOUT À LA FIN ---
    // Réglage simple et robuste qui ne touche pas à l'éclairage de zone :
    //   gamma > 1 -> voile blanc en 'lighten' (éclaircit)
    //   gamma < 1 -> voile noir en 'multiply'/source-over (assombrit)
    // L'intensité suit l'écart à 1 (gamma = 1 -> aucun voile).
    const gamma = Number.isFinite(+settings.gamma) ? +settings.gamma : 1;
    if (Math.abs(gamma - 1) > 0.01) {
      ctx.save();
      if (gamma > 1) {
        ctx.globalCompositeOperation = 'lighten';
        ctx.globalAlpha = Math.min(0.6, (gamma - 1) * 0.9);
        ctx.fillStyle = '#ffffff';
      } else {
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = Math.min(0.6, (1 - gamma) * 0.9);
        ctx.fillStyle = '#000000';
      }
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }

    return daylight;
  }

  // sélection d'entité au clic : hitbox élargie (taille minimale garantie
  // pour les petits monstres) + clic magnétique (un clic raté à moins de
  // `magnet` px du centre d'un monstre vivant le cible quand même)
  pickEntity(em, px, py, magnet = 40) {
    const s = this.scale;
    const MIN_W = 56 * s, MIN_H = 64 * s, PAD = 6 * s;
    let best = null;
    for (const v of em.views.values()) {
      const b = v.bbox;
      if (!b) continue;
      if (v.isDead?.()) continue; // les cadavres sont transparents au clic
      // boîte élargie et garantie à une taille minimale, centrée sur le sprite
      const cx = b.x + b.w / 2;
      const w = Math.max(b.w + PAD * 2, MIN_W);
      const h = Math.max(b.h + PAD * 2, MIN_H);
      const x0 = cx - w / 2, y0 = b.y + b.h - h;
      if (px >= x0 && px <= x0 + w && py >= y0 && py <= y0 + h + PAD) {
        if (!best || b.sy > best.bbox.sy) best = v;
      }
    }
    if (best || !magnet) return best;
    // magnétisme : monstre vivant le plus proche du clic
    let bestD = magnet;
    for (const v of em.views.values()) {
      if (v.kind !== 1 /* MOB */ || v.isDead?.() || !v.bbox) continue;
      const b = v.bbox;
      const d = Math.hypot(b.x + b.w / 2 - px, b.y + b.h * 0.6 - py);
      if (d < bestD) { bestD = d; best = v; }
    }
    return best;
  }
}
