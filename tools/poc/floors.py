#!/usr/bin/env python3
# Sols multi-biomes « atelier » : dalles posables (props de type sol) générées
# procéduralement. Chaque matériau produit :
#   - 12 VARIANTES pleines (échantillonnées à des positions différentes d'une
#     grande texture seamless -> aucune répétition quand on mélange les variantes,
#     et le moteur peut choisir par hachage de position si v est null) ;
#   - 8 pièces de BORD (N/S/E/O + 4 coins) à alpha tramé (dither pixel-art), pour
#     les transitions par-dessus n'importe quel autre sol.
# Lancé seul -> planche comparative samples/sols_planche.png.
import numpy as np
from PIL import Image, ImageDraw
import os, sys

HW, HH = 96, 48
TW, TH = 192, 96
P_TILES = 4          # période de la grande texture, en tuiles (4x4 positions)
UNIT = 128           # px par tuile-monde dans la texture source
SIZE = P_TILES * UNIT
# variantes pleines = TOUTES les positions de la grille 4x4, ORDONNÉES
# (frame = tx + tz*4) : le moteur choisit la variante par position de la case
# ((x%4) + (z%4)*4), donc deux cases voisines échantillonnent des blocs adjacents
# de la texture seamless -> raccord parfait, zéro couture (principe validé en v2).
N_VAR = P_TILES * P_TILES  # 16

def fbm(size, seed, periods, amps):
    rng = np.random.default_rng(seed)
    acc = np.zeros((size, size))
    for period, amp in zip(periods, amps):
        g = rng.random((period, period))
        t = np.linspace(0, period, size, endpoint=False)
        i0 = np.floor(t).astype(int); f = t - i0; f = f*f*(3-2*f)
        i1 = (i0+1) % period; i0 %= period
        fx = f[None, :]; fy = f[:, None]
        A = g[np.ix_(i0, i0)]; B = g[np.ix_(i0, i1)]; C = g[np.ix_(i1, i0)]; D = g[np.ix_(i1, i1)]
        acc += amp * ((A*(1-fx)+B*fx)*(1-fy) + (C*(1-fx)+D*fx)*fy)
    return (acc-acc.min())/(acc.max()-acc.min()+1e-9)

def posterize(rgb, levels=14):
    q = 255.0/(levels-1)
    return np.clip(np.round(rgb/q)*q, 0, 255)

def speckle(rgb, rng, n, rad, col):
    S = rgb.shape[0]
    for _ in range(n):
        cx, cy = rng.integers(S), rng.integers(S)
        r = rng.integers(1, rad+1)
        y0, y1 = max(0, cy-r), min(S, cy+r+1); x0, x1 = max(0, cx-r), min(S, cx+r+1)
        yy, xx = np.mgrid[y0:y1, x0:x1]
        m = ((xx-cx)**2 + (yy-cy)**2) <= r*r
        rgb[y0:y1, x0:x1][m] = col * rng.uniform(0.85, 1.15)
    return rgb

# ---------- grandes textures seamless par matériau ----------
def tex_base(seed, lo, hi, blade_amp=0.0):
    det = fbm(SIZE, seed, (6, 12, 24, 48, 96, 192), (0.4, 0.28, 0.16, 0.1, 0.05, 0.03))
    low = fbm(SIZE, seed+70, (3, 6, 12), (0.6, 0.3, 0.1))
    t = np.clip(det*0.75 + low*0.25, 0, 1)[..., None]
    rgb = np.array(lo)*(1-t) + np.array(hi)*t
    if blade_amp:
        blades = fbm(SIZE, seed+30, (96, 192, 384), (0.5, 0.3, 0.2))
        rgb += (blades[..., None]-0.5)*blade_amp
    rgb = np.where((det > 0.86)[..., None], rgb*0.75, rgb)
    return rgb, det

def t_herbe(seed=20):
    rgb, _ = tex_base(seed, (44, 74, 32), (128, 168, 74), blade_amp=26)
    rng = np.random.default_rng(seed)
    rgb = speckle(rgb, rng, 200, 2, np.array([120, 118, 110]))          # cailloux
    for col in ([222, 206, 90], [210, 90, 110], [235, 235, 235]):
        rgb = speckle(rgb, rng, 60, 2, np.array(col))                    # fleurs
    return posterize(rgb).astype(np.uint8)

