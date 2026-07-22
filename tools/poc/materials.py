#!/usr/bin/env python3
# Bibliothèque de matériaux de mur procéduraux + géométrie iso partagée.
# 5 surfaces : pierre, bois, paille, terre, colombage (terre/bois médiéval).
# Chaque surface est une texture (tuilable en longueur) projetée par le CODE sur
# les faces des pièces (mur_x, mur_z, angle, tour) : orientation déterministe.
# Lancé seul -> écrit une planche comparative (samples/materiaux_planche.png).
import numpy as np
from PIL import Image, ImageDraw
import os, sys, math

HW, HH = 96, 48
W, H = 384, 256
YS, XS = np.mgrid[0:H, 0:W]

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

def post(out):
    q = 255/13
    return np.clip(np.round(out/q)*q, 0, 255).astype(np.uint8)

def m_pierre(seed=7, base=(122, 118, 112), moss=True):
    rng = np.random.default_rng(seed)
    gap, bw, bh = 4, 46, 26; pX, pY = bw+gap, bh+gap
    ncols, nrows = W//pX+3, H//pY+3
    jitL = rng.uniform(-1, 1, (nrows, ncols)); jitC = rng.uniform(-1, 1, (nrows, ncols, 3))*3
    row = YS//pY; yin = YS-row*pY
    xx = XS + (row % 2)*(pX//2); col = xx//pX; xin = xx-col*pX
    in_b = (yin < bh) & (xin < bw)
    bx = np.clip(xin/bw, 0, 1); by = np.clip(yin/bh, 0, 1)
    ri = np.clip(row, 0, nrows-1); ci = np.clip(col % ncols, 0, ncols-1)
    color = np.array(base, float)[None, None, :]*(1+0.16*jitL[ri, ci][..., None]) + jitC[ri, ci]
    color *= (1.0+0.12*((0.5-by)+(0.5-bx)))[..., None]
    rim = np.minimum(np.minimum(bx, 1-bx), np.minimum(by, 1-by))
    color *= np.clip(1-(rim < 0.10)*0.28, 0, 1)[..., None]
    color += (fbm2(H, W, seed+1)[..., None]-0.5)*13
    mortar = np.array([54, 52, 50], float)[None, None, :]+(fbm2(H, W, seed+9)[..., None]-0.5)*8
    out = np.where(in_b[..., None], color, mortar)
    if moss:
        mm = fbm2(H, W, seed+2); mask = ((YS/H) > 0.62) & (mm > (0.72+0.3*(1-YS/H)))
        out = np.where(mask[..., None], out*0.6+np.array([80, 104, 60])*0.4, out)
    return post(out)

def m_bois(seed=4, base=(122, 84, 50)):
    rng = np.random.default_rng(seed); pw = 44
    plank = XS//pw; xin = (XS % pw)/pw
    jit = rng.uniform(-1, 1, W//pw+2)
    val = np.array(base, float)[None, None, :]*(1+0.14*jit[plank][..., None])
    grain = 0.5+0.5*np.sin(xin*np.pi*5 + fbm2(H, W, seed+3, (2, 4, 8, 16), (.5, .3, .15, .1))*4*np.pi)
    val = val*(0.82+0.2*grain[..., None])
    val += (fbm2(H, W, seed+5, (4, 8, 32), (.5, .3, .2))[..., None]-0.5)*10
    seam = (xin < 0.04) | (xin > 0.96)
    val = np.where(seam[..., None], val*0.45, val)
    kn = fbm2(H, W, seed+7, (6, 12), (.6, .4))
    val = np.where((kn > 0.9)[..., None], val*0.55, val)
    return post(val)

def m_paille(seed=2, base=(202, 174, 96)):
    ch = 34
    course = YS//ch; yin = (YS % ch)/ch
    # rayures verticales fines (brins) + variation par assise
    striae = 0.5+0.5*np.sin(XS*0.9 + fbm2(H, W, seed+3, (3, 6, 12), (.6, .3, .1))*6*np.pi)
    val = np.array(base, float)[None, None, :]*(0.70+0.42*striae[..., None])
    val += (fbm2(H, W, seed+4, (2, 4, 8, 16, 32), (.4, .3, .15, .1, .05))[..., None]-0.5)*24
    hi = yin < 0.14                                         # pointe claire en haut de brin
    val = np.where(hi[..., None], val*1.12, val)
    tips = 0.78 + 0.16*np.abs(np.sin(XS*0.7 + fbm2(H, W, seed+7, (4, 8, 16), (.6, .3, .1))*5*np.pi))
    fringe = yin > tips                                    # frange dentelée + ombre de débord
    val = np.where(fringe[..., None], val*0.42, val)
    return post(val)

def m_terre(seed=8, base=(128, 94, 62)):
    blotch = fbm2(H, W, seed, (3, 6, 12, 24), (.5, .28, .14, .08))
    val = np.array(base, float)[None, None, :]*(0.78+0.42*blotch[..., None])
    val += (fbm2(H, W, seed+2, (16, 32, 64), (.5, .3, .2))[..., None]-0.5)*14
    ridged = np.abs(fbm2(H, W, seed+3, (5, 10, 20), (.6, .3, .1))-0.5)
    val = np.where((ridged < 0.015)[..., None], val*0.5, val)
    rng = np.random.default_rng(seed+9); fl = rng.random((H, W))
    val = np.where((fl > 0.995)[..., None], val*1.4, val)
    val = np.where((fl < 0.004)[..., None], val*0.6, val)
    return post(val)

def m_colombage(seed=5, daub=(210, 196, 168), timber=(74, 50, 32)):
    bay = 128; beam = 13
    d = np.array(daub, float)[None, None, :]*(0.86+0.24*fbm2(H, W, seed, (3, 6, 12), (.5, .3, .2))[..., None])
    tb = np.array(timber, float)[None, None, :]*(0.85+0.3*fbm2(H, W, seed+1, (2, 6, 16), (.5, .3, .2))[..., None])
    xin = XS % bay; top = YS < beam; bot = YS > H-beam
    postm = (xin < beam) | (xin > bay-beam)
    a = xin/bay; b = YS/H; diag = np.abs(b-(1-a)) < 0.075
    frame = top | bot | postm | diag
    return post(np.where(frame[..., None], tb, d))

# [clé, libellé, surface, cap]
MATERIALS = {
    "proc_pierre":    ("Pierre (atelier)",    m_pierre(),                    m_pierre(base=(150, 146, 138), moss=False)),
    "proc_bois":      ("Bois (atelier)",       m_bois(),                      m_bois(base=(96, 64, 38))),
    "proc_paille":    ("Paille (atelier)",     m_paille(),                    m_paille(base=(172, 148, 80))),
    "proc_terre":     ("Terre (atelier)",      m_terre(),                     m_terre(base=(150, 112, 76))),
    "proc_colombage": ("Colombage (atelier)",  m_colombage(),                 m_colombage(daub=(150, 110, 74))),
}

# ---------------- géométrie iso (identique aux générateurs) ----------------
def w2s(x, z): return ((x-z)*HW, (x+z)*HH)
CW, CH, OXo, OYo = 340, 320, 170, 210
def Pt(x, z, y=0):
    sx, sy = w2s(x, z); return (sx+OXo, sy+OYo-y)

def fill_quad(canvas, quad, tex, shade, ao=0.0, wrap=1.0):
    bl, br, tr, tl = [np.array(p, float) for p in quad]
    e1 = br-bl; e2 = tl-bl; det = e1[0]*e2[1]-e1[1]*e2[0]
    if abs(det) < 1e-6: return
    inv = np.array([[e2[1], -e2[0]], [-e1[1], e1[0]]])/det
    ch, cw = canvas.shape[:2]
    xs = [bl[0], br[0], tr[0], tl[0]]; ys = [bl[1], br[1], tr[1], tl[1]]
    x0 = max(0, int(math.floor(min(xs)))); x1 = min(cw, int(math.ceil(max(xs))))
    y0 = max(0, int(math.floor(min(ys)))); y1 = min(ch, int(math.ceil(max(ys))))
    if x1 <= x0 or y1 <= y0: return
    gy, gx = np.mgrid[y0:y1, x0:x1]; rx = gx+0.5-bl[0]; ry = gy+0.5-bl[1]
    s = inv[0, 0]*rx+inv[0, 1]*ry; t = inv[1, 0]*rx+inv[1, 1]*ry
    inside = (s >= 0) & (s <= 1) & (t >= 0) & (t <= 1)
    th, tw = tex.shape[:2]
    tsx = np.clip((np.mod(s*wrap, 1.0)*tw).astype(int), 0, tw-1)
    tsy = np.clip(((1-np.clip(t, 0, 1))*(th-1)).astype(int), 0, th-1)
    col = tex[tsy, tsx].astype(float)
    vg = shade*(1-ao*(1-t)); contact = np.clip(1-(t < 0.04)*0.4, 0, 1)
    col = np.clip(col*(vg*contact)[..., None], 0, 255)
    sub = canvas[y0:y1, x0:x1]; sub[inside, 0:3] = col[inside].astype(np.uint8); sub[inside, 3] = 255
    canvas[y0:y1, x0:x1] = sub

SH_TOP, SH_SE, SH_SW = 1.04, 0.9, 0.66
def _c(): return np.zeros((CH, CW, 4), np.uint8)
def _crop(c):
    ys, xs = np.where(c[..., 3] > 0)
    x0, x1, y0, y1 = xs.min(), xs.max()+1, ys.min(), ys.max()+1
    gx, gy = w2s(0.5, 0.5)
    return (Image.fromarray(c[y0:y1, x0:x1], "RGBA"), int(round(gx+OXo-x0)), int(round(gy+OYo-y0)))

def build(kind, stone, cap, H_=78, t=0.17, cp=10):
    c = _c()
    if kind == "mur_x":
        z0, z1 = .5-t, .5+t
        fill_quad(c, (Pt(0, z1, 0), Pt(1, z1, 0), Pt(1, z1, H_), Pt(0, z1, H_)), stone, SH_SW, ao=.4, wrap=1.1)
        fill_quad(c, (Pt(0, z0, H_), Pt(1, z0, H_), Pt(1, z1, H_), Pt(0, z1, H_)), cap, SH_TOP, wrap=1.1)
        fill_quad(c, (Pt(0, z1, H_), Pt(1, z1, H_), Pt(1, z1, H_+cp), Pt(0, z1, H_+cp)), cap, SH_SW*1.06, wrap=1.1)
    elif kind == "mur_z":
        x0, x1 = .5-t, .5+t
        fill_quad(c, (Pt(x1, 0, 0), Pt(x1, 1, 0), Pt(x1, 1, H_), Pt(x1, 0, H_)), stone, SH_SE, ao=.4, wrap=1.1)
        fill_quad(c, (Pt(x0, 0, H_), Pt(x1, 0, H_), Pt(x1, 1, H_), Pt(x0, 1, H_)), cap, SH_TOP, wrap=1.1)
        fill_quad(c, (Pt(x1, 0, H_), Pt(x1, 1, H_), Pt(x1, 1, H_+cp), Pt(x1, 0, H_+cp)), cap, SH_SE*1.06, wrap=1.1)
    elif kind == "angle":
        x0, x1, z0, z1 = .5-t, .5+t, .5-t, .5+t
        fill_quad(c, (Pt(0, z1, 0), Pt(x1, z1, 0), Pt(x1, z1, H_), Pt(0, z1, H_)), stone, SH_SW, ao=.4, wrap=1.1)
        fill_quad(c, (Pt(x1, z0, 0), Pt(x1, 1, 0), Pt(x1, 1, H_), Pt(x1, z0, H_)), stone, SH_SE, ao=.4, wrap=1.1)
        fill_quad(c, (Pt(0, z0, H_), Pt(x1, z0, H_), Pt(x1, 1, H_), Pt(0, 1, H_)), cap, SH_TOP, wrap=1.1)
    elif kind == "tour":
        x0, x1, z0, z1 = .5-.28, .5+.28, .5-.28, .5+.28; Ht = H_+30
        fill_quad(c, (Pt(x0, z1, 0), Pt(x1, z1, 0), Pt(x1, z1, Ht), Pt(x0, z1, Ht)), stone, SH_SW, ao=.45)
        fill_quad(c, (Pt(x1, z0, 0), Pt(x1, z1, 0), Pt(x1, z1, Ht), Pt(x1, z0, Ht)), stone, SH_SE, ao=.45)
        fill_quad(c, (Pt(x0, z0, Ht), Pt(x1, z0, Ht), Pt(x1, z1, Ht), Pt(x0, z1, Ht)), cap, SH_TOP)
        for fx in (x0, (x0+x1)/2-0.06, x1-0.12):
            fill_quad(c, (Pt(fx, z1, Ht), Pt(fx+0.12, z1, Ht), Pt(fx+0.12, z1, Ht+16), Pt(fx, z1, Ht+16)), cap, SH_SW*1.05)
    return _crop(c)

WALL_KINDS = ("mur_x", "mur_z", "angle", "tour")   # ordre des frames 0..3
def wall_pieces(matkey):
    _, surface, cap = MATERIALS[matkey]
    return [(k, *build(k, surface, cap)) for k in WALL_KINDS]

if __name__ == "__main__":
    OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "samples")
    os.makedirs(OUT, exist_ok=True)
    def grass():
        Pn = 128; b = fbm2(Pn, Pn, 3, (8, 16, 32, 64), (.45, .28, .17, .1))
        rgb = np.array([60, 92, 44])*(1-b[..., None]) + np.array([120, 156, 70])*b[..., None]
        ys, xs = np.mgrid[0:96, 0:192]; A = (xs+.5-96)/96; B = (ys+.5)/48; u = (A+B)/2; v = (B-A)/2
        ins = (u >= 0) & (u < 1) & (v >= 0) & (v < 1)
        tx = np.clip((np.mod(u, 1)*Pn).astype(int), 0, Pn-1); ty = np.clip((np.mod(v, 1)*Pn).astype(int), 0, Pn-1)
        im = np.zeros((96, 192, 4), np.uint8); im[..., :3] = np.clip(rgb, 0, 255).astype(np.uint8)[ty, tx]; im[..., 3] = np.where(ins, 255, 0)
        return Image.fromarray(im, "RGBA")
    GRASS = grass()
    def scene(matkey):
        P = {k: (img, ox, oy) for (k, img, ox, oy) in wall_pieces(matkey)}
        walls = [(1, 1, "mur_x"), (2, 1, "mur_x"), (3, 1, "angle"), (3, 2, "mur_z"), (3, 3, "mur_z"), (0, 3, "tour")]
        place = [(x, z, GRASS, HW, HH) for x in range(6) for z in range(5)]
        place += [(x, z, *P[n]) for (x, z, n) in walls]
        sxs = [w2s(x, z)[0] for (x, z, *_) in place]; sysv = [w2s(x, z)[1] for (x, z, *_) in place]
        minx = min(sxs)-100; miny = min(sysv)-150
        cv = Image.new("RGBA", (int(max(sxs)+100-minx), int(max(sysv)+110-miny)), (30, 28, 40, 255))
        fl = [p for p in place if p[2] is GRASS]; pr = [p for p in place if p[2] is not GRASS]
        for grp in (sorted(fl, key=lambda p: p[0]+p[1]), sorted(pr, key=lambda p: p[0]+p[1])):
            for (x, z, img, ox, oy) in grp:
                sx, sy = w2s(x, z); cv.alpha_composite(img, (int(sx-minx-ox), int(sy-miny-oy)))
        return cv
    scenes = {k: scene(k) for k in MATERIALS}
    cw = max(im.width for im in scenes.values()); chh = max(im.height for im in scenes.values())+28
    sheet = Image.new("RGBA", (2*cw, 3*chh), (18, 16, 26, 255)); dr = ImageDraw.Draw(sheet)
    for i, (k, im) in enumerate(scenes.items()):
        cx = (i % 2)*cw; cy = (i//2)*chh
        dr.text((cx+10, cy+6), MATERIALS[k][0], fill=(230, 220, 180, 255)); sheet.alpha_composite(im, (cx, cy+26))
    sheet.save(os.path.join(OUT, "materiaux_planche.png"))
    print("OK planche ->", OUT)
