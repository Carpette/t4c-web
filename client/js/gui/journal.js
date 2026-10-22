// Journal du personnage : les répliques des PNJ, regroupées par PNJ, et les
// mots-clés qu'elles citent (« ... ») — les pistes de quête façon T4C, où
// tout passe par la conversation. Conservé dans le navigateur, par personnage ;
// effacé à la mort (la mort est définitive, le journal aussi).
import { uiStore } from './ui-store.js';
import { globalBus } from '../event-bus.js';

const REPLIQUES_MAX = 30;   // par PNJ
const PNJ_MAX = 60;

const cle = () => `t4c_journal_${uiStore.player.name || '?'}`;

function sauver() {
  try { localStorage.setItem(cle(), JSON.stringify(uiStore.journal)); } catch { /* quota ou stockage bloqué */ }
}

// mots-clés cités entre guillemets français dans une réplique
export function motsCles(texte) {
  return [...String(texte).matchAll(/«\s*([^»]{1,40}?)\s*»/g)].map(m => m[1].trim()).filter(Boolean);
}

export function chargerJournal() {
  let j = [];
  try { j = JSON.parse(localStorage.getItem(cle()) || '[]'); } catch { j = []; }
  uiStore.journal = Array.isArray(j) ? j : [];
}

export function effacerJournal() {
  uiStore.journal = [];
  try { localStorage.removeItem(cle()); } catch { /* rien */ }
}

// une réplique de PNJ entendue (chat local) : { nom, texte, zone }
export function noterReplique({ nom, texte, zone }) {
  if (!nom || !texte) return;
  let pnj = uiStore.journal.find(p => p.nom === nom);
  if (!pnj) {
    pnj = { nom, zone: zone || '', repliques: [], mots: [] };
    uiStore.journal.unshift(pnj);
    if (uiStore.journal.length > PNJ_MAX) uiStore.journal.pop();
  } else {
    // PNJ le plus récent en tête
    uiStore.journal.splice(uiStore.journal.indexOf(pnj), 1);
    uiStore.journal.unshift(pnj);
  }
  if (zone) pnj.zone = zone;
  pnj.vu = Date.now();
  if (pnj.repliques[pnj.repliques.length - 1]?.texte !== texte) {
    pnj.repliques.push({ texte, quand: Date.now() });
    if (pnj.repliques.length > REPLIQUES_MAX) pnj.repliques.shift();
  }
  for (const m of motsCles(texte)) if (!pnj.mots.includes(m)) pnj.mots.push(m);
  sauver();
}

globalBus.on('net:npc-say', noterReplique);
