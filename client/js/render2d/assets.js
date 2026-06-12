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
