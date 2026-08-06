#!/usr/bin/env python3
# « Bake » des toits atelier en tilesets roof_<mat> (6 pièces : faîtes complets,
# pans avant/arrière en x et z), écrits dans client/assets/tilesets/roofs/ et
# fusionnés dans manifest.tilesets. decormap.ROOF_MATERIALS pilote la palette.
# Usage : python3 tools/poc/bake_roofs.py
import json, os, sys
from PIL import Image
sys.path.insert(0, os.path.dirname(__file__))
import materials as M

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
ASSETS = os.path.join(ROOT, "client", "assets")
ROOFS_DIR = os.path.join(ASSETS, "tilesets", "roofs")
MANIFEST = os.path.join(ASSETS, "manifest.json")
os.makedirs(ROOFS_DIR, exist_ok=True)
PAD = 2

manifest = json.load(open(MANIFEST, encoding="utf8"))
manifest.setdefault("tilesets", {})

for matkey, (label, _tex) in M.ROOF_MATERIALS.items():
    pieces = M.roof_pieces(matkey)   # [(kind, nom, img, ox, oy)]
    Hn = max(img.height for _, _, img, _, _ in pieces)
    Wn = sum(img.width for _, _, img, _, _ in pieces) + PAD*(len(pieces)-1)
    atlas = Image.new("RGBA", (Wn, Hn), (0, 0, 0, 0))
    tiles, names, x = {}, [], 0
    for i, (kind, name, img, ox, oy) in enumerate(pieces):
        atlas.alpha_composite(img, (x, 0))
        tiles[str(i)] = [x, 0, img.width, img.height, ox, oy, 0]
        names.append(name)
        x += img.width + PAD
    atlas.save(os.path.join(ROOFS_DIR, f"{matkey}.png"))
    manifest["tilesets"][f"roof_{matkey}"] = {
        "images": [f"tilesets/roofs/{matkey}.png"],
        "tiles": tiles,
        "names": names,
        "label": label,
    }
    print(f"  roof_{matkey}: {len(pieces)} pièces, atlas {Wn}x{Hn}")

json.dump(manifest, open(MANIFEST, "w", encoding="utf8"))
print("OK bake toits :", len(M.ROOF_MATERIALS), "matériaux -> manifest.json")
