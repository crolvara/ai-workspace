import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getModel } from "@/lib/models";
import {
  missingKeyMessage,
  streamChat,
  type ChatMessageInput,
  type UsageOut,
} from "@/lib/providers";
import { checkRateLimit, clientIpFrom } from "@/lib/ratelimit";
import { getOrCreateSession } from "@/lib/session";

const HISTORY_LIMIT = 30;
const MAX_MESSAGE_LENGTH = 8000;

const bodySchema = z.object({
  message: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
  model: z.string(),
  conversationId: z.string().nullish(),
  /** Compare mode: run the model without persisting anything */
  ephemeral: z.boolean().optional(),
});

function sseEncode(payload: unknown): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`);
}

function jsonError(status: number, message: string) {
  return Response.json({ error: message }, { status });
}

export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return jsonError(400, "Invalid request.");
  }
  const { message, conversationId, ephemeral } = parsed.data;

  const model = getModel(parsed.data.model);
  if (!model) {
    return jsonError(400, "Unknown model.");
  }

  const limit = await checkRateLimit(clientIpFrom(req.headers));
  if (!limit.allowed) {
    return jsonError(429, limit.message!);
  }

  const session = await getOrCreateSession();

  // Fail fast on a missing key: graceful user-facing error before anything is
  // persisted (no ghost conversations), still logged to UsageLog.
  const keyError = missingKeyMessage(model.provider);
  if (keyError) {
    await db.usageLog
      .create({
        data: {
          sessionId: session.id,
          provider: model.provider,
          model: model.key,
          ok: false,
          error: keyError,
        },
      })
      .catch(() => {});
    return jsonError(503, keyError);
  }

  // Build history + persist the user turn (skipped entirely in compare mode).
  let history: ChatMessageInput[] = [];
  let convId: string | null = null;

  if (!ephemeral) {
    if (conversationId) {
      const conversation = await db.conversation.findFirst({
        where: { id: conversationId, sessionId: session.id },
        include: {
          messages: {
            orderBy: { createdAt: "desc" },
            take: HISTORY_LIMIT,
          },
        },
      });
      if (!conversation) {
        return jsonError(404, "Conversation not found.");
      }
      convId = conversation.id;
      history = conversation.messages
        .reverse()
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
    } else {
      const conversation = await db.conversation.create({
        data: {
          sessionId: session.id,
          model: model.key,
          title: message.slice(0, 60),
        },
      });
      convId = conversation.id;
    }

    await db.message.create({
      data: { conversationId: convId, role: "user", content: message },
    });
  }

  const providerMessages: ChatMessageInput[] = [
    ...history,
    { role: "user", content: message },
  ];

  const usage: UsageOut = { inputTokens: 0, outputTokens: 0 };
  const startedAt = Date.now();
  let clientGone = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const safeEnqueue = (payload: unknown) => {
        if (clientGone) return;
        try {
          controller.enqueue(sseEncode(payload));
        } catch {
          // The consumer cancelled between our checks — stop writing.
          clientGone = true;
        }
      };

      let fullText = "";
      let streamError: unknown = null;

      safeEnqueue({ type: "meta", conversationId: convId, model: model.key });

      try {
        // req.signal aborts when the client disconnects, cancelling the
        // upstream provider request so we stop burning free-tier quota.
        for await (const delta of streamChat(model, providerMessages, usage, req.signal)) {
          fullText += delta;
          safeEnqueue({ type: "delta", text: delta });
        }
      } catch (err) {
        streamError = err;
      }

      const latencyMs = Date.now() - startedAt;
      const aborted = clientGone || req.signal.aborted;
      // An error raised because the client left is an abort, not a failure.
      const failed = streamError !== null && !aborted;

      // Persist whatever the model produced (also on abort / provider error) —
      // the tokens are spent and the user should find the partial answer.
      if (!ephemeral && convId && fullText) {
        try {
          await db.message.create({
            data: {
              conversationId: convId,
              role: "assistant",
              content: fullText,
              model: model.key,
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              latencyMs,
            },
          });
          await db.conversation.update({
            where: { id: convId },
            data: { updatedAt: new Date(), model: model.key },
          });
        } catch (dbErr) {
          // A DB hiccup must not turn an already-streamed answer into an
          // error event — the client would discard text the user has read.
          console.error("chat: failed to persist assistant message:", dbErr);
        }
      }

      const errorText =
        streamError instanceof Error ? streamError.message : "Unexpected error.";
      await db.usageLog
        .create({
          data: {
            sessionId: session.id,
            provider: model.provider,
            model: model.key,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            latencyMs,
            ok: !failed,
            error: failed ? errorText.slice(0, 500) : null,
          },
        })
        .catch(() => {});

      if (failed) {
        safeEnqueue({
          type: "error",
          message:
            "The model request failed. Please try again or switch to another model.",
        });
      } else {
        safeEnqueue({
          type: "done",
          usage,
          latencyMs,
          conversationId: convId,
        });
      }

      try {
        controller.close();
      } catch {
        // already cancelled by the consumer
      }
    },
    cancel() {
      clientGone = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
