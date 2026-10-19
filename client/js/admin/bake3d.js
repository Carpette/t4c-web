// Atelier 3D — moteur de « bake » CÔTÉ NAVIGATEUR : rend un modèle 3D
// (glTF/GLB/FBX, packs CC0 ou modèle importé par l'admin) en sprites
// isométriques au format du jeu : tuile 192x96, frames [x, y, w, h, ox, oy]
// ancrées aux pieds, 8 directions Flare (0 = O, 1 = NO ... 7 = SO).
//
// La COHÉRENCE graphique vient d'ici et non du modèle : même caméra, même
// lumière, même étalonnage pour tout ce qui passe par l'atelier, quel que
// soit le pack d'origine. Un utilisateur sans talent graphique dépose un
// modèle ; c'est la scène qui lui donne le style du jeu.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

export const HW = 96, HH = 48;              // demi-tuile écran (renderer.js)
const PX_PAR_CASE = HW * Math.SQRT2;        // 1 case monde = losange 192x96 à l'écran
const ELEVATION = Math.PI / 6;              // 30° : sin(30°) = 1/2 -> projection 2:1
export const METRES_PAR_CASE = 1.55;        // humain de 1,8 m ≈ 130 px pieds->tête (mesuré sur l'avatar Flare)
const SUR = 2;                              // suréchantillonnage (anticrénelage)

// Axes écran exprimés dans le monde : x monde -> bas-droite, z monde ->
// bas-gauche (mêmes conventions que renderer.js : px = (x - z) * HW).
const DROITE = new THREE.Vector3(1, 0, -1).normalize();
const VERS_CAMERA = new THREE.Vector3(Math.cos(ELEVATION) / Math.SQRT2, Math.sin(ELEVATION), Math.cos(ELEVATION) / Math.SQRT2);

// Direction Flare d -> rotation Y du modèle (un glTF regarde vers +Z).
// d vise l'angle écran 180° + 45°·d ; on inverse la projection de flareDir().
export function rotationDirection(d) {
  const a = (180 + 45 * d) * Math.PI / 180;
  const dx = (Math.cos(a) + 2 * Math.sin(a)) / 2, dz = (2 * Math.sin(a) - Math.cos(a)) / 2;
  return Math.atan2(dx, dz);
}

// Clip d'animation par motif (les packs nomment librement : « Idle »,
// « CharacterArmature|Idle », « Walking_A »...).
export function trouverClip(clips, motif) {
  if (!motif) return null;
  const re = motif instanceof RegExp ? motif : new RegExp(motif, 'i');
  return clips.find(c => re.test(c.name)) || null;
}

