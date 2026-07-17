import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getImageModel } from "@/lib/models";
import { generateImage } from "@/lib/providers";
import { checkRateLimit, clientIpFrom } from "@/lib/ratelimit";
import { getOrCreateSession } from "@/lib/session";

// Image generation runs ~2–5s but can spike under load. Vercel's default function
// cap (10s on Hobby) would kill a slow request mid-flight, and the Cloudflare proxy
// in front then surfaces its own gateway 502 — exactly the error we return 500 to
// avoid. Give the function 30s so the provider's 25s internal timeout (see
// IMAGE_TIMEOUT_MS) fires first and returns the graceful JSON error instead.
export const maxDuration = 30;

const MAX_PROMPT_LENGTH = 2000;

const bodySchema = z.object({
  prompt: z.string().min(1).max(MAX_PROMPT_LENGTH),
  model: z.string(),
});

function jsonError(status: number, message: string) {
  return Response.json({ error: message }, { status });
}

export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return jsonError(400, "Invalid request.");
  }

  const model = getImageModel(parsed.data.model);
  if (!model) {
    return jsonError(400, "Unknown model.");
  }

  const limit = await checkRateLimit(clientIpFrom(req.headers));
  if (!limit.allowed) {
    return jsonError(429, limit.message!);
  }

  const session = await getOrCreateSession();
  const startedAt = Date.now();

  try {
    const result = await generateImage(model, parsed.data.prompt);
    const latencyMs = Date.now() - startedAt;

    await db.usageLog.create({
      data: {
        sessionId: session.id,
        provider: model.provider,
        model: model.key,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        latencyMs,
        ok: true,
      },
    });

    return Response.json({
      image: result.dataUrl,
      text: result.text,
      latencyMs,
    });
  } catch (err) {
    const messageText = err instanceof Error ? err.message : "Unexpected error.";
    await db.usageLog
      .create({
        data: {
          sessionId: session.id,
          provider: model.provider,
          model: model.key,
          ok: false,
          error: messageText.slice(0, 500),
          latencyMs: Date.now() - startedAt,
        },
      })
      .catch(() => {});

    // Missing-key errors are already user-facing; hide the rest.
    // Note: do NOT use a gateway-class status (502/504) here — Cloudflare sits in
    // front of the Vercel origin and replaces origin 502/504 with its own "Bad
    // gateway" page, discarding this JSON body so the client never sees the message.
    // 503 (config) / 500 (provider) pass through with the body intact.
    const isConfigError = messageText.startsWith("Missing API key");
    return isConfigError
      ? jsonError(503, messageText)
      : jsonError(
          500,
          "Image generation failed. Please try again or switch to another model.",
        );
  }
}
