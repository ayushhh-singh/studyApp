# Outstanding-Work Inventory (Neev / नींव)

**Audit date:** 2026-07-13 · **Source:** full read of `CLAUDE.md` (TODO section + every session-log entry, Session 0 → Guided tab tour) with a live cross-check of a representative sample against current code.

This is the **living outstanding-work document**. It supersedes hunting through session-log prose. See [Keeping this current](#keeping-this-current) at the bottom — new follow-ups get appended here going forward, not only buried in the log.

Severity legend (a recommendation for sequencing, not a directive):
🔴 user-facing correctness/security · 🟠 missing depth / robustness · 🟡 ops / cosmetic · ⚪ intentional / nice-to-have

---

## 0. Stale log entries — verified RESOLVED (correct these when convenient)

These are still described as open in `CLAUDE.md` but the code says otherwise. Flagged per the audit brief's cross-check step. **None need work — they need the log corrected.**

| # | Logged as open in | Verified state | Evidence |
|---|---|---|---|
| S1 | TODO §"EDGE CASES from CA two-lives re-engineering" items (1)-(4) | **RESOLVED** by the magazine rewrite | `services/magazine.ts` now selects `prelims_facts`/`mains_brief`/new 12-value `CATEGORY_ORDER` incl. `up_special`; web routes are `magazine-{index,mains,prelims,month}.tsx` rendering the two-lives `topic_sections`/`gs_sections`/`deep-dives` (the old single `magazine.tsx` is gone); `ca/compile.ts` imports `compileMainsEdition`/`compilePrelimsEdition`/`listMagazineMonths` and uses `prelims_item_count`/`mains_item_count`/`deep_dive_count` — not the removed `compileMagazine`/`item_count`, so it typechecks |
| S2 | Session 27.5: "The 36 local commits are UNPUSHED" | **RESOLVED** — `git log origin/main..HEAD` = 0 unpushed; tree clean at `origin/main` | `git status -sb` |
| S3 | Community v1: "Sessions 16/17/18 … not present in the on-disk CLAUDE.md at HEAD" | **RESOLVED** — all three sessions are now in `CLAUDE.md` | `grep -c "Session 1[678]" CLAUDE.md` |
| S4 | TODO §"Data-migration idempotency confirmed done" | Not outstanding by design — listed only so nobody re-runs `migrate:dev-user` | — |

> One survivor from the CA edge-case block is **still open** — the CA-pipeline per-item try/catch (see **B5**). Items (1)-(4) of that block are done; the "Also minor" pipeline note is not.

---

## 1. Data & content gaps  *(category a)*

| # | Item | Provenance | Severity | Notes |
|---|---|---|---|---|
| A1 | **Study-chapter rollout incomplete.** Chapters generated for PRE_GS1 (30) + MAINS_GS1/GS5/GS6 (107) = 137. Remaining: MAINS_GS2 (27), MAINS_GS3 (36), MAINS_GS4 (32), MAINS_ESSAY (19), MAINS_GH (22), PRE_CSAT (11) ≈ **147 nodes** with no chapter (digest-only or nothing). | Session 28, 28.5 | 🟠 | Mechanical re-run of the agent fan-out (free, slow, session-limit-paced) or `notes:chapter --paper <CODE> --top N` on the real API (~$1.2/chapter, reserved for prod/cron per instruction). Verify live counts against DB before trusting these numbers. |
| A2 | **Machine-translated Hindi throughout the PYQ bank** (source PDFs are legacy-font mojibake). Real-source-Hindi overlay pass (subagent visual read, chunked ≤~30 Q) deferred. Some agent-authored note Hindi is also machine-translated (flagged). | Session 3, 10, 27.5, 28 | 🟠 | Flagged `meta.machine_translated=true`; does not block publish. Quality, not correctness. |
| A3 | **Prelims 2021 GS-I answer key is genuinely misaligned** with its reconstruction (~27% agreement ≈ random) → only ~40 published, rest held in Review Queue. | Session 27.5 | 🟠 | Needs a matching-order key/paper, or accept blind-resolved answers. |
| A4 | ~~**CSAT questions mostly held despite having keys** — blind-resolve is unreliable on comprehension/reasoning items, so many disagree→held even with a valid key.~~ **RESOLVED 2026-07-13** (key-provenance gate). | Session 27.5 | ✅ | **Fixed by a key-provenance publish gate** (migration `0074`, `apps/api/src/ingest/key-provenance.ts`): a new `questions.key_provenance` enum (`official_commission`\|`coaching_reproduced`\|`none`) drives `gateMcq` **uniformly** (not CSAT-special-cased — the old `PRE_CSAT` special-case in `pyq-load.ts` is gone). An **official_commission + verified** key publishes on key-match + bilingual **alone** (blind agreement NOT required — an official key IS ground truth); **coaching_reproduced / none** keep the blind-resolve-required gate unchanged (verified via `ingest:regate` — a `blind=flagged` official key publishes, an identical `blind=flagged` coaching key stays HELD). **Safety net (ONGOING, not one-time):** blind-resolve still runs for official keys as a **non-blocking** check — a disagreement raises a system `ai_key_dispute` flag (user_id=null) into the same admin Review Queue as user reports (`raiseKeyDisputeFlag`), so a genuinely-wrong official key (the A3 2021 GS-I shape) is surfaced for a human instead of silently blocking a correct answer OR being silently swallowed. Every future official-key load/re-gate that hits a disagreement re-raises the flag. **Re-gate over the loaded bank** (`pnpm ingest:regate`, additive-only) published **7** previously-held official-commission questions (GS1 2019/2020, held only by blind disagreement) and raised **95** `ai_key_dispute` flags; **CSAT itself: no held CSAT question has a verified official key** (the only official CSAT set, 2024, was already published — held CSAT carry blind-*proposed* keys, so the official-key path correctly moves none of them; a strict re-gate would instead *un-publish* CSAT rows live on unverified/blind-disagreed keys — see A4-followups). |
| A4-followups | **CSAT bank still has questions live on non-official keys** the new gate would hold. The additive-only re-gate (per instruction) left them live: (1) CSAT 2019/2020/2021 (~78) published on **unverified blind-proposed** keys; (2) CSAT 2022/2023 (~61) on coaching keys the blind solve **disagreed** with. A strict `pnpm ingest:regate --paper PRE_CSAT --apply` (no `--publish-only`) would hold these (CSAT 378→239). Also GS1: 2021 (−50, the A3 misaligned key), 2025 (−44 coaching-disagreed) would be held by a full re-gate (GS1 910→816). | Session C (2026-07-13); regate scope fixed 2026-07-13 | 🟠 | Deliberately deferred — un-publishing ~233 live questions is destructive + outside the "trust official keys" ask. Apply per-paper when ready; or apply the pending official/coaching CSAT keymaps first so more CSAT can pass the gate legitimately. **Edge-case fix (2026-07-13):** `ingest:regate` now filters `source='pyq'` (it previously swept `generated`/`manual` MCQs living under PRE_GS1/PRE_CSAT into the PYQ answer-key gate, so a strict `--apply` would have wrongly demoted **17 human-approved generated questions** — the old "null-year (−17)" figure was those non-PYQ rows, not PYQs). PYQ re-gate behaviour unchanged. |
| A5 | **Prelims 2023/2025 papers loaded as drafts** (no official answer key available at ingest → can't verify `correct_option_key` → publish gate correctly withholds). | Session 10 | 🟡 | Partly superseded by the 27.5 bulk 2018-2025 ingest; re-verify which years/papers are still draft-only. |
| A6 | **Notes fact-audit flagged figures to revisit** (e.g. Kanya Sumangala grant amount, UP Semiconductor Policy specifics) stored in `meta.critic`. | Session 14 | 🟡 | Largely superseded by Session 28's per-fact web-search fact-audit + resolve-then-publish gate; confirm the old Session-14 notes were re-audited or are chapter-upgraded. |
| A7 | **`tests` / `current_affairs` tables have no DB-level publish gate** (unlike `questions`/`notes`). | Session 2 | 🟡 | Enforced at the API/pipeline layer; accepted-for-now since Session 2. |
| A8 | **8 `drill_sessions` rows (2 complete, 6 pending)** left in the dev DB from Session 18 agent verification; cleanup delete was blocked by the permission classifier. | Session 18 | ⚪ | Dev-data hygiene only; no product impact. |

---

## 2. Known bugs / limitations with a workaround in place  *(category b)*

| # | Item | Provenance | Severity | Verified |
|---|---|---|---|---|
| B1 | **Founder account still on weak dev password** (`123456789`, / OAuth-founder `asingh9@ee.iitr.ac.in`). In-app change-password UI now exists → pure action item: sign in, Profile → Settings → Change password before any real deploy. | TODO, Auth-gap closure | 🔴 | Needs the real session; can't be done non-interactively. |
| B2 | **Orphaned `users_profile` rows leak on throwaway-user cleanup.** `rls-security-check.ts` (and past RLS-check runs) call `admin.auth.admin.deleteUser()`, which does **not** cascade to `users_profile` — there is deliberately **no FK `users_profile.id → auth.users(id) on delete cascade`** (0052 says so explicitly). Every RLS-check run since ~Session 15 has likely orphaned a profile row (+ transitively cascaded children). | Community v1 | 🟠 | ✅ Confirmed open: `0052_auth.sql` line "NOT added here: a hard FK". Fix = a migration adding the FK; flagged, not patched. |
| B3 | **Sign-up enforces only an 8-char password floor** (Supabase default) while every other password path (reset, change, `set-password` CLI) enforces 10-char + `checkPasswordStrength` denylist. A user can sign up with a password later rejected as "too weak". | Auth-gap follow-up | 🟠 | ✅ Confirmed open: `auth.tsx` sign-up gate is `disabled={busy || !email || !password}` (non-empty only); `checkPasswordStrength` is imported only in `change-password-card.tsx`. |
| B4 | **`billingPublicRouter` rate-limiter falls back to per-IP keying** (no auth on the public `/billing/plans` marketing page) with no response caching → real visitors behind a shared NAT/CGNAT can 429 each other. | Auth-gap follow-up | 🟡 | ✅ Confirmed: `billingPublicRouter.use(rateLimit({windowMs:60_000, max:60}))` mounted pre-`requireAuth`. Tradeoff: raise limit vs. add caching. |
| B5 | **CA pipeline per-item triage/enrich LLM calls aren't individually try/catch'd** → a single LLM failure aborts the whole `ca:run`. Not data-loss (already-inserted items persist; `content_hash` dedup lets a re-run resume). | TODO §CA edge-cases | 🟡 | ✅ Confirmed still open: `ca/pipeline.ts` per-item loop (≈L305-419) has bare `await triageItem`/`await enrichItem` with no enclosing per-item catch. A log-and-skip would be more robust. |
| B6 | **Peer-review shared answers don't render handwritten page images.** The `answer-images` bucket's Storage RLS is per-uploader-folder-only, so a reviewer literally can't `createSignedUrl` another user's image. | Community v1 | 🟡 | Deliberate v1 limitation; fixing needs a new Storage policy carve-out. |
| B7 | **CSR-snapshot prerendering, not true SSR/hydration.** `main.tsx` uses `createRoot().render()`, not `hydrateRoot` — prerendered HTML is a crawler/first-paint snapshot fully replaced on mount. Safe (no hydration-mismatch), but synthetic Lighthouse LCP/TTI can read worse (real paint + full remount). | TODO, Production Polish | 🟡 | See C3 for the real-SSR follow-up. |

---

## 3. Deferred features  *(category c)*

| # | Item | Provenance | Severity |
|---|---|---|---|
| C1 | **Leaderboard is built but hidden** — `GET /leaderboard` + `/:locale/leaderboard` route exist, deliberately absent from nav/palette. Reachable only by URL. | Session 15 | ⚪ (intentional) — ✅ confirmed: `router.tsx` "Built but hidden" comment + route present, absent from `nav.ts`. |
| C2 | **Per-question (single-PYQ) discussion + "question review" surface** scoped out of Community v1. The `anchor_type='question'` schema already supports it — a follow-up with no backend change. | Community v1 | ⚪ |
| C3 | **True SSR/hydration** for the landing page (would fix B7's synthetic-metric tradeoff) — needs careful handling of the auth-dependent signed-in/out render. Flagged, not attempted. | TODO, Production Polish | ⚪ |
| C4 | **Richer mentor teacher-mode / depth-toggle** was deferred to the study-chapters work (S28) so it could ground on embedded chapter sections. S28 chapters now exist and mentor cites them — confirm whether the full teacher-mode/depth spec still has gaps. | Session 26.5, 28 | 🟡 |

---

## 4. Deferred infra / ops decisions  *(category d)*

| # | Item | Provenance | Severity |
|---|---|---|---|
| D1 | **Enable Google OAuth** (Google Cloud OAuth client + Supabase provider config + redirect allowlist). Code (`signInWithOAuth`) is correct; `external.google=false` today. | TODO | 🟠 |
| D2 | **Custom SMTP for auth emails** (Resend/SendGrid) — Supabase built-in sender is hard-throttled ("email rate limit exceeded"). Until then prefer email+password login. | TODO | 🟠 |
| D3 | **Rate-limit shared store for multi-instance deploy.** `lib/rate-limit.ts` is an in-process Map keyed by user id — a multi-instance/autoscaled deploy MUST swap it for Redis/Postgres keyed the same way. | TODO, Auth phase | 🟠 |
| D4 | **`standard` model pricing is a placeholder.** `lib/models.ts` `MODEL_PRICING[*].standard` is a guess (intro pricing is real); update once Anthropic publishes post-intro `claude-sonnet-5`/`claude-haiku-4-5` prices. | TODO, Session 9, 13 | 🟡 |
| D5 | **VAPID keys are dev-only; Sentry DSN unset.** Prod should `npx web-push generate-vapid-keys` (don't reuse dev pair); wire a real `SENTRY_DSN`/`VITE_SENTRY_DSN` before relying on error tracking (currently a documented no-op). | TODO | 🟡 |
| D6 | **Prerender build is opt-in / not wired into the default Vercel build.** Needs a Playwright Chromium binary at build time (fragile on a managed build image — no guaranteed apt/root). `docs/operations.md` documents opting in; `vercel.json` `buildCommand` deliberately doesn't run it. | TODO, Deploy-Prep, Production Polish | 🟡 |
| D7 | **Deploy is configured but NOT executed.** All repo-side config (Dockerfile, render.yaml, vercel.json, CI) is written/verified, but no Vercel/Render account, domain, or prod secret exists yet; `docs/launch-checklist.md` (the 10-step real-device smoke test) has **not** been run. **Don't tag `v1.0.0`** until it passes against real prod URLs. | TODO, Deploy-Prep, Production Polish | 🔴 (blocks launch) |
| D8 | **Render Blueprint `envVarGroups` service-level linking is ambiguous** even in Render's current docs — check the dashboard's proposed-changes preview before approving the Blueprint. | Deploy-Prep follow-up | 🟡 |
| D9 | **GitHub repo still named `studyApp`** — rename can break CI/CD/remote hookups, so do it as its own deliberate step. | Branding | 🟡 |
| D10 | **Demo DB account still `demo@prayasup.app`** (old domain, that's data not code). Seed default is now `demo@neev.app`; re-run `pnpm demo:seed` to mint the new-domain account. | Branding | 🟡 |

---

## 5. Deferred verification  *(sub-type of b/d — worth tracking separately)*

| # | Item | Provenance | Severity |
|---|---|---|---|
| V1 | **Mentor effort low-vs-medium quality A/B not run live.** Session 26.5 defaulted normal doubts to `effort:"low"` (analytical → `medium`) but never ran the 5 side-by-side real-answer comparison (each is a billed Sonnet call). TTFT/total p50/p95 now measured, so a regression would show in the metrics — but the quality A/B is a genuine open follow-up. | Session 26.5 | 🟡 |
| V2 | **`docs/launch-checklist.md` never run** against real prod (part of D7). | Deploy-Prep | 🔴 (blocks launch) |

---

## 6. Documentation-only  *(category e)*

| # | Item | Severity |
|---|---|---|
| E1 | Correct the four **stale log entries in §0** (S1-S3) in `CLAUDE.md` — the magazine CA-two-lives follow-ups, the "36 unpushed commits", and the "Sessions 16/17/18 missing" note are all resolved. | 🟡 |

---

## Suggested sequencing (recommendation only — human decides)

1. **Before any real launch (🔴):** D7 + V2 (run the launch checklist), B1 (rotate founder password). These gate `v1.0.0`.
2. **Correctness/robustness next (🟠):** B2 (orphaned-profile FK), B3 (sign-up password floor parity), D1/D2 (OAuth + SMTP so real users can actually authenticate), D3 (rate-limit store if going multi-instance).
3. **Content depth (🟠, ongoing):** A1 (finish chapter rollout), A3 (2021 GS-I key), A4-followups (strict CSAT re-gate / apply pending keymaps — A4 itself is ✅ resolved via the key-provenance gate), A2 (Hindi overlay — large, low-urgency).
4. **Ops/cosmetic (🟡):** D4/D5/D6/D8/D9/D10, B4/B5, A5-A8.
5. **Nice-to-have (⚪):** C1-C3.

---

## Keeping this current

**Proposed workflow change (for my own future sessions):** at the end of every session, in addition to the `CLAUDE.md` session-log entry, **append any new follow-up / disclosed limitation / found-but-unfixed bug directly to this file** (right category table, with provenance + a severity guess), and **strike through / move to §0** any item this session actually closed. That keeps `OUTSTANDING.md` a live, deduplicated ledger so this full-history audit never has to be repeated — the session log stays the narrative record, this file stays the actionable index.
