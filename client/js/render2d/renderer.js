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

    // props pré-projetés et triés
    this.props = decor.props.map(p => ({
      ...p,
      sx: (p.x - p.z) * HW,
      sy: (p.x + p.z) * HH,
    })).sort((a, b) => a.sy - b.sy);

    window.addEventListener('resize', () => this.resize());
    this.resize();
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

  render(em, worldTime, now, selfId) {
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
      // les morts au sol passent sous les vivants
      drawables.push({ sy: sy + (v.isDead?.() ? -0.1 : 0), view: v });
    }
    drawables.sort((a, b) => a.sy - b.sy);
    for (const d of drawables) {
      if (d.prop) {
        const p = this.w2s(d.prop.x, d.prop.z);
        this.drawTile(d.prop.tileId, p.x, p.y);
      } else {
        const p = this.w2s(d.view.x, d.view.z);
        d.view.draw(ctx, this.assets, p.x, p.y, s);
      }
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
        this._lightPts.push({ x: p.x, y: p.y - 20 * s, r });
      }
      const self = em.get(selfId);
      if (self) {
        const p = this.w2s(self.x, self.z);
        punch(p.x, p.y - 40 * s, 230 * s, 0.8);
      }
      ctx.drawImage(this.lightCanvas, 0, 0);

      // halos chauds par-dessus
      ctx.globalCompositeOperation = 'lighter';
      for (const lp of this._lightPts) {
        const g = ctx.createRadialGradient(lp.x, lp.y, 0, lp.x, lp.y, lp.r * 0.75);
        g.addColorStop(0, 'rgba(255, 150, 50, 0.16)');
        g.addColorStop(1, 'rgba(255, 120, 30, 0)');
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

  // sélection d'entité au clic (le plus proche du premier plan d'abord)
  pickEntity(em, px, py) {
    let best = null;
    for (const v of em.views.values()) {
      const b = v.bbox;
      if (!b) continue;
      const shrinkX = b.w * 0.18;
      if (px >= b.x + shrinkX && px <= b.x + b.w - shrinkX && py >= b.y && py <= b.y + b.h) {
        if (!best || b.sy > best.bbox.sy) best = v;
      }
    }
    return best;
  }
}
