// Page de la planche contact (voir planche.mjs). Rend chaque modèle du
// catalogue avec bake3d.js, sur un losange de case 192x96 pour juger
// l'échelle, à côté de sprites Flare.
import { Atelier3D } from '/js/admin/bake3d.js';
import { MOBS } from '/shared/defs.js';
import { CATALOGUE3D } from '/js/admin/catalogue3d.js';

const S = '/src3d/';
// catalogue partagé avec l'onglet Atelier 3D de l'admin (chemins relatifs à /src3d/)
const CATALOGUE = CATALOGUE3D.map(([groupe, , entrees]) => [groupe, entrees.map(e => ({
  ...e, url: S + e.url, texture: e.texture && S + e.texture, anims: (e.anims || []).map(a => S + a),
}))]);

const DIR = 5;            // SE : trois-quarts face, comme la plupart des captures Flare
const LARG = 1900, CELL = 200, MARGE = 16;
const atelier = new Atelier3D();
const charges = new Map();

async function modele(e) {
  if (charges.has(e.url)) return charges.get(e.url);
  const m = await atelier.charger(e.url, { texture: e.texture });
  for (const a of e.anims || []) await atelier.ajouterAnimations(m, a);
  atelier.preparer(m, { hauteur: e.h, module: e.module, orientation: e.orientation || 0 });
  charges.set(e.url, m);
  return m;
}

function chargerImage(src) {
  return new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ko(new Error(src)); i.src = src; });
}

// Références Flare : avatar composé + monstres du jeu À LEUR TAILLE EN JEU
// (spriteScale de MOBS appliqué, comme entities2d.js), même direction.
async function refsFlare() {
  const man = await (await fetch('/assets/manifest.json')).json();
  const refs = [];
  const frame = (def, d) => (def.anims.stance || Object.values(def.anims)[0]).fr[d][0];
  const av = man.avatar.male, couches = ['default_feet', 'cloth_pants', 'default_hands', 'default_chest', 'head_short'].filter(c => av[c]);
  const cv = document.createElement('canvas'); cv.width = 300; cv.height = 300;
  const g = cv.getContext('2d');
  for (const c of couches) {
    const [x, y, w, h, ox, oy] = frame(av[c], DIR);
    g.drawImage(await chargerImage('/assets/' + av[c].image), x, y, w, h, 150 - ox, 250 - oy, w, h);
  }
  refs.push({ nom: 'Flare avatar', canvas: cv, ox: 150, oy: 250 });
  for (const cle of ['gobelin', 'squelette', 'zombie', 'orc', 'ogre', 'golem_pierre', 'araignee_geante']) {
    const mob = MOBS[cle], def = man.enemies[mob?.sprite]; if (!def) continue;
    const k = mob.spriteScale || 1;
    const [x, y, w, h, ox, oy] = frame(def, DIR);
    const c2 = document.createElement('canvas'); c2.width = Math.ceil(w * k); c2.height = Math.ceil(h * k);
    c2.getContext('2d').drawImage(await chargerImage('/assets/' + def.image), x, y, w, h, 0, 0, w * k, h * k);
    refs.push({ nom: `${mob.name} (${mob.sprite}${k !== 1 ? ' ×' + k : ''})`, canvas: c2, ox: Math.round(ox * k), oy: Math.round(oy * k) });
  }
  return refs;
}

// Dessine des lignes de vignettes (sprite ancré aux pieds sur un losange).
function composer(titre, sections) {
  const lignes = [];
  const larg = it => Math.max(CELL, (it.canvas ? Math.max(it.ox, it.canvas.width - it.ox) * 2 : 0) + 12);
  for (const [nom, items] of sections) {
    lignes.push({ titre: nom });
    let cur = [], x = 0;
    for (const it of items) {
      if (cur.length && x + larg(it) > LARG - 2 * MARGE) { lignes.push({ items: cur }); cur = []; x = 0; }
      cur.push(it); x += larg(it);
    }
    if (cur.length) lignes.push({ items: cur });
  }
  const hauteurs = lignes.map(l => l.titre ? 34 : Math.max(150, ...l.items.map(it => it.oy + 60)));
  const cv = document.createElement('canvas');
  cv.width = LARG; cv.height = 50 + hauteurs.reduce((a, b) => a + b, 0) + MARGE;
  const g = cv.getContext('2d');
  g.fillStyle = '#1d1b22'; g.fillRect(0, 0, cv.width, cv.height);
  g.fillStyle = '#eee'; g.font = 'bold 20px sans-serif'; g.fillText(titre, MARGE, 32);
  let y = 50;
  lignes.forEach((l, k) => {
    if (l.titre) { g.fillStyle = '#c9a86a'; g.font = 'bold 16px sans-serif'; g.fillText(l.titre, MARGE, y + 22); }
    else l.items.reduce((x0, it) => {
      const cx = x0 + larg(it) / 2, pied = y + hauteurs[k] - 40;
      g.beginPath(); g.moveTo(cx, pied - 48); g.lineTo(cx + 96, pied); g.lineTo(cx, pied + 48); g.lineTo(cx - 96, pied); g.closePath();
      g.fillStyle = '#3c4a2e'; g.fill(); g.strokeStyle = '#56663f'; g.stroke();
      if (it.canvas) g.drawImage(it.canvas, cx - it.ox, pied - it.oy);
      g.fillStyle = it.erreur ? '#e66' : '#bbb'; g.font = '12px sans-serif';
      const txt = it.erreur ? '✘ ' + it.nom : it.nom;
      g.fillText(txt, cx - g.measureText(txt).width / 2, pied + 34);
      return x0 + larg(it);
    }, MARGE);
    y += hauteurs[k];
  });
  return cv;
}

