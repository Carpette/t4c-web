export function PantheonController(api) {
  const $ = (id) => document.getElementById(id);

  return {
    async loadPantheon() {
      try {
        const { deaths } = await api('/api/admin/pantheon');
        const tbl = $('pantheon-table');
        if (!tbl) return;
        
        tbl.innerHTML = '<tr><th>Nom</th><th>Niveau</th><th>Zone</th><th>Tué par</th><th>Date</th></tr>' +
          deaths.map(d => `<tr><td>${d.name}</td><td>${d.level}</td><td>${d.zone}</td><td>${d.killer}</td>
            <td>${new Date(d.died_at).toLocaleString('fr-FR')}</td></tr>`).join('');
      } catch (e) {
        console.error("Failed to load pantheon:", e);
      }
    },
    init() {
      // Use setTimeout to ensure the DOM is fully rendered before loading pantheon
      setTimeout(() => {
        this.loadPantheon();
      }, 0);
    }
  };
}
