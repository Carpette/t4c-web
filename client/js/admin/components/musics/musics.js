export function MusicsController(api) {
  const $ = (id) => document.getElementById(id);
  let musicMap = { login: null, trial: null, zones: {}, groups: {} };
  let zonesDef = [];
  let files = [];

  const preview = (file) => {
    if (!file) return;
    const a = $('music-preview');
    if (a) { a.src = `/assets/music/${encodeURIComponent(file)}`; a.play?.(); }
  };

  // bouton de pré-écoute ▶ d'un fichier donné (callback fournissant le nom courant)
  const playBtn = (getFile) => {
    const b = document.createElement('button');
    b.textContent = '▶';
    b.title = 'Pré-écouter';
    b.className = 'ml-1 px-2 bg-t4c-button hover:bg-t4c-button-hover rounded';
    b.onclick = () => preview(getFile());
    return b;
  };

  // <select> de fichiers (avec option silence). value '' = aucun.
  const fileSelect = (current) => {
    const sel = document.createElement('select');
    sel.className = 'bg-t4c-input-bg border border-t4c-input-border rounded px-1 py-0.5 text-t4c-text-light';
    sel.innerHTML = '<option value="">— silence —</option>' +
      files.map(f => `<option value="${f}"${current === f ? ' selected' : ''}>${f}</option>`).join('');
    return sel;
  };

  // ---------- Groupes de musique ----------
  // Rend la liste éditable des groupes : pistes du pack « new » (liste) + piste
  // « legacy » unique, avec pré-écoute, ajout/retrait, et suppression gardée.
  function renderGroups() {
    const box = $('groups-list');
    if (!box) return;
    box.innerHTML = '';
    const ids = Object.keys(musicMap.groups || {});
    if (!ids.length) {
      box.innerHTML = '<p class="text-gray-500 italic">Aucun groupe. Créez-en un ci-dessus.</p>';
      return;
    }
    for (const id of ids) {
      const g = musicMap.groups[id];
      g.new = Array.isArray(g.new) ? g.new : [];
      const card = document.createElement('div');
      card.className = 'bg-t4c-input-bg border border-t4c-input-border rounded-md p-3';

      const head = document.createElement('div');
      head.className = 'flex items-center justify-between mb-2';
      head.innerHTML = `<span class="font-bold text-t4c-gold">🎵 ${id}</span>`;
      const del = document.createElement('button');
      del.textContent = '🗑 Supprimer';
      del.className = 'px-2 py-1 bg-red-700 hover:bg-red-600 text-white rounded text-xs';
      del.onclick = () => removeGroup(id);
      head.appendChild(del);
      card.appendChild(head);

      // pack « new » : liste de pistes (chaque ligne : nom + ▶ + retrait)
      const newWrap = document.createElement('div');
      newWrap.innerHTML = '<p class="text-xs text-gray-400 mb-1">Pack « nouvelles » (liste, tirée au sort + enchaînée) :</p>';
      for (let i = 0; i < g.new.length; i++) {
        const row = document.createElement('div');
        row.className = 'flex items-center gap-1 mb-1';
        const name = document.createElement('span');
        name.className = 'text-t4c-text-light';
        name.textContent = g.new[i];
        const rm = document.createElement('button');
        rm.textContent = '✕';
        rm.title = 'Retirer';
        rm.className = 'px-2 bg-t4c-button hover:bg-t4c-button-hover rounded';
        rm.onclick = () => { g.new.splice(i, 1); renderGroups(); };
        row.append(name, playBtn(() => g.new[i]), rm);
        newWrap.appendChild(row);
      }
      // ajout d'une piste au pack « new »
      const addRow = document.createElement('div');
      addRow.className = 'flex items-center gap-1 mt-1';
      const addSel = fileSelect('');
      const addBtn = document.createElement('button');
      addBtn.textContent = '+ Ajouter';
      addBtn.className = 'px-2 py-0.5 bg-t4c-button hover:bg-t4c-button-hover rounded';
      addBtn.onclick = () => { if (addSel.value) { g.new.push(addSel.value); renderGroups(); } };
      addRow.append(addSel, playBtn(() => addSel.value), addBtn);
      newWrap.appendChild(addRow);
      card.appendChild(newWrap);

      // pack « legacy » : une seule piste
      const legacyRow = document.createElement('div');
      legacyRow.className = 'flex items-center gap-1 mt-2';
      legacyRow.innerHTML = '<span class="text-xs text-gray-400">Pack « legacy » (une piste) :</span>';
      const legSel = fileSelect(g.legacy || '');
      legSel.onchange = () => { g.legacy = legSel.value || null; };
      legacyRow.append(legSel, playBtn(() => legSel.value));
      card.appendChild(legacyRow);

      box.appendChild(card);
    }
  }

  function addGroup() {
    const inp = $('group-new-name');
    const id = (inp?.value || '').trim();
    const msgEl = $('music-msg');
    if (!id) { if (msgEl) msgEl.textContent = 'Donnez un nom au groupe.'; return; }
    if (musicMap.groups[id]) { if (msgEl) msgEl.textContent = `Le groupe « ${id} » existe déjà.`; return; }
    musicMap.groups[id] = { new: [], legacy: null };
    if (inp) inp.value = '';
    renderGroups();
    renderTable(); // le nouveau groupe devient sélectionnable dans les emplacements
  }

  // tous les emplacements qui référencent ce groupe (zones + login + trial)
  function groupReferences(id) {
    const refs = [];
    if (musicMap.login?.group === id) refs.push('Écran de connexion');
    if (musicMap.trial?.group === id) refs.push("L'Épreuve");
    for (const [k, v] of Object.entries(musicMap.zones || {})) {
      if (v?.group === id) refs.push(`zone ${k}`);
    }
    return refs;
  }

  function removeGroup(id) {
    const refs = groupReferences(id);
    const msgEl = $('music-msg');
    if (refs.length) {
      if (msgEl) msgEl.textContent = `Impossible : le groupe « ${id} » est référencé par ${refs.join(', ')}. Détachez-le d'abord.`;
      return;
    }
    delete musicMap.groups[id];
    renderGroups();
    renderTable();
  }

  // ---------- Tableau des emplacements ----------
  // Une ligne par emplacement : un sélecteur de GROUPE (ou « piste seule ») ; si
  // aucun groupe, deux cellules pour les variantes new/legacy d'une piste unique.
  function normSlot(s) {
    if (s == null || typeof s === 'string') return { legacy: s || null, new: null };
    if (typeof s.group === 'string') return { group: s.group };
    return { legacy: s.legacy || null, new: s.new || null };
  }

  function renderTable() {
    const table = $('music-table');
    if (!table) return;
    table.innerHTML = '<tr><th>Emplacement</th><th>Groupe</th><th>Piste seule — nouvelle (défaut)</th><th>Piste seule — ancienne (legacy)</th></tr>';

    const mkVariantCell = (slot, variant) => {
      const td = document.createElement('td');
      td.style.whiteSpace = 'nowrap';
      const sel = fileSelect(slot[variant]);
      sel.disabled = !!slot.group; // une référence de groupe désactive les pistes seules
      sel.onchange = () => { slot[variant] = sel.value || null; };
      td.append(sel, playBtn(() => sel.value));
      return td;
    };

    const mkRow = (label, getSlot, setSlot) => {
      const slot = normSlot(getSlot());
      setSlot(slot);
      const tr = document.createElement('tr');
      const tdName = document.createElement('td');
      tdName.textContent = label;

      // sélecteur de groupe (— aucun (piste seule) — + tous les groupes)
      const tdGroup = document.createElement('td');
      const gsel = document.createElement('select');
      gsel.className = 'bg-t4c-input-bg border border-t4c-input-border rounded px-1 py-0.5 text-t4c-text-light';
      const ids = Object.keys(musicMap.groups || {});
      // aucun groupe défini : on l'indique et on dirige vers l'onglet « Groupes »
      const emptyOpt = ids.length
        ? '<option value="">— aucun (piste seule) —</option>'
        : '<option value="">— aucun groupe (à créer dans l\'onglet « Groupes ») —</option>';
      gsel.innerHTML = emptyOpt +
        ids.map(id => `<option value="${id}"${slot.group === id ? ' selected' : ''}>${id}</option>`).join('');

      const vNew = mkVariantCell(slot, 'new');
      const vLegacy = mkVariantCell(slot, 'legacy');
      gsel.onchange = () => {
        if (gsel.value) { slot.group = gsel.value; delete slot.legacy; delete slot.new; }
        else { delete slot.group; slot.legacy = slot.legacy || null; slot.new = slot.new || null; }
        // refléter l'état désactivé des cellules de pistes seules
        for (const td of [vNew, vLegacy]) { const s = td.querySelector('select'); if (s) s.disabled = !!slot.group; }
      };
      tdGroup.appendChild(gsel);
      tr.append(tdName, tdGroup, vNew, vLegacy);
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

  return {
    async loadMusic() {
      try {
        const r = await api('/api/admin/music');
        files = r.files || [];
        musicMap = r.map || musicMap;
        if (!musicMap.zones) musicMap.zones = {};
        if (!musicMap.groups) musicMap.groups = {};
        const zonesContent = await api('/api/admin/content/zones');
        zonesDef = zonesContent.zones;
      } catch (e) {
        const msgEl = $('music-msg');
        if (msgEl) msgEl.textContent = e.message;
        return;
      }
      renderGroups();
      renderTable();
    },
    addGroup,
    // bascule entre les sous-onglets « Emplacements » et « Groupes »
    showSubtab(name) {
      const panes = { empl: $('music-pane-empl'), grp: $('music-pane-grp') };
      const tabs = { empl: $('music-subtab-empl'), grp: $('music-subtab-grp') };
      for (const k of ['empl', 'grp']) {
        panes[k]?.classList.toggle('hidden', k !== name);
        // onglet actif : surligné ; inactif : grisé
        tabs[k]?.classList.toggle('bg-t4c-button', k === name);
        tabs[k]?.classList.toggle('text-t4c-text-light', k === name);
        tabs[k]?.classList.toggle('bg-t4c-input-bg', k !== name);
        tabs[k]?.classList.toggle('text-gray-400', k !== name);
      }
    },
    async saveMusic() {
      try {
        await api('/api/admin/music', 'PUT', musicMap);
        const msgEl = $('music-msg');
        if (msgEl) msgEl.textContent = 'Enregistré — appliqué à chaud aux joueurs connectés.';
      } catch (e) {
        const msgEl = $('music-msg');
        if (msgEl) msgEl.textContent = 'Erreur : ' + e.message;
      }
    },
    init() {
      setTimeout(() => { this.loadMusic(); }, 0);
    },
  };
}