def t_terre(seed=33):
    rgb, det = tex_base(seed, (76, 52, 32), (140, 102, 62))
    ridged = np.abs(fbm(SIZE, seed+3, (12, 24, 48), (.6, .3, .1))-0.5)
    rgb = np.where((ridged < 0.012)[..., None], rgb*0.55, rgb)           # craquelures
    rgb = speckle(rgb, np.random.default_rng(seed+1), 260, 2, np.array([150, 140, 120]))
    return posterize(rgb).astype(np.uint8)

def t_sable(seed=44):
    rgb, _ = tex_base(seed, (168, 148, 96), (216, 200, 150))
    rip = 0.5+0.5*np.sin(np.arange(SIZE)[None, :]*0.05 + fbm(SIZE, seed+2, (4, 8, 16), (.6, .3, .1))*8)
    rgb *= (0.94 + 0.09*rip[..., None])                                   # ondulations de dune
    rgb = speckle(rgb, np.random.default_rng(seed+1), 150, 1, np.array([120, 105, 80]))
    return posterize(rgb).astype(np.uint8)

def t_neige(seed=55):
    rgb, _ = tex_base(seed, (198, 208, 226), (246, 250, 255))
    rgb = speckle(rgb, np.random.default_rng(seed+1), 90, 1, np.array([160, 175, 200]))
    return posterize(rgb, 12).astype(np.uint8)

