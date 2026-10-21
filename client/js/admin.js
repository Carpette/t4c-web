// Interface d'administration : connexion, onglets, musiques, skins, contenu
// JSON, personnages, panthéon. L'éditeur de carte vit dans admin/editor.js
// (+ admin/palette.js pour la base graphique).
import { initMapEditor } from './admin/editor.js';
import { ITEMS, MOBS } from '../shared/defs.js';
import { GuiManagerAdmin } from './admin/gui-manager-admin.js';
import { chargerSurcharges } from './surcharges.js';
import { activerColonnes } from './admin/colonnes.js';
import { ConsoleController } from './admin/components/console/console.js';
import { PageController } from './admin/components/page/page.js';
import { ContentController } from './admin/components/content/content.js';
import { SpellsEditorController } from './admin/components/spells-editor/spells-editor.js';
import { SpellsTableController } from './admin/components/spells-table/spells-table.js';
import { NpcsEditorController } from './admin/components/npcs-editor/npcs-editor.js';
import { ParticleEditorController } from './admin/components/particle-editor/particle-editor.js';
import { MusicsController } from './admin/components/musics/musics.js';
import { SkinsController } from './admin/components/skins/skins.js';
import { MaterialsController } from './admin/components/materials/materials.js';
import { Atelier3DController } from './admin/components/atelier3d/atelier3d.js';
import { CharactersController } from './admin/components/characters/characters.js';
import { AccessController } from './admin/components/access/access.js';
import { CreaturesController } from './admin/components/creatures/creatures.js';
import { ObjetsController } from './admin/components/objets/objets.js';
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
  await chargerSurcharges(); // créatures / objets de la Forge, avant les écrans qui les listent
  $('login-box').style.display = 'none';
  $('panel').style.display = 'grid';

  console.log("admin.js: Registering controllers...");
  guiManagerAdmin.registerController('console', ConsoleController);
  guiManagerAdmin.registerController('page', PageController);
  guiManagerAdmin.registerController('content', ContentController);
  guiManagerAdmin.registerController('spells-editor', SpellsEditorController);
  guiManagerAdmin.registerController('spells-table', SpellsTableController);
  guiManagerAdmin.registerController('npcs-editor', NpcsEditorController);
  guiManagerAdmin.registerController('particle-editor', ParticleEditorController);
  guiManagerAdmin.registerController('musics', MusicsController);
  guiManagerAdmin.registerController('skins', SkinsController);
  guiManagerAdmin.registerController('materials', MaterialsController);
  guiManagerAdmin.registerController('atelier3d', Atelier3DController);
  guiManagerAdmin.registerController('characters', CharactersController);
  guiManagerAdmin.registerController('access', AccessController);
  guiManagerAdmin.registerController('pantheon', PantheonController);
  guiManagerAdmin.registerController('creatures', CreaturesController);
  guiManagerAdmin.registerController('objets', ObjetsController);
  guiManagerAdmin.registerController('map-editor', MapEditorController);

  console.log("admin.js: Initializing components...");
  await guiManagerAdmin.init([
    { name: 'console', selector: '#console-shell' },
    { name: 'page', selector: '#page' },
    { name: 'map-editor', selector: '#tab-map' },
    { name: 'content', selector: '#tab-content' },
    { name: 'spells-editor', selector: '#tab-spells-editor' },
    { name: 'spells-table', selector: '#tab-spells-table' },
    { name: 'npcs-editor', selector: '#tab-npcs-editor' },
    { name: 'particle-editor', selector: '#tab-particle-editor' },
    { name: 'musics', selector: '#tab-music' },
    { name: 'skins', selector: '#tab-skins' },
    { name: 'materials', selector: '#tab-materials' },
    { name: 'atelier3d', selector: '#tab-atelier3d' },
    { name: 'characters', selector: '#tab-chars' },
    { name: 'access', selector: '#tab-access' },
    { name: 'pantheon', selector: '#tab-pantheon' },
    { name: 'creatures', selector: '#tab-creatures' },
    { name: 'objets', selector: '#tab-objets' }
  ]);
  activerColonnes(); // colonnes redimensionnables, largeurs mémorisées dans le navigateur
  console.log("admin.js: Components initialization complete.");
}





// ---------- Déconnexion ----------
// Le bouton vit dans la coque (composant console), monté après coup : délégation au
// document. Invalidation serveur en meilleur effort, purge locale TOUJOURS,
// puis rechargement -> retour à l'écran de connexion.
document.addEventListener('click', async (e) => {
  if (e.target?.id !== 'logout-button' && !e.target?.closest?.('#logout-button')) return;
  try { await api('/api/admin/logout', 'POST'); } catch { /* déjà expiré : peu importe */ }
  localStorage.removeItem('t4c_admin_token');
  token = null;
  location.reload();
});

// reprise de session
if (token) {
  api('/api/admin/check-session').then(r => enter(r.name)).catch(() => {
    localStorage.removeItem('t4c_admin_token');
    token = null;
  });
}
