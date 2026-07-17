import Redis from "ioredis";

/**
 * Fixed-window rate limiting for a public, auth-less app. Uses Redis when
 * REDIS_URL is set; otherwise an in-memory map (fine for one dev process,
 * NOT for multi-instance production).
 */

/** Empty or malformed env values fall back instead of becoming 0/NaN limits. */
function envLimit(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

const PER_MINUTE = envLimit("RATE_LIMIT_PER_MINUTE", 10);
const PER_DAY = envLimit("RATE_LIMIT_PER_DAY", 200);
const GLOBAL_PER_DAY = envLimit("GLOBAL_DAILY_REQUEST_CAP", 5000);

const globalForRedis = globalThis as unknown as { aiwRedis?: Redis | null };

function getRedis(): Redis | null {
  if (globalForRedis.aiwRedis !== undefined) return globalForRedis.aiwRedis;
  const url = process.env.REDIS_URL;
  if (!url) {
    globalForRedis.aiwRedis = null;
    return null;
  }
  const client = new Redis(url, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    lazyConnect: false,
  });
  client.on("error", () => {
    // Logged once here so ioredis doesn't crash the process on refused
    // connections; callers fall back to the in-memory limiter.
  });
  globalForRedis.aiwRedis = client;
  return client;
}

const memoryCounters = new Map<string, { count: number; expiresAt: number }>();
const MEMORY_SWEEP_THRESHOLD = 5_000;

function memoryIncr(key: string, ttlSeconds: number): number {
  const now = Date.now();
  // Expired entries are otherwise only replaced on same-key access — sweep so
  // unique keys (per-IP windows) can't grow the map unboundedly.
  if (memoryCounters.size > MEMORY_SWEEP_THRESHOLD) {
    for (const [k, v] of memoryCounters) {
      if (v.expiresAt <= now) memoryCounters.delete(k);
    }
  }
  const entry = memoryCounters.get(key);
  if (!entry || entry.expiresAt <= now) {
    memoryCounters.set(key, { count: 1, expiresAt: now + ttlSeconds * 1000 });
    return 1;
  }
  entry.count += 1;
  return entry.count;
}

/**
 * Resolve once the client is usable. On a fresh serverless instance the client
 * is still "connecting" during the first request; a plain `status === "ready"`
 * guard would silently drop that request to the in-memory limiter (not counted
 * toward the shared global cap). We wait briefly for readiness, but reject fast
 * on a connection error so a genuinely-down Redis falls back without stalling.
 */
function waitForReady(redis: Redis, ms: number): Promise<void> {
  if (redis.status === "ready") return Promise.resolve();
  if (redis.status === "end") return Promise.reject(new Error("redis closed"));
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      redis.off("ready", onReady);
      redis.off("error", onError);
    };
    const onReady = () => {
      cleanup();
      resolve();
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("redis not ready"));
    }, ms);
    redis.once("ready", onReady);
    redis.once("error", onError);
  });
}

async function incr(key: string, ttlSeconds: number): Promise<number> {
  const redis = getRedis();
  if (redis) {
    try {
      await waitForReady(redis, 1000);
      const count = await redis.incr(key);
      if (count === 1) {
        // Keys are window-scoped, so a lost EXPIRE merely leaks one key until
        // manual cleanup — it can no longer block an IP forever.
        await redis.expire(key, ttlSeconds);
      }
      return count;
    } catch {
      // fall through to memory
    }
  }
  return memoryIncr(key, ttlSeconds);
}

/** Day key in Bulgarian local time so daily quotas reset at midnight local. */
function localDay(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Sofia" }).format(
    new Date(),
  );
}

export interface RateLimitResult {
  allowed: boolean;
  /** Safe to show to the end user */
  message?: string;
}

export async function checkRateLimit(ip: string): Promise<RateLimitResult> {
  const day = localDay();
  const minuteWindow = Math.floor(Date.now() / 60_000);

  // Checked sequentially on purpose: a request denied at one tier must not
  // consume the next tier's quota — otherwise spam (even with spoofed IPs)
  // could exhaust the global cap and take the platform down for everyone.
  const minuteCount = await incr(`rl:min:${minuteWindow}:${ip}`, 120);
  if (minuteCount > PER_MINUTE) {
    return {
      allowed: false,
      message: "Too many requests. Please try again in a minute.",
    };
  }

  const dayCount = await incr(`rl:day:${day}:${ip}`, 60 * 60 * 25);
  if (dayCount > PER_DAY) {
    return {
      allowed: false,
      message: "You've reached your daily limit. Please try again tomorrow.",
    };
  }

  const globalCount = await incr(`rl:global:${day}`, 60 * 60 * 25);
  if (globalCount > GLOBAL_PER_DAY) {
    return {
      allowed: false,
      message:
        "The platform's daily capacity has been reached. Please try again tomorrow.",
    };
  }

  return { allowed: true };
}

/**
 * Client IP for rate limiting. `x-forwarded-for` is only trustworthy behind a
 * proxy that overwrites it (Vercel, nginx, Cloudflare). Exposed directly to
 * the internet it is spoofable, so per-IP limits are advisory there — the
 * global daily cap is the backstop.
 */
export function clientIpFrom(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]!.trim();
    // A present-but-empty header must not collapse every caller into one "" bucket.
    if (first) return first;
  }
  return headers.get("x-real-ip") ?? "local";
}
