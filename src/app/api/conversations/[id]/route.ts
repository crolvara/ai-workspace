import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getOrCreateSession } from "@/lib/session";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const session = await getOrCreateSession();

  const conversation = await db.conversation.findFirst({
    where: { id, sessionId: session.id },
    include: {
      messages: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          role: true,
          content: true,
          model: true,
          inputTokens: true,
          outputTokens: true,
          latencyMs: true,
        },
      },
    },
  });

  if (!conversation) {
    return Response.json({ error: "Conversation not found." }, { status: 404 });
  }
  return Response.json({ conversation });
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const session = await getOrCreateSession();

  const { count } = await db.conversation.deleteMany({
    where: { id, sessionId: session.id },
  });
  if (count === 0) {
    return Response.json({ error: "Conversation not found." }, { status: 404 });
  }
  return Response.json({ ok: true });
}
