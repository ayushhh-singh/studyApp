# Sukoon launch checklist — Session 14 (beta hardening & launch)

Pre-merge / pre-launch checklist for taking `feature/sukoon` to `main` and
turning the beta on for a real Neev cohort. See `sukoon-build-blueprint.md`
§7 Session 14 and §8 (Beta Benchmarks) for the product decision this feeds.

This doc assumes the ₹0 deploy target already documented in
`docs/operations.md` ("Free-tier (₹0) deploy — current target": Cloudflare
Pages for web, a free Render web service for the API, GitHub Actions for
cron) — Sukoon reuses that same API/DB, and adds a **second** Cloudflare
Pages project for its standalone build. If you've since moved the integrated
web app to Vercel (`docs/operations.md`'s "Upgrading to paid" path,
`apps/web/vercel.json`), the env vars below are the same; only the dashboard
you paste them into differs.

---

## 1. Functional gates (verify before merging)

- [ ] `pnpm --filter api typecheck`, `pnpm --filter api build`,
      `pnpm exec tsc -b` (apps/web), `pnpm --filter web build`,
      `pnpm --filter web lint` — all clean. (Verified this session — see
      the session log entry for exact output.)
- [ ] `pnpm check:clinical-words` — clean (no "therapy/therapist/clinical/
      diagnosis/treatment/patient/medication/cure" drift in UI copy, prompts,
      or i18n). Wired into CI already; re-run after any copy change.
- [ ] `pnpm check:paths` — clean (no hardcoded machine paths or stale
      domains).
- [ ] `VITE_APP=sukoon pnpm --filter web build` (the standalone build) —
      still produces a working bundle. Re-verify this specifically whenever
      touching `router.tsx`, `vite.config.ts`, or anything under
      `apps/web/src/sukoon/root.tsx`/`shell.tsx` — it's the one path that's
      easy to silently break while only testing the integrated build.
- [ ] `pnpm --filter api test:crisis` (runs `scripts/test-crisis.ts` over
      `services/crisis/red-team-cases.ts`) still passes — confirmed already
      wired into `.github/workflows/ci.yml`, so this should be a CI-green
      check, not a manual one, but re-verify locally before merging. The
      safety spine (F3) is the one thing in this whole module that must
      never regress.
- [ ] A real signed-in pass through: onboarding (all 6 steps, including a
      Back/Next/Skip round-trip — the new step-transition animation and the
      `onboarding_step_viewed` analytics ping both live here), one Saathi
      exchange with the new thumbs feedback widget, one journey started and
      completed (feedback widget again), the general feedback page, and the
      beta banner's dismiss-persists behavior. Both locales, 390px + 1440px,
      light + dark.
- [ ] Admin: `/sukoon/admin/feedback` renders the list for an `is_admin`
      account and shows the denied `EmptyState` (not a false "network error"
      state — that's the isError branch, tested separately) for a non-admin.

## 2. Database — migration order

Sukoon's migrations are `0078`–`0093` (flat sequence, applied the standard
way via `supabase db push` — see the `[[supabase-headless-migrations]]`
memory for the exact `db push --db-url` invocation and the pooler fallback if
IPv6 egress isn't available). They must apply **in numeric order** (each
later file assumes the shape the earlier ones left):

```
0078_sukoon_core.sql                       schema: profiles/journal/mood/... + content tables
0079_sukoon_rls.sql                        RLS + grants for every table 0078 created
0080_sukoon_semantic_cache_match.sql       chat FAQ-cache RPC
0081_sukoon_journal_f4.sql                 journal encryption (pgcrypto) + RPCs
0082_sukoon_seed_journal_prompts.sql       seed content
0083_sukoon_journal_rpc_lockdown.sql       RPC security hardening
0084_sukoon_exercises_seed.sql             seed content
0085_sukoon_journeys_content.sql           journeys/journey_steps schema
0086_sukoon_journeys_seed.sql              seed content
0087_sukoon_checkins_insights_f8_f9.sql    WHO-5/stress check-ins + weekly insights
0088_sukoon_billing_f13.sql                subscriptions/plans/billing_events
0089_sukoon_voice_channel.sql              voice usage + message channel column
0090_sukoon_reminders_garden.sql           reminders + garden state
0091_sukoon_privacy_f12.sql                account lifecycle + export jobs + privacy audit
0092_sukoon_subscriptions_write_lockdown.sql  SECURITY FIX — re-assert 0088's intended lockdown
0093_sukoon_analytics_feedback_beta.sql    NEW THIS SESSION — analytics/feedback/beta_cohort
```

