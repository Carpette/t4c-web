// Page de la planche contact (voir planche.mjs). Rend chaque modèle du
// catalogue avec bake3d.js dans les deux styles (« net » et « retro »), sur
// un losange de case 192x96 pour juger l'échelle, à côté de sprites Flare.
import { Atelier3D } from '/js/admin/bake3d.js';

const S = '/src3d/';
const UM = S + 'ultimate_monsters/Ultimate Monsters/';
const ANI = S + 'ultimate_animated_animals/Ultimate Animated Animals - July 2021/glTF/';
const RPG = S + 'rpg_characters/RPG Characters - Nov 2020/glTF/';
const OUT = S + 'modular_character_outfits_fantasy/Modular Character Outfits - Fantasy[Standard]/Exports/glTF (Godot-Unreal)/Outfits/';
const KKS = S + 'kaykit_skeletons_1_1_free/KayKit_Skeletons_1.1_FREE/';
const KKS_ANIM = [KKS + 'Animations/gltf/Rig_Medium/Rig_Medium_General.glb', KKS + 'Animations/gltf/Rig_Medium/Rig_Medium_MovementBasic.glb'];
const UAL = [S + 'universal_animation_library/Universal Animation Library[Standard]/Unreal-Godot/UAL1_Standard.glb'];
const PROPS = S + 'fantasy_props_megakit/Exports/glTF/';
const NAT = S + 'stylized_nature_megakit/glTF/';
const KG = S + 'kenney_graveyard_kit_5_0/Models/GLB format/';
const RUI = S + 'ultimate_modular_ruins_pack/Ultimate Modular Ruins Pack - Aug 2021/FBX/';

// hauteur réelle en mètres ; clip = motif du clip de pose (repos)
const CATALOGUE = [
  ['Personnages (avatar / PNJ)', [
    { nom: 'UBC Superhero ♂ + UAL', url: S + 'universal_base_characters/Universal Base Characters[Standard]/Base Characters/Godot - UE/Superhero_Male_FullBody.gltf', anims: UAL, h: 1.8, clip: '^Idle_Loop$' },
    { nom: 'Outfit Rôdeur ♂', url: OUT + 'Male_Ranger.gltf', anims: UAL, h: 1.8, clip: '^Idle_Loop$' },
    { nom: 'Outfit Paysanne ♀', url: OUT + 'Female_Peasant.gltf', anims: UAL, h: 1.7, clip: '^Idle_Loop$' },
    { nom: 'RPG Guerrier', url: RPG + 'Warrior.gltf', h: 1.8, clip: '^idle$' },
    { nom: 'RPG Mage', url: RPG + 'Wizard.gltf', h: 1.8, clip: '^idle$' },
    { nom: 'RPG Voleur', url: RPG + 'Rogue.gltf', h: 1.75, clip: '^idle$' },
    { nom: 'Kenney Vampire', url: KG + 'character-vampire.glb', h: 1.8, clip: '^idle$' },
  ]],
  ['Créatures', [
    { nom: 'KayKit Squelette', url: KKS + 'characters/gltf/Skeleton_Warrior.glb', anims: KKS_ANIM, h: 1.8, clip: '^Idle_A$' },
    { nom: 'KayKit Squel. mage', url: KKS + 'characters/gltf/Skeleton_Mage.glb', anims: KKS_ANIM, h: 1.8, clip: '^Idle_A$' },
    { nom: 'Zombie (FBX)', url: S + 'zombie_by_quaternius/Zombie by @Quaternius/FBX/Zombie.fbx', texture: S + 'zombie_by_quaternius/Zombie by @Quaternius/Blends/ZombieTexture.png', h: 1.8, clip: 'ZombieIdle' },
    { nom: 'UM Orc', url: UM + 'Big/glTF/Orc.gltf', h: 1.9, clip: '^idle$' },
    { nom: 'UM Ninja (brigand ?)', url: UM + 'Big/glTF/Ninja.gltf', h: 1.75, clip: '^idle$' },
    { nom: 'UM Yeti (ogre ?)', url: UM + 'Big/glTF/Yeti.gltf', h: 2.6, clip: '^idle$' },
    { nom: 'UM Démon', url: UM + 'Flying/glTF/Demon.gltf', h: 2.0, clip: '^Flying_Idle$' },
    { nom: 'UM Fantôme', url: UM + 'Flying/glTF/Ghost.gltf', h: 1.6, clip: '^Flying_Idle$' },
    { nom: 'UM Dragon', url: UM + 'Flying/glTF/Dragon.gltf', h: 2.4, clip: '^Flying_Idle$' },
    { nom: 'UM Armabee (guêpe ?)', url: UM + 'Flying/glTF/Armabee.gltf', h: 1.0, clip: '^Flying_Idle$' },
    { nom: 'UM Goleling (golem ?)', url: UM + 'Flying/glTF/Goleling.gltf', h: 2.0, clip: '^Flying_Idle$' },
    { nom: 'Loup', url: ANI + 'Wolf.gltf', h: 0.95, clip: '^idle$' },
    { nom: 'Cerf', url: ANI + 'Stag.gltf', h: 1.9, clip: '^idle$' },
    { nom: 'Taureau (sanglier ?)', url: ANI + 'Bull.gltf', h: 1.6, clip: '^idle$' },
  ]],
  ['Décors', [
    { nom: 'Tonneau', url: PROPS + 'Barrel.gltf', h: 1.0 },
    { nom: 'Coffre', url: PROPS + 'Chest_Wood.gltf', h: 0.7 },
    { nom: 'Étal', url: PROPS + 'Stall_Empty.gltf', h: 2.4 },
    { nom: 'Kenney étal', url: S + 'kenney_fantasy_town_kit_2_0/Models/GLB format/stall-red.glb', module: 0.5 },
    { nom: 'Arbre', url: NAT + 'CommonTree_1.gltf', h: 5.5 },
    { nom: 'Pin', url: NAT + 'Pine_2.gltf', h: 6.5 },
    { nom: 'Arbre mort', url: NAT + 'DeadTree_1.gltf', h: 4.5 },
    { nom: 'Rocher', url: NAT + 'Rock_Medium_1.gltf', h: 1.1 },
    { nom: 'Mur village', url: S + 'medieval_village_megakit/Medieval Village MegaKit[Standard]/glTF/Wall_UnevenBrick_Window_Wide_Round.gltf', module: 2 },
    { nom: 'KayKit mur donjon', url: S + 'kaykit_dungeon_pack_1_1_free/KayKit_Dungeon_Pack_1.1_FREE/Assets/gltf/wall.gltf', module: 4 },
    { nom: 'Kenney crypte', url: KG + 'crypt.glb', module: 0.75 },
    { nom: 'Kenney tombe', url: KG + 'gravestone-cross.glb', module: 0.75 },
    { nom: 'Kenney tour', url: S + 'kenney_castle_kit/Models/GLB format/tower-square.glb', module: 0.5 },
    { nom: 'Ruines arche', url: RUI + 'Arch_Gothic.fbx', h: 4.0 },
    { nom: 'Ruines statue', url: RUI + 'Statue_Stag.fbx', h: 2.5 },
  ]],
];

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

