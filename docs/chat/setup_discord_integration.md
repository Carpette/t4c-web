# Discord integration setup

> guide pas à pas pour configurer tes salons, créer ton bot et obtenir tes URLs de webhooks afin de brancher ton jeu à Discord :

#  Étape 1 : Activer le mode Développeur sur Discord
  Cette étape est indispensable pour pouvoir copier facilement les IDs secrets de tes salons Discord.

   1. Ouvres tes Paramètres utilisateur sur Discord (la roue crantée en bas à gauche).
   2. Vas dans l'onglet Apparence (sous Paramètres de l'application).
   3. Tout en bas, coche l'option Mode Développeur pour l'activer.

#  Étape 2 : Créer l'application et le Bot Discord
   1. Rends-toi sur le Discord Developer Portal (https://discord.com/developers/applications).
   2. Connecte-toi avec ton compte Discord.
   3. Clique sur le bouton New Application en haut à droite.
   4. Donne un nom à ton application (ex: T4C Web Chat) et valide les CGU, puis clique sur Create.

  Récupérer le Token du Bot :
   1. Dans le menu de gauche, clique sur Bot.
   2. Clique sur Reset Token (et confirme). 
   3. Copie immédiatement le Token généré et colle-le dans ton fichier .env sous la clé DISCORD_BOT_TOKEN. (Garde ce token secret, c'est le mot de passe de ton bot !)

  Activer la lecture des messages (Très Important) :
   1. Fais défiler la page du bot vers le bas jusqu'à la section Privileged Gateway Intents.
   2. Active l'option Message Content Intent (le bouton doit devenir vert/bleu).
   3. Clique sur Save Changes en bas de la page.

# Étape 3 : Inviter le Bot sur ton serveur Discord
   1. Dans le menu de gauche sur le portail développeur, clique sur OAuth2 ➔ URL Generator.
   2. Dans la grille Scopes, coche uniquement la case bot.
   3. Une fois coché, une nouvelle grille Bot Permissions apparaît en bas. Coche les permissions suivantes :
      * Read Messages/View Channels (Voir les salons)
      * Send Messages (Envoyer des messages)
   4. Descends tout en bas de la page et copie l'URL générée dans le champ Generated URL.
   5. Colle cette URL dans ton navigateur web habituel. Choisis ton serveur Discord dans la liste et clique sur Autoriser pour y faire entrer le bot.

 # Étape 4 : Récupérer les IDs de tes Salons Discord (Pour Discord ➔ Jeu)
   1. Sur ton serveur Discord, crée ou choisis tes 4 salons (ex: #general, #aide, #ventes, #roleplay).
   2. Fais un clic droit sur ton salon #general et clique tout en bas sur Copier l'identifiant (Copy ID).
   3. Colle cet ID dans ton fichier .env pour DISCORD_CHANNEL_GENERAL.
   4. Répète l'opération pour les salons #aide, #ventes et #roleplay.

# Étape 5 : Créer et récupérer les URLs de tes Webhooks (Pour Jeu ➔ Discord)
  Tu dois créer un webhook par salon que tu souhaites synchroniser.

   1. Fais un clic droit sur ton salon #general ➔ Modifier le salon.
   2. Va dans l'onglet Intégrations puis clique sur Webhooks (ou Créer un webhook).
   3. Tu peux personnaliser son nom si tu le souhaites (ex: "Relais Général").
   4. Clique sur le bouton Copier l'URL du webhook.
   5. Colle cette URL dans ton fichier .env pour DISCORD_WEBHOOK_GENERAL.
   6. Répète l'opération pour tes autres salons (Aide, Ventes, RP).

# Étape 6 : Lancer et tester !
  Une fois ton fichier .env rempli avec toutes ces valeurs, démarre ton serveur de jeu :

```bash
npm start
```

  Tu devrais voir apparaître ces lignes de succès dans tes logs console au démarrage :
   1. Discord Webhook initialisé pour le canal : #general
   2. Discord Webhook initialisé pour le canal : #aide
   3. ...
   4. Bot Discord connecté sous le pseudo : T4C Web Chat#1234
   5. Écoute active sur 4 salon(s) Discord.

  Écris maintenant un message sur ton salon Discord #general : il apparaîtra instantanément dans la boîte de chat de ton jeu ! 
  
  Écris /general Salut tout le monde en jeu, et ton message sera immédiatement relayé sur ton salon Discord de manière élégante.