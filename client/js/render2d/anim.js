// Lecture des animations Flare : 8 directions, types looped / back_forth / play_once
export class Animator {
  constructor(anims) {
    this.anims = anims;       // { stance: {frames, duration, type, fr: {dir: [frame rects]}}, ... }
    this.name = 'stance';
    this.t = 0;
    this.done = false;
  }

  set(name, restart = false) {
    if (!this.anims[name]) name = 'stance';
    if (this.name !== name || restart) {
      this.name = name;
      this.t = 0;
      this.done = false;
    }
  }

  tick(dt) { this.t += dt * 1000; }

  // retourne [x,y,w,h,ox,oy] pour la direction donnée, ou null
  frame(dir) {
    const a = this.anims[this.name] || this.anims.stance;
    if (!a) return null;
    const n = a.frames;
    let idx;
    if (a.type === 'play_once') {
      idx = Math.min(n - 1, Math.floor((this.t / a.duration) * n));
      if (idx === n - 1) this.done = true;
    } else if (a.type === 'back_forth') {
      const cycle = 2 * n - 2 || 1;
      const f = Math.floor((this.t / a.duration) * n) % cycle;
      idx = f < n ? f : cycle - f;
    } else { // looped
      idx = Math.floor((this.t / a.duration) * n) % n;
    }
    const frames = a.fr[dir] || a.fr[0];
    if (!frames) return null;
    return frames[Math.min(idx, frames.length - 1)] || frames[0];
  }
}

// Direction serveur (atan2(dx,dz) en espace carte) -> index Flare (0=O, 2=N, 4=E, 6=S)
export function flareDir(mapDir) {
  const dx = Math.sin(mapDir), dz = Math.cos(mapDir);
  const sx = dx - dz, sy = (dx + dz) / 2;
  const deg = Math.atan2(sy, sx) * 180 / Math.PI;
  return ((Math.round((deg - 180) / 45) % 8) + 8) % 8;
}

// Ordre de superposition des couches avatar selon la direction (cf. hero_layers Flare)
export const LAYER_ORDER = [
  ['main', 'feet', 'legs', 'hands', 'chest', 'off', 'head'],  // 0 O
  ['main', 'feet', 'legs', 'hands', 'chest', 'off', 'head'],  // 1 NO
  ['feet', 'legs', 'hands', 'chest', 'off', 'head', 'main'],  // 2 N
  ['feet', 'legs', 'hands', 'chest', 'off', 'head', 'main'],  // 3 NE
  ['feet', 'legs', 'hands', 'chest', 'off', 'head', 'main'],  // 4 E
  ['feet', 'legs', 'hands', 'main', 'chest', 'head', 'off'],  // 5 SE
  ['main', 'feet', 'legs', 'hands', 'chest', 'head', 'off'],  // 6 S
  ['main', 'feet', 'legs', 'hands', 'chest', 'off', 'head'],  // 7 SO
];
