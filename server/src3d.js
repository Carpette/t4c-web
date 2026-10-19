// Modèles 3D sources de l'atelier 3D (packs CC0 extraits par
// tools/atelier3d/extraire.py). Ils ne sont PAS versionnés ni redistribués
// avec le jeu : seul le résultat cuit (sprites PNG) entre dans les assets.
// Dossier : T4C_SRC3D, sinon ~/t4c-assets-sources/_extrait s'il existe.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const SRC3D = path.resolve(process.env.T4C_SRC3D || path.join(os.homedir(), 't4c-assets-sources', '_extrait'));
const MODELE = /\.(gltf|glb|fbx)$/i;

export const src3dDisponible = () => fs.existsSync(SRC3D) && fs.statSync(SRC3D).isDirectory();

// chemin absolu d'un fichier demandé sous /src3d/, ou null (traversée, absent)
export function fichierSrc3d(rel) {
  const f = path.resolve(SRC3D, '.' + path.sep + rel);
  if (!f.startsWith(SRC3D + path.sep)) return null;
  try { return fs.statSync(f).isFile() ? f : null; } catch { return null; }
}

// liste des modèles (chemins relatifs, séparateur « / »), bornée
export function listerModeles(max = 5000) {
  const out = [];
  const visiter = (dir) => {
    let entrees = [];
    try { entrees = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entrees) {
      if (out.length >= max) return;
      const f = path.join(dir, e.name);
      if (e.isDirectory()) visiter(f);
      else if (MODELE.test(e.name)) out.push(path.relative(SRC3D, f).split(path.sep).join('/'));
    }
  };
  if (src3dDisponible()) visiter(SRC3D);
  return out.sort();
}
