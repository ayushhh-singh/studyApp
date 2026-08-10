# Scheduled Test Series — design

**Status:** DESIGN ONLY. No application code was written in the sessions that
produced this document. Every platform number was measured against the live
cloud DB on **2026-08-08 / 2026-08-10** and is dated; every market figure is
taken from an institute's own published schedule and is sourced.

**Scope:** the full, uncut coaching-institute pattern, for **both exams** —
UPPSC (live) and UPSC (content ingested, `is_live=false`) — across **Prelims GS,
Prelims CSAT and Mains**.

> ### ⚑ Correction to the first draft of this document
> The 2026-08-08 draft recommended cutting the series to 12–15 tests because
> `PRE_GS1` had "1,021 visible MCQs = 6 non-overlapping papers". **That figure
> was wrong.** It counted only `paper_code='PRE_GS1'` and ignored the **1,140
> current-affairs questions already mapped onto PRE_GS1 syllabus nodes**, which
> are servable in a test through the existing `questionVisibilityOrFilter("test")`
> scope. Real usable supply for UPPSC GS-I is **2,143**, i.e. **~14**
> non-overlapping 150-question papers. The recommendation to shrink the series
> is **withdrawn**; §6 now shows the full pattern is supportable. Getting this
> wrong is exactly the "an unscoped count silently lies" class this repo keeps
> hitting — the fix is to count by *syllabus node*, not by paper code.

---

## 1. Executive summary

1. **The full pattern is supportable today for UPPSC.** A 25-test Prelims series
   and a 22-paper Mains series both fit inside the existing bank with no
   generation programme. §6.
2. **UPSC Prelims fits too, with one real gap: current affairs.** 1,057 GS
   questions carry the series, but only **2** CA questions are approved for
   `upsc` — and every real series puts CA in *every* test. §6.3.
3. **"Goes live at 14:00 IST" needs almost no scheduling infrastructure.**
   Opening a test is a read-time predicate, not a job. §7.
4. **Prelims is ~free to serve; Mains is not.** Measured **$0.0584/evaluation**
   → a 22-paper UPPSC Mains series is **~$25.7/student** against a ~$28 annual
   plan. Supply is fine; the economics are the blocker. §9.3.
5. **Adding a `test_kind` value for series tests would silently break ranking.**
   §5.3.

---

## 2. Reference patterns — what institutes actually publish

Three real schedules were obtained as the institutes' own PDFs and read in full,
plus two more from product pages. They are not variations on one shape; they are
**three distinct market models**, and picking one is a product decision (Q2).

### 2.1 Model A — the "spiral" (Vision IAS, UPSC)

The premium shape: the syllabus is covered **three times at increasing depth**.

**GS Prelims 2026 — 35 tests = 8 Fundamental + 17 Applied + 10 Full-Length, ₹16,000.**
Fundamental pass, one subject per test, **exactly 21 days apart**, each with a
rolling current-affairs month appended:

| # | Date | Subject | + CA |
|---|---|---|---|
| 1 | 2 Feb 2025 | Indian Polity & Constitution | Jan 2025 |
| 2 | 23 Feb | Working of Indian Constitution | Jan 2025 |
| 3 | 16 Mar | Geography I — Physical (World + India) | Feb 2025 |
| 4 | 6 Apr | Geography II — Economic & Human (World + India) | Feb 2025 |
| 5 | 27 Apr | Ancient + Medieval History, Art & Culture | Mar 2025 |
| 6 | 18 May | Modern India | Mar–Apr 2025 |
| 7 | 8 Jun | Indian Economy | Apr 2025 |
| 8 | — | (Environment / Science & Tech) | — |

The **Applied** pass re-runs the *same* subjects at greater depth — Test 10 is
"Working of Indian Constitution" again, Test 12 is "Ancient/Medieval + Art &
Culture" again — with a **wider CA window** (Test 10: Mar–Apr; Test 11: May–Jun)
and a visibly richer source list (2nd ARC reports, Yojana, PIB, EPW, magazines
on top of the NCERTs). New topics that have no Fundamental test of their own
(Governance, Environment, S&T) enter here. Then 10 Full-Length papers.

**CSAT Prelims 2026 — 25 tests = 15 Sectional + 10 Full-Length, ₹9,000.**
The cleanest schedule of the three, and the one that maps most directly onto a
syllabus tree:

| # | Section | Topics |
|---|---|---|
| 1–8 | Maths, DI **and RC** | Percentage → Profit/Loss/Discount → SI/CI → Ratio/Mixtures → Average → Speed & Distance → Number System, LCM/HCF → Time & Work → Set Theory → Age → P&C → Probability → Geometry → Mensuration → Algebra; then "Maths Complete Syllabus" ×2. A DI form is attached to each (Line Chart, Bar Graph, Pie Chart, Data Table, Misc.) |
| 9–15 | Reasoning **and RC** | Series → Coding-Decoding → Puzzles (Order/Ranking) → Syllogism → Venn → Inequality → Arrangement → Direction → Blood Relation → Counting Figures → Calendar → Clock → Non-Verbal → Cubes → Dice → Arithmetical Reasoning; then "Reasoning Complete Syllabus" ×2 |
| 16–25 | **Full length** | All sections |

