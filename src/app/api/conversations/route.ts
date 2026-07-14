import { db } from "@/lib/db";
import { getOrCreateSession } from "@/lib/session";

export async function GET() {
  const session = await getOrCreateSession();
  const conversations = await db.conversation.findMany({
    where: { sessionId: session.id },
    orderBy: { updatedAt: "desc" },
    take: 100,
    select: { id: true, title: true, model: true, updatedAt: true },
  });
  return Response.json({ conversations });
}
