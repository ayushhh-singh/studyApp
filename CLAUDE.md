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
- Embeddings: for pgvector RAG (pick one cost-effective embedding provider in Session 3 and record the decision here).
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
- Session 0 (2026-07-05): repo initialized, CLAUDE.md created, empty workspace skeleton committed.
