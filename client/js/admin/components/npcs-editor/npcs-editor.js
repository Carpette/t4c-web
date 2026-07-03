console.log('[NpcsEditor] Reactive Script loaded.');
import { reactive } from '/js/vendor/petite-vue.js';

const store = reactive({
  // --- State ---
  api: null,
  rawData: null,
  npcs: {},
  spells: [],
  skills: [],
  activeNpcId: null,
  activeNpc: null,
  searchQuery: '',
  isNew: false,
  message: '',

  // --- Initialization ---
  init() {
    console.log('[NpcsEditor] init() called.');
    this.loadData();
  },

  async loadData() {
    try {
      // Load NPCs
      const npcsData = await this.api('/api/admin/content/npcs');
      this.rawData = npcsData;
      this.npcs = npcsData.npc || {};

      // Load Spells
      const spellsData = await this.api('/api/admin/content/spells');
      this.spells = spellsData.spells || [];

      // Load Skills
      const skillsData = await this.api('/api/admin/content/skills');
      this.skills = skillsData.skills || [];

      // Auto-select first NPC
      const npcIds = Object.keys(this.npcs);
      if (npcIds.length > 0 && !this.activeNpcId) {
        this.selectNpc(npcIds[0]);
      } else if (this.activeNpcId && this.npcs[this.activeNpcId]) {
        this.selectNpc(this.activeNpcId);
      }
    } catch (err) {
      console.error('Erreur au chargement des données PNJ:', err);
    }
  },

  // --- Selection & Actions ---
  selectNpc(id) {
    this.isNew = false;
    this.activeNpcId = id;
    this.activeNpc = JSON.parse(JSON.stringify(this.npcs[id]));
    
    // Ensure nested objects/arrays exist
    this.activeNpc.stats ||= { str: 10, end: 10, agi: 10, int: 10, wis: 10 };
    this.activeNpc.greetings ||= [];
    this.activeNpc.dialogues ||= [];
    this.activeNpc.teachesSpells ||= {};
    this.activeNpc.teachesSkills ||= {};
    this.activeNpc.level ||= 1;
    this.activeNpc.hp ||= 100;
  },

  createNewNpc() {
    this.isNew = true;
    this.activeNpcId = 'nouveau_pnj';
    this.activeNpc = {
      name: 'Nouveau PNJ',
      role: 'merchant',
      stats: { str: 10, end: 10, agi: 10, int: 10, wis: 10 },
      greetings: ['Bonjour !'],
      dialogues: [],
      teachesSpells: {},
      teachesSkills: {},
      level: 1,
      hp: 100
    };
  },

  // --- Dialogue Blocks ---
  addDialogueBlock() {
    this.activeNpc.dialogues.push({ keywords: [], reponse: '' });
  },

  removeDialogueBlock(index) {
    this.activeNpc.dialogues.splice(index, 1);
  },

  onDialogueKeywordsChange(index, value) {
    this.activeNpc.dialogues[index].keywords = value.split(',').map(s => s.trim()).filter(Boolean);
  },

  onDialogueJSONChange(index, field, value, event) {
    try {
      this.activeNpc.dialogues[index][field] = value.trim() ? JSON.parse(value) : undefined;
      event.target.style.borderColor = '';
    } catch {
      event.target.style.borderColor = '#ef4444';
    }
  },

  // --- Spells & Skills Toggle and cost updates ---
  isSpellTaught(spellId) {
    return this.activeNpc && this.activeNpc.teachesSpells && this.activeNpc.teachesSpells[spellId] !== undefined;
  },

  getSpellName(spellId) {
    const sp = this.spells.find(s => s.id === spellId);
    return sp ? sp.name : spellId;
  },

  addSpellToNpc(spellId) {
    if (!spellId) return;
    this.activeNpc.teachesSpells[spellId] = 100; // default cost
  },

  removeSpellFromNpc(spellId) {
    delete this.activeNpc.teachesSpells[spellId];
  },

  updateSpellPrice(spellId, value) {
    if (this.isSpellTaught(spellId)) {
      this.activeNpc.teachesSpells[spellId] = parseInt(value, 10) || 0;
    }
  },

  isSkillTaught(skillId) {
    return this.activeNpc && this.activeNpc.teachesSkills && this.activeNpc.teachesSkills[skillId] !== undefined;
  },

  getSkillName(skillId) {
    const sk = this.skills.find(s => s.id === skillId);
    return sk ? sk.name : skillId;
  },

  getSkillLearnCost(skillId) {
    if (this.isSkillTaught(skillId)) {
      return this.activeNpc.teachesSkills[skillId].learnCost || 0;
    }
    return 0;
  },

  getSkillTrainCost(skillId) {
    if (this.isSkillTaught(skillId)) {
      return this.activeNpc.teachesSkills[skillId].trainCost || 0;
    }
    return 0;
  },

  addSkillToNpc(skillId) {
    if (!skillId) return;
    this.activeNpc.teachesSkills[skillId] = { learnCost: 100, trainCost: 10 }; // default costs
  },

  removeSkillFromNpc(skillId) {
    delete this.activeNpc.teachesSkills[skillId];
  },

  updateSkillCost(skillId, field, value) {
    if (this.isSkillTaught(skillId)) {
      this.activeNpc.teachesSkills[skillId][field] = parseInt(value, 10) || 0;
    }
  },

  // --- Filtered lists for list search ---
  get filteredNpcIds() {
    const q = this.searchQuery.trim().toLowerCase();
    return Object.keys(this.npcs).filter(id => {
      if (!q) return true;
      const name = this.npcs[id].name || '';
      return id.toLowerCase().includes(q) || name.toLowerCase().includes(q);
    });
  },

  get availableSpells() {
    if (!this.activeNpc || !this.activeNpc.teachesSpells) return [];
    return this.spells.filter(sp => this.activeNpc.teachesSpells[sp.id] === undefined);
  },

  get availableSkills() {
    if (!this.activeNpc || !this.activeNpc.teachesSkills) return [];
    return this.skills.filter(sk => this.activeNpc.teachesSkills[sk.id] === undefined);
  },

  // --- Save / Delete NPC ---
  saveCurrentNpc() {
    const idField = document.getElementById('npc-id');
    const newId = idField ? idField.value.trim().toLowerCase() : '';
    if (!newId) {
      alert('Veuillez spécifier un identifiant unique (ID) pour ce PNJ.');
      return;
    }

    if (this.isNew && this.npcs[newId]) {
      alert(`L'identifiant PNJ "${newId}" est déjà utilisé. Veuillez en choisir un autre.`);
      return;
    }

    // Save greetings from textarea
    const greetArea = document.getElementById('npc-greetings');
    if (greetArea) {
      this.activeNpc.greetings = greetArea.value.split('\n').map(s => s.trim()).filter(Boolean);
    }

    if (this.isNew) {
      this.npcs[newId] = this.activeNpc;
      this.activeNpcId = newId;
      this.isNew = false;
    } else {
      this.npcs[this.activeNpcId] = this.activeNpc;
    }

    this.showFlashMessage('✔ Modifications appliquées localement. N\'oubliez pas d\'enregistrer le fichier !');
  },

  deleteCurrentNpc() {
    if (!this.activeNpcId || this.isNew) return;
    if (!confirm(`Voulez-vous vraiment supprimer le PNJ "${this.activeNpcId}" (${this.activeNpc?.name}) ?`)) return;

    delete this.npcs[this.activeNpcId];
    this.activeNpcId = null;
    this.activeNpc = null;

    const npcIds = Object.keys(this.npcs);
    if (npcIds.length > 0) {
      this.selectNpc(npcIds[0]);
    }

    this.showFlashMessage('✔ PNJ supprimé localement. Enregistrez le fichier pour persister la suppression.');
  },

  async saveFileToServer() {
    try {
      const payload = { npc: this.npcs };
      const resp = await this.api('/api/admin/content/npcs', 'PUT', payload);
      if (resp.ok) {
        this.showFlashMessage('💾 Enregistré avec succès sur le serveur !');
      }
    } catch (err) {
      alert(`Erreur de sauvegarde : ${err.message}`);
    }
  },

  showFlashMessage(msg) {
    this.message = msg;
    setTimeout(() => {
      if (this.message === msg) this.message = '';
    }, 4000);
  }
});

export function NpcsEditorController(api) {
  store.api = api;
  store.init();
  return store;
}
