// Dictée vocale locale (Whisper dans le navigateur) : consentement explicite
// avant le téléchargement UNIQUE du modèle, capture micro en push-to-talk,
// transcription 100 % sur la machine du joueur — nous ne recevons RIEN.
// Le texte est déposé dans le champ de saisie POUR RELECTURE, jamais envoyé
// tout seul. Machine à états : off -> asking -> downloading -> ready ->
// listening -> transcribing -> ready.
import { reactive } from '/js/vendor/petite-vue.js';

const LS = typeof localStorage !== 'undefined' ? localStorage : { getItem: () => null, setItem: () => {}, removeItem: () => {} };

// Journal de bord : TOUT passe par ici, préfixé [dictée], visible en console
// (F12). En cas de panne, la DERNIÈRE ligne loggée dit où ça s'est arrêté —
// voir docs/dictee-vocale.md pour le tableau symptôme -> cause -> remède.
const log = (...a) => console.log('[dictée]', ...a);

export const voice = reactive({
  // supported=false => le bouton 🎙 n'apparaît PAS. Causes possibles :
  //  - SharedArrayBuffer absent : les en-têtes COOP/COEP ne sont pas servis
  //    (vérifier : onglet Réseau -> la page -> Cross-Origin-Embedder-Policy)
  //    ou la page est ouverte en file:// (il FAUT passer par le serveur) ;
  //  - pas de micro / navigator.mediaDevices absent (contexte non sécurisé :
  //    il faut http://localhost ou https, jamais http://ip-distante).
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

export function initDictation(cb) {
  onText = cb;
  log('init — supported:', voice.supported,
    '| SharedArrayBuffer:', typeof SharedArrayBuffer !== 'undefined',
    '| WebGPU:', typeof navigator !== 'undefined' && 'gpu' in navigator,
    '| consentement mémorisé:', LS.getItem('t4c:voice') || 'aucun');
}

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
  // RÉSULTAT ATTENDU : des lignes « progrès … % » puis « prêt » en ~1-3 min
  // au premier lancement (60 Mo), en ~2-10 s ensuite (cache navigateur).
  // Si RIEN ne suit ce log : le worker n'a pas démarré (onglet Réseau ->
  // whisper-worker.js en 404 ? erreur d'import module dans la console ?).
  log('téléchargement/chargement du modèle demandé…');
  worker = new Worker(new URL('./whisper-worker.js', import.meta.url), { type: 'module' });
  worker.onerror = (e) => {
    voice.state = 'error';
    voice.error = e.message || 'worker en erreur';
    log('✘ worker.onerror :', e.message, '—', e.filename, ':', e.lineno);
  };
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
      log('✔ prêt — le micro est chaud (V maintenue pour dicter)');
    } else if (m.type === 'text') {
      voice.state = 'ready';
      log(`✔ transcription (${m.ms | 0} ms) : « ${m.text} »`);
      if (m.text && onText) onText(m.text);
    } else if (m.type === 'error') {
      voice.state = 'error';
      voice.error = m.error;
      // Erreurs typiques ici (venant du worker) :
      //  - « Failed to fetch » pendant le téléchargement : réseau, ou COEP
      //    bloque huggingface.co (vérifier l'onglet Réseau : la requête vers
      //    huggingface.co doit répondre avec Access-Control-Allow-Origin) ;
      //  - « no available backend found » : le .wasm vendorisé ne charge pas
      //    (404 sur /js/vendor/transformers/ort-*.wasm ? mauvais MIME ?).
      console.error('[dictée] ✘', m.error);
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
    // RÉSULTAT ATTENDU : 🔴 sur le bouton, et à ce stade le navigateur a
    // demandé (et obtenu) la permission micro. sampleRate doit dire 16000 —
    // si le navigateur refuse ce taux, il faudrait rééchantillonner à la main.
    log('écoute… (sampleRate réel :', ctx.sampleRate, 'Hz)');
  } catch (err) {
    voice.state = 'error';
    voice.error = 'Micro refusé ou indisponible.';
    // NotAllowedError = permission refusée (cadenas dans la barre d'adresse) ;
    // NotFoundError = aucun micro ; autre chose = contexte non sécurisé ?
    log('✘ getUserMedia :', err.name, err.message);
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
  log(`fin d'écoute : ${(total / 16000).toFixed(2)} s d'audio capturées`);
  if (total < 16000 * 0.35) { voice.state = 'ready'; log('(trop court, ignoré)'); return; }
  const audio = new Float32Array(total);
  let o = 0;
  for (const c of chunks) { audio.set(c, o); o += c.length; }
  voice.state = 'transcribing';
  // RÉSULTAT ATTENDU : « transcription (N ms) : "…" » dans ~1-3 s (WebGPU)
  // ou ~2-8 s (WASM pur). Si rien ne revient JAMAIS : le worker est
  // probablement mort (voir worker.onerror plus haut) ou l'inférence rame —
  // laisser 30 s avant de conclure sur une petite machine.
  log('transcription en cours…');
  worker.postMessage({ type: 'transcribe', audio }, [audio.buffer]);
}

// ---- transparence dans les deux sens : rendre les 60 Mo ----
export async function deleteModel() {
  // Le modèle vit dans Cache Storage (F12 -> Application/Stockage -> Cache).
  // Transformers.js nomme son cache « transformers-cache » — on supprime par
  // motif au cas où le nom changerait d'une version à l'autre. VÉRIFIER après
  // coup dans l'onglet Application que le cache a bien disparu ; sinon, le
  // supprimer à la main là-bas fait le même travail.
  try {
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys();
      log('caches présents :', keys.join(', ') || '(aucun)');
      for (const k of keys) {
        if (/transformers/i.test(k)) { await caches.delete(k); log('cache supprimé :', k); }
      }
    }
  } catch (err) { log('✘ suppression du cache :', err.message); }
  LS.removeItem('t4c:voice');
  voice.declined = false;
  voice.state = 'off';
  if (worker) { worker.terminate(); worker = null; }
}
