export type ProviderId = "groq" | "openrouter" | "gemini" | "cloudflare";

export interface ModelDef {
  /** Value sent to the provider API */
  id: string;
  /** Unique key used in URLs, DB and the UI (provider prefix avoids collisions) */
  key: string;
  provider: ProviderId;
  label: string;
  description: string;
  /**
   * Reasoning model (emits internal <think>…</think> deliberation). For Groq
   * models this makes providers.ts send `reasoning_format: "hidden"` so the
   * thinking never reaches the UI. Do NOT set it on non-reasoning Groq models —
   * Groq rejects the param with a 400 there.
   */
  reasoning?: boolean;
}

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  groq: "Groq",
  openrouter: "OpenRouter",
  gemini: "Google Gemini",
  cloudflare: "Cloudflare Workers AI",
};

/**
 * Free models only. Groq and OpenRouter rotate their free catalogs a few times
 * a year — when a model starts returning 404/410, replace it here.
 * Groq decommissions so far: llama-4-scout (18.07.2026, no notice),
 * llama-3.3-70b-versatile (16.08.2026, email notice) — both were in this list.
 */
export const MODELS: ModelDef[] = [
  {
    key: "groq/gpt-oss-120b",
    id: "openai/gpt-oss-120b",
    provider: "groq",
    label: "GPT OSS 120B",
    description: "Groq's best all-round model — OpenAI open weights",
    reasoning: true,
  },
  {
    key: "groq/llama-3.1-8b",
    id: "llama-3.1-8b-instant",
    provider: "groq",
    label: "Llama 3.1 8B",
    description: "Very fast, for simple tasks",
  },
  {
    key: "groq/qwen3.6-27b",
    id: "qwen/qwen3.6-27b",
    provider: "groq",
    label: "Qwen 3.6 27B",
    description: "Strong at reasoning and code",
    reasoning: true,
  },
  {
    key: "openrouter/deepseek-v3",
    id: "deepseek/deepseek-chat-v3-0324:free",
    provider: "openrouter",
    label: "DeepSeek V3",
    description: "DeepSeek's flagship, free via OpenRouter",
  },
  {
    key: "openrouter/llama-3.3-70b",
    id: "meta-llama/llama-3.3-70b-instruct:free",
    provider: "openrouter",
    label: "Llama 3.3 70B (OR)",
    description: "Meta's Llama via OpenRouter (gone from Groq since 16.08.2026)",
  },
  {
    key: "openrouter/gemma-3-27b",
    id: "google/gemma-3-27b-it:free",
    provider: "openrouter",
    label: "Gemma 3 27B",
    description: "Google's open-weights model",
  },
  {
    key: "gemini/2.5-flash",
    id: "gemini-2.5-flash",
    provider: "gemini",
    label: "Gemini 2.5 Flash",
    description: "Google's fast multimodal model",
  },
  {
    key: "gemini/2.5-flash-lite",
    id: "gemini-2.5-flash-lite",
    provider: "gemini",
    label: "Gemini 2.5 Flash Lite",
    description: "The most economical Gemini",
  },
];

export const DEFAULT_MODEL_KEY = "groq/gpt-oss-120b";

export function getModel(key: string): ModelDef | undefined {
  return MODELS.find((m) => m.key === key);
}

/**
 * Free image-generation models. The Gemini API free tier dropped image models
 * (returns 429 quota=0), and OpenRouter has no free image-output models — so the
 * only working free route is Cloudflare Workers AI (free daily Neuron allocation).
 * Needs CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN. Same rotation rule: replace
 * here when a model id is retired. `id` is the Workers AI model path.
 */
export const IMAGE_MODELS: ModelDef[] = [
  {
    key: "cloudflare/flux-1-schnell",
    id: "@cf/black-forest-labs/flux-1-schnell",
    provider: "cloudflare",
    label: "FLUX.1 [schnell]",
    description: "Black Forest Labs — fast, high-quality, free via Cloudflare",
  },
];

export const DEFAULT_IMAGE_MODEL_KEY = "cloudflare/flux-1-schnell";

export function getImageModel(key: string): ModelDef | undefined {
  return IMAGE_MODELS.find((m) => m.key === key);
}
