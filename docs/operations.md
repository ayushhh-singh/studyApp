# Operations

## Architecture

- **Web** (`apps/web`): Vite SPA, deployed to **Cloudflare Pages (Free)** —
  the current ₹0 deploy target. `apps/web/public/_redirects` +
  `apps/web/public/_headers` (copied verbatim into `dist/` by Vite's normal
  `public/` handling — no extra build step) cover the SPA fallback + caching
  rules. `apps/web/vercel.json` is kept, unused, as the **paid upgrade path**
  (Vercel) — see "Upgrading to paid" below. Don't delete either config.
- **API** (`apps/api`): Express, deployed to **Render's FREE web service
  tier** — the current ₹0 deploy target — via `apps/api/Dockerfile`. No cron
  jobs on the free tier (Render Cron Jobs need a paid plan); every background
  job instead runs as a **GitHub Actions scheduled workflow**
  (`.github/workflows/{ca-run,daily-build,qgen-topup,nightly-settle,
  notifications,backup}.yml`). `render.yaml` is kept, unused-on-this-path, as
  the **paid upgrade path** (Render Starter + first-class Cron Jobs) — see
  "Upgrading to paid" below. Don't delete it.
- **Database**: Supabase cloud Postgres + pgvector — the SAME project used
  for local dev and production (per CLAUDE.md). No separate prod project.
- **Runtime note**: the API's production start command is `pnpm start` →
  `tsx src/index.ts`, not `node dist/index.js`. `@prayasup/shared` ships raw
  `.ts` source with no build step (a deliberate project decision), so plain
  `node` cannot resolve/execute it — `tsx` (a real dependency of `apps/api`,
  not a devDependency) is the production runtime, exactly as it already is in
  dev (`tsx watch`). This is true on both the free and paid Render paths.
  Don't "fix" this back to `node dist/index.js` without first giving
  `@prayasup/shared` an actual build step.

## Free-tier (₹0) deploy — current target

### Cloudflare Pages (web)

- **Build command**: `pnpm --filter web build`
- **Build output directory**: `apps/web/dist`
- **Root directory**: repo root (NOT `apps/web`) — this is a pnpm workspace;
  Cloudflare needs to run `pnpm install` at the monorepo root so
  `@prayasup/shared`'s workspace symlink resolves before Vite builds.
- **Environment variables** (Pages dashboard → your project → Settings →
  Environment variables — set for both Production and Preview):
  `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
  `VITE_API_URL=https://<render-service>.onrender.com`,
  `VITE_VAPID_PUBLIC_KEY`, optionally `VITE_SENTRY_DSN`.
- **Prerendering is a separate, optional step** — same rationale as before
  (needs a Playwright Chromium binary at build time, fragile on a managed
  build image); it is NOT wired into the Pages build command. Run
  `pnpm --filter web prerender` locally (or in a separate CI job you control)
  after a build and publish the resulting `dist/{en,hi}/index.html` +
  `dist/{en,hi}/pricing/index.html` snapshots if you want them live — see
  "Prerendering" below for exactly how Cloudflare serves them.

#### Verified against `wrangler pages dev` (live, not assumed)

Ran `pnpm --filter web build && pnpm --filter web prerender`, then
`wrangler pages dev dist` (wrangler 4.108.0) and hit real routes:

- **Exact-match static files win over the `_redirects` fallback**, as
  required: `/en/`, `/hi/`, `/en/pricing/`, `/hi/pricing/` all served the real
  prerendered snapshot (confirmed via distinct `<title>` text and byte size —
  e.g. `/en/` returned the real "AI evaluation for your UPPSC Mains answers"
  title at 29,236 bytes, not the generic 1,603-byte SPA shell). Unmatched
  routes (`/en/dashboard`, `/nonexistent-route`, `/`) correctly fall back to
  the plain SPA shell (200, generic title) for client-side routing to take
  over.
