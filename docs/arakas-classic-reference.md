# Arakas Classic — carte de référence (fournie par Quentin, 2026-06)

Spécification extraite de la carte officielle « Arakas Classic » (T4C). Coordonnées en
TUILES sur notre grille 384×384 (x vers l'est, z vers le sud), estimées depuis l'image
de référence. Tolérance ±10 tuiles : c'est la TOPOLOGIE qui compte (quelle masse de
terre, quel passage, quelle île), pas le pixel près.

## Directives explicites de Quentin

1. **Île de Lighthaven** : ses côtes sont de **sable jaune** (anneau TILE.SAND le long
   de toute la côte de l'île).
2. **Sorties de l'île de Lighthaven** : quelques passages **au nord et à l'ouest**,
   en marron = **ponts** vers le continent. Ce sont les SEULES sorties à pied.
3. **Île d'Olin Haad** : accessible **uniquement via une quête, en se téléportant**.
   Aucun pont, aucun gué : inatteignable à pied depuis partout (à réserver pour le
   système de quêtes à venir).

## Masses de terre

- **Continent principal** : occupe le centre (~x 80-330, z 50-340), côtes sud et
  ouest largement bordées de sable.
- **Île du Château d'Orkanis** (NO, séparée) : centre ~(38, 84), un troll y rôde.
  Reliée au continent par un isthme de sable étroit vers (88, 95) — sur la carte les
  deux masses se touchent presque.
- **Plateau désertique NO** (sur le continent) : grande zone brune/aride
  ~x 70-180, z 45-145, avec falaises. Y figurent : Cave A (80, 85), Jarko's Cave
  (107, 77), Cave B (88, 104), Cave C (111, 104), Cave D (134, 61), Cave E (153, 69),
  Gorben the Mad (142, 115).
- **Île de Lighthaven** (E/SE, séparée) : centre ~(330, 253), masse ~x 300-370,
  z 225-285. La ville fortifiée de Lighthaven (~330, 250) + Temple (~360, 242).
  C'est notre zone de départ actuelle (village existant vers 340-350, 250).
- **Hermit's Island** (E, séparée) : centre ~(338, 165), inaccessible à pied (pas de
  pont sur la carte) — y placer la végétation dense, à garder pour plus tard.
- **Îlots Stonehenge** (372, 200) et **Spell Tower** (372, 219) : minuscules îlots E.
- **Île d'Olin Haad** (SE, séparée) : centre ~(350, 300), petite, avec une structure
  carrée (temple). JAMAIS atteignable à pied (cf. directive 3).
- **Île de Feylor Est** (très à l'E, ~365, 105) : petit îlot sombre carré isolé.

## Villes et lieux (continent)

- **Windhowl** (SO) : ville fortifiée ~(70, 276), avec Temple (~67, 257). Remparts
  palissade existants à conserver. Hel (~65, 242) au nord de la ville.
- **Thieve's Town** : ~(180, 285).
- **Brigand's Cave** : ~(188, 327).
- **Ancient Temple** : ~(219, 146).
- **Feylor's Labyrinth** (central) : ~(210, 207).
- **Kraanian Cave** : ~(118, 175).
- **Ruined City** (NE) : ~(300, 108), avec Weapon Crafter.
- **Orc Camp** : ~(280, 127) (Roshnak Tul, Araf Kul).
- **Nomad's Crypt** (219, 81) ; **Gypsy Camp** (227, 100) ; **Mads House** (250, 50) ;
  **Weapon Shop 1** (207, 50) ; **Weapon Shop 2** (177, 131) ;
  **Druid's Camp** (330, 58) ; **Commander Owain** (369, 77) ;
  **Lance Silversmith** (284, 169) ; **Runed Stone Tablet** (215, 173) ;
  **Hermit Antonian** (227, 184) ; **Mercenary Leader** (300, 207) ;
  **Mercenary Camps** (307, 227), (357, 227), (300, 250) ;
  **High Priest Captors** (273, 273) ; **Feylor's Labyrinth Est** (353, 123).

## Hydrographie

- Lac au NO du centre (~175, 127) près du Weapon Shop 2, d'où part un réseau de
  rivières qui descend vers le sud et l'est (plusieurs bras, ponts de bois marron là
  où les routes les franchissent).
- Bras de mer entre le continent et chaque île (Lighthaven, Hermit, Olin Haad,
  Orkanis, îlots E).

## Validation attendue

- A* : un chemin existe du village de Lighthaven au continent (par les ponts N et O
  de l'île) ; AUCUN chemin n'existe vers Olin Haad, Hermit's Island, Stonehenge,
  Spell Tower ni l'îlot de Feylor Est.
- Côte de l'île de Lighthaven : ≥ 80 % des tuiles de terre en bord d'eau sont du sable.
- Rendu vérifié via tools/preview.py (ou dump-scene) sur les secteurs : île LH avec
  ses ponts, Windhowl, désert NO, Olin Haad.
