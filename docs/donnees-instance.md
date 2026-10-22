# Données d'instance et mises à jour de la base

Le projet livre une **base** : le code, les outils, et un monde de départ
(`content/*.json` pour le contenu du jeu, `client/assets/` pour les ressources
graphiques et sonores). Chaque serveur qui l'héberge fait ensuite vivre **son**
monde dans la Forge : ses villes, ses monstres, ses PNJ, ses quêtes, son
histoire. Deux instances peuvent diverger complètement ; une nouvelle version
du projet doit leur apporter la technique et les nouveautés de la base **sans
écraser ce qu'elles ont construit**.

## Où vivent les données

La variable `T4C_DATA_DIR` désigne le dossier des données de l'instance. L'image
Docker la fixe à `/data`, le volume persistant (qui contient aussi `game.db`).

| Dossier | Contenu |
|---|---|
| `<data>/content/` | contenu du jeu de l'instance, retouches de carte (`overrides_<zone>.json`) |
| `<data>/assets/` | ressources ajoutées ou remplacées par la Forge (skins, créatures importées, musiques, matériaux de l'atelier) et le `manifest.json` de l'instance |
| `<data>/base/` | copie de la base telle qu'elle était livrée au dernier démarrage : la référence des mises à jour |

Une ressource de `<data>/assets/` est servie en priorité sur celle de la base
de même chemin ; les autres viennent de l'image.

Sans `T4C_DATA_DIR` (développement), rien ne change : la Forge écrit dans le
dépôt, qui est la base.

## Règle de mise à jour

Au démarrage, chaque fichier de la base est comparé à la référence (la base
précédente). Ce qui a changé est appliqué **élément par élément** :

- un élément resté **identique à l'ancienne base** suit la nouvelle (il est
  modifié, ajouté ou supprimé comme dans la base) ;
- un élément **modifié par l'instance** lui appartient : il n'évolue plus ;
- un élément créé par l'instance n'est jamais touché.

Un élément, c'est :

- une **carte de zone** entière (`overrides_<zone>.json`) : une ville retouchée
  sur un serveur garde sa forme ;
- dans une liste à `id` (sorts, zones, particules...), l'entrée de cet `id` ;
- ailleurs, l'entrée de second niveau : une créature (`mobs.orc`), un PNJ
  (`npc.garde`), un tileset du manifeste (`tilesets.cave`) ; les couches
  d'avatar ont un niveau de plus (`avatar.male.head_short`).

Les ressources binaires suivent la même logique : une image remplacée par
l'instance garde sa version, les autres suivent la base.

Chaque mise à jour appliquée est consignée dans l'historique de la Forge
(onglet Publication, auteur « mise à jour de la base ») avec la liste des
éléments propres à l'instance qui ont été conservés. Elle s'annule comme toute
modification. Le serveur résume aussi la mise à jour dans ses logs au
démarrage (`[données] ...`).

## Premier démarrage

Au premier démarrage avec un dossier de données vide, le contenu est
initialisé depuis la base, puis les fichiers que la Forge avait écrits
auparavant (historique en base) sont rétablis : une instance qui écrivait dans
l'image (et perdait tout au redéploiement) retrouve ses dernières retouches de
contenu et de cartes. Les ressources binaires écrites dans l'image avant ce
mécanisme ne sont pas dans l'historique et ne peuvent pas être rétablies.

## Côté code

`server/donnees.js` centralise les chemins : `CONTENT_DIR` (contenu de
l'instance), `cheminAsset(rel)` (ressource effective), `cheminAssetEcriture(rel)`
(écriture d'une ressource par la Forge), `listerAssets`, `lireManifeste`,
`ecrireManifeste`. Ne pas écrire de chemin en dur vers `content/` ou
`client/assets/` côté serveur.

Test : `node tools/test-donnees.js` (sans serveur).
