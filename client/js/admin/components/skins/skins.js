// Atelier 2D — génération de prompts IA (calibrés Nano Banana / Gemini),
// import contrôlé des images produites, assignation aux entités du jeu.
// Cibles : objets (icônes), créatures (planches 8 directions), sorts (icônes),
// PNJ (portraits, affichage en jeu à venir).
import { ITEMS, MOBS } from '../../../../shared/defs.js';

const SECTIONS = {
  items:  { label: 'objet',    plural: 'Objets' },
  mobs:   { label: 'créature', plural: 'Créatures' },
  spells: { label: 'sort',     plural: 'Sorts' },
  npcs:   { label: 'PNJ',      plural: 'PNJ' },
};

// Styles proposés au prompt. « flare » reprend mot pour mot la formulation
// itérée et validée des anciens prompts — ne pas la reformuler à la légère.
const STYLES = {
  flare: `Style : sprite de RPG isométrique 2D rétro (à la Diablo 1 / Flare), vue 3/4
plongeante, pixel-art peint aux couleurs riches mais palette sobre et désaturée,
éclairage doux venant du haut-gauche. Pas de texte, pas de cadre, pas de filigrane.`,
  pixel: `Style : pixel-art strict, contours nets de 1 pixel, palette restreinte
(16 à 32 couleurs), aucun anti-aliasing sur les bords extérieurs, dithering discret
pour les dégradés. Pas de texte, pas de cadre, pas de filigrane.`,
  sombre: `Style : peinture numérique sombre et réaliste, low-fantasy, matières usées
(cuir patiné, métal terni, os jauni), palette désaturée aux accents chauds,
éclairage doux venant du haut-gauche. Pas de texte, pas de cadre, pas de filigrane.`,
};

// Contexte commun en tête de chaque prompt : le générateur travaille toujours
// mieux quand il connaît l'univers AVANT les contraintes techniques.
const UNIVERS = `Univers et ton du jeu : « La Quatrième Prophétie — Web » est un MMORPG isométrique
2D médiéval-fantastique, hommage aux RPG de la fin des années 90 (Diablo 1,
The 4th Coming). Ton sombre et sérieux, low-fantasy : cryptes, cavernes, landes
brumeuses, villages fortifiés. Aucun style cartoon, aucun humour visuel.`;

// Conseils de cadrage propres à Nano Banana, affichés À CÔTÉ du prompt
// (jamais dedans) : ils anticipent ses travers récurrents par type de cible.
const NB_TIPS = {
  items: `Nano Banana : si l'objet penche ou déborde, redemande « recadre : objet entier,
centré, vu de 3/4 comme posé au sol ». Vérifie qu'aucun reflet vert ne teinte le métal.`,
  mobs: `Nano Banana : il duplique volontiers des lignes — compare la ligne 3 (dos) et la
ligne 7 (face) avant d'importer ; en cas de doublon, demande de régénérer UNIQUEMENT
la ligne fautive en conservant tout le reste. S'il dessine sa propre grille, laisse
« Recaler les frames » coché : elle sera détectée et effacée à l'import.`,
  spells: `Nano Banana : réclame UN motif central unique — s'il compose une scène,
redemande « un seul symbole, plein cadre, lisible en vignette de 26 pixels ».`,
  npcs: `Nano Banana : précise l'âge, l'expression et un signe distinctif, sinon tous
les visages convergent vers trente ans, neutre, symétrique.`,
};

