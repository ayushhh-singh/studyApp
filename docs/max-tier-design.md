# Max tier — research, exam-interaction decision, and schema

**Status: SHIPPED (2026-08-14).** Price signed off by the product owner —
**option A: ₹749/month · ₹5,999/year** (§7). The tier is live end to end: the
enum (`0129_user_plan_max.sql`, renumbered from 0128 by a concurrent session to
resolve a collision), the priced rows (`0130_seed_max_plans.sql`, applied), the
entitlement fixes (§6.2), the series gate (§6.3), the pricing page, the paywall,
and admin grant/revoke for both tiers.

⚑ **Both a monthly and a yearly option ship, on the owner's explicit call.** §7
recommended annual-only for option A because its monthly is loss-making at a
full three-month Mains burn. That exposure is real but bounded — see the
`LIMITS.max` comment in `entitlements.ts` for the exact arithmetic and why the
annual cap caps it at ~3 such months.

Every platform number was measured against the live cloud DB on **2026-08-14**
and is dated. Every market figure is attributed. Currency conversions use
**₹88/USD**, stated so they can be re-derived.

---

## 1. Executive summary

1. **The premise's price band needs re-anchoring, in both directions.** ₹799–999/month
   is *below* what institutes charge for a season and *20–30× above* what
   subscription-native Indian EdTech charges. Both comparisons are true; they
   are different products. §2.
2. **The binding constraint is not willingness-to-pay, it is unit cost.** A
   Mains series costs **₹2,261–3,084 per student** in AI evaluation. Prelims
   costs **₹0**. Any Max price must clear the Mains number, and the current Pro
   yearly (₹2,499) already does not clear its own worst case. §3.
3. **Decision: Max is exam-agnostic** (one SKU, covers every live exam the user
   can switch to). Cost is bounded by a shared evaluation cap, not by access
   scope — which is what makes the exam dimension unnecessary. §4.
4. **Decision: all test series sit behind Max.** Pro keeps everything it has
   today; the series is a new product, so no existing Pro user loses anything. §5.
5. **The schema delta is one enum value.** That is the payoff of #3 — the
   per-exam alternative would have cost a column on `plans`, a denormalised copy
   on `subscriptions`, a signature change, and a live-row migration if ever
   merged back. §6.
6. **The series gate already exists and is already correct — the plan check is
   the single missing piece.** `assertSeriesAttemptAllowed` keys off the
   `test_series_entries` join (never `test.kind`) and is wired into **both**
   start paths, but consults no plan. Both live series are `draft`, so nothing
   leaks today. §6.3 — **corrected after this document's first draft overclaimed
   a live leak.**
7. **⚑ Two entitlement bugs fail silently the moment `plan='max'` exists**, and
   one is a permanent revenue leak. §6.2.
8. **Price chosen: option A, ₹749/mo · ₹5,999/yr, both cadences shipped.** §7.

---

## 2. Market research

### 2.1 The correction to the brief

The brief's research gathered **one-time seasonal coaching prices** and
concluded a subscription-framed ₹799–999/month "nets out far below competitors'
lump sums". Against institutes that is right. Against the actual
subscription-framed market it is inverted, and that market was not in the brief.

| Product | Price | Model | Includes AI evaluation? |
|---|---|---|---|
| Testbook Pass | **₹369–449/year** | subscription | No |
| PW Pi OTT (UPSC) | **₹300/mo · ₹1,500/6mo · ₹2,400/yr** | subscription | No |
| ClearIAS test series | ₹4,999 (40 tests) | one-time | No |
| Vision IAS Prelims GS | ₹16,000 (35 tests) | one-time | No (human) |
| Vision IAS CSAT | ₹9,000 (25 tests) | one-time | No |
| Institute Mains series | ₹15,000–25,000 | one-time | Human evaluation |
| Target PCS (UPPSC Prelims) | ₹2,100 | one-time | No |
| theIAShub **UPPCS full course** | ₹14,999 online · ₹19,999 offline | one-time | No |
| **Neev Pro today** | **₹399/mo · ₹2,499/yr** | subscription | Yes (60/mo) |

