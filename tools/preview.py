#!/usr/bin/env python3
"""Jumeau Python du renderer JS : produit des captures de contrôle sans navigateur.
Usage : node tools/dump-scene.js /tmp/scene.json && python3 tools/preview.py <assets_dir> <out_dir> [cx cz]
Reproduit les mêmes ancres / tri / éclairage que client/js/render2d/renderer.js."""
import json, sys, math
from PIL import Image, ImageDraw

ASSETS = sys.argv[1] if len(sys.argv) > 1 else 'client/assets'
OUT = sys.argv[2] if len(sys.argv) > 2 else '/tmp'
HW, HH = 96, 48
W, H = 1280, 800

scene = json.load(open('/tmp/scene.json'))
manifest = json.load(open(f'{ASSETS}/manifest.json'))
N = scene['size']
cx = float(sys.argv[3]) if len(sys.argv) > 3 else scene['spawn']['x']
cz = float(sys.argv[4]) if len(sys.argv) > 4 else scene['spawn']['z']

grass = Image.open(f'{ASSETS}/tilesets/tileset_grassland.png').convert('RGBA')
water = Image.open(f'{ASSETS}/tilesets/tileset_grassland_water.png').convert('RGBA')
img_cache = {}
def get_img(path):
    if path not in img_cache:
        img_cache[path] = Image.open(f'{ASSETS}/{path}').convert('RGBA')
    return img_cache[path]

def w2s(x, z):
    return ((x - z) - (cx - cz)) * HW + W / 2, ((x + z) - (cx + cz)) * HH + H / 2

canvas = Image.new('RGBA', (W, H), (6, 7, 12, 255))

def draw_tile(tid, px, py):
    tid = str(tid)
    rect, img = manifest['tiles'].get(tid), grass
    if rect is None:
        rect, img = manifest['waterTiles'].get(tid), water
    if rect is None: return
    x, y, w, h, ox, oy = rect
    crop = img.crop((x, y, x + w, y + h))
    canvas.alpha_composite(crop, (int(px - ox), int(py - oy)))

# --- sols ---
corners_world = [( -W/2/HW + (cx-cz), -H/2/HH + (cx+cz)), (W/2/HW + (cx-cz), H/2/HH + (cx+cz))]
min_x = max(0, int(cx - 16)); max_x = min(N-1, int(cx + 16))
min_z = max(0, int(cz - 16)); max_z = min(N-1, int(cz + 16))
for s in range(min_x + min_z, max_x + max_z + 1):
    for x in range(max(min_x, s - max_z), min(max_x, s - min_z) + 1):
        z = s - x
        px, py = w2s(x + 0.5, z + 0.5)
        if px < -200 or px > W + 200 or py < -150 or py > H + 150: continue
        draw_tile(scene['floor'][z * N + x], px, py)

# --- entités factices pour contrôle visuel ---
LAYER_ORDER_S = ['main', 'feet', 'legs', 'hands', 'chest', 'head', 'off']  # dir 6 (sud)
def avatar_frames(layers, anim='stance', d=6, fi=0):
    out = []
    for type_, name in layers:
        if not name: continue
        # manifest récent : avatars rangés par sexe (male/female)
        avs = manifest['avatar'].get('male', manifest['avatar'])
        av = avs.get(name) or manifest['avatar'][name]
        a = av['anims'].get(anim) or av['anims']['stance']
        fr = a['fr'].get(str(d)) or a['fr']['0']
        out.append((get_img(av['image']), fr[min(fi, len(fr)-1)]))
    return out

sx, sz = scene['spawn']['x'], scene['spawn']['z']
fake = []
# joueur équipé (sud)
layers6 = [('main','longsword'),('feet','default_feet'),('legs','cloth_pants'),('hands','default_hands'),('chest','chain_cuirass'),('head','head_short'),('off','buckler')]
fake.append({'x': sx, 'z': sz, 'type': 'avatar', 'layers': layers6, 'name': 'Testeur [5]'})
# joueur basique
layers_b = [('main',None),('feet','default_feet'),('legs','cloth_pants'),('hands','default_hands'),('chest','cloth_shirt'),('head','head_short'),('off',None)]
fake.append({'x': sx - 2.5, 'z': sz + 1.5, 'type': 'avatar', 'layers': layers_b, 'name': 'Novice [1]'})
# monstres
for i, (mob, dx, dz) in enumerate([('goblin', 3, 2), ('skeleton', 5, -1), ('antlion_small', -3.5, -2), ('minotaur', 7, 4), ('zombie', -5, 3)]):
    fake.append({'x': sx + dx, 'z': sz + dz, 'type': 'mob', 'sprite': mob, 'dir': i % 8})
