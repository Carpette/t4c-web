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
  return nextResolve(specifier, context);
}
