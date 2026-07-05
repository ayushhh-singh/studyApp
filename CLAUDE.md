# Project: PrayasUP — UPPSC Exam Prep Platform (working name)

## What this is
A bilingual (Hindi/English equal-first) web platform for UPPSC (UP PCS) aspirants.
Flagship feature: AI Answer Writing Evaluation for Mains descriptive answers
(typed or handwritten-photo upload), scored against a UPPSC-style rubric with
streaming feedback. Also: PYQ-based MCQ practice, syllabus-mapped learning,
AI-summarized current affairs (UP-specific focus), FSRS spaced repetition,
analytics, RAG doubt-solving chatbot.

## Architecture (FIXED — never deviate)
- Monorepo: /apps/web (Vite + React 19 SPA, TypeScript, React Router v7),
  /apps/api (Express, TypeScript), /packages/shared (types, zod schemas).
- NO Next.js anywhere. The web app is a pure SPA; the ONLY backend is the
  Express API.
- DB: Supabase cloud Postgres + pgvector. SAME project for local dev and
  production. All schema changes via SQL migration files in
  /supabase/migrations, applied with supabase CLI (db push).
- UI: shadcn/ui + Tailwind v4. Server state: TanStack Query. Client state:
  Zustand (minimal). i18n: react-i18next; all app URLs are /:locale/* with en
  as default.
- Fonts: Inter (latin) + Noto Sans Devanagari via Fontsource. Hindi typography
  is first-class, never a fallback.
- LLM (app runtime): Anthropic API — claude-sonnet-5 for answer evaluation +
  doubt chat; claude-haiku-4-5 for high-volume tasks (summaries, MCQ
  explanations, translation drafts). Model ids live in ONE constants module,
  never inline.
- Embeddings: OpenAI text-embedding-3-small (1536-dim, matches vector(1536)),
  behind src/lib/embeddings.ts so the provider is swappable.
- All AI responses stream via SSE from Express under /api/v1/stream/*. The web
  app consumes SSE ONLY through src/lib/sse.ts built on
  @microsoft/fetch-event-source (POST + Authorization headers — required once
  auth lands in Session 15).
- NO mock data anywhere. Every screen reads real rows from Supabase.

## Dev conventions
- pnpm workspaces. `pnpm dev` runs web (:3000) + api (:4000) concurrently.
- Env: /apps/web/.env.local uses VITE_* and holds browser-safe values ONLY
  (Supabase URL, anon key, API URL). /apps/api/.env holds all secrets (service
  role, ANTHROPIC_API_KEY, OPENAI_API_KEY). .env.example files always current.
- Until auth exists (Session 15): all API calls act as the seeded dev user
  (DEV_USER_ID in api env; never hardcode).
- Bilingual content: JSONB {"hi","en"} columns named *_i18n. Publish gate =
  both languages present.
- API: Express routes under /api/v1/*, zod-validated inputs, {data,error}
  envelope. SSE endpoints under /api/v1/stream/*.
- Routing: app pages under /:locale/*; route modules lazy; anything shareable
  (filters, tabs) lives in URL/search params.
- Content acquisition is automated: /content-sources.yaml + `pnpm
  content:fetch` download real UPPSC files into /content-raw (binaries
  gitignored; manifest committed). NEVER ask the user to manually download
  something the script can fetch; on fetch failure, print the exact URL for a
  one-click manual grab.
- Commit after every working feature. Never commit secrets. Mobile-first:
  verify every screen at 390px.

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
- Session 2 (2026-07-05): full database schema.
  - Supabase CLI added as a workspace dev dependency (`pnpm supabase …`); `supabase init` committed (`supabase/config.toml`). Linking (`supabase link --project-ref …`) is a per-machine step; the ref lives in `supabase/.temp/` (gitignored).
  - Complete schema in `supabase/migrations/0001`–`0014`: `pgcrypto` + `vector` (in the `extensions` schema, so vector types/opclasses are schema-qualified as `extensions.vector` / `extensions.vector_cosine_ops`); 17 tables; enums; `set_updated_at()` trigger on every table; pgvector `embeddings` with an HNSW cosine index.
  - Bilingual convention DECIDED — see the Dev conventions section: JSONB `*_i18n` columns, `i18n_complete()` helper, `questions.publish_gate_ok` generated column + publish-gate trigger.
  - RLS ENABLED on all tables with wide-open dev policies in `0013_dev_permissive_rls.sql` (marked "REPLACED IN AUTH PHASE") — strict per-user policies land in Session 15.
  - Dev user seeded with fixed id `00000000-0000-4000-8000-000000000001` (`0014_seed_dev_user.sql`) → set as `DEV_USER_ID` in apps/api/.env.
  - `@supabase/supabase-js` added to apps/api; `pnpm --filter api verify:schema` (apps/api/scripts/verify-schema.ts) HEAD-counts every table via the service-role key. Docs in `supabase/README.md`.
  - Edge-case audit (live-tested): fixed one latent bug — `answer_submissions.question_id` was `ON DELETE SET NULL` which collided with the `has_prompt` CHECK (deleting a referenced question failed with a cryptic 23514); now `ON DELETE RESTRICT` (`0016`). Strengthened the MCQ publish gate (`0017`) via `question_publishable(...)` — MCQ now requires ≥2 bilingual options + a matching `correct_option_key`; descriptive stays stem-only. Accepted-for-now (revisit Session 15): `tests`/`current_affairs` have no publish gate; `*_i18n` shape validated by zod at the API layer; the public anon key has full RW under permissive RLS.
- Session 2.5 (2026-07-05): migrated apps/web from Next.js to a Vite + React SPA. Express API, packages/shared, and the Supabase schema/data are untouched.
  - apps/web rebuilt from scratch: `pnpm create vite@latest`/`create-vite` react-ts template, React 19. `server.port: 3000` in vite.config.ts (unchanged CORS contract with the API) plus a `@/ -> src` alias mirrored in tsconfig.json/tsconfig.app.json and vite.config.ts.
  - Styling: Tailwind v4 via `@tailwindcss/vite`, then `shadcn@3.8.5 init --base-color neutral` (same 3.x-pin rationale as Session 1 — `shadcn@latest`'s `--base` flag now means component-library preset, not Tailwind base color).
  - Routing: react-router v7 (pinned explicitly — `pnpm add react-router` resolves v8 by default now), `createBrowserRouter` in `src/router.tsx`. `/` and unmatched paths redirect (loader-based) to `/${DEFAULT_LOCALE}`; `/:locale` is a lazy layout route (`src/routes/locale-layout.tsx`) that 404-redirects invalid locales and syncs `i18n.changeLanguage` + `document.documentElement.lang`/`dataset.locale` via effect; `/:locale` index is a lazy `src/routes/landing.tsx`. Redirect-only routes need an explicit `Component`/`HydrateFallback` (even if it returns `null`) or react-router logs dev-mode console warnings about the empty leaf route — this trips the "no console errors" DoD if left default.
  - i18n: i18next + react-i18next, resources ported verbatim from the old `messages/{hi,en}.json` into `src/messages/{hi,en}.json`. `src/lib/locale.ts` holds `SUPPORTED_LOCALES`/`isLocale`/`switchLocale` (pure path-rewrite helper); `src/hooks/use-locale.ts` reads the `:locale` URL param as source of truth.
  - DECIDED mid-session: default locale is **`en`**, not `hi` (overrides the Session-1 next-intl default and this task's original brief) — `DEFAULT_LOCALE` in `src/lib/locale.ts` is the single place this lives; everything else (router redirects, i18next `lng`/`fallbackLng`) derives from it.
  - Fonts: `@fontsource-variable/inter` + `@fontsource/noto-sans-devanagari` (400/500/700), both imported as side effects in `main.tsx`; needed ambient `declare module` entries in `src/vite-env.d.ts` since bare-specifier CSS package imports have no shipped types. Single font-family stack (Inter, Noto Sans Devanagari) in `body`; `line-height: 1.75` gated on `:root[data-locale="hi"]`.
  - Data/state: `@tanstack/react-query` provider in `main.tsx` (`retry: 1`, `staleTime: 30_000`); `zustand` installed, no store yet. `@microsoft/fetch-event-source` installed for the future `src/lib/sse.ts` (not built yet — no stream consumer on this landing page).
  - Env: `apps/web/.env.example`/`.env.local` now `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`/`VITE_API_URL`, read only via `import.meta.env`. Repo-wide grep for `NEXT_PUBLIC_`/`next/*` confirmed clean — nothing left to remove.
  - Verified with a headless-browser pass (Playwright, no `chromium-cli` on this machine): `/` client-redirects to `/en`, `/hi` ⇄ `/en` toggle rewrites the URL and swaps copy (Devanagari renders correctly with the taller line-height), API health box shows live `{"data":{"ok":true},"error":null}`, zero console errors/warnings, no horizontal overflow at 390px or 1440px.
