# Spécifications de Gameplay — T4C Web Roguelike

Ce document définit de manière formelle les règles, formules et mécaniques de jeu de **T4C Web**. L'objectif est d'allier la profondeur de build de *La Quatrième Prophétie* (système d'apprentissage, statistiques pures, calculs d'absorption de l'armure) à la tension dramatique d'un *Roguelike* (mort définitive, Épreuves d'accès, progression par paliers).

---

## 1. Philosophie Générale & Cycle de Jeu

* **La Mort Définitive (Permadeath)** : Tout personnage qui meurt (que ce soit face à un monstre ou dans l'Épreuve) voit ses données définitivement effacées de la table `characters` de la base de données. Son exploit (nom, niveau atteint, zone de trépas et tueur) est immortalisé dans le **Panthéon des Morts** (table `deaths`).
* **La Réincarnation** : Suite à sa mort, le joueur doit recréer un personnage. Il renaît au niveau 1 avec les statistiques de départ (`BASE_STATS` : For 12, End 12, Agi 12, Int 10, Sag 10), mais conserve son savoir et l'accès aux zones précédemment débloquées sur son compte (`unlocked`).
* **Progression par Paliers (Iles)** : Le monde est découpé en îles thématiques (Arakas, Île de Lumière, etc.). Chaque île correspond à une tranche de niveaux et d'équipements bien définie.

---

## 2. Modèle d'Entité Unifié (MOB, NPC, Player)

Afin d'assurer une cohérence parfaite et des mécaniques universelles, toutes les entités vivantes du jeu (**MOB, NPC et Player**) sont soumises aux mêmes règles et partagent le même socle d'attributs fondamentaux :

* **Niveau (`level`)** : Niveau de puissance brute de l'entité.
* **Statistiques (`stats`)** : Force (`str`), Endurance (`end`), Agilité/Dextérité (`agi` / `dex`), Intelligence (`int`), Sagesse (`wis`).
* **Compétences (`skills`)** : Un dictionnaire de compétences associées à un nombre de points (ex: `coup_assommant: 2`).
* **Livre de Sorts (`spellbook`)** : La liste des sortilèges connus et utilisables par l'entité.
* **Classe d'Armure (`AC` / `defense`)** : Capacité d'absorption physique directe des dégâts.
* **Puissances Magiques Élémentaires** : Modificateurs offensifs pour chacun des 7 éléments : Terre (`earth`), Eau (`water`), Air (`air`), Feu (`fire`), Lumière (`light`), Ténèbres (`dark`), Poison (`poison`).
* **Résistances Magiques Élémentaires** : Modificateurs défensifs pour chacun des 7 éléments : Terre (`earth`), Eau (`water`), Air (`air`), Feu (`fire`), Lumière (`light`), Ténèbres (`dark`), Poison (`poison`).
* **Encombrement (`encombrement`)** : Le poids total actuel des objets portés par l'entité dans son inventaire (principalement utile pour le Player).
* **Encombrement Max (`encombrementMax`)** : Capacité de port maximale. Elle est calculée de manière dynamique et s'adapte automatiquement à la Force de l'entité (y compris lorsque celle-ci est boostée).
* **Régénération de Vie (`hp_regen`)** : La quantité de points de vie récupérés par seconde par l'entité (base calculée à partir de l'Endurance, pouvant être boostée par les objets ou sortilèges).
* **Régénération de Mana (`mp_regen`)** : La quantité de points de mana récupérés par seconde par l'entité (base calculée à partir de l'Intelligence et de la Sagesse, pouvant être boostée par les objets ou sortilèges).

### Règles de Boosts et de Buffs (Objets & Sortilèges) :
* **Modificateurs autorisés** : Les équipements équipés, les potions et les buffs de sortilèges peuvent venir altérer dynamiquement la quasi-totalité des attributs (statistiques de base `str`/`end`/`agi`/`int`/`wis`, Classe d'Armure/AC, puissances et résistances magiques des 7 éléments, points de vie et mana max, les taux de régénération de vie et de mana (`hp_regen` et `mp_regen`), et la capacité de port maximale `encombrementMax` via la Force boostée).
* **Gestion des compétences** : Un buff ou équipement peut altérer temporairement le nombre de points d'une compétence déjà connue (ex: +5 points en *Esquive*). En revanche, il ne peut pas accorder temporairement une compétence que l'entité n'a pas apprise au préalable (la liste des compétences acquises reste fixe).
* **Livre de sorts** : Le livre de sorts (`spellbook`) ne peut jamais être modifié de façon temporaire par des buffs ou objets d'équipements. Il requiert un apprentissage permanent pour être étendu.

---

## 3. Attributs & Formules de Progression

Le personnage est défini par 5 attributs majeurs. Lors de la création, le joueur dispose de 30 points à répartir (base de 8 par statistique, maximum 25). Chaque niveau gagné octroie **5 points de statistiques** à répartir librement.

### Les 5 Statistiques de Base
1. **Force (`str`)** : Détermine les prérequis des armes lourdes, augmente les dégâts physiques bruts de mêlée (`+1 dégât par tranche de 3 For`) et régit l'encombrement maximal.
2. **Endurance (`end`)** : Détermine les prérequis des armures lourdes et influe directement sur le gain de points de vie maximums à chaque passage de niveau.
3. **Agilité (`agi`)** : Détermine les prérequis des arcs et des boucliers légers, régit la vitesse de déplacement, réduit le temps de recharge des attaques physiques et augmente les chances de coup critique.
4. **Intelligence (`int`)** : Détermine les prérequis des sorts offensifs, augmente les dégâts des sorts et influe sur la régénération passive de mana.
5. **Sagesse (`wis`)** : Détermine les prérequis des sorts de soin/buff, augmente l'efficacité des soins et buffs, et régit grandement le gain de mana maximum à chaque passage de niveau.

### Formules de Vitals (Points de Vie & Mana)
Pour conserver la tension historique de T4C, **monter ses statistiques de vitalité tôt dans la carrière du personnage est crucial**. Les gains ne sont pas rétroactifs :

* **Gain de PV par niveau** : 
  $$HP_{gain} = 7 + \frac{Endurance}{20}$$
* **Gain de Mana par niveau** : 
  $$Mana_{gain} = \lfloor\frac{Sagesse}{60}\rfloor + \lfloor3 + \frac{Intelligence}{20}\rfloor$$

### Régénération Passive (Toutes les secondes, hors combat)
*La régénération s'arrête en combat (pendant 5 secondes après avoir porté ou reçu un coup) sauf si un buff de régénération (ex: potion ou sort actif) est présent.*

* **Régénération PV de base (`hp_regen` de base)** : $0.6 + Endurance \times 0.06$ par seconde.
* **Régénération Mana de base (`mp_regen` de base)** : $0.25 + (Intelligence + Sagesse) \times 0.008$ par seconde.

*Note : Les valeurs finales de `hp_regen` et `mp_regen` appliquées par seconde sont calculées en prenant ces bases statistiques et en leur additionnant ou multipliant les boosts issus des équipements, des sorts ou des potions.*
* **Encombrement Max (Poids)** : $\lfloor\frac{Force \times 500}{Force + 100}\rfloor$
* **Vitesse de déplacement de base** : $\min(6.2, 4.0 + Agilité \times 0.02)$ (bridée à 7.5 maximum après buffs/compétences).

---

## 4. Système de Combat Physique

Le combat de T4C Web repose sur une distinction stricte entre la **chanceté de toucher** (régie par l'Agilité) et l'**absorption des dégâts** (régie par la Classe d'Armure / CA).

### Jet de Toucher (Hit Chance)
Seule la différence d'Agilité entre l'attaquant et le défenseur détermine si le coup porte. La Classe d'Armure n'influe jamais sur les chances de rater un coup.

* **Chance de toucher de base** : 
  $$Chance = 0.78 + (Agi_{attaquant} - Agi_{defenseur}) \times 0.006$$
  *Plancher minimal de toucher : 45% / Plafond maximal : 95% (98% pour les joueurs avec compétences d'attaque).*
* **Compétences & Bonus** :
  * La compétence *Attaque* (mêlée) ou *Archerie* (arc) ajoute $+0.1\%$ de chance de toucher par point entraîné.
  * La compétence *Esquive* du défenseur réduit les chances de toucher de l'attaquant de $-0.1\%$ par point.
  * La compétence *Parade* du défenseur offre une chance d'annuler totalement le coup reçu ($+0.1\%$ par point). Si un bouclier est équipé, l'efficacité de la parade est multipliée par $1.5$.

### Calcul des Dégâts & Absorption (Mitigation)
L'absorption de l'armure dans T4C n'est pas un pourcentage fixe mais une **soustraction directe** combinée à une part d'aléatoire (simulant les failles de l'armure).

1. **Dégâts bruts de l'attaquant** : Tirage aléatoire dans la fourchette de l'arme (`dmgMin` à `dmgMax`) multiplié par le modificateur de dégâts (compétence *Coup puissant*, buffs temporaires).
2. **Coup Critique** : Chance de base de $5\% + Agilité \times 0.03$ (max $35\%$). Un coup critique multiplie les dégâts bruts par $1.6$.
3. **Classe d'Armure Effective (`effectiveCA`)** : 
   $$\text{Armure Effective} = \text{Défense Cible} \times (0.3 + \text{Random}() \times 0.5)$$
   *L'armure de la cible absorbe donc entre 30% et 80% de sa valeur brute à chaque coup.*
4. **Compétence Transpercer l'armure** : Réduit la défense de la cible de $-0.25\%$ par point entraîné avant le calcul d'absorption.
5. **Dégâts finaux appliqués** : 
   $$Dégâts = \max(1, \lfloor Dégâts_{bruts} - \text{Armure Effective} \rfloor)$$

---

## 5. Système de Magie (Sorts)

Les sorts se divisent en quatre catégories majeures : Soins, Améliorations (Buffs), Projectiles ciblés (Bolts) et Zones d'effet (AoE).

### Règles d'or de la magie
* **Pas de Classe d'Armure** : Les dégâts magiques ignorent totalement la CA physique de la cible.
* **Résistances Élémentaires** : Les dégâts des projectiles et AoE sont atténués ou amplifiés selon les résistances élémentaires du défenseur (`terre`, `eau`, `air`, `feu`, `lumiere`, `dark`, `poison`).
  $$Dégâts_{finaux} = \max(1, \lfloor Dégâts \times (1 - Résistance) \rfloor)$$
* **Ligne de Vue** : Les sorts de type *Bolt* nécessitent une ligne de vue dégagée (`lineOfSight`) entre le joueur et la cible.

### Formules d'impact magique
* **Multiplicateur de sorts de base** : $1 + \text{Points en Profusion de mana} \times 0.002$.
* **Sort de Soin (Heal)** : Soigne un montant de $\text{Puissance Sort} \times (1 + Sagesse \times 0.05) \times \text{Multiplicateur}$.
* **Sort d'Attaque (Bolt / AoE)** : Inflige des dégâts magiques de base basés sur $\text{Puissance Sort} \times (1 + Intelligence \times 0.045) \times \text{Multiplicateur}$.

---

## 6. Les Grands Objets de Gameplay et le Système d'Effets

Chaque élément de gameplay (sorts, compétences, objets) s'articule autour d'un **Système d'Effets Unifié**. Ces grands objets de gameplay peuvent porter, appliquer ou déclencher un ou plusieurs de ces effets sur les entités vivantes (`MOB`, `NPC`, `Player`).

### 6.1 Structure Générale d'un Effet
Un effet est défini par les propriétés fondamentales suivantes :

* **Type (`type`)** : Détermine la nature et le comportement de l'effet. Les types d'effets gérés sont :
  * `damage` : Inflige des dégâts physiques, élémentaires ou bruts à la cible (immédiats ou périodiques).
  * `heal` : Restaure instantanément ou périodiquement un montant de points de vie ou de mana.
  * `drain` : Aspire instantanément ou périodiquement les ressources de la cible (vie ou mana) au profit de l'assaillant.
  * `stats_boost` : Altère temporairement ou de façon permanente les caractéristiques primaires de base (`str`, `end`, `agi`, `int`, `wis`).
  * `hp_boost` : Modifie temporairement ou de façon permanente la santé maximale (`maxHp`).
  * `mp_boost` : Modifie temporairement ou de façon permanente le mana maximal (`maxMana`).
  * `hp_regen_boost` : Augmente ou diminue temporairement la régénération passive par seconde de points de vie (`hp_regen`).
  * `mp_regen_boost` : Augmente ou diminue temporairement la régénération passive par seconde de mana (`mp_regen`).
  * `teleport` : Déplace instantanément l'entité vers de nouvelles coordonnées (ou vers une autre instance/zone).
  * `stun` : Étourdit l'entité, bloquant totalement ses déplacements, attaques, incantations et l'utilisation d'objets.
  * `slow` : Réduit temporairement le taux de vitesse de déplacement de l'entité (ex: -30% de vitesse).
  * `hide` : Rend l'entité invisible/furtive aux yeux des autres joueurs et des monstres.

* **Durée et Fréquence (Temporalité)** :
  Chaque effet dispose de paramètres temporels stricts pour déterminer son application :
  * **Durée (`duration`)** : Durée d'action en millisecondes (ms).
    * `duration = 0` : L'effet est **instantané**. Il applique sa logique une seule fois à l'instant T (ex: téléportation, dégât direct, potion de soin immédiate).
    * `duration > 0` : L'effet est **temporaire ou persistant**. Il reste actif pendant la durée impartie.
    * `duration = Infinity` : L'effet est **permanent** (ex: compétence passive entraînée).
  * **Intervalle (`interval`)** : Optionnel, exprimé en millisecondes (ms).
    * Si `interval = 0` ou non défini, l'effet s'applique en continu sans pulsation (ex: un boost de caractéristiques constant, un étourdissement continu).
    * Si `interval > 0`, l'effet s'applique de manière **périodique** (tous les X ticks de l'intervalle) jusqu'à ce que la durée totale de l'effet soit écoulée. Cela simule les dégâts ou soins périodiques (ex: un poison infligeant des dégâts toutes les 2000 ms pendant 10000 ms).

* **Conditions d'Annulation (Dispelling / Cancellation)** :
  Un effet peut se terminer de manière précoce avant l'expiration de sa durée si l'une des conditions suivantes est remplie :
  * **Catégorie d'effet (`category`)** : Les effets sont catégorisés (ex: `magique`, `poison`, `malediction`, `physique`, `systeme`). Un sort ou objet de dissipation ("cleanse" ou "dispel") peut cibler et supprimer tous les effets appartenant à une catégorie spécifique (ex: une potion de neutralisation annule instantanément tous les effets de catégorie `poison`).
  * **Triggers de rupture (`cancel_triggers`)** : Liste d'événements déclencheurs qui forcent le retrait immédiat de l'effet :
    * `on_death` : Retiré dès que l'entité meurt (comportement par défaut de la quasi-totalité des buffs/debuffs).
    * `on_damage_received` : Retiré si l'entité subit des dégâts de n'importe quelle source (ex: annule l'invisibilité `hide` ou un effet de sommeil).
    * `on_action_performed` : Retiré si l'entité effectue une action hostile, se déplace, attaque, lance un sort ou utilise un objet (ex: rompt la furtivité `hide`).
    * `on_combat_entered` : Retiré si l'entité entre en état de combat (reçoit ou inflige des dégâts au cours des 5 dernières secondes).
    * `on_move` : Retiré si l'entité se déplace.

### 6.2 Les Sorts (Spells)
Un sort est une formule magique active déclenchée manuellement par l'entité, consommant du mana.
* **Déclencheur (Trigger)** : Au lancement du sort (Cast).
* **Production d'effets** :
  * *Instantanés* (`duration = 0`) : Sorts de soins directs ou de dégâts immédiats.
  * *Persistants* (`duration > 0`) : Sorts de buff (ex: augmentation temporaire de Force ou d'AC) ou de régénération active temporaire (ex: augmentation de `hp_regen` ou `mp_regen` pendant 30 secondes).

### 6.3 Les Compétences (Skills)
Une compétence est une aptitude passive permanente entraînée par l'entité.
* **Déclencheur (Trigger)** : Effet passif appliqué en continu (Permanent) tant que la compétence est apprise et possède au moins 1 point.
* **Production d'effets** :
  * *Permanents* (`duration = Infinity` ou tant que la compétence est connue) : Applique un boost ou un multiplicateur constant (ex: *Méditer* qui applique un `stat_boost` multiplicateur permanent sur la caractéristique unifiée de régénération de mana `mp_regen`).

### 6.4 Les Objets (Items)
Les objets se divisent en deux catégories distinctes de gameplay :

#### A. Objets Portables & Équipables (Armes, Armures, Boucliers, Bijoux)
Ces objets modifient les capacités physiques ou magiques de l'entité tant qu'ils sont portés.
* **Déclencheurs (Triggers) d'effets** :
  1. **En continu (Passif / Équipé)** : L'effet reste actif de manière constante tant que l'objet est équipé dans un emplacement (`slot`) valide (ex: un anneau offrant un bonus de Force, ou un sceptre de mage augmentant passivement la régénération `mp_regen`).
  2. **À l'impact (On Hit - Armes)** : L'effet a une chance d'être appliqué à la cible lors d'une attaque physique réussie (ex: 15% de chances d'appliquer un poison persistant de 6 secondes ou un drain de vie instantané).
  3. **À la réception d'un coup (On Hit Received - Armures/Boucliers)** : L'effet se déclenche lorsque le porteur subit une attaque réussie (ex: effet "épines" qui renvoie instantanément 5 points de dégâts de feu à l'assaillant).

#### B. Consommables (Potions, Parchemins, Émulsions)
Ces objets sont consommés et supprimés de l'inventaire lors de leur utilisation.
* **Déclencheur (Trigger)** : À l'utilisation (On Use).
* **Production d'effets** :
  * *Instantanés* (`duration = 0`) : Potions restaurant directement un montant fixe de PV ou de mana.
  * *Persistants* (`duration > 0`) : Potion de régénération accrue augmentant temporairement le taux de régénération par seconde (`hp_regen` ou `mp_regen`) pendant 30 secondes.

### 6.5 Structure des Effets Actifs sur une Entité (`active_effects`)

Lorsqu'un effet temporaire ou persistant (`duration > 0`) est appliqué à une entité, il est instancié dans sa liste d'effets actifs (`active_effects`). Pour assurer un suivi précis du temps, du tick des intervalles et des conditions de rupture, chaque instance d'effet actif est représentée par la structure suivante :

* **Identifiant Unique (`uid`)** : Généré de manière incrémentale ou aléatoire pour identifier cette instance précise d'effet (indispensable pour l'annuler ou la dissiper de façon ciblée).
* **Type d'Effet (`type`)** : Le type d'effet appliqué (ex: `stats_boost`, `stun`, `damage`, etc.).
* **Sous-type ou Cible (`target_parameter`)** : Optionnel. Spécifie la caractéristique précise à affecter (ex: `str`, `fire_resist`, `hp_regen`).
* **Puissance calculée (`power` / `magnitude`)** : La puissance de l'effet, calculée au moment de l'application (ex: un sort lancé par un mage puissant va graver un `power = 25` dans son buff de Force, alors qu'un mage novice gravera `power = 5`).
* **Source de l'Effet (`source`)** : Référence de l'élément d'origine (ex: `{ type: "spell", id: "bene_maxhp" }` ou `{ type: "item", iid: 123 }`). Utile pour gérer les conflits de cumul (stacking).
* **Horodatage de Fin (`ends_at`)** : Le temps serveur absolu auquel l'effet expire définitivement.
* **Horodatage du Dernier Tick (`last_tick_at`)** : Pour les effets périodiques (`interval > 0`), enregistre le moment exact de la dernière pulsation de dégâts ou de soin pour cadencer le prochain tick.
* **Catégorie d'effet (`category`)** : Recopié de la définition de l'effet d'origine (`magique`, `poison`, etc.) pour le système de dissipation.
* **Déclencheurs de rupture (`cancel_triggers`)** : Recopiés de la définition d'origine (ex: `['on_move', 'on_damage_received']`).

#### Règles de Cumul et de Conflit (Stacking Rules)
Que se passe-t-il si une entité reçoit un nouvel effet persistant alors qu'elle en possède déjà un issu de la même source ?
* **Même Source (`source.id` ou `source.type` identique)** :
  * *Option de Remplacement* : Si le nouvel effet a un `power` supérieur, il écrase l'ancien (le temps d'expiration `ends_at` est réinitialisé et le `power` est mis à jour). S'il est plus faible ou égal, l'ancien est conservé, mais sa durée peut être rafraîchie si la règle de l'effet le spécifie.
  * *Option de Non-cumul strict* : Le nouvel effet est rejeté (ou rafraîchit simplement le `ends_at` de l'existant sans cumuler le `power`).
* **Sources Différentes** : Les effets se cumulent librement (ex: un buff de force provenant d'un sort et un buff de force provenant d'un anneau magique s'additionnent sans conflit).

---

## 7. Le Système de l'Épreuve

Pour passer d'un palier de niveau (une île) à un autre, le joueur doit obligatoirement triompher de **l'Épreuve**.

* **Accès** : Le joueur interagit avec le portail de l'Épreuve présent sur son île actuelle. Il doit accepter un avertissement solennel.
* **L'Instance** : Le joueur est téléporté dans un labyrinthe suspendu, généré de façon unique pour lui (instance solo). 
* **Les Monstres** : L'Épreuve est peuplée par les monstres les plus redoutables de l'île actuelle (les 3 monstres de plus haut niveau, scalés). Ils sont extrêmement agressifs (portée d'aggro et de laisse très grande) et ne réapparaissent pas une fois tués.
* **Conditions de Sortie** :
  * **Victoire** : Le joueur atteint le portail de sortie à l'autre bout de la carte. La zone suivante est débloquée définitivement, et le joueur y est téléporté.
  * **Défaite** : Le joueur meurt. La règle de *permadeath* s'applique : le personnage est supprimé.
  * **Déconnexion** : Si le joueur se déconnecte pendant l'Épreuve, sa progression dans l'instance est sauvegardée. S'il se reconnecte, il réapparaît exactement là où il s'était arrêté dans l'Épreuve.

---

## 8. Économie, Commerce & Interactions

L'économie de T4C Web est rude et encourage l'entraide ou le commerce de proximité.

### Échanges de gré à gré (Troc au sol)
Fidèle aux prémices du jeu original, il n'existe pas d'interface d'échange sécurisée automatique.
* Pour échanger, les joueurs doivent **poser leurs objets ou leur or directement au sol** (`PLAYER_DROP_DESPAWN` : durée de vie de 5 minutes).
* N'importe quel joueur passant sur la case peut ramasser l'objet. Ce système implique de la confiance et crée des zones d'échanges informelles dans les villes (autour du temple ou de la banque).

### La Banque Personnelle (Coffre)
Chaque village dispose d'un coffre de banque personnel d'une capacité fixe de **30 emplacements**.
* Les objets en banque ne pèsent rien sur l'encombrement du joueur.
* Les objets en banque sont liés au personnage : si le personnage meurt définitivement, le coffre associé est intégralement supprimé.

### Rachat des Marchands
Maître Aldric (et les autres marchands de zone) rachètent l'équipement et les sorts au même prix que le prix d'achat de base (ajusté selon la zone et les compétences de réduction de prix du joueur), empêchant toute génération d'or infinie par le commerce de revente.