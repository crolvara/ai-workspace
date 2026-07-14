import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { promptUpdateSchema } from "@/lib/prompts-validation";
import { getOrCreateSession } from "@/lib/session";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const parsed = promptUpdateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid data." },
      { status: 400 },
    );
  }

  if (Object.keys(parsed.data).length === 0) {
    return Response.json({ error: "No changes provided." }, { status: 400 });
  }

  const session = await getOrCreateSession();
  const { count } = await db.prompt.updateMany({
    where: { id, sessionId: session.id },
    data: parsed.data,
  });
  if (count === 0) {
    return Response.json({ error: "Prompt not found." }, { status: 404 });
  }

  const prompt = await db.prompt.findFirst({
    where: { id, sessionId: session.id },
    select: {
      id: true,
      title: true,
      content: true,
      category: true,
      updatedAt: true,
    },
  });
  if (!prompt) {
    // Deleted between the update and the read — treat as not found.
    return Response.json({ error: "Prompt not found." }, { status: 404 });
  }
  return Response.json({ prompt });
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const session = await getOrCreateSession();

  const { count } = await db.prompt.deleteMany({
    where: { id, sessionId: session.id },
  });
  if (count === 0) {
    return Response.json({ error: "Prompt not found." }, { status: 404 });
  }
  return Response.json({ ok: true });
}