- **TRAILING-SLASH GOTCHA (real, disclosed — unlike Vercel)**: Cloudflare
  Pages issues a **308 redirect** from `/en` → `/en/` (and `/en/pricing` →
  `/en/pricing/`) before serving the prerendered file — confirmed via
  `curl -D -`. Vercel's static server, by contrast, serves `/en` directly
  with no redirect (see the existing Prerendering note below). This is
  Cloudflare's own asset-server directory-index behavior, not something
  `_redirects` controls, and it means `PageSeo`'s canonical/hreflang tags
  (`apps/web/src/components/seo/page-seo.tsx`), which declare the
  **no-trailing-slash** form (e.g. `https://prayasup.app/en`), point at a URL
  that itself redirects to a different URL. Most crawlers handle a
  redirect-to-canonical chain fine, but it's not byte-identical — a real,
  minor SEO wrinkle, not fixed here (fixing it means either always emitting a
  trailing slash in `PageSeo`, or reaching for Cloudflare's `html_handling`
  config; both are scope creep for a deploy-config pass). Flagged for
  whoever next touches SEO.
- **The `_redirects` file's `/* /index.html 200` rule is actually a no-op on
  current Cloudflare tooling** — `wrangler pages dev` logs it as an "invalid
  redirect rule... infinite loop detected" and silently ignores it (a known
  interaction between an explicit index.html rewrite and Cloudflare's own
  newer default trailing-slash/html-handling normalization). Confirmed by
  removing the file entirely: unmatched routes still correctly 200 with the
  SPA shell, because Cloudflare Pages' asset server has its own built-in
  SPA-fallback independent of `_redirects`. The rule is kept anyway — it's
  the standard documented Cloudflare Pages SPA pattern, harmless when
  ignored, and is exactly what would be needed if Cloudflare's default
  behavior ever changes.
- **`_headers` cache rules verified live**: `GET /assets/<hashed>.js` →
  `Cache-Control: public, max-age=31536000, immutable`; `GET /sw.js` →
  `Cache-Control: public, max-age=0, must-revalidate` — byte-identical intent
  to `vercel.json`'s `headers` block.

### Render (API) — FREE web service

- Same `apps/api/Dockerfile` and `healthCheckPath: /api/v1/health` as the
  paid Blueprint, just created as a plain **Free** web service (Render
  dashboard → New → Web Service → connect the repo, Dockerfile path
  `apps/api/Dockerfile`, build context repo root) instead of via
  `render.yaml`'s Blueprint flow (which defaults every service to
  `plan: starter`). No Cron Jobs on this tier — every job that would have
  been a Render Cron Job is now a GitHub Actions scheduled workflow (below).
