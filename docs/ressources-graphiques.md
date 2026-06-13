# Ressources graphiques isométriques pour l'éditeur — sources & licences

Recherche : assets 2D **isométriques** réutilisables, style « peint » compatible Flare
(grille iso **64×32 / 2:1**, rendu Blender pré-rendu, ambiance dark-fantasy), pour
enrichir l'éditeur (murs, toits, sables, etc.). Toutes les licences ci-dessous ont été
vérifiées sur la page source.

## Règle d'or de licence (à respecter)
Flare est en **CC-BY-SA 3.0** (art) — notre projet en hérite. Conséquences :
- On peut **incorporer du CC0 et du CC-BY** dans nos tilesets : ils « remontent » sans
  problème dans un ensemble CC-BY-SA.
- Dès qu'on **fusionne/retravaille** un asset CC-BY-SA, l'ensemble dérivé reste **CC-BY-SA**
  (copyleft, comme la GPL). Pour garder nos créations 100 % originales sous une autre
  licence, il faut les laisser dans des **fichiers séparés** (collection ≠ adaptation).
- **Bannir tout asset NC (NonCommercial)** : incompatible avec CC-BY-SA et bloquant si le
  jeu est un jour partagé/public.
- Publier nos dérivés en **CC-BY-SA 4.0** est autorisé (upgrade 3.0→4.0 à sens unique).
- Toujours tenir `client/assets/CREDITS.txt` à jour (titre, auteur, URL, licence + lien,
  modifications apportées). Modèle de ligne :
  `"Nom" par Auteur — licence CC-BY-SA 3.0 : URL  (modifs : …)`

## Verdict général
L'**écosystème Flare lui-même** est la meilleure source (style identique par construction,
tout en CC-BY-SA 3.0). On utilise déjà `tileset_grassland` et son eau. Le reste de
l'écosystème comble presque tous les besoins. **Deux manques réels** en style « peint »
Flare : le **sable/désert** et le **marais** — à produire/re-rendre nous-mêmes.

## Short-list recommandée par catégorie

| Besoin | Source recommandée | Auteur | Licence | Verdict |
|---|---|---|---|---|
| **Murs / toits / maisons** | Medieval Building Tiles — https://opengameart.org/content/medieval-building-tiles | Clint Bellanger | GPL2/3 **ou CC-BY-SA 3.0** | Excellent (base canonique) |
| **Bâtiments complets (CC0)** | Isometric medieval buildings #1 & #2 — https://opengameart.org/content/isometric-medieval-buildings , https://opengameart.org/content/isometric-medieval-buildings-2 | rubberduck | **CC0** | Excellent (CC0, 128×64 + 64×32, fait pour Flare) |
| **Murs de donjon (maçonnés)** | Classic Dungeon Walls — https://opengameart.org/content/classic-dungeon-walls | Clint Bellanger | **CC-BY 3.0** | Excellent |
| **Donjon (sols+murs)** | Flare Super Dungeon Tileset — https://opengameart.org/content/flare-super-dungeon-tileset-version-10 | WithinAmnesia + Bellanger | CC-BY-SA 3.0 | Excellent (proto, vérifier l'alignement) |
| **Caverne / mine** | Cave Tileset — https://opengameart.org/content/cave-tileset | Clint Bellanger | **CC-BY 3.0** | Excellent |
| **Herbe / route / falaises / ponts / clôtures** | Grassland Tileset — https://opengameart.org/content/grassland-tileset | Clint Bellanger + al. | CC-BY-SA 3.0 | Excellent (déjà utilisé) |
| **Eau + berges** | Grass and Water Tiles — https://opengameart.org/content/grass-and-water-tiles | Clint Bellanger | **CC-BY 3.0** | Excellent |
| **Neige / glace** | Isometric snow tileset (flare) — https://opengameart.org/content/isometric-snow-tileset-flare | rubberduck | CC-BY-SA 3.0 | Excellent |
| **Roche / ruines (→ base marais)** | Old ruins tileset — https://opengameart.org/content/old-ruins-tileset | rubberduck | CC-BY-SA 3.0 | Excellent (128×64 + 64×32) |
| **Sols pierre/marbre intérieurs** | FLARE Isometric Tiles — https://opengameart.org/content/flare-isometric-tiles | artisticdude | **CC0** | Correct (sols only) |
| **Sable / désert** | *(aucun natif Flare)* — Desert isometric tiles (pixel art, à retravailler) https://opengameart.org/content/desert-isometric-tiles | IKSLM | CC0 | À produire/re-rendre |
| **Marais** | *(aucun dédié)* — dériver d'Old ruins + eau de marais | — | — | À produire |

Note : `tileset_dungeon.png`, `tileset_cave.png`, `tileset_ruins.png` sont **déjà** dans le
dépôt flare-game (`mods/fantasycore` et `mods/empyrean_campaign`) — récupérables directement
via le clone sparse Flare, sans repasser par OpenGameArt.

## Hors écosystème Flare (si on veut élargir, avec réserves)
- **Screaming Brain Studios** (Town/Wall/Floor/Object/Overworld) — **CC0**, vrai rendu 2:1,
  textures réalistes sombres : le plus proche d'esprit hors Flare, mais **basse résolution**
  (à upscaler). https://screamingbrainstudios.itch.io/iso-town-pack
- **jpcu — Isometric Realm** : peint dark-fantasy quasi identique à Flare, mais **payant
  (~12 $), non-CC, sans sols/désert**. Le meilleur style absolu si budget. https://jpcu.itch.io/isometric-realm-medieval1
- **Kenney** (CC0) et **Artyom Zagorskiy** (CC0, inclut du désert) : licences parfaites mais
  **style vectoriel/cartoon** → à retravailler entièrement pour coller au peint Flare.
- **À éviter** : Wyrmsun CC-BY-SA/GPL (copyleft lourd, pixel art) ; tout pack à licence floue
  (certains itch.io) ; tout asset **NC**.

## Marche à suivre pour intégrer proprement
1. Récupérer les tilesets via le clone sparse Flare (déjà outillé : `tools/build-manifest.js`,
   `FLARE_DIR`) pour ce qui est dans le dépôt ; télécharger les compléments OGA sinon.
2. Étendre `client/assets/tilesets/` + `tools/build-manifest.js` pour exposer les nouvelles
   tuiles (ids), puis les rendre choisissables dans la palette de l'éditeur (`palette.js`).
3. Pour sable/désert et marais : re-rendre une texture sur la base grassland (pipeline Blender
   de Bellanger) OU retravailler le pack désert pixel-art en attendant.
4. Mettre à jour `client/assets/CREDITS.txt` pour CHAQUE nouvel asset (obligation CC-BY/SA).
