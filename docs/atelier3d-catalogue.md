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
(style trop cartoon/chibi), **Quaternius Ultimate Monsters** (trop « mignon ») et **Quaternius RPG
Characters** (proportions trapues) : ne collent pas à l'ambiance T4C — décisions du 2026-10-19.

| Pack | Contenu utile | Remarque |
|---|---|---|
| Quaternius Medieval Village MegaKit (Standard) | 176 pièces : murs, toits, portes, fenêtres, escaliers | modulaire, pas de 2 unités |
| Quaternius Fantasy Props MegaKit (Standard) | 94 props : tonneaux, coffres, étals, mobilier | |
| Quaternius Stylized Nature MegaKit (Standard) | 68 : arbres, pins, arbres morts, rochers, herbes | |
| Quaternius Ultimate Modular Ruins | 92 (FBX) : arches, colonnes, statues, murs en ruine | opacité FBX corrigée au chargement |
| Quaternius Universal Base Characters (Standard) | corps rigués ♂/♀ | **gratuit = proportions « Superhero » seulement** |
| Quaternius Modular Character Outfits (Standard) | Paysan, Rôdeur (♂/♀) | **2 tenues sur 12** dans la version gratuite |
| Quaternius Universal Animation Library (Standard) | 43 clips humanoïdes (idle, marche, épée, sort, mort…) | s'applique aux corps UBC/Outfits |
| Quaternius Ultimate Animated Animals | loup, renard, cerf, cheval, taureau… (12) | pas d'ours ni de sanglier |
| Quaternius Zombie | zombie animé (FBX) | texture livrée à part |
| Kenney (8 kits) | town, castle, graveyard, dungeons, cave, forest, nature | très simple, couleurs plates |

Les versions payantes « Source » de Quaternius (proportions Regular, 12 tenues) sont aussi
CC0 : les acheter ne pose pas de problème de licence pour la plateforme.

## Couverture des 35 monstres de `shared/defs.js`

✅ modèle direct · 🟡 substitut / recoloration / assemblage · 🔴 trou

Socle retenu pour les créatures : Quaternius Zombie, Ultimate Animated Animals (loup, cerf,
taureau) et les humains UBC + Outfits + UAL.

| Monstre (clé) | Nom | Proposition | |
|---|---|---|---|
| zombie | Zombie | Quaternius Zombie | ✅ |
| loup | Loup | Animals Wolf | ✅ |
| loup_noir | Loup noir | Animals Wolf + teinte | ✅ |
| brigand | Brigand | UBC + Outfit Rôdeur | ✅ |
| voleur | Voleur | UBC + Outfit Rôdeur + teinte | ✅ |
| momie | Momie | Zombie + texture bandelettes | 🟡 |
| goule | Goule | Zombie + teinte | 🟡 |
| golem_pierre | Golem de pierre | rochers Nature assemblés sur un squelette UBC | 🟡 |
| gobelin, orc, orc_eclaireur, orc_guerrier, orc_chaman | Gobelin, Hobgobelin, orcs | — (piste : UBC teinté + tenue, sans crocs) | 🔴 |
| skraug_vert, skraug_rouge | Skraugs | — (hommes-lézards) | 🔴 |
| troll, ogre | Troll, Minotaure | — | 🔴 |
| squelette, liche_mineure | Squelette, Liche | — (aucun squelette CC0 réaliste trouvé) | 🔴 |
| sanglier, ours, rat_caverne | Sanglier, Ours, Rat | — (Taureau réduit peu crédible en sanglier) | 🔴 |
| serpent_venimeux, guepe | Serpent, Guêpe | — | 🔴 |
| centaure, elementaire_feu | Centaure, Élémentaire | — (pistes : Cheval + buste UBC ; golem + particules) | 🔴 |
| rat, fourmilion_geant, serpent, kraanian, mille_pattes | Fourmilions, fourmi, kraaniens | — | 🔴 |
| araignee_geante, tarentule, tarentule_geante, necro_araignee | Araignées | — | 🔴 |

Bilan : **5 ✅, 3 🟡, 27 🔴**. Le CC0 couvre les **décors** et les **humains** ; il ne
couvre pas le bestiaire T4C. Les créatures passeront par une autre source (génération
image→3D avec auto-rig, modèles commandés, ou animation procédurale pour les
insectes/arachnides — 9 des 27 trous), toujours rendues par `bake3d.js` pour garder la
cohérence.

## Constats de la planche

La ligne de référence montre les sprites Flare **à leur taille en jeu** (`spriteScale` de
`MOBS`). Ajustés suite à la planche : squelette ×0.85, minotaure ×4.5, serpent venimeux
(wyvern) ×3. Le minotaure Flare, planche de 25×42 px agrandie ×4.5, reste flou.

- **Décors** : cohérents entre packs une fois passés par la même lumière ; les kits
  modulaires s'emboîtent à l'échelle « 1 pas de grille = 1 case » (`module`).
- **Humains** (UBC / Outfits / UAL) : les plus proches de l'esprit T4C ; les animations
  partagées s'appliquent telles quelles.
- **Ultimate Monsters**, **RPG Characters** : écartés (trop mignon / trop trapu).
- **KayKit** : chibi, détonne à côté des humains Quaternius — **écarté**. Les squelettes
  sont donc à retrouver (modèle CC0 réaliste, génération image→3D sur le corps UBC).
- Pièges gérés par `bake3d.js` : > 4 influences d'os (renormalisation), opacité FBX à 0,
  texture FBX livrée à part, métal noir sans environnement.
