// Interface d'administration : connexion, onglets, musiques, skins, contenu
// JSON, personnages, panthéon. L'éditeur de carte vit dans admin/editor.js
// (+ admin/palette.js pour la base graphique).
import { initMapEditor } from './admin/editor.js';
import { ITEMS, MOBS } from '../shared/defs.js';

const $ = (id) => document.getElementById(id);
let token = localStorage.getItem('t4c_admin_token') || null;

const api = async (url, method = 'GET', body = null) => {
  const r = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : null,
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || r.status);
  return j;
};

// ---------- Connexion ----------
$('adm-login').onclick = async () => {
  try {
    const r = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: $('adm-name').value.trim(), pass: $('adm-pass').value }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error);
    token = j.token;
    localStorage.setItem('t4c_admin_token', token);
    enter(j.name);
  } catch (e) { $('adm-error').textContent = e.message; }
};

let zonesDef = [];

async function enter(name) {
  $('login-box').style.display = 'none';
  $('panel').style.display = 'block';
  $('who').textContent = name ? `connecté : ${name}` : '';
  const zonesContent = await api('/api/admin/content/zones');
  zonesDef = zonesContent.zones;
  // la liste des sorts alimente la fiche PNJ de l'éditeur (rôle enseignant)
  let spells = [];
  try { spells = (await api('/api/admin/content/spells')).spells || []; } catch { /* optionnel */ }
  await initMapEditor({ api, zones: zonesDef, npcDefs: zonesContent.npc || {}, spells });
  loadMusic();
  loadSkins();
  loadChars();
  loadPantheon();
}

// ---------- Skins : images d'objets et planches de créatures fournies ----------
let skinFiles = [];   // PNG déposés (client/assets/skins/)
let skinSprites = []; // planches du manifest (créatures)
let skinMap = { items: {}, mobs: {} };

const fileToBase64 = (file) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).split(',')[1]); // retire le préfixe dataURL
  r.onerror = rej;
  r.readAsDataURL(file);
});

// ---- Préparation à l'import : détourage chroma + redimensionnement ----
const loadImageFile = (file) => new Promise((res, rej) => {
  const img = new Image();
  img.onload = () => res(img);
  img.onerror = () => rej(new Error('image illisible'));
  img.src = URL.createObjectURL(file);
});

// rend transparent tout pixel proche de la couleur de fond (bords adoucis)
function chromaKey(ctx, w, h, hex, tol) {
  const r0 = parseInt(hex.slice(1, 3), 16), g0 = parseInt(hex.slice(3, 5), 16), b0 = parseInt(hex.slice(5, 7), 16);
  const d = ctx.getImageData(0, 0, w, h);
  const px = d.data;
  const soft = tol * 1.55; // zone de transition : alpha progressif
  for (let i = 0; i < px.length; i += 4) {
    const dr = px[i] - r0, dg = px[i + 1] - g0, db = px[i + 2] - b0;
    const dist = Math.sqrt(dr * dr + dg * dg + db * db);
    if (dist < tol) px[i + 3] = 0;
    else if (dist < soft) px[i + 3] = Math.min(px[i + 3], Math.round(((dist - tol) / (soft - tol)) * 255));
  }
  ctx.putImageData(d, 0, 0);
}

// Pipeline : chroma à PLEINE résolution (détourage propre), puis resize.
// mode 'contain' (objets : tient dans la cible, centré) ou 'stretch'
// (planches : la grille doit tomber juste ; le ratio étant respecté par
// l'IA, la déformation est négligeable). Retourne du PNG en base64.
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

async function loadSkins() {
  try {
    const r = await api('/api/admin/skins');
    skinFiles = r.files;
    skinSprites = r.sprites;
    skinMap = { items: r.map?.items || {}, mobs: r.map?.mobs || {} };
  } catch (e) { $('skins-msg').textContent = '✘ ' + e.message; return; }
  renderSkinItems();
  renderSkinMobs();
}

// table objets : assignés d'abord, puis résultats du filtre (liste bornée)
function renderSkinItems() {
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
}

