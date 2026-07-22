# POC — création de ressources graphiques de MONDE par le code

Deux preuves de concept pour combler le dernier chaînon manquant de l'éditeur :
créer de **nouveaux assets de carte** (sols, murs) sans dépendre d'une génération
d'image IA — qui échoue justement sur la **structure** (murs mal orientés sur la
grille, animations incohérentes).

## Principe directeur

> Mettre la **structure dans le code**, ne demander à l'IA (ou à un pack) qu'une
> seule **surface** plate ou un seul objet.

- **Sols** (`gen_sols.py`) : une texture carrée **tuilable** (bruit périodique,
  offline) est **projetée sur le diamant iso 192×96**. La texture bouclant, les
  diamants voisins se raccordent → **aucune couture**. Un set d'**autotile**
  (centre / 4 bords / 4 coins) gère les transitions entre deux sols, avec un bord
  **tramé** (dithering ordonné) pour le rendu pixel-art.
- **Murs** (`gen_murs.py`) : à partir d'**un** échantillon de matériau tuilable, le
  code synthétise les faces (top / +x / +z) de chaque pièce et applique un
  **ombrage directionnel constant** (lumière haut-droite). L'orientation est donc
  **déterministe par construction**. Pièces : `mur_x`, `mur_z`, `angle`, `pilier`,
  `bloc`.

Tout sort au **schéma existant** du moteur : rect `[x, y, w, h, ox, oy]`, ancre au
centre de la case au sol (sols) ou bas-centre (murs). Aucune modification du
renderer ni de la palette n'est nécessaire pour *consommer* ces assets — seulement
un point d'entrée pour les *enregistrer* (voir « Suite »).

## Lancer

```bash
python3 tools/poc/gen_sols.py   # -> tools/poc/samples/*.png
python3 tools/poc/gen_murs.py
```

Dépendances : `numpy`, `Pillow` (déjà présents dans l'environnement de dev).

## Résultats (voir `samples/`)

- `preuve_sols_seamless.png` — champ d'herbe 7×7, sans couture ni grille.
- `preuve_sols_autotile.png` — flaque de terre sur l'herbe, transitions tramées.
- `preuve_murs.png` — rempart en L (mur_x + angle + mur_z) correctement orienté et
  raccordé, + pilier et bloc.

## Forces / faiblesses

**Forces** : 100 % offline et déterministe ; sans couture / orientation correcte
par construction ; réutilise le schéma d'assets existant ; variantes quasi
gratuites (changer la palette du matériau).

**Faiblesses** : n'adresse que les assets « texturés / géométriques » (sols, murs,
falaises, eau). Les objets ornementaux (statues, mobilier détaillé) et les
créatures animées relèvent d'autres pistes (objet unique IA/pack + calibration ;
rig découpé pour l'animation). Le motif de sol se répète encore un peu (corrigeable
via variantes cyclées).

## Suite (productisation, non incluse dans ce POC)

1. **Dernier kilomètre** : un endpoint `POST /api/admin/tiles` qui écrit le PNG sous
   `client/assets/tilesets/…` et fusionne l'entrée `manifest.tilesets[...]`
   (+ table `types` sol/mur/objet) — en miroir de l'existant `/api/admin/skins/enemy`.
2. **Câblage palette** : ajouter le matériau à `WALL_MATERIALS` (murs) ou une
   famille de tuiles avec `types='sol'` (`decormap.js`).
3. **Portage** de l'algorithme en JS côté serveur (aujourd'hui Python/PIL pour la
   rapidité du POC ; le rendu final est du simple calcul sur tableaux).
4. **UI atelier** : sliders (matériau, hauteur de mur, épaisseur, palette) +
   pré-écoute sur le diamant, sur le modèle de l'atelier Skins.
