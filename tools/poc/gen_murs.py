#!/usr/bin/env python3
# POC-Murs v2 — surface de MAÇONNERIE riche (pierres biseautées, mortier en creux,
# AO au bord, grain, mousse au pied) projetée par le CODE sur les faces iso :
# l'orientation/raccord reste déterministe, mais le rendu est bien plus riche que
# le bloc lisse de la v1. + cap/parapet clair, AO vertical, tours à créneaux.
# Principe : le code gère la STRUCTURE, la QUALITÉ vient de la SURFACE.
# Usage : python3 gen_murs.py [dossier_sortie]
import numpy as np
from PIL import Image
import os, sys, math

HW, HH = 96, 48
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "samples")
os.makedirs(OUT, exist_ok=True)

def fbm2(h, w, seed, periods=(8, 16, 32, 64), amps=(0.5, 0.28, 0.14, 0.08)):
    s = max(h, w); rng = np.random.default_rng(seed); acc = np.zeros((s, s))
    for period, amp in zip(periods, amps):
        g = rng.random((period, period))
        t = np.linspace(0, period, s, endpoint=False)
        i0 = np.floor(t).astype(int); f = t - i0; f = f*f*(3-2*f)
        i1 = (i0+1) % period; i0 %= period
        fx = f[None, :]; fy = f[:, None]
        A = g[np.ix_(i0, i0)]; B = g[np.ix_(i0, i1)]; C = g[np.ix_(i1, i0)]; D = g[np.ix_(i1, i1)]
        acc += amp*((A*(1-fx)+B*fx)*(1-fy) + (C*(1-fx)+D*fx)*fy)
    acc = (acc-acc.min())/(acc.max()-acc.min()+1e-9)
    return acc[:h, :w]