- [ ] Confirm `0092` actually landed on the target DB before merging — its
      own header explains it exists because a *previous* apply of `0088`
      raced ahead of the lockdown SQL being added to that file. If you're
      pushing to a **fresh** project (never seen 0088-0092 before), this one
      is a no-op reassertion; if you're pushing to the **existing shared Neev
      DB** this branch has been developed against, it should already be
      applied — verify with `select policyname from pg_policies where
      tablename = 'sukoon_subscriptions'` (should show only `owner_select`,
      no `owner_insert`/`owner_update`/`owner_delete`).
- [ ] After `0093`, spot-check: `select count(*) from sukoon_analytics_events;`
      returns `0` (fresh table) and `select * from sukoon_beta_cohort limit 1;`
      does not error (table exists, empty).
- [ ] `JOURNAL_ENC_KEY` must be set (in whichever env actually runs journal/
      reflection code — apps/api's `.env`, Render's dashboard, and the
      `sukoon-weekly-insights` GitHub secret) **before** any real user writes
      a journal entry. It's read lazily (won't crash boot if unset), but a
      journal write attempted without it 500s — verify with one real
      `POST /api/sukoon/journal/entries` against the target environment.

## 3. Env vars needed in prod

### Cloudflare Pages #1 — integrated Neev + Sukoon (`apps/web`, default build)

Same as `docs/operations.md`'s existing "Cloudflare Pages (web)" section —
Sukoon adds nothing new here, since it's the same bundle, same origin:

| Var | Notes |
|---|---|
| `VITE_SUPABASE_URL` | same Supabase project as the API |
| `VITE_SUPABASE_ANON_KEY` | browser-safe |
| `VITE_API_URL` | `https://<render-service>.onrender.com` |
| `VITE_VAPID_PUBLIC_KEY` | must match the API's `VAPID_PUBLIC_KEY` |
| `VITE_SENTRY_DSN` | optional, no-op if unset |
| `VITE_APP` | **unset** (or anything other than `sukoon`) |
| `PNPM_VERSION=9.0.0` | pin — Cloudflare's default may drift from `packageManager` |

Build command `pnpm --filter web build`, output `apps/web/dist`, root
directory the repo root (pnpm workspace).

### Cloudflare Pages #2 — standalone Sukoon (`VITE_APP=sukoon`)

**New for this launch.** Same repo, second Pages project, build command
`pnpm --filter web build:sukoon` (confirmed present in `apps/web/package.json`
— runs `tsc -b && VITE_APP=sukoon vite build`, equivalent to setting
`VITE_APP=sukoon` in the shell before the plain build command). Same output
directory/root as above.

| Var | Notes |
|---|---|
| `VITE_APP=sukoon` | **the one required difference** — everything else is identical to Pages #1 |
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | same project (Sukoon shares Neev's Supabase project + auth) |
| `VITE_API_URL` | same Render API — Sukoon's routes live at `/api/sukoon/*` on the SAME deployed API, no separate backend |
| `VITE_VAPID_PUBLIC_KEY` | same as above |
| `VITE_SENTRY_DSN` | optional |

- [ ] After deploy, confirm the standalone domain's manifest/icon/theme-color
      are Sukoon's own (`public/sukoon-mark.svg`, `pwa/sukoon-icon-*.png`,
      `#2E2A5E`), not Neev's — `root.tsx`'s `IS_STANDALONE` effect sets these
      client-side; a stale CDN cache on `index.html`'s static tags can still
      show Neev's briefly before JS runs. Re-check the PWA install prompt
      shows "Sukoon" as the app name, not "Neev".
- [ ] Add this second domain to `ALLOWED_ORIGINS` (or `ALLOWED_ORIGIN_SUFFIXES`
      for `*.pages.dev` previews, scoped to your own project name — see the <!-- portable-paths-allow: explanatory placeholder, advises AGAINST hardcoding a bare pages.dev -->  
      Render section below) — otherwise every `/api/sukoon/*` request from
      the standalone domain 403s on CORS.

### Render (API) — same service as Neev, no separate Sukoon deploy

Sukoon's routes are mounted into the SAME Express app (`/api/sukoon/*`,
`apps/api/src/index.ts`) — there is no separate API to deploy. Add these on
top of the existing Neev env vars already documented in
`docs/operations.md`'s Render section / `render.yaml`'s `neev-secrets` group:

