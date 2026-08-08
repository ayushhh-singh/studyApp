# UPSC launch checklist

Scope: this is **not** `docs/launch-checklist.md` (the general prod-deploy smoke
test, still gated on D7/V2 — no real deploy exists yet). This checklist is
narrower and specific to **flipping `exams.upsc.is_live` from `false` to
`true`** — i.e. making the already-built UPSC content and pipelines
*selectable by real users* inside the current dev/shared-DB product. It was
produced 2026-08-08 by running the actual verification against the live
Supabase project (the same one used for dev and prod), per
`docs/OUTSTANDING.md` §8f's **U7** finding and §8's overall multi-exam
tracking.

**Status as of this writing: 2 of 9 items need action before flipping.**
Everything else passed real, live verification. See the summary table, then
the per-item detail below it.

---

## 0. The prerequisite this session closed: U7's architectural gap

`docs/OUTSTANDING.md` §8f's **U7** (🔴) recorded that `exams.is_live` was only
ever enforced on the two *write* paths (`assertSelectableExam`, called from
onboarding and the profile exam switcher) — nothing stopped a `users_profile`
row that **already** held a non-live `target_exam` from reading as that exam
forever, with no further write needed. Concretely: a typed-answer evaluation
would run the real two-pass Sonnet pipeline, at real cost, for an exam the
registry says is not launched.

**Fixed in `apps/api/src/lib/exams.ts`'s `getUserExam()`** — the single
function ~27 files call to resolve "what exam should this user's reads be
scoped to" (evaluation's rubric selection, the mentor's grounding/persona,
daily answer sets, study plan, micro-drills, OCR, notes, tests, boards,
community — all of them). It now checks the exam's `is_live` flag (via a
60s-TTL cache mirroring the file's existing `paperCodesForExam` pattern, so
this doesn't add a DB round trip to hot paths like the dashboard) and falls
back to the default exam (`uppsc`) whenever the user's `target_exam` names a
non-live one. **This is read-time only — it never writes `target_exam`.** A
row parked on a non-live exam for deliberate pre-launch testing is untouched
by this function and resumes reading as that exam the instant its `is_live`
flips `true` — no write, no cleanup needed on that row.

