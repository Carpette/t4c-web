import { SETTING_DEFS, SETTING_CHOICES, SETTING_SLIDERS, settings, setSetting, resetSettings, sliderMeta } from '../../../settings.js';
import { globalBus } from '../../../event-bus.js';
import { refreshMusic } from '../../../music.js';

export function SettingsController() {
  const SETTINGS_LAYOUT = {
    Audio:     ['musicOn', 'sfxOn', 'masterVolume', 'musicVolume', 'sfxVolume', 'musicPack'],
    Affichage: ['gamma', 'fxDensity', 'defaultZoom', 'showHpBars', 'showBubbles', 'showFloaters'],
    Interface: ['showPlayerNames', 'showPlayerLevels', 'showSelfName', 'showMobNames', 'showMobLevels'],
    Confort:   ['hudScale', 'chatOpacity', 'chatLines', 'showPerf'],
  };

  const ctrl = {
    init() {
      this.render();
      // Listen for external changes to re-render, e.g. after a reset
      globalBus.on('settings:applied', () => {
        this.render();
      });
    },

    render() {
      const div = document.getElementById('settings-list');
      if (!div) return;
      div.innerHTML = '';
      
      const onChanged = (key) => {
        if (key === 'musicOn' || key === 'musicPack' || key === 'musicVolume' || key === 'masterVolume') refreshMusic();
        if (key === 'sfxVolume' || key === 'sfxOn' || key === 'masterVolume') globalBus.emit('settings:sfx-changed');
        if (key === 'hudScale') globalBus.emit('settings:hud-scale-changed');
        if (key === 'chatOpacity' || key === 'chatLines') globalBus.emit('settings:chat-style-changed');
        if (key === 'showPerf') globalBus.emit('settings:perf-visibility-changed');
      };

      const addRow = (label, control) => {
        const row = document.createElement('label');
        row.className = 'setting-row';
        const span = document.createElement('span');
        span.className = 'setting-label';
        span.textContent = label;
        row.append(span, control);
        div.appendChild(row);
      };

      const addSection = (title) => {
        const h = document.createElement('div');
        h.className = 'setting-section';
        h.textContent = title;
        div.appendChild(h);
      };

      const defByKey = Object.fromEntries(SETTING_DEFS.map(d => [d[0], d]));
      const sliderByKey = Object.fromEntries(SETTING_SLIDERS.map(s => [sliderMeta(s).key, s]));
      const choiceByKey = Object.fromEntries(SETTING_CHOICES.map(c => [c.key, c]));

      const renderCheckbox = ([key, label]) => {
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = settings[key];
        cb.onchange = () => { setSetting(key, cb.checked); onChanged(key); };
        addRow(label, cb);
      };

      const renderSlider = (decl) => {
        const m = sliderMeta(decl);
        const wrap = document.createElement('span');
        wrap.className = 'setting-control';
        const sl = document.createElement('input');
        sl.type = 'range';
        sl.min = String(m.min); sl.max = String(m.max); sl.step = String(m.step);
        sl.value = settings[m.key];
        const val = document.createElement('span');
        val.className = 'setting-value';
        const fmt = (v) => m.format === 'raw' ? String(Math.round(v)) : `${Math.round(v * 100)} %`;
        val.textContent = fmt(+settings[m.key]);
        sl.oninput = () => { setSetting(m.key, +sl.value); val.textContent = fmt(+sl.value); onChanged(m.key); };
        if (m.key === 'sfxVolume' || m.key === 'masterVolume') sl.onchange = () => globalBus.emit('ui:play-sfx', 'or');
        wrap.append(sl, val);
        addRow(m.label, wrap);
      };

      const renderChoice = (c) => {
        const sel = document.createElement('select');
        sel.innerHTML = c.options.map(([v, l]) =>
          `<option value="${v}"${String(settings[c.key]) === String(v) ? ' selected' : ''}>${l}</option>`).join('');
        sel.onchange = () => { setSetting(c.key, sel.value); onChanged(c.key); };
        addRow(c.label, sel);
      };

      for (const [section, keys] of Object.entries(SETTINGS_LAYOUT)) {
        addSection(section);
        for (const key of keys) {
          if (defByKey[key]) renderCheckbox(defByKey[key]);
          else if (sliderByKey[key]) renderSlider(sliderByKey[key]);
          else if (choiceByKey[key]) renderChoice(choiceByKey[key]);
        }
      }
    },

    reset() {
      resetSettings();
      // The 'settings:applied' event will trigger a re-render
      globalBus.emit('settings:applied');
    },
    
    back() {
      globalBus.emit('gui:menu-back');
    }
  };
  
  return ctrl;
}
