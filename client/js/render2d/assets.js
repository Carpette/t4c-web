// Chargement du manifest + images Flare
export async function loadAssets(onProgress) {
  const manifest = await (await fetch('/assets/manifest.json')).json();
  const paths = new Set(['tilesets/tileset_grassland.png', 'tilesets/tileset_grassland_water.png']);
  for (const e of Object.values(manifest.enemies)) paths.add(e.image);
  for (const sex of Object.values(manifest.avatar)) {
    for (const l of Object.values(sex)) paths.add(l.image);
  }
  for (const l of Object.values(manifest.loot)) paths.add(l.image);

  const images = new Map();
  let done = 0;
  const list = [...paths];
  await Promise.all(list.map(p => new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => { images.set(p, img); done++; onProgress?.(done, list.length); res(); };
    img.onerror = () => rej(new Error('image manquante : ' + p));
    img.src = '/assets/' + p;
  })));
  return { manifest, images };
}