| Var | Notes |
|---|---|
| `SUKOON_MODE` | `integrated` (default) — `standalone` only if you ever run a fully separate Sukoon-only API deploy, which this launch doesn't do |
| `SUKOON_ENABLED` | `true` — the global kill switch. Leave `true` for launch; set `false` only to pull the whole module from prod without a redeploy |
| `SUKOON_BETA_COHORT` | `true` (default if unset) for a gated beta launch — see §5 below. Set `false` later to open Sukoon to every Neev user with **no code change** |
| `JOURNAL_ENC_KEY` | **required before any real journal write** — see §2 |
| `SUKOON_TTS_PROVIDER` | `openai` (default, uses the existing `OPENAI_API_KEY`) or `sarvam` (needs `SARVAM_API_KEY` too) |
| `SARVAM_API_KEY` | only if `SUKOON_TTS_PROVIDER=sarvam` |
| `ALLOWED_ORIGINS` | must include **both** Cloudflare Pages domains now (integrated + standalone) |
| `ALLOWED_ORIGIN_SUFFIXES` | if you want per-branch preview deploys of EITHER Pages project to work, scope to your own project names (see the existing warning in `docs/operations.md` about not using a bare `.pages.dev`) | <!-- portable-paths-allow: explanatory placeholder, advises AGAINST hardcoding a bare pages.dev -->

Everything else (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `RAZORPAY_KEY_ID`/`_SECRET`/
`_WEBHOOK_SECRET`, `VAPID_*`) is already required by Neev and is shared —
Sukoon does not need its own copies of any of these.

### GitHub Actions secrets/variables

Sukoon has three of its own scheduled workflows
(`.github/workflows/sukoon-{notifications,purge,weekly-insights}.yml`),
alongside Neev's existing ones. `docs/operations.md`'s secrets table
predates these — add, on top of what's already there:

| Secret/Variable | Used by | Notes |
|---|---|---|
| `JOURNAL_ENC_KEY` (secret) | `sukoon-weekly-insights` | same value as the API's |
| `SUKOON_MODE` (**repo VARIABLE**, not secret) | `sukoon-purge` | `vars.SUKOON_MODE` — controls integrated-vs-standalone erasure scope |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` (secrets) | `sukoon-notifications`, `sukoon-weekly-insights` | already exist for Neev's own `notifications.yml` — reused, not new |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` (secrets) | all three Sukoon workflows | already exist |
| `ANTHROPIC_API_KEY` (secret) | `sukoon-weekly-insights` | already exists |

- [ ] Confirm the `SUKOON_MODE` **repository variable** (Settings → Secrets
      and variables → Actions → **Variables** tab, not Secrets) is actually
      set — it's easy to only fill in the Secrets tab and miss this, and an
      unset `vars.SUKOON_MODE` will make `sukoon-purge.yml` fall through to
      whatever the script's own default is (check
      `apps/api/src/sukoon/config.ts` — defaults to `integrated`, which is
      almost certainly what you want, but verify rather than assume).
- [ ] These three workflows run `tsx` scripts directly against Supabase — they
      do **not** hit the deployed Render API, so (like Neev's own cron
      workflows) they don't help keep a free-tier Render service warm.

## 4. Razorpay — live-mode steps

Sukoon and Neev share ONE Razorpay account and ONE key pair
(`RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET`/`RAZORPAY_WEBHOOK_SECRET` — a single
env var triple, reused by `apps/api/src/lib/razorpay.ts` for both). What's
different is the **webhook URL**: Sukoon has its own endpoint,
`/api/sukoon/billing/webhook`, separate from Neev's `/api/v1/billing/webhook`
— the same Razorpay account delivers every event to BOTH URLs, and each
router ignores events not tagged `notes.product=sukoon` (or `neev`,
respectively).

- [ ] Switch `RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET` from test (`rzp_test_…`)
      to live keys, in Render's env vars.
- [ ] Razorpay Dashboard → Webhooks → confirm/add a **second** webhook
      endpoint: `https://<api-host>/api/sukoon/billing/webhook` (Neev's own
      `/api/v1/billing/webhook` endpoint should already exist from Neev's own
      launch).
- [ ] **Use the exact same webhook secret string for both endpoints** — the
      code verifies every incoming webhook (either URL) against the single
      `RAZORPAY_WEBHOOK_SECRET` env var, so registering the two URLs with
      different secrets in the Razorpay dashboard will make one of them fail
      signature verification on every event.
- [ ] Trigger one real test transaction against each endpoint (Razorpay's
      dashboard has a "send test webhook" tool) and confirm both `sukoon_
      billing_events` and Neev's own billing-events table each log exactly
      the event meant for them, not the other's.
- [ ] Sukoon's pricing page (`/sukoon/pricing`) and the paywall's live-plan
      fetch (`GET /api/sukoon/billing/plans`) should reflect live-mode plan
      codes — confirm `sukoon_plans` has real rows (not just the dev-seeded
      test ones) before opening checkout to real users.

## 5. Beta cohort rollout (SUKOON_BETA_COHORT)

New this session. With `SUKOON_BETA_COHORT` unset or `true` on the API:

- The Neev homepage's "Wellness Companion" card and the authenticated app's
  "Wellness" nav item are **hidden** for everyone except users in
  `sukoon_beta_cohort` (or a Neev admin, always included for testing).
