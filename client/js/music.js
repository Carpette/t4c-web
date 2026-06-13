// Musique d'ambiance : un fichier en boucle, choisi par le serveur selon la
// zone (content/music.json, administrable). Chaque emplacement propose deux
// variantes { legacy, new } : le joueur choisit son pack dans les paramètres
// (nouvelles musiques par défaut), avec repli sur l'autre variante si le pack
// choisi n'a rien pour cette zone.
// Les navigateurs bloquent la lecture automatique avant la première
// interaction : dans ce cas, la lecture démarre au premier clic ou touche.
import { settings } from './settings.js';

let audio = null;
let currentSlot = null; // { legacy, new } | null
let armed = false;

// la variante à jouer selon le pack choisi (repli sur l'autre si absente)
function pickFile() {
  if (!currentSlot) return null;
  if (typeof currentSlot === 'string') return currentSlot; // ancien format
  return settings.musicPack === 'legacy'
    ? (currentSlot.legacy || currentSlot.new)
    : (currentSlot.new || currentSlot.legacy);
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

function stop() {
  if (audio) { audio.pause(); audio.src = ''; audio = null; }
}

// gain effectif de la musique : volume maître × volume musique, borné 0..1
function musicGain() {
  const master = Number.isFinite(+settings.masterVolume) ? +settings.masterVolume : 1;
  const music = Number.isFinite(+settings.musicVolume) ? +settings.musicVolume : 0.6;
  return Math.max(0, Math.min(1, master * music));
}

function apply() {
  const file = settings.musicOn ? pickFile() : null;
  if (!file) { stop(); return; }
  if (audio && audio._file === file) { audio.volume = musicGain(); return; } // déjà en cours : on rafraîchit juste le volume
  stop();
  audio = new Audio(`/assets/music/${encodeURIComponent(file)}`);
  audio._file = file;
  audio.loop = true;
  audio.volume = musicGain();
  audio.play().catch(() => startOnGesture());
}

// Change la piste en cours (slot { legacy, new }, fichier seul, ou null = silence)
export function playMusic(slot) {
  currentSlot = slot || null;
  apply();
}

// À appeler quand un réglage musique change (activation, pack)
export function refreshMusic() { apply(); }
