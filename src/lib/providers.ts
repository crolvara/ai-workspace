import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";
import type { ModelDef, ProviderId } from "./models";

export interface ChatMessageInput {
  role: "user" | "assistant";
  content: string;
}

/** Filled in after the stream is fully consumed. */
export interface UsageOut {
  inputTokens: number;
  outputTokens: number;
}

const PROVIDER_KEY_ENV: Record<ProviderId, string> = {
  groq: "GROQ_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  gemini: "GEMINI_API_KEY",
  // Cloudflare also needs CLOUDFLARE_ACCOUNT_ID — see missingKeyMessage.
  cloudflare: "CLOUDFLARE_API_TOKEN",
};

/**
 * User-facing config error when the provider's credentials are not set,
 * or null when present. Routes check this up front so a missing key fails fast
 * instead of surfacing as a generic mid-stream error.
 */
export function missingKeyMessage(provider: ProviderId): string | null {
  if (provider === "cloudflare" && !process.env.CLOUDFLARE_ACCOUNT_ID) {
    return "Missing API key: set CLOUDFLARE_ACCOUNT_ID in .env.";
  }
  const name = PROVIDER_KEY_ENV[provider];
  return process.env[name] ? null : `Missing API key: set ${name} in .env.`;
}

function requireKey(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing API key: set ${name} in .env.`);
  }
  return value;
}

function openAiCompatibleClient(model: ModelDef): OpenAI {
  if (model.provider === "groq") {
    return new OpenAI({
      apiKey: requireKey("GROQ_API_KEY"),
      baseURL: "https://api.groq.com/openai/v1",
    });
  }
  return new OpenAI({
    apiKey: requireKey("OPENROUTER_API_KEY"),
    baseURL: "https://openrouter.ai/api/v1",
  });
}

async function* streamOpenAiCompatible(
  model: ModelDef,
  messages: ChatMessageInput[],
  usageOut: UsageOut,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const client = openAiCompatibleClient(model);
  const stream = await client.chat.completions.create(
    {
      model: model.id,
      messages,
      stream: true,
      stream_options: { include_usage: true },
    },
    { signal },
  );

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) {
      yield delta;
    }
    if (chunk.usage) {
      usageOut.inputTokens = chunk.usage.prompt_tokens ?? 0;
      usageOut.outputTokens = chunk.usage.completion_tokens ?? 0;
    }
  }
}

async function* streamGemini(
  model: ModelDef,
  messages: ChatMessageInput[],
  usageOut: UsageOut,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const ai = new GoogleGenAI({ apiKey: requireKey("GEMINI_API_KEY") });
  const stream = await ai.models.generateContentStream({
    model: model.id,
    contents: messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    })),
    config: { abortSignal: signal },
  });

  for await (const chunk of stream) {
    const text = chunk.text;
    if (text) {
      yield text;
    }
    if (chunk.usageMetadata) {
      usageOut.inputTokens = chunk.usageMetadata.promptTokenCount ?? 0;
      usageOut.outputTokens = chunk.usageMetadata.candidatesTokenCount ?? 0;
    }
  }
}

export function streamChat(
  model: ModelDef,
  messages: ChatMessageInput[],
  usageOut: UsageOut,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  if (model.provider === "gemini") {
    return streamGemini(model, messages, usageOut, signal);
  }
  return streamOpenAiCompatible(model, messages, usageOut, signal);
}

export interface GeneratedImage {
  /** `data:<mime>;base64,…` — ready for <img src> and download links */
  dataUrl: string;
  /** Optional accompanying text returned alongside the image */
  text: string;
  usage: UsageOut;
}

/** Wall-clock cap so a stuck upstream can't run into the serverless timeout. */
const IMAGE_TIMEOUT_MS = 25_000;

export function generateImage(
  model: ModelDef,
  prompt: string,
): Promise<GeneratedImage> {
  if (model.provider === "cloudflare") {
    return generateImageCloudflare(model, prompt);
  }
  if (model.provider === "gemini") {
    return generateImageGemini(model, prompt);
  }
  throw new Error(`Provider ${model.provider} does not support image generation`);
}

/**
 * Cloudflare Workers AI text-to-image, FLUX family only. The FLUX models
 * (`flux-1-schnell`, FLUX.2 klein/dev) wrap the result as JSON
 * `{ result: { image: "<base64 jpeg>" } }`. WARNING: the SDXL / Stable Diffusion
 * models on Workers AI return a raw binary PNG body instead (content-type
 * image/png, no JSON) — adding one to IMAGE_MODELS would break the JSON parse
 * below and needs a separate binary branch. Free daily Neuron allocation covers a
 * couple hundred FLUX schnell images.
 */
async function generateImageCloudflare(
  model: ModelDef,
  prompt: string,
): Promise<GeneratedImage> {
  const accountId = requireKey("CLOUDFLARE_ACCOUNT_ID");
  const token = requireKey("CLOUDFLARE_API_TOKEN");
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model.id}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prompt, steps: 4 }),
      signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
    },
  );

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    // Surface the raw provider error to UsageLog; the route hides it from users.
    throw new Error(`Cloudflare Workers AI ${res.status}: ${detail.slice(0, 300)}`);
  }

  // A 200 can still carry a Workers AI failure (`success:false`), in which case
  // `result` is null — surface the reported error rather than blaming the prompt.
  const json = (await res.json()) as {
    result?: { image?: string } | null;
    success?: boolean;
    errors?: Array<{ message?: string }>;
  };
  if (json.success === false) {
    const detail = json.errors?.map((e) => e.message).filter(Boolean).join("; ");
    throw new Error(`Cloudflare Workers AI error: ${detail || "unknown"}`);
  }
  const imageBase64 = json.result?.image;
  if (!imageBase64) {
    throw new Error("The model did not return an image. Please try a different prompt.");
  }
  return {
    // Workers AI returns base64 JPEG.
    dataUrl: `data:image/jpeg;base64,${imageBase64}`,
    text: "",
    // Workers AI does not report token usage.
    usage: { inputTokens: 0, outputTokens: 0 },
  };
}

async function generateImageGemini(
  model: ModelDef,
  prompt: string,
): Promise<GeneratedImage> {
  const ai = new GoogleGenAI({ apiKey: requireKey("GEMINI_API_KEY") });
  const response = await ai.models.generateContent({
    model: model.id,
    contents: prompt,
    config: { responseModalities: ["TEXT", "IMAGE"] },
  });

  let imageBase64: string | null = null;
  let mimeType = "image/png";
  let text = "";
  for (const part of response.candidates?.[0]?.content?.parts ?? []) {
    if (part.inlineData?.data) {
      imageBase64 = part.inlineData.data;
      mimeType = part.inlineData.mimeType ?? "image/png";
    } else if (part.text) {
      text += part.text;
    }
  }
  if (!imageBase64) {
    throw new Error("The model did not return an image. Please try a different prompt.");
  }
  return {
    dataUrl: `data:${mimeType};base64,${imageBase64}`,
    text: text.trim(),
    usage: {
      inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
    },
  };
}
