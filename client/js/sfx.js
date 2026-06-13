// Effets sonores : moteur WebAudio SANS fichiers (oscillateurs + bruit filtré),
// en attendant le vrai pack de sons.
//
// ARCHITECTURE DE REMPLACEMENT : pour chaque son, on cherche d'abord un vrai
// fichier dans /assets/sfx/ — soit via le manifest optionnel
// /assets/sfx/manifest.json ({ "nom": "fichier.ogg", ... }), soit en sondant
// /assets/sfx/<nom>.ogg puis .mp3. Si trouvé, le fichier PRIME sur la synthèse,
// sans changer une ligne de code : il suffit de déposer le pack dans
// client/assets/sfx/. Sinon, repli sur la synthèse ci-dessous.
//
// Noms de sons reconnus (déposez des fichiers portant ces noms) :
//   cast_feu, impact_feu, cast_eau, impact_eau, cast_air, impact_air,
//   cast_terre, impact_terre, cast_poison, impact_poison, cast_lumiere,
//   cast_arcane, impact_arcane, cast_neutre, impact_neutre, drain,
//   soin, buff, malediction, coup, parade, mort, coffre, levelup, or
//
// Règles navigateur : l'AudioContext n'est créé/réveillé qu'au premier geste
// utilisateur (pointerdown/keydown). Onglet en arrière-plan : coupure totale.
import { settings } from './settings.js';

let ctx = null;           // AudioContext (créé au premier geste)
let master = null;        // gain global (volume des paramètres)
let noiseBuf = null;      // 1 s de bruit blanc pré-calculé
let manifest = null;      // mapping nom -> fichier (optionnel)
let manifestLoaded = false;
const files = new Map();  // nom -> AudioBuffer (fichier décodé) | 'none' (synthèse)

function volume() {
  const v = Number.isFinite(+settings.sfxVolume) ? +settings.sfxVolume : 0.8;
  const master = Number.isFinite(+settings.masterVolume) ? +settings.masterVolume : 1;
  return Math.max(0, Math.min(1, master * v)); // volume maître × volume des effets
}

function ensureCtx() {
  if (ctx) return true;
  const AC = (typeof window !== 'undefined') && (window.AudioContext || window.webkitAudioContext);
  if (!AC) return false; // environnement sans WebAudio (tests headless)
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = volume();
  master.connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return true;
}

// premier geste : crée/réveille le contexte (politique d'autoplay)
function arm() {
  if (typeof window === 'undefined' || !window.addEventListener) return;
  const wake = () => { if (ensureCtx() && ctx.state === 'suspended') ctx.resume().catch(() => {}); };
  window.addEventListener('pointerdown', wake);
  window.addEventListener('keydown', wake);
  // onglet en arrière-plan : silence total, reprise au retour
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('visibilitychange', () => {
      if (!master) return;
      master.gain.value = document.hidden ? 0 : volume();
    });
  }
}
arm();

// volume modifié dans les paramètres
export function refreshSfx() {
  if (master && !(typeof document !== 'undefined' && document.hidden)) master.gain.value = volume();
}

// ---------- Fichiers réels (prioritaires sur la synthèse) ----------
async function loadManifest() {
  manifestLoaded = true;
  try {
    const r = await fetch('/assets/sfx/manifest.json');
    if (r.ok) manifest = await r.json();
  } catch { /* pas de manifest : on sondera fichier par fichier */ }
}

async function probe(name) {
  files.set(name, 'none'); // en attendant : synthèse (remplacé si fichier trouvé)
  if (!manifestLoaded) await loadManifest();
  const candidates = manifest?.[name]
    ? [`/assets/sfx/${manifest[name]}`]
    : [`/assets/sfx/${name}.ogg`, `/assets/sfx/${name}.mp3`];
  for (const url of candidates) {
    try {
      const r = await fetch(url);
      if (!r.ok) continue;
      const buf = await ctx.decodeAudioData(await r.arrayBuffer());
      files.set(name, buf);
      return;
    } catch { /* fichier absent ou indécodable : candidat suivant */ }
  }
}

