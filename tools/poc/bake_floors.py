#!/usr/bin/env python3
# « Bake » des sols atelier en tilesets floor_<mat> : pour chaque matériau,
# un atlas PNG (16 variantes pleines en grille 4x4 + 8 bords) écrit dans
# client/assets/tilesets/floors/ et fusionné dans manifest.tilesets.
# Ensuite decormap.FLOOR_MATERIALS pilote la palette et le rendu.
# Usage : python3 tools/poc/bake_floors.py
import json, os, sys
from PIL import Image
sys.path.insert(0, os.path.dirname(__file__))
import floors as F

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
ASSETS = os.path.join(ROOT, "client", "assets")
FLOORS_DIR = os.path.join(ASSETS, "tilesets", "floors")
MANIFEST = os.path.join(ASSETS, "manifest.json")
os.makedirs(FLOORS_DIR, exist_ok=True)
PAD = 2
COLS = 6   # pièces par ligne d'atlas

manifest = json.load(open(MANIFEST, encoding="utf8"))
manifest.setdefault("tilesets", {})

for matkey, (label, _tex) in F.FLOOR_MATERIALS.items():
    pieces = F.floor_pieces(matkey)   # [(nom, img, ox, oy)] : 16 variantes + 8 bords
    tw, th = pieces[0][1].size
    rows = (len(pieces) + COLS - 1) // COLS
    W = COLS * (tw + PAD) - PAD
    H = rows * (th + PAD) - PAD
    atlas = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    tiles, names = {}, []
    for i, (name, img, ox, oy) in enumerate(pieces):
        x = (i % COLS) * (tw + PAD)
        y = (i // COLS) * (th + PAD)
        atlas.alpha_composite(img, (x, y))
        tiles[str(i)] = [x, y, img.width, img.height, ox, oy, 0]
        names.append(name)
    atlas.save(os.path.join(FLOORS_DIR, f"{matkey}.png"))
    manifest["tilesets"][f"floor_{matkey}"] = {
        "images": [f"tilesets/floors/{matkey}.png"],
        "tiles": tiles,
        "names": names,
        "types": {k: "sol" for k in tiles},
        "label": label,
    }
    print(f"  floor_{matkey}: {len(pieces)} pièces, atlas {W}x{H}")

json.dump(manifest, open(MANIFEST, "w", encoding="utf8"))
print("OK bake sols :", len(F.FLOOR_MATERIALS), "matériaux -> manifest.json")
