#!/usr/bin/env python3
# POC-Sols — génère des tuiles de sol iso SANS COUTURE + un set d'autotile, à
# partir d'une texture carrée TUILABLE (bruit périodique -> 100% offline, sans IA).
# Principe : la texture est projetée sur le diamant iso 192x96 du moteur ; comme la
# texture "boucle", les diamants voisins se raccordent parfaitement.
# Usage : python3 gen_sols.py [dossier_sortie]
import numpy as np
from PIL import Image
import os, sys

HW, HH = 96, 48          # demi-tuile écran (cf. renderer.js HW/HH)
TW, TH = 192, 96         # boîte du sprite ; ancre au centre (96,48)
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

def posterize(rgb, levels=12):
    q = 255.0 / (levels - 1)
    return np.round(rgb / q) * q

MATERIALS = {
    "herbe":  (np.array([54, 84, 38]),   np.array([120, 158, 66]),  20),
    "pierre": (np.array([78, 78, 86]),   np.array([150, 150, 160]), 11),
    "terre":  (np.array([70, 48, 30]),   np.array([132, 96, 58]),   33),
    "sable":  (np.array([150, 132, 86]), np.array([206, 190, 140]), 44),
}

def make_texture(name, P=128):
    lo, hi, seed = MATERIALS[name]
    base = tileable_fbm(P, seed)
    mott = tileable_fbm(P, seed + 999, periods=(16, 32, 64), amps=(0.5, 0.3, 0.2))
    t = np.clip(base * 0.8 + mott * 0.2, 0, 1)[..., None]
    rgb = lo * (1 - t) + hi * t
    rgb = np.where((mott > 0.82)[..., None], rgb * 0.78, rgb)
    return np.clip(posterize(rgb, 12), 0, 255).astype(np.uint8)

def diamond_uv():
    ys, xs = np.mgrid[0:TH, 0:TW]
    sx = xs + 0.5; sy = ys + 0.5
    Ad = (sx - HW) / HW; Bd = sy / HH
    u = (Ad + Bd) / 2.0; v = (Bd - Ad) / 2.0
    return u, v, (u >= 0) & (u < 1) & (v >= 0) & (v < 1)

U, V, INSIDE = diamond_uv()

def sample(tex, u, v):
    P = tex.shape[0]
    tx = np.clip((np.mod(u, 1.0) * P).astype(int), 0, P - 1)
    ty = np.clip((np.mod(v, 1.0) * P).astype(int), 0, P - 1)
    return tex[ty, tx]

def build_tile(tex, mask_alpha=None):
    img = np.zeros((TH, TW, 4), np.uint8)
    img[..., 0:3] = sample(tex, U, V)
    a = np.where(INSIDE, 255 if mask_alpha is None else mask_alpha, 0)
    img[..., 3] = a.astype(np.uint8)
    return Image.fromarray(img, "RGBA")

def edge_mask(kind):
    if kind == "center":
        m = np.ones((TH, TW))
    elif kind == "N": m = np.clip(V * 2.2, 0, 1)
    elif kind == "S": m = np.clip((1 - V) * 2.2, 0, 1)
    elif kind == "W": m = np.clip(U * 2.2, 0, 1)
    elif kind == "E": m = np.clip((1 - U) * 2.2, 0, 1)
    elif kind == "NW": m = np.clip(np.minimum(U, V) * 2.6, 0, 1)
    elif kind == "NE": m = np.clip(np.minimum(1 - U, V) * 2.6, 0, 1)
    elif kind == "SW": m = np.clip(np.minimum(U, 1 - V) * 2.6, 0, 1)
    elif kind == "SE": m = np.clip(np.minimum(1 - U, 1 - V) * 2.6, 0, 1)
    else: m = np.ones((TH, TW))
    bayer = np.array([[0,8,2,10],[12,4,14,6],[3,11,1,9],[15,7,13,5]]) / 16.0
    by = np.tile(bayer, (TH//4+1, TW//4+1))[:TH, :TW]
    return ((m > by).astype(np.float64) * 255).astype(np.uint8)

def render_field(tiles_by_pos, bg=(24, 22, 34, 255)):
    pos = list(tiles_by_pos.keys())
    sxs = [(x - z) * HW for (x, z) in pos]; sys_ = [(x + z) * HH for (x, z) in pos]
    minx = min(sxs) - HW; maxx = max(sxs) + HW; miny = min(sys_) - HH; maxy = max(sys_) + TH
    canvas = Image.new("RGBA", (int(maxx - minx) + 4, int(maxy - miny) + 4), bg)
    for (x, z) in sorted(pos, key=lambda p: p[0] + p[1]):
        sx = (x - z) * HW - minx; sy = (x + z) * HH - miny
        for spr in tiles_by_pos[(x, z)]:
            canvas.alpha_composite(spr, (int(sx - HW), int(sy - HH)))
    return canvas

if __name__ == "__main__":
    tex_grass = make_texture("herbe"); tex_dirt = make_texture("terre")
    build_tile(tex_grass).save(os.path.join(OUT, "poc_sol_herbe.png"))
    build_tile(make_texture("pierre")).save(os.path.join(OUT, "poc_sol_pierre.png"))

    field = {(x, z): [build_tile(tex_grass)] for x in range(7) for z in range(7)}
    render_field(field).save(os.path.join(OUT, "preuve_sols_seamless.png"))

    dirt_cells = {(2,2),(3,2),(2,3),(3,3),(4,3),(3,4)}
    def kind(x, z):
        N=(x,z-1) in dirt_cells; S=(x,z+1) in dirt_cells; E=(x+1,z) in dirt_cells; W=(x-1,z) in dirt_cells
        if N and S and E and W: return "center"
        if S and E and W and not N: return "N"
        if N and E and W and not S: return "S"
        if N and S and W and not E: return "W"
        if N and S and E and not W: return "E"
        if S and E and not N and not W: return "NW"
        if S and W and not N and not E: return "NE"
        if N and E and not S and not W: return "SW"
        if N and W and not S and not E: return "SE"
        return "center"
    tile_grass = build_tile(tex_grass)
    field2 = {}
    for x in range(7):
        for z in range(7):
            stack = [tile_grass]
            if (x, z) in dirt_cells:
                stack.append(build_tile(tex_dirt, edge_mask(kind(x, z))))
            field2[(x, z)] = stack
    render_field(field2).save(os.path.join(OUT, "preuve_sols_autotile.png"))
    print("OK sols ->", OUT)
