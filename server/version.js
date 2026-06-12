// Version du jeu, calculée AUTOMATIQUEMENT — personne ne la met à jour à la main.
//
// Format : v<majeur.mineur>.<nb de commits> (<sha court>, <date du commit>)
//   - majeur.mineur viennent de package.json (changés rarement, à la main) ;
//   - le nombre de commits s'incrémente tout seul à chaque commit : c'est le
//     compteur incrémental lisible qui identifie ce qui tourne ;
//   - le sha court lève toute ambiguïté ; la date situe le déploiement.
//
// Chaîne de repli (déploiements sans git, ex. image Docker) :
//   1. git en direct (dev local) ;
//   2. version.json généré au build par tools/gen-version.js ;
//   3. version de package.json seule (suffixée -dev).
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

export function computeVersion() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const [maj = '0', min = '0'] = String(pkg.version || '0.0.0').split('.');
  const git = (cmd) => execSync(cmd, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  try {
    return {
      version: `v${maj}.${min}.${git('git rev-list --count HEAD')}`,
      sha: git('git rev-parse --short HEAD'),
      date: git('git log -1 --format=%cd --date=format:%d/%m/%Y'),
      branch: git('git rev-parse --abbrev-ref HEAD'),
    };
  } catch { /* pas de git ici : on tente le fichier de build */ }
  try {
    const v = JSON.parse(fs.readFileSync(path.join(ROOT, 'version.json'), 'utf8'));
    if (v.version) return v;
  } catch { /* pas de version.json non plus */ }
  return { version: `v${pkg.version}-dev`, sha: null, date: null, branch: null };
}

// calculée une fois au démarrage du serveur (la version d'un process ne change pas)
export const VERSION = computeVersion();
