import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { promptInputSchema } from "@/lib/prompts-validation";
import { getOrCreateSession } from "@/lib/session";

const MAX_PROMPTS_PER_SESSION = 100;

export async function GET() {
  const session = await getOrCreateSession();
  const prompts = await db.prompt.findMany({
    where: { sessionId: session.id },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      title: true,
      content: true,
      category: true,
      updatedAt: true,
    },
  });
  return Response.json({ prompts });
}

export async function POST(req: NextRequest) {
  const parsed = promptInputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid data." },
      { status: 400 },
    );
  }

  const session = await getOrCreateSession();

  // Count and create in one transaction so parallel requests can't slip past
  // the per-session cap (count-then-create is otherwise a TOCTOU race).
  const prompt = await db.$transaction(async (tx) => {
    const count = await tx.prompt.count({ where: { sessionId: session.id } });
    if (count >= MAX_PROMPTS_PER_SESSION) return null;
    return tx.prompt.create({
      data: { ...parsed.data, sessionId: session.id },
      select: {
        id: true,
        title: true,
        content: true,
        category: true,
        updatedAt: true,
      },
    });
  });

  if (!prompt) {
    return Response.json(
      { error: `You've reached the limit of ${MAX_PROMPTS_PER_SESSION} prompts.` },
      { status: 400 },
    );
  }
  return Response.json({ prompt }, { status: 201 });
}
