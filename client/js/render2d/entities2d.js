// Entités visuelles 2D : sprites Flare animés (8 directions), interpolation réseau
import { KIND, ST } from '../../../shared/constants.js';
import { MOBS, ITEMS } from '../../../shared/defs.js';
import { Animator, flareDir, LAYER_ORDER } from './anim.js';
import { settings } from '../settings.js';

const BASE_LAYERS = { feet: 'default_feet', legs: 'cloth_pants', hands: 'default_hands' };
const BUBBLE_FONT = '13px "Trebuchet MS", sans-serif';

// ---- Variations par teinte (champ `tint` de MOBS) ----
// Une même planche Flare sert plusieurs créatures (loup gris / loup noir,
// skraug vert / rouge...) : on la recolore UNE FOIS au chargement sur un
// canvas hors écran (blend 'color' pour la dominante, 'multiply' pour la
// luminosité, masque alpha d'origine), puis on met le résultat en cache —
// aucun filtre par frame au rendu.
const TINT_CACHE = new Map(); // `${sprite}|${tint}` -> canvas
export function tintedSheet(image, sprite, tint) {
  if (!tint) return image;
  const key = `${sprite}|${tint}`;
  let sheet = TINT_CACHE.get(key);
  if (!sheet) {
    sheet = document.createElement('canvas');
    sheet.width = image.width;
    sheet.height = image.height;
    const g = sheet.getContext('2d');
    g.drawImage(image, 0, 0);
    g.globalCompositeOperation = 'color';      // impose la dominante
    g.fillStyle = tint;
    g.fillRect(0, 0, sheet.width, sheet.height);
    g.globalCompositeOperation = 'multiply';   // module la luminosité
    g.fillRect(0, 0, sheet.width, sheet.height);
    g.globalCompositeOperation = 'destination-in'; // restaure l'alpha d'origine
    g.drawImage(image, 0, 0);
    TINT_CACHE.set(key, sheet);
  }
  return sheet;
}

