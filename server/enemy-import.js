// Conversion d'une planche de créature (grille régulière 8 directions) en
// entrée du manifest Flare. Partagé entre l'outil CLI (tools/import-enemy.js)
// et l'API d'administration (téléversement depuis l'onglet Skins).
//
// Convention de la planche : 8 lignes = 8 directions (ordre Flare : 0=O,
// 1=NO, 2=N, 3=NE, 4=E, 5=SE, 6=S face caméra, 7=SO), colonnes = frames,
// toutes les cases de même taille. La description donne la taille de case,
// l'ancrage au sol et les plages de colonnes de chaque animation.
const REQUIRED_ANIMS = ['stance', 'run', 'swing', 'die'];
const DIRECTIONS = 8;

// dimensions d'un PNG depuis son en-tête IHDR (aucune dépendance)
export function pngSize(buffer) {
  if (buffer.length < 24 || buffer.readUInt32BE(12) !== 0x49484452) {
    throw new Error('PNG invalide (IHDR manquant)');
  }
  return { w: buffer.readUInt32BE(16), h: buffer.readUInt32BE(20) };
}

// Valide la description et construit l'entrée manifest { image, anims }.
// cfg : { name, cell: [w,h], anchor: [x,y], anims: { stance: {from,to,duration,type}, ... } }
export function buildEnemyEntry(cfg, imgW, imgH) {
  for (const k of ['name', 'cell', 'anchor', 'anims']) {
    if (!cfg[k]) throw new Error(`Champ manquant dans la description : « ${k} »`);
  }
  if (!/^[a-z0-9_-]+$/i.test(cfg.name)) throw new Error('Nom de sprite invalide (lettres, chiffres, _ et - uniquement)');
  for (const a of REQUIRED_ANIMS) {
    if (!cfg.anims[a]) throw new Error(`Animation obligatoire manquante : « ${a} »`);
  }
  const [cw, ch] = cfg.cell.map(Number);
  const [ox, oy] = cfg.anchor.map(Number);
  if (!(cw > 0) || !(ch > 0)) throw new Error('Taille de case invalide');
  const cols = Math.floor(imgW / cw);
  if (cols < 1) throw new Error(`Le PNG fait ${imgW}px de large : aucune colonne de ${cw}px n'y tient`);
  if (imgH < ch * DIRECTIONS) {
    throw new Error(`Le PNG fait ${imgH}px de haut : il faut 8 lignes de ${ch}px (${ch * DIRECTIONS}px)`);
  }
  if (ox < 0 || ox > cw || oy < 0 || oy > ch) {
    throw new Error(`Ancrage (${ox}, ${oy}) hors de la case ${cw}x${ch}`);
  }

  const anims = {};
  for (const [name, a] of Object.entries(cfg.anims)) {
    const from = a.from | 0, to = a.to | 0;
    if (!(from >= 0) || !(to >= from) || to >= cols) {
      throw new Error(`Animation « ${name} » : colonnes ${a.from}..${a.to} hors de la grille (${cols} colonnes)`);
    }
    const fr = {};
    for (let d = 0; d < DIRECTIONS; d++) {
      fr[String(d)] = [];
      for (let c = from; c <= to; c++) {
        fr[String(d)].push([c * cw, d * ch, cw, ch, ox, oy]);
      }
    }
    anims[name] = {
      frames: to - from + 1,
      duration: a.duration || 800,
      type: a.type || 'looped',
      fr,
    };
  }
  return { image: `enemies/${cfg.name}.png`, anims, cols };
}