export function SkinsController(api) {
  const $ = (id) => document.getElementById(id);

  // ---- état ----
  let skinFiles = [];    // PNG de client/assets/skins/
  let skinSprites = [];  // planches du manifest (créatures)
  let skinMap = { items: {}, mobs: {}, spells: {}, npcs: {} };
  let spellList = [];    // [{id,name,type,element,color,level}] fourni par l'API
  let npcList = [];      // [{id,name}]
  let descMap = {};      // fiches : { 'mobs:orc': 'texte…' }
  let section = 'mobs';
  let selId = null;
  let manifest = null;   // /assets/manifest.json (aperçus et anim « actuel »)
  let curFile = null;    // fichier déposé à l'étape 3
  let procCanvas = null; // résultat du pipeline (chroma / regrid / resize)
  let procNote = '';
  let procCols = 0;
  let animRAF = 0;

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





  // Détection de la VRAIE grille dessinée par l'IA. Les générateurs tracent
  // leurs propres séparateurs, à un pas qui dérive (mesuré : ~140 px au lieu de
  // 128, et variable verticalement) : découper à l'aveugle mélange les cases.
  // Ici : 1) repère les lignes peintes (colonnes/rangées remplies sur >85 %),
  // 2) les efface PAR COULEUR dans toute l'image (médiane des lignes, plus la
  // dominante si la couleur est verte), 3) reconstruit une planche propre en
  // recadrant chaque vraie cellule sur l'ancrage. Retourne null si aucune
  // grille peinte n'est détectée (on retombe alors sur realignSheet).
  function regridSheet(src, cw, ch, ax, ay) {
    const W = src.width, H = src.height;
    const sctx = src.getContext('2d');
    const d = sctx.getImageData(0, 0, W, H);
    const px = d.data;
    const vfill = new Float32Array(W), hfill = new Float32Array(H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (px[(y * W + x) * 4 + 3] > 24) { vfill[x] += 1 / H; hfill[y] += 1 / W; }
      }
    }
    const vlines = [], hlines = [];
    for (let x = 0; x < W; x++) if (vfill[x] > 0.85) vlines.push(x);
    for (let y = 0; y < H; y++) if (hfill[y] > 0.85) hlines.push(y);
    if (vlines.length < 2) return null;

    // couleur médiane des lignes
    const ch0 = [], ch1 = [], ch2 = [];
    for (const x of vlines) {
      for (let y = 0; y < H; y += 5) {
        const i = (y * W + x) * 4;
        if (px[i + 3] > 24) { ch0.push(px[i]); ch1.push(px[i + 1]); ch2.push(px[i + 2]); }
      }
    }
    const med = (arr) => { arr.sort((a, b) => a - b); return arr[arr.length >> 1] || 0; };
    const Lr = med(ch0), Lg = med(ch1), Lb = med(ch2);
    const greenish = Lg > Lr + 20 && Lg > Lb + 20;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] <= 24) continue;
      const dr = px[i] - Lr, dg = px[i + 1] - Lg, db = px[i + 2] - Lb;
      if (dr * dr + dg * dg + db * db < 4900
        || (greenish && px[i + 1] > px[i] + 30 && px[i + 1] > px[i + 2] + 30)) px[i + 3] = 0;
    }
    sctx.putImageData(d, 0, 0);

    // frontières : centres des amas de lignes + bords de l'image
    const centers = (idx, max) => {
      const out = [];
      let run = [];
      for (const v of idx) {
        if (run.length && v !== run[run.length - 1] + 1) { out.push(Math.round(run.reduce((a, b) => a + b) / run.length)); run = []; }
        run.push(v);
      }
      if (run.length) out.push(Math.round(run.reduce((a, b) => a + b) / run.length));
      return out.filter(c => c > 10 && c < max - 10);
    };
    const vb = [0, ...centers(vlines, W), W];
    const hb = hlines.length ? [0, ...centers(hlines, H), H] : Array.from({ length: 9 }, (_, i) => Math.round(i * H / 8));
    if (hb.length !== 9) return null; // pas 8 rangées : trop risqué
    const cols = vb.length - 1;
    if (cols < 2) return null;

    // reconstruction : bbox de chaque vraie cellule -> case propre cw x ch
    const out = document.createElement('canvas');
    out.width = cols * cw; out.height = 8 * ch;
    const octx = out.getContext('2d');
    octx.imageSmoothingEnabled = true;
    octx.imageSmoothingQuality = 'high';
    const d2 = sctx.getImageData(0, 0, W, H).data;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < cols; c++) {
        let minX = Infinity, maxX = -1, minY = Infinity, maxY = -1;
        for (let y = hb[r]; y < hb[r + 1]; y++) {
          for (let x = vb[c]; x < vb[c + 1]; x++) {
            if (d2[(y * W + x) * 4 + 3] > 24) {
              if (x < minX) minX = x; if (x > maxX) maxX = x;
              if (y < minY) minY = y; if (y > maxY) maxY = y;
            }
          }
        }
        if (maxX < 0) continue;
        let w2 = maxX - minX + 1, h2 = maxY - minY + 1;
        const s = Math.min((cw - 6) / w2, (ch - 10) / h2, 1);
        const dw = Math.max(1, Math.round(w2 * s)), dh = Math.max(1, Math.round(h2 * s));
        const tx = Math.min(Math.max(c * cw + ax - (dw >> 1), c * cw), (c + 1) * cw - dw);
        const ty = Math.min(Math.max(r * ch + ay - dh, r * ch), r * ch + ch - dh);
        octx.drawImage(src, minX, minY, w2, h2, tx, ty, dw, dh);
      }
    }
    return { canvas: out, cols };
  }

  // Recale chaque case d'une planche : efface une marge (tue les lignes de
  // grille dessinées par l'IA, quelle que soit leur couleur), puis translate le
  // contenu pour que son BAS-CENTRE tombe sur l'ancrage (ax, ay) de la case —
  // sans ça, les IA dessinent la créature à ±10 px près d'une frame à l'autre
  // et l'animation tremble comme une bobine de cinéma.
  function realignSheet(src, cw, ch, ax, ay, inset = 3) {
    const cols = Math.round(src.width / cw), rows = 8;
    const sctx = src.getContext('2d');
    const out = document.createElement('canvas');
    out.width = src.width; out.height = src.height;
    const octx = out.getContext('2d');
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x0 = c * cw, y0 = r * ch;
        const iw = cw - inset * 2, ih = ch - inset * 2;
        const d = sctx.getImageData(x0 + inset, y0 + inset, iw, ih);
        let minX = Infinity, maxX = -1, maxY = -1;
        for (let y = 0; y < ih; y++) {
          for (let x = 0; x < iw; x++) {
            if (d.data[(y * iw + x) * 4 + 3] > 24) {
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
              if (y > maxY) maxY = y;
            }
          }
        }
        if (maxX < 0) continue; // case vide
        const dx = Math.round(ax - (inset + (minX + maxX) / 2));
        const dy = Math.round(ay - (inset + maxY));
        octx.save();
        octx.beginPath();
        octx.rect(x0, y0, cw, ch);
        octx.clip();
        octx.drawImage(src, x0 + inset, y0 + inset, iw, ih, x0 + inset + dx, y0 + inset + dy, iw, ih);
        octx.restore();
      }
    }
    return out;
  }


  // ============================================================
  //                        PROMPTS
  // ============================================================

  function descOf() { return (descMap[`${section}:${selId}`] || '').trim(); }

  function entityName() {
    if (section === 'items') return ITEMS[selId]?.name || selId;
    if (section === 'mobs') return MOBS[selId]?.name || selId;
    if (section === 'spells') return spellList.find(s => s.id === selId)?.name || selId;
    return npcList.find(n => n.id === selId)?.name || selId;
  }

  // le « sujet » du prompt : nom + fiche rédigée par l'admin + indices tirés
  // des données du jeu (c'est là que la description physique paie vraiment)
  function subjectBlock() {
    const lines = [`Sujet : ${entityName()}.`];
    const d = descOf();
    if (d) lines.push(d);
    if (section === 'mobs') {
      const def = MOBS[selId] || {};
      lines.push(`Créature de niveau ${def.level | 0} : silhouette ${def.level >= 15 ? 'massive et menaçante' : def.level >= 8 ? 'inquiétante' : 'modeste, de bas niveau'}.`);
      if (def.undead) lines.push('Créature MORTE-VIVANTE : chairs putréfiées, os apparents, regard éteint.');
    } else if (section === 'items') {
      const slotNames = {
        weapon: 'arme', shield: 'bouclier', armor: 'armure (torse)', helmet: 'casque',
        legs: 'jambières', gloves: 'gants', belt: 'ceinture', boots: 'bottes',
        ring: 'anneau', ring2: 'anneau', amulet: 'amulette', use: 'consommable (potion/fiole)',
      };
      const def = ITEMS[selId] || {};
      lines.push(`Type d'objet : ${slotNames[def.slot] || def.slot || 'objet'}.`);
    } else if (section === 'spells') {
      const sp = spellList.find(s => s.id === selId) || {};
      const kind = { bolt: 'projectile offensif', heal: 'soin', aoe: 'zone d\u2019effet dévastatrice', buff: 'enchantement de soutien' }[sp.type] || 'sort';
      lines.push(`Nature du sort : ${kind}${sp.element ? `, élément ${sp.element}` : ''}${sp.level ? `, appris au niveau ${sp.level}` : ''}.`);
      if (sp.color) lines.push(`Couleur dominante attendue : ${sp.color} (c'est la couleur du sort en jeu).`);
    } else {
      lines.push(`Personnage non-joueur du monde d'Arakas, croisé par les joueurs au fil de leurs quêtes.`);
    }
    return lines.join('\n');
  }

  function bgColor() { return $('skin-chroma-color').value.toUpperCase(); }

  function promptItem() {
    return `Je veux que tu crées l'image d'un objet pour mon jeu vidéo, en te basant sur les informations contextuelles suivantes.

${UNIVERS}

${subjectBlock()}

Rendu attendu en jeu : icône d'inventaire ET objet posé au sol, affiché entre 22 et 96 pixels de haut — la silhouette doit rester lisible même en tout petit.

Instructions de création — contraintes IMPÉRATIVES (l'image sera détourée et redimensionnée par un outil) :
- fond UNI de couleur VERTE PURE ${bgColor()}, parfaitement uniforme sur toute l'image :
  aucun dégradé, aucune texture, aucun vignettage, aucune ombre portée sur le fond ;
- AUCUNE teinte verte sur l'objet lui-même (elle deviendrait transparente) ;
- image CARRÉE (ratio 1:1), idéalement 96 x 96 pixels — si la taille exacte est
  impossible, respecte STRICTEMENT le ratio carré ;
- un seul objet, entier, centré, occupant environ 80 % de la hauteur ;
- l'objet est vu comme POSÉ AU SOL en vue isométrique 3/4 (légèrement de haut) ;
- pas d'ombre au sol, pas de reflet, contour net.

${STYLES[$('at2-style').value]}
Tu as le droit de me poser des questions si tu hésites.`;
  }

  function promptSpell() {
    return `Je veux que tu crées l'icône d'un sort pour mon jeu vidéo, en te basant sur les informations contextuelles suivantes.

${UNIVERS}

${subjectBlock()}

Rendu attendu en jeu : vignette de la barre de sorts, affichée à 26 pixels — un joueur doit reconnaître le sort d'un coup d'œil en pleine mêlée.

Instructions de création — contraintes IMPÉRATIVES (l'image sera détourée et redimensionnée par un outil) :
- fond UNI de couleur VERTE PURE ${bgColor()}, parfaitement uniforme :
  aucun dégradé, aucune texture, aucune ombre portée sur le fond ;
- AUCUNE teinte verte sur le motif lui-même (elle deviendrait transparente) ;
- image CARRÉE (ratio 1:1), idéalement 96 x 96 pixels ;
- UN SEUL motif central emblématique, plein cadre (environ 85 % de la surface),
  silhouette franche et contrastée, PAS de scène, PAS de personnage entier ;
- pas de texte, pas de bordure décorative, pas de cadre de gemme.

${STYLES[$('at2-style').value]}
Tu as le droit de me poser des questions si tu hésites.`;
  }

  function promptNpc() {
    return `Je veux que tu crées le portrait d'un personnage pour mon jeu vidéo, en te basant sur les informations contextuelles suivantes.

${UNIVERS}

${subjectBlock()}

Rendu attendu en jeu : portrait affiché à côté des dialogues et de la boutique de ce personnage, environ 96 à 256 pixels de haut.

Instructions de création — contraintes IMPÉRATIVES (l'image sera détourée et redimensionnée par un outil) :
- fond UNI de couleur VERTE PURE ${bgColor()}, parfaitement uniforme :
  aucun dégradé, aucune texture, aucune ombre portée sur le fond ;
- AUCUNE teinte verte sur le personnage (elle deviendrait transparente) ;
- image CARRÉE (ratio 1:1), idéalement 256 x 256 pixels ;
- BUSTE cadré aux épaules, visage de trois quarts, regard légèrement décalé
  de la caméra, expression cohérente avec le rôle du personnage ;
- éclairage doux venant du haut-gauche, contour net.

${STYLES[$('at2-style').value]}
Tu as le droit de me poser des questions si tu hésites.`;
  }

  function promptMob() {
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
        die: "mort (s'effondre, jouée une fois, dernière frame = au sol)",
        hit: 'touché (recul bref)', cast: 'incantation', shoot: 'tir',
      };
      return `  - colonnes ${a.from} à ${a.to} : ${labels[n] || n}`;
    }).join('\n');
    return `Je veux que tu crées une PLANCHE DE SPRITES (sprite sheet) d'une créature pour mon jeu vidéo, en te basant sur les informations contextuelles suivantes.

${UNIVERS}

${subjectBlock()}

Rendu attendu en jeu : la créature est animée en vue isométrique, affichée entre 60 et 150 pixels de haut selon le zoom.

Instructions de création — contraintes IMPÉRATIVES : la planche est détourée, redimensionnée puis découpée par un programme.
- fond UNI de couleur VERTE PURE ${bgColor()}, parfaitement uniforme sur TOUTE la planche :
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

${STYLES[$('at2-style').value]}
Caméra identique à un sprite vu de 3/4 haut : on voit le dessus et un côté de la créature.
Tu as le droit de me poser des questions si tu hésites.`;
  }

  // ---- historique des prompts copiés (outillage local du navigateur) ----
  const HKEY = 'at2-prompt-history';
  function pushHistory(label, text) {
    let h = [];
    try { h = JSON.parse(localStorage.getItem(HKEY) || '[]'); } catch { /* vide */ }
    h = [{ label, text, at: Date.now() }, ...h.filter(e => e.label !== label)].slice(0, 6);
    try { localStorage.setItem(HKEY, JSON.stringify(h)); } catch { /* stockage plein */ }
    renderHistory();
  }
  function renderHistory() {
    let h = [];
    try { h = JSON.parse(localStorage.getItem(HKEY) || '[]'); } catch { /* vide */ }
    const box = $('at2-history');
    box.innerHTML = h.length ? '<span class="text-xs text-gray-500 self-center">Récents :</span>' : '';
    for (const e of h) {
      const b = document.createElement('button');
      b.textContent = e.label;
      b.className = 'text-xs';
      b.style.padding = '2px 8px';
      b.onclick = () => { $('skin-prompt').value = e.text; };
      box.appendChild(b);
    }
  }

  // ============================================================
  //                LISTE, FICHE, ASSIGNATIONS
  // ============================================================

  function entities() {
    if (section === 'items') return Object.keys(ITEMS).filter(id => id !== 'or').map(id => ({ id, name: ITEMS[id].name }));
    if (section === 'mobs') return Object.keys(MOBS).map(id => ({ id, name: MOBS[id].name }));
    if (section === 'spells') return spellList.map(s => ({ id: s.id, name: s.name }));
    return npcList.map(n => ({ id: n.id, name: n.name }));
  }

  function renderList(self) {
    const q = ($('at2-search').value || '').trim().toLowerCase();
    const box = $('at2-list');
    box.innerHTML = '';
    const assigned = skinMap[section];
    const all = entities().filter(e => !q || e.id.includes(q) || e.name.toLowerCase().includes(q));
    // les entités déjà habillées d'abord : c'est la liste de travail
    all.sort((a, b) => (!!assigned[b.id] - !!assigned[a.id]) || a.name.localeCompare(b.name));
    for (const e of all) {
      const row = document.createElement('div');
      row.className = 'at2-row' + (e.id === selId ? ' current' : '');
      const name = document.createElement('span');
      name.className = 'at2-row-name';
      name.textContent = e.name;
      name.title = e.id;
      const sel = document.createElement('select');
      sel.onclick = (ev) => ev.stopPropagation();
      if (section === 'mobs') {
        const cur = assigned[e.id] || '';
        sel.innerHTML = `<option value="">— défaut (${MOBS[e.id]?.sprite || '?'}) —</option>` +
          skinSprites.map(s => `<option value="${s}"${cur === s ? ' selected' : ''}>${s}</option>`).join('');
      } else {
        const cur = (assigned[e.id] || '').replace(/^skins\//, '');
        sel.innerHTML = `<option value="">— ${section === 'spells' ? 'émoji' : 'défaut'} —</option>` +
          skinFiles.map(f => `<option value="${f}"${cur === f ? ' selected' : ''}>${f}</option>`).join('');
      }
      sel.onchange = () => {
        if (sel.value) assigned[e.id] = section === 'mobs' ? sel.value : `skins/${sel.value}`;
        else delete assigned[e.id];
      };
      row.append(name, sel);
      row.onclick = () => self.selectEntity(e.id);
      box.appendChild(row);
    }
  }

  // premier frame « stance sud » d'une planche du manifest, en dataURL
  function spriteThumb(spriteName, size = 96) {
    const entry = manifest?.enemies?.[spriteName];
    const fr = entry?.anims?.stance?.fr?.['6']?.[0];
    if (!fr) return Promise.resolve(null);
    return new Promise((res) => {
      const img = new Image();
      img.onload = () => {
        const [x, y, w, h] = fr;
        const c = document.createElement('canvas');
        c.width = size; c.height = size;
        const ctx = c.getContext('2d');
        const s = Math.min(size / w, size / h);
        ctx.drawImage(img, x, y, w, h, (size - w * s) / 2, (size - h * s) / 2, w * s, h * s);
        res(c.toDataURL());
      };
      img.onerror = () => res(null);
      img.src = '/assets/' + entry.image;
    });
  }

  async function renderCard() {
    const card = $('at2-card');
    if (!selId) { card.classList.add('hidden'); return; }
    card.classList.remove('hidden');
    $('at2-card-name').textContent = entityName();
    let meta = selId;
    let thumb = null;
    const assigned = skinMap[section][selId];
    if (section === 'mobs') {
      const def = MOBS[selId] || {};
      meta = `${selId} — niveau ${def.level | 0}, ${def.hp | 0} PV, sprite ${assigned || def.sprite}${def.undead ? ', mort-vivant' : ''}`;
      thumb = await spriteThumb(assigned || def.sprite);
    } else if (section === 'items') {
      const def = ITEMS[selId] || {};
      meta = `${selId} — emplacement ${def.slot}, zone ${def.zone | 0}`;
      if (assigned) thumb = '/assets/' + assigned;
    } else if (section === 'spells') {
      const sp = spellList.find(s => s.id === selId) || {};
      meta = `${selId} — ${sp.type || '?'}${sp.element ? ', ' + sp.element : ''}, niveau ${sp.level | 0}`;
      if (assigned) thumb = '/assets/' + assigned;
    } else {
      meta = selId;
      if (assigned) thumb = '/assets/' + assigned;
    }
    $('at2-card-meta').textContent = meta;
    const img = $('at2-card-img');
    if (thumb) { img.src = thumb; img.classList.remove('hidden'); }
    else img.classList.add('hidden');
    $('at2-desc').value = descMap[`${section}:${selId}`] || '';
    $('at2-desc-msg').textContent = '';
  }

  function refreshTypeUI() {
    const isMob = section === 'mobs';
    $('at2-sheet-params').classList.toggle('hidden', !isMob);
    $('at2-realign-wrap').classList.toggle('hidden', !isMob);
    $('at2-resize-wrap').classList.toggle('hidden', isMob);
    $('skin-item-size').value = section === 'npcs' ? 256 : 96;
    const tip = $('at2-nb-tip');
    tip.textContent = NB_TIPS[section];
    tip.classList.remove('hidden');
    document.querySelectorAll('#at2-sections .at2-sec').forEach(b =>
      b.classList.toggle('active', b.dataset.sec === section));
  }

  // ============================================================
  //             IMPORT & CONTRÔLE (étape 3)
  // ============================================================

  function stopAnim() { cancelAnimationFrame(animRAF); animRAF = 0; $('at2-anim-play').textContent = '▶'; }

  function drawAnchoredFrame(ctx, img, x, y, w, h, ax2, ay2, size) {
    // dessine la frame à l'échelle « contain », l'ancrage posé à 8 px du bas
    ctx.clearRect(0, 0, size, size);
    const s = Math.min(size / w, (size - 8) / h, 2);
    const dx = size / 2 - ax2 * s, dy = size - 8 - ay2 * s;
    ctx.imageSmoothingEnabled = s < 1;
    ctx.drawImage(img, x, y, w, h, dx, dy, w * s, h * s);
  }

  function startAnim(self) {
    stopAnim();
    if (!procCanvas || section !== 'mobs') return;
    let anims = {};
    try { anims = JSON.parse($('skin-enemy-anims').value); } catch { return; }
    const name = $('at2-anim-name').value || 'stance';
    const a = anims[name]; if (!a) return;
    const cw = parseInt($('skin-cell-w').value, 10) || 128;
    const ch = parseInt($('skin-cell-h').value, 10) || 128;
    const ax = parseInt($('skin-anchor-x').value, 10) || 64;
    const ay = parseInt($('skin-anchor-y').value, 10) || ch - 16;
    const nctx = $('at2-anim').getContext('2d');
    const octx = $('at2-anim-old').getContext('2d');
    const oldEntry = manifest?.enemies?.[MOBS[selId]?.sprite];
    const oldAnim = oldEntry?.anims?.[name] || oldEntry?.anims?.stance;
    const oldImg = new Image();
    let oldReady = false;
    if (oldEntry) { oldImg.onload = () => { oldReady = true; }; oldImg.src = '/assets/' + oldEntry.image; }
    const nFrames = Math.max(1, (a.to | 0) - (a.from | 0) + 1);
    const t0 = performance.now();
    $('at2-anim-play').textContent = '⏸';
    const loop = (t) => {
      const dir = parseInt($('at2-anim-dir').value, 10) || 0;
      const f = Math.floor((t - t0) / ((a.duration || 800) / nFrames)) % nFrames;
      const col = Math.min((a.from | 0) + f, procCols - 1);
      drawAnchoredFrame(nctx, procCanvas, col * cw, dir * ch, cw, ch, ax, ay, 128);
      if (oldReady && oldAnim) {
        const ofr = oldAnim.fr?.[String(dir)];
        if (ofr && ofr.length) {
          const [x, y, w, h, ox, oy] = ofr[f % ofr.length];
          drawAnchoredFrame(octx, oldImg, x, y, w, h, ox, oy, 128);
        }
      }
      animRAF = requestAnimationFrame(loop);
    };
    animRAF = requestAnimationFrame(loop);
  }

  // repasse le fichier déposé dans le pipeline (chroma / regrid / resize)
  // et rafraîchit tout le bloc de contrôle
  async function processFile(self) {
    if (!curFile || !selId) return;
    stopAnim();
    procNote = ''; procCols = 0;
    try {
      if (section === 'mobs') {
        const cfgAnims = JSON.parse($('skin-enemy-anims').value);
        const declared = Math.max(0, ...Object.values(cfgAnims).map(a => (a.to | 0) + 1));
        const cw = parseInt($('skin-cell-w').value, 10), ch = parseInt($('skin-cell-h').value, 10);
        const ax = parseInt($('skin-anchor-x').value, 10), ay = parseInt($('skin-anchor-y').value, 10);
        if ($('skin-realign').checked) {
          const native = await prepareImage(curFile, {});
          const grid = regridSheet(native.canvas, cw, ch, ax, ay);
          if (grid) {
            procCanvas = grid.canvas; procCols = grid.cols;
            if (grid.cols !== declared) procNote = `⚠ grille réelle : ${grid.cols} colonnes (${declared} déclarées)`;
          } else {
            const prep = await prepareImage(curFile, { targetW: declared * cw, targetH: 8 * ch, mode: 'stretch' });
            procCanvas = realignSheet(prep.canvas, cw, ch, ax, ay);
            procCols = declared;
          }
        } else {
          const prep = await prepareImage(curFile, { targetW: declared * cw, targetH: 8 * ch, mode: 'stretch' });
          procCanvas = prep.canvas;
          procCols = declared;
        }
        // aperçu : planche + grille + croix d'ancrage
        const pv = $('at2-preview');
        const scale = Math.min(1, 640 / procCanvas.width);
        pv.width = Math.round(procCanvas.width * scale);
        pv.height = Math.round(procCanvas.height * scale);
        const ctx = pv.getContext('2d');
        ctx.drawImage(procCanvas, 0, 0, pv.width, pv.height);
        ctx.strokeStyle = 'rgba(122,90,200,.8)';
        for (let c = 0; c <= procCols; c++) { ctx.beginPath(); ctx.moveTo(c * cw * scale, 0); ctx.lineTo(c * cw * scale, pv.height); ctx.stroke(); }
        for (let r = 0; r <= 8; r++) { ctx.beginPath(); ctx.moveTo(0, r * ch * scale); ctx.lineTo(pv.width, r * ch * scale); ctx.stroke(); }
        ctx.strokeStyle = 'rgba(255,210,74,.9)';
        for (let r = 0; r < 8; r++) for (let c = 0; c < procCols; c++) {
          const x = (c * cw + ax) * scale, y = (r * ch + ay) * scale;
          ctx.beginPath(); ctx.moveTo(x - 4, y); ctx.lineTo(x + 4, y); ctx.moveTo(x, y - 4); ctx.lineTo(x, y + 4); ctx.stroke();
        }
        // lecteur : liste des animations déclarées
        $('at2-anim-name').innerHTML = Object.keys(cfgAnims).map(n => `<option>${n}</option>`).join('');
        $('at2-animbox').classList.remove('hidden');
        $('at2-iconbox').classList.add('hidden');
        startAnim(self);
      } else {
        const size = parseInt($('skin-item-size').value, 10) || 96;
        const { canvas } = await prepareImage(curFile, { targetW: size, targetH: size, mode: 'contain' });
        procCanvas = canvas;
        const url = canvas.toDataURL();
        for (const id of ['at2-icon-96', 'at2-icon-34', 'at2-icon-22']) $(id).src = url;
        const pv = $('at2-preview');
        pv.width = canvas.width; pv.height = canvas.height;
        pv.getContext('2d').drawImage(canvas, 0, 0);
        $('at2-iconbox').classList.remove('hidden');
        $('at2-animbox').classList.add('hidden');
      }
      $('at2-check').classList.remove('hidden');
      $('skins-msg').textContent = procNote;
    } catch (e) {
      $('skins-msg').textContent = '✘ ' + e.message;
    }
  }

  return {
    async loadSkins() {
      try {
        const r = await api('/api/admin/skins');
        skinFiles = r.files;
        skinSprites = r.sprites;
        skinMap = {
          items: r.map?.items || {}, mobs: r.map?.mobs || {},
          spells: r.map?.spells || {}, npcs: r.map?.npcs || {},
        };
        spellList = r.spells || [];
        npcList = r.npcs || [];
        descMap = r.desc || {};
      } catch (e) { $('skins-msg').textContent = '✘ ' + e.message; return; }
      try { manifest = await (await fetch('/assets/manifest.json')).json(); } catch { manifest = null; }
      refreshTypeUI();
      renderList(this);
    },

    setSection(s) {
      if (section === s) return;
      section = s; selId = null; curFile = null; procCanvas = null;
      stopAnim();
      $('at2-check').classList.add('hidden');
      refreshTypeUI();
      renderList(this);
      renderCard();
    },

    renderList() { renderList(this); },

    async selectEntity(id) {
      selId = id;
      renderList(this);
      await renderCard();
      if (curFile) processFile(this);
    },

    async saveDesc() {
      if (!selId) return;
      const k = `${section}:${selId}`;
      const v = $('at2-desc').value.trim();
      if (v) descMap[k] = v; else delete descMap[k];
      try {
        await api('/api/admin/atelier', 'PUT', { desc: descMap });
        $('at2-desc-msg').textContent = '✔ fiche enregistrée';
      } catch (e) { $('at2-desc-msg').textContent = '✘ ' + e.message; }
    },

    buildPrompt() {
      if (!selId) { $('skins-msg').textContent = '✘ Sélectionne d\u2019abord une cible (étape ①).'; return; }
      const text = section === 'mobs' ? promptMob()
        : section === 'items' ? promptItem()
        : section === 'spells' ? promptSpell()
        : promptNpc();
      $('skin-prompt').value = text;
      navigator.clipboard?.writeText(text).then(
        () => { $('skin-prompt-msg').textContent = '✔ copié dans le presse-papier'; },
        () => { $('skin-prompt-msg').textContent = ''; });
      pushHistory(`${SECTIONS[section].label} · ${entityName()}`, text);
    },

    copyPrompt() {
      const t = $('skin-prompt').value;
      if (t) navigator.clipboard?.writeText(t).then(() => { $('skin-prompt-msg').textContent = '✔ copié'; });
    },

    refreshPreview() { processFile(this); },
    toggleAnim() { if (animRAF) stopAnim(); else startAnim(this); },

    async importCurrent() {
      if (!curFile || !selId || !procCanvas) return;
      try {
        if (section === 'mobs') {
          const cfg = {
            name: selId,
            cell: [parseInt($('skin-cell-w').value, 10), parseInt($('skin-cell-h').value, 10)],
            anchor: [parseInt($('skin-anchor-x').value, 10), parseInt($('skin-anchor-y').value, 10)],
            anims: JSON.parse($('skin-enemy-anims').value),
          };
          // borne les plages aux colonnes réellement produites par le pipeline
          for (const a of Object.values(cfg.anims)) {
            a.from = Math.min(a.from | 0, procCols - 1);
            a.to = Math.min(a.to | 0, procCols - 1);
          }
          const data = procCanvas.toDataURL('image/png').split(',')[1];
          const r = await api('/api/admin/skins/enemy', 'POST', { cfg, data });
          skinMap.mobs[selId] = r.sprite;
          $('skins-msg').textContent = `✔ Planche « ${r.sprite} » ${r.existed ? 'remplacée' : 'importée'} et assignée — Enregistrer les assignations pour publier. ${procNote}`;
        } else {
          const data = procCanvas.toDataURL('image/png').split(',')[1];
          const r = await api('/api/admin/skins/upload', 'POST', { name: `${SECTIONS[section].label}_${selId}`, data });
          skinMap[section][selId] = r.file;
          $('skins-msg').textContent = `✔ ${r.file} téléversé et assigné — Enregistrer les assignations pour publier.`;
        }
        await this.loadSkins();
        this.selectEntity(selId);
      } catch (e) { $('skins-msg').textContent = '✘ ' + e.message; }
    },

    async saveSkins() {
      try {
        const r = await api('/api/admin/skins', 'PUT', skinMap);
        const n = ['items', 'mobs', 'spells', 'npcs'].map(s => Object.keys(skinMap[s]).length);
        $('skins-msg').textContent = `✔ Enregistré : ${n[0]} objet(s), ${n[1]} créature(s), ${n[2]} sort(s), ${n[3]} PNJ. ` + (r.note || '');
      } catch (e) { $('skins-msg').textContent = '✘ ' + e.message; }
    },

    init() {
      setTimeout(() => {
        this.loadSkins();
        renderHistory();
        // dépôt de fichier : clic ou glisser-déposer
        const drop = $('at2-drop'), file = $('at2-file');
        drop.onclick = () => file.click();
        file.onchange = () => { if (file.files[0]) { curFile = file.files[0]; processFile(this); } };
        drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('border-t4c-button-active'); };
        drop.ondragleave = () => drop.classList.remove('border-t4c-button-active');
        drop.ondrop = (e) => {
          e.preventDefault();
          drop.classList.remove('border-t4c-button-active');
          const f = e.dataTransfer.files?.[0];
          if (f) { curFile = f; processFile(this); }
        };
        // les paramètres de planche influent sur l'aperçu
        for (const id of ['skin-cell-w', 'skin-cell-h', 'skin-anchor-x', 'skin-anchor-y', 'skin-enemy-anims', 'skin-chroma', 'skin-chroma-color', 'skin-realign', 'skin-resize', 'skin-item-size']) {
          $(id).onchange = () => processFile(this);
        }
      }, 0);
    },
  };
}
