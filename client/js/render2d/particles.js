// Petit système de particules canvas 2D pour les effets de sorts.
// Pool fixe pré-alloué : AUCUNE allocation par frame, on recycle les
// emplacements les plus anciens. Coordonnées monde (x, z) + hauteur écran (h,
// en pixels non zoomés) pour les effets qui montent ou retombent.
import { settings } from '../settings.js';

const MAX = 700;

// Densité FX choisie dans les paramètres (0..1) : chaque émetteur multiplie son
// nombre de particules par ce facteur. 0 = aucune particule ; sinon au moins 1
// (un effet ne disparaît jamais totalement tant que la densité est > 0).
function densify(count) {
  const d = Number.isFinite(+settings.fxDensity) ? Math.max(0, Math.min(1, +settings.fxDensity)) : 1;
  if (d <= 0) return 0;
  return Math.max(1, Math.round(count * d));
}

export class Particles {
  constructor() {
    this.pool = [];
    for (let i = 0; i < MAX; i++) {
      this.pool.push({
        on: false, x: 0, z: 0, h: 0, vx: 0, vz: 0, vh: 0, g: 0,
        age: 0, life: 1, size: 3, color: '#fff', grow: 0, drag: 1,
      });
    }
    this.cursor = 0;
  }

  spawn(o) {
    const q = this.pool[this.cursor];
    this.cursor = (this.cursor + 1) % MAX;
    q.on = true; q.age = 0;
    q.x = o.x; q.z = o.z; q.h = o.h || 0;
    q.vx = o.vx || 0; q.vz = o.vz || 0; q.vh = o.vh || 0;
    q.g = o.g || 0; q.life = o.life || 0.6; q.size = o.size || 3;
    q.color = o.color || '#fff'; q.grow = o.grow || 0; q.drag = o.drag ?? 1;
  }

  update(dt) {
    for (const q of this.pool) {
      if (!q.on) continue;
      q.age += dt;
      if (q.age >= q.life) { q.on = false; continue; }
      q.x += q.vx * dt;
      q.z += q.vz * dt;
      q.h += q.vh * dt;
      q.vh -= q.g * dt;
      if (q.drag !== 1) { q.vx *= q.drag; q.vz *= q.drag; }
    }
  }

  // w2s : (x, z) -> {x, y} écran ; s : zoom
  draw(ctx, w2s, s) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const q of this.pool) {
      if (!q.on) continue;
      const t = q.age / q.life;
      const p = w2s(q.x, q.z);
      const r = Math.max(0.4, q.size * s * (1 + q.grow * t) * (1 - t * 0.6));
      ctx.globalAlpha = (1 - t) * 0.9;
      ctx.fillStyle = q.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y - q.h * s, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }
}

// Palettes et comportements par style (élément, ou poison/drain dérivés)
export const FX_STYLES = {
  feu:     { colors: ['#ff5010', '#ff9040', '#ffd24a'], rise: 55,  spread: 1.6, size: 3.5 },
  eau:     { colors: ['#bfeaff', '#9fd4ff', '#ffffff'], rise: 25,  spread: 1.4, size: 2.6 },
  air:     { colors: ['#e8f4ff', '#9fe4ff', '#ffffff'], rise: 40,  spread: 1.8, size: 2.2 },
  terre:   { colors: ['#b89868', '#8a6a48', '#d8c8a8'], rise: 30,  spread: 1.8, size: 3.2 },
  lumiere: { colors: ['#fff4c8', '#ffe9a8', '#ffffff'], rise: 60,  spread: 1.0, size: 3.0 },
  arcane:  { colors: ['#b040b0', '#7a2090', '#d070d0'], rise: 35,  spread: 1.4, size: 3.0 },
  neutre:  { colors: ['#d8b8ff', '#ffffff', '#c8a8ff'], rise: 35,  spread: 1.4, size: 2.8 },
  poison:  { colors: ['#7ec850', '#a0d870', '#4e8a30'], rise: 45,  spread: 1.0, size: 3.0 },
  drain:   { colors: ['#5a1a6a', '#902090', '#30103a'], rise: 20,  spread: 0.8, size: 3.4 },
};

export function styleOf(element) {
  return FX_STYLES[element] || FX_STYLES.neutre;
}

const pick = (a) => a[(Math.random() * a.length) | 0];

// Traînée d'un projectile (appelée chaque frame à la position de la tête)
export function emitTrail(P, element, x, z, h = 40) {
  const st = styleOf(element);
  for (let i = 0, n = densify(2); i < n; i++) {
    P.spawn({
      x, z, h: h + (Math.random() - 0.5) * 10,
      vx: (Math.random() - 0.5) * st.spread, vz: (Math.random() - 0.5) * st.spread,
      vh: st.rise * (0.2 + Math.random() * 0.4), g: element === 'terre' ? 80 : 0,
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
      vh: st.rise * (0.5 + Math.random() * 0.9), g: element === 'terre' ? 160 : 30,
      life: 0.5 + Math.random() * 0.5, size: st.size * (0.8 + Math.random() * 0.8),
      color: pick(st.colors), grow: element === 'feu' ? 0.6 : 0,
    });
  }
}

// Halo doux montant (soins / lumière)
export function emitHeal(P, x, z) {
  const st = FX_STYLES.lumiere;
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
