// Résolution d'un id de tuile -> image + rectangle source.
// Deux familles d'ids coexistent SANS collision :
//  - id NUMÉRIQUE  -> sol historique grassland/water (manifest.tiles / waterTiles),
//    image grass/water passée en repli ;
//  - id CHAÎNE « tileset:frame » (ex. "cave:42") -> manifest.tilesets[tileset],
//    avec l'image choisie par l'index stocké dans la frame (snow a 4 images).
// Retour : { img, rect:[x,y,w,h,ox,oy] }, null si introuvable, undefined si
// l'image est encore en chargement.
// `assets.images` est la Map (Images) des images ; `grass`/`water` les images
// du sol historique (pré-chargées par l'appelant pour éviter un lookup par tuile).
export function resolveTile(assets, id, grass, water) {
  const m = assets.manifest;
  if (typeof id === 'string') {
    const sep = id.indexOf(':');
    if (sep < 0) return null;
    const ts = m.tilesets?.[id.slice(0, sep)];
    if (!ts) return null;
    const rect = ts.tiles[id.slice(sep + 1)];
    if (!rect) return null;
    const img = assets.images.get(ts.images[rect[6] || 0]);
    // undefined : image en cours de chargement (à redemander), null : introuvable
    if (!img) return assets.images.echecs?.has(ts.images[rect[6] || 0]) ? null : undefined;
    return { img, rect };
  }
  let rect = m.tiles[id];
  if (rect) return { img: grass, rect };
  rect = m.waterTiles[id];
  if (rect) return { img: water, rect };
  return null;
}

// Images chargées À LA DEMANDE. Tout précharger coûtait ~226 Mo de PNG à
// la connexion et ~1,4 Go décodés : le navigateur ne pouvait pas tout garder
// décodé et re-décodait les planches en jeu (images saccadées). Seul le
// strict nécessaire est préchargé ; le reste se charge à la première
// demande. get(p) rend l'image si elle est prête, sinon lance son
// chargement et rend undefined (l'appelant saute ce dessin, l'image
// apparaît à la frame suivante). L'événement « charge » prévient les vues
// qui ne se redessinent pas seules (poupée, icônes).
export class Images extends Map {
  constructor() {
    super();
    this.enCours = new Map();          // chemin -> Promise<image|null>
    this.echecs = new Set();
    this.cibles = new EventTarget();
  }
  get(p) {
    const img = super.get(p);
    if (img || !p) return img;
    this.charger(p);
    return undefined;
  }
  // Promise de l'image (null si introuvable) ; un seul téléchargement par chemin
  charger(p) {
    if (super.has(p)) return Promise.resolve(super.get(p));
    if (this.echecs.has(p)) return Promise.resolve(null);
    let pr = this.enCours.get(p);
    if (pr) return pr;
    pr = new Promise((res) => {
      const img = new Image();
      img.onload = async () => {
        // décodé AVANT le premier dessin : pas de saccade à son apparition
        try { await img.decode?.(); } catch { /* décodé au premier dessin */ }
        this.set(p, img);
        this.enCours.delete(p);
        this.cibles.dispatchEvent?.(new CustomEvent('charge', { detail: p }));
        res(img);
      };
      img.onerror = () => {
        this.echecs.add(p);
        this.enCours.delete(p);
        if (!p.startsWith('skins/')) console.warn('image manquante :', p);
        res(null);
      };
      img.src = '/assets/' + p;
    });
    this.enCours.set(p, pr);
    return pr;
  }
  chargerTout(liste) { return Promise.all([...liste].map(p => this.charger(p))); }
  // rappel à chaque image chargée ; rend la fonction de désabonnement
  surCharge(fn) {
    const h = (e) => fn(e.detail);
    this.cibles.addEventListener?.('charge', h);
    return () => this.cibles.removeEventListener?.('charge', h);
  }
}

// Images des tuiles et décors d'une zone (à précharger à l'entrée de zone)
export function imagesDuDecor(assets, decor) {
  const out = new Set();
  const m = assets.manifest;
  const ajouter = (id) => {
    if (typeof id !== 'string') return;
    const sep = id.indexOf(':');
    const ts = sep > 0 && m.tilesets?.[id.slice(0, sep)];
    const rect = ts && ts.tiles[id.slice(sep + 1)];
    if (rect) out.add(ts.images[rect[6] || 0]);
  };
  for (const id of new Set(decor.floor || [])) ajouter(id);
  for (const p of decor.props || []) ajouter(p.tileId);
  return out;
}

// Chargement du manifest + images Flare + skins personnalisés (onglet admin)
export async function loadAssets(onProgress) {
  const manifest = await (await fetch('/assets/manifest.json')).json();
  // skins fournis par l'admin : { items: { defId: 'skins/x.png' }, mobs: { defId: sprite } }
  let skins = { items: {}, mobs: {}, spells: {}, npcs: {} };
  try {
    const raw = await (await fetch('/content/skins.json')).json();
    skins = { items: raw.items || {}, mobs: raw.mobs || {}, spells: raw.spells || {}, npcs: raw.npcs || {} };
  } catch { /* pas de skins configurés */ }

  // préchargé : sol historique (premier rendu), butins et skins d'objets et
  // de sorts (icônes de l'interface, petites images) ; le reste à la demande
  const paths = new Set(['tilesets/tileset_grassland.png', 'tilesets/tileset_grassland_water.png']);
  for (const l of Object.values(manifest.loot)) paths.add(l.image);
  for (const img of Object.values(skins.items)) paths.add(img);
  for (const img of Object.values(skins.spells)) paths.add(img);

  const images = new Images();
  let done = 0;
  const list = [...paths];
  await Promise.all(list.map(p => images.charger(p).then(() => onProgress?.(++done, list.length))));
  // bibliothèque d'effets de particules (attribution des fx aux sorts)
  let fxById = {};
  try {
    const raw = await (await fetch('/content/particles.json')).json();
    for (const p of raw.particles || []) fxById[p.id] = p;
  } catch { /* pas de bibliothèque : les sorts gardent leurs effets par élément */ }

  return { manifest, images, skins, fxById };
}