function renderSkinMobs() {
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
      $('skin-enemy-name').value = id; // pré-remplit l'import : sprite nommé comme la créature
      showPrompt(enemyPrompt(def.name, flavor));
    };
    tdEye.append(eye, pr);
    tr.append(tdName, tdSel, tdEye);
    tbl.appendChild(tr);
  }
}

$('skin-item-search').oninput = renderSkinItems;
$('skin-mob-search').oninput = renderSkinMobs;

// ---------- Prompts pour IA générative (specs alignées sur l'outil d'import) ----------
const STYLE_COMMUN = `Style : sprite de RPG isométrique 2D rétro (à la Diablo 1 / Flare), vue 3/4
plongeante, pixel-art peint aux couleurs riches mais palette sobre et désaturée,
éclairage doux venant du haut-gauche. Pas de texte, pas de cadre, pas de filigrane.`;

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
  }).join('\n');
  const bg = $('skin-chroma-color').value.toUpperCase();
  return `Génère une PLANCHE DE SPRITES (sprite sheet) d'une créature pour un jeu vidéo RPG
isométrique médiéval-fantastique.

Créature : ${name}.${flavor ? `\n${flavor}` : ''}

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
  de haut en bas : 1) ouest (profil gauche), 2) nord-ouest (dos 3/4 gauche), 3) nord (dos),
  4) nord-est (dos 3/4 droit), 5) est (profil droit), 6) sud-est (face 3/4 droite),
  7) sud (face caméra), 8) sud-ouest (face 3/4 gauche) ;
- chaque COLONNE est une frame d'animation :
${animLines}
- la créature garde la MÊME taille, le même style et la même palette dans toutes les cases ;
- dans chaque case, les pieds (point de contact au sol) sont au pixel (${ax}, ${ay})
  mesuré depuis le coin haut-gauche de la case — position stable d'une frame à l'autre ;
- pas d'ombre portée (le fond doit rester du vert pur autour de la créature).

${STYLE_COMMUN}
Caméra identique à un sprite vu de 3/4 haut : on voit le dessus et un côté de la créature.`;
}

$('skin-enemy-prompt').onclick = () => showPrompt(enemyPrompt());
$('skin-prompt-copy').onclick = () => {
  const t = $('skin-prompt').value;
  if (t) navigator.clipboard?.writeText(t).then(() => { $('skin-prompt-msg').textContent = '✔ copié'; });
};

$('skin-item-upload').onclick = async () => {
  const f = $('skin-item-file').files[0];
  if (!f) { $('skins-msg').textContent = '✘ Choisissez un fichier image.'; return; }
  try {
    const size = parseInt($('skin-item-size').value, 10) || 96;
    const { data, canvas } = await prepareImage(f, { targetW: size, targetH: size, mode: 'contain' });
    const r = await api('/api/admin/skins/upload', 'POST', { name: f.name, data });
    $('skins-msg').textContent = `✔ ${r.file} téléversé (${canvas.width}×${canvas.height}) — assignez-le à un objet ci-contre.`;
    skinPreview(canvas.toDataURL());
    await loadSkins();
  } catch (e) { $('skins-msg').textContent = '✘ ' + e.message; }
};

$('skin-enemy-upload').onclick = async () => {
  const f = $('skin-enemy-file').files[0];
  if (!f) { $('skins-msg').textContent = '✘ Choisissez la planche.'; return; }
  try {
    const cfg = {
      name: $('skin-enemy-name').value.trim(),
      cell: [parseInt($('skin-cell-w').value, 10), parseInt($('skin-cell-h').value, 10)],
      anchor: [parseInt($('skin-anchor-x').value, 10), parseInt($('skin-anchor-y').value, 10)],
      anims: JSON.parse($('skin-enemy-anims').value),
    };
    // taille EXACTE attendue par la grille : colonnes x case, 8 lignes
    const cols = Math.max(0, ...Object.values(cfg.anims).map(a => (a.to | 0) + 1));
    const { data, canvas } = await prepareImage(f, {
      targetW: cols * cfg.cell[0], targetH: 8 * cfg.cell[1], mode: 'stretch',
    });
    const r = await api('/api/admin/skins/enemy', 'POST', { cfg, data });
    $('skins-msg').textContent = `✔ Planche « ${r.sprite} » ${r.existed ? 'remplacée' : 'importée'} `
      + `(${canvas.width}×${canvas.height}, ${r.cols} colonnes, ${r.anims.join(', ')}) — assignez-la à une créature.`;
    skinPreview(canvas.toDataURL());
    await loadSkins();
  } catch (e) { $('skins-msg').textContent = '✘ ' + e.message; }
};

