// En-tête de l'écran courant (titre, description, sous-onglets) ; pour un écran
// « bientôt », la liste de ce qui est prévu tient lieu de contenu.
import { consoleEtat, ecranParId, tabDe, allerA, niveauEcran } from '../../console.js';

export function PageController() {
  return {
    etat: consoleEtat,
    get ecran() { return ecranParId(this.etat.ecran); },
    get lecture() { return !!this.ecran && !this.ecran.bientot && niveauEcran(this.ecran) < 2; },
    get tab() { return this.ecran ? tabDe(this.ecran) : null; },
    choisir(tab) { allerA(this.ecran.id, tab); },
  };
}
