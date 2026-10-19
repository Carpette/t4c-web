# Atelier 3D — outils

Moteur : `client/js/admin/bake3d.js` (navigateur, three.js vendoré dans
`client/js/vendor/three/`, chargé via importmap). Rend un modèle glTF/GLB/FBX en
sprites iso au format du jeu (tuile 192×96, frames `[x, y, w, h, ox, oy]`, 8
directions Flare). Catalogue et couverture : `docs/atelier3d-catalogue.md`.

## Dans l'admin (onglet « 🧊 Atelier 3D »)

Le serveur de jeu sert les modèles sources sous `/src3d/` (lecture seule,
confiné au dossier) depuis `T4C_SRC3D`, par défaut `~/t4c-assets-sources/_extrait`
s'il existe. Ils ne sont ni versionnés ni redistribués : seuls les sprites cuits
entrent dans `client/assets/`.

- **Source** : un modèle du catalogue CC0 (`client/js/admin/catalogue3d.js`, filtré
  sur les fichiers présents) ou des fichiers du poste (.glb, ou .gltf + .bin +
  textures, ou .fbx).
- **Créature** : planche 8 directions × (repos, course, coup, mort) publiée par
  `POST /api/admin/skins/enemy` (sprite `a3d_<nom>`), assignable à un monstre
  (`PUT /api/admin/skins`). Visible en jeu après F5.
- **Décor** : 4 orientations publiées par `POST /api/admin/tiles` (tileset
  `user_<nom>`), posables dans l'éditeur, thème « Décors 3D (atelier) ». Non
  bloquants pour l'instant (comme les autres objets libres).

## Planche contact

```bash
# 1. une fois : extraire les zips CC0 archivés -> ~/t4c-assets-sources/_extrait/
python3 -I tools/atelier3d/extraire.py

# 2. rendre la planche (Chromium headless via playwright, outil non installé par défaut)
PLAYWRIGHT_DIR=/chemin/vers/dossier/avec/node_modules/playwright \
  node tools/atelier3d/planche.mjs [sortie=tools/atelier3d/sortie]

# --sonde : taille brute et clips de chaque modèle (pour régler hauteur / module / clip)
node tools/atelier3d/planche.mjs --sonde
```

Variables : `T4C_SRC3D` (dossier des modèles extraits), `PLAYWRIGHT_DIR`.
Sur une machine sans les bibliothèques de Chromium (libnss3...) et sans droits
root : `apt-get download` des paquets puis `dpkg -x` dans un dossier local, et
`LD_LIBRARY_PATH` vers son `usr/lib/x86_64-linux-gnu`.

## Régler un modèle (entrée de `client/js/admin/catalogue3d.js`)

- `h` : hauteur réelle en mètres (personnages, créatures, props) — 1 case = 1,55 m ;
- `module` : unités du fichier par case, pour les kits modulaires (Kenney ≈ 0.5,
  graveyard 0.75, Medieval Village 2) ;
- `clip` : motif (regex) du clip de pose ; `anims` : fichiers de clips partagés ;
- `texture` : texture à appliquer quand le pack la livre à part (FBX).
