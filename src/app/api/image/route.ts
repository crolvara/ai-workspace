import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getImageModel } from "@/lib/models";
import { generateImage } from "@/lib/providers";
import { checkRateLimit, clientIpFrom } from "@/lib/ratelimit";
import { getOrCreateSession } from "@/lib/session";

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
    const isConfigError = messageText.startsWith("Missing API key");
    return jsonError(
      502,
      isConfigError
        ? messageText
        : "Image generation failed. Please try again or switch to another model.",
    );
  }
}