- **Env vars**: the same set documented in `render.yaml`'s `prayasup-secrets`
  group — `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`,
  `OPENAI_API_KEY`, `QGEN_BATCH_MAX_USD` (default `5`), `RAZORPAY_KEY_ID`/
  `_SECRET`/`_WEBHOOK_SECRET`, `VAPID_PUBLIC_KEY`/`_PRIVATE_KEY`/`_SUBJECT`,
  optionally `SENTRY_DSN`, plus `ALLOWED_ORIGINS` (your Pages domain) and
  `ALLOWED_ORIGIN_SUFFIXES=.pages.dev` (so Cloudflare Pages' per-branch
  preview deploys, a different exact origin every build, aren't locked out —
  see `apps/api/src/index.ts`'s CORS setup, unchanged from the paid path).
  Set these directly on the service via Render's dashboard Environment tab —
  there's no Blueprint env-var-group convenience on this manual-create path.
- **FREE-TIER TRADEOFF (state this to users honestly)**: Render's free web
  services **spin down after ~15 minutes of no inbound traffic**, and the
  next request pays a **cold start of roughly 30–60 seconds** while the
  container reboots. Two mitigations, neither eliminates it entirely:
  1. An external uptime monitor (e.g. UptimeRobot's free plan, 5-minute
     interval) pinging `GET https://<render-service>.onrender.com/api/v1/health`
     keeps the service warm during normal traffic hours.
  2. The GitHub Actions cron workflows below invoke their scripts directly
     via `tsx` against Supabase — they do **not** hit the deployed Render
     HTTP service at all, so don't rely on them to keep it warm.
  - Bottom line: the very first request after an idle stretch (e.g. a user
    opening the app first thing in the morning) can take up to a minute
    before anything loads. This is the honest, disclosed cost of ₹0 —
    eliminating it means the paid Starter plan (see "Upgrading to paid").
  - Check Render's current free-tier CPU/RAM limits in their dashboard before
    relying on this for real traffic — these numbers change and shouldn't be
    hardcoded here from memory.

### Cron/scheduled work — GitHub Actions

Every background job that `render.yaml` runs as a Render Cron Job has an
equivalent GitHub Actions scheduled workflow under `.github/workflows/`:
`ca-run.yml`, `daily-build.yml`, `qgen-topup.yml`, `nightly-settle.yml`,
`notifications.yml` — plus a new `backup.yml` with no Render equivalent (see
"Weekly encrypted DB backup" below). Each workflow: checks out the repo,
sets up pnpm + Node 20 (with pnpm's dependency cache), runs
`pnpm install --frozen-lockfile --filter api...` (installs only `apps/api`
and its workspace deps — `@prayasup/shared` — not `apps/web`'s much heavier
toolchain), then runs the relevant `pnpm --filter api <script>` with secrets
injected as env vars. Each has `workflow_dispatch` for manual runs and a
`concurrency` group (no `cancel-in-progress`) so a slow run finishes rather
than getting killed mid-write, with the next scheduled tick queuing behind it
instead of overlapping.

**GitHub Actions cron is best-effort** — expect several minutes of drift
under GitHub-wide load; never treat these schedules as a precise clock (the
same caveat Render Cron Jobs' UTC-only schedule field already carried, just a
different kind of imprecision). **Scheduled workflows are automatically
paused after 60 days with zero repository activity** — any push/commit
resets that clock. If a job silently stops firing, check the repo's Actions
tab for a "workflow disabled" banner before assuming something else broke.

#### Required GitHub repo secrets (Settings → Secrets and variables → Actions)

| Secret | Used by |
|---|---|
| `SUPABASE_URL` | all five job workflows |
| `SUPABASE_SERVICE_ROLE_KEY` | all five job workflows |
| `ANTHROPIC_API_KEY` | `ca-run`, `qgen-topup`, `nightly-settle` (mentor insights) |
| `OPENAI_API_KEY` | `ca-run`, `qgen-topup` (embeddings, for dedup/RAG) |
| `QGEN_BATCH_MAX_USD` | `qgen-topup` (optional — falls back to `5` if unset) |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | `notifications` |
| `SUPABASE_DB_URL` | `backup` only — see below, this must be the **Session pooler** connection string, NOT the direct `db.<ref>.supabase.co` host |
| `BACKUP_PASSPHRASE` | `backup` only |

### Weekly encrypted DB backup

`backup.yml` runs Sundays: `pg_dump` (custom format, via a freshly-installed
latest `postgresql-client` from the official PGDG apt repo — avoids a
client/server major-version mismatch, since Ubuntu's default apt repo can lag
behind whatever Postgres version Supabase runs) → piped through
`gpg --symmetric --cipher-algo AES256` → uploaded as a 90-day-retention
Actions artifact. **The plaintext dump is deleted immediately after
encryption and never uploaded** — Actions artifacts are downloadable by
anyone with repo read access, so an unencrypted dump would be a real leak,
not a hypothetical one.

**IMPORTANT — GitHub-hosted runners do not have reliable outbound IPv6.**
Supabase's *direct* connection host (`db.<ref>.supabase.co`, used elsewhere in
this repo for `supabase db push` — see the `supabase-headless-migrations`
memory) is IPv6-only and will hang/time out from a GitHub Actions runner.
`SUPABASE_DB_URL` must instead be the **Session pooler** connection string
(IPv4; unlike the Transaction pooler it supports the multi-statement session
`pg_dump` needs) — copy it verbatim, with the real password substituted in,
from Supabase Dashboard → Project Settings → Database → Connection string →
"Session pooler".

**Restore** (decrypt, then restore into the same or a fresh Postgres):

```
gpg --decrypt --batch --passphrase "$BACKUP_PASSPHRASE" backup.pgdump.gpg > backup.pgdump
pg_restore --no-owner --no-privileges -d "$SUPABASE_DB_URL" backup.pgdump
```

**Store `BACKUP_PASSPHRASE` in a real password manager, not only as a GitHub
secret.** GitHub secrets are write-only — once set, nothing (not even repo
admins, not the API) can read the value back out. If you lose it anywhere
else, every existing backup artifact becomes permanently undecryptable noise.

## One-time deploy setup (manual — needs your accounts/credentials)

1. **Cloudflare Pages**: dashboard → Workers & Pages → Create → Pages →
   connect the repo. Set build command/output/root directory and env vars
   exactly as in the "Cloudflare Pages" section above.
2. **Render**: New → Web Service (not Blueprint, unless you've locally edited
   `render.yaml`'s `plan: starter` to `plan: free` for your own use — the
   checked-in file stays `starter` since it's the paid-path reference).
   Connect the repo, Dockerfile path `apps/api/Dockerfile`, plan **Free**.
   Fill in every env var listed in the "Render (API)" section above.
3. **UptimeRobot** (or any free uptime monitor): add an HTTP(S) monitor
   against `https://<render-service>.onrender.com/api/v1/health`, 5-minute
   interval, to reduce (not eliminate) free-tier cold starts.
4. **GitHub Actions secrets**: Settings → Secrets and variables → Actions →
   add every secret in the table above.
5. **Domain**: point it at Cloudflare Pages (per Cloudflare's custom-domain
   instructions) for the web app; the API can stay on its `onrender.com`
   subdomain or get its own `api.<domain>` CNAME via Render's custom domain
   flow. Update `VITE_API_URL` (Pages) and `ALLOWED_ORIGINS` (Render) once a
   real domain is live — do this before the Razorpay/Google steps below,
   since both need the real prod URL.
6. **Razorpay**: switch from test to live keys when ready for real payments
   (separate key pair from test mode). Dashboard → Webhooks → add
   `https://<api-host>/api/v1/billing/webhook`, copy the webhook secret into
   Render's `RAZORPAY_WEBHOOK_SECRET`.
7. **Google OAuth** (still pending per CLAUDE.md's TODO list — not part of
   this deploy pass): Google Cloud Console redirect URI
   `https://<supabase-project>.supabase.co/auth/v1/callback`; Supabase Auth →
   Providers → Google; Supabase Auth → URL Configuration → add the prod
   origin to the Site URL/redirect allowlist.
8. **Supabase prod hardening**: enable point-in-time backups (Database →
   Backups) as the primary safety net (the weekly GitHub Actions backup above
   is a cheap independent second copy, not a replacement), confirm Storage
   CORS on the `answer-images` bucket allows the prod origin, confirm Auth →
   URL Configuration lists the prod origin (not just `localhost:3000`).

Then run `docs/launch-checklist.md` end to end against the real URLs before
tagging `v1.0.0`.

## Upgrading to paid (when there's revenue to justify it)

The ₹0 stack's ceiling is real: Render free cold starts, no first-class cron
run history/retries, and Cloudflare Pages' own free-tier limits. When it's
worth paying for headroom:

- **Web → Vercel**: `apps/web/vercel.json` is already committed and
  deployable as-is — import the repo in Vercel, Root Directory `apps/web`,
  framework preset Vite, same `VITE_*` env vars as the Cloudflare Pages
  section above. See the "Prerendering" section below for Vercel's serving
  behavior (no trailing-slash redirect, unlike Cloudflare).
- **API + cron → Render Starter**: `render.yaml` is already committed and
  deployable as-is via Render's Blueprint flow ("New → Blueprint", connect
  the repo) — it provisions the always-on Starter web service AND all five
  Render Cron Jobs in one shot, replacing the GitHub Actions workflows with
  Render's own first-class cron (per-job run history/retries/logs). Fill in
  every `sync: false` value in the `prayasup-secrets` env var group via the
  dashboard.
- **Turn off the GitHub Actions workflows once Render Cron Jobs take over**
  — disable them from the repo's Actions tab (Settings → Actions → General,
  or per-workflow "..." → Disable workflow) rather than deleting the files,
  in case you ever need to fall back. Running both at once double-executes
  every job (harmless for idempotent ones like `ca:run`, but wasteful spend
  for `qgen:topup`).
