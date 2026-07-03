// Interface d'administration : connexion, onglets, musiques, skins, contenu
// JSON, personnages, panthéon. L'éditeur de carte vit dans admin/editor.js
// (+ admin/palette.js pour la base graphique).
import { initMapEditor } from './admin/editor.js';
import { ITEMS, MOBS } from '../shared/defs.js';
import { GuiManagerAdmin } from './admin/gui-manager-admin.js';
import { SidebarController } from './admin/components/sidebar/sidebar.js';
import { ContentController } from './admin/components/content/content.js';
import { SpellsEditorController } from './admin/components/spells-editor/spells-editor.js';
import { NpcsEditorController } from './admin/components/npcs-editor/npcs-editor.js';
import { ParticleEditorController } from './admin/components/particle-editor/particle-editor.js';
import { MusicsController } from './admin/components/musics/musics.js';
import { SkinsController } from './admin/components/skins/skins.js';
import { CharactersController } from './admin/components/characters/characters.js';
import { PantheonController } from './admin/components/pantheon/pantheon.js';
import { MapEditorController } from './admin/components/map-editor/map-editor.js';

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

console.log("admin.js: Script loaded and executing.");

const guiManagerAdmin = new GuiManagerAdmin(api);

// ---------- Connexion ----------
$('adm-login').onclick = async () => {
  console.log("admin.js: Login button clicked.");
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
    console.log("admin.js: Login successful, entering dashboard...");
    enter(j.name);
  } catch (e) { 
    console.error("admin.js: Login failed:", e);
    $('adm-error').textContent = e.message; 
  }
};

let zonesDef = [];

async function enter(name) {
  console.log("admin.js: enter() triggered for user:", name);
  $('login-box').style.display = 'none';
  $('panel').style.display = 'flex';

  console.log("admin.js: Registering controllers...");
  guiManagerAdmin.registerController('sidebar', SidebarController);
  guiManagerAdmin.registerController('content', ContentController);
  guiManagerAdmin.registerController('spells-editor', SpellsEditorController);
  guiManagerAdmin.registerController('npcs-editor', NpcsEditorController);
  guiManagerAdmin.registerController('particle-editor', ParticleEditorController);
  guiManagerAdmin.registerController('musics', MusicsController);
  guiManagerAdmin.registerController('skins', SkinsController);
  guiManagerAdmin.registerController('characters', CharactersController);
  guiManagerAdmin.registerController('pantheon', PantheonController);
  guiManagerAdmin.registerController('map-editor', MapEditorController);

  console.log("admin.js: Initializing components...");
  await guiManagerAdmin.init([
    { name: 'sidebar', selector: '#sidebar' },
    { name: 'map-editor', selector: '#tab-map' },
    { name: 'content', selector: '#tab-content' },
    { name: 'spells-editor', selector: '#tab-spells-editor' },
    { name: 'npcs-editor', selector: '#tab-npcs-editor' },
    { name: 'particle-editor', selector: '#tab-particle-editor' },
    { name: 'musics', selector: '#tab-music' },
    { name: 'skins', selector: '#tab-skins' },
    { name: 'characters', selector: '#tab-chars' },
    { name: 'pantheon', selector: '#tab-pantheon' }
  ]);
  console.log("admin.js: Components initialization complete.");

  const whoElement = document.querySelector('#who');
  if (whoElement) {
    whoElement.textContent = name ? `connecté : ${name}` : '';
  }
}





// reprise de session
if (token) {
  api('/api/admin/check-session').then(r => enter(r.name)).catch(() => {
    localStorage.removeItem('t4c_admin_token');
    token = null;
  });
}
