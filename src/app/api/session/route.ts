import { getOrCreateSession } from "@/lib/session";

/**
 * Ensures the anonymous session cookie exists. Pages that fire several API
 * requests in parallel (e.g. /compare) call this once first, so concurrent
 * first-visit requests don't race to create separate sessions.
 */
export async function GET() {
  await getOrCreateSession();
  return Response.json({ ok: true });
}
