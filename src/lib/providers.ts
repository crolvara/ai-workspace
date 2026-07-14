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
};

/**
 * User-facing config error when the provider's API key is not set,
 * or null when the key is present. Routes check this up front so a missing
 * key fails fast instead of surfacing as a generic mid-stream error.
 */
export function missingKeyMessage(provider: ProviderId): string | null {
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

export async function generateImage(
  model: ModelDef,
  prompt: string,
): Promise<GeneratedImage> {
  if (model.provider !== "gemini") {
    throw new Error(`Provider ${model.provider} does not support image generation`);
  }
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
