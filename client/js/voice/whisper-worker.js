// Worker de dictée vocale : Whisper exécuté ENTIÈREMENT dans le navigateur
// (Transformers.js + ONNX Runtime WASM/WebGPU, vendorisés — servis par NOTRE
// serveur). Seul le MODÈLE est téléchargé, une fois et avec consentement,
// depuis le hub HuggingFace, puis conservé dans le cache du navigateur :
// la voix du joueur ne quitte JAMAIS sa machine.
import { pipeline, env } from '../vendor/transformers/transformers.min.js';

// runtime ONNX servi par notre serveur (autonomie : rien ne vient d'un CDN)
env.backends.onnx.wasm.wasmPaths = new URL('../vendor/transformers/', import.meta.url).href;
env.allowLocalModels = false; // les modèles viennent du hub (cache navigateur ensuite)

const MODEL_ID = 'onnx-community/whisper-base'; // ~60 Mo quantifié — passer à
// 'onnx-community/whisper-small' (~250 Mo) pour une meilleure précision.

let transcriber = null;

self.onmessage = async (e) => {
  const { type } = e.data;

  if (type === 'load') {
    try {
      const device = e.data.webgpu ? 'webgpu' : 'wasm';
      // RÉSULTAT ATTENDU dans la console (contexte « whisper-worker.js ») :
      // ce log, puis les progressions relayées à la page, puis « ready ».
      // Premier lancement : les requêtes partent vers huggingface.co (onglet
      // Réseau) ; lancements suivants : servies depuis Cache Storage (0 ms).
      console.log('[dictée:worker] chargement du modèle', MODEL_ID, '— backend :', device,
        '| runtime :', env.backends.onnx.wasm.wasmPaths);
      transcriber = await pipeline('automatic-speech-recognition', MODEL_ID, {
        dtype: device === 'webgpu' ? 'fp16' : 'q8',
        device,
        progress_callback: (p) => {
          if (p.status === 'progress' && p.total) {
            self.postMessage({ type: 'progress', file: p.file, loaded: p.loaded, total: p.total });
          }
        },
      });
      console.log('[dictée:worker] modèle prêt');
      self.postMessage({ type: 'ready' });
    } catch (err) {
      self.postMessage({ type: 'error', error: String(err?.message || err) });
    }
    return;
  }

  if (type === 'transcribe' && transcriber) {
    try {
      // audio : Float32Array mono à 16 kHz (préparé côté page)
      const t0 = Date.now();
      const out = await transcriber(e.data.audio, { language: 'french', task: 'transcribe' });
      self.postMessage({ type: 'text', text: (out.text || '').trim(), ms: Date.now() - t0 });
    } catch (err) {
      self.postMessage({ type: 'error', error: String(err?.message || err) });
    }
  }
};
