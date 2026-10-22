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
    // WebGPU (rapide) seulement si un adaptateur existe ET gère le fp16 :
    // sinon « does not support fp16 », et le modèle fp32 pèserait plusieurs
    // centaines de Mo. Dans tous les autres cas, et si WebGPU échoue quand
    // même, WASM q8 (~60 Mo), plus lent mais disponible partout.
    const essais = [];
    if (e.data.webgpu) {
      let adaptateur = null;
      try { adaptateur = await navigator.gpu?.requestAdapter(); } catch {}
      if (adaptateur?.features.has('shader-f16')) essais.push({ device: 'webgpu', dtype: 'fp16' });
      else console.log('[dictée:worker] WebGPU sans adaptateur fp16 : backend WASM');
    }
    essais.push({ device: 'wasm', dtype: 'q8' });
    let derniere = null;
    for (const { device, dtype } of essais) {
      try {
        // RÉSULTAT ATTENDU dans la console (contexte « whisper-worker.js ») :
        // ce log, puis les progressions relayées à la page, puis « ready ».
        // Premier lancement : les requêtes partent vers huggingface.co (onglet
        // Réseau) ; lancements suivants : servies depuis Cache Storage (0 ms).
        console.log('[dictée:worker] chargement du modèle', MODEL_ID, '— backend :', device, dtype,
          '| runtime :', env.backends.onnx.wasm.wasmPaths);
        transcriber = await pipeline('automatic-speech-recognition', MODEL_ID, {
          dtype,
          device,
          // ONNX Runtime 1.26 : l'optimisation « TransposeDQWeightsForMatMulNBits »
          // casse le décodeur quantifié de Whisper (« Missing required scale ») ;
          // le niveau « basic » ne l'applique pas
          session_options: { graphOptimizationLevel: 'basic' },
          progress_callback: (p) => {
            if (p.status === 'progress' && p.total) {
              self.postMessage({ type: 'progress', file: p.file, loaded: p.loaded, total: p.total });
            }
          },
        });
        console.log('[dictée:worker] modèle prêt (' + device + ')');
        self.postMessage({ type: 'ready', device });
        return;
      } catch (err) {
        derniere = err;
        console.warn('[dictée:worker] échec du backend', device, ':', err?.message || err);
      }
    }
    self.postMessage({ type: 'error', error: String(derniere?.message || derniere) });
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
