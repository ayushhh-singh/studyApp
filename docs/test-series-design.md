# Scheduled Test Series — design

**Status:** DESIGN ONLY. No code was written in the session that produced this
document, and none should be written from it until the §11 open questions are
answered. Every number below was measured against the live cloud DB on
**2026-08-08** and is dated; every claim taken from the web is sourced.

**Goal:** a scheduled test-series product matching real coaching-institute
delivery — a published calendar of sectional and full-length papers, each going
live at a specific date and time, with notifications, an All-India-style rank,
and both Prelims (MCQ) and Mains (descriptive) coverage.

---

## 1. Executive summary — the four findings that should shape the build

1. **"Goes live at 14:00 IST" needs almost no scheduling infrastructure.**
   Opening a test is a *read-time predicate* (`now() >= opens_at`), not a job
   that fires. Exactly one thing in the whole feature is genuinely time-critical
   — delivering the "your test is live" push — and the existing hourly
   `notifications.yml` drain already covers it **if test opens are constrained
   to the top of an hour**. See §7. Do not build a job scheduler for this.

2. **Prelims is feasible today and costs ~₹0 per student to serve. Mains is
   neither.** A Prelims MCQ paper is pure DB assembly — no LLM call. A UPPSC
   Mains full-length paper is 20 descriptive questions × a **measured $0.0584
   per AI evaluation** = **$1.17 per paper per student**, and a 22-paper Mains
   series is **~$25.7 per student** against a **₹2,499 (~$28) annual plan**.
   That is not a rounding error to absorb; it is a pricing decision (§9.3, Q4).

3. **The question bank cannot supply a 25-test Prelims series without
   repetition, and the existing mock bank has already consumed its
   non-overlapping capacity.** UPPSC `PRE_GS1` has 1,021 visible MCQs = exactly
   **6** non-overlapping 150-question papers, and 6 is precisely the
   `MOCK_MAX_SETS` ceiling that the 58 already-built mocks sit at. A 25-test
   series needs roughly 2,000–2,500 GS-I questions. **qgen is the only path to
   that volume, and qgen is not currently a solved dependency** (§3, §6.4).

4. **Adding a `test_kind` value for series tests would silently break ranking.**
   `v_test_leaderboard` filters `t.kind in ('mock','sectional')`. A new
   `'series'` enum value — the obvious move — would drop every series test out
   of the leaderboard with no error. Reuse `mock`/`sectional` and distinguish
   via a join. See §5.3.

---

## 2. Research — how real institutes actually deliver a test series

Sources are listed at the end of this section. What matters is that the market
runs **two different delivery models**, and conflating them is the main design
trap.

### 2.1 Model A — the subscription series (flexible)

This is what a paying student buys for ₹2,000–₹3,000 and it is the dominant
UPPSC-market shape. Target PCS Lucknow's UPPCS Prelims Test Series 2026 is
representative: **25 mock papers = 10 sectional GS + 11 full-length (10 GS-I + 1
CSAT) + 4 current-affairs papers**, each 150 questions, at ₹2,100. Its Mains
counterpart is **22 papers, 20 questions each**, sectionals first and
full-lengths after. Both are advertised with the phrase **"Schedule is Flexible:
Attempt as per your preparation."**

Vision IAS's GS Prelims Test Series 2026 offers **25 tests** with 15/20/30/35-test
variants and "monthly scheduled releases", and Physics Wallah's series lets a
student "postpone the test till the test validity date". Vajiram & Ravi
explicitly ships **both** modes — flexible tests attemptable any time, and
tests attemptable only within a week of the scheduled date.

**Reading:** the published calendar is the *product*; the hard lock is not.
A paying subscriber is essentially never locked out permanently. The
near-universal pattern is a **validity window**, not a gate.

### 2.2 Model B — the All-India open mock (fixed live event)

GS SCORE's All India Prelims Open Mock runs on **fixed dates** — 12 GS mocks
between 2025-07-27 and 2026-02-08, 11–21 days apart — with online and offline
centre modes and the instruction "attempt the test on the given date". The
product here is the **rank against thousands of simultaneous test-takers**, and
these are typically free or near-free acquisition events. Neither GS SCORE's nor
Vision IAS's public pages state a late-attempt policy, so the specific "is a
late attempt ranked?" rule could not be confirmed from public sources and is
recorded here as unverified.

### 2.3 What this means for the design

The rank is only meaningful over a cohort that sat the paper under the same
conditions in the same window. But locking a paying subscriber out of a paper
they bought is commercially hostile and no major institute does it.

**Therefore the missed-window policy should not be a binary.** The design below
treats "attemptable" and "ranked" as two independent predicates:

