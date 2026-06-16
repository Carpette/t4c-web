import { ITEMS, MOBS } from '../../../../shared/defs.js';

export function SkinsController(api) {
  const $ = (id) => document.getElementById(id);

  let skinFiles = [];   // PNG déposés (client/assets/skins/)
  let skinSprites = []; // planches du manifest (créatures)
  let skinMap = { items: {}, mobs: {} };

  const fileToBase64 = (file) => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1]); // retire le préfixe dataURL
    r.onerror = rej;
    r.readAsDataURL(file);
  });

  const loadImageFile = (file) => new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('image illisible'));
    img.src = URL.createObjectURL(file);
  });

  function chromaKey(ctx, w, h, hex, tol) {
    const r0 = parseInt(hex.slice(1, 3), 16), g0 = parseInt(hex.slice(3, 5), 16), b0 = parseInt(hex.slice(5, 7), 16);
    const d = ctx.getImageData(0, 0, w, h);
    const px = d.data;
    const soft = tol * 1.55;
    for (let i = 0; i < px.length; i += 4) {
      const dr = px[i] - r0, dg = px[i + 1] - g0, db = px[i + 2] - b0;
      const dist = Math.sqrt(dr * dr + dg * dg + db * db);
      if (dist < tol) px[i + 3] = 0;
      else if (dist < soft) px[i + 3] = Math.min(px[i + 3], Math.round(((dist - tol) / (soft - tol)) * 255));
    }
    ctx.putImageData(d, 0, 0);
  }

  async function prepareImage(file, { targetW = 0, targetH = 0, mode = 'contain' } = {}) {
    const img = await loadImageFile(file);
    const a = document.createElement('canvas');
    a.width = img.width; a.height = img.height;
    const actx = a.getContext('2d');
    actx.drawImage(img, 0, 0);
    if ($('skin-chroma').checked) {
      chromaKey(actx, a.width, a.height, $('skin-chroma-color').value, parseInt($('skin-chroma-tol').value, 10) || 90);
    }
    if (!$('skin-resize').checked || !targetW || !targetH) {
      return { data: a.toDataURL('image/png').split(',')[1], canvas: a };
    }
    const b = document.createElement('canvas');
    b.width = targetW; b.height = targetH;
    const bctx = b.getContext('2d');
    bctx.imageSmoothingEnabled = true;
    bctx.imageSmoothingQuality = 'high';
    if (mode === 'stretch') {
      bctx.drawImage(a, 0, 0, a.width, a.height, 0, 0, targetW, targetH);
    } else {
      const s = Math.min(targetW / a.width, targetH / a.height);
      const w = Math.max(1, Math.round(a.width * s)), h = Math.max(1, Math.round(a.height * s));
      bctx.drawImage(a, 0, 0, a.width, a.height, Math.round((targetW - w) / 2), Math.round((targetH - h) / 2), w, h);
    }
    return { data: b.toDataURL('image/png').split(',')[1], canvas: b };
  }

  function skinPreview(src) {
    const img = $('skin-preview');
    img.src = src;
    img.style.display = 'block';
  }

  function showPrompt(text) {
    $('skin-prompt').value = text;
    navigator.clipboard?.writeText(text).then(
      () => { $('skin-prompt-msg').textContent = '✔ copié dans le presse-papier'; },
      () => { $('skin-prompt-msg').textContent = ''; });
  }

  function itemPrompt(id) {
    const def = ITEMS[id];
    const slotNames = {
      weapon: 'arme', shield: 'bouclier', armor: 'armure (torse)', helmet: 'casque',
      legs: 'jambières', gloves: 'gants', belt: 'ceinture', boots: 'bottes',
      ring: 'anneau', ring2: 'anneau', amulet: 'amulette', use: 'consommable (potion/fiole)',
    };
    const bg = $('skin-chroma-color').value.toUpperCase();
    const STYLE_COMMUN = `Style : sprite de RPG isométrique 2D rétro (à la Diablo 1 / Flare), vue 3/4
plongeante, pixel-art peint aux couleurs riches mais palette sobre et désaturée,
éclairage doux venant du haut-gauche. Pas de texte, pas de cadre, pas de filigrane.`;
    return `Génère une image d'objet pour un jeu vidéo RPG médiéval-fantastique.

Objet : ${def.name} (${slotNames[def.slot] || def.slot}).

Contraintes techniques IMPÉRATIVES (l'image sera détourée et redimensionnée par un outil) :
- fond UNI de couleur VERTE PURE ${bg}, parfaitement uniforme sur toute l'image :
  aucun dégradé, aucune texture, aucun vignettage, aucune ombre portée sur le fond ;
- AUCUNE teinte verte sur l'objet lui-même (elle deviendrait transparente) ;
- image CARRÉE (ratio 1:1), idéalement 96 x 96 pixels — si la taille exacte est
  impossible, respecte STRICTEMENT le ratio carré ;
- un seul objet, entier, centré, occupant environ 80 % de la hauteur ;
- l'objet est vu comme POSÉ AU SOL en vue isométrique 3/4 (légèrement de haut) ;
- pas d'ombre au sol, pas de reflet, contour net.

${STYLE_COMMUN}`;
  }

  function enemyPrompt(creatureName = null, flavor = '') {
    const name = creatureName || $('skin-enemy-name').value.trim() || 'créature';
    const cw = parseInt($('skin-cell-w').value, 10) || 128;
    const ch = parseInt($('skin-cell-h').value, 10) || 128;
    const ax = parseInt($('skin-anchor-x').value, 10) || Math.floor(cw / 2);
    const ay = parseInt($('skin-anchor-y').value, 10) || ch - 16;
    let anims = {};
    try { anims = JSON.parse($('skin-enemy-anims').value); } catch { /* champs invalides : prompt générique */ }
    const cols = Math.max(0, ...Object.values(anims).map(a => (a.to | 0) + 1)) || 8;
    const animLines = Object.entries(anims).map(([n, a]) => {
      const labels = {
        stance: 'attente/idle (boucle, respiration ou piétinement léger)',
        run: 'course/déplacement (boucle de marche)',
        swing: "attaque (élan et coup, jouée une fois)",
        die: 'mort (s\'effondre, jouée une fois, dernière frame = au sol)',
        hit: 'touché (recul bref)', cast: 'incantation', shoot: 'tir',
      };
      return `  - colonnes ${a.from} à ${a.to} : ${labels[n] || n}`;
    }).join('\\n');
    const bg = $('skin-chroma-color').value.toUpperCase();
    const STYLE_COMMUN = `Style : sprite de RPG isométrique 2D rétro (à la Diablo 1 / Flare), vue 3/4
plongeante, pixel-art peint aux couleurs riches mais palette sobre et désaturée,
éclairage doux venant du haut-gauche. Pas de texte, pas de cadre, pas de filigrane.`;
    return `Génère une PLANCHE DE SPRITES (sprite sheet) d'une créature pour un jeu vidéo RPG
isométrique médiéval-fantastique.

Créature : ${name}.${flavor ? `
${flavor}` : ''}

Contraintes techniques IMPÉRATIVES — la planche est détourée, redimensionnée puis
découpée par un programme :
- fond UNI de couleur VERTE PURE ${bg}, parfaitement uniforme sur TOUTE la planche :
  aucun dégradé, aucune texture, aucune ligne de grille visible, aucune ombre au sol ;
- AUCUNE teinte verte sur la créature (elle deviendrait transparente) ;
- taille idéale ${cols * cw} x ${8 * ch} pixels — si impossible, respecte STRICTEMENT
  ce ratio ${cols * cw}:${8 * ch} (l'outil redimensionne à l'import) ;
- grille STRICTEMENT régulière : 8 lignes x ${cols} colonnes, chaque case fait ${cw} x ${ch} pixels
  (à l'échelle du ratio) ;
- AUCUN espace, marge ou gouttière entre les cases ; rien ne déborde d'une case sur l'autre ;
- chaque LIGNE est la même animation vue dans une direction différente, dans CET ordre
  de haut en bas — ATTENTION, les 8 lignes doivent être 8 vues DISTINCTES, n'en duplique
  jamais une :
  1) OUEST : profil, museau pointant vers la GAUCHE de l'image (miroir exact de la ligne 5) ;
  2) NORD-OUEST : vu de dos 3/4, tête vers la gauche ;
  3) NORD : vu de DOS (queue vers la caméra, tête masquée) ;
  4) NORD-EST : vu de dos 3/4, tête vers la droite ;
  5) EST : profil, museau pointant vers la DROITE de l'image ;
  6) SUD-EST : vu de face 3/4, tête vers la droite ;
  7) SUD : de FACE (regard vers la caméra) ;
  8) SUD-OUEST : vu de face 3/4, tête vers la gauche ;
- chaque COLONNE est une frame d'animation, et le MOUVEMENT doit être très lisible
  d'une colonne à l'autre (pour la course : phases franches du cycle — pattes étendues,
  regroupées sous le corps, appui — pas huit poses quasi identiques) :
${animLines}
- la créature garde la MÊME taille, le même style et la même palette dans toutes les cases ;
- dans chaque case, les pieds (point de contact au sol) sont au pixel (${ax}, ${ay})
  mesuré depuis le coin haut-gauche de la case — position stable d'une frame à l'autre ;
- pas d'ombre portée (le fond doit rester du vert pur autour de la créature).

${STYLE_COMMUN}
Caméra identique à un sprite vu de 3/4 haut : on voit le dessus et un côté de la créature.`;
  }

  function regridSheet(src, cw, ch, ax, ay) {
    // ... (implementation unchanged)
  }

  function realignSheet(src, cw, ch, ax, ay, inset = 3) {
    // ... (implementation unchanged)
  }


  return {
    async loadSkins() {
      try {
        const r = await api('/api/admin/skins');
        skinFiles = r.files;
        skinSprites = r.sprites;
        skinMap = { items: r.map?.items || {}, mobs: r.map?.mobs || {} };
      } catch (e) { $('skins-msg').textContent = '✘ ' + e.message; return; }
      this.renderSkinItems();
      this.renderSkinMobs();
    },

    renderSkinItems() {
      const q = $('skin-item-search').value.trim().toLowerCase();
      const tbl = $('skin-items-table');
      tbl.innerHTML = '<tr><th>Objet</th><th>Image (skins/…)</th><th></th></tr>';
      const ids = Object.keys(ITEMS).filter(id => id !== 'or');
      const matches = (id) => !q || id.includes(q) || (ITEMS[id].name || '').toLowerCase().includes(q);
      const shown = [
        ...ids.filter(id => skinMap.items[id] && matches(id)),
        ...ids.filter(id => !skinMap.items[id] && matches(id)),
      ].slice(0, 30);
      for (const id of shown) {
        const tr = document.createElement('tr');
        const tdName = document.createElement('td');
        tdName.textContent = `${ITEMS[id].name} (${id})`;
        const tdSel = document.createElement('td');
        const sel = document.createElement('select');
        const cur = (skinMap.items[id] || '').replace(/^skins\//, '');
        sel.innerHTML = '<option value="">— sprite d\'origine —</option>' +
          skinFiles.map(f => `<option value="${f}"${cur === f ? ' selected' : ''}>${f}</option>`).join('');
        sel.onchange = () => {
          if (sel.value) skinMap.items[id] = `skins/${sel.value}`;
          else delete skinMap.items[id];
        };
        tdSel.appendChild(sel);
        const tdEye = document.createElement('td');
        tdEye.style.whiteSpace = 'nowrap';
        const eye = document.createElement('button');
        eye.textContent = '👁';
        eye.title = 'Aperçu';
        eye.onclick = () => { if (sel.value) skinPreview(`/assets/skins/${encodeURIComponent(sel.value)}`); };
        const pr = document.createElement('button');
        pr.textContent = '📋';
        pr.title = 'Prompt IA pour générer l\'image de cet objet';
        pr.style.marginLeft = '4px';
        pr.onclick = () => showPrompt(itemPrompt(id));
        tdEye.append(eye, pr);
        tr.append(tdName, tdSel, tdEye);
        tbl.appendChild(tr);
      }
      if (ids.filter(matches).length > shown.length) {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td colspan="3" class="hint">… ${ids.filter(matches).length - shown.length} objet(s) de plus — affinez le filtre</td>`;
        tbl.appendChild(tr);
      }
    },

    renderSkinMobs() {
      const q = $('skin-mob-search').value.trim().toLowerCase();
      const tbl = $('skin-mobs-table');
      tbl.innerHTML = '<tr><th>Créature</th><th>Planche (sprite)</th><th></th></tr>';
      const ids = Object.keys(MOBS).filter(id =>
        !q || id.includes(q) || (MOBS[id].name || '').toLowerCase().includes(q));
      for (const id of ids.slice(0, 40)) {
        const tr = document.createElement('tr');
        const tdName = document.createElement('td');
        tdName.textContent = `${MOBS[id].name} (${id})`;
        const tdSel = document.createElement('td');
        const sel = document.createElement('select');
        const cur = skinMap.mobs[id] || '';
        sel.innerHTML = `<option value="">— défaut (${MOBS[id].sprite}) —</option>` +
          skinSprites.map(s => `<option value="${s}"${cur === s ? ' selected' : ''}>${s}</option>`).join('');
        sel.onchange = () => {
          if (sel.value) skinMap.mobs[id] = sel.value;
          else delete skinMap.mobs[id];
        };
        tdSel.appendChild(sel);
        const tdEye = document.createElement('td');
        tdEye.style.whiteSpace = 'nowrap';
        const eye = document.createElement('button');
        eye.textContent = '👁';
        eye.title = 'Aperçu de la planche';
        eye.onclick = async () => {
          const sprite = sel.value || MOBS[id].sprite;
          try {
            const manifest = await (await fetch('/assets/manifest.json')).json();
            const img = manifest.enemies[sprite]?.image;
            if (img) skinPreview('/assets/' + img);
          } catch { /* aperçu indisponible */ }
        };
        const pr = document.createElement('button');
        pr.textContent = '📋';
        pr.title = 'Prompt IA pour générer la planche de cette créature';
        pr.style.marginLeft = '4px';
        pr.onclick = () => {
          const def = MOBS[id];
          const flavor = [
            `Niveau ${def.level} dans le jeu : silhouette ${def.level >= 15 ? 'massive et menaçante' : def.level >= 8 ? 'inquiétante' : 'modeste, créature de bas niveau'}.`,
            def.undead ? 'Créature MORTE-VIVANTE : chairs putréfiées, os apparents, regard éteint.' : '',
          ].filter(Boolean).join(' ');
          $('skin-enemy-name').value = id;
          showPrompt(enemyPrompt(def.name, flavor));
        };
        tdEye.append(eye, pr);
        tr.append(tdName, tdSel, tdEye);
        tbl.appendChild(tr);
      }
    },
    
    async uploadItemSkin() {
        const f = $('skin-item-file').files[0];
        if (!f) { $('skins-msg').textContent = '✘ Choisissez un fichier image.'; return; }
        try {
            const size = parseInt($('skin-item-size').value, 10) || 96;
            const { data, canvas } = await prepareImage(f, { targetW: size, targetH: size, mode: 'contain' });
            const r = await api('/api/admin/skins/upload', 'POST', { name: f.name, data });
            $('skins-msg').textContent = `✔ ${r.file} téléversé (${canvas.width}×${canvas.height}) — assignez-le à un objet ci-contre.`;
            skinPreview(canvas.toDataURL());
            await this.loadSkins();
        } catch (e) { $('skins-msg').textContent = '✘ ' + e.message; }
    },
    
    async uploadEnemySkin() {
        const f = $('skin-enemy-file').files[0];
        if (!f) { $('skins-msg').textContent = '✘ Choisissez la planche.'; return; }
        try {
            const cfg = {
            name: $('skin-enemy-name').value.trim(),
            cell: [parseInt($('skin-cell-w').value, 10), parseInt($('skin-cell-h').value, 10)],
            anchor: [parseInt($('skin-anchor-x').value, 10), parseInt($('skin-anchor-y').value, 10)],
            anims: JSON.parse($('skin-enemy-anims').value),
            };
            const declared = Math.max(0, ...Object.values(cfg.anims).map(a => (a.to | 0) + 1));
            const [cw2, ch2] = cfg.cell, [ax2, ay2] = cfg.anchor;
            let canvas, data, note = '';
            if ($('skin-realign').checked) {
            const native = await prepareImage(f, {});
            const grid = regridSheet(native.canvas, cw2, ch2, ax2, ay2);
            if (grid) {
                canvas = grid.canvas;
                if (grid.cols !== declared) {
                for (const a of Object.values(cfg.anims)) {
                    a.from = Math.min(a.from | 0, grid.cols - 1);
                    a.to = Math.min(a.to | 0, grid.cols - 1);
                }
                note = ` ⚠ grille réelle : ${grid.cols} colonnes (${declared} déclarées), animations bornées.`;
                }
            } else {
                const prep = await prepareImage(f, { targetW: declared * cw2, targetH: 8 * ch2, mode: 'stretch' });
                canvas = realignSheet(prep.canvas, cw2, ch2, ax2, ay2);
            }
            data = canvas.toDataURL('image/png').split(',')[1];
            } else {
            ({ data, canvas } = await prepareImage(f, { targetW: declared * cw2, targetH: 8 * ch2, mode: 'stretch' }));
            }
            const r = await api('/api/admin/skins/enemy', 'POST', { cfg, data });
            $('skins-msg').textContent = `✔ Planche « ${r.sprite} » ${r.existed ? 'remplacée' : 'importée'} `
            + `(${canvas.width}×${canvas.height}, ${r.cols} colonnes, ${r.anims.join(', ')}) — assignez-la à une créature.${note}`;
            skinPreview(canvas.toDataURL());
            await this.loadSkins();
        } catch (e) { $('skins-msg').textContent = '✘ ' + e.message; }
    },
    
    async saveSkins() {
        try {
            const r = await api('/api/admin/skins', 'PUT', skinMap);
            const nI = Object.keys(skinMap.items).length, nM = Object.keys(skinMap.mobs).length;
            $('skins-msg').textContent = `✔ Enregistré : ${nI} objet(s) et ${nM} créature(s) avec skin. ` + (r.note || '');
        } catch (e) { $('skins-msg').textContent = '✘ ' + e.message; }
    },

    showEnemyPrompt() {
        showPrompt(enemyPrompt());
    },

    copyPrompt() {
        const t = $('skin-prompt').value;
        if (t) navigator.clipboard?.writeText(t).then(() => { $('skin-prompt-msg').textContent = '✔ copié'; });
    },

    init() {
      // Use setTimeout to ensure the DOM is fully rendered before loading skins
      setTimeout(() => {
        this.loadSkins();
        const itemSearch = $('skin-item-search');
        if (itemSearch) itemSearch.oninput = this.renderSkinItems;
        const mobSearch = $('skin-mob-search');
        if (mobSearch) mobSearch.oninput = this.renderSkinMobs;
      }, 0);
    }
  };
}
