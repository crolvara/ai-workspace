# AI Workspace

A public platform (no sign-up, no billing) that brings free AI models together in one place: streaming chat, conversation history, model comparison and usage statistics.

## Stack

- **Next.js 16** (App Router, RSC, Route Handlers) + **React 19** + **Tailwind 4** + **shadcn/ui**
- **PostgreSQL** (Neon) + **Prisma 7** (`@prisma/adapter-pg`)
- **Redis 7** — rate limiting (with an in-memory fallback for dev without Redis)
- Providers (free only): **Groq**, **OpenRouter** (`:free` models), **Google Gemini**

## Getting started

```bash
# 1. Database — set DATABASE_URL / DIRECT_DATABASE_URL in .env (Neon Postgres,
#    see .env.example). Redis for rate limiting (optional in dev):
docker compose up -d redis

# 2. Dependencies and migrations
npm install
npx prisma migrate dev

# 3. API keys — fill in .env (all three are free):
#    GROQ_API_KEY       → https://console.groq.com/keys
#    OPENROUTER_API_KEY → https://openrouter.ai/settings/keys
#    GEMINI_API_KEY     → https://aistudio.google.com/apikey

# 4. Dev server
npm run dev
```

## Structure

| Path | Description |
|---|---|
| `src/lib/models.ts` | Model registry — new models are added here |
| `src/lib/providers.ts` | Streaming layer (Groq/OpenRouter via the `openai` package, Gemini via `@google/genai`) |
| `src/lib/ratelimit.ts` | Per-IP limits (minute/day) + global daily kill switch |
| `src/lib/session.ts` | Anonymous session via httpOnly cookie — history works without login |
| `src/app/api/chat/route.ts` | SSE streaming endpoint + message and usage persistence |
| `src/app/page.tsx` | Chat with history (sidebar) and model picker |
| `src/app/compare/page.tsx` | Side-by-side comparison of up to 3 models |
| `src/app/usage/page.tsx` | Statistics for the last 7 days |
| `src/app/audio/page.tsx` | Speech to text (Whisper) and text to speech (Kokoro) in the browser |
| `src/app/images/page.tsx` | Image generation (Gemini, free tier) |

## Quota protection (public app without login)

- Per-IP limits: `RATE_LIMIT_PER_MINUTE` (10) and `RATE_LIMIT_PER_DAY` (200)
- Global daily limit: `GLOBAL_DAILY_REQUEST_CAP` (5000) — kill switch for the whole platform
- Everything is configured via `.env`

## Roadmap

- [x] Phase 1 — Chat core: multi-model chat, history, comparison, statistics
- [x] Phase 2 — Prompt Library (categories, templates with `{{variables}}`, personal prompts per session)
- [x] Phase 3 — OCR with **Tesseract.js** (Bulgarian + English, fully in the browser — the image never leaves your computer)
- [x] Phase 4 — Audio: speech to text with **Whisper** and text to speech with **Kokoro** (fully in the browser, Web Workers)
- [x] Phase 5 — Image generation (Gemini free tier; images are never stored on the server)
