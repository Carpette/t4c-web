// Colonnes redimensionnables de l'admin. Toute colonne marquée
// data-col="<nom unique>" reçoit une poignée sur son bord intérieur
// (data-bord="droite" pour une colonne de gauche, "gauche" pour une colonne
// de droite) ; la largeur choisie est mémorisée dans ce navigateur.
// Double-clic sur la poignée : largeur d'origine. Clavier : ← →.
// Un MutationObserver suit les colonnes créées ou retirées par petite-vue
// (v-if, changement de vue), sans code dans les composants.

const CLE = 't4c-admin-colonnes';
const MIN = 180;          // largeur minimale d'une colonne
const MIN_CENTRE = 360;   // place laissée au reste de l'écran
const PAS = 16;           // pas au clavier
// environnements sans ces API (tests headless sous Node) : colonnes inertes
const mobile = typeof matchMedia === 'function' ? matchMedia('(max-width: 760px)') : { matches: true, addEventListener() {} };

let largeurs = {};
try { largeurs = JSON.parse(localStorage.getItem(CLE)) || {}; } catch { largeurs = {}; }
function memoriser() {
  try { localStorage.setItem(CLE, JSON.stringify(largeurs)); } catch { /* stockage indisponible : réglage de session */ }
}

// largeur maximale : le parent moins les autres colonnes et la place du centre
function maximum(col) {
  const parent = col.parentElement;
  let autres = 0;
  for (const c of parent.querySelectorAll(':scope > [data-col]')) if (c !== col) autres += c.getBoundingClientRect().width;
  return Math.max(MIN, parent.clientWidth - autres - MIN_CENTRE);
}

// largeur mémorisée, bornée à la place disponible (écran plus petit que celui
// où elle a été choisie) ; parent masqué (onglet inactif) : pas de borne
function appliquer(col) {
  let l = largeurs[col.dataset.col];
  if (l && !mobile.matches) {
    if (col.parentElement?.clientWidth) l = Math.min(l, maximum(col));
    col.style.flex = `0 0 ${l}px`;
    col.style.width = `${l}px`;
    col.style.maxWidth = 'none';
  } else {
    col.style.flex = col.style.width = col.style.maxWidth = '';
  }
}

// le parent change de taille (fenêtre, onglet affiché) : on reborne ses colonnes
const suivis = new WeakSet();
const taille = typeof ResizeObserver === 'function' ? new ResizeObserver((entrees) => {
  for (const e of entrees) e.target.querySelectorAll(':scope > [data-col]').forEach(appliquer);
}) : { observe() {} };

function fixer(col, l) {
  largeurs[col.dataset.col] = Math.round(Math.min(maximum(col), Math.max(MIN, l)));
  appliquer(col);
}

function equiper(col) {
  if (!col.dataset.col) return;
  if (!col.querySelector(':scope > .cs-poignee')) {
    const p = document.createElement('div');
    p.className = 'cs-poignee';
    p.setAttribute('role', 'separator');
    p.setAttribute('aria-orientation', 'vertical');
    p.setAttribute('aria-label', 'Redimensionner la colonne (double-clic : largeur d’origine)');
    p.tabIndex = 0;
    col.appendChild(p);
  }
  const parent = col.parentElement;
  if (parent && !suivis.has(parent)) { suivis.add(parent); taille.observe(parent); }
  appliquer(col);
}

function desequiper(col) {
  col.querySelector(':scope > .cs-poignee')?.remove();
  col.style.flex = col.style.width = col.style.maxWidth = '';
}

const sens = (col) => (col.dataset.bord === 'gauche' ? -1 : 1);

let actif = false; // enter() peut être rappelé (reconnexion) : une seule installation

export function activerColonnes(racine = document.body) {
  if (actif || typeof MutationObserver !== 'function') return;
  actif = true;
  racine.querySelectorAll('[data-col]').forEach(equiper);
  new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === 'attributes') {
        if (m.target.dataset.col) equiper(m.target); else desequiper(m.target);
        continue;
      }
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        if (n.dataset.col) equiper(n);
        n.querySelectorAll?.('[data-col]').forEach(equiper);
      }
    }
  }).observe(racine, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-col'] });
  mobile.addEventListener('change', () => racine.querySelectorAll('[data-col]').forEach(appliquer));

  racine.addEventListener('pointerdown', (e) => {
    const p = e.target.closest?.('.cs-poignee');
    if (!p || e.button !== 0) return;
    e.preventDefault();
    const col = p.parentElement;
    const x0 = e.clientX, l0 = col.getBoundingClientRect().width, s = sens(col);
    p.setPointerCapture(e.pointerId);
    document.body.classList.add('cs-redim');
    const bouger = (ev) => fixer(col, l0 + (ev.clientX - x0) * s);
    const finir = () => {
      p.removeEventListener('pointermove', bouger);
      document.body.classList.remove('cs-redim');
      memoriser();
    };
    p.addEventListener('pointermove', bouger);
    p.addEventListener('pointerup', finir, { once: true });
    p.addEventListener('pointercancel', finir, { once: true });
  });
  racine.addEventListener('dblclick', (e) => {
    const p = e.target.closest?.('.cs-poignee');
    if (!p) return;
    delete largeurs[p.parentElement.dataset.col];
    appliquer(p.parentElement);
    memoriser();
  });
  racine.addEventListener('keydown', (e) => {
    const p = e.target.closest?.('.cs-poignee');
    if (!p || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    e.preventDefault();
    const col = p.parentElement;
    fixer(col, col.getBoundingClientRect().width + (e.key === 'ArrowRight' ? PAS : -PAS) * sens(col));
    memoriser();
  });
}
