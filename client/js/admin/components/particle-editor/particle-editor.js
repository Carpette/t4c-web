console.log('[ParticleEditor] Script loaded.');
import { Particles, emitFromDef } from '../../../render2d/particles.js';

const particleStore = {
  // --- State ---
  api: null,
  rawData: null,
  particleList: [],
  activeParticle: null,
  preview: {
      running: false,
      particles: null,
      animFrameId: null,
      lastTime: 0,
      canvas: null,
      ctx: null,
  },

  $ (id) { return document.getElementById(id); },

  // --- Core Methods ---
  init() {
    console.log('[ParticleEditor] init() called.');
    setTimeout(() => {
      this.loadParticles();
      this.initPreview();
      
      // Attach click listeners for main actions
      this.$('particle-new-btn')?.addEventListener('click', () => this.createNewParticle());
      this.$('particle-save-file-btn')?.addEventListener('click', () => this.saveFileToServer());
      this.$('particle-save-btn')?.addEventListener('click', () => this.saveCurrentParticle());
      
      // Color Manager buttons
      this.$('particle-add-color-btn')?.addEventListener('click', () => this.addColorToken());
      
      // Live Preview buttons
      this.$('particle-run-preview-btn')?.addEventListener('click', () => this.openPreview());
      this.$('particle-stop-preview-btn')?.addEventListener('click', () => this.closePreview());

      // Trigger automatic preview refresh on value change (so sliders update the look live!)
      const inputsToTrack = ['particle-spawn', 'particle-movement', 'particle-radius', 'particle-size', 'particle-gravity', 'particle-speed', 'particle-density', 'particle-life', 'particle-drag', 'particle-offset-x', 'particle-offset-z', 'particle-offset-h'];
      inputsToTrack.forEach(id => {
        this.$(id)?.addEventListener('input', () => this.triggerPreview());
        this.$(id)?.addEventListener('change', () => this.triggerPreview());
      });
    }, 0);
  },

  async loadParticles() {
    try {
      const data = await this.api('/api/admin/content/particles');
      this.rawData = data;
      this.particleList = data.particles || [];
      
      if (this.particleList.length > 0 && !this.activeParticle) {
        this.selectParticle(this.particleList[0].id);
      } else if (this.activeParticle) {
        this.selectParticle(this.activeParticle.id);
      } else {
        this.renderParticleList();
        this.$('particle-editor-pane')?.classList.add('hidden');
      }
    } catch (err) {
      console.error('[ParticleEditor] Erreur au chargement de particles.json:', err);
    }
  },

  selectParticle(id) {
    this.activeParticle = this.particleList.find(s => s.id === id);
    this.renderParticleForm();
  },

  // --- UI Rendering ---
  renderParticleList() {
    const list = this.$('particle-list');
    if (!list) return;
    list.innerHTML = '';
    
    this.particleList.forEach(s => {
      const li = document.createElement('li');
      li.className = `p-4 cursor-pointer transition hover:bg-gray-900 border-b border-gray-900 flex justify-between items-center ${this.activeParticle && this.activeParticle.id === s.id ? 'bg-gray-800 border-l-4 border-amber-500' : ''}`;
      li.onclick = () => this.selectParticle(s.id);
      li.innerHTML = `
        <div>
          <div class="font-semibold text-white">${s.name || 'Sans nom'}</div>
          <div class="text-xs text-gray-500 font-mono">${s.id}</div>
        </div>
        <span class="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 border border-gray-700 font-mono uppercase">${s.spawn}/${s.movement}</span>
      `;
      list.appendChild(li);
    });
  },

  renderParticleForm() {
    if (!this.activeParticle) {
      this.$('particle-editor-pane')?.classList.add('hidden');
      return;
    }
    const editorPane = this.$('particle-editor-pane');
    if (!editorPane) return;
    
    editorPane.classList.remove('hidden');
    this.renderParticleList();
    this.closePreview(); // Reset active preview on select change
    
    // Populating ID & Name
    this.$('particle-title').innerText = `Édition : ${this.activeParticle.name}`;
    this.$('particle-id').value = this.activeParticle.id || '';
    this.$('particle-name').value = this.activeParticle.name || '';
    
    // Populating Geometries & Offsets
    this.$('particle-spawn').value = this.activeParticle.spawn || 'point';
    this.$('particle-movement').value = this.activeParticle.movement || 'outward';
    this.$('particle-radius').value = this.activeParticle.radius !== undefined ? this.activeParticle.radius : 0.1;
    this.$('particle-offset-x').value = this.activeParticle.offsetX !== undefined ? this.activeParticle.offsetX : 0;
    this.$('particle-offset-z').value = this.activeParticle.offsetZ !== undefined ? this.activeParticle.offsetZ : 0;
    this.$('particle-offset-h').value = this.activeParticle.offsetH !== undefined ? this.activeParticle.offsetH : 0;
    
    // Populating Physics
    this.$('particle-size').value = this.activeParticle.size !== undefined ? this.activeParticle.size : 2.0;
    this.$('particle-gravity').value = this.activeParticle.gravity !== undefined ? this.activeParticle.gravity : 0;
    this.$('particle-speed').value = this.activeParticle.speed !== undefined ? this.activeParticle.speed : 1.0;
    this.$('particle-density').value = this.activeParticle.density !== undefined ? this.activeParticle.density : 10;
    this.$('particle-life').value = this.activeParticle.life !== undefined ? this.activeParticle.life : 0.5;
    this.$('particle-drag').value = this.activeParticle.drag !== undefined ? this.activeParticle.drag : 0.98;

    // Populating Colors
    this.renderColorsList();
  },

  renderColorsList() {
    const list = this.$('particle-colors-list');
    if (!list) return;
    list.innerHTML = '';
    
    const colors = this.activeParticle.colors || [];
    if (colors.length === 0) {
      list.innerHTML = '<li class="text-xs text-gray-500 italic">Aucune couleur dans la palette.</li>';
      return;
    }
    
    colors.forEach((hex, idx) => {
      const li = document.createElement('li');
      li.className = "flex items-center gap-1.5 bg-gray-900 border border-gray-800 rounded px-2.5 py-1 text-xs text-white";
      li.innerHTML = `
        <span class="w-3 h-3 rounded-full border border-gray-700 flex-shrink-0" style="background-color: ${hex}"></span>
        <span class="font-mono text-[10px] text-gray-400">${hex.toUpperCase()}</span>
      `;
      
      const btn = document.createElement('button');
      btn.type = "button";
      btn.className = "text-red-500 hover:text-red-400 font-bold ml-1.5";
      btn.innerHTML = "&times;";
      btn.onclick = () => this.removeColorToken(idx);
      
      li.appendChild(btn);
      list.appendChild(li);
    });
  },

  // --- Palette & Color Actions ---
  addColorToken() {
    const picker = this.$('particle-color-picker');
    if (!picker) return;
    const hex = picker.value;
    
    if (!this.activeParticle.colors) this.activeParticle.colors = [];
    if (this.activeParticle.colors.includes(hex)) {
      alert("Cette couleur est déjà dans la palette.");
      return;
    }
    
    this.activeParticle.colors.push(hex);
    this.renderColorsList();
    this.triggerPreview();
  },

  removeColorToken(idx) {
    if (!this.activeParticle.colors) return;
    this.activeParticle.colors.splice(idx, 1);
    this.renderColorsList();
    this.triggerPreview();
  },

  // --- Form Save Actions ---
  createNewParticle() {
    const newId = `nouveau_effet_${Date.now().toString(36).slice(-4)}`;
    this.particleList.push({
      id: newId,
      name: "Nouvel Effet",
      spawn: "point",
      movement: "outward",
      radius: 0.1,
      offsetX: 0,
      offsetZ: 0,
      offsetH: 0,
      colors: ["#ffffff"],
      size: 2.0,
      density: 10,
      gravity: 0,
      speed: 1.0,
      life: 0.5,
      drag: 0.98
    });
    this.selectParticle(newId);
  },

  saveCurrentParticle() {
    if (!this.activeParticle) return;
    
    const originalId = this.activeParticle.id;
    const newId = this.$('particle-id').value;
    
    const updatedParticle = {
      id: newId,
      name: this.$('particle-name').value,
      spawn: this.$('particle-spawn').value,
      movement: this.$('particle-movement').value,
      radius: parseFloat(this.$('particle-radius').value) || 0,
      offsetX: parseFloat(this.$('particle-offset-x').value) || 0,
      offsetZ: parseFloat(this.$('particle-offset-z').value) || 0,
      offsetH: parseInt(this.$('particle-offset-h').value, 10) || 0,
      size: parseFloat(this.$('particle-size').value) || 2.0,
      gravity: parseInt(this.$('particle-gravity').value, 10) || 0,
      speed: parseFloat(this.$('particle-speed').value) || 0,
      density: parseInt(this.$('particle-density').value, 10) || 10,
      life: parseFloat(this.$('particle-life').value) || 0.5,
      drag: parseFloat(this.$('particle-drag').value) || 0.98,
      colors: this.activeParticle.colors || ["#ffffff"]
    };

    const index = this.particleList.findIndex(s => s.id === originalId);
    if (index !== -1) {
      this.particleList[index] = updatedParticle;
    } else {
      this.particleList.push(updatedParticle);
    }
    this.activeParticle = updatedParticle;
    
    this.saveFileToServer();
  },

  async saveFileToServer() {
    if (!this.rawData) return;
    this.rawData.particles = this.particleList;
    try {
      await this.api('/api/admin/content/particles', 'POST', this.rawData);
      alert('Sauvegarde de particles.json réussie côté serveur !');
      this.loadParticles();
    } catch (err) {
      alert(`Erreur de connexion : ${err.message}`);
    }
  },

  // --- Live Parametric Particle Preview ---
  initPreview() {
    this.preview.canvas = this.$('particle-preview-canvas');
    if (this.preview.canvas) {
      this.preview.ctx = this.preview.canvas.getContext('2d');
      
      const container = this.$('particle-preview-container');
      if (container) {
        // Set initial drawing buffer dimensions
        this.preview.canvas.width = container.clientWidth;
        this.preview.canvas.height = container.clientHeight;
        
        // Setup ResizeObserver to dynamically update canvas drawing resolution as you drag!
        const resizeObserver = new ResizeObserver(entries => {
          for (let entry of entries) {
            const { width, height } = entry.contentRect;
            this.preview.canvas.width = width;
            this.preview.canvas.height = height;
            this.triggerPreview(); // Flush particles to adapt layout cleanly
          }
        });
        resizeObserver.observe(container);
      }
    }
  },

  previewLoop(time) {
    if (!this.preview.running) return;
    const dt = Math.min(0.05, (time - this.preview.lastTime) / 1000);
    this.preview.lastTime = time;
    this.preview.ctx.clearRect(0, 0, this.preview.canvas.width, this.preview.canvas.height);
    
    // Draw the semitransparent player dummy first, so particles render around/on top
    this.drawCharacterPlaceholder();

    // Spawn new particles using the dynamic math generator
    this.emitParametricLocal();
    
    if (this.preview.particles) {
      this.preview.particles.update(dt);
      // Authentic 3D Isometric coordinate projector (Width-to-Height 2:1 ratio)
      const w2s = (x, z) => ({ 
        x: this.preview.canvas.width / 2 + (x - z) * 45, 
        y: this.preview.canvas.height / 2 + (x + z) * 22.5 
      });
      this.preview.particles.draw(this.preview.ctx, w2s, 1.0);
    }
    
    this.preview.animFrameId = requestAnimationFrame(this.previewLoop.bind(this));
  },

  // Draws a semitransparent gray player mannequin for visual scale reference
  drawCharacterPlaceholder() {
    const ctx = this.preview.ctx;
    const cx = this.preview.canvas.width / 2;
    const cy = this.preview.canvas.height / 2;
    
    ctx.save();
    
    // 1. Draw the isometric 1x1 tile base footprint (The Ground Ellipse)
    ctx.strokeStyle = '#374151'; // dark charcoal
    ctx.fillStyle = 'rgba(55, 65, 81, 0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(cx, cy, 22, 11, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    
    // 2. Draw the 3D capsule representing the player (torso center h~40px)
    ctx.fillStyle = 'rgba(156, 163, 175, 0.2)'; // semitransparent gray dummy
    ctx.strokeStyle = '#4b5563';
    ctx.lineWidth = 1.2;
    
    // Body capsule
    ctx.beginPath();
    const bodyW = 14;
    const bodyH = 28;
    const bx = cx - bodyW / 2;
    const by = cy - bodyH - 4; // standing slightly offset
    
    // Draw rounded torso capsule
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(bx, by, bodyW, bodyH, 6);
    } else {
      ctx.rect(bx, by, bodyW, bodyH); // fallback
    }
    ctx.fill();
    ctx.stroke();
    
    // Head circle
    ctx.beginPath();
    ctx.arc(cx, by - 7, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    
    ctx.restore();
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
    // Flush old particles to let the newly tweaked properties take effect instantly
    this.preview.particles.pool.forEach(p => p.on = false);
  },

  // THE PARAMETRIC PARTICLE GENERATOR (Math Engine)
  emitParametricLocal() {
    if (!this.preview.running || !this.activeParticle) return;
    if (!this.preview.particles) this.preview.particles = new Particles();
    // construit un def éphémère depuis les curseurs (aperçu LIVE, avant
    // sauvegarde) et le confie à l'émetteur partagé du jeu : mêmes maths,
    // même rendu qu'en partie.
    const def = {
      spawn: this.$('particle-spawn').value,
      movement: this.$('particle-movement').value,
      radius: parseFloat(this.$('particle-radius').value) || 0.1,
      size: parseFloat(this.$('particle-size').value) || 2.0,
      gravity: parseFloat(this.$('particle-gravity').value) || 0,
      speed: parseFloat(this.$('particle-speed').value) || 1.0,
      density: parseInt(this.$('particle-density').value, 10) || 10,
      life: parseFloat(this.$('particle-life').value) || 0.5,
      drag: parseFloat(this.$('particle-drag').value) || 0.98,
      offsetX: parseFloat(this.$('particle-offset-x').value) || 0,
      offsetZ: parseFloat(this.$('particle-offset-z').value) || 0,
      offsetH: parseInt(this.$('particle-offset-h').value, 10) || 0,
      colors: this.activeParticle.colors || ['#ffffff'],
    };
    emitFromDef(this.preview.particles, def, 0, 0, { raw: true });
  }
};

export function ParticleEditorController(api) {
  particleStore.api = api;
  particleStore.init();
  return particleStore;
}