export class Atelier3D {
  constructor() {
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false, preserveDrawingBuffer: true });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera();

    // Lumière unique pour tout le jeu : soleil chaud venant du haut-gauche de
    // l'écran (comme Flare), ciel froid en ambiance, sol brun en rebond.
    this.scene.add(new THREE.HemisphereLight(0xc8d4ff, 0x4a3b2a, 1.6));
    this.soleil = new THREE.DirectionalLight(0xfff0d8, 2.6);
    this.soleil.castShadow = true;
    this.soleil.shadow.mapSize.set(2048, 2048);
    this.soleil.shadow.bias = -0.0005;
    this.soleil.shadow.radius = 4;
    this.scene.add(this.soleil, this.soleil.target);

    // Sol invisible qui ne garde que l'ombre portée (cuite dans le sprite).
    this.sol = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ opacity: 0.32 }));
    this.sol.rotation.x = -Math.PI / 2;
    this.sol.receiveShadow = true;
    this.scene.add(this.sol);

    this.gltf = new GLTFLoader();
    this.fbx = new FBXLoader();
  }

  // Chargeurs : ceux par défaut (URL servies), ou, pour des fichiers choisis
  // sur le poste (Map nom -> URL blob), des chargeurs dont chaque ressource
  // annexe (.bin, textures référencés par le glTF) est retrouvée par son nom.
  chargeurs(fichiers) {
    if (!fichiers) return { gltf: this.gltf, fbx: this.fbx };
    const manager = new THREE.LoadingManager();
    manager.setURLModifier(u => fichiers.get(decodeURIComponent(u.split('?')[0].split(/[\\/]/).pop())) || u);
    return { gltf: new GLTFLoader(manager), fbx: new FBXLoader(manager) };
  }

  // Charge un modèle et l'enveloppe dans un pivot (rotation par direction).
  // texture : image à appliquer quand le pack la livre à part (FBX dont le
  // chemin de texture ne correspond pas à l'archive) ; fichiers : voir
  // chargeurs() ; format : 'fbx' | 'gltf' quand l'URL n'a pas d'extension (blob).
  async charger(url, { texture = null, fichiers = null, format = null } = {}) {
    const fbx = format ? format === 'fbx' : /\.fbx$/i.test(url);
    const ch = this.chargeurs(fichiers);
    const res = await (fbx ? ch.fbx : ch.gltf).loadAsync(url);
    const racine = fbx ? res : res.scene;
    const clips = res.animations || [];
    const carte = texture ? await new THREE.TextureLoader(ch.gltf.manager).loadAsync(texture) : null;
    if (carte) carte.colorSpace = THREE.SRGBColorSpace;
    racine.traverse(o => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.frustumCulled = false; // les maillages animés sortent de leur boîte d'origine
      // three.js ne garde que 4 influences d'os par sommet : sans renormaliser,
      // les sommets à 5+ influences « fuient » vers l'origine (membres étirés)
      if (o.isSkinnedMesh) o.normalizeSkinWeights();
      for (const m of [].concat(o.material)) {
        // sans carte d'environnement, le métal pur rend noir : on le borne
        if (m.metalness !== undefined) m.metalness = Math.min(m.metalness, 0.25);
        // export FBX fréquent : opacité 0 sans raison (TransparencyFactor)
        if (m.opacity < 0.05 && !m.alphaMap) { m.opacity = 1; m.transparent = false; }
        if (carte) { m.map = carte; m.color?.set(0xffffff); }
        m.needsUpdate = true;
      }
    });
    const pivot = new THREE.Group();
    pivot.add(racine);
    return { url, racine, pivot, clips, mixer: new THREE.AnimationMixer(racine) };
  }

  // Ajoute des clips venant d'un autre fichier (bibliothèques d'animations
  // partagées, ex. Quaternius UAL) — liés par nom d'os.
  async ajouterAnimations(modele, url, { fichiers = null, format = null } = {}) {
    const ch = this.chargeurs(fichiers);
    const fbx = format ? format === 'fbx' : /\.fbx$/i.test(url);
    const res = await (fbx ? ch.fbx : ch.gltf).loadAsync(url);
    modele.clips.push(...(res.animations || []));
  }

  // Met le modèle à l'échelle, pieds à l'origine :
  //   hauteur : hauteur réelle en mètres (personnages, créatures, props) ;
  //   module  : unités du modèle par case (kits modulaires : le pas de la
  //             grille du kit devient une case du jeu, les pièces s'emboîtent).
  preparer(modele, { hauteur = 1.8, module = 0, orientation = 0 } = {}) {
    const { racine } = modele;
    racine.position.set(0, 0, 0);
    racine.scale.setScalar(1);
    racine.rotation.y = orientation;
    racine.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(racine, true);
    const k = module > 0 ? 1 / module : (hauteur / METRES_PAR_CASE) / Math.max(1e-6, b.max.y - b.min.y);
    racine.scale.setScalar(k);
    racine.updateMatrixWorld(true);
    b.setFromObject(racine, true);
    const c = b.getCenter(new THREE.Vector3());
    racine.position.set(-c.x, -b.min.y, -c.z);
    racine.updateMatrixWorld(true);
    modele.rayon = new THREE.Box3().setFromObject(racine, true).getBoundingSphere(new THREE.Sphere()).radius;
    return modele;
  }

  // Rend une frame. Renvoie { canvas, ox, oy } : canvas rogné au contenu,
  // (ox, oy) = position des pieds dans ce canvas (format des frames du jeu).
  rendre(modele, { dir = 6, clip = null, t = 0, ombre = true } = {}) {
    const { pivot, mixer } = modele;
    pivot.rotation.y = rotationDirection(dir);
    mixer.stopAllAction();
    const c = typeof clip === 'string' ? trouverClip(modele.clips, clip) : clip;
    if (c) { mixer.clipAction(c).play(); mixer.setTime(t % c.duration); }
    this.scene.add(pivot);

    // cadrage orthographique : 1 unité monde = PX_PAR_CASE px, centré sur le modèle
    const r = modele.rayon * 1.15 + 0.2;
    const cote = Math.ceil(2 * r * PX_PAR_CASE);
    const centre = new THREE.Vector3(0, r * 0.6, 0);
    const cam = this.camera;
    cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r;
    cam.near = 0.01; cam.far = 100;
    cam.position.copy(centre).addScaledVector(VERS_CAMERA, 40);
    cam.up.set(0, 1, 0);
    cam.lookAt(centre);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);

    // soleil : haut-gauche de l'écran, légèrement vers la caméra
    const dirSoleil = new THREE.Vector3().addScaledVector(DROITE, -1).addScaledVector(VERS_CAMERA, 0.5).add(new THREE.Vector3(0, 1.4, 0)).normalize();
    this.soleil.position.copy(dirSoleil).multiplyScalar(30);
    this.soleil.target.position.set(0, 0, 0);
    const sc = this.soleil.shadow.camera;
    sc.left = -r * 2; sc.right = r * 2; sc.top = r * 2; sc.bottom = -r * 2; sc.near = 1; sc.far = 80;
    sc.updateProjectionMatrix();
    this.sol.visible = ombre;
    this.sol.scale.setScalar(r * 6);

    this.renderer.setSize(cote * SUR, cote * SUR, false);
    this.renderer.render(this.scene, cam);
    this.scene.remove(pivot);

    // réduction (anticrénelage)
    const out = document.createElement('canvas');
    out.width = cote; out.height = cote;
    const g = out.getContext('2d', { willReadFrequently: true });
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(this.renderer.domElement, 0, 0, cote, cote);

    // position écran des pieds (origine monde), puis rognage au contenu
    const p = new THREE.Vector3(0, 0, 0).project(cam);
    const fx = (p.x + 1) / 2 * cote, fy = (1 - p.y) / 2 * cote;
    return rogner(out, fx, fy);
  }
}

