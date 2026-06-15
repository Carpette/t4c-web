export class EventBus {
  constructor() {
    this.listeners = new Map();
  }

  // S'abonner à un événement
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);
    
    // Retourne une fonction de désabonnement pour simplifier le cycle de vie
    return () => this.off(event, callback);
  }

  // Se désabonner d'un événement
  off(event, callback) {
    const set = this.listeners.get(event);
    if (set) {
      set.delete(callback);
      if (set.size === 0) {
        this.listeners.delete(event);
      }
    }
  }

  // Émettre un événement
  emit(event, data) {
    const set = this.listeners.get(event);
    if (set) {
      // Copie pour éviter des bugs si un callback se désabonne en cours de boucle
      const activeListeners = Array.from(set);
      for (const callback of activeListeners) {
        try {
          callback(data);
        } catch (err) {
          console.error(`Erreur lors de l'exécution du listener pour l'événement "${event}":`, err);
        }
      }
    }
  }
}

export const globalBus = new EventBus();