import { createApp } from 'https://unpkg.com/petite-vue?module';

class GuiManagerAdmin {
  constructor(api) {
    this.api = api;
    this.controllers = {};
    this.loaded = new Set();
  }

  registerController(name, controller) {
    this.controllers[name] = controller;
  }

  async init(componentsToLoad) {
    for (const { name, selector } of componentsToLoad) {
      if (!this.loaded.has(name)) {
        await this.loadComponent(name, selector);
        this.loaded.add(name);
      }
    }
  }

  async loadComponent(name, selector) {
    const container = document.querySelector(selector);
    if (!container) {
      console.error(`Container with selector "${selector}" not found for component "${name}".`);
      return;
    }

    try {
      const res = await fetch(`/js/admin/components/${name}/${name}.html`);
      if (!res.ok) throw new Error(`Template not found: ${res.statusText}`);
      const html = await res.text();

      container.innerHTML = html;

      if (this.controllers[name]) {
        createApp(this.controllers[name](this.api)).mount(container);
      } else {
        createApp({}).mount(container);
      }
    } catch (err) {
      console.error(`Error initializing GUI component [${name}]:`, err);
    }
  }
}

export { GuiManagerAdmin };