// Références Flare : avatar composé + quelques monstres, même direction.
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
  for (const n of ['goblin', 'skeleton', 'zombie', 'hobgoblin', 'minotaur', 'wyvern', 'antlion']) {
    const def = man.enemies[n]; if (!def) continue;
    const [x, y, w, h, ox, oy] = frame(def, DIR);
    const c2 = document.createElement('canvas'); c2.width = w; c2.height = h;
    c2.getContext('2d').drawImage(await chargerImage('/assets/' + def.image), x, y, w, h, 0, 0, w, h);
    refs.push({ nom: 'Flare ' + n, canvas: c2, ox, oy });
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
  for (const style of ['net', 'retro']) {
    const sections = [['Référence : sprites Flare actuels', refs]];
    for (const [nom, entrees] of CATALOGUE) {
      const items = [];
      for (const e of entrees) {
        try {
          const m = await modele(e);
          items.push({ nom: e.nom, ...atelier.rendre(m, { dir: DIR, clip: e.clip, t: 0.3, style }) });
        } catch (err) {
          console.log('échec', e.nom, err.message);
          items.push({ nom: e.nom, erreur: true, ox: 0, oy: 100 });
        }
      }
      sections.push([nom, items]);
    }
    images['planche_' + style] = composer(`Atelier 3D — style « ${style} » — direction ${DIR} (SE), case 192×96`, sections).toDataURL('image/png');
  }

  // 8 directions + cycle de marche du squelette KayKit, face au squelette Flare
  const man = await (await fetch('/assets/manifest.json')).json();
  const sq = man.enemies.skeleton, img = await chargerImage('/assets/' + sq.image);
  const m = await modele(CATALOGUE[1][1][0]);
  const dirs = [], flare = [], marche = [];
  for (let d = 0; d < 8; d++) {
    dirs.push({ nom: 'dir ' + d, ...atelier.rendre(m, { dir: d, clip: '^Idle_A$', t: 0.3, style: 'retro' }) });
    const [x, y, w, h, ox, oy] = sq.anims.stance.fr[d][0];
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    c.getContext('2d').drawImage(img, x, y, w, h, 0, 0, w, h);
    flare.push({ nom: 'Flare dir ' + d, canvas: c, ox, oy });
  }
  const clipMarche = m.clips.find(c => /walk/i.test(c.name));
  for (let i = 0; i < 8; i++) marche.push({ nom: 'marche ' + i, ...atelier.rendre(m, { dir: DIR, clip: clipMarche, t: i * (clipMarche ? clipMarche.duration / 8 : 0), style: 'retro' }) });
  images.directions = composer('8 directions Flare et cycle de marche (KayKit Squelette, style retro)', [['Squelette 3D — 8 directions', dirs], ['Squelette Flare — 8 directions', flare], ['Marche (' + (clipMarche?.name || 'aucun clip') + ')', marche]]).toDataURL('image/png');
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
