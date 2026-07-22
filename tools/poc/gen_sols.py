#!/usr/bin/env python3
# POC-Sols v2 — supprime la répétition visible. Au lieu de répéter UNE tuile, on
# échantillonne un BLOC de P×P tuiles sur une grande texture SEAMLESS (période P
# tuiles) : garanti sans couture, mais le motif ne se répète que tous les P tuiles
# (au lieu de chaque tuile). + variation basse fréquence (zones claires/foncées)
# + détails semés par position monde (cailloux, fleurs) -> restent seamless.
# Usage : python3 gen_sols.py [dossier_sortie]
import numpy as np
from PIL import Image
import sys, os

HW, HH = 96, 48
TW, TH = 192, 96
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "samples")
os.makedirs(OUT, exist_ok=True)
P = 12                      # période en tuiles (12x12 = 144 tuiles distinctes)
UNIT = 128                  # px par tuile-monde dans la texture source
SIZE = P * UNIT             # 1536 : texture seamless (boucle à P tuiles)

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

# grande texture d'herbe seamless (périodes divisant SIZE=1536)
det = fbm(SIZE, 11, (12, 24, 48, 96, 192, 384), (0.4, 0.28, 0.16, 0.1, 0.05, 0.03))
low = fbm(SIZE, 77, (3, 6, 12), (0.6, 0.3, 0.1))
blades = fbm(SIZE, 33, (192, 384, 768), (0.5, 0.3, 0.2))
dark = np.array([44, 74, 32]); mid = np.array([88, 130, 52]); light = np.array([132, 172, 78])
t = np.clip(det*0.75 + low*0.25, 0, 1)
rgb = np.where(t[..., None] < 0.5, dark + (mid-dark)*(t[..., None]*2),
               mid + (light-mid)*((t[..., None]-0.5)*2))
rgb += (blades[..., None]-0.5) * 26
rgb = np.where((det > 0.86)[..., None], rgb*0.72, rgb)

rng = np.random.default_rng(5)
def stamp(cx, cy, rad, col):
    y0, y1 = max(0, cy-rad), min(SIZE, cy+rad+1); x0, x1 = max(0, cx-rad), min(SIZE, cx+rad+1)
    yy, xx = np.mgrid[y0:y1, x0:x1]
    m = ((xx-cx)**2 + (yy-cy)**2) <= rad*rad
    rgb[y0:y1, x0:x1][m] = col
for _ in range(900):
    stamp(rng.integers(SIZE), rng.integers(SIZE), rng.integers(1, 3), np.array([120, 118, 110])*rng.uniform(0.8, 1.1))
FLOWERS = [np.array([222, 206, 90]), np.array([210, 90, 110]), np.array([180, 150, 220]), np.array([235, 235, 235])]
for _ in range(500):
    stamp(rng.integers(SIZE), rng.integers(SIZE), rng.integers(1, 3), FLOWERS[rng.integers(len(FLOWERS))])

q = 255/15
BIG = np.clip(np.round(rgb/q)*q, 0, 255).astype(np.uint8)

ys, xs = np.mgrid[0:TH, 0:TW]
Ad = (xs+0.5-HW)/HW; Bd = (ys+0.5)/HH
Uf = (Ad+Bd)/2; Vf = (Bd-Ad)/2
INSIDE = (Uf >= 0) & (Uf < 1) & (Vf >= 0) & (Vf < 1)

def cell_tile(tx, tz):
    sx = np.mod(((tx+Uf)*UNIT).astype(int), SIZE)
    sy = np.mod(((tz+Vf)*UNIT).astype(int), SIZE)
    img = np.zeros((TH, TW, 4), np.uint8)
    img[..., 0:3] = BIG[sy, sx]; img[..., 3] = np.where(INSIDE, 255, 0)
    return Image.fromarray(img, "RGBA")

def field(n):
    tiles = {}
    minx = -(n)*HW
    canvas = Image.new("RGBA", (2*n*HW + TW, 2*n*HH + TH), (24, 22, 34, 255))
    for s in range(0, 2*n):
        for x in range(n):
            z = s - x
            if 0 <= z < n:
                spr = tiles.get((x % P, z % P)) or tiles.setdefault((x % P, z % P), cell_tile(x % P, z % P))
                canvas.alpha_composite(spr, (int((x-z)*HW - minx - HW), int((x+z)*HH)))
    return canvas

if __name__ == "__main__":
    cell_tile(0, 0).save(os.path.join(OUT, "exemple_tuile_sol.png"))
    field(20).save(os.path.join(OUT, "preuve_sols.png"))
    print("OK sols v2 : 144 tuiles distinctes (période 12), champ 20x20 ->", OUT)
