export function ContentController(api) {
  const $ = (id) => document.getElementById(id);

  return {
    async loadContent() {
      try {
        const data = await api(`/api/admin/content/${$('content-file').value}`);
        $('content-editor').value = JSON.stringify(data, null, 2);
        $('content-msg').textContent = 'Chargé.';
      } catch (e) {
        $('content-msg').textContent = '✘ ' + e.message;
      }
    },
    async saveContent() {
      try {
        const data = JSON.parse($('content-editor').value);
        const r = await api(`/api/admin/content/${$('content-file').value}`, 'PUT', data);
        $('content-msg').textContent = '✔ Enregistré. ' + (r.note || '');
      } catch (e) {
        $('content-msg').textContent = '✘ ' + e.message;
      }
    },
    init() {
      // Use setTimeout to ensure the DOM is fully rendered before loading initial content
      setTimeout(() => {
        this.loadContent();
      }, 0);
    }
  };
}
