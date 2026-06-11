// Rendu isométrique 2D : sols, décors, entités triées en profondeur,
// éclairage simulé (nuit teintée + halos de lumière), à la manière des RPG iso classiques.
import { DAY_LENGTH } from '../../../shared/constants.js';

export const HW = 96, HH = 48; // demi-tuile écran (tuile logique 192x96)

export class Renderer {
  constructor(canvas, assets, world, decor) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.assets = assets;
    this.world = world;
    this.decor = decor;
    this.cam = { x: world.spawnPoint.x, z: world.spawnPoint.z };
    this.scale = 1;
    this.grass = assets.images.get('tilesets/tileset_grassland.png');
    this.water = assets.images.get('tilesets/tileset_grassland_water.png');

    // canvas d'éclairage
    this.lightCanvas = document.createElement('canvas');
    this.lctx = this.lightCanvas.getContext('2d');

    this.tint = null;   // voile coloré propre à la zone
    this.fx = [];       // effets éphémères (projectiles, zones d'effet)
    this.setWorld(world, decor);

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  // change de monde (téléportation entre zones)
  setWorld(world, decor, tint = null) {
    this.world = world;
    this.decor = decor;
    this.tint = tint;
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

  resize() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
    this.lightCanvas.width = this.canvas.width;
    this.lightCanvas.height = this.canvas.height;
  }

  zoom(delta) {
    this.scale = Math.min(1.4, Math.max(0.55, this.scale * (delta > 0 ? 0.9 : 1.1)));
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

  drawTile(id, px, py) {
    const m = this.assets.manifest;
    let rect = m.tiles[id], img = this.grass;
    if (!rect) { rect = m.waterTiles[id]; img = this.water; }
    if (!rect) return;
    const [x, y, w, h, ox, oy] = rect;
    const s = this.scale;
    this.ctx.drawImage(img, x, y, w, h, px - ox * s, py - oy * s, w * s, h * s);
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
    const daylight = Math.max(0, Math.min(1, sunHeight * 1.6 + 0.1));

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
        this.drawTile(d.prop.tileId, p.x, p.y);
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

    // --- Effets de sorts (projectiles, zones d'effet) ---
    const fnow = performance.now() / 1000;
    this.fx = this.fx.filter(f => fnow - f.start < (f.dur || 0.45));
    for (const f of this.fx) {
      const t = (fnow - f.start) / (f.dur || 0.45);
      if (f.type === 'proj') {
        const a = this.w2s(f.x0, f.z0), b = this.w2s(f.x1, f.z1);
        const px = a.x + (b.x - a.x) * t, py = a.y + (b.y - a.y) * t - 40 * s;
        ctx.globalCompositeOperation = 'lighter';
        const g = ctx.createRadialGradient(px, py, 0, px, py, 14 * s);
        g.addColorStop(0, f.color || '#aaddff');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(px - 16 * s, py - 16 * s, 32 * s, 32 * s);
        ctx.globalCompositeOperation = 'source-over';
      } else if (f.type === 'aoe') {
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

    // --- Voile coloré de la zone ---
    if (this.tint) {
      ctx.fillStyle = this.tint;
      ctx.fillRect(0, 0, W, H);
    }

    // --- Éclairage : obscurité + trous de lumière ---
    const darkness = (1 - daylight) * 0.78;
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
        punch(p.x, p.y - 40 * s, 230 * s, 0.8);
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