# butin au sol
for loot, dx, dz in [('coins25', 1.5, -1.5), ('hp_potion', -1.5, -1)]:
    fake.append({'x': sx + dx, 'z': sz + dz, 'type': 'loot', 'name_': loot})

drawables = []
for p in scene['props']:
    psx, psy = w2s(p['x'], p['z'])
    if psx < -600 or psx > W + 600 or psy < -800 or psy > H + 400: continue
    drawables.append((psy, ('prop', p)))
for f in fake:
    psx, psy = w2s(f['x'], f['z'])
    drawables.append((psy, ('fake', f)))
drawables.sort(key=lambda d: d[0])

overlays = []
for psy, (kind, obj) in drawables:
    if kind == 'prop':
        px, py = w2s(obj['x'], obj['z'])
        draw_tile(obj['tileId'], px, py)
    else:
        px, py = w2s(obj['x'], obj['z'])
        if obj['type'] == 'avatar':
            top = py
            for img, (x, y, w_, h_, ox, oy) in avatar_frames(obj['layers']):
                canvas.alpha_composite(img.crop((x, y, x + w_, y + h_)), (int(px - ox), int(py - oy)))
                top = min(top, py - oy)
            overlays.append((px, top, obj.get('name', ''), (168, 216, 255)))
        elif obj['type'] == 'mob':
            e = manifest['enemies'][obj['sprite']]
            a = e['anims']['stance']
            fr = (a['fr'].get(str(obj['dir'])) or a['fr']['0'])[0]
            x, y, w_, h_, ox, oy = fr
            canvas.alpha_composite(get_img(e['image']).crop((x, y, x + w_, y + h_)), (int(px - ox), int(py - oy)))
            overlays.append((px, py - oy, obj['sprite'], (255, 210, 168)))
        else:
            l = manifest['loot'][obj['name_']]
            x, y, w_, h_, ox, oy = l['frame']
            canvas.alpha_composite(get_img(l['image']).crop((x, y, x + w_, y + h_)), (int(px - ox), int(py - oy)))

day = canvas.copy().convert('RGB')
d = ImageDraw.Draw(day)
for px, top, name, color in overlays:
    d.text((px, top - 16), name, fill=color, anchor='mm')
    d.rectangle([px - 32, top - 8, px + 32, top - 4], fill=(0, 0, 0))
    d.rectangle([px - 31, top - 7, px + 20, top - 5], fill=(224, 48, 48))
day.save(f'{OUT}/preview_day.png')

# --- version nuit : obscurité + halos (émulation du destination-out) ---
import numpy as np
dark = np.zeros((H, W), dtype=np.float32) + 0.78
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
lights = [(w2s(li['x'], li['z']), li['r']) for li in scene['lights']]
lights.append((w2s(sx, sz), 230))
for (lx, ly), r in lights:
    if lx < -400 or lx > W + 400 or ly < -400 or ly > H + 400: continue
    dist = np.sqrt((xx - lx) ** 2 + (yy - ly - (-20)) ** 2)
    hole = np.clip(1 - dist / r, 0, 1) * 0.97
    dark *= (1 - hole)
night = np.array(canvas.convert('RGB'), dtype=np.float32)
overlay_color = np.array([8, 11, 34], dtype=np.float32)
night = night * (1 - dark[..., None]) + overlay_color * dark[..., None]
# halos chauds
for (lx, ly), r in lights[:-1]:
    if lx < -400 or lx > W + 400 or ly < -400 or ly > H + 400: continue
    dist = np.sqrt((xx - lx) ** 2 + (yy - ly - (-20)) ** 2)
    glow = np.clip(1 - dist / (r * 0.75), 0, 1) * 0.16
    night += glow[..., None] * np.array([255, 150, 50], dtype=np.float32)
night_img = Image.fromarray(np.clip(night, 0, 255).astype('uint8'))
dn = ImageDraw.Draw(night_img)
for px, top, name, color in overlays:
    dn.text((px, top - 16), name, fill=color, anchor='mm')
night_img.save(f'{OUT}/preview_night.png')
print('captures générées')
