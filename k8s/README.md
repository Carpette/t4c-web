# Déploiement Kubernetes Production - T4C Web

Ce dossier contient l'ensemble des fichiers de configuration nécessaires pour déployer l'application **T4C Web** sur un cluster Kubernetes en production avec d'excellentes performances et une haute disponibilité.

## Architecture & Choix Techniques

1. **Instance Unique (Replicas = 1) :**
   Le serveur de jeu gère l'état global du monde en mémoire et utilise une base de données SQLite locale (`game.db`). Par conséquent, l'application ne peut pas être scalée horizontalement (replicas > 1). Une mise à l'échelle horizontale nécessiterait de découpler l'état du jeu (via Redis, par exemple) et d'utiliser une base SQL centralisée.
   
2. **Stratégie de Déploiement `Recreate` :**
   Puisque SQLite n'autorise pas les écritures simultanées par plusieurs processus sur le même fichier, et que les volumes persistants standard (`ReadWriteOnce` comme EBS sur AWS) ne peuvent être montés que sur un seul nœud à la fois, la stratégie `Recreate` est indispensable. Lors d'une mise à jour (Rolling Update standard), Kubernetes démarrerait le nouveau Pod avant d'arrêter l'ancien, ce qui causerait un blocage de montage de volume. Avec `Recreate`, Kubernetes détruit proprement l'ancien Pod puis démarre le nouveau.

