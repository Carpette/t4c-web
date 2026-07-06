export function CharactersController(api) {
  const $ = (id) => document.getElementById(id);

  return {
    async loadChars() {
      try {
        const { characters } = await api('/api/admin/characters');
        const tbl = $('chars-table');
        if (!tbl) return;
        tbl.innerHTML = '<tr><th>Compte</th><th>Perso</th><th>Niveau</th><th>Or</th><th>Zone</th><th>Drapeaux</th><th>Admin</th><th>En ligne</th><th>Actions</th></tr>';
        for (const c of characters) {
          const tr = document.createElement('tr');
          const lvl = document.createElement('input'); lvl.style.width = '54px'; lvl.value = c.char?.level ?? '';
          const gold = document.createElement('input'); gold.style.width = '90px'; gold.value = c.char?.gold ?? '';
          const zone = document.createElement('input'); zone.style.width = '40px'; zone.value = c.char?.zoneId ?? '';
          tr.innerHTML = `<td>${c.account}</td><td>${c.char?.name ?? '—'}</td>`;
          const tds = [lvl, gold, zone].map(el => { const td = document.createElement('td'); td.appendChild(el); return td; });
          tds.forEach(td => tr.appendChild(td));
          const flags = Object.keys(c.char?.flags || {});
          const tdFlags = document.createElement('td');
          tdFlags.textContent = flags.length ? `${flags.length} ⚑` : '';
          tdFlags.title = flags.join(', ');
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
              this.loadChars();
            } catch (e) { $('chars-msg').textContent = '✘ ' + e.message; }
          };
          const del = document.createElement('button');
          del.textContent = 'Supprimer';
          del.className = 'danger';
          del.style.marginLeft = '6px';
          del.onclick = async () => {
            if (!confirm(`Supprimer définitivement le personnage de ${c.account} ?`)) return;
            await api(`/api/admin/character/${c.accountId}`, 'DELETE');
            this.loadChars();
          };
          act.appendChild(apply);
          if (c.char) act.appendChild(del);
          tr.appendChild(act);
          tbl.appendChild(tr);
        }
      } catch (e) { 
        const msgEl = $('chars-msg');
        if(msgEl) msgEl.textContent = '✘ ' + e.message;
      }
    },
    // ---- Comptes & rôles (permission « roles » ; attribution : super admin) ----
    async loadRoles() {
      let me;
      try { me = await api('/api/admin/me'); } catch { return; }
      if (!me.perms?.includes('roles')) return; // section invisible sans la permission
      let data;
      try { data = await api('/api/admin/roles'); } catch (e) {
        $('roles-msg').textContent = '✘ ' + e.message; return;
      }
      $('roles-section').classList.remove('hidden');
      const tbl = $('roles-table');
      tbl.innerHTML = '<tr><th>Compte</th><th>Profil</th>'
        + data.perms.map(p => `<th class="text-center">${p}</th>`).join('') + '<th></th></tr>';
      for (const acc of data.accounts) {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${acc.name}</td><td>${acc.isAdmin ? '👑 super admin' : (acc.perms.length ? 'animateur' : 'joueur')}</td>`;
        const boxes = [];
        for (const perm of data.perms) {
          const td = document.createElement('td');
          td.className = 'text-center';
          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.checked = acc.isAdmin || acc.perms.includes(perm);
          // super admin : tout coché, non modifiable ; attribution réservée aux super admins
          cb.disabled = acc.isAdmin || !me.isAdmin;
          boxes.push([perm, cb]);
          td.appendChild(cb);
          tr.appendChild(td);
        }
        const act = document.createElement('td');
        if (!acc.isAdmin && me.isAdmin) {
          const save = document.createElement('button');
          save.textContent = 'Appliquer';
          save.onclick = async () => {
            const perms = boxes.filter(([, cb]) => cb.checked).map(([perm]) => perm);
            try {
              await api('/api/admin/roles', 'PUT', { accountId: acc.id, perms });
              $('roles-msg').textContent = `✔ Rôles de ${acc.name} mis à jour${perms.length ? ' : ' + perms.join(', ') : ' (plus aucun)'}.`;
            } catch (e) { $('roles-msg').textContent = '✘ ' + e.message; }
          };
          act.appendChild(save);
        }
        tr.appendChild(act);
        tbl.appendChild(tr);
      }
    },

    init() {
      // Use setTimeout to ensure the DOM is fully rendered before loading characters
      setTimeout(() => {
        this.loadChars();
        this.loadRoles();
      }, 0);
    }
  };
}
