// Musique d'ambiance : un fichier en boucle, choisi par le serveur selon la
// zone (content/music.json, administrable). Les navigateurs bloquent la
// lecture automatique avant la première interaction : dans ce cas, la
// lecture démarre au premier clic ou à la première touche.
import { settings } from './settings.js';

let audio = null;
let currentFile = null;
let armed = false;

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

function apply() {
  if (!settings.musicOn || !currentFile) { stop(); return; }
  if (audio && audio._file === currentFile) return; // déjà en cours
  stop();
  audio = new Audio(`/assets/music/${encodeURIComponent(currentFile)}`);
  audio._file = currentFile;
  audio.loop = true;
  audio.volume = 0.4;
  audio.play().catch(() => startOnGesture());
}

// Change la piste en cours (null = silence)
export function playMusic(file) {
  currentFile = file || null;
  apply();
}

// À appeler quand le réglage « Musique » change
export function refreshMusic() { apply(); }
