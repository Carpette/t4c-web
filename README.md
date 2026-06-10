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
| Se déplacer | Clic gauche sur le sol |
| Attaquer | Clic gauche sur un monstre |
| Ramasser | Clic gauche sur un objet au sol |
| Zoom | Molette |
| Inventaire / Personnage / Aide | `I` / `C` / `H` |
| Chat | `Entrée` |

## Le jeu

- **Stats T4C** : Force, Endurance, Agilité, Intelligence, Sagesse — 5 points à répartir à chaque niveau (touche `C`).
- **Monstres** : fourmilions, fourmis de feu des marais, gobelins, squelettes et zombies du cimetière, hobgobelins des collines du nord, et deux minotaures redoutables à l'est. Chaque zone a son niveau — explorez prudemment.
- **Objets** : armes, armures, boucliers, casques, anneaux, potions. Qualités *normale / magique / rare* avec bonus de stats aléatoires. **L'équipement est visible sur votre personnage** (armure, casque, arme, bouclier).
- **Monde vivant** : cycle jour/nuit (10 min), feux de camp qui éclairent la nuit, village central, berges escarpées, chemins, cimetière, forêts.
- **Mort** : perte de 3 % de l'XP du niveau courant, résurrection au village.

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
