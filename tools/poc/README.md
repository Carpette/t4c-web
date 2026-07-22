# POC — création de ressources graphiques de MONDE par le code (v2)

Deux preuves de concept pour combler le dernier chaînon manquant de l'éditeur :
créer de **nouveaux assets de carte** (sols, murs) sans dépendre d'une génération
d'image IA — qui échoue justement sur la **structure** (murs mal orientés sur la
grille, animations incohérentes).

## Principe directeur

> Mettre la **structure dans le code** ; la **qualité** vient de la **surface**.

- **Sols** (`gen_sols.py`) : une grande texture carrée **seamless** (bruit
  périodique, offline) est **projetée sur le diamant iso 192×96**. Pour tuer la
  répétition, on n'échantillonne pas une seule tuile mais un **bloc de 12×12
  tuiles** pris dans cette texture (144 tuiles distinctes) : le motif ne se répète
  que tous les 12 tuiles, et reste **sans couture**. On ajoute une variation basse
  fréquence (zones claires/foncées) et des détails semés (cailloux, fleurs).
- **Murs** (`gen_murs.py`) : à partir d'une **surface de maçonnerie** procédurale
  (pierres biseautées, mortier en creux, AO au bord, grain, mousse au pied), le code
  synthétise les faces (top / +x / +z) de chaque pièce avec un **ombrage
  directionnel constant** et un **AO vertical**, plus un **cap/parapet** clair. Les
  tours reçoivent des créneaux. L'orientation est **déterministe par construction**.

Tout sort au **schéma existant** du moteur : rect `[x, y, w, h, ox, oy]`, ancre au
centre de la case (sols) ou bas-centre (murs). Aucune modif du renderer ni de la
palette pour *consommer* ces assets — seulement un point d'entrée pour les
*enregistrer* (`POST /api/admin/tiles`, déjà en place côté serveur).

## Lancer

```bash
python3 tools/poc/gen_sols.py   # -> tools/poc/samples/*.png
python3 tools/poc/gen_murs.py
```

Dépendances : `numpy`, `Pillow`.

## Résultats (voir `samples/`)

- `preuve_sols.png` — champ 20×20 : plus de répétition perceptible, sans couture.
- `exemple_tuile_sol.png` — une tuile de sol isolée.
- `preuve_murs.png` — rempart en L (mur_x + angle + mur_z) + deux tours à créneaux,
  correctement orientés et raccordés, sur un sol d'herbe.
- `exemple_mur_*.png` — pièces isolées (mur_x, mur_z, angle, tour).

## Forces / faiblesses

**Forces** : 100 % offline et déterministe ; sans couture / orientation correcte
par construction ; répétition repoussée à la période 12 ; variantes quasi gratuites
(changer la palette du matériau).

**Faiblesses** : n'adresse que les assets « texturés / géométriques » (sols, murs,
falaises, eau). Les objets ornementaux (statues, mobilier détaillé) et les
créatures animées relèvent d'autres pistes. La qualité des murs est celle d'une
surface **procédurale** (plafond « stylisé propre ») ; pour aller au-dessus, on
remplace la surface par une **vraie texture** (matériaux CC0 groupés, ou texture
unique générée par IA) — sans rien changer au code de projection/orientation.

## Suite (productisation)

1. **Dernier kilomètre** : `POST /api/admin/tiles` (fait) écrit le PNG et fusionne
   `manifest.tilesets['user_<nom>']` (+ `types` sol/mur/objet).
2. **Câblage palette** : surfacer les tilesets `user_` dans la palette (sous-section
   par `family`).
3. **Portage** de l'algorithme en **canvas navigateur** (aujourd'hui Python/PIL pour
   le prototypage ; le rendu final est du simple calcul sur tableaux → zéro Python
   au runtime).
4. **UI atelier** : sliders (matériau, palette, hauteur/épaisseur de mur) +
   pré-écoute sur le diamant, sur le modèle de l'atelier Skins.
