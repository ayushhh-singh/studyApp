# Operations

## Architecture

- **Web** (`apps/web`): Vite SPA, deployed to Vercel. `apps/web/vercel.json`
  handles the SPA fallback rewrite. Build command is plain `pnpm run build`
  (no prerendering) — see "Prerendering" below for why that's a deliberate
  choice, not an oversight.
- **API** (`apps/api`): Express, deployed to Render as a Docker web service
  (`apps/api/Dockerfile`) plus five Render Cron Jobs for background work.
  `render.yaml` is the Blueprint that defines all of it. Render was chosen
  over Railway because Render Cron Jobs are a first-class resource with their
  own run history/logs — a better fit for `ca:run`/`daily:build`/`qgen:topup`/
  `nightly:settle`/`notifications:run` than bundling them into node-cron
  ticks inside the always-on process (which is how local `pnpm dev` runs them,
  for convenience — see `src/ca/scheduler.ts` and `src/daily/scheduler.ts`,
  both explicitly dev-only).
- **Database**: Supabase cloud Postgres + pgvector — the SAME project used
  for local dev and production (per CLAUDE.md). No separate prod project.
- **Runtime note**: the API's production start command is `pnpm start` →
  `tsx src/index.ts`, not `node dist/index.js`. `@prayasup/shared` ships raw
  `.ts` source with no build step (a deliberate project decision), so plain
  `node` cannot resolve/execute it — `tsx` (a real dependency of `apps/api`,
  not a devDependency) is the production runtime, exactly as it already is in
  dev (`tsx watch`). Don't "fix" this back to `node dist/index.js` without
  first giving `@prayasup/shared` an actual build step.

## One-time deploy setup (manual — needs your accounts/credentials)

1. **Vercel**: import the repo, set Root Directory to `apps/web`, framework
   preset Vite. Env vars (Project Settings → Environment Variables), Production
   + Preview: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_URL`
   (`https://api.<domain>`), `VITE_VAPID_PUBLIC_KEY`, optionally
   `VITE_SENTRY_DSN`. Preview deploys get their own preview API URL only if
   you stand up a preview API instance — otherwise point previews at the same
   prod API (fine for a pre-launch app) and just accept that preview web
   builds hit real prod data.
2. **Render**: New → Blueprint, connect the repo, it reads `render.yaml`. Fill
   in every `sync: false` var in the `prayasup-secrets` env var group —
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`,
   `OPENAI_API_KEY`, `RAZORPAY_KEY_ID`/`_SECRET`/`_WEBHOOK_SECRET`,
   `VAPID_PUBLIC_KEY`/`_PRIVATE_KEY`/`_SUBJECT`, optionally `SENTRY_DSN` —
   plus `ALLOWED_ORIGINS` on the web service specifically (comma-separated
   prod web origin(s), e.g. `https://prayasup.app,https://www.prayasup.app`).
3. **Domain**: point the apex/`www` at Vercel (per Vercel's DNS instructions)
   and `api.<domain>` at Render (CNAME, per Render's instructions). Update
   `VITE_API_URL` (Vercel) and `ALLOWED_ORIGINS` (Render) once the real domain
   is live — do this before the Razorpay/Google steps below, since both need
   the real prod URL.
4. **Razorpay**: switch from test to live keys when ready for real payments
   (separate key pair from test mode). Dashboard → Webhooks → add
   `https://api.<domain>/api/v1/billing/webhook`, copy the webhook secret into
   Render's `RAZORPAY_WEBHOOK_SECRET`.
5. **Google OAuth** (still pending per CLAUDE.md's TODO list — not part of
   this deploy pass): Google Cloud Console redirect URI
   `https://<supabase-project>.supabase.co/auth/v1/callback`; Supabase Auth →
   Providers → Google; Supabase Auth → URL Configuration → add the prod
   origin to the Site URL/redirect allowlist.
6. **Supabase prod hardening**: enable point-in-time backups (Database →
   Backups), confirm Storage CORS on the `answer-images` bucket allows the
   prod origin, confirm Auth → URL Configuration lists the prod origin (not
   just `localhost:3000`).

Then run `docs/launch-checklist.md` end to end against the real URLs before
tagging `v1.0.0`.

## Cron schedule reference

All Render Cron Job schedules are UTC (no IANA timezone support). IST = UTC+5:30.

| Job | UTC schedule | IST equivalent | Script |
|---|---|---|---|
| `prayasup-daily-build` | `30 23 * * *` | 05:00 | `pnpm daily:build` |
| `prayasup-ca-run` | `0 */6 * * *` | every 6h | `pnpm ca:run` |
| `prayasup-qgen-topup` | `30 21 * * *` | 03:00 | `pnpm qgen:topup` |
| `prayasup-nightly-settle` | `35 18 * * *` | 00:05 | `pnpm nightly:settle` (streak + Perfect Day + mastery recompute + mentor insights — bundled because `src/daily/scheduler.ts`'s dev equivalent already groups them) |
| `prayasup-notifications` | `0 * * * *` | hourly | `pnpm notifications:run` (notification_schedule generation + web push send) |

## Weekly ops routine (~30–60 min/week)

- **Content**: `pnpm content:fetch` to pull any newly-released UPPSC PDFs
  (papers, syllabus updates); re-run the relevant `ingest:*` scripts if new
  content lands mid-cycle rather than waiting for the next exam year.
- **Review Queue** (`/admin/review`, `is_admin` gated): ~15 min/day —
  approve/edit/reject `needs_review` questions, notes, and community reports.
  Don't let this queue back up; qgen/notes generation both write here, not
  straight to published.
- **Current-affairs source review**: spot-check `pnpm ca:run`'s output weekly
  — RSS feeds go dead or change format without warning (this already happened
  once with PIB/UP-government feeds during initial sourcing — see CLAUDE.md
  Session 12). If a source stops producing items, find and swap in a
  replacement in `src/ca/sources.ts`.
- **Cost check**: `pnpm --filter api cost:report [--days 7]` — watch for
  per-evaluation / per-CA-run cost drift, and cache-hit-rate dropping
  (prompt-cache misses are the single biggest lever on Anthropic spend here).
  Update `lib/models.ts`'s `standard` pricing once Anthropic publishes real
  post-intro prices (still a placeholder — see CLAUDE.md TODO list).
- **Evaluation prompt tuning**: `pnpm --filter api eval:answers --runs 3` —
  gates on ranking (good > mediocre > off-topic) and repeatability (≤5% of
  full marks). Re-run after any prompt change in `src/services/evaluation/`.

## Prerendering (deliberately not wired into the Vercel build)

`apps/web/scripts/prerender.mjs` snapshots `/en`/`/hi` via a real headless
Chromium after the build — genuinely useful for SEO/OG tags, but it needs a
Playwright Chromium binary present at build time, which is fragile on a
managed build image you don't control (missing system libs, no root for
`apt-get`, etc. — real failure modes, not hypothetical). The codebase already
keeps `prerender` as a separate step from `build` for exactly this reason
(see the script's own header comment). Default Vercel deploy skips it in
favor of a build that reliably succeeds every time. If you want it: change
`apps/web/vercel.json`'s `buildCommand` to
`npx playwright install chromium && pnpm run build:ci`, test a deploy, and
watch the build logs closely the first few times before trusting it.