// Membres du groupe du joueur : leurs noms sont surlignés au-dessus des têtes
// (alimenté par main.js à chaque party_update)
const PARTY_IDS = new Set();
const PARTY_NAME_COLOR = '#ffd24a';
export function setPartyIds(ids) {
  PARTY_IDS.clear();
  for (const id of ids) PARTY_IDS.add(id);
}

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
      this.sex = meta.look?.sex === 'female' ? 'female' : 'male';
      this.layers = {};
      for (const [type, name] of Object.entries(BASE_LAYERS)) {
        const def = this.avatarDef(name);
        if (def) { this.assets.images.get(def.image); this.layers[type] = { name, anim: new Animator(def.anims) }; }
      }
      this.setLook(meta.look || {});
    } else if (meta.kind === KIND.MOB) {
      const def = MOBS[meta.defId];
      // skin admin prioritaire (content/skins.json), repli sur le sprite du bestiaire
      const skinned = assets.skins?.mobs?.[meta.defId];
      const useSkin = !!(skinned && assets.manifest.enemies[skinned]);
      const sprite = useSkin ? skinned : (def?.sprite || 'goblin');
      this.sprite = sprite;
      // spriteScale compense la résolution de la planche PAR DÉFAUT : une
      // planche fournie a sa propre taille de case, on l'affiche à l'échelle 1
      this.spriteScale = useSkin ? 1 : (def?.spriteScale || 1);
      if (this.meta?.boss) this.spriteScale *= 1.35; // les boss en imposent
      this.anim = new Animator(assets.manifest.enemies[sprite].anims);
      // planche chargée à la demande : résolue (et teinte appliquée) au
      // premier dessin où elle est prête
      this.imagePath = assets.manifest.enemies[sprite].image;
      this.tint = useSkin ? null : def?.tint; // une planche fournie garde ses couleurs
      this.image = null;
      assets.images.get(this.imagePath); // lance le chargement dès l'entrée en vue réseau
    } else {
      // objet au sol : skin admin (image entière, ancrée bas-centre) prioritaire
      const skinImg = meta.defId !== 'or' && assets.skins?.items?.[meta.defId]
        ? assets.images.get(assets.skins.items[meta.defId]) : null;
      if (skinImg) {
        this.loot = { image: null, frame: [0, 0, skinImg.width, skinImg.height, skinImg.width / 2, skinImg.height - 4] };
        this.lootImage = skinImg;
        return;
      }
      const lootName = meta.defId === 'or'
        ? (meta.gold >= 50 ? 'coins100' : meta.gold >= 15 ? 'coins25' : 'coins5')
        : (ITEMS[meta.defId]?.loot || 'clothes');
      this.loot = assets.manifest.loot[lootName] || assets.manifest.loot.clothes;
      this.lootImage = assets.images.get(this.loot.image);
    }
  }

  // couche d'avatar selon le sexe (têtes différentes : head_short / head_long)
  avatarDef(name) {
    return this.assets.manifest.avatar[this.sex || 'male']?.[name] || null;
  }

  setLook(look) {
    if (this.kind !== KIND.PLAYER && this.kind !== KIND.NPC) return;
    const newSex = look?.sex === 'female' ? 'female' : 'male';
    const sexChanged = newSex !== this.sex;
    this.sex = newSex;
    const defaultHead = this.sex === 'female' ? 'head_long' : 'head_short';
    const want = {
      chest: look?.chest || 'default_chest',
      head: look?.head || defaultHead,
      legs: look?.legs || 'cloth_pants',
      hands: look?.hands || 'default_hands',
      feet: look?.feet || 'default_feet',
      main: look?.main || null,
      off: look?.off || null,
    };
    if (sexChanged) {
      // re-crée aussi les couches de base avec le bon atlas
      for (const [type, name] of Object.entries(BASE_LAYERS)) {
        const def = this.avatarDef(name);
        if (def) { this.assets.images.get(def.image); this.layers[type] = { name, anim: new Animator(def.anims) }; }
      }
    }
    for (const [type, name] of Object.entries(want)) {
      if (!name) { delete this.layers[type]; continue; }
      if (!sexChanged && this.layers[type]?.name === name) continue;
      const def = this.avatarDef(name);
      if (!def) { delete this.layers[type]; continue; }
      this.assets.images.get(def.image); // lance le chargement de la couche
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
      if (!this.lootImage) this.lootImage = assets.images.get(this.loot.image);
      if (!this.lootImage) return;
      // lueur au sol qui respire : un butin ne se perd plus dans l'herbe
      // (or : objet rare ou pièces ; bleu : objet magique ; blanc : ordinaire)
      const t = performance.now() / 1000;
      const lueur = couleurButin(this.meta);
      const r = 26 * s * (1 + Math.sin(t * 2.4 + this.id) * 0.12);
      const g = ctx.createRadialGradient(px, py, 0, px, py, r);
      g.addColorStop(0, lueur.replace('A', '0.8'));
      g.addColorStop(1, lueur.replace('A', '0'));
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(px, py, r, r / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      const [x, y, w, h, ox, oy] = this.loot.frame;
      ctx.drawImage(this.lootImage, x, y, w, h, px - ox * s, py - oy * s, w * s, h * s);
      this.bbox = { x: px - ox * s, y: py - oy * s, w: w * s, h: h * s, sy: py };
      return;
    }
    if (this.kind === KIND.MOB) {
      if (!this.image) {
        const base = assets.images.get(this.imagePath);
        if (!base) return;
        this.image = tintedSheet(base, this.sprite, this.tint);
      }
      const f = this.anim.frame(d);
      if (!f) return;
      const [x, y, w, h, ox, oy] = f;
      const ms = s * this.spriteScale;
      ctx.drawImage(this.image, x, y, w, h, px - ox * ms, py - oy * ms, w * ms, h * ms);
      this.bbox = { x: px - ox * ms, y: py - oy * ms, w: w * ms, h: h * ms, sy: py };
      this.topY = py - oy * ms;
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
      const def = this.avatarDef(layer.name);
      if (!def) continue;
      const img = this.assets.images.get(def.image);
      if (!img) continue; // couche en chargement
      ctx.drawImage(img, x, y, w, h, px - ox * s, py - oy * s, w * s, h * s);
      minX = Math.min(minX, px - ox * s); minY = Math.min(minY, py - oy * s);
      maxX = Math.max(maxX, px - ox * s + w * s); maxY = Math.max(maxY, py - oy * s + h * s);
    }
    if (minX < 1e8) {
      this.bbox = { x: minX, y: minY, w: maxX - minX, h: maxY - minY, sy: py };
      this.topY = minY;
    }
  }

  // texte de la plaque de nom (null : pas de nom affiché)
  nomPlaque(selfId) {
    if (this.kind === KIND.DROP || this.state === ST.DEAD) return null;
    const isNpc = this.kind === KIND.NPC, isPlayer = this.kind === KIND.PLAYER;
    // préférences d'affichage (panneau Paramètres)
    const showName = isNpc ? true
      : isPlayer ? (this.id === selfId ? settings.showSelfName : settings.showPlayerNames)
      : settings.showMobNames;
    if (!showName) return null;
    const showLevel = isPlayer ? settings.showPlayerLevels : settings.showMobLevels;
    return (isNpc || !showLevel) ? this.meta.name : `${this.meta.name} [${this.level || this.meta.level}]`;
  }

  // rectangle écran de la plaque de nom (évitement des chevauchements)
  rectPlaque(ctx, px, py, s, selfId) {
    const name = this.nomPlaque(selfId);
    if (!name) return null;
    const taille = Math.max(11, 13 * s);
    ctx.font = `bold ${taille}px "Trebuchet MS", sans-serif`;
    const w = ctx.measureText(name).width, top = (this.topY ?? (py - 100 * s)) - 8;
    return { x: px - w / 2 - 2, y: top - 6 - taille, w: w + 4, h: taille + 2 };
  }

  // nom d'un objet au sol (Alt maintenu), sur un cartouche sombre, juste
  // au-dessus du point de pose ; décalé vers le haut tant qu'il chevauche
  // une plaque ou une étiquette déjà placée (`occupes`, complété)
  drawEtiquetteButin(ctx, px, py, s, occupes = []) {
    const m = this.meta;
    const texte = m.gold ? `${m.gold} pièces d'or` : (ITEMS[m.defId]?.name || 'Objet');
    ctx.font = `bold ${Math.max(11, 12 * s)}px "Trebuchet MS", sans-serif`;
    const w = ctx.measureText(texte).width + 10, h = Math.max(15, 16 * s);
    let y = py - 14 * s - h;
    for (let i = 0; i < 8; i++) {
      const o = occupes.find(o => px - w / 2 < o.x + o.w && px + w / 2 > o.x && y < o.y + o.h && y + h > o.y);
      if (!o) break;
      y = o.y - h - 2;
    }
    occupes.push({ x: px - w / 2, y, w, h });
    ctx.fillStyle = 'rgba(8, 12, 20, 0.82)';
    ctx.strokeStyle = couleurButin(m).replace('A', '0.9');
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(px - w / 2, y, w, h, 3);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = m.gold || m.q >= 2 ? '#f0cf7a' : m.q === 1 ? '#8fb8ff' : '#ece4d2';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(texte, px, y + h / 2 + 0.5);
    ctx.textBaseline = 'alphabetic';
  }

  // `sansNom` : plaque masquée parce qu'elle chevaucherait une plus prioritaire
  // (la barre de vie et la bulle restent)
  drawOverlay(ctx, px, py, s, selfId, sansNom = false, butin = null) {
    if (this.kind === KIND.DROP) { if (butin) this.drawEtiquetteButin(ctx, px, py, s, butin); return; }
    if (this.state === ST.DEAD) return;
    const top = (this.topY ?? (py - 100 * s)) - 8;
    const isNpc = this.kind === KIND.NPC;
    const isPlayer = this.kind === KIND.PLAYER;
    const isSelf = this.id === selfId;
    const name = sansNom ? null : this.nomPlaque(selfId);
    if (name) {
      ctx.font = `bold ${Math.max(11, 13 * s)}px "Trebuchet MS", sans-serif`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.strokeText(name, px, top - 6);
      ctx.fillStyle = isSelf ? '#a8e8a8'
        : isNpc ? '#ffe48a'
        : this.meta?.boss ? '#ffd24a'
        : (isPlayer ? (PARTY_IDS.has(this.id) ? PARTY_NAME_COLOR : '#a8d8ff') : '#ffd2a8');
      ctx.fillText(name, px, top - 6); // boss : nom en or
    }
    // barre de vie (pas pour les PNJ)
    let barTop = top;
    if (!isNpc && settings.showHpBars) {
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
      if (!settings.showBubbles) return;
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

// teinte d'un butin, gabarit rgba à compléter (« A » = opacité)
function couleurButin(m) {
  return m.gold || m.q >= 2 ? 'rgba(255, 200, 90, A)' : m.q === 1 ? 'rgba(110, 160, 255, A)' : 'rgba(235, 230, 215, A)';
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