Sources: [Testbook Pass](https://www.g2.com/products/testbook-pass/reviews) ·
[PW Pi OTT](https://www.pw.live/upsc/exams/upsc-2026-online-classes-on-pi-ott-by-pw-affordable-subscription-with-free-trial) ·
[ClearIAS / Vision / NextIAS comparison](https://competer.in/best-test-series-for-upsc/) ·
Vision IAS and Target PCS figures are from their own published schedules, read
in full in `docs/test-series-design.md` §2.

**Two honest readings, and both belong in the decision:**

- **Against subscription-native EdTech**, ₹799–999/month (₹9,588–11,988/year) is
  **20–27× Testbook** and **4–5× PW Pi**. Those platforms are mass-market volume
  plays across SSC/Banking/Railways with no AI evaluation of written answers —
  a different product — but they are what an Indian aspirant's price intuition
  for "an app subscription" is calibrated against.
- **Against institutes**, the same number is *below* a single season: Vision IAS
  Prelims GS alone is ₹16,000, and a Mains series with human evaluation is
  ₹15,000–25,000. Neev's Max is the only product in the table that offers
  per-answer Mains evaluation on a subscription.

The defensible position is therefore **"a fraction of an institute Mains series,
a multiple of a mass-market pass"** — and the pitch has to say which comparison
it is making, because a user anchored on Testbook will read ₹999/month as absurd.

### 2.2 The dual-exam question — my first draft cited folklore

> **⚑ Correction (2026-08-14).** This section originally read: *"the UPSC and
> state-PCS syllabi overlap **60–80%**, and the consensus of the coaching market
> is that most serious aspirants sit both."* **Both halves were folklore, and
> the first was the wrong quantity anyway.** A dedicated search of ~20 named
> institutes' own pages found the 60–70% figure stated as fact by Sleepy
> Classes, PMF IAS and BharatNotes — **none with a citation, survey or
> methodology** — and flatly contradicted by SPM IAS Academy and Riyasat IAS,
> which both assert **85–90%** with equal confidence and equal sourcing. At
> least one cluster is materially wrong and nobody can adjudicate. Worse, that
> is *syllabus* overlap, which is a **different quantity from aspirant
> overlap** — the thing this decision actually needed.

**No measured figure for aspirant overlap exists.** Neither UPSC nor any state
PSC publishes candidate-level identifiers that would permit the join, and a
sweep of institute pages, the Redseer test-prep market report and PhysicsWallah's
DRHP coverage found segmentation by **delivery channel and geography, never by
exam**. Adda247's "4 crore+ students" and PW's "3.5 million registered" are
undifferentiated aggregates. Treat any overlap percentage you encounter as
unsourced until someone produces the study.

**So the honest evidence for this decision is our own** (§2.3), and it points the
opposite way from the folklore: **91% of our active users work exactly one
exam**, and of the seven who have ever switched, **five only ever worked one** —
switching is *changing your mind*, not *adding a second exam*.

What is genuinely measured, and useful, is the funnel:

| Stage | Applied | Appeared | Show-up | Source |
|---|---:|---:|---:|---|
| UPSC CSE **Prelims** 2021 | 10,93,984 | 5,08,619 | **46.5%** | UPSC Annual Report (primary) |
| UPSC CSE **Prelims** 2022 | 11,35,697 | 5,73,735 | **50.5%** | UPSC Annual Report (primary) |
| UPSC CSE **Mains** 2021 | 9,156 | 8,930 | **97.5%** | UPSC Annual Report (primary) |
| UPSC CSE **Mains** 2022 | 13,051 | 12,775 | **97.9%** | UPSC Annual Report (primary) |
| UPPSC PCS Prelims 2024 | 5,76,154 | 2,41,212 | 42% | Careers360 (secondary; a protest year, treat as a low outlier) |

Sources: [UPSC 73rd Annual Report](https://www.upsc.gov.in/sites/default/files/73rd-AnnualReport-2022-23-Engl-220824.pdf) ·
[74th Annual Report](https://upsc.gov.in/sites/default/files/74thAnnualReport-2023-24-Engl-230326.pdf) ·
[Careers360](https://news.careers360.com/up-pcs-prelims-2024-conclude-42-turnout). UPSC
publishes the gap itself, as a **"Drop-out Rate (%)"** column.

**⚑ Do not read the 46% → 98% jump as "commitment produces consumption."** It is
overwhelmingly **selection**: the Mains cohort is the ~1.5% who passed a
1-in-50 filter, so they differ in intent and ability, not merely in sunk cost.
And there is a datapoint pointing the other way — **the ~50% who never showed at
Prelims had already paid the application fee.** Prepayment demonstrably does not
guarantee consumption. This matters because the tempting inference — "Max buyers
will behave like the 98% cohort, so price high" — is not supported.

The calendars are at least complementary rather than colliding: UPPSC Prelims
Dec 2026, UPSC Prelims May 2027, UPPSC Mains ~Mar 2027, UPSC Mains Aug 2027
(`docs/test-series-design.md` §13). So dual preparation is *feasible*; our data
just says almost nobody does it.

**Our own numbers do not yet show this, and that is expected**, not a
counter-argument: `upsc` went live 2026-08-11, three days before this
measurement.

| Measure (live DB, 2026-08-14) | Value |
|---|---|
| Profiles | **179** (172 `uppsc`, 7 `upsc`) |
| Users who have ever switched exam | **7** |
| Currently `plan='pro'` | 76 (almost all trial) |
| **Subscriptions that have ever been paid** | **3** |
| Submissions that consumed an evaluation credit, ever | **41** (0 on `upsc`) |

**⚑ This is a pre-revenue pricing decision.** With three paid subscriptions
there is no revenue data to price against, and no elasticity to measure. Every
number in §7 is a reasoned starting point to be corrected by real conversion
data, not a finding.

### 2.3 What our users actually consume

Measured read-only, 2026-08-14. This is the evidence §2.2's folklore was
standing in for, and it is the single strongest input to the cost model.

| Signal | Measured |
|---|---|
| Users who submitted ≥1 test | 23 of 179 |
| …who ever reached **25 tests** (one series) | **0** |
| Best user ever | 16 tests |
| Started attempts that get submitted | **60%** (40% abandoned mid-test) |
| Repeat curve, of finishers | 100% → 43% (2+) → 26% (3+) → 17% (10+) → **0% (25)** |
| Max evaluations by a **real human**, ever | **5** |
| Users with ≥1 evaluation | 17 (9.5%) |
| Retention, weeks 0–4 since signup | 100% → 21% → 14% → 7% → 7% |
| **Active on exactly one exam** | **21 of 23 (91%)** |
| Of the 7 exam-switchers, active on both | **2** (five switched and worked only one) |

Two controls, because each of these has an obvious alternative explanation:

- **It is not the cap biting.** 25 of 31 user-days are a *single* evaluation and
  the busiest day ever was 5, so the trial's 2/day ceiling is not what is
  holding usage down. **162 of 179 users never used even their 3 free
  evaluations.**
- **The "10 evaluations" top user is the demo seed account**, not a person. The
  real human maximum is 5 — against a Mains series that asks for **440**.

**Three caveats that stop this being decisive.** The platform is 37 days old;
**no series is published**, so there is literally nothing to complete; and
almost everyone is free or trial, so paid behaviour is unmeasured. Selection
bias runs the other way — Max buyers self-select for commitment — but §2.2's
prepaid-no-show finding says prepayment is a much weaker filter than it feels.

Cost basis independently re-confirmed here: **$0.0590/evaluation** measured over
139 real `answer_eval_*` calls, against the $0.0584 used in §3.

### 2.4 What the research could NOT establish

Recorded so nobody assumes these were checked and found reassuring. A research
pass on 2026-08-14 hit a hard session limit before returning:

| Question | Status |
|---|---|
| Test-series completion rate (of a 25–35 test series, how many are attempted) | **NOT FOUND.** Providers have no incentive to publish attempt rates; the researcher's own read is that the aggregate does not exist publicly. |
| SWAYAM / NPTEL / MOOC completion rates in India | **NOT RETRIEVED** — agent terminated. |
| Mains answer-writing participation and dropoff | **NOT RETRIEVED** — agent terminated. |
| Does paying raise completion? (paid-vs-free, sunk cost) | **NOT RETRIEVED** — the one study design that would settle §2.2's selection-vs-commitment question. |
| Indian EdTech subscription churn / average lifetime | **NOT RETRIEVED** — agent terminated. |
| **Aspirant** overlap between UPSC and state PCS | **DOES NOT EXIST.** No institute, regulator or filing publishes it; see §2.2. |

The gap that matters most is **paid-vs-free completion**. Until it is answered,
"Max buyers will consume more than our free cohort" is an assumption, not a
finding — and §7.1's pricing leans on it being *modest*.

---

## 3. Unit economics — the actual constraint

From `docs/test-series-design.md` §3.3 and §9.3, measured 2026-08-08/10 over all
138 `answer_eval_analysis` calls ever recorded:

**Cost per AI answer evaluation = $0.0584.**

That figure was computed with `lib/models.ts`'s encoded sonnet-5 pricing. The
encoded schedule is one tier high against Anthropic's real published pricing
(CLAUDE.md, 2026-07-23): real is $2/$10 intro through 2026-08-31 → $3/$15 from
2026-09-01, while `models.ts` encodes $3/$15 → $4/$20. The arithmetic
consequence is convenient and worth stating plainly:

- **Real cost today** (intro $2/$10) ≈ **$0.039**/evaluation.
- **Real cost from 2026-09-01** (standard $3/$15) ≈ **$0.0584**/evaluation —
  exactly the measured figure.

**Plan against $0.0584 (₹5.14).** It is the number that becomes true in
seventeen days, and pricing against the cheaper intro figure would under-price
the tier from launch.

| Product | Evaluations/student | AI cost/student |
|---|---:|---:|
| Prelims series (either exam, both exams) | 0 | **₹0** |
| UPPSC Mains series (22 papers × 20 Q) | 440 | **₹2,261** ($25.70) |
| UPSC Mains series (30 tests × 20 Q) | 600 | **₹3,084** ($35.04) |
| **Both Mains series** (exam-agnostic worst case) | 1,040 | **₹5,345** ($60.74) |

Two consequences that shape everything below:

1. **Prelims is free to serve and Mains is not.** Access gating per exam
   controls no cost, because the cost is per *evaluation*, not per *exam*. This
   is the core of the §4 decision.
2. **⚑ Pro's own worst case is already loss-making.** Pro allows 60
   evaluations/month = 720/year = **₹3,700** of AI cost against a **₹2,499**
   yearly price. Nobody comes close in practice (34 evaluations exist in the
   entire database, ever), so this is a ceiling problem rather than a live one —
   but Max must not inherit the same shape at a larger scale, and it is why the
   evaluation cap is the load-bearing lever in §7.

---

## 4. Decision 1 — Max is exam-agnostic

**Decided (product owner, 2026-08-14): one Max SKU, covering every exam that is
live for that user. No `exam_code` on `plans`. Cost is bounded by a single
shared evaluation pool, not by exam count.**

### 4.1 Why

- **The cost driver is evaluations, not access.** Prelims series costs ₹0 to
  serve for one exam or for both (§3). Gating *access* per exam would therefore
  add a whole schema dimension that controls none of the real cost, while a
  single evaluation cap bounds it exactly — regardless of how many exams the
  user touches.
- **It would charge twice for something almost nobody does — and collect almost
  nothing.** The first draft argued this from a "60–80% overlap, most aspirants
  sit both" claim that turned out to be folklore (§2.2). The measured version is
  *stronger for the same conclusion, by the opposite route*: **91% of our active
  users work exactly one exam** (§2.3), so a second SKU would sell to almost
  nobody while adding a schema dimension, a per-exam resolution path and a
  support burden for every user. The revenue it could capture is close to zero;
  the complexity is not.
- **It would put a paywall inside a free navigation control.** The exam switcher
  (Session 10) is deliberately one shared path used from both the top bar and
  Profile, and switching is free. Per-exam Max means a user on Max/uppsc who
  switches to upsc watches their series disappear — a confusing moment inside a
  control that today just switches.
- **It upholds M18 rather than reopening it.** `docs/multi-exam.md` §4 and
  `docs/OUTSTANDING.md` §7 record: *"One exam-agnostic price ladder, for now …
  do not add per-exam plans as a drive-by … reopen only with explicit
  discussion."* The explicit discussion happened here; the answer is to keep it
  exam-agnostic. M18 is confirmed.
- **It is the reversible direction.** Exam-agnostic → per-exam later is an
  additive migration. Per-exam → exam-agnostic later means migrating live
  subscriptions and refunding or grandfathering people who bought two. With
  three paid subscriptions on the platform, choosing the reversible option is
  close to free.

### 4.2 What was given up, honestly

- **Price discrimination between exams.** Institutes charge more for UPSC than
  for state PCS, and this forecloses that without an `exam_code` column later.
- **The worst case doubles — on paper.** A user who works through both Mains
  series costs **₹5,345** in evaluation, and this is the one risk the decision
  genuinely creates. **⚑ Superseded by §7.1:** the behaviour research puts that
  user close to hypothetical (91% work one exam), so the realistic ceiling is
  **₹2,261**. The cap still matters, but as insurance against ad-hoc abuse
  rather than against this scenario — and §7.1 shows a *monthly* cap does not
  bound an *annual* liability anyway.

### 4.3 Consequence for the cap

The evaluation cap must be sized against **concurrent** demand, not annual:

- UPPSC Mains: 440 evaluations over 11 weeks ≈ **160/month**.
- UPSC Mains: 600 over ~11 months with a Prelims pause ≈ **55/month**.
- Peak concurrent (both, worst case) ≈ **215/month**.

| `LIMITS.max.evaluations` | Monthly AI cost ceiling | Covers |
|---:|---:|---|
| 150/mo | ₹771 | one Mains series with rationing |
| **200/mo** | **₹1,028** | one full Mains series comfortably |
| 250/mo | ₹1,285 | both concurrently |

**200/month is the recommended starting cap.** It fits the exam-agnostic promise
for any realistic single-season user while bounding the monthly liability at
₹1,028 — a number every option in §7 clears.

---

## 5. Decision 2 — all test series sit behind Max

**Decided (product owner, 2026-08-14): both Prelims and Mains series are
Max-only. Pro keeps today's ad-hoc mocks.**

| Tier | Test series | Ad-hoc mocks | Evaluations |
|---|---|---|---|
| Free | — | — | 3 lifetime |
| Pro | — | ✅ (unchanged) | 60/month |
| **Max** | ✅ **Prelims + Mains, every live exam** | ✅ | §7 cap |

**No existing Pro user loses anything.** The series is new; `assertMockTests`
and today's on-demand mocks stay exactly as they are. This matters because the
alternative reading of "all series behind Max" — moving something Pro users
already have — would be a downgrade, and it is not what this does.

The trade accepted: it withholds the Prelims series, which costs ₹0 to serve, so
this is a deliberate choice to make Max the clear upgrade rather than to maximise
Prelims reach. `docs/test-series-design.md` Q3 recommended the opposite split
("Prelims inside Pro; Mains separate"); that recommendation is **overridden here
by explicit decision**, and Q3 should be marked as answered.

---

## 6. Schema and gating

### 6.1 The schema delta: one enum value

`supabase/migrations/0129_user_plan_max.sql`:

```sql
alter type user_plan add value if not exists 'max';
```

That is the whole change, because §4 removed the exam dimension:

- `plans.tier` is already `user_plan` — it accepts `'max'` the moment the enum does.
- `users_profile.plan` is already `user_plan` — same.
- No `exam_code` on `plans`, no denormalised copy on `subscriptions`, no
  resolution function, no backfill.

**Verified 2026-08-14** against the live DB inside a rolled-back transaction:
applies cleanly; **replays idempotently** (M14); its assertion is
negative-controlled (a deliberately wrong label makes it fire); live schema
untouched afterwards. Two further facts confirmed empirically rather than
assumed:

- `alter type ... add value` **does** run inside a transaction (PG 12+), but
  **using** the value in that same transaction fails with `unsafe use of new
  value "max" of enum type user_plan`. This is why the priced `plans` rows must
  land in a *separate later* migration, and why this file contains nothing that
  references `'max'` — matching the repo's own convention for 0040 and 0046.
- In Postgres `add value` appends, so `'max' > 'pro'` sorts correctly. **In
  JavaScript it does not: `"max" < "pro"` lexically.** Any TypeScript comparison
  of the form `plan >= "pro"` is silently wrong for the tier it means to admit.
  Tier comparison must go through an explicit rank map.

**The migration is provably inert.** Nothing can produce `'max'`: `billing.ts`
`activate()`/`renew()`, `trial.ts`, `admin-users.ts` and `handle_new_user()` all
write string literals (`'pro'`/`'free'`), and no `plans` row carries
`tier='max'`, so `createOrder` → `planByCode` (which filters `is_active = true`)
cannot mint an order for one either.

**Applied.** Both migrations are in the ledger: `0129` was applied by the
concurrent session when it renumbered the file to resolve a `0128` collision,
and `0130` was applied here after a dry run that proved it applies AND replays
idempotently (M14) inside a rolled-back transaction.

⚑ **A residual worth knowing:** `0129`/`0130` are in the remote ledger while the
files live only on the unmerged branch `feat/max-tier-design`. That is §0c's
blockage shape — a recorded version with no file on `main` — so **merge the
branch**; do not let it linger.

### 6.2 ⚑ Two entitlement bugs that fail silently

Both are latent today (nothing produces `'max'`) and both bite the instant the
tier is assigned. Predicates below are quoted verbatim from source and evaluated
for each plan value:

| `plan` | `assertPro` throws paywall (`entitlements.ts:277`) | lapsed row downgrades (`:108` + `.eq("plan","pro")` `:114`) |
|---|---|---|
| `free` | true | false |
| `pro` | false | **true** |
| **`max`** | **true** ⚑ | **false** ⚑ |

1. **A Max user is locked out of every Pro feature.** `assertPro` is
   `if (plan !== "pro") throw paywall(...)`, so handwritten OCR, micro-drills,
   mocks and magazine PDF all reject a Max user. Paying more would buy strictly
   less. Fix: `plan === "free"`, or a rank map.
2. **A lapsed Max never downgrades.** `getPlanFor`'s lazy downgrade is guarded
   `row.plan === "pro"` and its `UPDATE` carries `.eq("plan","pro")`. A Max
   subscription that ends keeps full access **forever**, with no error and no
   cron to catch it. This is a permanent revenue leak.

### 6.3 The series gate — where the plan check goes

> **⚑ Correction.** This document's first draft claimed the series "leaks the
> entire product" — that a Pro user is admitted to every series full-length and
> a Free user to every series sectional, because the only gate is
> `attempts.ts`'s `test.kind === "mock"` check. **That was wrong, and the way it
> went wrong is the reusable part:** it trusted `docs/test-series-design.md`'s
> then-current header, "DESIGN ONLY. No application code was written." That
> header was already false when it was read, and its owner corrected it later
> the same day (`e3da7a1`) to "⚑ PHASE 1 IS BUILT". The gate exists, it is
> correctly built, and it is wired into a second entry point the first draft did
> not even consider. The architectural recommendation survives; the status claim
> did not, and the phrase "measured, not predicted" was itself unmeasured —
> I checked the *predicates* and never checked whether a series existed.
>
> The lesson this repo keeps relearning, in a new costume: **a document's status
> header is a claim about the past.** Verify a feature's existence against the
> code, not against the doc that describes it.

**What actually exists** (`apps/api/src/services/test-series.ts:370`,
`assertSeriesAttemptAllowed`, at HEAD):

- It keys off `seriesEntryForTest(testId)` — the `test_series_entries` join,
  which carries `unique (test_id)` — and **never** `test.kind`. A test in no
  series returns immediately, so it is a no-op for every standalone mock,
  sectional and daily quiz. This is exactly the right discriminator, for exactly
  the right reason (`0127_test_series.sql:240` keeps series tests on the
  existing `'mock'`/`'sectional'` kinds so `v_test_leaderboard` keeps working).
- It is called from **both** start paths:
  `attempts.ts:220` (MCQ) and **`answer-sessions.ts:92`** (descriptive). The
  second matters more than the first for this tier: a **Mains** series paper is
  an answer-writing session, not an attempt, so it never passes through
  `startAttempt` at all — it is the expensive half of the product, and the first
  draft's analysis missed its entry point entirely.
- It enforces: the series' exam is the viewer's own; the series is `published`
  or the viewer is an admin; and `now() >= opens_at`, returning **423 Locked**
  rather than 403 so the client can render a countdown. There is deliberately
  **no `closes_at` check** — postponement is allowed indefinitely and a late
  attempt is simply unranked, which is the market's own published rule.

**What is missing, deliberately.** It consults **no plan at all**. That is not
an oversight — `test-series.ts`'s header says so outright: *"⚑ ACCESS IS
DELIBERATELY NARROW UNTIL PRICING IS DECIDED … turning the product on later is a
status change plus one entitlement call."* It names `docs/test-series-design.md`
Q3/Q10 as the blocking questions. **§4 and §5 of this document answer them.**

**Nothing leaks today.** Verified against the live DB, 2026-08-14: exactly two
series exist — `uppsc-prelims-2026` and `upsc-prelims-2027`, 32 entries between
them — and **both are `draft`**, so they are invisible to every non-admin. The
plan gap is real and must be closed before either is published; it is not a live
exposure.

**Where the plan check goes** — one call inside the existing gate, after its
access checks and before the window check, so a lapsed Max gets the paywall
rather than a countdown:

```ts
// test-series.ts, inside assertSeriesAttemptAllowed, after the exam/status checks:
await assertTestSeries(userId);          // new, in entitlements.ts

// entitlements.ts — new
export async function assertTestSeries(userId: string): Promise<void> {
  const { plan } = await getPlanFor(userId);
  if (plan !== "max") throw paywall("test_series", "…");
}
```

Placing it inside `assertSeriesAttemptAllowed` — rather than adding a second
call at each start path, as the first draft proposed — is what keeps the MCQ and
descriptive paths from drifting apart. That is the same "one path fixed, sibling
missed" failure the gate's own header cites as its reason for existing.

Two smaller notes for whoever implements it.

**The header names the insertion point `assertSeriesAccess`, but no such
function exists** — the real name is `assertSeriesAttemptAllowed`.

**⚑ And the two paths order the gate differently, which will matter once it
carries a plan check.** Verified 2026-08-14 against a clean working tree:

| Path | Resume short-circuit | Series gate | A lapsed Max mid-paper |
|---|---|---|---|
| `attempts.ts` (MCQ) | `findActiveAttempt` **:222** | **:220** | **blocked** — gate runs first |
| `answer-sessions.ts` (descriptive) | `findActiveSession` **:69–70** | **:92** | **can finish the paper** |

`attempts.ts` deliberately hoisted the gate above its resume; `answer-sessions.ts`
did not. Neither ordering is obviously wrong — letting someone finish a Mains
paper they had already started is arguably the kinder behaviour, and it is the
*expensive* one — but the two paths currently disagree, and a paid tier should
not inherit that by accident. Pick one and make both match.

### 6.4 Full follow-up checklist

Derived from a complete read of the billing surface; file:line as of 2026-08-14.

**Blocking — assigning `'max'` before these land is unsafe:**

| # | Site | Change |
|---|---|---|
| 1 | `entitlements.ts:277` | `plan !== "pro"` → `plan === "free"` / rank map (§6.2) |
| 2 | `entitlements.ts:108,112,114,116` | lazy downgrade must fire for `max` too (§6.2) |
| 3 | `billing.ts:222`, `:236` | literal `plan: "pro"` → `plan?.tier` (already in scope via `planByCode`) |
| 4 | `packages/shared/src/profile.ts:7` | `userPlanSchema` → add `"max"`. **Without this, activating a Max `plans` row throws in `plansResponseSchema.parse` and takes down the public `/pricing` page for everyone.** |
| 5 | `entitlements.ts:27–50` | `LIMITS.max` (§4.3) |
| 6 | `entitlements.ts` (new `assertTestSeries`) + one call inside `test-series.ts:370` `assertSeriesAttemptAllowed` | the series plan gate — **do not** add it at the two start paths separately (§6.3) |

**Non-blocking but wrong until fixed:** `entitlements.ts:160` (trial detection),
`:213/:235/:251` (quota branches), `:370` (`canReadFullNote`), `:380–395`
(`isPro` → per-tier matrix); `admin-users.ts:427/434`, `trial.ts:74`.

**Web (the follow-up UI session):** `pricing.tsx:46` (`isPro` **disables every
plan button at `:236`, so a Pro user cannot upgrade to Max**), `:178–179`
(hardcoded 4-column grid and 4 skeletons — a 5th plan reflows),
`ComparisonTable` `:259–299` (2-column `rows` array, 3-column `<thead>`),
`billing-copy.ts:72–73` (`free`/`pro` heads) and `:173` (`planPeriodLabel`),
`plan-banner.tsx:38`, `quota-chip.tsx:38`, `paywall-modal.tsx:58`,
`profile-card.tsx:93/98`, `landing.tsx:349–389` (hardcoded `["free","pro"]`
teaser + `Landing.plan_*` i18n keys), `paywall-store.ts:4–12/28–39` (add
`test_series` to `PaywallFeature` and `toPaywallFeature`, or the 402 falls back
to the generic paywall).

---

## 7. Price points — ✅ A CHOSEN (₹749/mo · ₹5,999/yr)

**Chosen: A, with BOTH cadences.** All three clear the ₹1,028/month
cost ceiling of a 200/month cap (§4.3). "Realistic annual burn" assumes ~3 heavy
Mains months at 160 evaluations plus 9 lighter months at ~30 ≈ 750/year ≈
**₹3,854** of AI cost.

| | **A — Accessible** | **B — Anchor** | **C — Premium** |
|---|---|---|---|
| Monthly | ₹749 | **₹999** | ₹1,499 |
| Yearly | ₹5,999 | **₹7,999** | ₹11,999 |
| × Pro yearly (₹2,499) | 2.4× | 3.2× | 4.8× |
| Margin at realistic annual burn | ₹2,145 (36%) | ₹4,145 (52%) | ₹8,145 (68%) |
| **Margin if bought monthly for 3 Mains months only** | **−₹220 (LOSS)** | +₹530 (18%) | +₹2,030 (45%) |
| vs institute Mains series (₹15–25k) | 24–40% of it | 32–53% | 48–80% |
| vs PW Pi (₹2,400/yr) | 2.5× | 3.3× | 5.0× |

**A — ₹749/mo · ₹5,999/yr.** The most defensible against a price-sensitive
Hindi-belt UPPSC audience and closest to the brief's instinct. **Its monthly
option is loss-making**: someone who subscribes for exactly the three Mains
months burns ~480 evaluations (₹2,467) against ₹2,247 of revenue. Only viable if
Max is annual-only, or if the cap drops to ~150/month.

**B — ₹999/mo · ₹7,999/yr — recommended anchor.** Clears cost in both the annual
and the adverse 3-month monthly case. 3.2× Pro is a large but explicable jump for
a tier that adds a product costing ₹2,261–3,084/student to serve. Sits at roughly
a third of an institute Mains series, which is the honest pitch.

**C — ₹1,499/mo · ₹11,999/yr.** Prices Max explicitly against institute Mains
series at about half. Best margin and the most defensive against adverse
selection. Risk: at 4.8× Pro it reads as a different product rather than an
upgrade, and with three paid subscribers there is no evidence anyone will cross
that gap.

### 7.1 Revised after the behaviour research (2026-08-14)

The table above prices against a "realistic annual burn" of 750 evaluations
(₹3,854). Two findings move that, in opposite directions, and one exposes a hole
in §4.3's cap.

**1. The worst case halves.** §4.2 flagged "a user works through both Mains
series" (₹5,345) as the risk the exam-agnostic decision creates. §2.2 and §2.3
say that user is close to hypothetical: 91% of our active users work exactly one
exam, and five of seven switchers only ever worked one. **The realistic ceiling
is one exam's series — ₹2,261, not ₹5,345.** That makes exam-agnostic Max nearly
free to offer, so §4's decision gets *stronger*, not weaker.

**2. Expected cost is far below the basis I used.** Nobody on the platform has
ever reached 25 tests or more than 5 evaluations. Against 750, plausible
expected consumption is an order of magnitude lower. **But** §2.3's caveats bite:
no series exists to consume, and Max buyers self-select for commitment. Do not
bank a specific low number — bank the *direction*.

**3. ⚑ A MONTHLY cap does not bound an ANNUAL subscription.** §4.3 recommended
200 evaluations/month as the tail insurance. Over twelve months that is 2,400
evaluations = **₹12,336 — more than every price point in the table, including
option C.** As insurance against the annual liability, it does not bind.

What actually bounds series cost is **the series' own finite size**: a UPPSC
Mains series is 440 evaluations and there is no 441st. So the honest picture is:

| Cost source | Bounded by | Worst case |
|---|---|---|
| Series papers | the content itself | **₹2,261** (one exam) |
| Ad-hoc answers outside the series | the monthly cap | ₹5.14 × cap × 12 |

If you want a hard annual ceiling, the cap should be an **annual allowance**
(e.g. 600/year ≈ ₹3,084) rather than a monthly one — which also matches how a
series is actually consumed, in a seasonal burst rather than evenly.

**What this does to the recommendation.** With the series self-bounding and the
worst case halved, **cost stops being the binding constraint** — every option
clears it comfortably on expected consumption. That makes this a **positioning
and conversion decision, not a unit-economics one**, which is the opposite of
what §7's table implies. On positioning: **B (₹999/mo · ₹7,999/yr) remains the
anchor**, but **A (₹749/mo · ₹5,999/yr) is now defensible** — its only
disqualifier was the loss-making 3-month monthly burn, and that scenario needs a
user consuming a full series in three months, which nothing in our data or the
market research suggests exists. Ship A annual-only and the objection disappears
entirely.

### ⚑ The structural recommendation matters more than the number

**Cost is seasonal and concentrated; monthly revenue is not.** A Mains series
burns ~160 evaluations/month for ~3 months and near-zero for the other nine, so a
monthly Max is exposed to a user who subscribes for exactly the expensive window.
Whatever number is chosen, pick one of:

1. **Annual-only Max** (cleanest — matches how institutes sell a season), or
2. **Annual-first**, with a monthly option priced to survive a 3-month burn
   (option B or C, not A), or
3. A **per-series evaluation allowance** instead of a monthly one, so the cost is
   bounded by the product rather than by the calendar.

### Open, deliberately not decided here

- The number itself, and which of the three structures above.
- Whether the 60/month **Pro** evaluation cap should move, given §3's finding
  that Pro's own ceiling is loss-making.
- `docs/test-series-design.md` **Q4** (Mains evaluation economics — its options 2
  and 3, partial evaluation and self-assessment-by-default, would each cut the
  Mains cost ~4× and change every number in this table) and **Q10** (whether GS
  and CSAT are separate products — under §5 they are both simply inside Max).

---

## 8. What shipped

| Layer | Change |
|---|---|
| Schema | `0129` enum value · `0130` priced rows (`max_monthly` ₹749, `max_yearly` ₹5,999), both applied |
| Shared | `userPlanSchema` +`max` (with the ordering warning) · `quotaSchema.period` +`year` · `features.test_series` · `paidTierSchema` |
| Entitlements | `LIMITS.max` (dual cap) · `planRank`/`planAtLeast` · `assertPro` fixed · lazy downgrade fixed · `assertTestSeries` · year-period quota |
| Billing | webhook `activate`/`renew` write `plan.tier`, not the literal `'pro'` |
| Series | `assertSeriesAttemptAllowed` now calls the entitlement (admins bypass) |
| Web | pricing grouped by tier + upgrade path unblocked · 4-column comparison · Max paywall variant · plan banner / quota chip / profile chip · admin grant/revoke Max |

**Verified live, 18/18**, against a real published throwaway series with an open
entry — including the case that matters most, **a Pro user rejected with 402
`test_series` at the real gate**, and a non-series test confirmed untouched.
Also confirmed: a lapsed Max downgrades durably, Max passes every Pro gate, and
the entitlements snapshot reports `test_series` true for Max and false for Pro.
Every throwaway row deleted by captured id; 0 stray users, 179 profiles
unchanged, all 4 real series still `draft`.

### Still open

- **The series is still `draft`.** Publishing one is the remaining step to put
  the tier in front of users — a status change, now that the entitlement exists.
- **Landing-page teaser** (`landing.tsx`) still hardcodes a two-card
  `["free","pro"]` split and does not mention Max.
- **`docs/test-series-design.md` Q3/Q10** should be marked answered by §4/§5.
- Whether the 60/month **Pro** evaluation cap should move, given §3's finding
  that Pro's own ceiling is loss-making.
