// Rend les fenêtres de verre (.login-box) déplaçables par leur barre de titre.
// Purement esthétique : déplacer le panneau fait jouer la réfraction « verre
// liquide » sur différentes zones du fond. La position est gardée par fenêtre
// via une translation CSS ; un double-clic sur le titre la recentre.
const offsets = new WeakMap(); // box -> { dx, dy }

function apply(box, o) {
  box.style.transform = `translate(${o.dx}px, ${o.dy}px)`;
}

function startDrag(box, handle) {
  handle.addEventListener('pointerdown', (e) => {
    // on n'amorce pas un glisser depuis un contrôle (bouton, curseur...)
    if (e.target.closest('button, input, select, textarea, a')) return;
    e.preventDefault();
    const o = offsets.get(box) || { dx: 0, dy: 0 };
    const x0 = e.clientX, y0 = e.clientY, dx0 = o.dx, dy0 = o.dy;
    handle.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const o2 = { dx: dx0 + (ev.clientX - x0), dy: dy0 + (ev.clientY - y0) };
      offsets.set(box, o2);
      apply(box, o2);
    };
    const up = (ev) => {
      handle.releasePointerCapture?.(ev.pointerId);
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  });
  // double-clic sur le titre : recentrage
  handle.addEventListener('dblclick', () => {
    const o = { dx: 0, dy: 0 };
    offsets.set(box, o);
    apply(box, o);
  });
}

// À appeler une fois : équipe toutes les fenêtres de verre présentes.
export function initDraggableWindows() {
  for (const box of document.querySelectorAll('.login-box')) {
    const handle = box.querySelector('h1');
    if (handle) startDrag(box, handle);
  }
}
