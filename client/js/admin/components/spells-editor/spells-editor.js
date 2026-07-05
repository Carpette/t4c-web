console.log('[SpellsEditor] Script loaded.');
import { reactive } from '/js/vendor/petite-vue.js';
import { Particles, emitFromDef, emitImpact, emitBuff, emitHeal, emitShield } from '../../../render2d/particles.js';

const store = reactive({
  // --- State ---
  api: null,
  rawData: null,
  spells: [],
  activeSpell: null,
  preview: {
      running: false,
      particles: null,
      animFrameId: null,
      lastTime: 0,
      canvas: null,
      ctx: null,
  },
  
  // --- Constants ---
  EFFECT_TYPES: ["damage", "heal", "drain", "stats_boost", "hp_boost", "mp_boost", "hp_regen_boost", "mp_regen_boost", "slow", "curse", "invincible", "pacified", "damage_boost", "retort", "power_boost", "resist_boost"],
  STATS_PARAMS: ["str", "end", "agi", "int", "wis", "hit", "dodge", "parry", "crit", "pierce", "stun", "spellMul"],
  ELEMENTS: ["neutre", "fire", "water", "earth", "air", "light", "dark", "arcane"],

  $ (id) { return document.getElementById(id); },

  // --- Core Methods ---
  init() {
    console.log('[SpellsEditor] init() called.');
    setTimeout(() => {
      this.loadSpells();
      this.initPreview();
      
      // Manual event listeners for main actions
      this.$('new-spell-btn')?.addEventListener('click', () => this.createNewSpell());
      this.$('save-file-btn')?.addEventListener('click', () => this.saveFileToServer());
      this.$('save-spell-btn')?.addEventListener('click', () => this.saveCurrentSpell());
      this.loadFxLibrary();
      for (const k of ['trail', 'impact', 'ground', 'self']) {
        this.$(`spell-fx-${k}`)?.addEventListener('change', () => this.triggerPreview());
      }
      this.$('add-effect-btn')?.addEventListener('click', () => this.addEffectBlock());
      
      // Live Preview buttons
      this.$('open-preview-btn')?.addEventListener('click', () => this.openPreview());
      this.$('close-preview-btn')?.addEventListener('click', () => this.closePreview());
      
      // Multiple Prerequisites "Add" button
      this.$('add-prereq-btn')?.addEventListener('click', () => this.addPrerequisite());

      // Live change triggers for preview, UI toggle, and cooldown metrics
      this.$('spell-type')?.addEventListener('change', () => this.toggleCiblageFields());
      this.$('spell-color')?.addEventListener('input', () => this.triggerPreview());
      this.$('spell-element')?.addEventListener('change', () => this.triggerPreview());
      this.$('spell-cooldown')?.addEventListener('input', () => this.updateCooldownMetrics());
    }, 0);
  },

  async loadSpells() {
    try {
      const data = await this.api('/api/admin/content/spells');
      this.rawData = data;
      this.spells = data.spells || [];

      // Dynamically populate prerequisite select options with all available spells
      const select = this.$('spell-requires-select');
      if (select) {
        select.innerHTML = '<option value="">— Sélectionner un sort à ajouter —</option>' +
          this.spells.map(s => `<option value="${s.id}">${s.name || s.id} (${s.id})</option>`).join('');
      }

      if (this.spells.length > 0 && !this.activeSpell) {
        this.selectSpell(this.spells[0].id);
      } else if (this.activeSpell) {
        this.selectSpell(this.activeSpell.id);
      } else {
          this.renderSpellsList();
          this.$('editor-pane')?.classList.add('hidden');
      }
    } catch (err) {
      console.error('Erreur au chargement des sorts:', err);
    }
  },

  selectSpell(id) {
    this.activeSpell = this.spells.find(s => s.id === id);
    this.renderSpellForm();
  },

  // --- UI Rendering ---
  renderSpellsList() {
    const list = this.$('spells-list');
    if (!list) return;
    list.innerHTML = '';
    this.spells.forEach(sp => {
      const li = document.createElement('li');
      li.className = `p-4 cursor-pointer transition hover:bg-gray-900 border-b border-gray-900 flex justify-between items-center ${this.activeSpell && this.activeSpell.id === sp.id ? 'bg-gray-800 border-l-4 border-amber-500' : ''}`;
      li.onclick = () => this.selectSpell(sp.id);
      li.innerHTML = `
        <div>
          <div class="font-semibold text-white">${sp.name || 'Sans nom'}</div>
          <div class="text-xs text-gray-500 font-mono">${sp.id}</div>
        </div>
        <span class="text-xs px-2 py-0.5 rounded bg-gray-800 text-gray-400 border border-gray-700 font-mono uppercase">${sp.type}</span>
      `;
      list.appendChild(li);
    });
  },

  renderSpellForm() {
    if (!this.activeSpell) {
      this.$('editor-pane')?.classList.add('hidden');
      return;
    }
    const editorPane = this.$('editor-pane');
    if(!editorPane) return;
    
    editorPane.classList.remove('hidden');
    this.renderSpellsList();
    this.closePreview(); // Reset preview on spell change
    
    // 1. Identification
    this.$('spell-title').innerText = `Édition : ${this.activeSpell.name}`;
    this.$('spell-id').value = this.activeSpell.id || '';
    this.$('spell-name').value = this.activeSpell.name || '';
    this.$('spell-type').value = this.activeSpell.type || 'bolt';

    // 2. Prerequisites
    this.$('spell-req-level').value = this.activeSpell.level !== undefined ? this.activeSpell.level : 1;
    this.$('spell-req-wis').value = this.activeSpell.wis !== undefined ? this.activeSpell.wis : 0;
    this.$('spell-req-int').value = this.activeSpell.int !== undefined ? this.activeSpell.int : 0;
    this.renderPrerequisitesList();

    // 3. Gameplay Settings
    this.$('spell-mana').value = this.activeSpell.mana || 0;
    this.$('spell-price').value = this.activeSpell.price !== undefined ? this.activeSpell.price : 0;
    this.$('spell-cooldown').value = this.activeSpell.cooldown || '';
    this.updateCooldownMetrics(); // Pre-calculate metrics on form load
    this.toggleCiblageFields();
    this.$('spell-range').value = this.activeSpell.range || '';
    this.$('spell-radius').value = this.activeSpell.radius || '';
    this.$('spell-centered').checked = !!this.activeSpell.centered;

    // 4. Effects
    const container = this.$('effects-container');
    container.innerHTML = '';
    const effects = this.activeSpell.effects || [];
    effects.forEach((eff, idx) => {
      container.appendChild(this.createEffectDOM(eff, idx));
    });

    // 5. HUD / SFX Settings
    this.$('spell-color').value = this.activeSpell.color || '#ff0000';
    this.$('spell-element').value = this.activeSpell.element || 'neutre';

    // 6. Effets visuels assignés (presets de particules)
    for (const k of ['trail', 'impact', 'ground', 'self']) {
      const sel = this.$(`spell-fx-${k}`);
      if (sel) sel.value = this.activeSpell.fx?.[k] || '';
    }
    this.toggleFxFields();
  },

  // Bibliothèque de particules -> options des 4 selects, groupées par famille
  async loadFxLibrary() {
    try {
      const data = await this.api('/api/admin/content/particles');
      this.fxLibrary = data.particles || [];
    } catch { this.fxLibrary = []; }
    const groups = {};
    for (const p of this.fxLibrary) {
      const fam = p.id.includes('_') ? p.id.split('_')[0] : 'divers';
      (groups[fam] = groups[fam] || []).push(p);
    }
    const html = '<option value="">— défaut (élément) —</option>' +
      Object.keys(groups).sort().map(fam =>
        `<optgroup label="${fam}">` +
        groups[fam].map(p => `<option value="${p.id}">${p.name}</option>`).join('') +
        '</optgroup>').join('');
    for (const k of ['trail', 'impact', 'ground', 'self']) {
      const sel = this.$(`spell-fx-${k}`);
      if (sel) sel.innerHTML = html;
    }
  },

  fxDefOf(k) {
    const id = this.$(`spell-fx-${k}`)?.value;
    return id ? this.fxLibrary?.find(p => p.id === id) : null;
  },

  // les selects visibles suivent le type de sort (comme le ciblage)
  toggleFxFields() {
    const type = this.$('spell-type').value;
    this.$('field-fx-trail').style.display = (type === 'bolt') ? '' : 'none';
    this.$('field-fx-impact').style.display = (type === 'bolt' || type === 'aoe') ? '' : 'none';
    this.$('field-fx-ground').style.display = (type === 'aoe') ? '' : 'none';
  },

  toggleCiblageFields() {
      this.toggleFxFields();
      const type = this.$('spell-type').value;
      this.$('ciblage-pane').style.display = (type === 'bolt' || type === 'aoe') ? '' : 'none';
      this.$('field-range').style.display = (type === 'bolt' || type === 'aoe') ? '' : 'none';
      this.$('field-radius').style.display = (type === 'aoe') ? '' : 'none';
      this.$('field-centered').style.display = (type === 'aoe') ? '' : 'none';
  },

  // Render list of active prerequisite spells
  renderPrerequisitesList() {
    const list = this.$('spell-requires-list');
    if (!list) return;
    list.innerHTML = '';

    // Standardize polymorphic requires to a local array of string IDs
    const requiresAttr = this.activeSpell.requires;
    const prereqList = Array.isArray(requiresAttr) ? requiresAttr : (requiresAttr ? [requiresAttr] : []);

    if (prereqList.length === 0) {
      list.innerHTML = '<li class="text-xs text-gray-500 italic p-1">Aucun prérequis configuré.</li>';
      return;
    }

    prereqList.forEach(reqId => {
      const reqSpell = this.spells.find(s => s.id === reqId);
      const name = reqSpell ? reqSpell.name : reqId;

      const li = document.createElement('li');
      li.className = "flex justify-between items-center bg-gray-900 border border-gray-800 rounded px-2.5 py-1 text-[11px] text-white max-w-sm";
      li.innerHTML = `
        <span class="font-medium">${name} <span class="text-gray-500 font-mono text-[9px]">(${reqId})</span></span>
      `;
      
      const removeBtn = document.createElement('button');
      removeBtn.type = "button";
      removeBtn.className = "text-red-500 hover:text-red-400 font-bold ml-4";
      removeBtn.innerHTML = "&times; Retirer";
      removeBtn.onclick = () => this.removePrerequisite(reqId);
      
      li.appendChild(removeBtn);
      list.appendChild(li);
    });
  },

  // Add a prerequisite spell ID
  addPrerequisite() {
    const select = this.$('spell-requires-select');
    if (!select) return;
    const selectId = select.value;
    if (!selectId) return;

    if (selectId === this.activeSpell.id) {
      alert("Un sort ne peut pas se requérir lui-même !");
      return;
    }

    // Standardize requires to a local array of string IDs
    let prereqs = this.activeSpell.requires;
    prereqs = Array.isArray(prereqs) ? prereqs : (prereqs ? [prereqs] : []);

    if (prereqs.includes(selectId)) {
      alert("Ce sort est déjà configuré comme prérequis !");
      return;
    }

    prereqs.push(selectId);
    this.activeSpell.requires = prereqs;
    
    // Reset selection and re-render
    select.value = "";
    this.renderPrerequisitesList();
  },

  removePrerequisite(id) {
    let prereqs = this.activeSpell.requires;
    prereqs = Array.isArray(prereqs) ? prereqs : (prereqs ? [prereqs] : []);

    const idx = prereqs.indexOf(id);
    if (idx !== -1) {
      prereqs.splice(idx, 1);
    }
    this.activeSpell.requires = prereqs;
    this.renderPrerequisitesList();
  },

  createEffectDOM(eff, index) {
    const div = document.createElement('div');
    div.className = "bg-gray-950 p-4 rounded-lg border border-gray-800 space-y-2.5 relative";
    div.dataset.index = index;
    div.innerHTML = `
      <div class="grid grid-cols-3 gap-3">
        <div> <label class="block text-[10px] font-semibold uppercase text-gray-400 mb-1">Type d'Effet</label> <select class="eff-type w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-amber-500"> ${this.EFFECT_TYPES.map(t => `<option value="${t}" ${eff.type === t ? 'selected' : ''}>${t}</option>`).join('')} </select> </div>
        <div class="col-span-2"> <label class="block text-[10px] font-semibold uppercase text-gray-400 mb-1">Formule de calcul</label> <input type="text" class="eff-formula w-full bg-gray-900 border border-gray-700 rounded px-2.5 py-1 text-xs text-white focus:outline-none focus:border-amber-500" value="${eff.formula || ''}"> </div>
      </div>
      <div class="grid grid-cols-4 gap-3 p-3 bg-gray-900/40 rounded border border-gray-900">
          <div class="pane-target"> <label class="block text-[10px] font-semibold uppercase text-gray-400 mb-1">Paramètre cible</label> <select class="eff-target-parameter w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-white focus:outline-none"> <option value="">Aucun</option> ${this.STATS_PARAMS.map(p => `<option value="${p}" ${eff.target_parameter === p ? 'selected' : ''}>${p}</option>`).join('')}${this.ELEMENTS.map(e => `<option value="${e}" ${eff.target_parameter === e ? 'selected' : ''}>${e}</option>`).join('')} </select> </div>
          <div> <label class="block text-[10px] font-semibold uppercase text-gray-400 mb-1">Durée (Sec / Infinity)</label> <input type="text" class="eff-duration w-full bg-gray-900 border border-gray-700 rounded px-2.5 py-1 text-xs text-white focus:outline-none" value="${eff.duration !== undefined ? eff.duration : 0}"> </div>
          <div class="pane-interval"> <label class="block text-[10px] font-semibold uppercase text-gray-400 mb-1">Recurrence (Interval sec)</label> <input type="number" step="0.1" class="eff-interval w-full bg-gray-900 border border-gray-700 rounded px-2.5 py-1 text-xs text-white focus:outline-none" value="${eff.interval || 0}"> </div>
          <div class="pane-damage-cat"> <label class="block text-[10px] font-semibold uppercase text-gray-400 mb-1">Catégorie Dégâts</label> <select class="eff-damage-category w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-white focus:outline-none"> <option value="physical" ${eff.damageCategory === 'physical' ? 'selected' : ''}>Physical (CA)</option> <option value="mental" ${eff.damageCategory === 'mental' ? 'selected' : ''}>Mental (No CA)</option> </select> </div>
          <div class="pane-drain col-span-2"> <label class="block text-[10px] font-semibold uppercase text-gray-400 mb-1">Ratio d'absorption</label> <input type="number" step="0.1" class="eff-drain-ratio w-full bg-gray-900 border border-gray-700 rounded px-2.5 py-1 text-xs text-white focus:outline-none" value="${eff.drain_ratio !== null && eff.drain_ratio !== undefined ? eff.drain_ratio : 1.0}"> </div>
      </div>`;
      
    const removeBtn = document.createElement('button');
    removeBtn.className = "absolute top-3 right-3 text-[10px] font-bold text-red-500 hover:text-red-400";
    removeBtn.textContent = "✕ Retirer";
    removeBtn.onclick = () => this.removeEffectBlock(index);
    div.prepend(removeBtn);
    
    const typeSelect = div.querySelector('.eff-type');
    typeSelect.onchange = () => this.onEffectTypeChange(index, typeSelect.value);

    setTimeout(() => this.onEffectTypeChange(index, eff.type), 0);
    
    return div;
  },

  // Evaluate a cooldown formula for a specific level using local secure JS math translation
  evaluateCooldownLocal(formula, level) {
    try {
      const jsFormula = formula
        .replace(/max\s*\(/gi, 'Math.max(')
        .replace(/min\s*\(/gi, 'Math.min(')
        .replace(/abs\s*\(/gi, 'Math.abs(')
        .replace(/self\.level/gi, String(level));

      const result = new Function(`return ${jsFormula};`)();
      return typeof result === 'number' && !isNaN(result) ? result : null;
    } catch (e) {
      return null;
    }
  },

  // Calculate slowest, fastest, and cap level metrics for a formula
  calculateCooldownMetrics(formula) {
    if (!formula || !this.activeSpell) return null;

    const baseLevel = this.activeSpell.level !== undefined ? this.activeSpell.level : 1;
    let maxCd = -Infinity;
    let minCd = Infinity;
    let startCd = null;

    for (let lvl = baseLevel; lvl <= 100; lvl++) {
      const cd = this.evaluateCooldownLocal(formula, lvl);
      if (cd === null) continue;

      if (lvl === baseLevel) startCd = cd;
      if (cd > maxCd) maxCd = cd;
      if (cd < minCd) minCd = cd;
    }

    if (maxCd === -Infinity || minCd === Infinity) return null;

    let capLevel = baseLevel;
    for (let lvl = baseLevel; lvl <= 100; lvl++) {
      const cd = this.evaluateCooldownLocal(formula, lvl);
      if (cd !== null && Math.abs(cd - minCd) < 0.1) {
        capLevel = lvl;
        break;
      }
    }

    return {
      slowest: maxCd,
      startCd: startCd,
      fastest: minCd,
      capLevel: capLevel,
      startLevel: baseLevel
    };
  },

  // Read formula from DOM, calculate, and update the UI panel
  updateCooldownMetrics() {
    const formula = this.$('spell-cooldown')?.value;
    const metricsPanel = this.$('cooldown-metrics');
    if (!metricsPanel) return;

    const metrics = this.calculateCooldownMetrics(formula);

    if (!metrics) {
      metricsPanel.classList.add('hidden');
      return;
    }

    metricsPanel.classList.remove('hidden');
    this.$('metric-slowest').innerText = `${Math.round(metrics.slowest)} ms`;
    this.$('metric-start-lvl').innerText = metrics.startLevel;
    this.$('metric-fastest').innerText = `${Math.round(metrics.fastest)} ms`;
    this.$('metric-cap-lvl').innerText = metrics.capLevel;
  },

  // --- Actions ---
  createNewSpell() {
    const newId = `nouveau_sort_${Date.now().toString(36).slice(-4)}`;
    this.spells.push({
      id: newId, name: "Nouveau Sort", mana: 1, type: "bolt",
      color: "#ffffff", element: "neutre", cooldown: "1000", effects: []
    });
    this.selectSpell(newId);
  },

  addEffectBlock() {
    if (!this.activeSpell.effects) this.activeSpell.effects = [];
    this.activeSpell.effects.push({ type: "damage", formula: "1d6", duration: 0 });
    this.renderSpellForm();
  },

  removeEffectBlock(index) {
    this.activeSpell.effects.splice(index, 1);
    this.renderSpellForm();
  },
  
  onEffectTypeChange(index, value) {
    const block = Array.from(this.$('effects-container').children).find(b => parseInt(b.dataset.index) === index);
    if (!block) return;
    block.querySelector('.pane-target').style.display = ['stats_boost', 'skill_boost', 'power_boost', 'resist_boost'].includes(value) ? '' : 'none';
    block.querySelector('.pane-interval').style.display = ['damage', 'heal'].includes(value) ? '' : 'none';
    block.querySelector('.pane-damage-cat').style.display = value === 'damage' ? '' : 'none';
    block.querySelector('.pane-drain').style.display = value === 'drain' ? '' : 'none';
  },

  saveCurrentSpell() {
      if (!this.activeSpell) return;
      
      const originalId = this.activeSpell.id;
      const newId = this.$('spell-id').value;

      const updatedSpell = {
          id: newId,
          name: this.$('spell-name').value,
          mana: parseInt(this.$('spell-mana').value, 10),
          type: this.$('spell-type').value,
          color: this.$('spell-color').value,
          element: this.$('spell-element').value,
          cooldown: this.$('spell-cooldown').value,
          effects: []
      };

      if (updatedSpell.type === 'bolt' || updatedSpell.type === 'aoe') {
          updatedSpell.range = parseFloat(this.$('spell-range').value);
      }
      if (updatedSpell.type === 'aoe') {
          updatedSpell.radius = parseFloat(this.$('spell-radius').value);
          updatedSpell.centered = this.$('spell-centered').checked;
      }

      // Effets visuels : n'écrire que les clés réellement assignées
      const fx = {};
      for (const k of ['trail', 'impact', 'ground', 'self']) {
        const v = this.$(`spell-fx-${k}`)?.value;
        if (v) fx[k] = v;
      }
      if (Object.keys(fx).length) updatedSpell.fx = fx;

      // Save level and stat requirements
      updatedSpell.level = parseInt(this.$('spell-req-level').value, 10) || 1;
      updatedSpell.wis = parseInt(this.$('spell-req-wis').value, 10) || 0;
      updatedSpell.int = parseInt(this.$('spell-req-int').value, 10) || 0;
      updatedSpell.price = parseInt(this.$('spell-price').value, 10) || 0;
      
      // Package prerequisites list according to polymorphic conventions (array, string, or null)
      const prereqs = this.activeSpell.requires;
      const cleanPrereqs = Array.isArray(prereqs) ? prereqs : (prereqs ? [prereqs] : []);
      
      if (cleanPrereqs.length === 0) {
        updatedSpell.requires = null;
      } else if (cleanPrereqs.length === 1) {
        updatedSpell.requires = cleanPrereqs[0];
      } else {
        updatedSpell.requires = cleanPrereqs;
      }
      
      const effectBlocks = this.$('effects-container').children;
      for (const block of effectBlocks) {
          updatedSpell.effects.push({
              type: block.querySelector('.eff-type').value,
              formula: block.querySelector('.eff-formula').value,
              duration: block.querySelector('.eff-duration').value,
              target_parameter: block.querySelector('.eff-target-parameter')?.value,
              interval: parseFloat(block.querySelector('.eff-interval')?.value),
              damageCategory: block.querySelector('.eff-damage-category')?.value,
              drain_ratio: parseFloat(block.querySelector('.eff-drain-ratio')?.value),
          });
      }

      const index = this.spells.findIndex(s => s.id === originalId);
      if (index !== -1) {
          this.spells[index] = updatedSpell;
      } else {
          this.spells.push(updatedSpell);
      }
      this.activeSpell = updatedSpell;

      this.saveFileToServer();
  },

  async saveFileToServer() {
    if (!this.rawData) { return; }
    this.rawData.spells = this.spells;
    try {
      await this.api('/api/admin/content/spells', 'POST', this.rawData);
      alert('Sauvegarde réussie !');
      this.loadSpells();
    } catch (err) {
      alert(`Erreur de connexion : ${err.message}`);
    }
  },

  // --- Live HUD / SFX Preview ---
  initPreview() {
    this.preview.canvas = this.$('preview-canvas');
    if (this.preview.canvas) this.preview.ctx = this.preview.canvas.getContext('2d');
  },

  previewLoop(time) {
    if (!this.preview.running) return;
    const dt = Math.min(0.05, (time - this.preview.lastTime) / 1000);
    this.preview.lastTime = time;
    this.preview.ctx.clearRect(0, 0, this.preview.canvas.width, this.preview.canvas.height);
    if (this.preview.particles) {
      this.preview.particles.update(dt);
      this.preview.particles.draw(this.preview.ctx, (x, z) => ({ x: this.preview.canvas.width / 2 + x, y: this.preview.canvas.height / 2 - z }), 1.0);
    }
    this.preview.animFrameId = requestAnimationFrame(this.previewLoop.bind(this));
  },

  openPreview() {
    this.preview.running = true;
    if (!this.preview.animFrameId) {
      this.preview.lastTime = performance.now();
      this.previewLoop(this.preview.lastTime);
    }
    this.triggerPreview();
  },

  closePreview() {
    this.preview.running = false;
    if (this.preview.animFrameId) {
      cancelAnimationFrame(this.preview.animFrameId);
      this.preview.animFrameId = null;
    }
    if (this.preview.ctx) {
      this.preview.ctx.clearRect(0, 0, this.preview.canvas.width, this.preview.canvas.height);
    }
  },

  triggerPreview() {
    if (!this.preview.running || !this.preview.canvas) return;
    if (!this.preview.particles) this.preview.particles = new Particles();
    this.preview.particles.pool.forEach(p => p.on = false);

    const type = this.$('spell-type').value;
    const element = this.$('spell-element').value;
    const color = this.$('spell-color').value;

    // preset assigné prioritaire : self, puis ground (aoe), puis impact
    const def = this.fxDefOf('self')
      || (type === 'aoe' && this.fxDefOf('ground'))
      || this.fxDefOf('impact');
    if (def) { emitFromDef(this.preview.particles, def, 0, 0, { burst: true, raw: true }); return; }
    switch (type) {
      case 'heal': emitHeal(this.preview.particles, 0, 0); break;
      case 'buff':
          if (Math.random() > 0.5) emitBuff(this.preview.particles, 0, 0, color);
          else emitShield(this.preview.particles, 0, 0, color);
          break;
      default: emitImpact(this.preview.particles, element, 0, 0); break;
    }
  }
});

export function SpellsEditorController(api) {
  store.api = api;
  store.init();
  return store;
}