// ---------- publication : atlas au format des routes admin existantes ----------

// Animations exigées par le moteur (server/enemy-import.js) ; nombres de
// frames et durées calés sur les planches Flare (gobelin, squelette, zombie).
export const ANIMS_CREATURE = {
  stance: { frames: 4, duration: 800, type: 'back_forth' },
  run: { frames: 8, duration: 600, type: 'looped' },
  swing: { frames: 5, duration: 450, type: 'play_once' },
  die: { frames: 6, duration: 700, type: 'play_once' },
};

// Instants d'échantillonnage d'un clip pour n frames selon le type Flare :
// boucle = période complète sans doublon ; aller-retour = demi-clip (le moteur
// rejoue à l'envers) ; une fois = du début à la toute fin (pose finale).
function instants(clip, { frames: n, type }) {
  const d = clip ? clip.duration : 0;
  return Array.from({ length: n }, (_, i) =>
    type === 'looped' ? i * d / n
      : type === 'back_forth' ? i * (d / 2) / Math.max(1, n - 1)
        : i * (d * 0.999) / Math.max(1, n - 1));
}

const pause = () => new Promise(r => setTimeout(r, 0)); // rend la main à l'UI

// Créature : 8 lignes (directions Flare) x colonnes (frames des 4 animations),
// cases de taille commune et ancre commune aux pieds — la grille attendue par
// POST /api/admin/skins/enemy. clips : { stance, run, swing, die } -> clip ou
// null (repli sur la pose de repos). Renvoie { canvas, cfg } (cfg sans nom).
export async function cuireCreature(atelier, modele, clips, { progres = null } = {}) {
  const repos = clips.stance || null;
  const frames = {}; // anim -> [dir][i] = { canvas, ox, oy }
  let L = 0, R = 0, U = 0, D = 0, fait = 0;
  const total = 8 * Object.values(ANIMS_CREATURE).reduce((n, a) => n + a.frames, 0);
  for (const [nom, spec] of Object.entries(ANIMS_CREATURE)) {
    const clip = clips[nom] || repos;
    const ts = instants(clip, spec);
    frames[nom] = [];
    for (let d = 0; d < 8; d++) {
      frames[nom][d] = ts.map(t => {
        const f = atelier.rendre(modele, { dir: d, clip, t });
        L = Math.max(L, f.ox); R = Math.max(R, f.canvas.width - f.ox);
        U = Math.max(U, f.oy); D = Math.max(D, f.canvas.height - f.oy);
        return f;
      });
      fait += ts.length;
      progres?.(fait / total);
      await pause();
    }
  }
  const cw = L + R, ch = U + D;
  const cols = Object.values(ANIMS_CREATURE).reduce((n, a) => n + a.frames, 0);
  const cv = document.createElement('canvas');
  cv.width = cols * cw; cv.height = 8 * ch;
  const g = cv.getContext('2d');
  const anims = {};
  let col = 0;
  for (const [nom, spec] of Object.entries(ANIMS_CREATURE)) {
    anims[nom] = { from: col, to: col + spec.frames - 1, duration: spec.duration, type: spec.type };
    for (let d = 0; d < 8; d++) {
      frames[nom][d].forEach((f, i) => g.drawImage(f.canvas, (col + i) * cw + L - f.ox, d * ch + U - f.oy));
    }
    col += spec.frames;
  }
  return { canvas: cv, cfg: { cell: [cw, ch], anchor: [L, U], anims } };
}

