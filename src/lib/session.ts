import { cookies } from "next/headers";
import { db } from "./db";

const COOKIE_NAME = "aiw_sid";
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

type CookieStore = Awaited<ReturnType<typeof cookies>>;

function setSessionCookie(store: CookieStore, id: string): void {
  store.set(COOKIE_NAME, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: ONE_YEAR_SECONDS,
    path: "/",
  });
}

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
      // Re-set on every visit so an active user's cookie never expires out from
      // under them (maxAge is otherwise fixed at first creation).
      setSessionCookie(store, session.id);
      return { id: session.id };
    }
  }

  const created = await db.session.create({ data: {} });
  setSessionCookie(store, created.id);
  return { id: created.id };
}
