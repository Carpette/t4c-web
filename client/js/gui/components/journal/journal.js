// Panneau Journal (J) : PNJ rencontrés, leurs répliques et les pistes citées.
import { uiStore } from '../../ui-store.js';
import { globalBus } from '../../../event-bus.js';
import { normalize } from '../../../../../shared/mots-cles.js';

export function JournalController() {
  return {
    state: uiStore,
    filtre: '',
    ouvert: null,
    get pnjs() {
      const f = normalize(this.filtre.trim());
      if (!f) return uiStore.journal;
      return uiStore.journal.filter(p => normalize(p.nom).includes(f) || p.mots.some(m => normalize(m).includes(f))
        || p.repliques.some(r => normalize(r.texte).includes(f)));
    },
    // dit le mot-clé en chat local (le PNJ doit être à portée d'oreille)
    dire(mot) { globalBus.emit('ui:send-chat', mot); },
  };
}
