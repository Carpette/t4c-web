// Interface d'administration : éditeur de cartes (vue du dessus), contenu JSON,
// personnages, panthéon.
import { generateWorld, TILE } from '../shared/worldgen.js';
import { applyOverrides } from '../shared/overrides.js';

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

async function enter(name) {
  $('login-box').style.display = 'none';
  $('panel').style.display = 'block';
  $('who').textContent = name ? `connecté : ${name}` : '';
  await initMap();
  loadMusic();
  loadChars();
  loadPantheon();
}

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

// ---------- Éditeur de carte ----------
const TILE_COLORS = {
  [TILE.WATER]: '#2a4a66', [TILE.SAND]: '#d8c890', [TILE.GRASS]: '#55844a',
  [TILE.FOREST]: '#3a6435', [TILE.ROCK]: '#7d7d7a', [TILE.COBBLE]: '#9a9590',
  [TILE.PATH]: '#9a8560', [TILE.GRAVE]: '#6a5f52',
};
const TILE_NAMES = {
  [TILE.GRASS]: 'herbe', [TILE.FOREST]: 'forêt', [TILE.PATH]: 'chemin', [TILE.COBBLE]: 'pavés',
  [TILE.SAND]: 'terre', [TILE.GRAVE]: 'cimetière', [TILE.ROCK]: 'roche (bloquant)', [TILE.WATER]: 'eau (bloquant)',
};
const PROP_GLYPHS = {
  tree: ['🌲', '#7ac87a'], rock: ['●', '#aaa'], house: ['⌂', '#e8c890'], torch: ['✶', '#ffaa33'],
  grave: ['✝', '#ccc'], well: ['◎', '#9ad'], obelisk: ['▲', '#9af'], trialgate: ['◈', '#c9f'], exitgate: ['◈', '#9fd'],
  bank: ['▣', '#fc6'], chest: ['▢', '#fa0'], cave: ['Ω', '#ff6'],
  wall: ['▮', '#ca8'], fence: ['╪', '#b97'], ruin: ['⌐', '#987'], bridge: ['≡', '#a86'],
};

let zonesDef = [];
let curZone = 0;
let baseWorld = null;   // monde regénéré sans overrides
let world = null;       // monde avec overrides appliqués
let ov = { tiles: [], props: { add: [], remove: [] } };
let tool = { kind: 'tile', tile: TILE.GRASS };
let SCALE = 6; // recalculé par zone : 6 px/tuile en 128, 2 px/tuile en 384 (Arakas)
const canvas = $('map-canvas');
const ctx = canvas.getContext('2d');

async function initMap() {
  const zc = await api('/api/admin/content/zones');
  zonesDef = zc.zones;
  const sel = $('map-zone');
  sel.innerHTML = zonesDef.map(z => `<option value="${z.id}">${z.id} — ${z.name} (${z.levels[0]}-${z.levels[1]})</option>`).join('');
  sel.onchange = () => loadZone(parseInt(sel.value, 10));

  // palette d'outils
  const tools = $('map-tools');
  tools.innerHTML = '';
  for (const t of [TILE.GRASS, TILE.FOREST, TILE.PATH, TILE.COBBLE, TILE.SAND, TILE.GRAVE, TILE.ROCK, TILE.WATER]) {
    const sw = document.createElement('div');
    sw.className = 'swatch' + (tool.kind === 'tile' && tool.tile === t ? ' active' : '');
    sw.style.background = TILE_COLORS[t];
    sw.title = TILE_NAMES[t];
    sw.onclick = () => { tool = { kind: 'tile', tile: t }; refreshToolbar(); };
    tools.appendChild(sw);
  }
  const addBtn = document.createElement('button');
  addBtn.textContent = '+ décor';
  addBtn.dataset.tool = 'addprop';
  addBtn.onclick = () => { tool = { kind: 'addprop' }; refreshToolbar(); };
  const delBtn = document.createElement('button');
  delBtn.textContent = '− décor';
  delBtn.dataset.tool = 'delprop';
  delBtn.onclick = () => { tool = { kind: 'delprop' }; refreshToolbar(); };
  tools.appendChild(addBtn);
  tools.appendChild(delBtn);

  function refreshToolbar() {
    tools.querySelectorAll('.swatch').forEach((sw, i) => {
      const t = [TILE.GRASS, TILE.FOREST, TILE.PATH, TILE.COBBLE, TILE.SAND, TILE.GRAVE, TILE.ROCK, TILE.WATER][i];
      sw.classList.toggle('active', tool.kind === 'tile' && tool.tile === t);
    });
    addBtn.classList.toggle('active', tool.kind === 'addprop');
    delBtn.classList.toggle('active', tool.kind === 'delprop');
  }

  $('save-map').onclick = async () => {
    try {
      await api(`/api/admin/overrides/${curZone}`, 'PUT', ov);
      $('map-msg').textContent = '✔ Enregistré et appliqué au serveur.';
    } catch (e) { $('map-msg').textContent = '✘ ' + e.message; }
  };
  $('reset-map').onclick = async () => {
    if (!confirm('Effacer toutes les modifications de cette zone ?')) return;
    ov = { tiles: [], props: { add: [], remove: [] } };
    await api(`/api/admin/overrides/${curZone}`, 'PUT', ov);
    loadZone(curZone);
  };

  // peinture
  let painting = false;
  canvas.addEventListener('pointerdown', (e) => { painting = true; paint(e); });
  canvas.addEventListener('pointermove', (e) => { if (painting && tool.kind === 'tile') paint(e); });
  window.addEventListener('pointerup', () => { painting = false; });

  await loadZone(0);
}

