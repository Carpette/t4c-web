#!/usr/bin/env python3
# POC-Murs — synthétise par CODE des pièces de mur iso CORRECTEMENT ORIENTÉES à
# partir d'UN échantillon de matériau tuilable. Le code place les pixels des faces
# (top / +x / +z) avec un ombrage directionnel constant : l'orientation est donc
# déterministe, contrairement à une IA à qui on demande de remplir une grille.
# Pièces : mur suivant +x, mur suivant +z, angle, pilier, bloc plein.
# Usage : python3 gen_murs.py [dossier_sortie]
import numpy as np
from PIL import Image
import os, sys, math

HW, HH = 96, 48
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "samples")
os.makedirs(OUT, exist_ok=True)

def tileable_fbm(size, seed, periods=(4, 8, 16, 32), amps=(0.55, 0.28, 0.13, 0.06)):
    rng = np.random.default_rng(seed)
    acc = np.zeros((size, size), np.float64)
    for period, amp in zip(periods, amps):
        g = rng.random((period, period))
        t = np.linspace(0, period, size, endpoint=False)
        i0 = np.floor(t).astype(int); f = t - i0; f = f * f * (3 - 2 * f)
        i1 = (i0 + 1) % period; i0 = i0 % period
        fx = f[None, :]; fy = f[:, None]
        A = g[np.ix_(i0, i0)]; B = g[np.ix_(i0, i1)]; C = g[np.ix_(i1, i0)]; D = g[np.ix_(i1, i1)]
        top = A * (1 - fx) + B * fx; bot = C * (1 - fx) + D * fx
        acc += amp * (top * (1 - fy) + bot * fy)
    return (acc - acc.min()) / (acc.max() - acc.min() + 1e-9)

