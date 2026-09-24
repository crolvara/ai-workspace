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
  /**
   * Send Groq's built-in `browser_search` tool (gpt-oss only). The model then
   * searches/opens pages server-side on Groq and cites them with 【N†…】
   * markers; providers.ts drops those and appends the opened pages as a
   * "Sources:" list (see citations.ts for why markers are not mapped).
   */
  webSearch?: boolean;
}

// (PROVIDER_LABELS was removed 15.08.2026 together with the last UI spot that
// showed a provider name — the UI deliberately shows model names only.)

/**
 * Free models only, Groq-only since 15.08.2026. Groq rotates its free catalog —
 * when a model starts returning 404/410, replace it here (live list:
 * `curl -H "Authorization: Bearer $GROQ_API_KEY" https://api.groq.com/openai/v1/models`).
 * Decommissions so far: llama-4-scout (18.07.2026, no notice),
 * llama-3.3-70b-versatile (16.08.2026, email notice), qwen/qwen3-32b
 * (silently, ~July 2026), llama-3.1-8b-instant (silently, by 25.08.2026),
 * groq/compound-mini AND the full groq/compound (both decommissioned 21.09.2026;
 * web search now comes from gpt-oss + the browser_search tool) and qwen/qwen3.6-27b (email
 * 01.09.2026, decommission 14.09.2026 — swapped for qwen/qwen3.8-27b on
 * 02.09.2026; unlike the earlier ones Groq promised to auto-route this one, but
 * a verified model beats a silent transfer) — all were in this list at the time.
 * Before swapping a model verify the flags it is listed with: qwen3.8 was checked
 * live for `reasoning_format: "hidden"` (accepted, no <think> in the stream).
 * A changed `key` is safe: conversations store it, but the loader falls back to
 * DEFAULT_MODEL_KEY for keys no longer in MODELS.
 */
export const MODELS: ModelDef[] = [
  {
    key: "groq/gpt-oss-120b",
    id: "openai/gpt-oss-120b",
    provider: "groq",
    label: "GPT OSS 120B",
    description: "Best all-round model — OpenAI open weights",
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
    key: "groq/qwen3.8-27b",
    id: "qwen/qwen3.8-27b",
    provider: "groq",
    label: "Qwen 3.8 27B",
    description: "Strong at reasoning and code",
    reasoning: true,
  },
  {
    // Replaces groq/compound (decommissioned 21.09.2026 with compound-mini):
    // gpt-oss + Groq's built-in browser_search tool. Deliberately on the 20B —
    // Groq rate limits are PER MODEL, and one search question costs ~45-150k
    // prompt tokens (the model opens pages in a loop). On the 120B that would
    // starve Одитпро's chat assistant, which shares the account and model;
    // nothing else uses the 20B bucket. Verified live 24.09.2026 (streaming +
    // reasoning_format "hidden" + tools together → 200).
    key: "groq/gpt-oss-20b-web",
    id: "openai/gpt-oss-20b",
    provider: "groq",
    label: "GPT OSS 20B + Web",
    description: "Searches the web — for current events and fresh facts",
    reasoning: true,
    webSearch: true,
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
