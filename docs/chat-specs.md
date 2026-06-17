# Spécifications du Système de Chat (T4C)

Dans le système de chat de T4C, les fonctionnalités suivantes doivent être respectées :

## 1. Chat Local
*   **Comportement :** C'est le comportement par défaut. Un message saisi sans préfixe est envoyé localement.
*   **Saisie :** `<Entrée>` -> `<Le message>` -> `<Entrée>`.
*   **Règle de visibilité :** La diffusion est limitée par une règle de proximité physique du joueur (zone de visibilité / AOI du joueur).
*   **Rendu :** Affiché au-dessus de la tête du joueur en jeu (bulle/texte flottant) en plus de la boîte de chat.

## 2. Canaux Publics
*   **Comportement :** Canaux de discussion globaux auxquels les joueurs peuvent s'abonner et se désabonner.
*   **Canaux par défaut :** `#general`, `#aide`, `#ventes`, `#roleplay`.
*   **Saisie :** `<Entrée>` -> `/<NomDuCanal> <Message>` -> `<Entrée>` (ex: `/aide comment équiper une arme ?`).
*   **Règle de visibilité :** Tous les joueurs abonnés au canal concerné reçoivent le message, indépendamment de leur position physique.
