// Barre de sorts : TOUS les sorts appris, dans l'ordre des raccourcis (1 à 0
// attribués d'office, cf. UI.assignerRaccourcis). Clic gauche = comme la
// touche (visée, ou lancement immédiat d'un sort centré) ; clic droit = sort
// actif du mode combat (Ctrl).
import { uiStore, rawUiContainer } from '../../ui-store.js';
import { SPELL_ICONS, icone } from '../../icones.js';
import { globalBus } from '../../../event-bus.js';

const ORDRE = '1234567890';
const rang = (k) => (k == null ? 99 : ORDRE.includes(k) ? ORDRE.indexOf(k) : 10 + k.charCodeAt(0));

export function SpellbarController() {
  return {
    state: uiStore,
    get sorts() {
      const hotkeys = uiStore.hotkeys || {};
      return (uiStore.player.spells || [])
        .map(id => uiStore.spellDefs.find(s => s.id === id))
        .filter(Boolean)
        .map(sp => ({ ...sp, touche: Object.keys(hotkeys).find(k => hotkeys[k] === sp.id) }))
        .sort((a, b) => rang(a.touche) - rang(b.touche));
    },
    icone(sp) {
      const ui = rawUiContainer.instance;
      return ui ? ui.spellIconHtml(sp) : icone(SPELL_ICONS[sp.type] || 'etincelle');
    },
    // secondes de recharge restantes (0 : prêt)
    recharge(id) {
      const left = (uiStore.cds[id] || 0) - uiStore.now;
      return left > 0 ? Math.ceil(left) : 0;
    },
    // part de la recharge restante (0..1), pour le balayage
    balayage(id) {
      const left = (uiStore.cds[id] || 0) - uiStore.now, dur = uiStore.cdDur[id] || 0;
      return left > 0 && dur > 0 ? Math.min(1, left / dur) : 0;
    },
    manque(sp) { return (uiStore.player.mana ?? 0) < (sp.mana || 0); },
    titre(sp) {
      return `${sp.name} — ${sp.mana} mana`
        + (sp.touche ? ` — touche ${sp.touche.toUpperCase()}` : '')
        + (uiStore.activeSpell === sp.id ? ' — sort actif du mode combat' : '')
        + '\nClic : lancer (visée) · clic droit : sort actif du mode combat (Ctrl)';
    },
    lancer(id) { globalBus.emit('ui:sort', id); },
    basculer(id) {
      uiStore.activeSpell = uiStore.activeSpell === id ? null : id;
    },
  };
}
