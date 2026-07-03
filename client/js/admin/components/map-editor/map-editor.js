import { initMapEditor } from '../../editor.js';

export function MapEditorController(api) {
  return {
    init() {
      // Use setTimeout to ensure the DOM is fully rendered before initializing the map editor
      setTimeout(async () => {
        try {
          console.log("MapEditor: Fetching zones data...");
          const zonesContent = await api('/api/admin/content/zones');
          console.log("MapEditor: Zones data fetched successfully:", zonesContent);
          
          console.log("MapEditor: Fetching NPCs...");
          const npcsContent = await api('/api/admin/content/npcs');
          console.log("MapEditor: NPCs fetched successfully:", npcsContent);

          const zonesDef = zonesContent.zones;
          console.log("MapEditor: Fetching spells...");
          const spells = (await api('/api/admin/content/spells')).spells || [];
          console.log("MapEditor: Spells fetched:", spells.length);

          console.log("MapEditor: Fetching skills...");
          const skills = (await api('/api/admin/content/skills')).skills || [];
          console.log("MapEditor: Skills fetched:", skills.length);
          
          console.log("MapEditor: Fetching music files...");
          const musicResp = await api('/api/admin/music');
          const musicFiles = musicResp.files || [];
          const musicGroups = Object.keys(musicResp.map?.groups || {}); // ids des groupes réutilisables
          console.log("MapEditor: Music files fetched:", musicFiles.length, "groups:", musicGroups.length);

          console.log("MapEditor: Initializing map editor with zones:", zonesDef);
          // Now, initialize the map editor
          await initMapEditor({
            api,
            zones: zonesDef,
            npcDefs: npcsContent.npc || {},
            spells,
            skills,
            musicFiles,
            musicGroups
          });
          console.log("MapEditor: Map editor initialized successfully.");
        } catch (e) {
          console.error("MapEditor: Failed to initialize:", e);
          const msgEl = document.getElementById('map-msg');
          if (msgEl) {
            msgEl.textContent = '✘ Failed to initialize map editor: ' + e.message;
          }
        }
      }, 0);
    }
  };
}
