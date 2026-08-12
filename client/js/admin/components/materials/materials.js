// Atelier matériaux : texture tuilable (CC0 / IA mode tiling) -> pièces de jeu
// (murs d'arête / toits / sols) générées EN CANVAS (texgen.js), puis enregistrées
// via POST /api/admin/tiles (tileset wall_u_* / roof_u_* / floor_u_* découvert
// automatiquement par la palette de l'éditeur).
import { readTexture, seamScore, makeSeamless, wallPieces, roofPieces, floorPieces, buildAtlas } from '../../texgen.js';

export function MaterialsController(api) {
  const $ = (id) => document.getElementById(id);
  let tex = null;        // texture lue { data, w, h }
  let baked = null;      // { tiles, names, dataBase64 } prêt à poster
  let seamFixed = false;

  const msg = (t, err = false) => {
    const el = $('mat-msg');
    if (el) { el.textContent = t; el.className = (err ? 'text-red-400' : 'text-green-400') + ' min-h-[1.5em]'; }
  };

  function drawSourcePreview(image) {
    const cv = $('mat-src');
    if (!cv) return;
    const g = cv.getContext('2d');
    g.imageSmoothingEnabled = true;
    g.clearRect(0, 0, cv.width, cv.height);
    // tuilé 2x2 : les coutures éventuelles sautent aux yeux au centre
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < 2; j++) g.drawImage(image, i * 128, j * 128, 128, 128);
    }
  }

  return {
    init() { /* rien à charger : tout se passe côté client jusqu'au save */ },

    generate() {
      const file = $('mat-file')?.files?.[0];
      if (!file) { msg('Choisissez d\'abord un fichier de texture.', true); return; }
      const img = new Image();
      img.onload = () => {
        try {
          tex = readTexture(img);
          seamFixed = false;
          const score = seamScore(tex);
          if (score > 25) { tex = makeSeamless(tex); seamFixed = true; }
          drawSourcePreview(img);
          const kind = $('mat-kind')?.value || 'mur';
          const pieces = kind === 'mur' ? wallPieces(tex) : kind === 'toit' ? roofPieces(tex) : floorPieces(tex);
          baked = buildAtlas(pieces, 2, kind === 'sol' ? 6 : 5);
          baked.kind = kind;
          // aperçu des pièces
          const box = $('mat-pieces');
          box.innerHTML = '';
          for (const p of pieces) {
            const wrap = document.createElement('div');
            wrap.className = 'text-center';
            const c = p.canvas;
            c.style.maxHeight = '110px'; c.style.width = 'auto';
            c.title = p.name;
            const lab = document.createElement('div');
            lab.className = 'text-xs text-gray-400 max-w-[110px] truncate';
            lab.textContent = p.name;
            wrap.append(c, lab);
            box.appendChild(wrap);
          }
          $('mat-save').disabled = false;
          msg(`✔ ${pieces.length} pièces générées` + (seamFixed
            ? ' — couture détectée dans la texture : correction automatique appliquée (fondu des bords).' : '.'));
        } catch (e) {
          msg('✘ Génération impossible : ' + e.message, true);
        }
      };
      img.onerror = () => msg('✘ Image illisible.', true);
      img.src = URL.createObjectURL(file);
    },

    async save() {
      if (!baked) { msg('Générez d\'abord les pièces.', true); return; }
      const name = ($('mat-name')?.value || '').trim();
      if (!name) { msg('Donnez un nom au matériau.', true); return; }
      try {
        const r = await api('/api/admin/tiles', 'POST', {
          name, kind: baked.kind, data: baked.dataBase64,
          tiles: baked.tiles, names: baked.names,
        });
        msg(`✔ Matériau « ${name} » enregistré (${r.frames} pièces, tileset ${r.tileset}). ${r.note || ''}`);
      } catch (e) {
        msg('✘ Enregistrement refusé : ' + e.message, true);
      }
    },
  };
}
