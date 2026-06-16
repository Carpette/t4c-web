export function SidebarController() {
  return {
    activeTab: 'map', // Set the default active tab
    setActive(tab) {
      this.activeTab = tab;
      // Also hide all tab-content and show the active one
      document.querySelectorAll('.tab-content').forEach(tc => {
        tc.style.display = 'none';
      });
      const activeTabContent = document.getElementById(`tab-${tab}`);
      if (activeTabContent) {
        activeTabContent.style.display = 'block';
      }
    },
    init() {
      // Set the initial view
      this.setActive(this.activeTab);
    }
  };
}
