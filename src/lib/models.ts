// OpenRouter and Gemini were REMOVED 15.08.2026 (they stopped working; chat is
// Groq-only now). Historic UsageLog rows still carry "openrouter"/"gemini" as
// raw strings — /usage falls back to the raw value when a label is missing.
export type ProviderId = "groq" | "cloudflare";

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
  cloudflare: "Cloudflare Workers AI",
};

/**
 * Free models only, Groq-only since 15.08.2026. Groq rotates its free catalog —
 * when a model starts returning 404/410, replace it here (live list:
 * `curl -H "Authorization: Bearer $GROQ_API_KEY" https://api.groq.com/openai/v1/models`).
 * Decommissions so far: llama-4-scout (18.07.2026, no notice),
 * llama-3.3-70b-versatile (16.08.2026, email notice), qwen/qwen3-32b
 * (silently, ~July 2026) — all three were in this list at the time.
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
    key: "groq/gpt-oss-20b",
    id: "openai/gpt-oss-20b",
    provider: "groq",
    label: "GPT OSS 20B",
    description: "Smaller and faster sibling of GPT OSS 120B",
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
    // Agentic system with built-in web search — the only model here that can
    // answer questions about current events. Does NOT accept reasoning_format
    // (Groq 400s), so no `reasoning` flag; its thinking arrives in a separate
    // `reasoning` field that we never read. Shared account cap: 250 RPM.
    key: "groq/compound-mini",
    id: "groq/compound-mini",
    provider: "groq",
    label: "Compound Mini",
    description: "Groq's agentic model with built-in web search",
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