$('save-skins').onclick = async () => {
  try {
    const r = await api('/api/admin/skins', 'PUT', skinMap);
    $('skins-msg').textContent = '✔ Assignations enregistrées. ' + (r.note || '');
  } catch (e) { $('skins-msg').textContent = '✘ ' + e.message; }
};

// ---------- Musiques : correspondance zone -> fichier ----------
let musicMap = { login: null, trial: null, zones: {} };

async function loadMusic() {
  let files = [];
  try {
    const r = await api('/api/admin/music');
    files = r.files;
    musicMap = r.map || musicMap;
    if (!musicMap.zones) musicMap.zones = {};
  } catch (e) { $('music-msg').textContent = e.message; return; }

  const table = $('music-table');
  table.innerHTML = '<tr><th>Zone</th><th>Nouvelle musique (défaut joueurs)</th><th>Musique ancienne (legacy)</th></tr>';
  // chaque emplacement a deux variantes { legacy, new } : le joueur choisit
  // son pack dans ses paramètres, avec repli sur l'autre variante si vide
  const slotOf = (get) => {
    let s = get();
    if (s == null || typeof s === 'string') s = { legacy: s || null, new: null };
    return s;
  };
  const mkCell = (slot, variant) => {
    const td = document.createElement('td');
    td.style.whiteSpace = 'nowrap';
    const sel = document.createElement('select');
    sel.innerHTML = '<option value="">— silence —</option>' +
      files.map(f => `<option value="${f}"${slot[variant] === f ? ' selected' : ''}>${f}</option>`).join('');
    sel.onchange = () => { slot[variant] = sel.value || null; };
    const play = document.createElement('button');
    play.textContent = '▶';
    play.title = 'Pré-écouter';
    play.style.marginLeft = '6px';
    play.onclick = () => {
      if (!sel.value) return;
      const a = $('music-preview');
      a.src = `/assets/music/${encodeURIComponent(sel.value)}`;
      a.play();
    };
    td.append(sel, play);
    return td;
  };
  const mkRow = (label, getSlot, setSlot) => {
    const slot = slotOf(getSlot);
    setSlot(slot); // normalise dans musicMap (l'objet est partagé avec les selects)
    const tr = document.createElement('tr');
    const tdName = document.createElement('td');
    tdName.textContent = label;
    tr.append(tdName, mkCell(slot, 'new'), mkCell(slot, 'legacy'));
    table.appendChild(tr);
  };

  mkRow('Écran de connexion', () => musicMap.login, s => { musicMap.login = s; });
  mkRow("L'Épreuve", () => musicMap.trial, s => { musicMap.trial = s; });
  for (const z of zonesDef) {
    mkRow(`${z.id} — ${z.name} (${z.levels[0]}-${z.levels[1]})`,
      () => musicMap.zones[String(z.id)],
      s => { musicMap.zones[String(z.id)] = s; });
  }
}

$('reload-music').onclick = loadMusic;
$('save-music').onclick = async () => {
  try {
    await api('/api/admin/music', 'PUT', musicMap);
    $('music-msg').textContent = 'Enregistré — appliqué à chaud aux joueurs connectés.';
  } catch (e) { $('music-msg').textContent = 'Erreur : ' + e.message; }
};

// reprise de session
if (token) {
  api('/api/admin/pantheon').then(() => enter()).catch(() => { token = null; });
}

