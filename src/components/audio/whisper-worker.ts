/**
 * Web Worker: Whisper speech-to-text via transformers.js (WASM, fully in-browser).
 * Model weights are downloaded from the Hugging Face CDN on first use and
 * cached by the browser; the pipeline instance is kept alive between runs.
 */
import { pipeline, type AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers";

export type WhisperWorkerIn = {
  type: "transcribe";
  audio: Float32Array;
  /** Whisper language code ("bg", "en"…) or null for auto-detect. */
  language: string | null;
};

export type WhisperWorkerOut =
  | { type: "progress"; progress: number }
  | { type: "transcribing" }
  | { type: "result"; text: string }
  | { type: "error"; message: string };

// Multilingual base model (~80 MB at q8) — small enough for the browser,
// good enough for Bulgarian + English dictation.
const MODEL_ID = "onnx-community/whisper-base";

let transcriberPromise: Promise<AutomaticSpeechRecognitionPipeline> | null = null;

function post(message: WhisperWorkerOut) {
  self.postMessage(message);
}

function getTranscriber() {
  if (!transcriberPromise) {
    const files = new Map<string, { loaded: number; total: number }>();
    transcriberPromise = pipeline("automatic-speech-recognition", MODEL_ID, {
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
    transcriberPromise.catch(() => {
      transcriberPromise = null;
    });
  }
  return transcriberPromise;
}

self.onmessage = async (e: MessageEvent<WhisperWorkerIn>) => {
  const msg = e.data;
  if (msg.type !== "transcribe") return;
  try {
    const transcriber = await getTranscriber();
    post({ type: "transcribing" });
    const output = await transcriber(msg.audio, {
      language: msg.language ?? undefined,
      task: "transcribe",
      chunk_length_s: 30,
    });
    const text = (Array.isArray(output) ? output.map((o) => o.text).join(" ") : output.text).trim();
    post({ type: "result", text });
  } catch (err) {
    console.error("Whisper worker failed:", err);
    post({
      type: "error",
      message:
        "Speech recognition failed. Check your internet connection (the model downloads on first use) and try again.",
    });
  }
};
