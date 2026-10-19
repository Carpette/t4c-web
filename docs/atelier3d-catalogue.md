# Atelier 3D — catalogue CC0 et couverture du bestiaire

Rendus produits par `tools/atelier3d/planche.mjs` (moteur `client/js/admin/bake3d.js`) :
même caméra 2:1, même soleil haut-gauche, même ombre portée pour tous les packs.

- `atelier3d/planche_net.png` — style « net » (anticrénelé)
- `atelier3d/planche_retro.png` — style « retro » (désaturé, palette tramée, contour)
- `atelier3d/directions.png` — 8 directions Flare + cycle de marche (Quaternius Rôdeur + UAL)

## Sources archivées (`~/t4c-assets-sources/`, hors dépôt)

Toutes **CC0 1.0** (texte de licence vérifié dans chaque zip le 2026-10-19 ; empreintes
sha256 dans `MANIFEST.json`). Quaternius publie désormais certains packs sous sa licence
**QAL**, qui INTERDIT la redistribution dans un moteur/template : n'utiliser que les
versions CC0 archivées. Exclus : *Bestiary – Dungeon Monsters Kit* (QAL) et **tout KayKit**
(style trop cartoon/chibi, ne colle pas à l'ambiance T4C — décision du 2026-10-19).

| Pack | Contenu utile | Remarque |
|---|---|---|
| Quaternius Medieval Village MegaKit (Standard) | 176 pièces : murs, toits, portes, fenêtres, escaliers | modulaire, pas de 2 unités |
| Quaternius Fantasy Props MegaKit (Standard) | 94 props : tonneaux, coffres, étals, mobilier | |
| Quaternius Stylized Nature MegaKit (Standard) | 68 : arbres, pins, arbres morts, rochers, herbes | |
| Quaternius Ultimate Modular Ruins | 92 (FBX) : arches, colonnes, statues, murs en ruine | opacité FBX corrigée au chargement |
| Quaternius Universal Base Characters (Standard) | corps rigués ♂/♀ | **gratuit = proportions « Superhero » seulement** |
| Quaternius Modular Character Outfits (Standard) | Paysan, Rôdeur (♂/♀) | **2 tenues sur 12** dans la version gratuite |
| Quaternius Universal Animation Library (Standard) | 43 clips humanoïdes (idle, marche, épée, sort, mort…) | s'applique aux corps UBC/Outfits |
| Quaternius RPG Characters | guerrier, mage, voleur, moine, clerc, rôdeur (animés) | proportions trapues |
| Quaternius Ultimate Monsters | 50 monstres animés | style « mignon » marqué |
| Quaternius Ultimate Animated Animals | loup, renard, cerf, cheval, taureau… (12) | pas d'ours ni de sanglier |
| Quaternius Zombie | zombie animé (FBX) | texture livrée à part |
| Kenney (8 kits) | town, castle, graveyard, dungeons, cave, forest, nature | très simple, couleurs plates |

Les versions payantes « Source » de Quaternius (proportions Regular, 12 tenues) sont aussi
CC0 : les acheter ne pose pas de problème de licence pour la plateforme.

## Couverture des 35 monstres de `shared/defs.js`

✅ modèle direct · 🟡 substitut / recoloration / assemblage · 🔴 trou

| Monstre (clé) | Nom | Proposition | |
|---|---|---|---|
| zombie | Zombie | Quaternius Zombie | ✅ |
| loup | Loup | Animals Wolf | ✅ |
| loup_noir | Loup noir | Animals Wolf + teinte | ✅ |
| brigand | Brigand | UBC + Outfit Rôdeur / RPG Rogue | ✅ |
| voleur | Voleur | UBC + Outfit Rôdeur / RPG Rogue + teinte | ✅ |
| gobelin | Gobelin | UM Orc réduit + teinte | 🟡 |
| orc | Hobgobelin | UM Orc | 🟡 |
| orc_eclaireur | Éclaireur orc | UM Orc + arme Fantasy Props (hache/épée bronze) | 🟡 |
| orc_guerrier | Guerrier orc | UM Orc + arme/bouclier | 🟡 |
| orc_chaman | Chaman orc | UM Orc + bâton du RPG Mage | 🟡 |
| skraug_vert | Skraug vert | UM Orc + teinte (pas d'homme-lézard) | 🟡 |
| skraug_rouge | Skraug rouge | idem, teinte rouge | 🟡 |
| troll | Troll | UM Yeti + teinte | 🟡 |
| ogre | Minotaure | UM Yeti agrandi (pas de minotaure) | 🟡 |
| momie | Momie | Zombie + texture bandelettes | 🟡 |
| goule | Goule | Zombie + teinte | 🟡 |
| guepe | Guêpe géante | UM Armabee (mignon) | 🟡 |
| golem_pierre | Golem de pierre | rochers Nature assemblés sur un squelette UBC | 🟡 |
| squelette | Squelette | — (seul squelette CC0 réaliste trouvé : aucun ; Kenney trop simple) | 🔴 |
| liche_mineure | Liche mineure | — (dépend du squelette) | 🔴 |
| sanglier | Sanglier | (Taureau réduit : peu crédible) | 🔴 |
| ours | Ours brun | — | 🔴 |
| rat_caverne | Rat des cavernes | — | 🔴 |
| serpent_venimeux | Serpent venimeux | — | 🔴 |
| centaure | Centaure | — (Cheval + buste UBC à tenter) | 🔴 |
| elementaire_feu | Élémentaire de feu | — (golem + particules à tenter) | 🔴 |
| rat | Fourmilion | — | 🔴 |
| fourmilion_geant | Fourmilion géant | — | 🔴 |
| serpent | Fourmi de feu | — | 🔴 |
| kraanian | Ouvrier kraanien | — | 🔴 |
| mille_pattes | Mille-pattes kraanien | — | 🔴 |
| araignee_geante | Araignée géante | — | 🔴 |
| tarentule | Tarentule | — | 🔴 |
| tarentule_geante | Tarentule géante | — | 🔴 |
| necro_araignee | Nécro-araignée | — | 🔴 |

Bilan : **5 ✅, 13 🟡, 17 🔴**. 9 des 17 trous sont des **insectes / arachnides** (une
seule famille de modèles à trouver, à générer ou à animer procéduralement : un rig de
pattes en IK se code sans talent graphique). Les décors, eux, sont largement couverts.

## Constats de la planche

- **Décors** : cohérents entre packs une fois passés par la même lumière ; les kits
  modulaires s'emboîtent à l'échelle « 1 pas de grille = 1 case » (`module`).
- **Humains** (UBC / Outfits / UAL) : les plus proches de l'esprit T4C ; les animations
  partagées s'appliquent telles quelles.
- **Ultimate Monsters** : trop « mignon » pour un T4C sombre, hors Orc/Yeti.
- **KayKit** : chibi, détonne à côté des humains Quaternius — **écarté**. Les squelettes
  sont donc à retrouver (modèle CC0 réaliste, génération image→3D sur le corps UBC).
- Pièges gérés par `bake3d.js` : > 4 influences d'os (renormalisation), opacité FBX à 0,
  texture FBX livrée à part, métal noir sans environnement.
