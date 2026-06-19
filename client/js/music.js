// Musique d'ambiance, choisie par le serveur selon la zone/sous-zone
// (content/music.json, administrable). Le serveur RÉSOUT l'emplacement avant de
// l'envoyer ; le message `music` (ou le champ `music` du message `zone`) transporte
// donc l'une de DEUX formes :
//   - un SLOT mono { legacy, new }  : une piste par variante (jouée en BOUCLE) ;
//   - un GROUPE   { new: [a, b, …], legacy } : `new` est une LISTE (pack moderne) et
//     `legacy` une seule piste (pack original). On reconnaît un groupe au fait que
//     son `new` est un tableau.
// Chaque variante correspond au pack choisi par le joueur (musicPack, « new » par
// défaut, repli sur l'autre si vide).
//   - GROUPE + pack 'new'    : SHUFFLE — une piste tirée au hasard à la réception,
//     puis enchaînement (playlist) sur l'événement `ended`, sans répétition immédiate.
//   - GROUPE + pack 'legacy' : la piste `legacy` unique en boucle (repli sur une piste
//     de `new` si legacy absent).
//   - SLOT mono ou chaîne (ancien format) : comportement inchangé, en boucle.
// Transitions (entre morceaux d'une playlist ET entre zones) : CROSS-FADE court — on
// baisse le volume de l'audio sortant pendant qu'on monte celui de l'entrant, au lieu
// d'une coupure sèche. Anti-redémarrage : si l'emplacement reçu est identique à celui
// en cours (même groupe, ou même fichier de slot), on NE redémarre NI ne re-shuffle.
// Les navigateurs bloquent la lecture automatique avant la première interaction :
// dans ce cas, la lecture démarre au premier clic ou touche.
import { settings } from './settings.js';

const FADE_MS = 700;          // durée du cross-fade (entrée/sortie)
const FADE_STEP_MS = 50;      // cadence du fondu (pas de boucle par frame)

let audio = null;             // audio ENTRANT (la piste en cours une fois le fondu fini)
let fadingOut = null;         // audio SORTANT pendant un cross-fade (au plus un)
let fadeTimer = null;         // intervalle du cross-fade en cours
let armed = false;            // un geste utilisateur est attendu pour (re)lancer la lecture

// Emplacement courant tel que reçu (slot { legacy, new } | groupe | chaîne | null).
let currentSlot = null;
// Pour un groupe joué en mode shuffle : la liste de pistes et le dernier fichier joué
// (pour éviter la répétition immédiate lors de l'enchaînement).
let playlist = null;          // tableau de fichiers (groupe, pack 'new') ou null
let lastPlayed = null;        // dernier fichier joué de la playlist
let lastPackWasShuffle = false; // dernier mode appliqué (playlist shuffle vs boucle)

// ----- détection de forme -----
const isGroup = (s) => s && typeof s === 'object' && Array.isArray(s.new);

// Clé d'IDENTITÉ d'un emplacement, pour l'anti-redémarrage : deux emplacements
// « identiques » (même groupe / même couple de fichiers / même chaîne) ne doivent
// pas couper la lecture en cours. On ne compare PAS la piste tirée au sort (qui
// varie) mais la SOURCE : le groupe entier, ou le slot.
function slotKey(s) {
  if (!s) return 'none';
  if (typeof s === 'string') return 's:' + s;
  if (isGroup(s)) return 'g:' + JSON.stringify({ new: s.new, legacy: s.legacy || null });
  return 'm:' + (s.legacy || '') + '|' + (s.new || '');
}
let currentKey = 'none';

// ----- choix du fichier à jouer -----
// gain effectif de la musique : volume maître × volume musique, borné 0..1
function musicGain() {
  const master = Number.isFinite(+settings.masterVolume) ? +settings.masterVolume : 1;
  const music = Number.isFinite(+settings.musicVolume) ? +settings.musicVolume : 0.6;
  return Math.max(0, Math.min(1, master * music));
}

// la variante d'un SLOT mono selon le pack (repli sur l'autre si absente)
function pickSlotFile(slot) {
  if (typeof slot === 'string') return slot; // ancien format
  return settings.musicPack === 'legacy'
    ? (slot.legacy || slot.new || null)
    : (slot.new || slot.legacy || null);
}

// la prochaine piste d'une playlist (groupe, pack 'new'), en évitant la répétition
// immédiate quand il y a au moins deux morceaux. Tirage uniforme parmi les autres.
function pickNextFromPlaylist() {
  if (!playlist || !playlist.length) return null;
  if (playlist.length === 1) return playlist[0];
  let next;
  do { next = playlist[Math.floor(Math.random() * playlist.length)]; }
  while (next === lastPlayed);
  return next;
}

// ----- mécanique audio -----
// crée et lance un élément Audio pour `file`, en boucle ou non, au gain courant.
// loop=false ⇒ on enchaînera nous-mêmes sur `ended` (playlist de groupe).
function makeAudio(file, loop) {
  const a = new Audio(`/assets/music/${encodeURIComponent(file)}`);
  a._file = file;
  a.loop = loop;
  a.volume = musicGain();
  if (!loop) a.addEventListener('ended', onTrackEnded);
  return a;
}

// fin d'un morceau de playlist : enchaîne (cross-fade) sur une autre piste du groupe.
function onTrackEnded() {
  if (!playlist) return;        // plus en mode playlist : rien à enchaîner
  const next = pickNextFromPlaylist();
  if (next) startTrack(next, false);
}