def make_masonry(W=384, H=256, seed=7, base=(122, 118, 112), moss=True):
    rng = np.random.default_rng(seed)
    gap, bw, bh = 4, 46, 26
    pX, pY = bw+gap, bh+gap
    ncols, nrows = W//pX+3, H//pY+3
    jitL = rng.uniform(-1, 1, (nrows, ncols))               # variation de VALEUR par pierre
    jitC = rng.uniform(-1, 1, (nrows, ncols, 3)) * 3        # infime variation de teinte
    ys, xs = np.mgrid[0:H, 0:W]
    row = ys//pY; yin = ys-row*pY
    xx = xs + (row % 2)*(pX//2)
    col = xx//pX; xin = xx-col*pX
    in_brick = (yin < bh) & (xin < bw)
    bx = np.clip(xin/bw, 0, 1); by = np.clip(yin/bh, 0, 1)
    ri = np.clip(row, 0, nrows-1); ci = np.clip(col % ncols, 0, ncols-1)
    jl = jitL[ri, ci][..., None]; jc = jitC[ri, ci]
    color = np.array(base, float)[None, None, :] * (1 + 0.16*jl) + jc   # surtout clair/foncé
    bevel = 1.0 + 0.12*((0.5-by) + (0.5-bx))                 # lumière haut-gauche
    color = color*bevel[..., None]
    rim = np.minimum(np.minimum(bx, 1-bx), np.minimum(by, 1-by))
    color *= np.clip(1 - (rim < 0.10)*0.28, 0, 1)[..., None]  # AO au bord des pierres
    color += (fbm2(H, W, seed+1)[..., None]-0.5)*13           # grain de surface
    mortar = np.array([54, 52, 50])[None, None, :] + (fbm2(H, W, seed+9)[..., None]-0.5)*8
    out = np.where(in_brick[..., None], color, mortar)
    if moss:
        m = fbm2(H, W, seed+2)
        mask = ((ys/H) > 0.62) & (m > (0.72 + 0.3*(1-ys/H)))
        out = np.where(mask[..., None], out*0.6 + np.array([80, 104, 60])*0.4, out)
    q = 255/13
    return np.clip(np.round(out/q)*q, 0, 255).astype(np.uint8)

STONE = make_masonry(seed=7)
CAP = make_masonry(W=384, H=96, seed=21, base=(150, 146, 138), moss=False)

def w2s(x, z): return ((x-z)*HW, (x+z)*HH)
CW, CH, OXo, OYo = 340, 320, 170, 210
def Pt(x, z, y=0):
    sx, sy = w2s(x, z); return (sx+OXo, sy+OYo-y)

def fill_quad(canvas, quad, tex, shade, ao=0.0, wrap=1.0):
    bl, br, tr, tl = [np.array(p, float) for p in quad]
    e1 = br-bl; e2 = tl-bl
    det = e1[0]*e2[1]-e1[1]*e2[0]
    if abs(det) < 1e-6: return
    inv = np.array([[e2[1], -e2[0]], [-e1[1], e1[0]]])/det
    ch, cw = canvas.shape[:2]
    xs = [bl[0], br[0], tr[0], tl[0]]; ys = [bl[1], br[1], tr[1], tl[1]]
    x0 = max(0, int(math.floor(min(xs)))); x1 = min(cw, int(math.ceil(max(xs))))
    y0 = max(0, int(math.floor(min(ys)))); y1 = min(ch, int(math.ceil(max(ys))))
    if x1 <= x0 or y1 <= y0: return
    gy, gx = np.mgrid[y0:y1, x0:x1]
    rx = gx+0.5-bl[0]; ry = gy+0.5-bl[1]
    s = inv[0, 0]*rx+inv[0, 1]*ry; t = inv[1, 0]*rx+inv[1, 1]*ry
    inside = (s >= 0) & (s <= 1) & (t >= 0) & (t <= 1)
    H, W = tex.shape[:2]
    tsx = np.clip((np.mod(s*wrap, 1.0)*W).astype(int), 0, W-1)
    tsy = np.clip(((1-np.clip(t, 0, 1))*(H-1)).astype(int), 0, H-1)   # t=1 haut -> ligne 0
    col = tex[tsy, tsx].astype(float)
    vgrad = shade*(1 - ao*(1-t)); contact = np.clip(1 - (t < 0.04)*0.4, 0, 1)
    col = np.clip(col*(vgrad*contact)[..., None], 0, 255)
    sub = canvas[y0:y1, x0:x1]
    sub[inside, 0:3] = col[inside].astype(np.uint8); sub[inside, 3] = 255
    canvas[y0:y1, x0:x1] = sub

SH_TOP, SH_SE, SH_SW = 1.04, 0.9, 0.66
def newc(): return np.zeros((CH, CW, 4), np.uint8)
def crop_anchor(c):
    ys, xs = np.where(c[..., 3] > 0)
    if not len(xs): return None
    x0, x1, y0, y1 = xs.min(), xs.max()+1, ys.min(), ys.max()+1
    gx, gy = w2s(0.5, 0.5)
    return (Image.fromarray(c[y0:y1, x0:x1], "RGBA"), int(round(gx+OXo-x0)), int(round(gy+OYo-y0)))

def build(kind, H=78, t=0.17, cap=10):
    c = newc()
    if kind == "mur_x":
        z0, z1 = .5-t, .5+t
        fill_quad(c, (Pt(0, z1, 0), Pt(1, z1, 0), Pt(1, z1, H), Pt(0, z1, H)), STONE, SH_SW, ao=.4, wrap=1.1)
        fill_quad(c, (Pt(0, z0, H), Pt(1, z0, H), Pt(1, z1, H), Pt(0, z1, H)), CAP, SH_TOP, wrap=1.1)
        fill_quad(c, (Pt(0, z1, H), Pt(1, z1, H), Pt(1, z1, H+cap), Pt(0, z1, H+cap)), CAP, SH_SW*1.06, wrap=1.1)
    elif kind == "mur_z":
        x0, x1 = .5-t, .5+t
        fill_quad(c, (Pt(x1, 0, 0), Pt(x1, 1, 0), Pt(x1, 1, H), Pt(x1, 0, H)), STONE, SH_SE, ao=.4, wrap=1.1)
        fill_quad(c, (Pt(x0, 0, H), Pt(x1, 0, H), Pt(x1, 1, H), Pt(x0, 1, H)), CAP, SH_TOP, wrap=1.1)
        fill_quad(c, (Pt(x1, 0, H), Pt(x1, 1, H), Pt(x1, 1, H+cap), Pt(x1, 0, H+cap)), CAP, SH_SE*1.06, wrap=1.1)
    elif kind == "angle":
        x0, x1, z0, z1 = .5-t, .5+t, .5-t, .5+t
        fill_quad(c, (Pt(0, z1, 0), Pt(x1, z1, 0), Pt(x1, z1, H), Pt(0, z1, H)), STONE, SH_SW, ao=.4, wrap=1.1)
        fill_quad(c, (Pt(x1, z0, 0), Pt(x1, 1, 0), Pt(x1, 1, H), Pt(x1, z0, H)), STONE, SH_SE, ao=.4, wrap=1.1)
        fill_quad(c, (Pt(0, z0, H), Pt(x1, z0, H), Pt(x1, 1, H), Pt(0, 1, H)), CAP, SH_TOP, wrap=1.1)
    elif kind == "tour":
        x0, x1, z0, z1 = .5-.28, .5+.28, .5-.28, .5+.28
        Ht = H+34
        fill_quad(c, (Pt(x0, z1, 0), Pt(x1, z1, 0), Pt(x1, z1, Ht), Pt(x0, z1, Ht)), STONE, SH_SW, ao=.45, wrap=1.0)
        fill_quad(c, (Pt(x1, z0, 0), Pt(x1, z1, 0), Pt(x1, z1, Ht), Pt(x1, z0, Ht)), STONE, SH_SE, ao=.45, wrap=1.0)
        fill_quad(c, (Pt(x0, z0, Ht), Pt(x1, z0, Ht), Pt(x1, z1, Ht), Pt(x0, z1, Ht)), CAP, SH_TOP, wrap=1.0)
        for fx in (x0, (x0+x1)/2-0.06, x1-0.12):
            fill_quad(c, (Pt(fx, z1, Ht), Pt(fx+0.12, z1, Ht), Pt(fx+0.12, z1, Ht+16), Pt(fx, z1, Ht+16)), CAP, SH_SW*1.05, wrap=1.0)
    return crop_anchor(c)

PIECES = {k: build(k) for k in ("mur_x", "mur_z", "angle", "tour")}

def grass_tile(Pn=128):
    b = fbm2(Pn, Pn, 3, (8, 16, 32, 64), (.45, .28, .17, .1)); lo = np.array([60, 92, 44]); hi = np.array([120, 156, 70])
    rgb = lo*(1-b[..., None]) + hi*b[..., None]
    ys, xs = np.mgrid[0:96, 0:192]; A = (xs+.5-96)/96; B = (ys+.5)/48; u = (A+B)/2; v = (B-A)/2
    ins = (u >= 0) & (u < 1) & (v >= 0) & (v < 1)
    tx = np.clip((np.mod(u, 1)*Pn).astype(int), 0, Pn-1); ty = np.clip((np.mod(v, 1)*Pn).astype(int), 0, Pn-1)
    im = np.zeros((96, 192, 4), np.uint8); im[..., :3] = np.clip(rgb, 0, 255).astype(np.uint8)[ty, tx]; im[..., 3] = np.where(ins, 255, 0)
    return Image.fromarray(im, "RGBA")

if __name__ == "__main__":
    for name, (img, ox, oy) in PIECES.items():
        img.save(os.path.join(OUT, f"exemple_mur_{name}.png"))
        print(name, img.size, "ancre", (ox, oy))
    GRASS = grass_tile()
    walls = [(2, 2, "mur_x"), (3, 2, "mur_x"), (4, 2, "mur_x"), (5, 2, "angle"), (5, 3, "mur_z"), (5, 4, "mur_z"),
             (2, 5, "tour"), (7, 6, "tour")]
    place = [(x, z, GRASS, HW, HH) for x in range(9) for z in range(8)]
    place += [(x, z, PIECES[n][0], PIECES[n][1], PIECES[n][2]) for (x, z, n) in walls]
    sxs = [w2s(x, z)[0] for (x, z, *_) in place]; sysv = [w2s(x, z)[1] for (x, z, *_) in place]
    minx = min(sxs)-120; miny = min(sysv)-160
    canvas = Image.new("RGBA", (int(max(sxs)+120-minx), int(max(sysv)+120-miny)), (26, 24, 36, 255))
    floors = [p for p in place if p[2] is GRASS]; props = [p for p in place if p[2] is not GRASS]
    for grp in (sorted(floors, key=lambda p: p[0]+p[1]), sorted(props, key=lambda p: p[0]+p[1])):
        for (x, z, img, ox, oy) in grp:
            sx, sy = w2s(x, z)
            canvas.alpha_composite(img, (int(sx-minx-ox), int(sy-miny-oy)))
    canvas.save(os.path.join(OUT, "preuve_murs.png"))
    print("OK murs v2 ->", OUT)
