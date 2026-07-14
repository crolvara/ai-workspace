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
- shadcn/Radix `<SelectValue>` must get explicit children (label looked up by value, see `chat-app.tsx`) — otherwise the closed trigger shows the raw key (`groq/llama-3.3-70b`) because portal-mounted items haven't registered their labels yet.
- Microcopy: sentence case, concise, no exclamation marks; users are addressed directly ("Describe the image you want…").
- Turbopack can keep serving a stale compiled CSS chunk after a `globals.css` edit (seen with `@theme` variable changes) — if a token change doesn't show up, restart the dev server before debugging further.

## Providers — free only

- Chat providers: **Groq** and **OpenRouter** (both OpenAI-compatible — use the `openai` package with a `baseURL` override), **Gemini** via `@google/genai`. No paid OpenAI/Anthropic APIs, ever.
- Image generation: **currently NO free route exists** (verified 2026-07-14). The Gemini API free tier no longer includes image models — image requests return 429 with `limit: 0` (quota is zero, not exhausted) while text models still work; OpenRouter has NO free image-output models either (all 10 image-output models in the catalog are paid, re-checked 2026-07-14). `/images` returns the graceful 502 error by design. Pending user decision: Cloudflare Workers AI (free tier, FLUX/SDXL) vs. enabling Google billing. Re-check both catalogs before concluding anything changed.
- Model registries in `src/lib/models.ts`: `MODELS` (chat) and `IMAGE_MODELS` (images). `key` = stable internal id, `id` = provider API id. Free catalogs rotate — when a model 404s, replace it there; nothing else should hardcode model ids.
- Env keys: `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `GEMINI_API_KEY` (all free tiers, links in README). Without keys the model endpoints return a graceful user-facing error (and still log the failure to `UsageLog`).
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
- Redis 7 is still **local Docker** on `:6380` via `docker-compose.yml` (`docker compose up -d redis`); without it the rate limiter falls back to in-memory. The old Postgres service remains in the compose file only as a data archive.
- `npm run build` needs the DB reachable: `/usage` is prerendered from Prisma aggregates and the build exits 1 if the connection fails.

## Deployment — Vercel (planned 2026-07-15)

- Target is **Vercel** (Hobby/free tier) with the Neon DB above. Env vars to set in the Vercel project: `DATABASE_URL` (pooled), `DIRECT_DATABASE_URL`, `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `GEMINI_API_KEY`, `REDIS_URL`, and the three rate-limit vars.
- **Redis must be Upstash** (free tier, official Vercel integration) — the local Docker Redis is unreachable from Vercel, and the in-memory fallback is useless on serverless (each instance counts separately), which silently disables abuse protection. Do not deploy publicly without a real `REDIS_URL`.
- `x-forwarded-for` is trustworthy on Vercel (the proxy overwrites it), so per-IP limits work as designed.
- **Rotate all three provider API keys before the first public deploy** — the current ones were pasted in plain text in a chat session (2026-07-14).
- **Vercel Blob: decided against** (2026-07-14) — generated images stay unpersisted data URLs (see Data access rules); Blob is storage, not generation, and adds nothing while the app has no image provider.

## Prisma 7 specifics

- Generator is `prisma-client` with `output = "../src/generated/prisma"`; import from `@/generated/prisma/client`. `/src/generated/` is gitignored — run `npx prisma generate` after pulling schema changes (and restart the dev server: it caches the old client).
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
- `/api/image` — plain JSON: POST `{prompt ≤2000, model}` → `{image: dataURL, text, latencyMs}` or `{error}` (user-facing message, 502 on provider failure); same rate limit → session → UsageLog flow.
- `/api/session` — GET, just ensures the anonymous cookie exists; pages that fan out parallel first-visit requests (e.g. `/compare`) call it once first to avoid racing session creation.

## Commands

- `npm run dev` / `npm run build` — dev server / production build (Turbopack)
- `npx prisma migrate dev` / `npx prisma generate` — migrations / client
- `npx tsc --noEmit` — type check
- `npm run db:cleanup` — data retention (drops 180-day-idle sessions and 90-day-old usage logs; run periodically)
- Visual checks: no Playwright in the repo — use installed Chrome headless against the dev server, e.g. `"C:\Program Files\Google\Chrome\Application\chrome.exe" --headless=new --window-size=1440,900 --virtual-time-budget=8000 --screenshot=<path> http://localhost:3000/` (`--force-dark-mode` for the dark theme)