// arrête net et libère un élément Audio (retire l'écouteur `ended` posé par makeAudio).
function disposeAudio(a) {
  if (!a) return;
  a.pause();
  a.removeEventListener('ended', onTrackEnded);
  a.src = '';
}

// termine immédiatement un cross-fade éventuellement en cours (libère le sortant).
function endFade() {
  if (fadeTimer) { clearInterval(fadeTimer); fadeTimer = null; }
  if (fadingOut) { disposeAudio(fadingOut); fadingOut = null; }
}

// Cross-fade : `incoming` devient l'audio courant ; l'ancien `audio` s'éteint en
// fondu. UN seul sortant à la fois (un fondu déjà en cours est tranché net avant).
// Pas d'allocation par frame : un intervalle borné fait varier les volumes.
function crossfadeTo(incoming) {
  endFade(); // un fondu antérieur n'est jamais laissé en suspens
  const outgoing = audio;
  audio = incoming;
  const target = musicGain();
  if (!outgoing) { audio.volume = target; return; } // rien à fondre : volume plein

  fadingOut = outgoing;
  audio.volume = 0;
  const t0 = Date.now();
  fadeTimer = setInterval(() => {
    const k = Math.min(1, (Date.now() - t0) / FADE_MS); // progression 0..1
    const g = musicGain(); // suit les réglages même pendant le fondu
    if (audio) audio.volume = g * k;
    if (fadingOut) fadingOut.volume = g * (1 - k);
    if (k >= 1) endFade();
  }, FADE_STEP_MS);
}

// (Re)lance la lecture sur `file` avec un cross-fade depuis la piste en cours.
// `loop` : false en mode playlist (on enchaîne sur `ended`), true sinon.
function startTrack(file, loop) {
  if (!file) { stopAll(); return; }
  lastPlayed = file;
  const next = makeAudio(file, loop);
  crossfadeTo(next);
  next.play().catch(() => startOnGesture());
}

// coupe toute la musique (sortant + entrant) et oublie la playlist.
function stopAll() {
  endFade();
  if (audio) { disposeAudio(audio); audio = null; }
}

function startOnGesture() {
  if (armed) return;
  armed = true;
  const tryPlay = () => {
    audio?.play().then(() => {
      window.removeEventListener('pointerdown', tryPlay);
      window.removeEventListener('keydown', tryPlay);
      armed = false;
    }).catch(() => { /* toujours bloqué : on retentera au prochain geste */ });
  };
  window.addEventListener('pointerdown', tryPlay);
  window.addEventListener('keydown', tryPlay);
}

// Applique l'emplacement courant : choisit le mode (playlist shuffle vs boucle) et la
// piste de départ, puis (re)lance avec cross-fade. Anti-redémarrage : un appel qui ne
// change ni l'emplacement (même clé) ni le besoin de couper se contente de rafraîchir
// le volume — la piste en cours et le shuffle ne sont PAS interrompus.
function apply(slotChanged) {
  // musique coupée dans les réglages : silence (mais on garde currentSlot/Key)
  if (!settings.musicOn || !currentSlot) { stopAll(); playlist = null; lastPackWasShuffle = false; return; }

  const group = isGroup(currentSlot);
  const shuffle = group && settings.musicPack !== 'legacy' && currentSlot.new.length > 0;
  lastPackWasShuffle = shuffle; // mémorise le mode pour que refreshMusic détecte un changement

  // déjà en train de jouer le bon emplacement et rien n'a changé d'identité : on ne
  // touche à rien (sinon les allers-retours rapides entre zones couperaient/relanceraient)
  if (!slotChanged && audio) {
    if (audio) audio.volume = musicGain(); // suit master/musicVolume
    if (fadingOut) fadingOut.volume = musicGain();
    return;
  }

  if (shuffle) {
    // groupe, pack 'new' : playlist tirée au sort, enchaînée sur `ended` (pas de loop)
    playlist = currentSlot.new.slice();
    const first = pickNextFromPlaylist();
    startTrack(first, false);
  } else {
    // boucle simple : slot mono, ancien format, ou groupe en pack 'legacy'
    playlist = null;
    let file;
    if (group) file = currentSlot.legacy || currentSlot.new[0] || null; // legacy unique, repli new
    else file = pickSlotFile(currentSlot);
    startTrack(file, true);
  }
}

// Change l'emplacement en cours (slot { legacy, new }, groupe { new:[…], legacy },
// fichier seul, ou null = silence). Pousse par le serveur (message `music`/`zone`).
export function playMusic(slot) {
  const next = slot || null;
  const key = slotKey(next);
  const changed = key !== currentKey;
  currentSlot = next;
  currentKey = key;
  apply(changed);
}

// À appeler quand un réglage musique change (activation, pack, volume) : ne change pas
// l'emplacement, donc ne redémarre/ne re-shuffle pas tant que la source est la même —
// SAUF si le pack bascule entre playlist (new) et boucle (legacy), où il faut réappliquer.
export function refreshMusic() {
  const wantShuffle = isGroup(currentSlot) && settings.musicPack !== 'legacy' && currentSlot.new.length > 0;
  const modeChanged = wantShuffle !== lastPackWasShuffle;
  lastPackWasShuffle = wantShuffle;
  apply(modeChanged);
}