Two structural details worth copying: **RC appears in every single test** (it is
a continuous skill, never a discrete sectional), and each maths sectional
**carries one DI chart form**, so DI is taught by rotation rather than in a
single block.

**Mains 2026 — 30 tests = 8 Fundamental + 14 Advanced + 8 Full-Length**, every
paper 250 marks / 3 hours, **fortnightly**:

| # | Level | Coverage |
|---|---|---|
| 1–8 | Fundamental | GS-II Polity · GS-I Geography · GS-I History (Art&Culture/Modern/World) · GS-III Economics 1 · GS-III Economics 2 · GS-III Environment & Disaster Mgmt · GS-II&I Governance/Social Justice/Society · GS-IV Ethics |
| 9–22 | Advanced | Polity & Governance Pt1 · Pt2 · Art&Culture + World History · Modern + Post-Independence · Physical Geography + Disaster Mgmt · Human Geography + Environment · Economics Pt1 · Ethics Pt1 · Economics Pt2 · Society & Social Justice · Ethics Pt2 · International Relations · Security · Technology |
| 23–30 | Full-Length | **Two complete cycles** of GS-I, II, III, IV |

⚑ **The Mains calendar has a Prelims-shaped hole in it.** Test 22 is 23 Mar 2025
and Test 23 is 15 Jun 2025 — a ~12-week gap, because the Prelims exam sits in
between. Any Mains calendar generator must model this, or it will schedule
papers into the weeks when no Mains aspirant is writing Mains.

### 2.2 Model B — the "compact" (Target PCS, UPPSC)

The dominant UPPSC-market shape and the closest analogue for this platform's
live exam.

- **Prelims — 25 papers**: 10 sectional GS + 11 full-length (10 GS-I + 1 CSAT) +
  4 current-affairs papers, 150 questions each, **₹2,100**.
- **Mains — 22 papers**: **6 sectional GS + 12 full-length GS + 2 Essay + 2
  Hindi**, 20 questions each. The 12 full-length GS = **two complete cycles of
  the six UPPSC GS papers**, exactly mirroring Vision IAS's two cycles of four.
  UP-specific content for GS-V and GS-VI is supplied as separate booklets.

Both are advertised **"Schedule is Flexible: Attempt as per your preparation."**

### 2.3 Model C — the "micro-drill" (Chahal, UPPSC)

The volume shape, included because it is a genuinely different product and the
one a bank-rich platform is *best* placed to serve:

**190 tests** = 170 sectional (50 Q, 1 hr) + 5 full-length GS + 5 CSAT + 5 CA +
5 UP-specific (100 Q, 2 hrs). One-third negative marking. Its sectional
allocation is itself a weightage statement:

| Subject | Tests | Subject | Tests |
|---|---:|---|---:|
| Indian Geography | 25 | Modern History | 19 |
| Indian Polity | 30 | World Geography | 16 |
| Ancient History | 15 | Indian Economy | 15 |
| General Science (Bio) | 14 | Environment & Ecology | 12 |
| General Science (Phy) | 10 | General Science (Chem) | 8 |
| Medieval History | 6 | UP-specific | 5 |

### 2.4 The rules every model shares

| Rule | Evidence |
|---|---|
| **Postponement yes, preponement NO** | Vision IAS, verbatim: "Flexibility in test scheduling to accommodate student preferences, **allowing for test postponement but not preponement**." This is the precise real rule — better than the binary "locked/open" my first draft proposed. |
| **One attempt only** | "Any Prelims Mock Test can be attempted only once irrespective of the mode of the test taken." |
| **Current affairs in EVERY test** | Every Vision IAS Prelims *and* Mains test row ends "+ Current Affairs (month)". CA is a slice of every paper, not only a separate paper. |
| **Cadence compresses toward the exam** | CSAT: 14 days for tests 1–15, then weekly from Mar 1. Mains: 14 days throughout the teaching phase, weekly for the full-length block. Prelims Fundamental: 21 days. |
| **A published calendar with per-test syllabus + sources** | Every schedule gives a *Topics covered* list and a *Sources covered* list per test. The calendar is a study plan, not just dates. |
| **Both online and offline centre modes** | All three. Out of scope here (v2). |
| **All India Rank is the headline feature** | "Innovative Assessment System and Performance Analysis with All India Rankings for comparative analysis." |