// ---------- Onglets ----------
document.querySelectorAll('.tabs button').forEach(b => {
  b.onclick = () => {
    document.querySelectorAll('.tabs button').forEach(x => x.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(x => x.classList.remove('visible'));
    b.classList.add('active');
    $('tab-' + b.dataset.tab).classList.add('visible');
  };
});

// ---------- Contenu JSON ----------
$('load-content').onclick = async () => {
  try {
    const data = await api(`/api/admin/content/${$('content-file').value}`);
    $('content-editor').value = JSON.stringify(data, null, 2);
    $('content-msg').textContent = 'Chargé.';
  } catch (e) { $('content-msg').textContent = '✘ ' + e.message; }
};
$('save-content').onclick = async () => {
  try {
    const data = JSON.parse($('content-editor').value);
    const r = await api(`/api/admin/content/${$('content-file').value}`, 'PUT', data);
    $('content-msg').textContent = '✔ Enregistré. ' + (r.note || '');
  } catch (e) { $('content-msg').textContent = '✘ ' + e.message; }
};

// ---------- Personnages ----------
async function loadChars() {
  try {
    const { characters } = await api('/api/admin/characters');
    const tbl = $('chars-table');
    tbl.innerHTML = '<tr><th>Compte</th><th>Perso</th><th>Niveau</th><th>Or</th><th>Zone</th><th>Drapeaux</th><th>Admin</th><th>En ligne</th><th>Actions</th></tr>';
    for (const c of characters) {
      const tr = document.createElement('tr');
      const lvl = document.createElement('input'); lvl.style.width = '54px'; lvl.value = c.char?.level ?? '';
      const gold = document.createElement('input'); gold.style.width = '90px'; gold.value = c.char?.gold ?? '';
      const zone = document.createElement('input'); zone.style.width = '40px'; zone.value = c.char?.zoneId ?? '';
      tr.innerHTML = `<td>${c.account}</td><td>${c.char?.name ?? '—'}</td>`;
      const tds = [lvl, gold, zone].map(el => { const td = document.createElement('td'); td.appendChild(el); return td; });
      tds.forEach(td => tr.appendChild(td));
      // drapeaux de quête posés par les dialogues de PNJ (lecture seule)
      const flags = Object.keys(c.char?.flags || {});
      const tdFlags = document.createElement('td');
      tdFlags.textContent = flags.length ? `${flags.length} ⚑` : '';
      tdFlags.title = flags.join('\n');
      tr.appendChild(tdFlags);
      tr.insertAdjacentHTML('beforeend', `<td>${c.isAdmin ? '✔' : ''}</td><td>${c.online ? '🟢' : ''}</td>`);
      const act = document.createElement('td');
      const apply = document.createElement('button');
      apply.textContent = 'Appliquer';
      apply.onclick = async () => {
        try {
          await api(`/api/admin/character/${c.accountId}`, 'PUT', {
            level: parseInt(lvl.value, 10), gold: parseInt(gold.value, 10), zoneId: parseInt(zone.value, 10),
          });
          $('chars-msg').textContent = `✔ ${c.account} mis à jour.`;
          loadChars();
        } catch (e) { $('chars-msg').textContent = '✘ ' + e.message; }
      };
      const del = document.createElement('button');
      del.textContent = 'Supprimer';
      del.className = 'danger';
      del.style.marginLeft = '6px';
      del.onclick = async () => {
        if (!confirm(`Supprimer définitivement le personnage de ${c.account} ?`)) return;
        await api(`/api/admin/character/${c.accountId}`, 'DELETE');
        loadChars();
      };
      act.appendChild(apply);
      if (c.char) act.appendChild(del);
      tr.appendChild(act);
      tbl.appendChild(tr);
    }
  } catch (e) { $('chars-msg').textContent = '✘ ' + e.message; }
}
$('reload-chars').onclick = loadChars;

// ---------- Panthéon ----------
async function loadPantheon() {
  try {
    const { deaths } = await api('/api/admin/pantheon');
    const tbl = $('pantheon-table');
    tbl.innerHTML = '<tr><th>Nom</th><th>Niveau</th><th>Zone</th><th>Tué par</th><th>Date</th></tr>' +
      deaths.map(d => `<tr><td>${d.name}</td><td>${d.level}</td><td>${d.zone}</td><td>${d.killer}</td>
        <td>${new Date(d.died_at).toLocaleString('fr-FR')}</td></tr>`).join('');
  } catch { /* silencieux */ }
}
