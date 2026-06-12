// Interface d'administration : connexion, onglets, musiques, contenu JSON,
// personnages, panthéon. L'éditeur de carte vit dans admin/editor.js
// (+ admin/palette.js pour la base graphique).
import { initMapEditor } from './admin/editor.js';

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
