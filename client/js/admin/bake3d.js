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
export const METRES_PAR_CASE = 1.75;        // humain de 1,8 m ≈ 120 px (avatar Flare)
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

  // Charge un modèle et l'enveloppe dans un pivot (rotation par direction).
  // texture : image à appliquer quand le pack la livre à part (FBX dont le
  // chemin de texture ne correspond pas à l'archive).
  async charger(url, { texture = null } = {}) {
    const fbx = /\.fbx$/i.test(url);
    const res = await (fbx ? this.fbx : this.gltf).loadAsync(url);
    const racine = fbx ? res : res.scene;
    const clips = (fbx ? res.animations : res.animations) || [];
    const carte = texture ? await new THREE.TextureLoader().loadAsync(texture) : null;
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
  async ajouterAnimations(modele, url) {
    const res = await (/\.fbx$/i.test(url) ? this.fbx : this.gltf).loadAsync(url);
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
