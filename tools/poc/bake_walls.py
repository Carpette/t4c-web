#!/usr/bin/env python3
# « Bake » des 5 matériaux de mur procéduraux en tilesets wall_proc_* utilisables
# en jeu : génère l'atlas PNG de chaque matériau (4 pièces : mur_x, mur_z, angle,
# tour), l'écrit dans client/assets/tilesets/walls/, ajoute la découpe à walls.json
# (source pour build-manifest) ET fusionne manifest.tilesets (usage runtime immédiat).
# Ensuite il suffit d'ajouter les clés à WALL_MATERIALS (decormap.js) : palette,
# rendu, flip, scale et collision suivent automatiquement.
# Usage : python3 tools/poc/bake_walls.py
import json, os, sys
from PIL import Image
sys.path.insert(0, os.path.dirname(__file__))
import materials as M

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
ASSETS = os.path.join(ROOT, "client", "assets")
WALLS_DIR = os.path.join(ASSETS, "tilesets", "walls")
WALLS_JSON = os.path.join(WALLS_DIR, "walls.json")
MANIFEST = os.path.join(ASSETS, "manifest.json")
PAD = 2

walls = json.load(open(WALLS_JSON, encoding="utf8")) if os.path.exists(WALLS_JSON) else {}
manifest = json.load(open(MANIFEST, encoding="utf8"))
manifest.setdefault("tilesets", {})

for matkey in M.MATERIALS:
    pieces = M.wall_pieces(matkey)                       # [(kind, img, ox, oy) x4]
    Hn = max(img.height for _, img, _, _ in pieces)
    Wn = sum(img.width for _, img, _, _ in pieces) + PAD*(len(pieces)-1)
    atlas = Image.new("RGBA", (Wn, Hn), (0, 0, 0, 0))
    rects, x = [], 0
    for _, img, ox, oy in pieces:
        atlas.alpha_composite(img, (x, 0))
        rects.append([x, 0, img.width, img.height, ox, oy])
        x += img.width + PAD
    atlas.save(os.path.join(WALLS_DIR, f"{matkey}.png"))
    walls[matkey] = rects                                 # source walls.json
    manifest["tilesets"][f"wall_{matkey}"] = {
        "images": [f"tilesets/walls/{matkey}.png"],
        "tiles": {str(i): r + [0] for i, r in enumerate(rects)},   # [x,y,w,h,ox,oy,imgIndex]
    }
    print(f"  wall_{matkey}: {len(rects)} pièces, atlas {Wn}x{Hn}")

json.dump(walls, open(WALLS_JSON, "w", encoding="utf8"))
json.dump(manifest, open(MANIFEST, "w", encoding="utf8"))
print("OK bake :", len(M.MATERIALS), "matériaux -> walls.json + manifest.json")
