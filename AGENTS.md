<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

Confirmed for Next 16.2: `cookies()` is async; route handler `params` is a `Promise` (`await ctx.params`); route files may only export handlers — shared Zod schemas live in `src/lib/` (see `prompts-validation.ts`).

# AI Workspace — project rules

Public platform, **no auth, no billing**. Anonymous httpOnly cookie session (`aiw_sid`) gives per-browser history. Everything is **English**: UI text, validation and error messages, code, identifiers, commits and logs (English-only UI decided 2026-07 — do not reintroduce Bulgarian strings).

All 5 roadmap phases are complete: Chat (+history/compare/usage), Prompt Library, OCR, Audio (STT/TTS), Images.

## UI / design system

- Theme tokens live in `src/app/globals.css` (Tailwind 4 + shadcn, oklch): **monochrome, zero-chroma palette** (Vercel-style) — near-black primary on white in light, inverted in dark; no colored accent (user removed violet/indigo by explicit choice, 2026-07 — don't reintroduce color without asking). Emphasis comes from typography, contrast and inverted `bg-foreground text-background` blocks (logo, chat empty-state icon). Change light and dark together — both must keep AA contrast.
- In the `@theme inline` block `--font-sans` must map to `--font-geist-sans` (and `--font-heading` likewise) — a self-reference (`--font-sans: var(--font-sans)`) silently drops the whole app to the browser's serif fallback.
- Top nav is `src/components/nav-links.tsx` (client component, `usePathname` active pill). New pages must be added to its `NAV_LINKS`.
- Icons come from `lucide-react` — no ASCII/emoji glyphs (✕, ■, ☰) in the UI.
- The shadcn primitives are **Base UI** (`@base-ui/react`), not Radix — triggers/options/menu items render as `<div>`s with ARIA roles, not native buttons.
- `<SelectValue>` must get explicit children (label looked up by value, see `chat-app.tsx`) — otherwise the closed trigger shows the raw key (`groq/llama-3.3-70b`) because portal-mounted items haven't registered their labels yet.
- `SelectContent` defaults to Base UI's `alignItemWithTrigger` (selected item overlays the trigger), which spills past the viewport edge when the trigger sits near it — for selects close to the bottom (e.g. the chat model picker) pass `side="top" alignItemWithTrigger={false}`.
- Tailwind 4 preflight sets `cursor: default` on buttons; `globals.css` `@layer base` has a zero-specificity `:where(...)` rule restoring `cursor: pointer` on all enabled interactive elements (button + ARIA roles button/combobox/option/menuitem*/tab). Don't sprinkle `cursor-pointer` per component — new interactive elements are covered as long as they're a `<button>` or carry one of those roles.
- Microcopy: sentence case, concise, no exclamation marks; users are addressed directly ("Describe the image you want…").
- Turbopack can keep serving a stale compiled CSS chunk after a `globals.css` edit (seen with `@theme` variable changes) — if a token change doesn't show up, restart the dev server before debugging further.

## Providers — free only

- Chat providers: **Groq** and **OpenRouter** (both OpenAI-compatible — use the `openai` package with a `baseURL` override), **Gemini** via `@google/genai`. No paid OpenAI/Anthropic APIs, ever.
- Image generation: **Cloudflare Workers AI** (free tier, model `@cf/black-forest-labs/flux-1-schnell`), added 2026-07-17. It is the ONLY working free image route — the Gemini API free tier dropped image models (returns 429 `limit: 0`, quota zero not exhausted) and OpenRouter has NO free image-output models (all paid, re-checked 2026-07-14). The Workers AI REST run endpoint (`POST .../accounts/{id}/ai/run/{model}`, `Authorization: Bearer`) returns `{result:{image:"<base64 jpeg>"}}` in ~2–5s; free daily Neuron allocation covers a couple hundred images. Needs `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` (token = "Workers AI (Read)" scope). Gemini image models are kept in code as a fallback branch but stay unavailable on free tier. **Response-format trap:** `generateImageCloudflare` parses the FLUX-family JSON shape (`{result:{image:"<base64>"}}`); the Workers AI **SDXL / Stable Diffusion** models return a raw binary PNG body instead — adding one to `IMAGE_MODELS` needs a separate binary branch or it breaks the JSON parse.
- Model registries in `src/lib/models.ts`: `MODELS` (chat) and `IMAGE_MODELS` (images). `key` = stable internal id, `id` = provider API id. Free catalogs rotate — when a model 404s, replace it there; nothing else should hardcode model ids.
- OpenRouter `:free` rotation bit us 2026-07-14: `deepseek/deepseek-chat-v3-0324:free` and `google/gemma-3-27b-it:free` were moved to the paid catalog (404 "unavailable for free"). Query the live list before picking replacements: `GET https://openrouter.ai/api/v1/models`, filter `pricing.prompt === "0" && id.endsWith(':free')`.
- OpenRouter `:free` models also return transient **429 "Provider returned error"** under load — usually a single congested upstream provider, and free-tier keys (ours is `is_free_tier: true`) are deprioritized. A 429 is NOT a reason to swap the model; only a 404/410 is. Groq and Gemini are the reliable routes; treat OpenRouter as best-effort.
- Env keys: `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `GEMINI_API_KEY`, and `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` (images) — all free tiers, links in README/`.env.example`. Without keys the model endpoints return a graceful user-facing error (and still log the failure to `UsageLog`).
- Gemini keys from AI Studio now use the `AQ.` prefix (new format, confirmed working 2026-07-14) — don't reject them expecting `AIza...`.
- When a model call fails, the real provider error is in the `UsageLog.error` column — read it from the DB instead of guessing from the sanitized HTTP response.

## Local in-browser tools (no external services, no keys)

- **OCR**: Tesseract.js v7, fully client-side (`src/components/ocr/ocr-tool.tsx`, dynamic import, `bul`+`eng`); worker/core/langdata load from the jsdelivr CDN pinned to the installed version — keep the npm package and CDN in sync when upgrading.
- **STT**: Whisper via `@huggingface/transformers` v4, model `onnx-community/whisper-base` (multilingual, bg+en). **TTS**: Kokoro via `kokoro-js`, model `onnx-community/Kokoro-82M-v1.0-ONNX` (**English voices only**). Each runs in its own Web Worker (`src/components/audio/*-worker.ts`, WASM, q8); weights download from the Hugging Face CDN on first use and are browser-cached.
- **kokoro-js nests its own transformers v3 — never import `kokoro-js` and `@huggingface/transformers` into the same worker/process**: their onnxruntime natives conflict ("API version not available" error). The separate workers keep them isolated; test them in separate Node processes too.
- Audio decode/resample to 16 kHz mono happens on the main thread via `AudioContext` (`src/lib/audio.ts`).
- Tool → chat handoff: OCR/STT results and filled prompt templates reach the chat composer via sessionStorage `CHAT_DRAFT_KEY` (`src/lib/prompts.ts`).

## Infrastructure

- DB is **Neon Postgres** (cloud, decided 2026-07-14; replaced the local Docker Postgres). Two connection strings in `.env`: `DATABASE_URL` (pooled `-pooler` endpoint, runtime via `@prisma/adapter-pg`) and `DIRECT_DATABASE_URL` (direct endpoint, used by the Prisma CLI for migrations — `prisma.config.ts` prefers it).
- Both Neon URLs use **`sslmode=verify-full`** (switched from `require` 2026-07-14, in `.env` and Vercel): `pg` v8.16+ logs a security deprecation warning for `require`, and in pg v9 `require` downgrades to weak libpq semantics. Keep `verify-full` in any new connection string (it works with Node's default trust store — Neon certs are publicly signed); `channel_binding=require` stays (pg ignores it, libpq/Prisma CLI honor it).
- Redis: **local Docker** on `:6380` via `docker-compose.yml` (`docker compose up -d redis`) for dev; production uses **Upstash** (see Deployment). Without any Redis the rate limiter falls back to in-memory. The old Postgres service remains in the compose file only as a data archive.
- `npm run build` needs the DB reachable: `/usage` is prerendered from Prisma aggregates and the build exits 1 if the connection fails.

## Deployment — Vercel (live since 2026-07-14)

- Deployed on **Vercel** (Hobby/free tier) from GitHub `crolvara/ai-workspace` (branch `master`, auto-deploy on push) with the Neon DB above. Env vars in the Vercel project: `DATABASE_URL` (pooled), `DIRECT_DATABASE_URL`, `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `GEMINI_API_KEY`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `REDIS_URL`, and the three rate-limit vars — all environments, since `DATABASE_URL` is needed at **build time** too (the `/usage` prerender; first deploys failed on this).
- **Cloudflare fronts the Vercel origin.** The public domain `ai-workspace.konishevsoft.com` is proxied through Cloudflare (orange-cloud) in front of the Vercel deployment. This is why an origin **502/504** never reaches the client as-is: Cloudflare replaces gateway-class origin responses with its own "Bad gateway" page and drops the body. App-level errors must therefore use 500/503, not 502/504 (see API contracts). It also means the Hobby function cap matters: `/api/image` sets `export const maxDuration = 30` so its 25s internal provider timeout fires first and returns the graceful JSON error, instead of the function overrunning and Cloudflare surfacing a 502 (Hobby allows up to 60s; being explicit pins the ceiling above the internal timeout).
- Changing env vars does NOT redeploy by itself — trigger a Redeploy after editing them.
- Production `REDIS_URL` is **Upstash** (free tier) — the local Docker Redis is unreachable from Vercel, and the in-memory fallback is useless on serverless (each instance counts separately), which silently disables abuse protection. Never point production at anything but a real shared Redis.
- `x-forwarded-for` is trustworthy on Vercel (the proxy overwrites it), so per-IP limits work as designed.
- The three provider API keys were rotated for the deploy (2026-07-14) after the originals leaked into a chat session in plain text — the values in Vercel are the current ones.
- **Vercel Blob: decided against** (2026-07-14) — generated images stay unpersisted data URLs (see Data access rules); Blob is storage, not generation. Note: image generation now works (Cloudflare Workers AI, added 2026-07-17), but images are still intentionally unpersisted — revisit Blob only if durable image history is explicitly wanted.

## Prisma 7 specifics

- Generator is `prisma-client` with `output = "../src/generated/prisma"`; import from `@/generated/prisma/client`. `/src/generated/` is gitignored — run `npx prisma generate` after pulling schema changes (and restart the dev server: it caches the old client). Because it's gitignored, the build script is `prisma generate && next build` — required on Vercel (the first deploy failed with "Can't resolve '@/generated/prisma/client'" without it); don't simplify it back to plain `next build`.
- `datasource` block has **no `url`** — the connection URL lives in `prisma.config.ts` (`datasource.url`), loaded via `dotenv`. Runtime uses `@prisma/adapter-pg` (see `src/lib/db.ts`).

## Abuse protection (public app on shared free quotas)

- Every model-calling endpoint must go through `checkRateLimit()` (`src/lib/ratelimit.ts`): per-IP minute/day limits + global daily kill switch, all tunable via `RATE_LIMIT_PER_MINUTE` / `RATE_LIMIT_PER_DAY` / `GLOBAL_DAILY_REQUEST_CAP`.
- The tiers are checked **sequentially** (minute → day → global) so a denied request never consumes the next tier's quota — spam must not be able to drain the global cap. Keys are window-scoped (`rl:min:<epoch-minute>:<ip>`), so a lost Redis EXPIRE can't block an IP forever; day keys use Europe/Sofia local time.
- Redis-backed when `REDIS_URL` is set, in-memory fallback otherwise (dev only — not valid for multi-instance).
- `x-forwarded-for` is trusted for per-IP limits — deploy only behind a proxy that overwrites it; the global cap is the backstop against spoofing.

## Data access rules

- Every Conversation/Message/Prompt query **must be scoped by `sessionId`** from `getOrCreateSession()` — never trust a bare id from the client (use `updateMany`/`deleteMany` with both id and sessionId).
- `getOrCreateSession()` may set cookies → call it only from route handlers / server actions.
- Every completed or failed model call writes a `UsageLog` row — that powers `/usage`.
- Generated images are **never persisted** — they return to the client as data URLs; only the `UsageLog` row remains.
- Built-in prompt templates are code (`src/lib/prompts.ts`, `{{variable}}` syntax); user prompts are session-scoped DB rows.

## API contracts

- `/api/chat` — SSE, `data:`-framed JSON events in order: `meta` (conversationId, model) → `delta` (text chunks) → `done` (usage, latencyMs) | `error` (user-facing message). `ephemeral: true` skips all persistence except `UsageLog` (used by `/compare`). Client parser: `src/lib/sse-client.ts`.
  - Client disconnect/abort is propagated to the provider via `req.signal`; partial assistant text is still persisted, and a DB failure after a completed stream must NOT become an `error` event (the client keeps partial text on error). Missing API key fails fast with 503 before anything is persisted.
- `/api/image` — plain JSON: POST `{prompt ≤2000, model}` → `{image: dataURL, text, latencyMs}` or `{error}` (user-facing message; **500** on provider failure, **503** on missing key); same rate limit → session → UsageLog flow. Do NOT return a gateway-class status (502/504) here: Cloudflare fronts the Vercel origin and replaces origin 502/504 with its own "Bad gateway" page, dropping the JSON body so the client never sees `{error}` (this was the old bug — the user got a raw Cloudflare 502 instead of the graceful message).
- `/api/session` — GET, just ensures the anonymous cookie exists; pages that fan out parallel first-visit requests (e.g. `/compare`) call it once first to avoid racing session creation.

## Commands

- `npm run dev` / `npm run build` — dev server / production build (Turbopack)
- `npx prisma migrate dev` / `npx prisma generate` — migrations / client
- `npx tsc --noEmit` — type check
- `npm run db:cleanup` — data retention (drops 180-day-idle sessions and 90-day-old usage logs; run periodically)
- Visual checks: no Playwright in the repo — use installed Chrome headless against the dev server, e.g. `"C:\Program Files\Google\Chrome\Application\chrome.exe" --headless=new --window-size=1440,900 --virtual-time-budget=8000 --screenshot=<path> http://localhost:3000/` (`--force-dark-mode` for the dark theme)