`getExamConfig()` itself was deliberately **not** changed — it's a pure,
synchronous, in-memory lookup (documented to never throw, since it's read at
an evaluation's billing point), and every call site that matters was traced
(see below) to derive its exam code from `getUserExam()` — so it's protected
transitively. Content-pipeline paths (`examCodeForNode()`, a CLI's `--exam`
flag via `resolveTargetExams()`) are deliberately **not** gated — stocking a
not-yet-live exam's content is the whole point of those paths, and gating
them would remove that capability (this is explicitly documented in
`resolveTargetExams`'s own doc comment, which already cites U7).

**Traced every `getExamConfig()` call site** (~35 files) to confirm none
reaches it with a user-facing exam code that bypasses `getUserExam()` — the
evaluation custom-prompt path, mentor, study-plan, answer-set, micro-drills,
OCR and user-notes all confirmed to call `getUserExam(userId)` directly. The
one residual: `evaluate.ts`'s catalogued-question path derives its exam from
the *question's own syllabus node* (`examCodeForNode`), not the submitter's
target exam — by design, matching the pre-existing "public reference content"
precedent (§8h's U4b) — a user could in principle submit a raw `question_id`
belonging to a non-live exam directly via the API and be scored under that
exam's rubric. This requires knowing a specific UUID and isn't reachable
through any normal browse/search UI (which are all exam-scoped via
`getUserExam()`), so it's recorded here rather than additionally gated.

**⚑ The founder's parked test-account row, referenced throughout
`docs/OUTSTANDING.md`'s U7/U3/U8 entries as `target_exam='upsc'`, does
NOT currently exist.** Checked directly, read-only, before touching anything:
**0 of 163 `users_profile` rows currently have `target_exam='upsc'`** (all
163 are `uppsc`). So the specific tension the task asked me to navigate
carefully — "don't let the fix silently break the founder's active testing
row" — turned out not to be live right now. I did **not** create, reset, or
otherwise touch any profile row as part of this work. If that account still
exists somewhere with a different id, or was reset by you outside this
session, this is worth a quick sanity check on your end — I'm reporting what
I measured, not assuming a history I can't see.

Verified live with throwaway accounts only (created and deleted by exact id,
never touching the row above): a throwaway profile parked on `target_exam:
'upsc'` resolves to `uppsc` while `is_live=false`, resolves to `upsc` the
moment `is_live` flips `true` **with no write to the row**, and reverts to
`uppsc` again the moment it flips back — in a fresh process each time (the
TTL cache means a single long-lived process can lag up to 60s behind a flip,
which is an accepted, documented tradeoff, not a bug).

**⚑ A residual gap, found and reproduced live by a same-day edge-case pass over
this fix, recorded but deliberately not closed:** `getUserExam()` protects
every content-serving path, but `GET /profile` itself still returns
`target_exam` **raw** (not gated), and the web app's `useCurrentExam()` —
which drives the PYQ picker, mocks tabs, scoreboard and papers grid — reads
that raw value. So a row parked on a non-live exam would show that exam's
papers/labels in the UI while the actual dashboard/evaluation/mentor content
silently stays on the default exam underneath — a display mismatch, not a
cost or content-exposure issue (nothing here drives spend). Currently
unreachable (0 profiles are in that state) and left for an explicit product
decision if it ever needs closing — see `docs/OUTSTANDING.md`'s **U7-residual**
for the two live options and why neither was picked unilaterally.

---

## 1. Summary — what needs action before flipping `is_live`

| # | Item | Result | Action needed? |
|---|---|---|---|
| 1 | CA triage candidate pool + pre-filter at the real dual-live count | ✅ PASS | No |
| 2 | CA content correctly per-exam scoped (M20b) | ✅ PASS | No |
| 3 | Magazine — national lens, no state leakage, UPPSC regression | ✅ PASS | No |
| 4 | Daily quiz (GS+CSAT) | ✅ PASS | No |
| 5 | **CA quiz ("Quiz me on this week")** | 🔴 **BLOCKED** | **Yes — approve upsc CA MCQs in the Review Queue** |
| 6 | **Mocks per paper type** | 🔴 **BLOCKED** | **Yes — run `pnpm mocks:build --exam upsc` and `pnpm mocks:build:mains --exam upsc`** |
| 7 | Chapters — coverage + M21 (pyq_ids exam-scoped) | ✅ PASS (78/195) | No (ongoing rollout, not a launch blocker) |
| 8 | Evaluation, real end-to-end run | ✅ PASS | No |
| 9 | Mentor, real end-to-end run, real citation | ✅ PASS | No |
| — | Onboarding picker + profile switcher UI, both locales/390px | ✅ PASS | No |
| — | **`launch_scope_i18n` copy for `upsc`** | 🟡 **STALE** | **Recommended — update before real users see it** |

---

## 2. Per-item detail

### 2.1 CA triage candidate pool + pre-filter — ✅ PASS

Verified against the REAL dual-live state (`uppsc.is_live=true` AND
`upsc.is_live=true` simultaneously — not a simulated/throwaway-only test),
directly exercising `loadSyllabusCandidates`:

- `{examCodes:["upsc"]}` → **195** candidates (matches the UPSC tree's 195
  chapterable nodes exactly).
- `{examCodes:["uppsc"]}` → **284** (unchanged).
- `{examCodes:["upsc","uppsc"]}` → 479 (the naive combined figure) — but this
  is **not** what the CA pipeline actually calls. `ca/pipeline.ts`,
  `ca/backfill.ts` and `ca/widen-exam.ts` all call
  `loadSyllabusCandidates({examCodes:[examCode]})` — one exam at a time, per
  the per-exam CA triage fan-out (`ca/exam-fanout.ts`, shipped 2026-08-01) —
  so each exam's triage prompt only ever sees its own pool. **This is the
  direct confirmation that U4's original concern (pre-filter coverage
  dropping 53%→31% if both exams were unscoped-live) doesn't apply — it was
  already fixed by the fan-out, and this is real evidence of that holding at
  the true candidate counts, not the earlier 284-only baseline.**
- The pre-filter itself engaged normally against a real UPSC-topic item
  (K=150 of 195, `enabled=true`) — not silently falling back to the full
  list.

### 2.2 CA content, per-exam curation scope (M20b) — ✅ PASS

23 published `current_affairs_items` currently carry `exam_codes` overlapping
`upsc`. Checked **all 23**, not a sample: every `gs_papers_by_exam`
resolution via `ca/curation-scope.ts` stays inside UPSC's real paper set
(`GS1-GS4, ESSAY` — never `GS5_UP`/`GS6_UP`, which don't exist for UPSC), and
`state_focus` resolves `false` on every row (correct — UPSC is a national
exam).

### 2.3 Magazine — national lens, UPPSC regression — ✅ PASS

Compiled the current month's Prelims + Mains editions for **both** exams
under the real dual-live state:

- `uppsc`: unchanged and healthy (Prelims 82 items / 10 topic sections / 12
  up_special; Mains 42 issues across all 6 GS papers including `GS5_UP`/
  `GS6_UP`).
- `upsc`: Prelims 9 items, **`up_special: 0`** (correct — no state lead for a
  national exam), 5 topic sections. Mains 15 issues across `GS2/GS3/GS4`
  (GS1 simply has 0 qualifying items this month — not a bug), **zero**
  `GS5_UP`/`GS6_UP` leakage, zero `state_focus=true` rows.

### 2.4 Daily quiz (GS+CSAT) — ✅ PASS

Real rows exist for today (`UPSC_PRE_GS1` + `UPSC_PRE_CSAT`, both created
`2026-08-08T00:00:5{7,9}Z`). Traced this timestamp rather than assuming it
came from a scheduled job — see §3 below; it's a same-second pair, consistent
with the app's own on-demand self-heal building both variants together the
first time something needed today's quiz during this session's live UI
testing, not an external cron. Either way: the real end-to-end mechanism that
"daily quiz assembles" is asking about works correctly for UPSC.

### 2.5 CA quiz ("Quiz me on this week") — 🔴 BLOCKED, needs action

`createCustomTestFromCurrentAffairs`-equivalent needs at least one
**approved** `is_published=true` CA MCQ for the exam. Right now: **3** upsc
`CURRENT_AFFAIRS` questions exist, all `review_state='needs_review'` — **0
approved**. This matches the generation-quality audit's own finding
(`docs/OUTSTANDING.md` §9, item 1 in §8k's gate table: CA triage passed its
quality panel, but generated CA *MCQs* specifically are held pending human
review, same as UPPSC's own MCQs are). **Action: approve at least a few real
upsc CA MCQs in the admin Review Queue before flipping `is_live`** — otherwise
a fresh UPSC user's "Quiz me on this week" button 400s on day one.

### 2.6 Mocks per paper type — 🔴 BLOCKED, needs action

**Zero** `tests` rows with `exam_code='upsc'` and `kind='mock'` exist. This
contradicts how `docs/OUTSTANDING.md` §8k (U8g) reads at a glance — tracing
the actual commit (`c39bccd`) shows it explicitly did a **read-only replay**
that reproduced the correct pool sizes and structural numbers
(`UPSC_PRE_GS1` 100Q/pool 1057, `UPSC_PRE_CSAT` 80Q/pool 841,
`UPSC_MAINS_GS1-3/GS4/ESSAY`) — it verified the **code** is correct, but
**never actually called the build function**, so no row was ever persisted.
The doc's phrasing ("mock papers, every structural number sourced from
`exams.paper_structure`") is accurate about the code, misleading about the
data. **Action:**

```
pnpm mocks:build --exam upsc         # Prelims (GS-I, CSAT)
pnpm mocks:build:mains --exam upsc   # Mains (GS1-4, Essay)
```

Both take real, bounded, deterministic pool-assembly work (no per-item LLM
generation — the pool is already published questions), matching the exact
CLI contract `docs/OUTSTANDING.md`'s own U8 projection already budgeted for.
**I did not run these myself** — this is real content-generation work outside
the scope of "verify," and I wanted this checklist to give you an honest,
unmodified read of current state before anything else changes it.

### 2.7 Chapters — coverage + M21 — ✅ PASS (ongoing, not a launch blocker)

**78 / 195** chapterable nodes published for upsc (measured live via
`pnpm --filter api notes:coverage`, not the stale "78" figure some earlier
doc entries carry — this one is current as of today). This is an *ongoing
content rollout*, not something that needs to reach 100% before launch — the
existing chapters already cover the top-weightage nodes per the rollout's own
stated worklist ordering.

M21 (chapter `pyq_ids` validated by exam, not just existence) re-verified
against 3 real published upsc chapters' actual stored `pyq_ids` (16/24/14
references): **0 missing, 0 foreign** across all of them — the exam-scoped
validation is intact on real data, not just in the unit-level checks
`docs/OUTSTANDING.md` already recorded.

### 2.8 Evaluation — ✅ PASS, real end-to-end run

Submitted one real 80-word custom-prompt answer as a throwaway `upsc`-target
user, through the full API (submission → SSE evaluation stream → `done`).
Confirmed in the DB: `evaluations.exam_code='upsc'`,
`rubric_version='upsc-gs-v1'`, `rubric_kind='gs'` — the correct rubric, not a
silent UPPSC fallback. Real spend: **$0.0744**, 4 real `llm_calls` rows
(`claude-sonnet-5`). The score (44%) is consistent with the documented UPSC
severity calibration from the recalibration session. This is the exact path
U7 named as the most expensive exposure, and it's now confirmed to only run
for a genuinely-live exam.

### 2.9 Mentor — ✅ PASS, real citation to real content

Asked one real, focused doubt on the basic structure doctrine as the same
throwaway user. Got a substantive, accurate answer (Kesavananda Bharati,
Minerva Mills, Article 368) — not the old `UNAUTHORED` refusal (that gate was
closed by the exam-config authoring pass on 2026-07-31, before this session).
The inline `[4]` citation resolves to a real **published** upsc chapter
(`/learn/UPSC_MAINS_GS2/.../…?tab=notes`) confirmed in the DB — the mentor
genuinely grounds in upsc content, not UPPSC's.

### 2.10 Onboarding picker + profile switcher, both locales/390px — ✅ PASS

With `upsc.is_live=true`, the onboarding exam-selection step and the Profile
exam-switcher card both render `upsc` as a real, clickable, selectable
option (MPPSC correctly still shows "Coming soon" — it's still non-live).
Verified at 1440px and 390px, `en` and `hi`, both surfaces: zero console
errors, zero horizontal overflow, correct Devanagari. `PATCH /profile
{target_exam:'upsc'}` returns 200 (not the old 400) with a genuinely-live
exam. Real exam-scoped downstream data confirmed flowing (the Strength/
Weakness matrix showed real UPSC topics, not empty/UPPSC data).

### 2.11 `launch_scope_i18n` — 🟡 STALE, recommended fix

**Found by the UI verification, not assumed.** `exams.upsc.launch_scope_i18n`
in the DB still reads, in substance, *"we have not yet ingested any UPSC
past-year questions or study material"* and lists the past-year question bank
and study chapters as **not covered** — when in fact there are **2,866 real
UPSC questions and 78 published study chapters**. This copy is **not
currently visible** (a live exam renders as a plain selectable row with no
scope copy at all — `exam-picker-list.tsx` only shows it for non-live exams),
so nothing is wrong on screen *right now* (with `is_live` back to `false`
after this session's verification). But it means the copy a prospective UPSC
user reads TODAY, while `upsc` is still non-live, understates what already
exists — and if `is_live` is ever flipped back to `false` again after a real
launch (a rollback, a maintenance window), this same stale text would
reappear. **Recommended: update `exams.upsc.launch_scope_i18n` to reflect
current coverage before relying on it again** — this is a data update, not a
code change, and wasn't made here since it wasn't asked for and touches
user-facing copy that deserves your own wording.

---

## 3. On the verification window itself — a safety note, not a finding against the app

Verifying items 2.1-2.10 required temporarily flipping `exams.upsc.is_live`
to `true` in the shared dev/prod Supabase project, running real checks
(including two real, small generative calls — the evaluation and the mentor
doubt above), and flipping back to `false`. **The window ended up longer than
intended** (crossed the `00:00 UTC` mark, which is `ca-run.yml`'s scheduled
cron tick), so before writing this up I checked — rather than assumed —
whether an external GitHub Actions cron could have fired mid-window and done
something uncontrolled:

- `gh` CLI isn't available in this environment, so I couldn't directly query
  GitHub's own workflow-run history.
- Checked the DB directly instead. The daily-quiz rows (§2.4) were created at
  `00:00:57-59 UTC` — a same-second pair, which reads as a single request
  handler's on-demand self-heal (triggered by this session's own live UI
  testing hitting a route that checks for today's quiz), not
  `daily-build.yml`'s actual schedule (`23:30 UTC`, half an hour earlier).
- The substantial CA `llm_calls` activity in the DB around `20:48-20:55 UTC`
  on 2026-08-07 **predates** this session's `is_live` flip entirely (it
  matches the real, already-budgeted `ca:run --exam upsc` run recorded in
  CLAUDE.md's M20b entry, from earlier the same day) — not something that ran
  during this session's window.
- One isolated `ca_mcq_gen` call ($0.009) at `04:26 UTC` — small, and most
  likely triggered by the same self-heal/on-demand pattern as the daily quiz,
  not a runaway process.

**No evidence of an uncontrolled external cron run.** Also worth recording:
`origin/main` (what a real GitHub Actions schedule trigger would actually
read code from) already carries the critical multi-exam CA safety fixes
(`bb113e9`, `58e270b`, `314aa8a`, `c7195c6`'s stale-branch guard) as of
2026-08-07 — so even if a scheduled tick *had* fired mid-window, it would
have run the correct, per-exam-scoped pipeline rather than the contamination
bug `docs/OUTSTANDING.md`'s U8k describes (which was about `main` being stale
relative to the fixes; it no longer is).

---

## 4. Sign-off

Once you've reviewed this, and once items 2.5/2.6 above are closed (Review
Queue approvals + the two `mocks:build` runs) and 2.11 is updated if you want
it — the actual flip is a one-line, easily-reversible DB write:

```sql
update exams set is_live = true where exam_code = 'upsc';
```

I have **not** done this — per your instruction, it happens only after you
confirm.
