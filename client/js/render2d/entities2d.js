// Entités visuelles 2D : sprites Flare animés (8 directions), interpolation réseau
import { KIND, ST } from '../../../shared/constants.js';
import { MOBS, ITEMS } from '../../../shared/defs.js';
import { Animator, flareDir, LAYER_ORDER } from './anim.js';

const BASE_LAYERS = { feet: 'default_feet', legs: 'cloth_pants', hands: 'default_hands' };
const BUBBLE_FONT = '13px "Trebuchet MS", sans-serif';

class EntityView2D {
  constructor(meta, assets) {
    this.id = meta.id;
    this.kind = meta.kind;
    this.meta = meta;
    this.assets = assets;
    this.buf = [];
    this.x = 0; this.z = 0; this.dir = 0;
    this.state = 0; this.hpPct = 100; this.level = meta.level || 0;
    this.swinging = false;
    this.bbox = null;

    if (meta.kind === KIND.PLAYER || meta.kind === KIND.NPC) {
      this.layers = {};
      for (const [type, name] of Object.entries(BASE_LAYERS)) {
        this.layers[type] = { name, anim: new Animator(assets.manifest.avatar[name].anims) };
      }
      this.setLook(meta.look || {});
    } else if (meta.kind === KIND.MOB) {
      const sprite = MOBS[meta.defId]?.sprite || 'goblin';
      this.sprite = sprite;
      this.anim = new Animator(assets.manifest.enemies[sprite].anims);
      this.image = assets.images.get(assets.manifest.enemies[sprite].image);
    } else {
      const lootName = meta.defId === 'or'
        ? (meta.gold >= 50 ? 'coins100' : meta.gold >= 15 ? 'coins25' : 'coins5')
        : (ITEMS[meta.defId]?.loot || 'clothes');
      this.loot = assets.manifest.loot[lootName] || assets.manifest.loot.clothes;
      this.lootImage = assets.images.get(this.loot.image);
    }
  }

  setLook(look) {
    if (this.kind !== KIND.PLAYER && this.kind !== KIND.NPC) return;
    const want = {
      chest: look?.chest || 'default_chest',
      head: look?.head || 'head_short',
      feet: look?.feet || 'default_feet',
      main: look?.main || null,
      off: look?.off || null,
    };
    for (const [type, name] of Object.entries(want)) {
      if (!name) { delete this.layers[type]; continue; }
      if (this.layers[type]?.name === name) continue;
      const def = this.assets.manifest.avatar[name];
      if (!def) { delete this.layers[type]; continue; }
      const anim = new Animator(def.anims);
      // garde la synchro avec les autres couches
      const ref = this.layers.feet?.anim;
      if (ref) { anim.name = ref.name; anim.t = ref.t; }
      this.layers[type] = { name, anim };
    }
  }

  isDead() { return this.state === ST.DEAD; }

  pushSnap(t, s) {
    if (s.state === ST.ATTACK && this.state !== ST.ATTACK) this.swingStart = true;
    this.state = s.state;
    this.hpPct = s.hpPct;
    if (s.level) this.level = s.level;
    this.buf.push({ t, x: s.x, z: s.z, dir: s.dir });
    if (this.buf.length > 20) this.buf.shift();
  }

  eachAnim(fn) {
    if (this.kind === KIND.PLAYER) { for (const l of Object.values(this.layers)) fn(l.anim); }
    else if (this.anim) fn(this.anim);
  }

