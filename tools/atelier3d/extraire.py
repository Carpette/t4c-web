#!/usr/bin/env python3
# Extrait les modèles 3D des packs CC0 archivés (zips) vers un dossier de travail
# servi par l'atelier 3D / la planche contact. Seuls les formats utiles au rendu
# sont gardés : glTF/GLB (+ .bin, textures), et FBX quand le pack n'a pas de glTF
# (Ruins, Zombie). Les doublons OBJ/Blend sont ignorés.
#
# Usage : python3 -I tools/atelier3d/extraire.py [src=~/t4c-assets-sources] [dst=<src>/_extrait]
import os, re, sys, zipfile

SRC = os.path.expanduser(sys.argv[1] if len(sys.argv) > 1 else '~/t4c-assets-sources')
DST = os.path.expanduser(sys.argv[2] if len(sys.argv) > 2 else os.path.join(SRC, '_extrait'))
TEXTURES = re.compile(r'\.(bin|png|jpe?g|txt)$', re.I)


def slug(nom):
    # « Ultimate Monsters-20261019T154256Z-1-001.zip » -> « ultimate_monsters »
    nom = re.sub(r'-\d{8}T\d{6}Z-\d+-\d+$', '', nom[:-4])
    nom = re.sub(r'\[.*?\]|- [A-Z][a-z]+ \d{4}$', '', nom)
    return re.sub(r'[^a-z0-9]+', '_', nom.lower()).strip('_')


def extraire(chemin_zip):
    z = zipfile.ZipFile(chemin_zip)
    noms = [n for n in z.namelist() if not n.endswith('/')]
    a_gltf = any(re.search(r'\.(gltf|glb)$', n, re.I) for n in noms)
    modele = re.compile(r'\.(gltf|glb)$' if a_gltf else r'\.fbx$', re.I)
    dossier = os.path.join(DST, slug(os.path.basename(chemin_zip)))
    n_mod = 0
    for n in noms:
        # pas de textures du dossier OBJ (doublons) ; celles de Blends/ servent
        # parfois seules (Zombie : texture livrée à part du FBX)
        if not (modele.search(n) or (TEXTURES.search(n) and not re.search(r'/obj/', n, re.I))):
            continue
        cible = os.path.normpath(os.path.join(dossier, n))
        if not cible.startswith(dossier + os.sep):  # chemin hors du dossier : refusé
            print('  ! chemin refusé :', n)
            continue
        os.makedirs(os.path.dirname(cible), exist_ok=True)
        with open(cible, 'wb') as f:
            f.write(z.read(n))
        n_mod += bool(modele.search(n))
    print(f'{os.path.basename(dossier):40s} {n_mod:4d} modèles')


for nom in sorted(os.listdir(SRC)):
    if nom.endswith('.zip'):
        extraire(os.path.join(SRC, nom))
for kit in sorted(os.listdir(os.path.join(SRC, 'kenney'))) if os.path.isdir(os.path.join(SRC, 'kenney')) else []:
    for nom in os.listdir(os.path.join(SRC, 'kenney', kit)):
        if nom.endswith('.zip'):
            extraire(os.path.join(SRC, 'kenney', kit, nom))
