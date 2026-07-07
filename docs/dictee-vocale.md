# Dictée vocale locale — guide de débogage

Fonctionnalité livrée **sans avoir pu tester l'inférence réelle** (l'environnement
de développement ne joignait pas le hub HuggingFace). Ce guide est écrit pour
déboguer à froid : ouvre la console (**F12**), tout le cycle de vie est journalisé
avec le préfixe `[dictée]` (page) et `[dictée:worker]` (worker). **La dernière
ligne loggée dit où ça s'est arrêté.**

## Le déroulé nominal (ce que tu DOIS voir)

1. Connexion en jeu → console : `[dictée] init — supported: true | SharedArrayBuffer: true | WebGPU: … | consentement mémorisé: aucun`
2. Clic 🎙 (en haut à droite du chat) → modale de consentement → **Télécharger**
3. `[dictée] téléchargement/chargement du modèle demandé…` puis
   `[dictée:worker] chargement du modèle onnx-community/whisper-base — backend: webgpu|wasm | runtime: http://…/js/vendor/transformers/`
4. Le bouton affiche `12%… 47%… 100%` (1-3 min la première fois, réseau selon).
   Onglet **Réseau** : requêtes vers `huggingface.co` (modèle) et
   `/js/vendor/transformers/ort-wasm-simd-threaded.jsep.wasm` (runtime, ~25 Mo, local).
5. `[dictée:worker] modèle prêt` → `[dictée] ✔ prêt — le micro est chaud`
6. Maintenir **V** (hors champ de saisie) → le navigateur demande le micro →
   `[dictée] écoute… (sampleRate réel : 16000 Hz)` → bouton 🔴
7. Relâcher V → `[dictée] fin d'écoute : 2.31 s d'audio capturées` →
   `transcription en cours…` → **1-8 s** →
   `[dictée] ✔ transcription (1840 ms) : « bonjour aldric je cherche du travail »`
8. Le texte apparaît **dans le champ de saisie** (pas envoyé) → relire → Entrée.
9. Session suivante : chargement silencieux depuis le cache (`consentement
   mémorisé: accepted`, requêtes modèle servies en 0 ms depuis Cache Storage).

## Symptôme → cause → remède

| Symptôme | Cause probable | Remède |
|---|---|---|
| Pas de bouton 🎙 du tout | `supported: false` au log init. Soit `SharedArrayBuffer: false` → les en-têtes COOP/COEP ne sont pas servis (vieux serveur ? proxy qui les retire ?) ; soit pas de `mediaDevices` → page ouverte en `http://<ip>` distante (contexte non sécurisé) | Vérifier `curl -sI http://localhost:8090/ \| grep -i cross-origin` → doit montrer COOP `same-origin` + COEP `require-corp`. Jouer via `localhost` ou HTTPS |
| Bouton 🎙 mais rien après « Télécharger » | Worker mort au démarrage : import du module échoué | Console : erreur rouge sur `whisper-worker.js` ou `transformers.min.js` ? Onglet Réseau : 404 sur `/js/voice/whisper-worker.js` ou `/js/vendor/transformers/…` ? |
| `✘ … Failed to fetch` pendant le téléchargement | Le navigateur ne joint pas `huggingface.co`, OU la politique COEP bloque la réponse (il faut `Access-Control-Allow-Origin` côté HF — normalement toujours présent) | Onglet Réseau → requête huggingface.co → colonne statut. Si bloquée par COEP : le message d'erreur console le dit explicitement (`ERR_BLOCKED_BY_RESPONSE`) |
| `✘ … no available backend found` | Le runtime WASM ne charge pas : 404 sur `ort-wasm-simd-threaded.jsep.wasm`, ou mauvais MIME | `curl -sI http://localhost:8090/js/vendor/transformers/ort-wasm-simd-threaded.jsep.wasm` → `Content-Type: application/wasm` attendu |
| Coincé sur `transcription en cours…` | Inférence très lente (petit CPU, backend wasm) ou worker planté | Attendre 30 s. Toujours rien → console contexte worker pour l'erreur. Essayer Chrome (WebGPU) pour comparer |
| Transcription en anglais / charabia | La langue n'est pas prise en compte | Dans `whisper-worker.js` : `language: 'french'` est passé à l'appel — tester `'fr'` si la version de Transformers.js préfère le code court |
| `✘ getUserMedia : NotAllowedError` | Permission micro refusée | Cadenas dans la barre d'adresse → réautoriser le micro |
| `sampleRate réel : 48000` (pas 16000) | Le navigateur a refusé l'AudioContext à 16 kHz (rare) | Whisper recevra du 48 kHz étiqueté 16 kHz → charabia. Il faudra rééchantillonner à la main (décimation ×3) dans `stopListening()` — me redemander ou voir un exemple `OfflineAudioContext` |
| « Supprimer le modèle » ne libère rien | Le cache de Transformers.js porte un autre nom que `transformers-cache` | Le log `caches présents : …` liste les noms réels. Suppression manuelle : F12 → Application → Cache Storage → clic droit → supprimer |

## Boutons et fichiers

- **Où ça vit** : `client/js/voice/dictation.js` (cycle de vie, micro, consentement),
  `client/js/voice/whisper-worker.js` (inférence, `MODEL_ID` à changer pour
  `onnx-community/whisper-small` ~250 Mo si la précision de `base` déçoit),
  intégration dans `client/js/gui/components/chat/` (bouton, modale, touche V),
  en-têtes dans `server/index.js`.
- **Préférences** : localStorage `t4c:voice` = `accepted` | `declined`
  (le supprimer remet la modale au prochain clic).
- **Le modèle** : F12 → Application → Cache Storage (nom contenant
  « transformers ») — c'est là que dorment les ~60 Mo.
