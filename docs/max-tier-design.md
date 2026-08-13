# Max tier — research, exam-interaction decision, and schema

**Status: DESIGN + SCHEMA. No price is chosen and no price is live.** This
session commits one migration (`0128_user_plan_max.sql`, provably inert) and
this document. Billing UI, the entitlement code changes (§6) and the priced
`plans` rows are a follow-up, gated on a price being signed off (§7).

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
6. **⚑ The naive gate leaks the entire product.** Series tests reuse
   `test_kind` `'mock'` and `'sectional'`, so today a **Pro user is admitted to
   every series full-length** and **a Free user is admitted to every series
   sectional**. The gate must key off the `test_series_entries` join, never
   `test.kind`. Measured, not predicted. §6.3.
7. **⚑ Two entitlement bugs fail silently the moment `plan='max'` exists**, and
   one is a permanent revenue leak. §6.2.
8. **Three price points in §7.** None is recommended for auto-adoption; the
   structural recommendation (annual-first) matters more than the number.

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

### 2.2 The dual-exam finding

Relevant to §4: the UPSC and state-PCS syllabi overlap **60–80%**, and the
consensus of the coaching market is that *most serious aspirants sit both*, with
state-PCS adding only 10–15% extra preparation on top of a UPSC base.
([sleepyclasses](https://sleepyclasses.com/upsc-and-state-pcs-preparation/),
[riceias](https://riceias.com/difference-between-state-pcs-and-upsc-cse-complete-comparison-guide/))

The two exams' calendars are complementary rather than competing — UPPSC Prelims
Dec 2026, UPSC Prelims May 2027, UPPSC Mains ~Mar 2027, UPSC Mains Aug 2027
(`docs/test-series-design.md` §13). Preparing for both is a normal pattern, not
an edge case.

**Our own numbers do not yet show this, and that is expected**, not a
counter-argument: `upsc` went live 2026-08-11, three days before this
measurement.

| Measure (live DB, 2026-08-14) | Value |
|---|---|
| Profiles | **179** (172 `uppsc`, 7 `upsc`) |
| Users who have ever switched exam | **7** |
| Currently `plan='pro'` | 76 (almost all trial) |
| **Subscriptions that have ever been paid** | **3** |
| Evaluations ever recorded | 34 (0 on `upsc`) |

**⚑ This is a pre-revenue pricing decision.** With three paid subscriptions
there is no revenue data to price against, and no elasticity to measure. Every
number in §7 is a reasoned starting point to be corrected by real conversion
data, not a finding.

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
- **It taxes the normal case.** 60–80% syllabus overlap and most serious
  aspirants sit both (§2.2). A per-exam SKU charges twice for the behaviour the
  market treats as standard.
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
- **The worst case doubles.** A user who works through both Mains series costs
  **₹5,345** in evaluation. This is *the* risk this decision creates, and it is
  the reason §7's evaluation cap is not optional — it is the only thing standing
  between an exam-agnostic Max and an unbounded liability.

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

`supabase/migrations/0128_user_plan_max.sql`:

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

**Not applied to the cloud DB in this session, deliberately.** An untracked
`0127_test_series.sql` from a concurrent session is in the working tree and not
yet applied; pushing `0128` ahead of it risks the ledger-ordering blockage this
repo has already suffered once (`docs/OUTSTANDING.md` §0c / M10). Apply it with
`supabase db push` once 0127 lands, or in the follow-up session.

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

### 6.3 ⚑ The gate must not key off `test_kind`

`docs/test-series-design.md` D-3 and `0127_test_series.sql:240` both confirm
series tests **reuse** `test_kind` `'mock'` and `'sectional'` (adding a new value
would silently break `v_test_leaderboard`). The only gate on starting a test is
`apps/api/src/services/attempts.ts:229`:

```ts
if (test.kind === "mock") await assertMockTests(userId);   // → assertPro
```

So with the §5 decision and no further change:

| Series entry | `tests.kind` | Gate hit today | Result |
|---|---|---|---|
| Full-length | `mock` | `assertMockTests` → `assertPro` | **a Pro user is ADMITTED** ⚑ |
| Sectional | `sectional` | **none** | **a Free user is ADMITTED** ⚑ |

**The entire product leaks under the naive implementation.** The discriminator
must be *"is this test an entry in a published series"* — the
`test_series_entries` join, which has `unique (test_id)` — never `test.kind`.

Required shape (follow-up session):

```ts
// entitlements.ts — new
export async function assertTestSeries(userId: string): Promise<void> {
  const { plan } = await getPlanFor(userId);
  if (plan !== "max") throw paywall("test_series", "…");
}

// attempts.ts — after the existing exam-scope check, BEFORE the resume
// short-circuit at :217, so a lapsed Max cannot resume into a series paper.
if (await isSeriesTest(test.id)) await assertTestSeries(userId);
```

Note the ordering: `startAttempt`'s resume short-circuit (`:217–219`) currently
runs *before* the mock gate, so an already-started attempt bypasses it. That is
tolerable for an ad-hoc mock and is not tolerable for the series.

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
| 6 | `entitlements.ts` + `attempts.ts:229` | `assertTestSeries` + `isSeriesTest` (§6.3) |

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

## 7. Price points — for sign-off, not for adoption

**No number is chosen. Nothing here is live.** All three clear the ₹1,028/month
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

## 8. What this session changed

- `supabase/migrations/0128_user_plan_max.sql` — the enum value, with its
  assertion. Verified apply + replay + negative control; **not applied to the
  cloud DB** (§6.1).
- This document.

Nothing else. No code, no prices, no `plans` rows, no `plan='max'` on any user.
