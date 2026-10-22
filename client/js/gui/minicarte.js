// Mini-carte du HUD : vue de la zone centrée sur le joueur, orientée comme
// l'écran isométrique (monde +x vers le bas-droite, +z vers le bas-gauche),
// d'où le losange. Fond : 1 pixel par tuile, mis en cache par zone.
// Repères : PNJ, membres du groupe, autres joueurs, monstres proches, et les
// lieux utiles (obélisques, coffre, portails, grottes). Un clic y fait marcher.
import { KIND } from '../../../shared/constants.js';
import { TILE_COLORS } from '../render2d/couleurs-tuiles.js';
import { uiStore } from './ui-store.js';

const ZOOMS = [16, 24, 36, 56];   // rayon visible, en tuiles
const LIEUX = {
  obelisk: { couleur: '#8fb8ff', forme: 'triangle', nom: 'Obélisque' },
  bank: { couleur: '#e3a857', forme: 'carre', nom: 'Coffre' },
  trialgate: { couleur: '#c39bff', forme: 'losange', nom: 'Épreuve' },
  exitgate: { couleur: '#9fe6c8', forme: 'losange', nom: 'Sortie' },
  cave: { couleur: '#e6d27a', forme: 'losange', nom: 'Grotte' },
  chest: { couleur: '#e3a857', forme: 'carre', nom: 'Coffre au trésor' },
};

export class MiniCarte {
  constructor(canvas, onMove) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onMove = onMove;       // (x, z) -> déplacement demandé
    this.fond = null;
    this.world = null;
    this.centre = { x: 0, z: 0 };
    canvas.addEventListener('pointerdown', (ev) => {
      ev.stopPropagation();
      const r = canvas.getBoundingClientRect();
      const w = this.versMonde(ev.clientX - r.left, ev.clientY - r.top);
      if (this.world && w.x >= 0 && w.z >= 0 && w.x < this.world.size && w.z < this.world.size) this.onMove(w.x, w.z);
    });
  }

  get rayon() { return ZOOMS[uiStore.miniZoom] ?? ZOOMS[1]; }

  // fond de la zone : 1 px par tuile, maisons et murs en surimpression
  setWorld(world) {
    this.world = world;
    const N = world.size;
    const c = document.createElement('canvas');
    c.width = c.height = N;
    const g = c.getContext('2d');
    const img = g.createImageData(N, N);
    const rgb = {};
    for (const [t, hex] of Object.entries(TILE_COLORS)) {
      rgb[t] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
    }
    for (let i = 0; i < N * N; i++) {
      const [r, gg, b] = rgb[world.tile[i]] || [40, 40, 40];
      img.data.set([r, gg, b, 255], i * 4);
    }
    g.putImageData(img, 0, 0);
    for (const p of world.props || []) {
      if (p.type === 'house') {
        g.fillStyle = '#6b4e33';
        g.fillRect(p.x - (p.w || 2) / 2, p.z - (p.d || 2) / 2, p.w || 2, p.d || 2);
      } else if (p.type === 'wall' || p.type === 'fence' || p.type === 'ruin') {
        g.fillStyle = '#4a4440';
        g.fillRect(Math.floor(p.x), Math.floor(p.z), 1, 1);
      }
    }
    this.fond = c;
  }

  // transformation monde -> canvas (rotation de 45° comme l'écran iso)
  echelle() { return (this.canvas.width / 2) / this.rayon; }
  versCanvas(x, z) {
    const k = this.echelle(), dx = (x - this.centre.x) * k, dz = (z - this.centre.z) * k;
    const c = Math.SQRT1_2;
    return { x: this.canvas.width / 2 + (dx - dz) * c, y: this.canvas.height / 2 + (dx + dz) * c };
  }
  versMonde(px, py) {
    const k = this.echelle(), c = Math.SQRT1_2;
    const sx = (px * this.canvas.width / this.canvas.clientWidth - this.canvas.width / 2) / c;
    const sy = (py * this.canvas.height / this.canvas.clientHeight - this.canvas.height / 2) / c;
    // sx = dx - dz, sy = dx + dz
    return { x: this.centre.x + (sx + sy) / 2 / k, z: this.centre.z + (sy - sx) / 2 / k };
  }

  dessiner(em, selfId, props) {
    const { ctx, canvas } = this;
    const S = canvas.width;
    const moi = em.get(selfId);
    if (!this.fond || !moi) return;
    this.centre = { x: moi.x, z: moi.z };
    ctx.save();
    ctx.clearRect(0, 0, S, S);
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S / 2 - 1, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#0a0f18';
    ctx.fillRect(0, 0, S, S);
    // fond tourné de 45°, centré sur le joueur
    const k = this.echelle();
    ctx.save();
    ctx.translate(S / 2, S / 2);
    ctx.rotate(Math.PI / 4);
    ctx.scale(k, k);
    ctx.translate(-moi.x, -moi.z);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.fond, 0, 0);
    ctx.restore();
    // assombrissement de bord : lisibilité des repères
    const vg = ctx.createRadialGradient(S / 2, S / 2, S * 0.3, S / 2, S / 2, S / 2);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, S, S);

    for (const p of props || []) {
      const l = LIEUX[p.interact];
      if (l) this.repere(p.x, p.z, l.couleur, l.forme, 5);
    }
    const groupe = new Set((uiStore.party?.members || []).map(m => m.id));
    for (const v of em.views.values()) {
      if (v.id === selfId || v.isDead?.()) continue;
      if (v.kind === KIND.MOB) this.point(v.x, v.z, '#d9573e', 2);
      else if (v.kind === KIND.NPC) this.point(v.x, v.z, '#f0d27a', 3);
      else if (v.kind === KIND.PLAYER) this.point(v.x, v.z, groupe.has(v.id) ? '#6fc3ff' : '#f2efe6', 3);
    }
    // soi : flèche au centre
    ctx.fillStyle = '#ffd98a';
    ctx.strokeStyle = '#1a1206';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    // liseré et repère du nord (haut-droite, comme la boussole)
    ctx.strokeStyle = 'rgba(199,154,78,0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S / 2 - 1, 0, Math.PI * 2);
    ctx.stroke();
    const a = -Math.PI / 4, rN = S / 2 - 11;
    ctx.font = 'bold 11px Trebuchet MS, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(10,15,24,0.85)';
    ctx.beginPath();
    ctx.arc(S / 2 + Math.cos(a) * rN, S / 2 + Math.sin(a) * rN, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#d8b06a';
    ctx.fillText('N', S / 2 + Math.cos(a) * rN, S / 2 + Math.sin(a) * rN + 0.5);
  }

  point(x, z, couleur, r) {
    const p = this.versCanvas(x, z);
    const { ctx } = this;
    ctx.fillStyle = couleur;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  repere(x, z, couleur, forme, r) {
    const p = this.versCanvas(x, z);
    const { ctx } = this;
    ctx.fillStyle = couleur;
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (forme === 'triangle') { ctx.moveTo(p.x, p.y - r); ctx.lineTo(p.x + r, p.y + r * 0.8); ctx.lineTo(p.x - r, p.y + r * 0.8); }
    else if (forme === 'carre') ctx.rect(p.x - r * 0.8, p.y - r * 0.8, r * 1.6, r * 1.6);
    else { ctx.moveTo(p.x, p.y - r); ctx.lineTo(p.x + r, p.y); ctx.lineTo(p.x, p.y + r); ctx.lineTo(p.x - r, p.y); }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}

export const ZOOM_MAX = ZOOMS.length - 1;