3. **Arrêt Gracieux & Préservation des données :**
   L'application NodeJS gère un protocole d'arrêt gracieux : elle intercepte les signaux `SIGTERM` pour diffuser un message d'alerte en jeu aux joueurs ("Arrêt du serveur dans X secondes..."), sauvegarde tous les personnages (`saveAll()`), ferme proprement les sockets et s'éteint.
   Le paramètre `terminationGracePeriodSeconds` est configuré à `60` secondes (pour 45s d'arrêt configurées en jeu) pour garantir qu'aucune donnée de joueur n'est corrompue et que la base SQLite WAL est correctement fermée.

4. **Performance du Stockage :**
   La base SQLite nécessite des entrées/sorties performantes. Il est fortement conseillé d'assigner une classe de stockage performante à faible latence IOPS (ex: `gp3` sur AWS, `premium-rwo` sur Azure ou `standard-rwo`/`extreme` sur GCP) dans le fichier `01-pvc.yaml`.

5. **Gestion des WebSockets par l'Ingress :**
   L'Ingress est configuré avec l'Ingress Controller **NGINX**. Deux annotations majeures permettent d'éviter les déconnexions intempestives des joueurs :
   - `nginx.ingress.kubernetes.io/proxy-read-timeout: "3600"` (1 heure de timeout d'inactivité en lecture)
   - `nginx.ingress.kubernetes.io/proxy-send-timeout: "3600"` (1 heure de timeout d'inactivité en écriture)
   - Le buffering de proxy est désactivé (`proxy-buffering: "off"`) pour un streaming en temps réel ultra-rapide des paquets WebSocket.

---

## Déploiement

### Étape 1 : Configurer les Secrets & Configurations

1. **Variables générales (`02-configmap.yaml`)** :
   Modifiez les valeurs selon vos besoins (`T4C_START_GOLD`, `T4C_SHUTDOWN_SECS`).
   
2. **Intégration Discord & Secrets CI/CD (`03-secret.yaml`)** (optionnel) :
   Le fichier `03-secret.yaml` utilise des placeholders du type `${DISCORD_BOT_TOKEN}` pour s'intégrer de manière sécurisée à une chaîne CI/CD.
   
   Pour déployer vos secrets de production de manière sécurisée sans les commiter :
   - Configurez vos secrets (ex: `DISCORD_BOT_TOKEN`, `DISCORD_CHANNEL_GENERAL`, etc.) dans les variables secrètes de votre outil CI/CD (GitHub Secrets, GitLab Variables, etc.).
   - Dans votre pipeline, injectez ces valeurs à la volée en utilisant l'utilitaire `envsubst` avant d'appliquer le manifeste :
     ```bash
     # Remplace les variables d'environnement dans le fichier de manière temporaire
     envsubst < 03-secret.yaml > 03-secret-populated.yaml
     
     # Appliquez ensuite le fichier peuplé
     kubectl apply -f 03-secret-populated.yaml
     ```
   *(Note : Si vous n'utilisez pas l'intégration Discord, vous pouvez appliquer `03-secret.yaml` directement tel quel. L'application démarrera sans problème, car le Secret est marqué comme optionnel dans le déploiement).*

3. **Image Docker (`04-deployment.yaml`)** :
   Remplacez `t4c-web:latest` par le tag d'image de votre registre d'images privé/public (ex: `votre-registry.com/t4c-web:v0.1.0`).

4. **Nom de domaine (`06-ingress.yaml`)** :
   Décommentez les blocs `host` et `tls` si vous possédez un nom de domaine et un certificat SSL/TLS (via `cert-manager`).

### Étape 2 : Appliquer les manifestes

Appliquez les manifestes dans l'ordre pour vous assurer que le namespace et les configurations soient prêts avant le déploiement :

```bash
kubectl apply -f 00-namespace.yaml
kubectl apply -f 01-pvc.yaml
kubectl apply -f 02-configmap.yaml

# Si vous utilisez des secrets CI/CD injectés :
kubectl apply -f 03-secret-populated.yaml
# Sinon (si vous n'utilisez pas l'intégration Discord) :
# kubectl apply -f 03-secret.yaml

kubectl apply -f 04-deployment.yaml
kubectl apply -f 05-service.yaml
kubectl apply -f 06-ingress.yaml
```

---

## Vérification et Logs

Pour suivre le démarrage du serveur de jeu :

```bash
# Lister les pods dans le namespace
kubectl get pods -n t4c-web

# Voir les logs du serveur
kubectl logs -f -l app=t4c-web -n t4c-web
```

Pour tester l'accès localement sans configurer de DNS :

```bash
kubectl port-forward svc/t4c-web-service 8080:80 -n t4c-web
```
Ensuite, ouvrez [http://localhost:8080](http://localhost:8080) dans votre navigateur.

---

## Déploiement Continu (CI/CD via GitHub Actions)

Le fichier `.github/workflows/deploy.yml` configure un pipeline complet de CI/CD qui s'exécute à chaque push sur la branche `main` :

1. **Build & Push** : Compile votre image Docker avec mise en cache optimisée, et la publie de manière sécurisée sur le registre **GitHub Container Registry (GHCR)**.
2. **Secrets Substitution** : Injecte les secrets Discord à la volée via `envsubst` à partir des secrets de votre dépôt GitHub.
3. **Mise à jour dynamique de l'image** : Remplace dynamiquement `image: t4c-web:latest` par l'image exacte nouvellement générée (`ghcr.io/votre-repo:sha-xxxxx`).
4. **Deploy & Rollout Verification** : Déploie l'ensemble des manifestes sur votre cluster Kubernetes et s'assure du bon redémarrage du pod.

### Configuration requise sur GitHub

Pour que le pipeline fonctionne, vous devez ajouter les secrets suivants dans les paramètres de votre dépôt GitHub (**Settings > Secrets and variables > Actions**) :

*   `KUBECONFIG` : Le contenu complet de votre fichier de configuration Kubernetes (`~/.kube/config`) permettant au pipeline de s'authentifier auprès de votre cluster.
*   `DISCORD_BOT_TOKEN` (Optionnel) : Le token de votre bot Discord.
*   `DISCORD_CHANNEL_GENERAL` (Optionnel) : L'ID de salon general, et ainsi de suite pour tous les autres canaux de discussion (`_AIDE`, `_VENTES`, `_ROLEPLAY`) et leurs webhooks respectifs (`DISCORD_WEBHOOK_GENERAL`, etc.).
