import { cookies } from "next/headers";
import { db } from "./db";

const COOKIE_NAME = "aiw_sid";
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/**
 * Anonymous per-browser session (no auth). Ensures a Session row exists and
 * refreshes lastSeenAt. Route handlers may set cookies, so this must only be
 * called from route handlers or server actions.
 */
export async function getOrCreateSession(): Promise<{ id: string }> {
  const store = await cookies();
  const existingId = store.get(COOKIE_NAME)?.value;

  if (existingId) {
    const session = await db.session.findUnique({ where: { id: existingId } });
    if (session) {
      void db.session
        .update({ where: { id: session.id }, data: { lastSeenAt: new Date() } })
        .catch(() => {});
      return { id: session.id };
    }
  }

  const created = await db.session.create({ data: {} });
  store.set(COOKIE_NAME, created.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: ONE_YEAR_SECONDS,
    path: "/",
  });
  return { id: created.id };
}