- `GET /api/sukoon/beta/status` is what the frontend reads to decide this —
  see `apps/web/src/sukoon/lib/use-sukoon-beta.ts`.
- Sukoon itself is **not** API-blocked for someone who already knows the
  `/sukoon` URL — this is a UI-visibility gate for the two documented access
  points, not an entitlement check. (If a harder block turns out to be
  needed, that's a follow-up, not something this session built.)

To actually populate the ~300-user cohort:

```
# One at a time:
pnpm --filter api sukoon:beta:cohort --add --email person@example.com --note "batch 1"

# Bulk (one email per line, the realistic path for ~300 users):
pnpm --filter api sukoon:beta:cohort --add --emails-file cohort-emails.txt

# Check who's in:
pnpm --filter api sukoon:beta:cohort --list

# Remove someone:
pnpm --filter api sukoon:beta:cohort --remove --email person@example.com
```

- [ ] Run the bulk `--add` against the real cohort list before announcing
      the beta — the script resolves each email against real
      `auth.users` rows and loudly lists any that don't match a Neev
      account (skipped, not silently dropped).
- [ ] Confirm at least one cohort member and one non-cohort member each see
      the correct nav/card visibility, both signed in.
- [ ] When ready to graduate past the beta: set `SUKOON_BETA_COHORT=false`
      on Render. No redeploy of the frontend is needed — the gate is read
      live from the API on every page load.

## 6. Post-launch monitoring

- `pnpm --filter api sukoon:analytics:report [--days N]` — activation
  funnel (onboarding step 1→6→completed), DAU, feature-usage touch-rates,
  cap-hit counts, paywall views/CTA-clicks/conversions, and **aggregate-only**
  crisis-event counts by level. Reads only `sukoon_analytics_events`
  (name/props/user_id/created_at) — never journal/chat/voice content, by
  construction (see `services/analytics.ts`'s prop-sanitization).
- `/sukoon/admin/feedback` (or `pnpm --filter api` — no CLI for this one,
  it's a small enough volume to read in the admin UI) — every thumbs/note
  from the feedback widget.
- The existing `GET /api/sukoon/admin/cost` dashboard (Session 13) for
  per-model spend — unchanged by this session, still the place to watch
  cost as the cohort's real usage ramps up.
- Blueprint §8's decision gates to actually watch over the beta window:
  **D30 retention ≥ 10%**, **paid conversion ≥ 2%**, **zero unhandled safety
  incidents** → continue standalone push. Good engagement but conversion
  < 2% → fold into Neev as a retention feature. Any serious safety near-miss
  → pause open chat, keep the tools/journeys, harden before re-opening chat.

## 7. Standalone deploy runbook (quick reference)

1. Create the second Cloudflare Pages project (§3 above), pointed at the
   same repo/branch as the integrated one.
2. Build command `pnpm --filter web build:sukoon` (equivalent to
   `VITE_APP=sukoon pnpm --filter web build`, one less place to typo the
   env var).
3. Set the env vars in §3's "Cloudflare Pages #2" table.
4. Add the new domain to Render's `ALLOWED_ORIGINS`.
5. Verify: the standalone domain mounts Sukoon at `/` with zero Neev routes
   reachable, its own manifest/icons/theme-color, and the PWA install prompt
   (after `MIN_VISITS_BEFORE_PROMPT = 3` visits, `sukoon-install-prompt.tsx`)
   offers "Sukoon", not "Neev".
6. Onboarding is reachable pre-login on this domain too (by design — see
   `root.tsx`'s comment on why the onboarding gate is permissive about
   no-session) — confirm a fresh anonymous visit still lands on a sensible
   sign-in prompt rather than an error.
7. This same domain is what the "Take the Sukoon beta" cohort should be
   pointed at if you want a wellness-only experience for them, as an
   alternative to the integrated `/sukoon` path inside the main Neev app —
   both work against the same account/data, so this is a presentation
   choice, not a data-migration one.

## 8. Known gaps / deliberately not done this session

- No hard API-level block on `/sukoon/*` for a non-cohort user who already
  has the URL — see §5. Flagged, not built; the blueprint's own framing of
  this as a UI-discoverability gate (not an entitlement gate) is why.
- `components/garden/sukoon-garden-card.tsx` and
  `components/insights/insights-feed.tsx` degrade to rendering nothing (not
  a visible error) if their query fails — a minor, disclosed gap versus the
  full-page blank-screen bugs this session found and fixed elsewhere (pricing,
  admin-journeys, saathi-voice, saathi, journal, mood). Both are secondary
  cards on pages that otherwise render fine, so this was judged lower
  priority than the page-blocking failures.
