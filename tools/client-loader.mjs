// Résolution des imports ABSOLUS du client ('/js/vendor/petite-vue.js', …)
// quand le code du navigateur tourne dans Node (test-client headless).
// Dans le navigateur, '/js/…' est résolu par le serveur HTTP ; dans Node,
// on le fait pointer sur le dossier client/ du dépôt.
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const CLIENT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'client');

export function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('/')) {
    return nextResolve(pathToFileURL(path.join(CLIENT, specifier)).href, context);
  }
  // les modules client adressent shared/ en relatif calibré pour la route
  // HTTP /shared/ du serveur : quel que soit le fichier importeur, on pointe
  // sur le dossier shared/ du dépôt (même règle que test-editor/test-quests)
  const m = context.parentURL?.includes('/client/') && specifier.match(/^(?:\.\.\/)+shared\/(.*)$/);
  if (m) {
    return nextResolve(pathToFileURL(path.join(CLIENT, '..', 'shared', m[1])).href, context);
  }
  return nextResolve(specifier, context);
}
