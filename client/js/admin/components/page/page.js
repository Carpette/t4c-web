// En-tête de l'écran courant (titre, description, sous-onglets) ; pour un écran
// « bientôt », la liste de ce qui est prévu tient lieu de contenu.
import { consoleEtat, ecranParId, tabDe, allerA } from '../../console.js';

export function PageController() {
  return {
    etat: consoleEtat,
    get ecran() { return ecranParId(this.etat.ecran); },
    get tab() { return this.ecran ? tabDe(this.ecran) : null; },
    choisir(tab) { allerA(this.ecran.id, tab); },
  };
}
