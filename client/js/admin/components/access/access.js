// Accès et rôles : comptes d'administration et permissions (lecture :
// permission « roles » ; attribution : super admin uniquement).
export function AccessController(api) {
  const $ = (id) => document.getElementById(id);

  return {
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
      tbl.innerHTML = '<tr><th>Compte</th><th>Profil</th><th class="text-center" title="Super admin : toutes les permissions + gestion des rôles">👑</th>'
        + data.perms.map(p => `<th class="text-center">${p}</th>`).join('') + '<th></th></tr>';
      for (const acc of data.accounts) {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${acc.name}</td><td>${acc.isAdmin ? '👑 super admin' : (acc.perms.length ? 'animateur' : 'joueur')}</td>`;
        // colonne super admin : promotion/rétrogradation (fondateur intouchable)
        const tdSuper = document.createElement('td');
        tdSuper.className = 'text-center';
        const cbSuper = document.createElement('input');
        cbSuper.type = 'checkbox';
        cbSuper.checked = acc.isAdmin;
        cbSuper.disabled = acc.id === 1 || !me.isAdmin;
        cbSuper.title = acc.id === 1 ? 'Le compte fondateur reste super admin' : 'Super admin (toutes permissions)';
        tdSuper.appendChild(cbSuper);
        tr.appendChild(tdSuper);
        const boxes = [];
        for (const perm of data.perms) {
          const td = document.createElement('td');
          td.className = 'text-center';
          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.checked = acc.isAdmin || acc.perms.includes(perm);
          // super admin : tout coché, non modifiable ; attribution réservée aux super admins
          cb.disabled = acc.isAdmin || !me.isAdmin;
          cbSuper.addEventListener('change', () => { cb.disabled = cbSuper.checked || !me.isAdmin; if (cbSuper.checked) cb.checked = true; });
          boxes.push([perm, cb]);
          td.appendChild(cb);
          tr.appendChild(td);
        }
        const act = document.createElement('td');
        if (acc.id !== 1 && me.isAdmin) {
          const save = document.createElement('button');
          save.textContent = 'Appliquer';
          save.onclick = async () => {
            const perms = boxes.filter(([, cb]) => cb.checked).map(([perm]) => perm);
            try {
              await api('/api/admin/roles', 'PUT', { accountId: acc.id, perms, superAdmin: cbSuper.checked });
              $('roles-msg').textContent = cbSuper.checked
                ? `✔ ${acc.name} est désormais 👑 super admin.`
                : `✔ Rôles de ${acc.name} mis à jour${perms.length ? ' : ' + perms.join(', ') : ' (plus aucun)'}.`;
              this.loadRoles();
            } catch (e) { $('roles-msg').textContent = '✘ ' + e.message; }
          };
          act.appendChild(save);
        }
        tr.appendChild(act);
        tbl.appendChild(tr);
      }
    },

    init() {
      setTimeout(() => this.loadRoles(), 0);
    }
  };
}