- Update `VITE_API_URL` (Vercel) and `ALLOWED_ORIGINS`/`ALLOWED_ORIGIN_SUFFIXES`
  (Render) to match whichever domain now points where.

## Weekly ops routine (~30–60 min/week)

- **Content**: `pnpm content:fetch` to pull any newly-released UPPSC PDFs
  (papers, syllabus updates); re-run the relevant `ingest:*` scripts if new
  content lands mid-cycle rather than waiting for the next exam year.
- **Review Queue** (`/admin/review`, `is_admin` gated): ~15 min/day —
  approve/edit/reject `needs_review` questions, notes, and community reports.
  Don't let this queue back up; qgen/notes generation both write here, not
  straight to published.
- **Current-affairs source review**: spot-check the `ca-run` workflow's
  output weekly — RSS feeds go dead or change format without warning (this
  already happened once with PIB/UP-government feeds during initial
  sourcing — see CLAUDE.md Session 12). If a source stops producing items,
  find and swap in a replacement in `src/ca/sources.ts`.
- **Cost check**: `pnpm --filter api cost:report [--days 7]` — watch for
  per-evaluation / per-CA-run cost drift, and cache-hit-rate dropping
  (prompt-cache misses are the single biggest lever on Anthropic spend here).
  Update `lib/models.ts`'s `standard` pricing once Anthropic publishes real
  post-intro prices (still a placeholder — see CLAUDE.md TODO list).
