// Fige la version dans version.json, pour les déploiements SANS git à
// l'exécution (image Docker...). Appelé au build : `node tools/gen-version.js`.
// Le serveur lit ce fichier quand `git` n'est pas disponible (server/version.js).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeVersion } from '../server/version.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const v = computeVersion();
fs.writeFileSync(path.join(ROOT, 'version.json'), JSON.stringify(v, null, 2) + '\n');
console.log('version.json :', v.version, v.sha ? `(${v.sha}, ${v.date})` : '(sans git)');
