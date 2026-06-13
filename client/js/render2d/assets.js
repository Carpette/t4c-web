// Résolution d'un id de tuile -> image + rectangle source.
// Deux familles d'ids coexistent SANS collision :
//  - id NUMÉRIQUE  -> sol historique grassland/water (manifest.tiles / waterTiles),
//    image grass/water passée en repli ;
//  - id CHAÎNE « tileset:frame » (ex. "cave:42") -> manifest.tilesets[tileset],
//    avec l'image choisie par l'index stocké dans la frame (snow a 4 images).
// Retour : { img, rect:[x,y,w,h,ox,oy] } ou null si introuvable.
// `assets.images` est la Map des images chargées ; `grass`/`water` les images
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
    return img ? { img, rect } : null;
  }
  let rect = m.tiles[id];
  if (rect) return { img: grass, rect };
  rect = m.waterTiles[id];
  if (rect) return { img: water, rect };
  return null;
}

// Chargement du manifest + images Flare + skins personnalisés (onglet admin)
export async function loadAssets(onProgress) {
  const manifest = await (await fetch('/assets/manifest.json')).json();
  // skins fournis par l'admin : { items: { defId: 'skins/x.png' }, mobs: { defId: sprite } }
  let skins = { items: {}, mobs: {} };
  try {
    const raw = await (await fetch('/content/skins.json')).json();
    skins = { items: raw.items || {}, mobs: raw.mobs || {} };
  } catch { /* pas de skins configurés */ }

  const paths = new Set(['tilesets/tileset_grassland.png', 'tilesets/tileset_grassland_water.png']);
  // images des tilesets additionnels (cave, dungeon, ruins, neige : 1 à 4 images chacun)
  for (const ts of Object.values(manifest.tilesets || {})) {
    for (const img of ts.images) paths.add(img);
  }
  for (const e of Object.values(manifest.enemies)) paths.add(e.image);
  for (const sex of Object.values(manifest.avatar)) {
    for (const l of Object.values(sex)) paths.add(l.image);
  }
  for (const l of Object.values(manifest.loot)) paths.add(l.image);
  for (const img of Object.values(skins.items)) paths.add(img);

  const images = new Map();
  let done = 0;
  const list = [...paths];
  await Promise.all(list.map(p => new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => { images.set(p, img); done++; onProgress?.(done, list.length); res(); };
    // un skin manquant ne bloque pas le chargement du jeu (repli sur le sprite d'origine)
    img.onerror = () => {
      if (p.startsWith('skins/')) { done++; onProgress?.(done, list.length); res(); }
      else rej(new Error('image manquante : ' + p));
    };
    img.src = '/assets/' + p;
  })));
  return { manifest, images, skins };
}