def t_dalle(seed=66):
    # dallage de pierre : grille de dalles décalées avec joints sombres et AO
    rgb = np.zeros((SIZE, SIZE, 3))
    base = fbm(SIZE, seed, (8, 16, 32, 64), (.5, .28, .14, .08))
    lo, hi = np.array([96, 94, 100]), np.array([172, 170, 178])
    rgb = lo*(1-base[..., None]) + hi*base[..., None]
    ys, xs = np.mgrid[0:SIZE, 0:SIZE]
    ph, pw = 64, 86
    row = ys//ph
    xx = xs + (row % 2)*(pw//2)
    xin = xx % pw; yin = ys % ph
    rng = np.random.default_rng(seed)
    jit = rng.uniform(-1, 1, (SIZE//ph+2, SIZE//pw+3))
    rgb *= (1 + 0.12*jit[row, xx//pw][..., None])
    joint = (xin < 3) | (yin < 3)
    rgb = np.where(joint[..., None], rgb*0.5, rgb)
    rim = np.minimum(np.minimum(xin, pw-xin), np.minimum(yin, ph-yin))
    rgb *= np.clip(1-(rim < 7)*0.15, 0, 1)[..., None]
    return posterize(rgb).astype(np.uint8)

def t_chemin(seed=77):
    # terre battue + gravier clair (chemin)
    rgb, _ = tex_base(seed, (104, 84, 58), (158, 136, 100))
    rgb = speckle(rgb, np.random.default_rng(seed+1), 700, 1, np.array([180, 168, 140]))
    rgb = speckle(rgb, np.random.default_rng(seed+2), 250, 2, np.array([120, 108, 84]))
    return posterize(rgb).astype(np.uint8)

FLOOR_MATERIALS = {
    # clé -> (libellé, texture)
    "herbe":  ("Herbe (atelier)",  t_herbe()),
    "terre":  ("Terre (atelier)",  t_terre()),
    "sable":  ("Sable (atelier)",  t_sable()),
    "dalle":  ("Dallage pierre (atelier)", t_dalle()),
    "neige":  ("Neige (atelier)",  t_neige()),
    "chemin": ("Chemin (atelier)", t_chemin()),
}

# ---------- projection diamant + variantes ----------
ys, xs = np.mgrid[0:TH, 0:TW]
Ad = (xs+0.5-HW)/HW; Bd = (ys+0.5)/HH
Uf = (Ad+Bd)/2; Vf = (Bd-Ad)/2
INSIDE = (Uf >= 0) & (Uf < 1) & (Vf >= 0) & (Vf < 1)
# tramage de Bayer 4x4 pour les bords pixel-art
_BAYER = np.array([[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]])/16.0
BAYER = np.tile(_BAYER, (TH//4+1, TW//4+1))[:TH, :TW]

def variant_tile(tex, tx, tz, mask=None):
    sx = np.mod(((tx+Uf)*UNIT).astype(int), SIZE)
    sy = np.mod(((tz+Vf)*UNIT).astype(int), SIZE)
    img = np.zeros((TH, TW, 4), np.uint8)
    img[..., 0:3] = tex[sy, sx]
    a = np.where(INSIDE, 255, 0)
    if mask is not None: a = np.where(INSIDE, mask, 0)
    img[..., 3] = a.astype(np.uint8)
    return Image.fromarray(img, "RGBA")

# masques de bord : la matière couvre le côté indiqué et fond vers l'autre
EDGES = ["N", "S", "O", "E", "NO", "NE", "SO", "SE"]
def edge_mask(kind):
    if kind == "N":  m = np.clip((1-Vf)*2.2, 0, 1)
    elif kind == "S": m = np.clip(Vf*2.2, 0, 1)
    elif kind == "O": m = np.clip((1-Uf)*2.2, 0, 1)
    elif kind == "E": m = np.clip(Uf*2.2, 0, 1)
    elif kind == "NO": m = np.clip(np.minimum(1-Uf, 1-Vf)*2.6, 0, 1)
    elif kind == "NE": m = np.clip(np.minimum(Uf, 1-Vf)*2.6, 0, 1)
    elif kind == "SO": m = np.clip(np.minimum(1-Uf, Vf)*2.6, 0, 1)
    else: m = np.clip(np.minimum(Uf, Vf)*2.6, 0, 1)
    return ((m > BAYER) * 255).astype(np.uint8)

# positions d'échantillonnage : la grille complète, ordonnée (frame = tx + tz*P)
VAR_POS = [(tx, tz) for tz in range(P_TILES) for tx in range(P_TILES)]

def floor_pieces(matkey):
    """[(nom, image, ox, oy)] : N_VAR variantes pleines puis 8 bords."""
    label, tex = FLOOR_MATERIALS[matkey]
    out = []
    for i, (tx, tz) in enumerate(VAR_POS):
        out.append((f"variante {i+1}", variant_tile(tex, tx, tz), HW, HH))
    for k in EDGES:
        tx, tz = VAR_POS[hash(k) % N_VAR]
        out.append((f"bord {k}", variant_tile(tex, tx, tz, edge_mask(k)), HW, HH))
    return out

if __name__ == "__main__":
    OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "samples")
    os.makedirs(OUT, exist_ok=True)
    # planche : pour chaque matériau, un champ 6x6 en variantes par hachage + une
    # flaque du matériau suivant avec bords (transitions)
    mats = list(FLOOR_MATERIALS)
    def field(mat, over):
        _, tex = FLOOR_MATERIALS[mat]
        pieces = {n: im for (n, im, _, _) in floor_pieces(mat)}
        opieces = {n: im for (n, im, _, _) in floor_pieces(over)}
        n = 8
        cv = Image.new("RGBA", (2*n*HW+TW, 2*n*HH+TH), (24, 22, 34, 255))
        blob = {(3, 3), (4, 3), (3, 4), (4, 4), (5, 4)}
        for s in range(2*n):
            for x in range(n):
                z = s-x
                if not (0 <= z < n): continue
                v = (x % P_TILES) + (z % P_TILES)*P_TILES  # choix par position (comme le moteur)
                spr = pieces[f"variante {v+1}"]
                px, py = (x-z)*HW + n*HW - HW, (x+z)*HH
                cv.alpha_composite(spr, (int(px), int(py)))
                if (x, z) in blob:
                    cv.alpha_composite(opieces["variante 1"], (int(px), int(py)))
                else:
                    # bords : au contact du blob
                    for k, (dx, dz) in {"S": (0, -1), "N": (0, 1), "E": (-1, 0), "O": (1, 0)}.items():
                        if (x+dx, z+dz) in blob:
                            cv.alpha_composite(opieces[f"bord {k}"], (int(px), int(py)))
        return cv
    sheets = []
    for i, mat in enumerate(mats):
        over = mats[(i+1) % len(mats)]
        sheets.append((FLOOR_MATERIALS[mat][0] + "  (+ " + over + ")", field(mat, over)))
    cw = max(s.width for _, s in sheets); chh = max(s.height for _, s in sheets)+28
    sheet = Image.new("RGBA", (2*cw, 3*chh), (18, 16, 26, 255))
    dr = ImageDraw.Draw(sheet)
    for i, (label, im) in enumerate(sheets):
        cx = (i % 2)*cw; cy = (i//2)*chh
        dr.text((cx+10, cy+6), label, fill=(230, 220, 180, 255))
        sheet.alpha_composite(im, (cx, cy+26))
    sheet.save(os.path.join(OUT, "sols_planche.png"))
    print("OK sols :", len(mats), "matériaux x", N_VAR, "variantes + 8 bords ->", OUT)
