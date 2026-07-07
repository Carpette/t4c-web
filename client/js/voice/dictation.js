// Dictée vocale locale (Whisper dans le navigateur) : consentement explicite
// avant le téléchargement UNIQUE du modèle, capture micro en push-to-talk,
// transcription 100 % sur la machine du joueur — nous ne recevons RIEN.
// Le texte est déposé dans le champ de saisie POUR RELECTURE, jamais envoyé
// tout seul. Machine à états : off -> asking -> downloading -> ready ->
// listening -> transcribing -> ready.
import { reactive } from '/js/vendor/petite-vue.js';

const LS = typeof localStorage !== 'undefined' ? localStorage : { getItem: () => null, setItem: () => {}, removeItem: () => {} };

export const voice = reactive({
  supported: typeof SharedArrayBuffer !== 'undefined' && typeof Worker !== 'undefined'
    && typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia,
  state: 'off',          // off | asking | downloading | ready | listening | transcribing | error
  progress: 0,           // % du téléchargement du modèle
  declined: LS.getItem('t4c:voice') === 'declined',
  error: '',
});

let worker = null;
let media = null;        // { ctx, stream, source, node, chunks }
let onText = null;       // callback(texte) fourni par le chat

export function initDictation(cb) { onText = cb; }

// ---- consentement : ouvre la question ; accept/refuse depuis la modale ----
export function askConsent() {
  if (!voice.supported) return;
  voice.state = 'asking';
}
export function refuseModel() {
  voice.state = 'off';
  voice.declined = true;
  LS.setItem('t4c:voice', 'declined');
}
export async function acceptModel() {
  voice.declined = false;
  LS.setItem('t4c:voice', 'accepted');
  voice.state = 'downloading';
  voice.progress = 0;
  worker = new Worker(new URL('./whisper-worker.js', import.meta.url), { type: 'module' });
  const totals = {};
  worker.onmessage = (e) => {
    const m = e.data;
    if (m.type === 'progress') {
      totals[m.file] = [m.loaded, m.total];
      let loaded = 0, total = 0;
      for (const [l, t] of Object.values(totals)) { loaded += l; total += t; }
      voice.progress = total ? Math.round(100 * loaded / total) : 0;
    } else if (m.type === 'ready') {
      voice.state = 'ready';
    } else if (m.type === 'text') {
      voice.state = 'ready';
      if (m.text && onText) onText(m.text);
    } else if (m.type === 'error') {
      voice.state = 'error';
      voice.error = m.error;
      console.error('[dictée]', m.error);
    }
  };
  worker.postMessage({ type: 'load', webgpu: 'gpu' in navigator });
}

// à la connexion : si déjà accepté, recharge en silence (cache navigateur)
export function resumeIfAccepted() {
  if (voice.supported && LS.getItem('t4c:voice') === 'accepted' && voice.state === 'off') acceptModel();
}

// ---- push-to-talk : start à l'appui, stop au relâchement ----
export async function startListening() {
  if (voice.state !== 'ready') return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
    // AudioContext à 16 kHz : le navigateur rééchantillonne pour nous
    const ctx = new AudioContext({ sampleRate: 16000 });
    const source = ctx.createMediaStreamSource(stream);
    const node = ctx.createScriptProcessor(4096, 1, 1);
    const chunks = [];
    node.onaudioprocess = (ev) => chunks.push(new Float32Array(ev.inputBuffer.getChannelData(0)));
    source.connect(node);
    node.connect(ctx.destination);
    media = { ctx, stream, source, node, chunks };
    voice.state = 'listening';
  } catch (err) {
    voice.state = 'error';
    voice.error = 'Micro refusé ou indisponible.';
  }
}

export function stopListening() {
  if (voice.state !== 'listening' || !media) return;
  const { ctx, stream, source, node, chunks } = media;
  media = null;
  source.disconnect(); node.disconnect();
  stream.getTracks().forEach(t => t.stop());
  ctx.close();
  const total = chunks.reduce((n, c) => n + c.length, 0);
  if (total < 16000 * 0.35) { voice.state = 'ready'; return; } // < 0,35 s : rien à dire
  const audio = new Float32Array(total);
  let o = 0;
  for (const c of chunks) { audio.set(c, o); o += c.length; }
  voice.state = 'transcribing';
  worker.postMessage({ type: 'transcribe', audio }, [audio.buffer]);
}

// ---- transparence dans les deux sens : rendre les 60 Mo ----
export async function deleteModel() {
  try {
    if (typeof caches !== 'undefined') {
      for (const k of await caches.keys()) {
        if (/transformers/i.test(k)) await caches.delete(k);
      }
    }
  } catch { /* cache inaccessible : tant pis */ }
  LS.removeItem('t4c:voice');
  voice.declined = false;
  voice.state = 'off';
  if (worker) { worker.terminate(); worker = null; }
}