// Décor : une frame par orientation (quarts de tour), rangées côte à côte —
// le format de POST /api/admin/tiles (rects [x, y, w, h, ox, oy]).
export const ORIENTATIONS_DECOR = [[5, 'face SE'], [7, 'face SO'], [1, 'face NO'], [3, 'face NE']];
export function cuireDecor(atelier, modele) {
  const fr = ORIENTATIONS_DECOR.map(([d]) => atelier.rendre(modele, { dir: d }));
  const cv = document.createElement('canvas');
  cv.width = fr.reduce((n, f) => n + f.canvas.width + 2, 0);
  cv.height = Math.max(...fr.map(f => f.canvas.height));
  const g = cv.getContext('2d');
  const tiles = {};
  let x = 0;
  fr.forEach((f, i) => {
    g.drawImage(f.canvas, x, 0);
    tiles[i] = [x, 0, f.canvas.width, f.canvas.height, f.ox, f.oy];
    x += f.canvas.width + 2;
  });
  return { canvas: cv, tiles, names: ORIENTATIONS_DECOR.map(([, n]) => n) };
}

export const versBase64 = (cv) => cv.toDataURL('image/png').split(',')[1];

// Rognage au contenu non transparent ; ancre recalculée.
function rogner(cv, fx, fy) {
  const g = cv.getContext('2d', { willReadFrequently: true });
  const { data, width: w, height: h } = g.getImageData(0, 0, cv.width, cv.height);
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (data[(y * w + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return { canvas: cv, ox: Math.round(fx), oy: Math.round(fy) };
  const res = document.createElement('canvas');
  res.width = x1 - x0 + 1; res.height = y1 - y0 + 1;
  res.getContext('2d').drawImage(cv, x0, y0, res.width, res.height, 0, 0, res.width, res.height);
  return { canvas: res, ox: Math.round(fx - x0), oy: Math.round(fy - y0) };
}