// ---------- Briques de synthèse ----------
// tonalité : oscillateur avec enveloppe et glissando optionnel
function tone(t0, { type = 'sine', f = 440, f1 = null, dur = 0.2, g = 0.2, a = 0.005 }) {
  const o = ctx.createOscillator(), env = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t0);
  if (f1 != null) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(g, t0 + a);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(env); env.connect(master);
  o.start(t0); o.stop(t0 + dur + 0.02);
}

// bruit filtré : souffle, craquement, percussion
function noise(t0, { type = 'lowpass', f = 800, f1 = null, q = 1, dur = 0.2, g = 0.2, a = 0.005 }) {
  const src = ctx.createBufferSource(), flt = ctx.createBiquadFilter(), env = ctx.createGain();
  src.buffer = noiseBuf; src.loop = true;
  flt.type = type; flt.Q.value = q;
  flt.frequency.setValueAtTime(f, t0);
  if (f1 != null) flt.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(g, t0 + a);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(flt); flt.connect(env); env.connect(master);
  src.start(t0, Math.random()); src.stop(t0 + dur + 0.02);
}

// ---------- Recettes par son ----------
const SYNTH = {
  // feu : whoosh grave qui monte, impact soufflé
  cast_feu:    (t) => noise(t, { f: 180, f1: 950, q: 2, dur: 0.28, g: 0.25 }),
  impact_feu:  (t) => { noise(t, { f: 1400, f1: 200, dur: 0.3, g: 0.3 }); tone(t, { type: 'sawtooth', f: 200, f1: 55, dur: 0.25, g: 0.12 }); },
  // glace : pings cristallins, éclats de verre
  cast_eau:    (t) => { tone(t, { f: 1750, dur: 0.16, g: 0.12 }); tone(t + 0.05, { f: 2350, dur: 0.14, g: 0.09 }); },
  impact_eau:  (t) => { for (let i = 0; i < 3; i++) tone(t + i * 0.045, { f: 2900 - i * 500 - Math.random() * 250, dur: 0.1, g: 0.1 }); noise(t, { type: 'highpass', f: 3200, dur: 0.12, g: 0.07 }); },
  // éclair : crack sec
  cast_air:    (t) => noise(t, { type: 'highpass', f: 900, dur: 0.07, g: 0.2, a: 0.001 }),
  impact_air:  (t) => { noise(t, { type: 'highpass', f: 1300, dur: 0.14, g: 0.35, a: 0.001 }); tone(t, { type: 'square', f: 110, f1: 45, dur: 0.12, g: 0.12, a: 0.001 }); },
  // terre : coup sourd, gravats
  cast_terre:  (t) => tone(t, { type: 'sine', f: 95, f1: 42, dur: 0.3, g: 0.3 }),
  impact_terre:(t) => { tone(t, { type: 'sine', f: 80, f1: 36, dur: 0.32, g: 0.35 }); noise(t, { f: 320, f1: 110, dur: 0.3, g: 0.2 }); },
  // poison : glouglou discret
  cast_poison: (t) => { for (let i = 0; i < 3; i++) tone(t + i * 0.07, { f: 260 + i * 60, f1: 430 + i * 70, dur: 0.07, g: 0.08 }); },
  impact_poison:(t) => { for (let i = 0; i < 4; i++) tone(t + i * 0.06, { f: 300 + Math.random() * 160, f1: 520, dur: 0.06, g: 0.07 }); },
  // lumière / soin : carillon doux
  cast_lumiere:(t) => { tone(t, { f: 660, dur: 0.25, g: 0.08 }); tone(t + 0.08, { f: 880, dur: 0.3, g: 0.08 }); },
  soin:        (t) => { tone(t, { f: 660, dur: 0.3, g: 0.08 }); tone(t + 0.09, { f: 880, dur: 0.3, g: 0.08 }); tone(t + 0.18, { f: 990, dur: 0.4, g: 0.07 }); },
  // arcane / drain : nappe sombre descendante
  cast_arcane: (t) => tone(t, { type: 'sawtooth', f: 150, f1: 75, dur: 0.3, g: 0.1 }),
  impact_arcane:(t) => { tone(t, { type: 'sawtooth', f: 120, f1: 50, dur: 0.35, g: 0.12 }); noise(t, { f: 500, f1: 140, dur: 0.3, g: 0.1 }); },
  drain:       (t) => { tone(t, { type: 'sawtooth', f: 220, f1: 70, dur: 0.45, g: 0.09 }); tone(t + 0.05, { type: 'sine', f: 110, f1: 55, dur: 0.4, g: 0.1 }); },
  malediction: (t) => { tone(t, { type: 'sawtooth', f: 180, f1: 60, dur: 0.5, g: 0.1 }); tone(t + 0.1, { type: 'triangle', f: 90, f1: 45, dur: 0.45, g: 0.1 }); },
  // neutre : zip de mana
  cast_neutre: (t) => tone(t, { type: 'triangle', f: 500, f1: 1100, dur: 0.16, g: 0.1 }),
  impact_neutre:(t) => { tone(t, { type: 'triangle', f: 900, f1: 350, dur: 0.18, g: 0.12 }); noise(t, { f: 1100, dur: 0.12, g: 0.08 }); },
  // buff : nappe brève à deux voix légèrement désaccordées
  buff:        (t) => { tone(t, { type: 'triangle', f: 440, dur: 0.4, g: 0.07, a: 0.08 }); tone(t, { type: 'triangle', f: 444, dur: 0.4, g: 0.07, a: 0.08 }); tone(t + 0.12, { f: 660, dur: 0.3, g: 0.05, a: 0.05 }); },
  // combat
  coup:        (t) => { noise(t, { f: 700, f1: 220, dur: 0.09, g: 0.22, a: 0.001 }); tone(t, { f: 150, f1: 70, dur: 0.08, g: 0.15, a: 0.001 }); },
  parade:      (t) => { tone(t, { type: 'square', f: 1250, f1: 900, dur: 0.07, g: 0.08, a: 0.001 }); noise(t, { type: 'highpass', f: 2500, dur: 0.06, g: 0.1, a: 0.001 }); },
  mort:        (t) => { tone(t, { type: 'sawtooth', f: 170, f1: 50, dur: 0.5, g: 0.12 }); noise(t + 0.05, { f: 400, f1: 100, dur: 0.4, g: 0.1 }); },
  // interface / butin
  coffre:      (t) => { noise(t, { f: 350, f1: 700, q: 4, dur: 0.18, g: 0.12 }); tone(t + 0.16, { f: 880, dur: 0.18, g: 0.08 }); },
  levelup:     (t) => { [523, 659, 784, 1046].forEach((f, i) => tone(t + i * 0.09, { f, dur: 0.22, g: 0.09 })); },
  or:          (t) => { tone(t, { f: 2093, dur: 0.07, g: 0.08 }); tone(t + 0.06, { f: 2637, dur: 0.12, g: 0.07 }); },
};

// ---------- API ----------
// joue un son par nom ; delay en secondes (ex. impact à l'arrivée du projectile)
export function play(name, delay = 0) {
  if (settings.sfxOn === false) return;
  if (!ctx || ctx.state !== 'running') return; // pas encore de geste utilisateur
  const cached = files.get(name);
  if (cached === undefined) probe(name); // 1er usage : cherche un vrai fichier
  const t0 = ctx.currentTime + Math.max(0, delay);
  if (cached && cached !== 'none') {
    const src = ctx.createBufferSource();
    src.buffer = cached;
    src.connect(master);
    src.start(t0);
    return;
  }
  SYNTH[name]?.(t0);
}

// raccourcis style (élément, ou poison/drain dérivés côté serveur) -> sons
export function playCast(style) {
  if (style === 'drain') return play('drain');
  play(SYNTH[`cast_${style}`] ? `cast_${style}` : 'cast_neutre');
}
export function playImpact(style, delay = 0) {
  if (style === 'drain') return play('drain', delay);
  play(SYNTH[`impact_${style}`] ? `impact_${style}` : 'impact_neutre', delay);
}