def make_stone(P=128, seed=7):
    base = tileable_fbm(P, seed)
    lo = np.array([86, 84, 92]); hi = np.array([168, 166, 176])
    rgb = lo * (1 - base[..., None]) + hi * base[..., None]
    xx = np.arange(P)
    for row in range(0, P, 22):                       # assises + joints décalés
        rgb[row:row+2] *= 0.62
        off = 0 if (row // 22) % 2 == 0 else 22
        vb = (((xx + off) % 44) < 2)[None, :, None]
        rgb[row:row+22] = np.where(vb, rgb[row:row+22] * 0.62, rgb[row:row+22])
    q = 255.0 / 11
    return np.clip(np.round(rgb / q) * q, 0, 255).astype(np.uint8)

TEX = make_stone()

def w2s(x, z): return ((x - z) * HW, (x + z) * HH)

def fill_quad(canvas, quad, shade, vgrad=0.12, wrap_len=1.0):
    bl, br, tr, tl = [np.array(p, float) for p in quad]
    e1 = br - bl; e2 = tl - bl
    det = e1[0] * e2[1] - e1[1] * e2[0]
    if abs(det) < 1e-6: return
    inv = np.array([[e2[1], -e2[0]], [-e1[1], e1[0]]]) / det
    ch, cw = canvas.shape[:2]
    xs = [bl[0], br[0], tr[0], tl[0]]; ys = [bl[1], br[1], tr[1], tl[1]]
    x0 = max(0, int(math.floor(min(xs)))); x1 = min(cw, int(math.ceil(max(xs))))
    y0 = max(0, int(math.floor(min(ys)))); y1 = min(ch, int(math.ceil(max(ys))))
    if x1 <= x0 or y1 <= y0: return
    gy, gx = np.mgrid[y0:y1, x0:x1]
    rx = gx + 0.5 - bl[0]; ry = gy + 0.5 - bl[1]
    s = inv[0, 0] * rx + inv[0, 1] * ry
    t = inv[1, 0] * rx + inv[1, 1] * ry
    inside = (s >= 0) & (s <= 1) & (t >= 0) & (t <= 1)
    P = TEX.shape[0]
    tsx = np.clip((np.mod(s * wrap_len, 1.0) * P).astype(int), 0, P - 1)
    tsy = np.clip((np.clip(t, 0, 1) * (P - 1)).astype(int), 0, P - 1)
    col = TEX[tsy, tsx].astype(float) * (shade * (1.0 - vgrad * (1.0 - t)))[..., None]
    col = np.clip(col, 0, 255)
    sub = canvas[y0:y1, x0:x1]
    sub[inside, 0:3] = col[inside].astype(np.uint8); sub[inside, 3] = 255
    canvas[y0:y1, x0:x1] = sub

SH_TOP, SH_SE, SH_SW = 1.06, 0.92, 0.70          # lumière haut-droite, constante
CW, CH, OXo, OYo = 300, 280, 150, 180

def newcanvas(): return np.zeros((CH, CW, 4), np.uint8)
def Pt(x, z, y=0):
    sx, sy = w2s(x, z); return (sx + OXo, sy + OYo - y)

def crop_anchor(canvas):
    ys, xs = np.where(canvas[..., 3] > 0)
    if len(xs) == 0: return None
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    gx, gy = w2s(0.5, 0.5)
    return (Image.fromarray(canvas[y0:y1, x0:x1], "RGBA"),
            int(round(gx + OXo - x0)), int(round(gy + OYo - y0)))

def face_top(c, x0, x1, z0, z1, H):
    fill_quad(c, (Pt(x0, z0, H), Pt(x1, z0, H), Pt(x1, z1, H), Pt(x0, z1, H)), SH_TOP, vgrad=0.0)
def face_pz(c, x0, x1, z, H):
    fill_quad(c, (Pt(x0, z, 0), Pt(x1, z, 0), Pt(x1, z, H), Pt(x0, z, H)), SH_SW)
def face_px(c, z0, z1, x, H):
    fill_quad(c, (Pt(x, z0, 0), Pt(x, z1, 0), Pt(x, z1, H), Pt(x, z0, H)), SH_SE)

def piece_wall_x(H=76, t=0.16):
    c = newcanvas(); z0, z1 = 0.5 - t, 0.5 + t
    face_top(c, 0, 1, z0, z1, H); face_pz(c, 0, 1, z1, H); return crop_anchor(c)
def piece_wall_z(H=76, t=0.16):
    c = newcanvas(); x0, x1 = 0.5 - t, 0.5 + t
    face_top(c, x0, x1, 0, 1, H); face_px(c, 0, 1, x1, H); return crop_anchor(c)
def piece_corner(H=76, t=0.16):
    c = newcanvas(); x0, x1, z0, z1 = 0.5 - t, 0.5 + t, 0.5 - t, 0.5 + t
    face_top(c, 0, x1, z0, z1, H); face_top(c, x0, x1, z0, 1, H)
    face_pz(c, 0, x1, z1, H); face_px(c, z0, 1, x1, H); return crop_anchor(c)
def piece_pillar(H=84, t=0.2):
    c = newcanvas(); x0, x1, z0, z1 = 0.5 - t, 0.5 + t, 0.5 - t, 0.5 + t
    face_top(c, x0, x1, z0, z1, H); face_pz(c, x0, x1, z1, H); face_px(c, z0, z1, x1, H); return crop_anchor(c)
def piece_block(H=70):
    c = newcanvas()
    face_top(c, 0, 1, 0, 1, H); face_pz(c, 0, 1, 1, H); face_px(c, 0, 1, 1, H); return crop_anchor(c)

PIECES = {"mur_x": piece_wall_x(), "mur_z": piece_wall_z(), "angle": piece_corner(),
          "pilier": piece_pillar(), "bloc": piece_block()}

def make_grass_tile(P=128):
    base = tileable_fbm(P, 3); mott = tileable_fbm(P, 1002, periods=(16, 32, 64), amps=(0.5, 0.3, 0.2))
    t = np.clip(base * 0.8 + mott * 0.2, 0, 1)[..., None]
    rgb = np.array([54, 84, 38]) * (1 - t) + np.array([120, 158, 66]) * t
    rgb = np.where((mott > 0.82)[..., None], rgb * 0.78, rgb)
    q = 255.0 / 11; tex = np.clip(np.round(rgb / q) * q, 0, 255).astype(np.uint8)
    ys, xs = np.mgrid[0:96, 0:192]; sx = xs + 0.5; sy = ys + 0.5
    A = (sx - 96) / 96; B = sy / 48; u = (A + B) / 2; v = (B - A) / 2
    inside = (u >= 0) & (u < 1) & (v >= 0) & (v < 1)
    tx = np.clip((np.mod(u, 1) * P).astype(int), 0, P - 1); ty = np.clip((np.mod(v, 1) * P).astype(int), 0, P - 1)
    img = np.zeros((96, 192, 4), np.uint8); img[..., 0:3] = tex[ty, tx]; img[..., 3] = np.where(inside, 255, 0)
    return Image.fromarray(img, "RGBA")

if __name__ == "__main__":
    for name, (img, ox, oy) in PIECES.items():
        img.save(os.path.join(OUT, f"poc_mur_{name}.png"))
        print(f"{name}: {img.size} ancre=({ox},{oy})")
    grass = make_grass_tile()
    walls = [(2, 2, "mur_x"), (3, 2, "mur_x"), (4, 2, "angle"), (4, 3, "mur_z"), (4, 4, "mur_z"),
             (6, 6, "pilier"), (1, 5, "bloc"), (2, 5, "bloc")]
    place = [(x, z, grass, HW, HH) for x in range(8) for z in range(8)]
    place += [(x, z, PIECES[n][0], PIECES[n][1], PIECES[n][2]) for (x, z, n) in walls]
    sxs = [w2s(x, z)[0] for (x, z, *_) in place]; sys_ = [w2s(x, z)[1] for (x, z, *_) in place]
    minx = min(sxs) - 120; miny = min(sys_) - 140
    W = int(max(sxs) + 120 - minx); Hc = int(max(sys_) + 120 - miny)
    canvas = Image.new("RGBA", (W, Hc), (26, 24, 36, 255))
    floors = [p for p in place if p[2] is grass]; props = [p for p in place if p[2] is not grass]
    for grp in (sorted(floors, key=lambda p: p[0] + p[1]), sorted(props, key=lambda p: p[0] + p[1])):
        for (x, z, img, ox, oy) in grp:
            sx, sy = w2s(x, z)
            canvas.alpha_composite(img, (int(sx - minx - ox), int(sy - miny - oy)))
    canvas.save(os.path.join(OUT, "preuve_murs.png"))
    print("OK murs ->", OUT)