  update(renderTime, now, dt) {
    // interpolation de position
    const b = this.buf;
    if (b.length) {
      let i = b.length - 1;
      while (i > 0 && b[i - 1].t > renderTime) i--;
      if (i === 0 || b[i].t <= renderTime) {
        const s = b[b.length - 1];
        this.x = s.x; this.z = s.z; this.dir = s.dir;
      } else {
        const s0 = b[i - 1], s1 = b[i];
        const f = Math.min(1, Math.max(0, (renderTime - s0.t) / Math.max(1e-3, s1.t - s0.t)));
        this.x = s0.x + (s1.x - s0.x) * f;
        this.z = s0.z + (s1.z - s0.z) * f;
        let dd = s1.dir - s0.dir;
        if (dd > Math.PI) dd -= Math.PI * 2;
        if (dd < -Math.PI) dd += Math.PI * 2;
        this.dir = s0.dir + dd * f;
      }
    }
    if (this.kind === KIND.DROP) return;
    if (this.kind === KIND.NPC) {
      this.eachAnim(a => { a.set('stance'); a.tick(dt); });
      return;
    }

    // machine d'animation
    let target;
    let forceRestart = false;
    if (this.state === ST.DEAD) target = 'die';
    else if (this.swingStart) {
      // nouveau coup : l'animation repart du début, même si déjà en 'swing'
      target = 'swing';
      forceRestart = true;
      this.swinging = true;
      this.swingStart = false;
    }
    else if (this.swinging) {
      let done = true;
      this.eachAnim(a => { if (a.name === 'swing' && !a.done) done = false; });
      if (done) this.swinging = false;
      target = done ? (this.state === ST.WALK ? 'run' : 'stance') : 'swing';
    }
    else if (this.state === ST.WALK) target = 'run';
    else target = 'stance';

    this.eachAnim(a => a.set(target, target === 'swing' && (forceRestart || a.name !== 'swing')));
    this.eachAnim(a => a.tick(dt));
  }

  say(text) {
    this.bubble = { text, until: performance.now() / 1000 + Math.min(8, 2.5 + text.length * 0.06) };
  }

  // rejoue l'animation de coup (appelé à CHAQUE attaque/sort, événementiel)
  triggerSwing() {
    this.swingStart = true;
  }

  draw(ctx, assets, px, py, s) {
    const d = flareDir(this.dir);
    if (this.kind === KIND.DROP) {
      const [x, y, w, h, ox, oy] = this.loot.frame;
      ctx.drawImage(this.lootImage, x, y, w, h, px - ox * s, py - oy * s, w * s, h * s);
      this.bbox = { x: px - ox * s, y: py - oy * s, w: w * s, h: h * s, sy: py };
      return;
    }
    if (this.kind === KIND.MOB) {
      const f = this.anim.frame(d);
      if (!f) return;
      const [x, y, w, h, ox, oy] = f;
      ctx.drawImage(this.image, x, y, w, h, px - ox * s, py - oy * s, w * s, h * s);
      this.bbox = { x: px - ox * s, y: py - oy * s, w: w * s, h: h * s, sy: py };
      this.topY = py - oy * s;
      return;
    }
    // joueur : couches dans l'ordre propre à la direction
    let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    for (const type of LAYER_ORDER[d]) {
      const layer = this.layers[type];
      if (!layer) continue;
      const f = layer.anim.frame(d);
      if (!f) continue;
      const [x, y, w, h, ox, oy] = f;
      const img = this.assets.images.get(this.assets.manifest.avatar[layer.name].image);
      ctx.drawImage(img, x, y, w, h, px - ox * s, py - oy * s, w * s, h * s);
      minX = Math.min(minX, px - ox * s); minY = Math.min(minY, py - oy * s);
      maxX = Math.max(maxX, px - ox * s + w * s); maxY = Math.max(maxY, py - oy * s + h * s);
    }
    if (minX < 1e8) {
      this.bbox = { x: minX, y: minY, w: maxX - minX, h: maxY - minY, sy: py };
      this.topY = minY;
    }
  }

