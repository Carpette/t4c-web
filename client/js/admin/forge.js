// Outils communs aux écrans Créatures et Objets de la Forge : aperçu des
// sprites (mêmes planches, teinte et skins que le jeu) et calcul de la
// surcharge minimale d'une fiche par rapport à shared/defs.js.
import { tintedSheet } from '../render2d/entities2d.js';

let ressources = null; // { manifest, skins, images: Map }
let fraicheur = '';    // après un remplacement d'image : contourne le cache du navigateur

// oublie le manifeste et les images chargés (après un import, un remplacement)
export function oublierRessources() { ressources = null; fraicheur = `?v=${Date.now()}`; }

export async function chargerRessources() {
  if (!ressources) {
    const [manifest, skins] = await Promise.all([
      fetch('/assets/manifest.json').then(r => r.json()),
      fetch('/content/skins.json', { cache: 'no-store' }).then(r => r.json()).catch(() => ({})),
    ]);
    ressources = { manifest, skins: { items: skins.items || {}, mobs: skins.mobs || {} }, images: new Map() };
  }
  return ressources;
}

// image de client/assets, chargée une fois (aussi pour la Bibliothèque)
export function image(chemin) {
  let p = ressources.images.get(chemin);
  if (!p) {
    p = new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ko; i.src = '/assets/' + chemin + fraicheur; });
    ressources.images.set(chemin, p);
  }
  return p;
}

// planche réellement jouée pour une créature (skin de l'atelier prioritaire)
export function spriteDe(id, def) { return ressources?.skins.mobs[id] || def.sprite; }

// créature au repos, face au sud (direction 6), ancrée aux pieds
export async function dessinerCreature(cv, id, def) {
  const g = cv.getContext('2d');
  g.clearRect(0, 0, cv.width, cv.height);
  const { manifest, skins } = await chargerRessources();
  const sprite = spriteDe(id, def);
  const e = manifest.enemies[sprite];
  const f = e?.anims?.stance?.fr?.['6']?.[0] || e?.anims?.run?.fr?.['6']?.[0];
  if (!f) return false;
  let img = await image(e.image).catch(() => null);
  if (!img) return false;
  const skin = !!skins.mobs[id];
  if (!skin) img = tintedSheet(img, sprite, def.tint);
  const [x, y, w, h, ox, oy] = f;
  const ech = skin ? 1 : (def.spriteScale || 1);
  const pieds = cv.height - 24;
  // losange de case (192x96) pour juger la taille
  g.beginPath(); g.moveTo(cv.width / 2, pieds - 48); g.lineTo(cv.width / 2 + 96, pieds); g.lineTo(cv.width / 2, pieds + 48); g.lineTo(cv.width / 2 - 96, pieds); g.closePath();
  g.fillStyle = '#1d2418'; g.fill(); g.strokeStyle = '#2f3a27'; g.stroke();
  const k = Math.min(ech, (pieds - 6) / Math.max(1, oy), (cv.width - 8) / w);
  g.imageSmoothingEnabled = k < 1;
  g.drawImage(img, x, y, w, h, cv.width / 2 - ox * k, pieds - oy * k, w * k, h * k);
  return true;
}

// personnage (PNJ) d'après son `look`, mêmes couches et ordre que le jeu
// (EntityView2D.setLook), au repos face au sud, cadré en buste si `buste`
const ORDRE_SUD = ['main', 'feet', 'legs', 'hands', 'chest', 'head', 'off'];
export async function dessinerPersonnage(cv, look, buste = false) {
  const g = cv.getContext('2d');
  g.clearRect(0, 0, cv.width, cv.height);
  const { manifest } = await chargerRessources();
  const sexe = look?.sex === 'female' ? 'female' : 'male';
  const couches = {
    chest: look?.chest || 'default_chest', head: look?.head || (sexe === 'female' ? 'head_long' : 'head_short'),
    legs: look?.legs || 'cloth_pants', hands: look?.hands || 'default_hands', feet: look?.feet || 'default_feet',
    main: look?.main || null, off: look?.off || null,
  };
  const k = buste ? cv.width / 70 : Math.min(1.6, cv.height / 150);
  const pieds = buste ? cv.height + 52 * k : cv.height - 16;
  g.imageSmoothingEnabled = false;
  for (const type of ORDRE_SUD) {
    const def = couches[type] && manifest.avatar[sexe]?.[couches[type]];
    const f = def?.anims?.stance?.fr?.['6']?.[0];
    if (!f) continue;
    const img = await image(def.image).catch(() => null);
    if (!img) continue;
    const [x, y, w, h, ox, oy] = f;
    g.drawImage(img, x, y, w, h, cv.width / 2 - ox * k, pieds - oy * k, w * k, h * k);
  }
}

export const COUCHES_PERSONNAGE = async () => Object.keys((await chargerRessources()).manifest.avatar.male);

// icône d'objet (skin de l'atelier prioritaire, sinon sprite « loot » Flare)
export async function iconeObjet(id, def, taille = 24) {
  const { manifest, skins } = await chargerRessources();
  let img, x = 0, y = 0, w, h;
  if (skins.items[id]) {
    img = await image(skins.items[id]).catch(() => null);
    if (img) { w = img.width; h = img.height; }
  } else {
    const e = manifest.loot[def.loot];
    img = e && await image(e.image).catch(() => null);
    if (img) [x, y, w, h] = e.frame;
  }
  if (!img) return null;
  const c = document.createElement('canvas');
  c.width = c.height = taille;
  const g = c.getContext('2d');
  const s = Math.min(taille / w, taille / h);
  g.drawImage(img, x, y, w, h, (taille - w * s) / 2, (taille - h * s) / 2, w * s, h * s);
  return c.toDataURL();
}

// copie profonde d'une fiche (les proxys réactifs de petite-vue refusent structuredClone)
export const copie = (v) => JSON.parse(JSON.stringify(v));

// Surcharge minimale : champs différents de l'origine ; un champ vidé (absent
// ou null) vaut null si l'origine le portait (la fusion ne sait pas supprimer).
// Sans origine : la fiche entière, sans ses champs vides.
export function difference(fiche, origine) {
  const propre = Object.fromEntries(Object.entries(fiche).filter(([, v]) => v != null));
  if (!origine) return copie(propre);
  const s = {};
  for (const [k, v] of Object.entries(propre)) if (JSON.stringify(v) !== JSON.stringify(origine[k])) s[k] = copie(v);
  for (const k of Object.keys(origine)) if (!(k in propre) && origine[k] != null) s[k] = null;
  return s;
}

// champ numérique vide -> retiré de la fiche ; sinon nombre
export function fixerNombre(fiche, k, brut) {
  if (brut === '' || brut == null) { delete fiche[k]; return; }
  const n = parseFloat(String(brut).replace(',', '.'));
  if (Number.isFinite(n)) fiche[k] = n;
}

export const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