async function planche() {
  const refs = await refsFlare();
  const images = {};
  {
    const sections = [['Référence : sprites Flare actuels', refs]];
    for (const [nom, entrees] of CATALOGUE) {
      const items = [];
      for (const e of entrees) {
        try {
          const m = await modele(e);
          items.push({ nom: e.nom, ...atelier.rendre(m, { dir: DIR, clip: e.clip, t: 0.3 }) });
        } catch (err) {
          console.log('échec', e.nom, err.message);
          items.push({ nom: e.nom, erreur: true, ox: 0, oy: 100 });
        }
      }
      sections.push([nom, items]);
    }
    images.planche = composer(`Atelier 3D — direction ${DIR} (SE), case 192×96`, sections).toDataURL('image/png');
  }

  // 8 directions + cycle de marche de l'humain Quaternius (Rôdeur + UAL), face à l'avatar Flare
  const man = await (await fetch('/assets/manifest.json')).json();
  const av = man.avatar.male, couches = ['default_feet', 'cloth_pants', 'default_hands', 'default_chest', 'head_short'].filter(c => av[c]);
  const imgs = await Promise.all(couches.map(c => chargerImage('/assets/' + av[c].image)));
  const m = await modele(CATALOGUE[0][1][1]);
  const dirs = [], flare = [], marche = [];
  for (let d = 0; d < 8; d++) {
    dirs.push({ nom: 'dir ' + d, ...atelier.rendre(m, { dir: d, clip: '^Idle_Loop$', t: 0.3 }) });
    const c = document.createElement('canvas'); c.width = 300; c.height = 300;
    couches.forEach((n, i) => {
      const [x, y, w, h, ox, oy] = av[n].anims.stance.fr[d][0];
      c.getContext('2d').drawImage(imgs[i], x, y, w, h, 150 - ox, 250 - oy, w, h);
    });
    flare.push({ nom: 'Flare dir ' + d, canvas: c, ox: 150, oy: 250 });
  }
  const clipMarche = m.clips.find(c => /^Walk_Loop$/i.test(c.name));
  for (let i = 0; i < 8; i++) marche.push({ nom: 'marche ' + i, ...atelier.rendre(m, { dir: DIR, clip: clipMarche, t: i * (clipMarche ? clipMarche.duration / 8 : 0) }) });
  images.directions = composer('8 directions Flare et cycle de marche (Quaternius Rôdeur + UAL)', [['Rôdeur 3D — 8 directions', dirs], ['Avatar Flare — 8 directions', flare], ['Marche (' + (clipMarche?.name || 'aucun clip') + ')', marche]]).toDataURL('image/png');
  return { images };
}

// Sonde : clips disponibles et taille brute (unités du fichier) de chaque
// modèle — pour choisir les motifs de clip et la hauteur/le module d'un pack.
async function sonde() {
  const { Box3, Vector3 } = await import('three');
  const res = {};
  for (const [, entrees] of CATALOGUE) for (const e of entrees) {
    try {
      const m = await atelier.charger(e.url, { texture: e.texture });
      const t = new Box3().setFromObject(m.racine, true).getSize(new Vector3());
      res[e.nom] = `${t.x.toFixed(2)}x${t.y.toFixed(2)}x${t.z.toFixed(2)} | ` + m.clips.map(c => c.name).join(', ');
    } catch (err) { res[e.nom] = 'ERREUR ' + err.message; }
  }
  return { sonde: res };
}

// Affichage dans la page (consultation dans un navigateur via --serveur) ;
// le pilote headless, lui, lit window.__fini.
function afficher(r) {
  if (r.erreur) document.body.insertAdjacentHTML('beforeend', '<pre style="color:#e66"></pre>');
  if (r.erreur) document.body.lastElementChild.textContent = r.erreur;
  for (const src of Object.values(r.images || {})) {
    const img = document.createElement('img');
    img.src = src; img.style.cssText = 'display:block;max-width:100%;margin-bottom:24px';
    document.body.append(img);
  }
  if (r.sonde) {
    const pre = document.createElement('pre');
    pre.textContent = JSON.stringify(r.sonde, null, 1);
    document.body.append(pre);
  }
}

document.body.insertAdjacentHTML('beforeend', '<p id="attente" style="padding:16px">Rendu en cours (une trentaine de secondes)…</p>');
(location.search.includes('sonde') ? sonde() : planche())
  .catch(err => ({ erreur: err.stack || String(err) }))
  .then(r => { document.getElementById('attente')?.remove(); afficher(r); window.__fini = r; });