function cellOf(e) {
  const r = canvas.getBoundingClientRect();
  return {
    x: Math.floor((e.clientX - r.left) / SCALE),
    z: Math.floor((e.clientY - r.top) / SCALE),
  };
}

function paint(e) {
  const { x, z } = cellOf(e);
  if (x < 0 || z < 0 || x >= world.size || z >= world.size) return;
  if (tool.kind === 'tile') {
    ov.tiles = ov.tiles.filter(([tx, tz]) => tx !== x || tz !== z);
    ov.tiles.push([x, z, tool.tile]);
  } else if (tool.kind === 'addprop') {
    ov.props.add.push({ type: $('prop-type').value, x, z });
  } else if (tool.kind === 'delprop') {
    // si on supprime un prop qu'on venait d'ajouter, on retire l'ajout
    const before = ov.props.add.length;
    ov.props.add = ov.props.add.filter(p => Math.hypot(p.x - x, p.z - z) >= 1);
    if (ov.props.add.length === before) ov.props.remove.push([x, z]);
  }
  rebuild();
}

function rebuild() {
  world = applyOverrides(structuredClone(baseWorld), ov);
  drawMap();
}

async function loadZone(id) {
  curZone = id;
  $('map-msg').textContent = 'Génération de la carte…';
  await new Promise(r => setTimeout(r, 20));
  const def = zonesDef.find(z => z.id === id);
  const w = generateWorld(def.seed, def.map);
  SCALE = Math.max(1, Math.floor(768 / w.size));
  // structuredClone ne passe pas les fonctions : on garde un objet simple
  baseWorld = { size: w.size, tile: w.tile, walk: w.walk, props: w.props, height: w.height };
  try { ov = await api(`/api/admin/overrides/${id}`); } catch { ov = { tiles: [], props: { add: [], remove: [] } }; }
  if (!ov.props) ov.props = { add: [], remove: [] };
  rebuild();
  $('map-msg').textContent = '';
}

function drawMap() {
  const N = world.size;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      ctx.fillStyle = TILE_COLORS[world.tile[z * N + x]] || '#f0f';
      ctx.fillRect(x * SCALE, z * SCALE, SCALE, SCALE);
    }
  }
  // décors
  ctx.font = `${SCALE + 3}px sans-serif`;
  ctx.textAlign = 'center';
  for (const p of world.props) {
    const [glyph, color] = PROP_GLYPHS[p.type] || ['?', '#fff'];
    ctx.fillStyle = color;
    ctx.fillText(glyph, p.x * SCALE, p.z * SCALE + SCALE * 0.8);
  }
}

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
    tbl.innerHTML = '<tr><th>Compte</th><th>Perso</th><th>Niveau</th><th>Or</th><th>Zone</th><th>Admin</th><th>En ligne</th><th>Actions</th></tr>';
    for (const c of characters) {
      const tr = document.createElement('tr');
      const lvl = document.createElement('input'); lvl.style.width = '54px'; lvl.value = c.char?.level ?? '';
      const gold = document.createElement('input'); gold.style.width = '90px'; gold.value = c.char?.gold ?? '';
      const zone = document.createElement('input'); zone.style.width = '40px'; zone.value = c.char?.zoneId ?? '';
      tr.innerHTML = `<td>${c.account}</td><td>${c.char?.name ?? '—'}</td>`;
      const tds = [lvl, gold, zone].map(el => { const td = document.createElement('td'); td.appendChild(el); return td; });
      tds.forEach(td => tr.appendChild(td));
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
