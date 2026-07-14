/**
 * Web Worker: Kokoro text-to-speech via kokoro-js (WASM, fully in-browser).
 * Model weights are downloaded from the Hugging Face CDN on first use and
 * cached by the browser; the TTS instance is kept alive between runs.
 */
import { KokoroTTS, type GenerateOptions } from "kokoro-js";

export type KokoroVoice = NonNullable<GenerateOptions["voice"]>;

export type KokoroWorkerIn = {
  type: "generate";
  text: string;
  voice: KokoroVoice;
  speed: number;
};

export type KokoroWorkerOut =
  | { type: "progress"; progress: number }
  | { type: "generating" }
  | { type: "result"; wav: Blob }
  | { type: "error"; message: string };

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";

let ttsPromise: Promise<KokoroTTS> | null = null;

function post(message: KokoroWorkerOut) {
  self.postMessage(message);
}

function getTts() {
  if (!ttsPromise) {
    const files = new Map<string, { loaded: number; total: number }>();
    ttsPromise = KokoroTTS.from_pretrained(MODEL_ID, {
      dtype: "q8",
      progress_callback: (event) => {
        if (event.status !== "progress") return;
        files.set(event.file, { loaded: event.loaded, total: event.total });
        let loaded = 0;
        let total = 0;
        for (const f of files.values()) {
          loaded += f.loaded;
          total += f.total;
        }
        if (total > 0) post({ type: "progress", progress: loaded / total });
      },
    });
    // Allow a retry after a failed download instead of caching the rejection.
    ttsPromise.catch(() => {
      ttsPromise = null;
    });
  }
  return ttsPromise;
}

self.onmessage = async (e: MessageEvent<KokoroWorkerIn>) => {
  const msg = e.data;
  if (msg.type !== "generate") return;
  try {
    const tts = await getTts();
    post({ type: "generating" });
    const audio = await tts.generate(msg.text, { voice: msg.voice, speed: msg.speed });
    post({ type: "result", wav: audio.toBlob() });
  } catch (err) {
    console.error("Kokoro worker failed:", err);
    post({
      type: "error",
      message:
        "Speech generation failed. Check your internet connection (the model downloads on first use) and try again.",
    });
  }
};
