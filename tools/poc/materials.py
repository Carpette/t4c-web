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

# [clé -> (libellé, surface, cap[, options])] ; options : {"H": hauteur du mur}
# Les VARIANTES par recolor multiplient la bibliothèque à coût quasi nul : même
# géométrie/maçonnerie, seule la palette du matériau change.
MATERIALS = {
    "proc_pierre":    ("Pierre (atelier)",    m_pierre(),                    m_pierre(base=(150, 146, 138), moss=False)),
    "proc_bois":      ("Bois (atelier)",       m_bois(),                      m_bois(base=(96, 64, 38))),
    "proc_paille":    ("Paille (atelier)",     m_paille(),                    m_paille(base=(172, 148, 80))),
    "proc_terre":     ("Terre (atelier)",      m_terre(),                     m_terre(base=(150, 112, 76))),
    "proc_colombage": ("Colombage (atelier)",  m_colombage(),                 m_colombage(daub=(150, 110, 74))),
    # --- variantes recolor ---
    "proc_gres":      ("Grès (atelier)",       m_pierre(seed=13, base=(168, 138, 96)),  m_pierre(seed=27, base=(196, 170, 128), moss=False)),
    "proc_basalte":   ("Basalte (atelier)",    m_pierre(seed=17, base=(74, 72, 80), moss=False), m_pierre(seed=29, base=(96, 94, 104), moss=False)),
    "proc_brique":    ("Brique cuite (atelier)", m_pierre(seed=19, base=(152, 82, 58), moss=False), m_pierre(seed=31, base=(178, 108, 80), moss=False)),
    "proc_chene":     ("Chêne sombre (atelier)", m_bois(seed=9, base=(74, 48, 30)),     m_bois(seed=15, base=(58, 38, 24))),
    "proc_colombage_blanc": ("Colombage blanc (atelier)", m_colombage(seed=11, daub=(226, 218, 200)), m_colombage(seed=21, daub=(200, 190, 170))),
    # --- palissade : mur bas en bois (même jeu de pièces, hauteur réduite) ---
    "proc_palissade": ("Palissade (atelier)",  m_bois(seed=6, base=(112, 78, 46)),      m_bois(seed=12, base=(90, 62, 38)), {"H": 46}),
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
def _crop_at(c, ax, az):
    ys, xs = np.where(c[..., 3] > 0)
    if not len(xs):
        return (Image.new("RGBA", (1, 1)), 0, 0)
    x0, x1, y0, y1 = xs.min(), xs.max()+1, ys.min(), ys.max()+1
    gx, gy = w2s(ax, az)   # ancre = point de pose du prop (arête ou sommet)
    return (Image.fromarray(c[y0:y1, x0:x1], "RGBA"), int(round(gx+OXo-x0)), int(round(gy+OYo-y0)))

# ---------------- MURS SUR ARÊTES ----------------
# Le mur chevauche la FRONTIÈRE entre deux cases (pas le milieu) : chaque case
# reste 100% intérieur OU 100% extérieur -> aucune fuite de sol. Trois pièces :
#   ex  (arête-X) : le long de +x, à cheval sur la ligne z=0 -> posé en (i+0.5, J)
#   ez  (arête-Z) : le long de +z, à cheval sur x=0        -> posé en (i, J+0.5)
#   post (poteau) : jonction au sommet                     -> posé en (i, J)
# Chemin de ronde avec parapet DES DEUX CÔTÉS (créneaux visibles intérieur ET
# extérieur). L'ancre est le point de pose (cf. _crop_at) : centre d'arête / sommet.
def _edge_x(c, stone, cap, H, t, cp):
    fill_quad(c, (Pt(0, -t, H), Pt(1, -t, H), Pt(1, -t, H+cp), Pt(0, -t, H+cp)), cap, SH_SW*0.9, wrap=1.1)  # parapet arrière
    fill_quad(c, (Pt(0, -t, H), Pt(1, -t, H), Pt(1, t, H), Pt(0, t, H)), cap, SH_TOP, wrap=1.1)             # chemin de ronde
    fill_quad(c, (Pt(0, t, 0), Pt(1, t, 0), Pt(1, t, H), Pt(0, t, H)), stone, SH_SW, ao=.4, wrap=1.1)       # face avant (+z)
    fill_quad(c, (Pt(0, t, H), Pt(1, t, H), Pt(1, t, H+cp), Pt(0, t, H+cp)), cap, SH_SW*1.06, wrap=1.1)     # parapet avant
def _edge_z(c, stone, cap, H, t, cp):
    fill_quad(c, (Pt(-t, 0, H), Pt(-t, 1, H), Pt(-t, 1, H+cp), Pt(-t, 0, H+cp)), cap, SH_SE*0.9, wrap=1.1)
    fill_quad(c, (Pt(-t, 0, H), Pt(-t, 1, H), Pt(t, 1, H), Pt(t, 0, H)), cap, SH_TOP, wrap=1.1)
    fill_quad(c, (Pt(t, 0, 0), Pt(t, 1, 0), Pt(t, 1, H), Pt(t, 0, H)), stone, SH_SE, ao=.4, wrap=1.1)
    fill_quad(c, (Pt(t, 0, H), Pt(t, 1, H), Pt(t, 1, H+cp), Pt(t, 0, H+cp)), cap, SH_SE*1.06, wrap=1.1)
def _post(c, stone, cap, H, t, cp):
    fill_quad(c, (Pt(-t, -t, H), Pt(t, -t, H), Pt(t, t, H), Pt(-t, t, H)), cap, SH_TOP)              # dessus
    fill_quad(c, (Pt(-t, t, 0), Pt(t, t, 0), Pt(t, t, H), Pt(-t, t, H)), stone, SH_SW, ao=.4)        # face +z
    fill_quad(c, (Pt(t, -t, 0), Pt(t, t, 0), Pt(t, t, H), Pt(t, -t, H)), stone, SH_SE, ao=.4)        # face +x
    fill_quad(c, (Pt(-t, t, H), Pt(t, t, H), Pt(t, t, H+cp), Pt(-t, t, H+cp)), cap, SH_SW*1.06)      # parapet
def _tour(c, stone, cap, H):
    tt, Ht = 0.34, H+30
    fill_quad(c, (Pt(-tt, tt, 0), Pt(tt, tt, 0), Pt(tt, tt, Ht), Pt(-tt, tt, Ht)), stone, SH_SW, ao=.45)
    fill_quad(c, (Pt(tt, -tt, 0), Pt(tt, tt, 0), Pt(tt, tt, Ht), Pt(tt, -tt, Ht)), stone, SH_SE, ao=.45)
    fill_quad(c, (Pt(-tt, -tt, Ht), Pt(tt, -tt, Ht), Pt(tt, tt, Ht), Pt(-tt, tt, Ht)), cap, SH_TOP)
    for fx in (-tt, -0.06, tt-0.12):
        fill_quad(c, (Pt(fx, tt, Ht), Pt(fx+0.12, tt, Ht), Pt(fx+0.12, tt, Ht+16), Pt(fx, tt, Ht+16)), cap, SH_SW*1.05)

def build(kind, stone, cap, H=78, t=0.14, cp=9):
    c = _c()
    if kind == "ex":     _edge_x(c, stone, cap, H, t, cp); a = (0.5, 0.0)
    elif kind == "ez":   _edge_z(c, stone, cap, H, t, cp); a = (0.0, 0.5)
    elif kind == "tour": _tour(c, stone, cap, H);          a = (0.0, 0.0)
    elif kind.startswith("pignon_"):
        axis = 'ez' if kind.startswith("pignon_ez") else 'ex'
        shape = "plein" if kind in ("pignon_ez", "pignon_ex") else ("mont" if kind.endswith("mont") else "desc")
        _pignon(c, stone, axis, shape, t)
        a = (0.0, 0.5) if axis == 'ez' else (0.5, 0.0)
    else:                _post(c, stone, cap, H, t, cp);   a = (0.0, 0.0)
    return _crop_at(c, *a)

# ---- pignons : triangles de mur fermant l'espace sous un toit à 2 pans ----
# (texture du MUR, dessinés de la hauteur du mur HBW jusqu'au faîte HBW+RISE_W).
# « ez » : posé sur une arête ez (face vers +x, ombrage SE) ; « ex » : arête ex
# (face vers +z, SW). Plein = apex au milieu (bâtiment de profondeur 1) ;
# demi montant/descendant = pour les bâtiments de profondeur 2.
HBW, RISE_W = 86, 46
def _pignon(c, stone, axis, shape, t=0.14):
    SH = SH_SE if axis == 'ez' else SH_SW
    def Q(a, y):   # point sur l'arête : a = position le long de l'arête (0..1)
        return Pt(t, a, y) if axis == 'ez' else Pt(a, t, y)
    if shape == "plein":
        quad = (Q(0, HBW), Q(1, HBW), Q(0.5, HBW+RISE_W), Q(0.5, HBW+RISE_W))
    elif shape == "mont":   # monte de 0 -> 1
        quad = (Q(0, HBW), Q(1, HBW), Q(1, HBW+RISE_W), Q(1, HBW+RISE_W))
    else:                    # descend de 0 -> 1
        quad = (Q(0, HBW), Q(1, HBW), Q(0, HBW+RISE_W), Q(0, HBW+RISE_W))
    fill_quad(c, quad, stone, SH, ao=0.0, wrap=1.1)

# ordre des frames 0..9 + libellé lisible (exposé au manifeste -> palette)
WALL_KINDS = [
    ("ex", "Mur ↘ (arête)"), ("ez", "Mur ↙ (arête)"),
    ("post", "Poteau / jonction"), ("tour", "Tour"),
    ("pignon_ez", "Pignon ↙ plein"), ("pignon_ez_mont", "Pignon ↙ montant"), ("pignon_ez_desc", "Pignon ↙ descendant"),
    ("pignon_ex", "Pignon ↘ plein"), ("pignon_ex_mont", "Pignon ↘ montant"), ("pignon_ex_desc", "Pignon ↘ descendant"),
]
def wall_pieces(matkey):
    entry = MATERIALS[matkey]
    label, surface, cap = entry[0], entry[1], entry[2]
    opts = entry[3] if len(entry) > 3 else {}
    H = opts.get("H", 78)
    return [(k, name, *build(k, surface, cap, H=H)) for k, name in WALL_KINDS]

# ---------------- TOITS ----------------
# Pièces de toit posées PAR CASE, au-dessus des murs (base HB = hauteur mur +
# parapet). Un toit à deux pans dont le faîte court le long d'un axe :
#   faite_x : pièce complète (2 pans, faîte au milieu de la case, le long de +x)
#   pan_x_av / pan_x_ar : demi-toits pour bâtiments profonds (faîte au bord)
#   idem en z. Débord léger aux gouttières. Textures : rangées de tuiles/ardoises
#   (assises décalées) ou chaume (paille).
def t_tuiles(seed=3, base=(178, 92, 60)):
    ch = 26
    row = YS//ch; yin = (YS % ch)/ch
    rng = np.random.default_rng(seed)
    jit = rng.uniform(-1, 1, (H//ch+2, 40))
    scallop = 0.5+0.5*np.sin((XS + (row % 2)*19)*np.pi/19)
    val = np.array(base, float)[None, None, :]*(0.82+0.22*scallop[..., None])
    val *= (1+0.10*jit[np.clip(row, 0, H//ch+1), (XS % 40)][..., None])
    val = np.where((yin > 0.82)[..., None], val*0.55, val)   # ombre de recouvrement
    val += (fbm2(H, W, seed+2, (8, 16, 32), (.5, .3, .2))[..., None]-0.5)*10
    return post(val)

def t_ardoise(seed=8):
    return t_tuiles(seed, base=(84, 90, 104))

ROOF_MATERIALS = {
    "toit_tuile":   ("Toit tuiles (atelier)",   t_tuiles()),
    "toit_ardoise": ("Toit ardoise (atelier)",  t_ardoise()),
    "toit_chaume":  ("Toit chaume (atelier)",   m_paille(seed=14, base=(188, 160, 92))),
}
HB = 86      # base du toit (hauteur mur 78 + parapet ~8)
RISE = 46    # hauteur du faîte au-dessus de la base
OVER = 0.15  # débord de gouttière (fraction de case)
SH_ROOF_AV, SH_ROOF_AR = 0.98, 0.78   # pan côté caméra / pan opposé

def _roof(kind, tex):
    c = _c()
    if kind == "faite_x":     # faîte au milieu, le long de +x : 2 pans complets
        fill_quad(c, (Pt(-OVER, .5, HB+RISE), Pt(1+OVER, .5, HB+RISE), Pt(1+OVER, -OVER, HB), Pt(-OVER, -OVER, HB)), tex, SH_ROOF_AR, wrap=1.2)
        fill_quad(c, (Pt(-OVER, .5, HB+RISE), Pt(1+OVER, .5, HB+RISE), Pt(1+OVER, 1+OVER, HB), Pt(-OVER, 1+OVER, HB)), tex, SH_ROOF_AV, wrap=1.2)
    elif kind == "faite_z":
        fill_quad(c, (Pt(.5, -OVER, HB+RISE), Pt(.5, 1+OVER, HB+RISE), Pt(-OVER, 1+OVER, HB), Pt(-OVER, -OVER, HB)), tex, SH_ROOF_AR, wrap=1.2)
        fill_quad(c, (Pt(.5, -OVER, HB+RISE), Pt(.5, 1+OVER, HB+RISE), Pt(1+OVER, 1+OVER, HB), Pt(1+OVER, -OVER, HB)), tex, SH_ROOF_AV, wrap=1.2)
    elif kind == "pan_x_av":  # demi-toit, faîte au bord z=0, pente vers la caméra
        fill_quad(c, (Pt(-OVER, 0, HB+RISE), Pt(1+OVER, 0, HB+RISE), Pt(1+OVER, 1+OVER, HB), Pt(-OVER, 1+OVER, HB)), tex, SH_ROOF_AV, wrap=1.2)
    elif kind == "pan_x_ar":  # demi-toit, faîte au bord z=1, pente vers l'arrière
        fill_quad(c, (Pt(-OVER, 1, HB+RISE), Pt(1+OVER, 1, HB+RISE), Pt(1+OVER, -OVER, HB), Pt(-OVER, -OVER, HB)), tex, SH_ROOF_AR, wrap=1.2)
    elif kind == "pan_z_av":
        fill_quad(c, (Pt(0, -OVER, HB+RISE), Pt(0, 1+OVER, HB+RISE), Pt(1+OVER, 1+OVER, HB), Pt(1+OVER, -OVER, HB)), tex, SH_ROOF_AV, wrap=1.2)
    elif kind == "pan_z_ar":
        fill_quad(c, (Pt(1, -OVER, HB+RISE), Pt(1, 1+OVER, HB+RISE), Pt(-OVER, 1+OVER, HB), Pt(-OVER, -OVER, HB)), tex, SH_ROOF_AR, wrap=1.2)
    return _crop_at(c, 0.5, 0.5)

ROOF_KINDS = [
    ("faite_x", "Faîte ↘ (2 pans)"), ("faite_z", "Faîte ↙ (2 pans)"),
    ("pan_x_av", "Pan ↘ avant"), ("pan_x_ar", "Pan ↘ arrière"),
    ("pan_z_av", "Pan ↙ avant"), ("pan_z_ar", "Pan ↙ arrière"),
]
def roof_pieces(matkey):
    label, tex = ROOF_MATERIALS[matkey]
    return [(k, name, *_roof(k, tex)) for k, name in ROOF_KINDS]

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
        P = {k: (img, ox, oy) for (k, name, img, ox, oy) in wall_pieces(matkey)}
        room = []                                   # pièce 3x3 fermée par des murs d'arête
        for i in (2, 3, 4): room += [(i+0.5, 2, "ex"), (i+0.5, 5, "ex")]
        for j in (2, 3, 4): room += [(2, j+0.5, "ez"), (5, j+0.5, "ez")]
        for (i, j) in [(2, 2), (5, 2), (2, 5), (5, 5)]: room.append((i, j, "post"))
        place = [(x, z, GRASS, HW, HH) for x in range(8) for z in range(8)]
        place += [(x, z, *P[n]) for (x, z, n) in room]
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