**Sources:**
[Vision IAS GS Prelims 2026 schedule (PDF)](https://www.visionias.in/old/schedule_if.php?id=2846&exam=Prelims) ·
[Vision IAS CSAT 2026 schedule (PDF)](https://visionias.in/old/schedule_if.php?id=3292&exam=Prelims) ·
[Vision IAS GS Mains schedule (PDF)](https://www.visionias.in/old/schedule_if.php?id=2077&exam=Mains) ·
[Target PCS — UPPCS Prelims](https://targetpcslucknow.com/uppcs-prelims-test-series/) ·
[Target PCS — UPPSC Mains](https://targetpcslucknow.com/uppsc-uppcs-mains-test-series/) ·
[Chahal — UPPSC Test Series](https://chahalacademy.com/uppsc-test-series) ·
[GS SCORE All-India Open Mock](https://iasscore.in/all-india-prelims-open-mock-test) ·
[Vajiram & Ravi](https://vajiramandravi.com/all-courses/upsc-prelims-test-series/)

---

## 3. Measured baseline

### 3.1 Prelims supply **by syllabus section** (the number that matters)

Visible = `is_published AND review_state='approved'`. "CA" = questions on the
synthetic `CURRENT_AFFAIRS` paper that are **mapped to that section's syllabus
subtree** and are servable in a test. Measured 2026-08-10.

**UPPSC `PRE_GS1` — 1,003 GS + 1,140 CA = 2,143 usable**

| Section | GS | CA | total | 50Q sectionals | share |
|---|---:|---:|---:|---:|---:|
| Indian Polity and Governance | 172 | 412 | **584** | 11 | 27% |
| Economic and Social Development | 144 | 216 | **360** | 7 | 17% |
| Indian and World Geography | 151 | 118 | **269** | 5 | 13% |
| Current Events (Nat'l & Int'l) | 138 | 116 | **254** | 5 | 12% |
| General Science | 127 | 121 | **248** | 4 | 12% |
| Environmental Ecology, Bio-diversity | 114 | 116 | **230** | 4 | 11% |
| History of India and INM | 157 | 41 | **198** | 3 | 9% |

**UPSC `UPSC_PRE_GS1` — 1,057 GS + 2 CA**

| Section | GS | CA | 50Q sectionals |
|---|---:|---:|---:|
| Indian Polity and Governance | 203 | 1 | 4 |
| Economic and Social Development | 185 | 0 | 3 |
| History of India and INM | 175 | 0 | 3 |
| General Science | 144 | 0 | 2 |
| Environmental Ecology, Bio-diversity | 132 | 0 | 2 |
| Current Events | 116 | 0 | 2 |
| Indian and World Geography | 102 | 1 | 2 |

**CSAT** — UPPSC 870 mapped (Interpersonal 157, Reasoning 154, Decision Making
148, English Comp 113, Comprehension 112, Basic Numeracy 115, GMA 71);
UPSC 878 (Basic Numeracy & DI 292, Logical Reasoning 258, Comprehension 246,
GMA 30, Interpersonal 19, Decision Making 33).

Unmapped (`syllabus_node_id is null`, usable in a full-length but not in a
sectional): PRE_GS1 18 · PRE_CSAT 20 · UPSC_PRE_GS1 32 · UPSC_PRE_CSAT 19.

### 3.2 Mains supply (descriptive, visible)

UPPSC: GS2 198 · GS3 177 · GS1 161 · GS4 159 · GS5 128 · GS6 99 · Essay 108 ·
General Hindi 168. UPSC: GS1/GS2/GS3 200 each · GS4 131 · Essay 80.

### 3.3 Existing tests, scale, cost

`uppsc`: 76 `pyq_full`, 68 `sectional`, 58 `mock` (6 per paper — the
`MOCK_MAX_SETS` ceiling), 48 `daily_quiz`, 55 `custom`. `upsc`: **2 `daily_quiz`
and nothing else** (`OUTSTANDING.md` U8u). 165 profiles · 125 attempts ·
**1 push subscription** · 1,027 questions in the `needs_review` backlog.

**Cost per AI evaluation = $0.0584**, measured over all 138
`answer_eval_analysis` calls ever recorded. Two caveats: `lib/models.ts` encodes
sonnet-5 one pricing tier high, so the figure runs ~1.5× high **today** and
becomes accurate from 2026-09-01 (D4); and the `answer_eval_model` component
($0.0107) is cached per `(question, locale, rubric_version)`, so in a shared
cohort paper it is paid **once for everyone** — marginal cost for student N>1 is
**~$0.0477**. Prelims costs **zero** LLM calls to serve.

---

## 4. The five decisions that drive everything

| # | Decision | Rationale |
|---|---|---|
| D-1 | **A series is a scheduling and packaging layer over existing `tests` rows.** | `tests` + `test_questions` + `attempts` + `answer_test_sessions` + `v_test_leaderboard` already work, exam-scoped and RLS'd. A parallel test model forks the attempt engine. |
| D-2 | **"Attemptable" and "ranked" are separate predicates, both derived from timestamps.** | Gives the market's postpone-yes/prepone-no rule (§2.4) from one mechanism, and makes policy a data change not a code change. |
| D-3 | **Series tests reuse `test_kind` `mock` and `sectional`.** | `v_test_leaderboard` filters exactly those two. §5.3. |
| D-4 | **Opening a test fires no job.** | §7. |
| D-5 | **Prelims ships first, alone, and complete — for both exams.** | LLM-free to serve, supply-feasible now, blocked on no open quality gate. Mains is blocked on G1, G3 and economics (§10). |

---

## 5. Data model

Three new tables. No change to `tests`, `attempts`, `attempt_answers` or
`answer_test_sessions`.

### 5.1 `test_series`

```
id            uuid pk
exam_code     text not null references exams(exam_code)
stage         text not null check (stage in ('prelims','mains'))
paper_scope   text                        -- 'PRE_GS1' | 'PRE_CSAT' | null (mains = all papers)
slug          text not null unique        -- idempotency key, matches tests.slug convention
title_i18n    jsonb not null              -- bilingual publish gate
description_i18n jsonb
status        text not null default 'draft' check (status in ('draft','published','archived'))
starts_on     date not null
ends_on       date not null
target_exam_year int
meta          jsonb not null default '{}'
```

`exam_code` is required, not derived: a series can contain a test whose
`paper_code` is the synthetic `CURRENT_AFFAIRS`, which resolves to no tree.
`paper_scope` exists because the market ships GS and CSAT as **separate
products at separate prices** (₹16,000 vs ₹9,000).

### 5.2 `test_series_entries`

```
id              uuid pk
series_id       uuid not null references test_series(id) on delete cascade
test_id         uuid not null references tests(id) on delete restrict
sequence_no     int  not null
entry_kind      text not null check (entry_kind in
                  ('fundamental','applied','sectional','full_length',
                   'current_affairs','state_special'))
opens_at        timestamptz not null
closes_at       timestamptz                 -- null = never closes
ranked_until    timestamptz                 -- null = never ranked; normally = closes_at
syllabus_note_i18n jsonb                    -- the "Topics covered" column
sources_i18n    jsonb                       -- the "Sources covered" column
ca_window       daterange                   -- the "+ Current Affairs (Mar-Apr 2025)" column
meta            jsonb not null default '{}'
unique (series_id, sequence_no)
unique (test_id)
```

`syllabus_note_i18n`, `sources_i18n` and `ca_window` exist because **every real
schedule publishes all three per test** (§2.4) — they are the product, not
decoration. `ca_window` also drives selection (§6.2).

⚑ **Do not reuse `tests.scheduled_date`** — it is a `date` with no time of day
and its partial unique index is `kind='daily_quiz'`-scoped (`0098`, `0106` §8).

⚑ **`ranked_until` must be treated as immutable once passed** — the board
derives ranked-ness by comparison rather than storing it, so editing it
retroactively re-ranks history. Enforce in the admin write path, not by a
trigger (a `now()` trigger would make the row unrestorable from a backup).

### 5.3 Why not a new `test_kind`

`v_test_leaderboard` (`0067`) is `where t.kind in ('mock','sectional')`. Adding
`'series'` would produce series tests with **no rank, no error and no failing
test**. Full-length entries are `kind='mock'`, everything else `'sectional'`;
"is this part of a series" is answered by the `test_series_entries` join.

### 5.4 `test_series_enrollments`

```
id, user_id, series_id, enrolled_at, status ('active'|'withdrawn')
unique (user_id, series_id)
```

Needed only to know whom to notify and to scope the ranked cohort. Owner-only
RLS, the `0053` shape.

### 5.5 Per-user state — **no new table**

| State | Derivation |
|---|---|
| Locked | `now() < entry.opens_at` |
| Not started | no `attempts` / `answer_test_sessions` row for `(user, test_id)` |
| In progress | existing row, `submitted_at is null` (uniquely indexed — `0025`, `0064`) |
| Ranked | first submitted attempt **and** `submitted_at <= ranked_until` |
| Late / practice | submitted after `ranked_until` |

The one new artefact is a window-aware leaderboard:

```sql
-- in v_test_leaderboard's `qualifying` CTE:
left join test_series_entries e on e.test_id = a.test_id
where ...
  and (e.id is null or e.ranked_until is null or a.submitted_at <= e.ranked_until)
```

`left join` so every standalone mock behaves exactly as today. Must be verified
byte-identical for existing boards before shipping.

---

## 6. Question sourcing — the full pattern, no cuts

### 6.1 Mapping the real breakdown onto our tree

The measured result of §3.1 is that **our depth-1 syllabus sections already
*are* the institutes' sectional subjects.** UPPSC `PRE_GS1`'s seven sections are
History / Geography / Polity / Economy & Social Dev / Environment / General
Science / Current Events — which is Vision IAS's Fundamental list and Target
PCS's sectional list. The only structural difference is that real series **split
an oversized section into two tests**, exactly where our subtree is deepest:

| Real series test | Our node |
|---|---|
| Indian Polity & Constitution | `PRE_GS1` → Indian Polity and Governance (depth-2: Constitution) |
| Working of Indian Constitution | same depth-1, different depth-2 children |
| Geography I — Physical | Indian and World Geography → Physical Geography |
| Geography II — Economic & Human | same depth-1 → Economic/Human children |
| Ancient + Medieval + Art & Culture | History of India and INM → Ancient / Medieval |
| Modern India | History of India and INM → Modern |

**Rule: a sectional entry targets one depth-1 node, or a named set of depth-2
children when the depth-1 node carries more than ~2 tests' worth of supply.**
`resolveSubtreeNodeIds` and `loadNodeWeightage` already do exactly this work for
`mocks.ts`; the series builder reuses them rather than re-implementing.

### 6.2 The mix per entry kind

| Entry kind | Size | PYQ | CA | qgen | Notes |
|---|---|---:|---:|---:|---|
| **Fundamental / sectional** | 50–75 Q | 60% | 10% | 30% | Practice, not competition — PYQ-heavy is pedagogically right and repeat exposure is acceptable. CA slice comes from the entry's own `ca_window`. |
| **Applied (2nd pass)** | 75–100 Q | 40% | 25% | 35% | The real Applied tests widen the CA window and deepen sources. Freshness matters more than in the Fundamental pass because the student has already seen that subject's test. |
| **Full-length** | 150 Q (UPPSC) / 100 Q (UPSC) | ≤30% | 20% | ≥50% | The rank is the product; if half the paper is already-seen questions the rank measures memory of our own bank. |
| **Current-affairs paper** | 100–150 Q | 0% | 100% | 0% | Target PCS ships 4 of these; UPPSC has 1,140 approved CA questions. |
| **State-special (UPPSC only)** | 100 Q | UP-tagged PYQ + `state_focus` CA | | | Chahal ships 5. Maps to `MAINS_GS5/GS6` themes at Prelims level and to `current_affairs_items.state_focus` (migration `0116`). |
| **Mains sectional / full-length** | 20 Q | **80–100%** | 0% | **0–20%** | §6.5 — descriptive generation is not cleared. |

Every selection goes through `questionVisibilityOrFilter("test")`, and
"unseen by this user" is computed from the user's own `attempt_answers` — the
idea `recentlyUsedInDailyQuiz` already implements.

### 6.3 Feasibility of the FULL pattern — verdict per product

**UPPSC Prelims GS, Target PCS shape (25 papers: 10 sectional + 10 GS
full-length + 4 CA + 1 CSAT): ✅ FEASIBLE NOW.**
Full-lengths need 10 × 150 = 1,500 against **2,143** usable; sectionals need
10 × 50 = 500 drawn per-section, and every section supports at least 3
(History, the thinnest, has 198). Total demand ≈ 2,000 against 2,143 — tight but
real, with sectional/full-length overlap deliberately allowed (a sectional is
practice; only the full-lengths need freshness).

**UPPSC Prelims, Vision IAS 35-test spiral: ⚠️ FEASIBLE WITH REUSE.**
8 Fundamental + 17 Applied + 10 Full-Length ≈ 8×60 + 17×90 + 10×150 = **3,510
slots** against 2,143. The spiral *intends* re-exposure between the Fundamental
and Applied passes, so this is not automatically wrong — but the 10 full-lengths
must stay disjoint from each other, and that alone is 1,500 of the 2,143.

**UPPSC Mains, 22 papers (6 sectional + 12 full-length + 2 Essay + 2 Hindi):
✅ FULLY FEASIBLE from PYQs alone.** 12 full-length = two cycles × six GS papers
× 20 Q = 40 Q per paper; the thinnest paper, GS6, has **99**. Essay needs ~6
topics against 108; Hindi 2 papers against 168. **Supply is not the Mains
blocker — economics is (§9.3).**

**UPSC Prelims GS, 35-test spiral: ⚠️ ONE REAL GAP — current affairs.**
1,057 GS questions carry the sectionals and 10 × 100 = 1,000 of full-length. But
**only 2 CA questions are approved for `upsc`**, and every real test in every
model carries a CA slice. `OUTSTANDING.md` **U8v** records 3 `upsc` CA MCQs, all
`needs_review`. This is an **editorial** unblock (approve CA MCQs in the Review
Queue), not a build task — and it must be scheduled before a UPSC series ships.

**UPSC Mains, 30 tests: ✅ FEASIBLE from PYQs.** Per the real schedule, GS-IV
appears in 5 tests = 100 Q against 131 available; GS-I/II/III have 200 each.

**CSAT (both exams): ⚠️ FEASIBLE for full-lengths, THIN for a 15-sectional
maths ladder.** UPPSC has 870 and UPSC 878 — 8–10 full-lengths each. But Vision
IAS's CSAT ladder wants ~8 *maths* sectionals drilled by topic
(percentage/ratio/time-work/…), and UPPSC `Basic Numeracy` has **115** in total.
UPSC is better placed (`Basic Numeracy and DI` 292). Either run fewer, broader
CSAT sectionals for UPPSC, or generate — CSAT is the one place where qgen has a
**measured, partial clearance** (§6.4).

**Net: the founder's instruction holds. Nothing needs to be cut except a
UPPSC CSAT maths ladder, and one editorial action unblocks UPSC.**

### 6.4 qgen — a dependency, sized honestly

Stated explicitly because §6.2's full-length mix leans on it:

- **Volume is gated on human review, not generation.** Every generated question
  is `needs_review` until a person approves it; the backlog is **1,027**. Nothing
  in this repo budgets reviewer throughput (Q9).
- **MCQ generation has a partial, measured clearance.** The 2026-08-08 panel
  confirmed `ac150dc`'s format fix real (`statement_counting` 20.7% → 0%), but it
  was **CSAT-only and never re-panelled**, and GS-I MCQ generation has never been
  panel-gated at all (`PRE_GS1` has 17 generated questions).
- **Cost is bounded**: `QGEN_BATCH_MAX_USD` defaults to $5/night on the Batches
  API.
- **But the full pattern does not require a generation programme** (§6.3) —
  qgen improves full-length freshness rather than being load-bearing for
  existence. That is the substantive change from the first draft.

### 6.5 ⚑ Mains-descriptive generation is NOT cleared

`OUTSTANDING.md` §9 **G1**: generated Mains-descriptive scored **2.50** against
**4.63** (real Essay) and **5.00** (real GS4) on a blind 3-judge panel.
`aeb2d2c` removed the vacuous-target half of the cause; the row records the gap
as **evenly spread** with a **second, undiagnosed cause**. All 28 generated
descriptive rows stay `needs_review`. **A Mains series is PYQ-only until G1 is
diagnosed and a fresh panel clears it** — and §6.3 shows that costs nothing.

---

## 7. Scheduling mechanism

### 7.1 Almost nothing needs to fire

| Requirement | Timed actor? | How it works |
|---|---|---|
| Test opens at 14:00 | **No** | `now() >= opens_at` at read time |
| Test stops counting for rank | **No** | `submitted_at <= ranked_until` |
| Attempt auto-submits at duration end | **No — already solved** | server-authoritative `started_at + duration_minutes` (Session 7) |
| Rank / percentile | **No** | computed on read; `refresh_scoreboard_views` already exists |
| Abandoned in-flight attempt | **No** | lazy, on next read |
| **"Your test is live" push** | **YES** | the only genuinely time-critical actor |
| **"Opens tomorrow" reminder** | **YES** | same mechanism |

The daily quiz already establishes the pattern: `ensureTodayQuizzes` is a
read-time self-heal, not a dependency on the 05:00 job having run.

### 7.2 Recommendation

**v1 — no new scheduling infrastructure.** Constrain `opens_at` to `:00` of an
hour (institutes advertise whole hours anyway). Enqueue every
`notification_schedule` row **at series-publish time, weeks ahead**, with the
exact `scheduled_for` — the whole calendar is known in advance, which is the
property that makes this easy. The existing hourly `notifications.yml` drain
picks up a 14:00 row on its 14:00 run (`lte(scheduled_for, now)`), so delivery
lag is GH-Actions drift only.

**Why not just tighten the GH cron:** two problems documented in this repo's own
workflow comments — `schedule:` triggers are best-effort with minutes of drift
and can be dropped under load, and they **auto-disable after 60 days of repo
inactivity**. Tolerable for a daily quiz; a poor foundation for a paid product
whose core promise is a fixed open time.

**v2 upgrade path: `pg_cron` + `pg_net`.** `pg_cron` is on every Supabase
project including free tier, runs inside Postgres (no cold start, no external
dependency, no 60-day auto-disable) and is minute-precise. It cannot send a web
push itself, so the shape is `pg_cron` → `pg_net` POST → an API endpoint behind
a shared secret → the existing `runPushSender`. **Build it when a founder
decides the lag is unacceptable** (Q8), not before. Neither extension is
installed today (`0001_extensions.sql` has only `pgcrypto` and `vector`).

*Rejected: a queue (BullMQ/pg-boss)* — solves distribution and retry problems
this feature does not have; the work is idempotent, low-volume and already has
an at-least-once drain keyed on `pushed_at`.

### 7.3 What does need a job

Only content assembly — `mocks.ts`-shaped work behind
`pnpm series:build --slug <s>`, run **before** the series is published. Papers
must never be generated at open time.

---

## 8. Notifications

`notification_schedule` (`0039`) is closer to fitting than expected: it already
has `scheduled_for timestamptz`, bilingual title/body, a `link`, a
`(user_id, dedupe_key)` unique, `pushed_at` (`0059`), per-type opt-out via
`push_preferences` and dead-subscription pruning. Only `generateForUser` is
daily; the table itself is a general scheduled-message queue.

**What must change:**

1. `notification_type` is a **Postgres enum** (`quiz_ready | streak_at_risk |
   srs_due`) — needs `ALTER TYPE … ADD VALUE`, the `0040`/`0046`/`0102` pattern.
   Proposed: `series_test_open`, `series_test_reminder`, `series_result_ready`.
2. **Enqueue must be decoupled from `generateForUser`**, which is a *reconciler*
   that resolves nudges whose condition no longer holds. A series notification is
   a fact about a fixed future moment and must not be resolved away. Enqueue once
   at series-publish, `dedupe_key = 'series_open:<entry_id>'`.
3. `push_preferences` needs a column per new type — the sender reads
   `prefs[row.type]`, so a new enum value with no column silently defaults to
   opted-in.
4. Fan-out is bounded by **enrollment**, not all users.

**Recommended set** (mirroring what institutes actually send):
`opens_at − 24h` reminder carrying `syllabus_note_i18n` ("here's what to
revise") · `opens_at` "live now" → deep link to the pre-start screen ·
`closes_at − 12h` if unattempted · `series_result_ready` after `ranked_until`.

⚑ **1 push subscription exists in the entire database.** Treat the in-app bell
as the primary channel for v1; push needs its own verification pass.

---

## 9. Prelims vs Mains

### 9.1 Prelims — near-total reuse

`startAttempt` is the natural window gate: it already does an untrusted-`test_id`
exam check and an `assertMockTests` entitlement check in exactly the right
place. Grading, results, review, cut-off comparison and the leaderboard work
unchanged. **Zero LLM calls to serve** — explanations are generated on demand and
cached per question, so a cohort shares one generation.

### 9.2 Mains — same shape, different economics

`answer_test_sessions` (`0063`/`0064`) is already the right primitive: a
resumable, timed wrapper over a `tests` row whose questions become normal
`answer_submissions`, with a unique active-session index mirroring
`startAttempt`. The window gate goes in `startAnswerSession`.

Two real gaps:

- **No automatic ranked board for descriptive papers.** `v_test_leaderboard`
  reads `attempts`, which Mains does not use. A Mains rank must be built over
  `answer_test_sessions` + summed `evaluations` — new work, and meaningful only
  if every enrolled student's paper is fully evaluated (Q4, Q5).
- **⚑ Mains scoring depends on G3, which is open.** `OUTSTANDING.md` **G3**
  records the model-answer verify gate as shipped but **not closed**: precision
  validated, recall only partly; the sonnet verifier's false-positive rate over
  the 14 known-good answers is unmeasured. Because model answers are **cached and
  replayed**, a bad one reaches the entire cohort and every future student on
  that question. **Close G3 before a Mains series ships.**

### 9.3 ⚑ The Mains economics collision

At $0.0584/evaluation, 20 questions per paper:

| | evaluations | cost |
|---|---:|---:|
| One Mains paper, one student | 20 | **$1.17** |
| UPPSC 22-paper series, one student | 440 | **$25.70** |
| UPSC 30-test series, one student | 600 | **$35.04** |
| Marginal once model answers are cached | — | ~$0.0477/eval |

Against ₹2,499 (~$28) annual and ₹399 (~$4.50) monthly. And against limits set
for ad-hoc practice: **Pro is 60 evaluations/month** (a fortnightly Mains paper
is 40/month — survivable; Vision IAS's weekly full-length block is 80/month —
not), and **trial is 2/day**, so a trial user cannot complete one Mains paper in
under 10 days.

Market answer: institute Mains series are priced **separately at ₹15,000–25,000**
precisely because evaluation is the expensive part. Options (Q4):

1. **Separate paid SKU** with its own evaluation allowance — market-normal.
2. **Partial evaluation** — submit all 20, choose 5 for AI evaluation, get the
   cached model answer + marking outline for the rest. ~4× cheaper and mirrors
   how human evaluation is rationed anyway.
3. **Self-assessment against the cached model answer** as default, AI evaluation
   as a paid upgrade.
4. **Raise the Pro cap and the price.**

Recommendation: 2 or 3. Explicitly the founder's call.

---

## 10. Dependencies

| Dependency | Tracked | Blocks |
|---|---|---|
| **U8v** — 0 approved `upsc` CA questions | `OUTSTANDING.md` §8k | The UPSC series' CA slice. **Editorial, not code.** |
| **U8u** — 0 `upsc` mocks | §8k | UPSC series assembly (one CLI run) |
| **G1** — Mains-descriptive quality, second cause undiagnosed | §9 | qgen content in a Mains series. Not Prelims, and §6.3 shows PYQ-only is enough. |
| **G3** — model-answer verify recall unmeasured | §9, §9a | Mains series ship |
| **Reviewer throughput** — 1,027 `needs_review` | §3.3 | Any plan depending on qgen volume; UPPSC CSAT maths depth |
| **D3** — in-process rate limiter | §4 | A real live-mock event (hundreds of `startAttempt` in one minute on a multi-instance deploy) |
| **D7 / V2** — nothing is deployed | §4, §5 | Everything |
| **Push unproven** — 1 subscription | §3.3 | Push as primary channel |

---

## 11. Phased build plan

**Phase 0 — decisions (no code).** Answer §12, especially Q2 (which model) and
Q4 (Mains economics). Schedule the U8v CA approvals if UPSC is in scope for v1.

**Phase 1 — Prelims series, end to end, both exams.**
1. Migration: the three tables + owner-only RLS + the `v_test_leaderboard`
   window predicate, verified byte-identical for existing boards.
2. `pnpm series:build --slug <s>` — assembles `tests` rows from the §6.2 mix,
   reusing `mocks.ts`'s `availableQuestions` / `loadNodeWeightage` /
   `resolveSubtreeNodeIds` / weightage balancing.
3. Window gate in `startAttempt` (postpone-yes/prepone-no, §2.4).
4. Series calendar UI: per-test state chip, `syllabus_note_i18n` + `sources_i18n`
   rendered as the study plan, reusing the existing pre-start and player screens.
5. Result page: series context + two-tier rank (ranked cohort vs informational).

Ships with no LLM call, no new scheduling infrastructure and no change to the
attempt engine.

**Phase 2 — notifications.** Enum values, `push_preferences` columns,
enqueue-at-publish, the four messages, the `series_result_ready` reconciler
branch. Verify the in-app bell first.

**Phase 3 — Mains series (gated on G3 + Q4).** `startAnswerSession` window gate,
a Mains rank surface if Q5 says yes, whichever rationing model Q4 picks.

**Genuinely v2:** offline/centre mode · adaptive per-student calendars (**note
this conflicts with ranking**, which needs a shared cohort — do not drift into
it) · series-level rank trajectory and cohort analytics · a free All-India Open
Mock as an acquisition event · institute-style mentor feedback per test.

---

## 12. Open questions for the product owner

| # | Question | Why it matters | Recommendation |
|---|---|---|---|
| **Q1** | **Missed-window policy.** | Determines whether `closes_at` is a gate or a label. | Adopt the market rule verbatim: **postponement yes, preponement no**; late attempts run unranked as practice (§2.4). |
| **Q2** | **Which model — spiral (35), compact (25) or micro-drill (190)?** | Sets the whole calendar and the builder. All three are real; §6.3 gives feasibility per option. | **Compact 25 for UPPSC Prelims** (fits supply cleanly, matches the UPPSC market), **spiral for UPSC** once CA is unblocked. Micro-drill is the strongest long-term differentiator for a bank-rich platform — revisit as v2. |
| **Q3** | **Is the series inside Pro, or a separate SKU? GS and CSAT priced separately?** | The market prices GS (₹16,000) and CSAT (₹9,000) as separate products. `assertMockTests` gates mocks as Pro today. | Prelims inside Pro; Mains separate (Q4). |
| **Q4** | **Mains evaluation economics** (§9.3). | ~$25.7–$35/student against ~$28/year; the Pro cap breaks under a weekly cadence. | Option 2 or 3. **Blocking for Phase 3.** |
| **Q5** | **Does Mains get a rank?** | Needs new board machinery **and** full evaluation of every paper, multiplying Q4. | No rank in v1 — dimension-wise percentile band instead. |
| **Q6** | **Should series full-lengths appear in the existing per-paper mock board?** | They will by default (§5.3). | Yes, but surface the series board as primary. |
| **Q7** | **UPPSC only, or both at launch?** | UPSC Prelims GS supply is fine but its CA slice is empty (U8v) and `is_live=false`. | UPPSC first; UPSC as a fast follow once CA MCQs are approved. |
| **Q8** | **Acceptable notification lag?** | Decides whether §7.2's `pg_cron` v2 is needed. | Accept 0–20 min for v1; revisit before any advertised live event. |
| **Q9** | **Who reviews generated questions?** | 1,027 backlog; nothing budgets reviewer time. Gates UPPSC CSAT maths depth and full-length freshness. | Must be answered before any plan depending on qgen volume. |

---

## Appendix — what this design did NOT verify

- **No application code was written or run.** Three read-only DB probes were used
  and deleted.
- **The first draft's supply figure was wrong** and is corrected in the banner at
  the top. The lesson generalises: count by **syllabus node**, not paper code —
  a paper-code count silently omits CA questions that are already mapped into
  the tree and already servable.
- **Vision IAS Applied tests 13–25 and Fundamental test 8 were not read
  individually** — the pattern was established from tests 1–12 plus the
  programme summary (8 + 17 + 10). Read the rest before hard-coding a UPSC
  calendar.
- **No institute publicly states its late-attempt ranking policy.** §2.4's
  postpone/prepone rule IS published verbatim; the *ranking* consequence of a
  late attempt is inferred.
- **The `v_test_leaderboard` change in §5.5 is untested.**
- **`pg_cron`/`pg_net` availability is from Supabase docs, not this project.**
- **Push at cohort scale is entirely unproven** — 1 subscription.
- **The cost model assumes model-answer caching holds across a cohort** — it
  follows from the unique key but has never been measured over a real
  multi-student cohort, because none exists.