- **Evaluation prompt tuning**: `pnpm --filter api eval:answers --runs 3` —
  gates on ranking (good > mediocre > off-topic) and repeatability (≤5% of
  full marks). Re-run after any prompt change in `src/services/evaluation/`.
- **Backup sanity check**: confirm the weekly `backup.yml` run actually
  succeeded (Actions tab) and that `BACKUP_PASSPHRASE` is still recoverable
  from your password manager — an untested backup is not a backup.

## Prerendering (deliberately not wired into either host's default build)

`apps/web/scripts/prerender.mjs` snapshots `/en`/`/hi`/`/en/pricing`/
`/hi/pricing` via a real headless Chromium after the build — genuinely useful
for SEO/OG tags, but it needs a Playwright Chromium binary present at build
time, which is fragile on a managed build image you don't control (missing
system libs, no root for `apt-get`, etc. — real failure modes, not
hypothetical). The codebase already keeps `prerender` as a separate step from
`build` for exactly this reason (see the script's own header comment).
Neither the Cloudflare Pages build command above nor `vercel.json`'s
`buildCommand` runs it by default, in favor of a build that reliably succeeds
every time.

Serving behavior differs by host (both verified live, see the Cloudflare
Pages section above for the `wrangler pages dev` session):

- **Vercel**: resolves `/en` → `dist/en/index.html` directly, no redirect.
- **Cloudflare Pages**: 308-redirects `/en` → `/en/` before serving
  `dist/en/index.html` — a real, disclosed difference (see the trailing-slash
  gotcha above), not a bug in either config.
- `vite preview`'s bundled dev server, for comparison, only resolves the
  clean URL with an explicit trailing slash (`/en/`), matching neither host's
  production behavior exactly — don't use it as the reference for how a real
  deploy resolves these paths.

If you want prerendering live: run `pnpm --filter web build:ci` (build +
prerender chained) in a CI job with Playwright's Chromium installed, then
publish that `dist/` — either as Cloudflare Pages' build output (its build
image does support installing browser dependencies, unlike Vercel's more
locked-down managed image, but test this yourself before trusting it in
production) or via `vercel.json`'s `buildCommand` changed to
`npx playwright install chromium && pnpm run build:ci`. Watch the build logs
closely the first few times either way before trusting it.
