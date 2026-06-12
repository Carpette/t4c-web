# T4C-Web — consignes pour les sessions IA

MMORPG web hommage à *La Quatrième Prophétie* (T4C). Serveur Node autoritatif
(`server/`), client canvas 2D (`client/`), code partagé (`shared/`), contenu
éditable (`content/`), outils et tests d'intégration (`tools/`).

## Flux git (OBLIGATOIRE — convention d'équipe)

**Ne jamais commiter directement sur `main`.** Tout développement passe par
une branche de feature et une PR GitHub :

```bash
# 1. partir d'une main à jour
git checkout main
git pull -r
git fetch -p

# 2. créer la branche de feature
git checkout -b featureX
# ... développer, commiter (commits atomiques, messages en français,
#     sujet à l'impératif + corps expliquant le POURQUOI) ...

# 3. dev terminé : se remettre à jour et rebaser sur la main DISTANTE
#    (origin/main est la vérité de ce qui a été mergé)
git fetch -p
git rebase -i origin/main
#    -> réorganiser les commits (squash des fixups, reword, drop) pour
#       une histoire propre avant publication

# 4. publier et ouvrir la PR (lien donné par git au push)
git push -u origin featureX
#    -> la merge se fait dans l'interface GitHub, jamais en local

# 5. une fois mergé sur GitHub
git checkout main
git fetch -p
git pull -r
```

Adaptations pour une session IA (pas d'éditeur interactif ni d'UI GitHub) :

- le rebase interactif se fait en scriptant l'éditeur de séquence
  (`GIT_SEQUENCE_EDITOR`) ou via des commits `fixup!` + `git rebase
  --autosquash origin/main` ; TOUJOURS montrer le `git log --oneline`
  résultant avant de pousser ;
- après le `git push -u`, transmettre à l'utilisateur l'URL de création de
  la PR affichée par git — la revue et le merge se font dans GitHub ;
- jamais de `push --force` sur `main` ; sur une branche de feature déjà
  poussée, `--force-with-lease` uniquement, et après l'avoir annoncé ;
- ne pas toucher aux branches des autres (rebase/réécriture réservés à sa
  propre branche de feature).

## Vérifications avant de pousser

- `node --check` sur les fichiers modifiés ;
- suites concernées dans `tools/` (`test-client.mjs`, `test-skins.js`,
  `test-banque.js`, `bots.js`...) sur une base fraîche :
  `PORT=8090 T4C_DB=/tmp/t4c-test.db T4C_START_GOLD=500 node server/index.js`.

## Conventions

- Code, commentaires et messages de commit en français.
- `content/*.json` est éditable à chaud par l'admin : ne pas y supposer un
  format figé sans regarder `server/content.js`.
- Les assets (`client/assets/`) sont versionnés ; `game.db*` ne l'est pas.