  drawOverlay(ctx, px, py, s, selfId) {
    if (this.kind === KIND.DROP || this.state === ST.DEAD) return;
    const top = (this.topY ?? (py - 100 * s)) - 8;
    const isNpc = this.kind === KIND.NPC;
    const name = isNpc ? this.meta.name : `${this.meta.name} [${this.level || this.meta.level}]`;
    ctx.font = `bold ${Math.max(11, 13 * s)}px "Trebuchet MS", sans-serif`;
    ctx.textAlign = 'center';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.strokeText(name, px, top - 6);
    ctx.fillStyle = this.id === selfId ? '#a8e8a8'
      : isNpc ? '#ffe48a'
      : (this.kind === KIND.PLAYER ? '#a8d8ff' : '#ffd2a8');
    ctx.fillText(name, px, top - 6);
    // barre de vie (pas pour les PNJ)
    let barTop = top;
    if (!isNpc) {
      const bw = 64 * s, bh = 5 * Math.max(0.8, s);
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillRect(px - bw / 2 - 1, top - 2, bw + 2, bh + 2);
      ctx.fillStyle = this.hpPct < 30 ? '#ff8020' : '#e03030';
      ctx.fillRect(px - bw / 2, top - 1, bw * this.hpPct / 100, bh);
    }
    // bulle de dialogue
    if (this.bubble) {
      const now = performance.now() / 1000;
      if (now > this.bubble.until) { this.bubble = null; return; }
      ctx.font = BUBBLE_FONT;
      const words = this.bubble.text.split(' ');
      const lines = [];
      let cur = '';
      for (const w of words) {
        const t = cur ? cur + ' ' + w : w;
        if (ctx.measureText(t).width > 220 && cur) { lines.push(cur); cur = w; }
        else cur = t;
      }
      if (cur) lines.push(cur);
      const lh = 16;
      const bw2 = Math.min(236, Math.max(...lines.map(l => ctx.measureText(l).width)) + 16);
      const bh2 = lines.length * lh + 10;
      const bx = px - bw2 / 2, by = barTop - 26 - bh2;
      ctx.fillStyle = isNpc ? 'rgba(40, 32, 12, 0.88)' : 'rgba(12, 16, 36, 0.88)';
      ctx.strokeStyle = isNpc ? '#c8b87a' : '#5a6a9a';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(bx, by, bw2, bh2, 6);
      ctx.fill(); ctx.stroke();
      // petite pointe
      ctx.beginPath();
      ctx.moveTo(px - 5, by + bh2); ctx.lineTo(px + 5, by + bh2); ctx.lineTo(px, by + bh2 + 6);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#f0ead8';
      lines.forEach((l, i) => ctx.fillText(l, px, by + 16 + i * lh));
    }
  }
}

export class EntityManager2D {
  constructor(assets) {
    this.assets = assets;
    this.views = new Map();
    this.pendingSnaps = new Map();
  }

  addMeta(meta) {
    if (this.views.has(meta.id)) return;
    const v = new EntityView2D(meta, this.assets);
    this.views.set(meta.id, v);
    const pend = this.pendingSnaps.get(meta.id);
    if (pend) { for (const [t, s] of pend) v.pushSnap(t, s); this.pendingSnaps.delete(meta.id); }
  }

  applySnapshot(snap, recvTime) {
    for (const s of snap.entities) {
      const v = this.views.get(s.id);
      if (v) v.pushSnap(recvTime, s);
      else {
        let p = this.pendingSnaps.get(s.id);
        if (!p) { p = []; this.pendingSnaps.set(s.id, p); }
        p.push([recvTime, s]);
        if (p.length > 5) p.shift();
      }
    }
    for (const id of snap.gone) this.remove(id);
  }

  remove(id) {
    this.views.delete(id);
    this.pendingSnaps.delete(id);
  }

  // vide tout sauf soi-même (changement de zone)
  clear(keepId) {
    for (const id of [...this.views.keys()]) {
      if (id !== keepId) this.views.delete(id);
    }
    this.pendingSnaps.clear();
    const self = this.views.get(keepId);
    if (self) self.buf = [];
  }

  update(renderTime, now, dt) {
    for (const v of this.views.values()) v.update(renderTime, now, dt);
  }

  get(id) { return this.views.get(id); }
}
