export function MusicsController(api) {
  const $ = (id) => document.getElementById(id);
  let musicMap = { login: null, trial: null, zones: {} };
  let zonesDef = [];

  return {
    async loadMusic() {
        let files = [];
        try {
            const r = await api('/api/admin/music');
            files = r.files;
            musicMap = r.map || musicMap;
            if (!musicMap.zones) musicMap.zones = {};

            const zonesContent = await api('/api/admin/content/zones');
            zonesDef = zonesContent.zones;

        } catch (e) { 
          const msgEl = $('music-msg');
          if (msgEl) msgEl.textContent = e.message; 
          return; 
        }

        const table = $('music-table');
        if (!table) return;

        table.innerHTML = '<tr><th>Zone</th><th>Nouvelle musique (défaut joueurs)</th><th>Musique ancienne (legacy)</th></tr>';
        
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
                if (a) {
                  a.src = `/assets/music/${encodeURIComponent(sel.value)}`;
                  a.play();
                }
            };
            td.append(sel, play);
            return td;
        };
        const mkRow = (label, getSlot, setSlot) => {
            const slot = slotOf(getSlot);
            setSlot(slot);
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
    },
    async saveMusic() {
        try {
            await api('/api/admin/music', 'PUT', musicMap);
            const msgEl = $('music-msg');
            if(msgEl) msgEl.textContent = 'Enregistré — appliqué à chaud aux joueurs connectés.';
        } catch (e) { 
          const msgEl = $('music-msg');
          if(msgEl) msgEl.textContent = 'Erreur : ' + e.message; 
        }
    },
    init() {
      // Use setTimeout to ensure the DOM is fully rendered before loading music
      setTimeout(() => {
        this.loadMusic();
      }, 0);
    }
  };
}
