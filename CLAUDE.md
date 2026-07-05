# Project: PrayasUP — UPPSC Exam Prep Platform (working name)

## What this is
A bilingual (Hindi/English equal-first) web platform for UPPSC (UP PCS) aspirants.
Flagship feature: AI Answer Writing Evaluation for Mains descriptive answers
(typed or handwritten-photo upload), scored against a UPPSC-style rubric with
streaming feedback. Also: PYQ-based MCQ practice, syllabus-mapped learning,
AI-summarized current affairs (UP-specific focus), FSRS spaced repetition,
analytics, RAG doubt-solving chatbot.

## Architecture (FIXED — never deviate)
- Monorepo: /apps/web (Next.js 15 App Router, TypeScript), /apps/api (Express, TypeScript), /packages/shared (types, zod schemas)
- DB: Supabase cloud Postgres + pgvector. SAME project for local dev and production. All schema changes via SQL migration files in /supabase/migrations, applied with supabase CLI (db push).
- UI: shadcn/ui + Tailwind. Server state: TanStack Query. Client state: Zustand. i18n: next-intl (hi + en, hi is default locale).
- LLM: Anthropic API. claude-sonnet-4-6 for answer evaluation + doubt chat; claude-haiku-4-5 for high-volume tasks (summaries, MCQ explanations, translations draft). All AI responses stream via SSE from the Express API.
- Embeddings: OpenAI `text-embedding-3-small` (1536-dim, matches the `vector(1536)` schema column). Decided early since we already have an OpenAI key available.
- NO mock data anywhere. Every screen reads real rows from Supabase. Seed real UPPSC content via ingestion scripts.

## Dev conventions
- pnpm workspaces. `pnpm dev` runs web (:3000) + api (:4000) concurrently.
- Env: /apps/web/.env.local and /apps/api/.env (gitignored). .env.example kept updated.
- Until auth exists (Session 15): all API calls act as the seeded dev user (id in env: DEV_USER_ID). Express reads it from env; never hardcode.
- Every table bilingual pattern: content columns are JSONB {"hi": "...", "en": "..."} OR paired columns *_hi / *_en (decide once in Session 2, record here).
- API: Express routes under /api/v1/*, zod-validated inputs, consistent {data, error} envelope. SSE endpoints under /api/v1/stream/*.
- Commit after every working feature. Never commit secrets.
- Mobile-first responsive: most users are on phones. Test every screen at 390px width.

## Definition of done for any UI session
Runs locally with `pnpm dev`, renders REAL Supabase data, works at 390px and 1440px, both locales render (language toggle), no console errors.

## Session log
- Session 0 (2026-07-05): repo initialized, CLAUDE.md created, empty workspace skeleton committed. Pushed to private GitHub repo github.com/ayushhh-singh/studyApp.
- Pre-Session-1 (2026-07-05): apps/api/.env and apps/web/.env.local created (gitignored). ANTHROPIC_API_KEY and OPENAI_API_KEY reused from the same account's nyay-sahayak project. SUPABASE_URL/keys still need a NEW cloud Supabase project — not reused, since nyay-sahayak's is a local-only instance with an unrelated schema.
- Session 1 (2026-07-05): scaffolded the full monorepo.
  - apps/web: Next.js 15 (App Router, TS, Tailwind v4, src dir, `@/*` alias). shadcn/ui initialized with `--base-color neutral` using the classic `shadcn@3.8.5` CLI — the `shadcn@latest` (4.x) CLI has switched to a new preset/registry system (`--base` now picks `radix`/`base` component libraries, not a Tailwind base color) and is not what we want here; pin to 3.x for `init`/`add` until we deliberately opt into the new system.
  - i18n: next-intl using the `/[locale]/` app-dir pattern (`src/app/[locale]/...`), `src/i18n/{routing,navigation,request}.ts`, `src/middleware.ts`, messages in `apps/web/messages/{hi,en}.json`. Locales `hi` (default), `en`. `/` redirects to `/hi`.
  - Fonts: Inter (latin) + Noto Sans Devanagari, both exposed as CSS vars and wired into the Tailwind `--font-sans` stack in globals.css so Hindi and English share one font pipeline.
  - State/data: TanStack Query wired via a client `Providers` component in `src/app/providers.tsx`; Zustand installed, no store yet (first one lands with the first feature that needs client state).
  - packages/shared: `@prayasup/shared`, plain TS source consumed directly (no build step) — `type: module` + `main`/`types` pointing at `src/index.ts`. Both apps resolve it via the pnpm workspace symlink; Next.js needs `transpilePackages: ["@prayasup/shared"]` in next.config.ts for this to bundle correctly, and the package itself needs `"type": "module"` or Node's CJS/ESM interop breaks re-exports (`export *`) when tsx imports it from apps/api.
  - apps/api: Express + TS, run via `tsx watch`. Had to add `--exclude '**/node_modules/**'` to the `tsx watch` script — in this pnpm workspace, tsx's default watch ignore doesn't cover the hoisted root `node_modules`, so without the flag the API kept hot-restarting on unrelated dependency file changes.
  - SSE helper at apps/api/src/lib/sse.ts (`createSseConnection` → `{send, close}`), demo route `/api/v1/stream/ping` streams 5 one-second ticks then closes.
  - Root `pnpm dev` uses `concurrently` to run both apps with prefixed/colored logs.
  - Verified: `pnpm dev` boots web (:3000) + api (:4000); `curl /api/v1/health` → `{"data":{"ok":true},"error":null}`; SSE ticks stream correctly; `/hi` and `/en` both render with correct copy; language switcher works.