| | before `opens_at` | in window | after `closes_at` |
|---|---|---|---|
| Startable | ✗ locked | ✓ | ✓ (practice mode) |
| Counts toward the ranked board | — | ✓ | ✗ |
| Shows own score/analysis | — | ✓ | ✓ |
| Shows "where you would have ranked" | — | ✓ | ✓ (informational, unranked) |

This gives Model B's competitive integrity and Model A's commercial behaviour
from one mechanism, and it is the recommendation. It is still a product
decision — see Q1.

**Sources:**
[Target PCS — UPPCS Prelims Test Series 2026](https://targetpcslucknow.com/uppcs-prelims-test-series/) ·
[Target PCS — UPPSC Mains Test Series 2026](https://targetpcslucknow.com/uppsc-uppcs-mains-test-series/) ·
[Vision IAS — GS Prelims Test Series](https://www.visionias.in/gsprelimstestseries-sandhan/) ·
[Vajiram & Ravi — Prelims Test Series](https://vajiramandravi.com/all-courses/upsc-prelims-test-series/) ·
[PW — UPSC Test Series](https://www.pw.live/upsc/test-series) ·
[GS SCORE — All India Prelims Open Mock](https://iasscore.in/all-india-prelims-open-mock-test)

---

## 3. Measured baseline — what the platform actually has today

All figures measured **2026-08-08** against the production Supabase project,
read-only.

### 3.1 Visible question bank (`is_published AND review_state='approved'`)

| paper_code | type | PYQ | generated | total | non-overlapping full papers |
|---|---|---:|---:|---:|---:|
| `PRE_GS1` | mcq | 1004 | 17 | **1021** | 6 × 150Q |
| `PRE_CSAT` | mcq | 599 | 291 | **890** | 8 × 100Q |
| `UPSC_PRE_GS1` | mcq | 1089 | 0 | **1089** | 10 × 100Q |
| `UPSC_PRE_CSAT` | mcq | 860 | 0 | **860** | 10 × 80Q |
| `CURRENT_AFFAIRS` | mcq | 0 | 1140 | **1140** | — |
| `MAINS_GS1…GS6` | descriptive | 760 | 162 | **922** | 4–9 × 20Q per paper |
| `MAINS_ESSAY` / `MAINS_GH` | descriptive | 122 | 154 | **276** | — |
| `UPSC_MAINS_GS1…GS4` | descriptive | 731 | 0 | **731** | 6–10 × 20Q per paper |
| `UPSC_MAINS_ESSAY` | descriptive | 80 | 0 | **80** | — |

Backlog **not** visible (`review_state='needs_review'`), **1,027 questions
total**: CA mcq 551, `PRE_CSAT` 200, `PRE_GS1` 166, `UPSC_PRE_CSAT` 51, CA
descriptive 28, `UPSC_MAINS_ESSAY` 21, `UPSC_MAINS_GS4` 7, `UPSC_PRE_GS1` 3.
**Every one of these is blocked on human review, not on generation.**

### 3.2 Existing tests

`uppsc`: 76 `pyq_full`, 68 `sectional`, 58 `mock`, 48 `daily_quiz`, 55 `custom`,
7 `time_attack`, 6 `on_demand`. `upsc`: **2 `daily_quiz` and nothing else** —
0 mocks, confirming `docs/OUTSTANDING.md` U8u.

The 58 UPPSC mocks are **6 per paper for 9 papers plus 4 for `MAINS_GS6`** —
i.e. sitting exactly on `MOCK_MAX_SETS = 6`, which is itself
`min(6, floor(available / count))`. **For `PRE_GS1` the binding constraint is
already supply, not the constant.**

### 3.3 Scale and cost

165 profiles · 125 attempts (76 submitted) · 8 answer sessions · 48 answer
submissions · 33 evaluations · **1 push subscription** · 3,020 notification rows.

**Cost per AI evaluation = $0.0584**, measured over all 138 `answer_eval_analysis`
calls ever recorded (`answer_eval_analysis` $0.0264 + `improvements` $0.0178 +
`model` $0.0107 + `strengths` $0.0062). Mentor doubt = $0.0209 over 44 calls.

⚑ Two caveats on that figure, both material:
- `lib/models.ts` currently encodes sonnet-5 at $3/$15 as "intro" while the real
  intro price through 2026-08-31 is $2/$10 (`docs/OUTSTANDING.md` D4 and the
  2026-07-23 CLAUDE.md note). So **recorded cost runs ~1.5× high today and
  becomes accurate from 2026-09-01**, when standard pricing takes effect. Plan
  against $0.0584, not against a discounted present.
- The `answer_eval_model` component (**$0.0107**) is **cached per
  `(question_id, locale, rubric_version)`** in `question_model_answers`. In a
  *scheduled series everyone sits the same paper*, so it is paid once for the
  whole cohort. Marginal cost for student N>1 on a given question is therefore
  **~$0.0477**. This is a genuine argument for a fixed series over ad-hoc
  practice, and it is the only place in this design where the scheduled shape
  makes something cheaper rather than harder.

---

## 4. The five decisions that drive everything else

| # | Decision | Rationale |
|---|---|---|
| D-1 | **A series is a scheduling and packaging layer over existing `tests` rows. It does not own questions.** | `tests` + `test_questions` + `attempts` + `answer_test_sessions` + `v_test_leaderboard` already work and are exam-scoped, entitlement-gated and RLS'd. A parallel test model would fork the attempt engine. |
| D-2 | **"Attemptable" and "ranked" are separate predicates, both derived from timestamps.** | §2.3. Gives Model A and Model B behaviour from one mechanism, and makes the missed-window policy a data change rather than a code change. |
| D-3 | **Series tests reuse `test_kind` `mock` (full-length) and `sectional`.** | `v_test_leaderboard` filters on exactly those two. A new enum value silently un-ranks the flagship feature. §5.3. |
| D-4 | **Opening a test fires no job.** | §7. `opens_at`/`closes_at` are compared at read time. Only push delivery is time-critical. |
| D-5 | **Prelims ships first, alone, and completely.** | It is LLM-free to serve, supply-constrained but tractable, and blocked on no open quality gate. Mains is blocked on G1, G3 and an economics decision (§10). Shipping them together means shipping neither. |

---

## 5. Data model

Three new tables. No change to `tests`, `attempts`, `attempt_answers` or
`answer_test_sessions`.

### 5.1 `test_series` — the product

```
id            uuid pk
exam_code     text not null references exams(exam_code)     -- multi-exam, §0 of docs/multi-exam.md
stage         text not null check (stage in ('prelims','mains'))
slug          text not null unique                          -- idempotency key, matches tests.slug convention
title_i18n    jsonb not null                                -- bilingual publish gate applies
description_i18n jsonb
status        text not null default 'draft'
                check (status in ('draft','published','archived'))
starts_on     date not null
ends_on       date not null
target_exam_year int                                        -- "Prelims Test Series 2026"
meta          jsonb not null default '{}'
created_at / updated_at
```

`exam_code` is **required, not derived**, for the same reason `tests.exam_code`
is (migration `0106`): a series is the anchor its entries derive from, and a
series can legitimately contain a test whose `paper_code` is the synthetic
`CURRENT_AFFAIRS`, which resolves to no syllabus tree.

### 5.2 `test_series_entries` — one scheduled instance

```
id              uuid pk
series_id       uuid not null references test_series(id) on delete cascade
test_id         uuid not null references tests(id) on delete restrict
sequence_no     int  not null                       -- "Test 07"
entry_kind      text not null check (entry_kind in
                  ('sectional','full_length','current_affairs','revision'))
opens_at        timestamptz not null
closes_at       timestamptz                         -- null = never closes (always practisable)
ranked_until    timestamptz                         -- null = never ranked; normally = closes_at
syllabus_note_i18n jsonb                            -- "Polity: Arts 1-51A" — what the student must revise
meta            jsonb not null default '{}'
unique (series_id, sequence_no)
unique (test_id)                                    -- a test belongs to at most one series
```

`on delete restrict` on `test_id` is deliberate: deleting a `tests` row that a
published series schedules should fail loudly, not silently blank an entry.

⚑ **Do not reuse `tests.scheduled_date`.** It is a `date` (no time of day) and
its partial unique index is scoped to `kind='daily_quiz'` (`0098`, `0106` §8).
Putting the window on the entry keeps `tests` generic and lets the same test row
theoretically be re-scheduled in a later series without touching it.

⚑ **`ranked_until` must be treated as immutable once it has passed.** Editing it
retroactively re-ranks history, because the board derives ranked-ness by
comparison rather than storing it. Enforce in the admin write path, not by a
constraint — a trigger comparing to `now()` would make the row unrestorable from
a backup.

### 5.3 Why not a new `test_kind`

`v_test_leaderboard` (`0067`) is defined `where t.kind in ('mock','sectional')`.
Adding `'series'` and using it would produce series tests with **no rank, no
error, and no failing test** — the exact silent-widen class this repo has been
bitten by repeatedly. Full-length series entries are `kind='mock'`, sectional
entries are `kind='sectional'`, and "is this test part of a series" is answered
by the `test_series_entries` join.

Consequence to accept: series tests will appear in the existing
`mv_mock_series_board` per-paper board alongside the standalone mocks. That is
arguably correct (they are the same kind of thing) but should be a conscious
choice — see Q6.

### 5.4 `test_series_enrollments` — who is in

```
id           uuid pk
user_id      uuid not null references users_profile(id) on delete cascade
series_id    uuid not null references test_series(id) on delete cascade
enrolled_at  timestamptz not null default now()
status       text not null default 'active' check (status in ('active','withdrawn'))
unique (user_id, series_id)
```

Needed for two things only: knowing whom to notify, and scoping the ranked
cohort. Owner-only RLS, matching the `0053` shape.

### 5.5 Per-user attempt/lock state — **no new table**

This is the part most likely to be over-built. Every piece of per-user state is
already derivable:

| State | Derivation |
|---|---|
| Locked | `now() < entry.opens_at` |
| Not started | no `attempts` / `answer_test_sessions` row for `(user, test_id)` |
| In progress | existing row with `submitted_at is null` (already uniquely indexed — `0025`, `0064`) |
| Submitted on time | `submitted_at <= entry.ranked_until` |
| Late / practice | `submitted_at > entry.ranked_until` |
| Ranked | first submitted attempt **and** on time |

The one genuinely new artefact is a leaderboard that respects the window:

```sql
-- v_test_leaderboard gains, in the `qualifying` CTE:
left join test_series_entries e on e.test_id = a.test_id
where ...
  and (e.id is null or e.ranked_until is null or a.submitted_at <= e.ranked_until)
```

A `left join` so every standalone mock behaves exactly as it does today. This
change must be verified against a byte-identical before/after of the existing
boards — the repo's established method for this class of change.

---

## 6. Question sourcing — rules per test type

### 6.1 The three sources and what each is for

| Source | Reality today | Right role in a series |
|---|---|---|
| **Real PYQ** (`source='pyq'`) | 5,245 visible. Highest trust; official answer keys for most years. | The **anchor**. A student has almost certainly seen some of them, which is fine for sectional practice and corrosive for a ranked full-length. |
| **CA-generated** (`CURRENT_AFFAIRS`, 1,140 approved) | Generated, human-reviewed, permanently `is_published=false` and reachable only through the "test" visibility scope. | The **current-affairs paper** and a small slice of every full-length. This is the only source that is *inherently fresh* — nobody has seen this month's news questions. |
| **qgen** (`source='generated'`, 1,807 visible) | Nightly batch top-up capped at `QGEN_BATCH_MAX_USD` ($5), every question `needs_review` until a human approves. | The **volume filler**, and the only source that can supply unseen questions at scale. See §6.4 — this is a dependency, not a solved input. |

### 6.2 Recommended mix

| Entry kind | Size | PYQ | CA | qgen | Reasoning |
|---|---|---:|---:|---:|---|
| **Sectional** (Prelims) | 50–75 Q | 60% | 0–10% | 30–40% | Practice, not competition. PYQ-heavy is a feature: the student is learning what the commission actually asks about that section. Repeat exposure is acceptable. |
| **Full-length live mock** (Prelims) | 150 Q (UPPSC GS-I) / 100 Q (UPSC) | **≤ 30%** | 10–15% | **55–60%** | The rank is the product. If half the paper is questions the student has already done in `/practice`, the rank measures memory of our own bank. **Freshness dominates.** |
| **Current affairs paper** | 100 Q | 0% | **100%** | 0% | This is the one paper CA questions are unambiguously right for, and it is a real market SKU (Target PCS ships 4). |
| **Revision / full syllabus** (final 2–3 tests) | 150 Q | 40% | 20% | 40% | Late-cycle consolidation; some deliberate PYQ repetition is pedagogically correct here. |
| **Mains sectional / full-length** | 20 Q | **80–100%** | 0% | **0–20%** | See §6.5 — the descriptive generator has an open, undiagnosed quality gap. |

Every selection must go through `questionVisibilityOrFilter("test")`, and
"unseen by this user" should be computed from the user's own
`attempt_answers` — the same idea as `recentlyUsedInDailyQuiz`, which already
exists and is exam-scoped.

### 6.3 ⚑ Supply is the binding constraint, and it is binding today

For a 25-test UPPSC Prelims series with 11 full-lengths at 150 Q and 10
sectionals at 60 Q, GS-I alone needs roughly **2,250 questions** to run without
cross-test repetition. **`PRE_GS1` has 1,021 visible.** At the recommended ≤30%
PYQ ratio for full-lengths, the series needs ~1,150 *fresh, non-PYQ* GS-I
questions and there are **17**.

Three ways out, and the build must pick one before writing a selector:

1. **Generate the shortfall.** ~1,100 approved GS-I MCQs. At qgen's current
   nightly ceiling and, more importantly, its human review gate, this is a
   multi-month content programme, not a build task.
2. **Shrink the series.** 12–15 tests instead of 25, weighted toward sectionals
   (smaller, and PYQ-tolerant). Feasible from today's bank. This is the
   recommendation for v1.
3. **Allow controlled repetition** and say so in the product copy ("built from
   the full PYQ bank"), accepting that the rank is softer.

**UPSC is materially better placed** — `UPSC_PRE_GS1` has 1,089 PYQs against a
100-question paper = 10 clean full-lengths — but has **zero generated questions
and zero mocks**, and `upsc.is_live` is still `false`.

### 6.4 ⚑ qgen is a dependency, not a solved input

Stated explicitly because the mix in §6.2 leans on it:

- **Volume is gated on human review, not on generation.** Every generated
  question is `review_state='needs_review'` until a person approves it. The
  current backlog is **1,027 questions** (551 CA + 200 CSAT + 166 GS1 + 110
  others). A series that
  needs 1,100 new approved questions needs a **reviewer**, and no reviewer
  throughput is budgeted anywhere in this repo.
- **MCQ generation quality has a partial, measured clearance.** The 2026-08-08
  panel found the format cause diagnosed in `ac150dc` genuinely fixed
  (`statement_counting` 20.7% → 0% across the fix boundary). It was **CSAT-only**
  and was **not re-panelled** after the fix. GS-I MCQ generation has never been
  panel-gated at all — `PRE_GS1` has 17 generated questions total.
- **Cost is bounded but not free.** `QGEN_BATCH_MAX_USD` defaults to $5/night on
  the Message Batches API (50% discount). A 1,100-question programme is real
  spend on top of real reviewer time.

**Do not assume qgen supplies the shortfall.** Either the series is sized to
today's bank (§6.3 option 2), or a content programme is scheduled and completed
first.

### 6.5 ⚑ Mains-descriptive generation is explicitly NOT cleared

`docs/OUTSTANDING.md` §9 **G1**: generated Mains-descriptive questions scored
**2.50** against **4.63** (real Essay) and **5.00** (real GS4) on a blind
3-judge panel. `aeb2d2c` removed the *vacuous-target* half of the cause (nodes
that are marking criteria rather than topics), but the row records that the gap
is **evenly spread across both papers** and that **a second, undiagnosed cause
exists**. All 28 generated descriptive rows remain `needs_review`.

**Therefore: a Mains test series must be built from real PYQs only, until G1 is
diagnosed and a fresh panel clears descriptive generation.** §3.1 shows this is
survivable — `MAINS_GS2` has 148 PYQs = 7 clean 20-question papers, and
`UPSC_MAINS_GS1..GS3` have 200 each = 10 — but it caps the Mains series at
roughly **6–8 papers per GS paper**, not 22.

---

## 7. Scheduling mechanism

### 7.1 The reframing: almost nothing needs to fire

| Requirement | Needs a timed actor? | How it actually works |
|---|---|---|
| Test becomes visible/startable at 14:00 | **No** | `now() >= opens_at`, evaluated when the student loads the page |
| Test stops counting for rank | **No** | `submitted_at <= ranked_until`, evaluated at submit / in the board view |
| Attempt auto-submits at duration end | **No — already solved** | The player computes the countdown from server-authoritative `started_at + duration_minutes` (Session 7) and auto-submits; the server can finalise lazily |
| Rank / percentile shown | **No** | Computed on read; `refresh_scoreboard_views` already exists and already runs |
| Abandoned in-flight attempt | **No** | Lazy, on next read — same as the existing stale-`evaluating` reclaim |
| **"Your test is live" push** | **YES** | The only genuinely time-critical actor in the feature |
| **"Opens in 1 hour" reminder** | **YES** | Same mechanism |

This is why the recommendation is **not** "use cron" and **not** "add a job
scheduler". It is: *put the schedule in the data and compare against the clock
at read time.* The daily quiz already establishes the pattern — `ensureTodayQuizzes`
is a read-time self-heal, not a dependency on the 05:00 job having run.

### 7.2 Recommendation

**v1 — no new scheduling infrastructure.**

- Constrain `opens_at` to `:00` of an hour (a product constraint, enforced by a
  CHECK or the admin form). "Live at 14:00 IST" is what institutes advertise
  anyway; nobody opens a test at 14:07.
- Enqueue every `notification_schedule` row **at series-publish time, days or
  weeks ahead**, with the exact `scheduled_for`. The whole calendar is known in
  advance — this is the property that makes the feature easy.
- The existing hourly `notifications.yml` drain picks up a row scheduled for
  14:00 on its 14:00 run, because the query is `lte(scheduled_for, now)`.
  Delivery lag = GitHub Actions schedule drift only.

**Why not tighten the GitHub cron instead:** two documented problems, both in
this repo's own workflow comments. GH Actions `schedule:` triggers are
**best-effort** with minutes of drift and can be dropped under load, and they
are **auto-disabled after 60 days of repository inactivity**. For a paid product
whose core promise is "the test goes live at 14:00", a mechanism that silently
switches itself off because nobody pushed a commit for two months is a real
operational hazard. It is tolerable for a daily quiz; it is not a good
foundation for a flagship.

**v2 upgrade path if minute-precision is ever needed: `pg_cron` + `pg_net`.**
`pg_cron` is enabled on every Supabase project including the free tier, runs
inside Postgres (no cold start, no external dependency, no 60-day
auto-disable), and is precise to the minute. It cannot send a web push itself
(that needs the Node `web-push`/VAPID path), so the shape would be `pg_cron`
→ `pg_net` POST → an API endpoint behind a shared secret → the existing
`runPushSender`. **Do not build this for v1.** Build it when a founder decides
that a 0–20 minute notification lag is unacceptable, which is a product
judgement, not an engineering one.

*Rejected: a queue (BullMQ/pg-boss).* It solves distribution and retry problems
this feature does not have — the work is idempotent, low-volume (tens of rows
per test), and already has an at-least-once drain with `pushed_at` as the
dedupe key.

### 7.3 What does still need a job

Only content assembly: building the series' `tests` rows in advance. That is
`mocks:build`-shaped work — a monthly/one-off CLI, run manually or on the
existing `mocks-build.yml` cadence, with a `--series <slug>` flag. It is
deliberately **not** coupled to `opens_at`: papers should be assembled and
reviewed **before** the series is published, never generated at open time.

---

## 8. Notifications

### 8.1 What exists

`notification_schedule` (`0039`) is closer to fitting than expected. It already
has `scheduled_for timestamptz`, bilingual `title_i18n`/`body_i18n`, a `link`,
a `(user_id, dedupe_key)` unique for idempotent re-generation, `pushed_at`
(`0059`) so the sender fires each row exactly once, per-type opt-out via
`push_preferences`, and dead-subscription pruning.

**It was built for the daily-reminder pattern, but the only thing that is
actually daily about it is `generateForUser`**, which recomputes three fixed
nudges for today from `getDailyProgress`. The table itself is a general
scheduled-message queue.

### 8.2 What must change

1. **`notification_type` is a Postgres enum** with exactly
   `quiz_ready | streak_at_risk | srs_due`. Series notifications need
   `ALTER TYPE notification_type ADD VALUE` — same pattern as `0040`/`0046`/`0102`
   for `test_kind`. Proposed additions: `series_test_open`,
   `series_test_reminder`, `series_result_ready`.
2. **Enqueue must be decoupled from `generateForUser`.** That function is a
   *reconciler* — it enqueues and **resolves** (marks read) based on whether a
   condition still holds today. A series notification is a **fact about a fixed
   future moment** and must not be resolved away by a daily reconciler. Enqueue
   it once from the series-publish path, keyed
   `dedupe_key = 'series_open:<entry_id>'`, and leave the reconciler alone.
3. **`push_preferences` needs a column per new type** — the sender reads
   `prefs[row.type]`, so a new enum value with no column silently defaults to
   opted-in. That is arguably the right default here, but it should be explicit.
4. **Fan-out is bounded by enrollment**, not by all users. One row per enrolled
   student per notified entry. At the recommended cadence this is trivial —
   ~25 tests × 2 notifications × N students.

### 8.3 Recommended notification set

| When | Type | Content |
|---|---|---|
| `opens_at - 24h` | `series_test_reminder` | "Test 07 (Polity) opens tomorrow at 2 PM — here's what to revise" (`syllabus_note_i18n`) |
| `opens_at` | `series_test_open` | "Test 07 is live" → deep link straight into the pre-start screen |
| `closes_at - 12h`, only if unattempted | `series_test_reminder` | "Test 07 closes tonight" |
| after `ranked_until`, once | `series_result_ready` | "Your rank for Test 07 is out" |

The last one is the only one that needs a condition evaluated *after* the fact
rather than known in advance, and it fits the existing reconciler shape
naturally.

⚑ **1 push subscription exists in the entire database.** Push is effectively
unproven at any scale. Assume the in-app bell is the primary channel for v1 and
that push needs its own verification pass.

---

## 9. Prelims vs Mains — how they differ

### 9.1 Prelims

Almost entirely reuse. `startAttempt` is the natural chokepoint for the window
gate — it *already* does an untrusted-`test_id` exam check and an
`assertMockTests` entitlement check in exactly the right place. Adding "and this
test's series window is open" is one more check in a function that already has
two. Grading, results, the review list, the cut-off comparison and the
leaderboard all work unchanged.

**Serving cost: zero LLM calls.** Explanations are generated on demand and
cached per question (Session 8), so a cohort sharing a paper shares one
generation.

### 9.2 Mains

Structurally similar, economically different.

`answer_test_sessions` (`0063`/`0064`) is already the right primitive: a
resumable, timed wrapper over a `tests` row whose questions become normal
`answer_submissions`. It already has a unique active-session index mirroring
`startAttempt`. The window gate goes in `startAnswerSession`, exactly parallel
to Prelims.

But:

- **There is no automatic ranked board for descriptive papers.**
  `v_test_leaderboard` reads `attempts`, which Mains does not use. A Mains rank
  would have to be built over `answer_test_sessions` + summed `evaluations` —
  new work, and only meaningful if every enrolled student's paper is fully
  evaluated (see §9.3).
- **⚑ Mains scoring depends on G3, which is open.** Every Mains series answer is
  scored by the same two-pass pipeline, and the model answer shown to the
  student comes from `answer_eval_model`. `docs/OUTSTANDING.md` **G3** records
  the verify gate as shipped but **not closed**: precision is validated, recall
  only partly — the shipped sonnet verifier's false-positive rate over the 14
  known-good answers is unmeasured, and it is unknown whether it catches the one
  real factual error the earlier verifier missed. A test series multiplies
  exposure to this by 20 answers per paper per student, and — because model
  answers are **cached and replayed** — a bad one is served to the entire cohort
  and every future student on that question. **G3 should be closed before a
  Mains series ships**, not in parallel with it.

### 9.3 ⚑ The Mains economics collision

At the measured **$0.0584/evaluation** and a 20-question UPPSC Mains paper:

| | evaluations | cost |
|---|---:|---:|
| One Mains paper, one student | 20 | **$1.17** |
| A 22-paper Mains series, one student | 440 | **$25.70** |
| Marginal cost once model answers are cached (student N>1) | 440 | **~$21.00** |

Against a **₹2,499 (~$28) annual plan** and a **₹399 (~$4.50) monthly** one.
And against the current entitlement limits, which were set for ad-hoc practice:

- **Pro: 60 evaluations/month.** A weekly Mains paper is 80/month. The cap is
  breached in week three of every month, on the flagship feature.
- **Trial: 2 evaluations/day.** A trial user physically cannot complete one
  Mains paper in under 10 days.

This is not a bug to fix in code. It is a pricing and product decision, and it
is **Q4**. The market's own answer is instructive: institute Mains test series
are priced separately at ₹15,000–₹25,000 precisely because evaluation is the
expensive part. Options, none of them free:

1. **Separate paid SKU** for the Mains series with its own evaluation
   allowance. Market-normal; needs `plans`/`entitlements` work.
2. **Partial evaluation** — the student submits all 20 answers, chooses 5 for AI
   evaluation, and gets the model answer + marking outline for the rest. Cuts
   cost ~4× and mirrors how human evaluation is rationed anyway.
3. **Self-assessment against the cached model answer** as the default, with AI
   evaluation as the paid upgrade. Cheapest, and genuinely useful pedagogy.
4. **Raise the Pro cap and the price.** Simplest, most exposed to a heavy user.

Option 2 or 3 is the recommendation, but it is explicitly the founder's call.

---

## 10. Dependencies — what must be true before each phase

| Dependency | Where tracked | Blocks |
|---|---|---|
| **G1** — Mains-descriptive generation quality gap, second cause undiagnosed | `OUTSTANDING.md` §9 | Any qgen content in a Mains series (§6.5). **Not** Prelims. |
| **G3** — model-answer verify gate recall unmeasured | `OUTSTANDING.md` §9, §9a | Mains series ship (§9.2) |
| **Question supply** — ~1,100 fresh GS-I MCQs for a 25-test series | this doc §6.3 | A full-size Prelims series. Not a 12–15-test one. |
| **Reviewer throughput** — 1,027-question `needs_review` backlog | §3.1 | Any plan that assumes generated questions become visible |
| **U8u** — 0 `upsc` mocks exist | `OUTSTANDING.md` §8k | A UPSC series (one CLI run) |
| **D3** — in-process rate limiter | `OUTSTANDING.md` §4 | A real live-mock event, where hundreds of students hit `startAttempt` in the same minute on a multi-instance deploy |
| **D7 / V2** — nothing is actually deployed | `OUTSTANDING.md` §4, §5 | Everything. There is no production deployment to run a live test on. |
| **Push unproven** — 1 subscription in the DB | §3.3 | Relying on push as the primary notification channel |

---

## 11. Phased build plan

### Phase 0 — decisions and content (no code)

Answer §12. Decide the series size against §6.3. If the answer is "full 25-test
series", start the content programme now, because it is the long pole and it is
measured in months of reviewer time.

### Phase 1 — Prelims series, end to end

The smallest thing that is genuinely the product.

1. Migration: `test_series`, `test_series_entries`, `test_series_enrollments`
   + owner-only RLS (the `0053` shape) + the `v_test_leaderboard` window
   predicate (§5.5), verified byte-identical for existing boards.
2. `pnpm series:build --slug <s>` — assembles the `tests` rows from the §6.2
   mix, mirroring `mocks.ts` (reuse `availableQuestions`, `loadNodeWeightage`,
   the weightage balancing and `questionVisibilityOrFilter`).
3. Window gate in `startAttempt`; `403`/`404` semantics matching the existing
   exam-mismatch convention.
4. Series calendar UI + a per-test state chip (locked / live / closes in / done
   / practice), reusing the existing pre-start and player screens unchanged.
5. Result page gains the series context and the two-tier rank (ranked cohort vs
   informational for late attempts).

**Ships without any LLM call, any new scheduling infrastructure, and any change
to the attempt engine.**

### Phase 2 — notifications

Enum values, `push_preferences` columns, enqueue-at-publish, the four messages
in §8.3, and the `series_result_ready` reconciler branch. Verify the in-app bell
path first; treat push as unproven.

### Phase 3 — Mains series (gated)

Only after G3 closes and Q4 is answered. `startAnswerSession` window gate, a
Mains rank surface if Q5 says yes, and whichever evaluation-rationing model Q4
picks.

### Genuinely v2

- Offline/centre mode (a real market feature; needs a whole result-ingestion path)
- Adaptive scheduling — a personalised calendar rather than one shared cohort
  calendar. **Note this directly conflicts with ranking**, which needs a shared
  cohort; do not drift into it accidentally.
- Series-level analytics: rank trajectory, percentile bands, cohort comparison
- A free **All-India Open Mock** as an acquisition event (Model B, §2.2) — the
  natural top of funnel once the machinery exists
- Institute-style mentor call / written feedback attached to a series

---

## 12. Open questions for the product owner

Each of these changes what gets built. None should be guessed at.

| # | Question | Why it matters | Recommendation |
|---|---|---|---|
| **Q1** | **Missed-window policy** — locked out, late-flagged, or open as unranked practice? | The single biggest behavioural decision; determines whether `closes_at` is a gate or a label. | Unranked practice (§2.3). Matches the market and keeps every mechanism a comparison. |
| **Q2** | **Cadence and size** — 25 tests weekly, or 12–15? | §6.3: 25 tests is not supportable from today's bank. Sets the content programme. | 15 tests for v1 (8 sectional, 5 full-length, 2 CA), weekly, expanding as the bank grows. |
| **Q3** | **Is the series inside Pro, or a separate SKU?** | `assertMockTests` gates mocks as Pro today. A series is a bigger, dated commitment. | Prelims inside Pro; Mains separate (Q4). |
| **Q4** | **Mains evaluation economics** — §9.3. | ~$25.7/student against a ~$28 annual plan; and the Pro cap breaks in week 3. | Option 2 or 3 (partial evaluation / self-assessment default). Blocking for Phase 3. |
| **Q5** | **Does Mains get a rank at all?** | Needs new board machinery **and** full evaluation of every enrolled student's paper, which multiplies Q4. | No rank in v1 — show a dimension-wise percentile band instead. |
| **Q6** | **Should series full-lengths appear in the existing per-paper mock board?** | §5.3 — they will by default. | Yes, but surface the series board separately as the primary one. |
| **Q7** | **UPPSC only, or UPPSC + UPSC at launch?** | UPSC has better Prelims supply (§6.3) but 0 mocks and `is_live=false`. | UPPSC first. UPSC when it launches. |
| **Q8** | **How much notification lag is acceptable?** | Decides whether §7.2's v2 (`pg_cron` + `pg_net`) is needed, and whether the GH-Actions 60-day auto-disable risk is tolerable. | Accept 0–20 min for v1; revisit before any advertised live event. |
| **Q9** | **Who reviews the generated questions?** | §6.4 — the backlog is 1,027 and nothing in this repo budgets reviewer time. | Must be answered before any plan that depends on qgen volume. |

---

## Appendix — what this design did NOT verify

Recorded so a build session does not treat it as settled:

- **No code was written or run** beyond two read-only DB probes, both deleted.
- **The late-attempt ranking policy of real institutes could not be confirmed
  from public sources** (§2.2) — the recommendation in §2.3 is reasoned from the
  two delivery models, not observed.
- **The `v_test_leaderboard` change in §5.5 is untested.** It must be verified
  byte-identical for existing boards before it ships.
- **`pg_cron` + `pg_net` availability was confirmed from Supabase's
  documentation, not from this project.** Neither extension is installed today
  (`0001_extensions.sql` has only `pgcrypto` and `vector`).
- **Push at cohort scale is entirely unproven** — 1 subscription exists.
- **The cost model assumes model-answer caching holds across a cohort.** It
  follows from the `(question_id, locale, rubric_version)` unique key, but has
  not been measured over a real multi-student cohort, because none exists.
