# La Quatrième Prophétie — Web

MMORPG isométrique jouable en navigateur, hommage à *La Quatrième Prophétie* (T4C). Multijoueur temps réel jusqu'à **256 joueurs** par serveur, rendu isométrique 2D à base de sprites pré-rendus (assets du projet [Flare](https://flarerpg.org), CC-BY-SA — voir `client/assets/CREDITS.txt`), comme le faisait T4C à l'époque.

## Lancer le jeu

Prérequis : **Node.js ≥ 22.5** (SQLite natif intégré, aucune compilation).

```bash
npm install
npm start
```

Puis ouvrir **http://localhost:8080** — créez un compte et jouez. Pour jouer à plusieurs sur un réseau local, les autres joueurs ouvrent `http://<votre-ip>:8080`.

## Contrôles

| Action | Commande |
|---|---|
| Se déplacer | Clic (maintenu = suivi du curseur) ou flèches du clavier |
| Attaquer | Clic sur un monstre — ou `Ctrl` maintenu : mode combat |
| Sort | Barre de sorts, ou `Ctrl`+touche assignée (panneau `S`) |
| Parler à un PNJ / interagir | Clic (marchand, obélisque, portails) |
| Ramasser | Clic sur un objet au sol |
| Poser un objet au sol (échange entre joueurs) | Clic droit sur l'objet dans l'inventaire |
| Potion de vie / de mana | `P` / `M` (barre de potions au-dessus des sorts) |
| Zoom | Molette |
| Inventaire / Personnage / Sorts / Aide | `I` / `C` / `S` / `H` |
| Chat | `Entrée` |
| Menu et paramètres (affichage des noms/niveaux/barres de vie, musique) | `Échap` |

## Le jeu — roguelike T4C

- **☠ Mort définitive.** Tout personnage qui meurt est effacé (Panthéon des morts). On renaît niveau 1.
- **Arakas** (zone 0) : carte FIXE de 384×384 tuiles, reconstituée d'après les vraies cartes
  de T4C — monts Righul au nord-ouest (grottes A-E, caverne de Jarko et portail de l'Épreuve,
  île d'Orkanis et son Troll), Asile et cryptes au nord, camp des Druides et Cité perdue des
  nains au nord-est, camp Orc, île du Vieil Ermite au large, Cercle de transfert, Labyrinthe
  et cratère de la Météorite au centre, lac des Kraanians à l'ouest, Ville des Voleurs et cave
  des Brigands au sud, Ruines Émergées au sud-est. **Windhowl** fortifiée au sud-ouest (temple,
  hôtel de ville, taverne, port, marchand Ttayh Mark) ; **Lighthaven** au sud-est (temple où
  l'on apparaît, place de la fontaine, cimetière et crypte, village des métiers, quartier
  résidentiel, tour des mages sur son îlot). Les entrées de grottes sont visibles (souterrains
  à venir).
- **8 zones** : niveaux 1-25, 25-50… jusqu'à 175-200. Monstres, butin et prix scalés.
- **Échanges entre joueurs** : à la T4C — on pose un objet (ou de l'or) au sol, l'autre le ramasse.
- **Musiques d'ambiance** : thème à l'écran de connexion, une musique en boucle par zone
  (correspondance zone → musique éditable dans l'admin, fichiers dans `client/assets/music/`).
- **L'Épreuve** : pour passer à la zone suivante, franchissez seul un labyrinthe suspendu au-dessus du vide, peuplé des monstres les plus puissants de la zone. Confirmation explicite à l'entrée — on n'en sort que victorieux ou mort.
- **Obélisque** : à l'est de chaque village, téléportation vers les zones déjà conquises.
- **Marchand** (Maître Aldric, sur chaque île) : équipement de la zone, rachat au prix d'achat, 20 sorts, 12 compétences passives.
- **Stats T4C** : For/End/Agi/Int/Sag, 5 points par niveau ; courbe XP exponentielle (le 200 est mythique : ~8 milliards d'XP).
- **Équipement visible** : arme, armure, casque, bottes, bouclier changent l'apparence du personnage.
- **Bulles de chat** au-dessus des têtes ; les PNJ parlent en chat local.

## Administration

`http://localhost:8080/admin` — le **premier compte créé** sur le serveur est administrateur.
Éditeur de cartes (peinture de tuiles + décors, appliqué à chaud), édition du contenu JSON
(zones, PNJ, sorts, compétences), musiques (correspondance zone → fichier, pré-écoute,
appliqué à chaud), gestion des personnages (niveau, or, zone, suppression), Panthéon.
En jeu, l'admin dispose aussi de commandes (`set`, `goto`, `zone`) via le protocole.

## Architecture

```
server/   Serveur autoritatif Node.js — tick 10 Hz, combat, IA, A*, AOI, SQLite
shared/   Code commun client/serveur — génération du monde (seed), formules, protocole
client/   Client canvas 2D — iso diamant 192x96, sprites Flare 8 directions,
          avatar par couches (armure/casque/arme/bouclier), autotiling des berges,
          éclairage simulé (obscurité nocturne + halos de feux de camp)
tools/    bots.js (test multi-joueurs), build-manifest.js (régénère les assets
          depuis un clone de flare-game), preview.py (captures sans navigateur)
```

Choix techniques : serveur **autoritatif** (le client n'envoie que des intentions, anti-triche par construction), protocole **binaire** pour les snapshots d'entités (20 octets/entité, 10 Hz) + JSON pour les événements, **interest management** par hash spatial (chaque client ne reçoit que ce qui l'entoure dans un rayon de 42 unités) — c'est ce qui permet 256 joueurs sur un seul process. La carte est générée par seed des deux côtés : rien à télécharger.

Test de charge : 60 bots simultanés → ~14 % CPU, 130 Mo RAM.

## Limites connues / pistes v2

Sorts et magie (la mana est déjà là), classes évoluées, PvP, marchands PNJ, donjons, instances multiples par serveur, échanges entre joueurs.
