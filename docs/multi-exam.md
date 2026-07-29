# Multi-exam foundation

Companion to migration `0106_multi_exam_foundation.sql`. That file holds the
schema and the per-table decisions; this file holds the **call-site audit** and
the **ordered prerequisites** for actually ingesting a second exam.

Status: **M1-M9 are all CLOSED** — the four blocking prerequisites (M1-M4) by
migrations `0107`/`0108`, and the go-live set (M5-M9) by `0109`/`0110`, plus the
call-site work below. `uppsc` is still the only `is_live` exam, and
`upsc`/`mppsc` still carry **zero** syllabus nodes, questions, chapters or
current affairs; what changed is that ingesting a second exam's content, and
then showing it to users, is no longer unsafe.

**Verified by seeding a real second exam against the live DB, not by checking
that uppsc still works.** Two runs:

- M1-M4 (2026-07-29): a throwaway `upsc` tree (`UPSC_PRE_GS1`), its own
  embeddings, a shared NULL-exam chunk, a cached FAQ answer per exam, and a real
  throwaway user whose `target_exam` is `upsc` — **32/32 assertions**.
- M5-M9 (2026-07-29): the same tree plus its own published question bank, one
  throwaway user per exam, real evaluations (GS and essay), a real second-exam
  daily quiz built end to end, real threads, and a real CA item — **53/53
  assertions**, isolation checked in *both* directions.

Every synthetic row was deleted by an id captured at insert time and
`exams.upsc.is_live` restored; a post-run audit confirmed 0 non-`uppsc` rows
left in `syllabus_nodes` / `tests` / `evaluations` / `questions` /
`current_affairs_items` / `users_profile` / `discussion_threads`.

Still open: §8c's ops items (M12, M13, M21, M22, **M23**) and **M20** (the CA magazine
and its two UPPSC-shaped fields, deferred together — see §3 item 7). **M11 and M14
closed 2026-07-29** — M11 as a reasoned decision *not* to add a paper-code FK
registry (§0a, which also records the one place the invariant genuinely leaks:
the unguarded PYQ-ingest writer, now **M23**), M14 as a verified idempotency fix
to `0106`.

**The product decisions in §4 are now closed** (founder, 2026-07-29): community
is exam-separated (M17, §3e), **study chapters stay exam-specific and are
drafted from the corresponding UPPSC chapter — see §5, which every future
chapter-generation session must read first** (M15), pricing stays one
exam-agnostic ladder (M18), and questions are not shared across exams (M19).
Only **M16** (one exam per user, or several concurrently?) remains open, and the
schema already answers it "one".

---

## 0. The invariant everything else rests on

`syllabus_nodes.paper_code` is **globally unique across exams**, enforced by
retaining the pre-existing unique index `syllabus_nodes_paper_path_key
(paper_code, path)` from `0018`.

**A second exam's paper codes must be exam-prefixed** — `UPSC_PRE_GS1`,
`MPPSC_MAINS_GS2` — never a bare `PRE_GS1`.

Why this matters more than it looks:

- ~30 call sites read `syllabus_nodes` filtered **only** by `paper_code`. Under
  this invariant every one of them stays correct with no code change. Without
  it, every one silently returns another exam's nodes.
- `ingest:syllabus`'s upsert conflict target *is* `(paper_code, path)`. A shared
  paper code would make a second exam's load **overwrite the UPPSC tree in
  place** rather than insert a second one.
- `tests.slug` (`pyq:PRE_GS1:2024`), `mv_mock_series_board`'s
  `(paper_code, user_id)` key, and `scoreboard_rank_snapshots.board_key` all
  embed a bare paper code and are only safe because of it.
- A **prefix** (not a suffix) additionally keeps existing `like 'PRE_%'` /
  `like 'MAINS_%'` scans UPPSC-only by construction.

The invariant turns an entire class of silent cross-exam corruption into a loud
unique-violation at ingest time. **Do not drop that index.** The
`(exam_code, paper_code, path)` index added in 0106 is documentation-of-intent
and defence in depth — it is not the guarantee.

### 0a. Reconsidered 2026-07-29: no FK registry, and where the invariant actually leaks

M11 asked whether `tests.paper_code`, `exam_cutoffs.paper_code` and
`mv_mock_series_board`'s key need **DB-level** enforcement before a second
exam's tests and cut-offs exist. **Decision: no.** Full reasoning in
`docs/OUTSTANDING.md` §8c M11; the two things a second-exam session needs from
it are:

**Why no constraint.** All three hold only *derived copies* of a paper code —
none of them mints one. `tests.paper_code` is read off the node/question row in
the same statement that stamps `exam_code` from that same row; `exam_cutoffs`
has no code writer at all; the mock-series MV derives from `tests`. And the only
shape that would make the invariant DB-true — a `papers(paper_code PK,
exam_code FK)` registry with FKs onto all three — is **not free**: measured
live, `tests.paper_code` carries `CURRENT_AFFAIRS` on 16 rows and
`questions.paper_code` also carries `EDGE`, synthetic codes with no
`syllabus_nodes` row, so a blanket FK converts a working path into a `23503`
unless synthetic registry rows are minted and maintained forever.
**The condition that would reverse this is not "a second exam exists" — it is
"a paper code is minted somewhere other than an ingest pipeline".**

**Where it does leak, and what to do about it.** Uniqueness makes a value
*consistent*; it does not make a read *access-scoped*, and it says nothing about
a writer that never had the rule applied to it. Two findings, one fixed and one
tracked:

- **Fixed:** `getMockSeriesBoard` took `paper_code` straight from an untrusted
  query param with no exam check — a second exam's user could read another
  exam's series board by passing its code. Now mirrors the guard `getTestBoard`
  already had for `test_id`.
- **⚑ TRACKED AS M23 — DO THIS BEFORE THE FIRST `ingest:pyq` RUN OF A SECOND
  EXAM.** The prefix rule is enforced in `ingest:syllabus` only.
  `classifyPyqId` (`ingest/_shared.ts`) maps `upsc_prelims_2024_gs1` to a
  **bare `PRE_GS1`**, and `pyq-load.ts`'s `resolveSyllabusId` resolves a paper
  code to a node with **no exam filter** — so a second exam's PYQs would take
  UPPSC's paper code and attach to UPPSC's tree, silently. It is the exact
  mirror of M21/M22 for chapters: fix it as step 1 of U5, not afterwards. Today
  the only thing standing in the way is the convention *"never ingest
  `upsc_*`/`upsssc_*` files"* — which U5 is by definition the act of relaxing.

---

## 1. `syllabus_nodes` call-site audit

Every read of `syllabus_nodes` in `apps/api` was audited one by one. Classes:

- **SAFE-BY-ID** — looks up specific node ids from an already-exam-scoped source.
- **SAFE-BY-PAPER** — filters by `paper_code`; correct **because of §0**.
- **NEEDS-EXAM-FILTER** — unfiltered or all-paper-roots; returns cross-exam rows
  the moment a second syllabus exists.
- **WRITE**.

Every NEEDS-EXAM-FILTER row below is now **✅ FIXED** (M2), with one deliberate
exception recorded inline (`ca/syllabus-candidates.ts`, which is multi-exam *by
design* — filtering it to one exam would be the wrong fix, see the note there).

**Two corrections to the original audit, found while implementing it:**

1. **`mastery/compute.ts:152`'s existing `exam?` argument is NOT the one to
   wire.** It is the PROVENANCE filter on `questions.exam_code` — the UI's
   "UPPSC-asked questions only" toggle, which affects tile *weight* only — and
   it was already used. The syllabus-tree scoping needed a separate
   `targetExam` parameter. Do not merge the two.
2. **`dashboard.ts:319`'s `paper_code::path` key does NOT collide across exams.**
   `paper_code` is globally unique (§0), so `PRE_GS1::0` and `UPSC_PRE_GS1::0`
   are distinct. The real defect at that site was different and just as
   damaging: the read was **unranged**, so it silently truncates at PostgREST's
   1000-row cap as exams are added, dropping ancestor rows and with them whole
   sections of the weakness radar. Both that site and its twin
   (`learner-profile.ts:50`) are now scoped **and** paged via `selectAll`.

### 1a. Services

| Site | Function | Class |
|---|---|---|
| `attempts.ts:457` | `getAttemptResult` | SAFE-BY-ID |
| `community.ts:70` | `fetchNodeLabels` | SAFE-BY-ID |
| **`community.ts:91`** | `assertAnchorExists` | ✅ **FIXED (M7)** — asserts a shared exam and RETURNS it, so `createThread` stamps `discussion_threads.exam_code` from the anchor rather than guessing. A question anchor resolves through its **syllabus node** (never `questions.exam_code`, which is provenance); a `ca_item` tests **membership** in `exam_codes`, since a CA item is legitimately multi-exam. |
| `dashboard.ts:156` | `getContinue` | SAFE-BY-ID |
| **`dashboard.ts:319`** | `getPerformanceAndWeakness` | ✅ **FIXED (M2)** — takes `examCode`, resolved once in `getDashboardSummary` and shared with the countdown; now `.eq("exam_code", …)` **and** paged via `selectAll`. (The `paper_code::path` collision claim was wrong — see the corrections above; the unranged read was the real bug.) |
| `entitlements.ts:320` | `listFreeNoteNodeIds` | SAFE-BY-PAPER — re-checked: it ranks **top-5 per `paper_code`**, and paper codes are globally unique (§0), so the allowance is already per-exam. No `(exam_code, paper_code)` key needed. |
| **`learner-profile.ts:50`** | `buildNodeBuckets` | ✅ **FIXED (M2)** — takes `examCode` from the profile row `computeLearnerProfile` already reads; scoped + paged, same shape as dashboard. |
| `learner-profile.ts:175` | `buildRecentNodes` | SAFE-BY-ID |
| `mentor/retrieval.ts:111,148` | `resolveCitations` | ✅ **RESOLVED BY M3** — it resolves ids that `match_embeddings` returned, and that RPC is now exam-filtered, so the ids are exam-correct before they reach here. No filter of its own needed. |
| `mentor/teacher.ts:50` | `loadRelatedPyqs` | SAFE-BY-PAPER (helper) |
| `mentor/teacher.ts:120,139,148` | `loadAdjacentNodes` | SAFE-BY-ID — parent chain is exam-closed |
| `mocks.ts:88` | `topLevelByNode` | SAFE-BY-PAPER |
| `notes.ts:238,295` | `listReviewNotes` | SAFE-BY-ID (join) |
| **`on-demand.ts:154`** | `resolveNodes` | ✅ **FIXED (M7)** — takes a required `examCode` and 404s any node outside it. `createFreshMockSet`'s `paper_code` (untrusted body too) is checked the same way through the paper's root node. |
| `on-demand.ts:178` | `depth1AncestorIds` | SAFE-BY-ID |
| `on-demand.ts:196` | `depth1AncestorIds` | SAFE-BY-PAPER |
| **`on-demand.ts:209`** | `paperRootNodeId` | SAFE-BY-PAPER — but `.maybeSingle()` **hard-errors** if §0 is ever violated |
| **`profile-analytics.ts:47`** | `getScoreTrajectory` | ✅ **FIXED (M2)** — takes `examCode` (resolved once in `getProfileAnalytics`); paper-title roots are scoped to the user's exam. |
| `question-reports.ts:151` | `listQuestionReportsQueue` | SAFE-BY-ID (join) |
| `review.ts:34,161` | `listReviewQueue` | SAFE-BY-ID (join) |
| `srs.ts:40` | `addNodeToRevision` | SAFE-BY-ID |
| **`syllabus.ts:74`** | `getSyllabusTree` | ✅ **FIXED (M2)** — `examCode` is now a **required first parameter**, not optional-with-a-default, so no caller can silently keep the unscoped behaviour. `routes/syllabus.ts` passes `getUserExam(currentUserId())`. |
| **`syllabus.ts:94,99`** | `getPaperSummaries` | ✅ **FIXED (M2)** — takes a required `examCode`; both the depth-0 roots and the depth-1 topic count are scoped. The paper_code-keyed PYQ/notes/accuracy maps need no filter — they are only read back for the scoped roots' own codes. |
| `syllabus.ts:117` | `getPaperSummaries` coverage | SAFE-BY-ID (join) — the bucket key is `paper_code`, which §0 makes globally unique, and it is only read back for the now-exam-scoped roots. No exam in the key needed. |
| `syllabus.ts:211` | `getPaperTree` | SAFE-BY-PAPER — `buildTree` assumes exactly one root |
| `syllabus.ts:371` | `getNodeDetail` | SAFE-BY-ID |
| `syllabus.ts:401` | `getNodeDetail` breadcrumb | SAFE-BY-PAPER |
| `syllabus.ts:480` | `getPaperTrends` | SAFE-BY-PAPER |
| **`tests.ts:259`** | `resolveOrderedNodes` | ✅ **FIXED (M7)** — takes a required `examCode` and 404s any node outside it; the `custom` test it builds is stamped with that exam instead of the column default. |
| `time-attack.ts:177` | `getTimeAttackTopics` | SAFE-BY-PAPER — `idByPath` map would collide without §0 |
| `time-attack.ts:220` | `startTimeAttack` | SAFE-BY-ID |
| `tour.ts:141` | `getSuggestedChapterNode` | SAFE-BY-ID (join) — "best chapter" should be picked within the user's exam |
| `user-notes.ts:92,94` | user-note reads | SAFE-BY-ID (join) |
| **`user-notes.ts:198`** | `inferNode` | ✅ **FIXED (M3)** — `retrieveContext` now requires an `examCode`; `saveMessageAsNote` passes `getUserExam(userId)`, so a personal note can never be filed under another exam's node. |
| **`lib/syllabus-subtree.ts:14,26`** | `resolveSubtreeNodeIds` | SAFE-BY-ID + SAFE-BY-PAPER — **one helper behind 8 call sites** |

No writes to `syllabus_nodes` exist in any service.

### 1b. Pipelines / CLIs

| Site | Function | Class |
|---|---|---|
| **`ca/syllabus-candidates.ts:23`** | `loadSyllabusCandidates` | ⚠️ **DELIBERATELY NOT single-exam-filtered** — this is the one site where the original audit's prescription would be wrong. 0106 §11 decided a CA item MAY map into several exams' trees precisely so a national story is not duplicated and re-triaged per exam. It now takes an `examCodes[]` and callers pass the **live** set, so a reference/half-ingested exam's nodes never enter the triage prompt, while genuine multi-exam mapping still works. |
| `ca/prelims-node.ts:17` | `getPrelimsCurrentAffairsNodeId` | SAFE-BY-PAPER — module-level cache must become per-exam |
| `ingest/embed-coverage.ts:46` | `eligibleSyllabus` | ✅ **CORRECT AS GLOBAL** — re-checked: it reports embedding coverage, and embeddings deliberately span every exam. Scoping it would under-report. Left unchanged on purpose. |
| `ingest/pyq-load.ts:112` | `resolveSyllabusId` | SAFE-BY-PAPER — cache keyed by `paperCode`; **writes** `questions.syllabus_node_id`, so a §0 violation is permanent bad data |
| `ingest/pyq.ts:421` | `loadSyllabusTree` | SAFE-BY-PAPER |
| **`ingest/syllabus.ts:286`** | `upsertNode` | ✅ **FIXED (M1)** — `PaperDef` carries `exam`, the row literal stamps `exam_code`, and the conflict target stays `(paper_code, path)` on purpose (adding exam to the key would let two exams share a bare code, which ~30 paper_code-only reads would then mix). `assertPaperCodeScoped` runs before any model spend or write. |
| `ingest/tests.ts:78` | `topLevelByNode` | SAFE-BY-PAPER — `titleByPaperTop` keyed `paper_code::top` |
| `ingest/verify.ts:43` | `main` | ✅ **FIXED (M2)** — still grouped by `paper_code` (globally unique) but the exam is now PRINTED per row, so a second exam's papers are distinguishable instead of blending into one list. |
| **`mastery/compute.ts:82`** | `recomputeMastery` | SAFE-BY-PAPER — `idByPaperPath` key would mis-attribute mastery without §0 |
| **`mastery/compute.ts:152`** | `getMasteryMap` | ✅ **FIXED (M2)** — new **`targetExam`** parameter scopes the node tree (paged via `selectAll`). The pre-existing `exam?` arg was NOT the one to wire: it is the provenance filter on `questions.exam_code` and was already in use. Both mastery routes and `study-plan.ts`'s `loadWeakSections` pass the user's exam. |
| `notes/chapter-generate.ts:64,76` | `loadChildTitles`, `loadWeightage` | SAFE-BY-PAPER |
| `notes/generate.ts:61` | `loadNoteNode` | ✅ **FIXED (M3)** — `NoteNodeRow` now carries `exam_code`, feeding the grounding calls in both `generate.ts` and `chapter-generate.ts`. |
| `notes/generate.ts:84,339` | `loadWeightageSnapshot`, `topWeightageNodes` | SAFE-BY-PAPER |
| **`notes/generate.ts:325`** | `resolvePaperCode` | SAFE-BY-PAPER — `.maybeSingle()` **hard-errors** if §0 is violated |
| **`qgen/cli.ts:44`** | `resolveNodeId` | SAFE-BY-PAPER — same `.maybeSingle()` hazard |
| `qgen/generate.ts:106` | `loadNodeContext` | SAFE-BY-ID |
| **`qgen/topup.ts:101,115`** | `computeNodeTargets` | ✅ **FIXED (M2)** — explicit `.eq("exam_code", examCode)` alongside the `like` pattern, so the prefix convention is no longer load-bearing on its own. |

### 1c. Weightage

`mv_node_weightage` is **already exam-aware** — grain `(node_id, exam_code, year)`
where `exam_code` is the *asking* exam. `loadNodeWeightage(exam?)` accepts a
filter, but every caller (`notes/generate.ts:99,344`,
`notes/chapter-generate.ts:85`) calls it bare and intersects by node id. Correct
today; once a UPSC PYQ maps onto a UPPSC node it **sums across exams**. Pass the
exam.

---

## 2. Already-tagged non-UPPSC questions — measured, and it does **not** shrink U5

Queried live:

| `questions.exam_code` | rows | live | mapped to a node |
|---|---|---|---|
| `uppsc` | 4964 | 4292 | 4919 |
| `upsc` | **0** | 0 | 0 |
| `up_ro_aro` | 0 | 0 | 0 |
| `upsssc_pet` | 0 | 0 | 0 |
| `other` | 0 | 0 | 0 |

**There is no 0036-era UPSC overlap corpus to inherit.** The 399 UPSC/UPSSSC-PET
questions that once existed were deleted by the Session-27.5 contamination purge
(*"This platform is UPPSC-only — never ingest `upsc_*`/`upsssc_*` files"*). So
the premise that pre-tagged rows would shrink U5's scope does not hold: **U5
starts from zero questions and zero node coverage for UPSC**, and its PYQ-ingest
scope is unchanged.

Also confirmed: `0036`'s CHECK constraint permitted `upsc` but **not `mppsc`**.
`0106` extends it (and `examCodeSchema` in `packages/shared/src/types.ts` to
match), so an MPPSC ingest is not blocked by a constraint violation on day one.

---

## 3. Ordered prerequisites before ingesting a second exam

Items 1-4 were the blocking set. **All four are now CLOSED** (migrations
`0107`/`0108`); 5-7 remain.

1. ✅ **`ingest/syllabus.ts` stamps `exam_code`.** `PaperDef` carries an `exam`;
   the conflict target stays `(paper_code, path)` deliberately (see §1b).
   `assertPaperCodeScoped(exam, paperCode)` throws before any model spend or
   write if a non-default exam's code is not exam-prefixed, so the §0 invariant
   is enforced in code and not only by convention. `ingest:syllabus` also gained
   `--exam`. **Live-verified**: a bare `PRE_GS1` under `exam_code='upsc'` raises
   `23505` at the DB, and the prefixed code inserts cleanly.
2. ✅ **The NEEDS-EXAM-FILTER reads are exam-scoped.** `getSyllabusTree` and
   `getPaperSummaries` take a **required** `examCode` (a defaulted parameter
   would have let a caller silently keep the bug). `dashboard.ts` resolves the
   exam once and shares it between the countdown and the weakness radar;
   `learner-profile.ts` reuses the `target_exam` it already reads;
   `profile-analytics.ts`, `mastery/compute.ts` (new `targetExam`, distinct from
   its provenance `exam`), `qgen/topup.ts` and `ingest/verify.ts` are all scoped.
   `lib/exams.ts` gained `getUserExam` / `examCodeForNode` / `liveExamCodes`.
   The two whole-table reads are now paged as well as scoped.
3. ✅ **`match_embeddings` filters on `exam_code`, inside the RPC** (`0107` §2),
   and every embedding writer stamps the real exam: `ingest/embed.ts` (from the
   node — never from `questions.exam_code`, which is provenance and may name an
   exam nobody can select), `notes/embed.ts` (from the note's node), and both CA
   writers via `ca/embed-exam.ts`. `EmbeddingRow.exam_code` is a **required**
   field so the compiler asks each writer where its exam comes from, and
   `retrieveGrounding`/`retrieveContext` take a **required** `examCode` so each
   of the ~12 retrieval call sites had to decide.
   `embeddings.exam_code` became **nullable, meaning "shared across all exams"** —
   the honest third state for a current-affairs item that maps into several
   exams' trees (0106 §11 keeps those un-duplicated, and there is only one
   embedding row per item per locale).
   **Live-verified, and this is the assertion worth keeping**: with two
   near-identical chapters on one topic, one per exam, the *other* exam owned the
   entire unfiltered top-2 — so a post-filter would have left that user with
   **zero** grounding, while the in-RPC filter returned a full top-2.
4. ✅ **`match_doubt_faq` filters on `exam_code`** (`0107` §3), and because
   `upsertFaqCache` reuses that same lookup as its near-duplicate check, the
   cache is scoped in both directions at once. **Live-verified**: a UPSC user is
   not served the UPPSC-framed answer sitting at ~1.0 similarity; writing the
   UPSC answer INSERTS its own row instead of overwriting the UPPSC one; and
   same-exam "newest wins" still updates in place.
5. ✅ **`mv_mains_weekly_board` has an exam dimension, and so does the rubric
   registry** (`0109`). The board is keyed `(week_start, exam_code, user_id)`
   and splits GS from Essay on a stored `evaluations.rubric_kind` — the literal
   `rubric_version <> 'essay-v1'` comparison is gone from `0069`,
   `services/scoreboard.ts` and `getEvaluationPercentile`, because that string
   is *UPPSC's* essay rubric and a second exam's would have satisfied `<>` and
   been swept into the GS board. `RubricDefinition` now carries
   `examCode`/`kind`/`paperCodes`/`defaults`; new exams name their versions
   `<exam>-<kind>-v<n>`. See §3d.
6. ✅ **The chapters question is DECIDED (M15, founder, 2026-07-29): chapters
   stay exam-SPECIFIC — one row per node, `notes.syllabus_node_id` stays UNIQUE,
   no `note_syllabus_nodes` join table.** The "3x authoring and fact-audit cost"
   that made this a hard call is a **one-time cost paid in free coding-agent
   time, not recurring API spend** (all 284 existing chapters were authored that
   way — see `docs/OUTSTANDING.md` A1), which is what makes duplication
   affordable. It is NOT blank-slate re-authoring either: where a topic is
   genuinely common across exams, the corresponding UPPSC chapter is the
   starting draft, then tailored and expanded for the target exam's real
   emphasis. **The full rule, and the four things that must be re-derived rather
   than copied, are in §5 — read it before generating chapters for any exam.**
7. **Generalise the UPPSC-shaped CA fields** — `gs_papers text[]` assumes GS1-6
   numbering and `is_up_specific` assumes UP. **Deliberately deferred, with the
   piece that makes deferring safe now shipped** (M8): the CA feed finally
   *reads* `exam_codes` (`listCurrentAffairs` / `getCurrentAffairsItemById`, via
   `overlaps` so a national story still reaches several exams from one row), so
   the two fields are now only ever read *within* the exam whose pipeline wrote
   them. Measured live: **355 rows carry `is_up_specific = true` and 0 of them
   are scoped outside `uppsc`** — there is no cross-exam mislabel to fix today.
   They cannot be generalised alone anyway: `gs_papers`' taxonomy IS the Mains
   magazine's section structure (`GS_PAPER_ORDER`) and `is_up_specific` IS its
   UP lead section, so the fields and magazine exam-scoping are one unit of
   work, tracked as **M20**.

**M7 — ✅ resolved.** `community.ts:91`, `on-demand.ts:154` and `tests.ts:259`
now assert a shared `exam_code`, not just a shared `paper_code`. The exam check
is not implied by the paper one: another exam's ids are internally consistent
with each other, so the paper assertion happily passes on a set drawn entirely
from a foreign syllabus. Rejections are **404, not 403** — a foreign node is
genuinely not part of your syllabus, and a distinct error would confirm the id
exists to a caller probing with guessed ids.

**One partial that landed with (3) as a side effect:** `ca/pipeline.ts` now
writes `current_affairs_items.exam_codes` from the nodes triage actually chose,
instead of relying on the `{uppsc}` column default — because the item's embedding
row is stamped from that same set, and the two must not disagree. That closes the
second half of `docs/OUTSTANDING.md` §8b **M8** ("nothing recomputes it"). The
rest of M8 — `gs_papers` assuming GS1-6 numbering and `is_up_specific` assuming
UP — is untouched.

### 3f. Found by the post-commit edge-case audit (2026-07-29)

<!-- Renumbered 3d → 3f (2026-07-29): this file had TWO sections numbered 3d
     (this one and "3d. Answer-writing boards + the rubric registry"), and both
     were already being referenced with different meanings — CLAUDE.md's M1-M4
     entry meant this one, while multi-exam.md §3 item 5 and CLAUDE.md's M5-M9
     entry meant the rubric one. Only this section was renumbered, so every
     existing "§3d" reference to the rubric section stays correct. -->


Checked failure paths rather than re-running the happy path. Three fixed, three
recorded.

**Fixed:**

- **The papers grid's "M PYQs" badge was truncated to 1,000 rows** —
  `getPaperSummaries`' question-count select was unranged over 4,252 matching
  rows, so **PRE_GS1 rendered 110 instead of 1,003** and PRE_CSAT 193 instead of
  870. Live, user-visible, and it pre-dates the multi-exam work (it broke when
  the PYQ bank tripled) — but it sat inside a query this change already owned.
  Now paged; verified per paper against exact counts, all 10 match.
- **`getMasteryMap`'s `targetExam` could be forgotten.** TypeScript cannot make a
  parameter required after two optional ones, so it was `targetExam?: string` —
  i.e. exactly the silently-defaults-to-UPPSC shape M2 exists to remove. Changed
  to an options object so the compiler demands it.
- **`getGradedAnswers` and `recomputeMastery` read unranged.** Not truncating
  today (the heaviest real account has 359 graded answers), but a handful of full
  150-question mocks crosses the cap, and a truncated read there does not error —
  it silently drops answers from the weakness radar, the papers grid's accuracy
  and the mentor's learner profile at once, and silently DOWNGRADES mastery
  levels. Both paged and `.in()`-chunked.
- **A latency regression this change introduced**: `dashboard.ts` resolved the
  user's exam serially before its fan-out, adding a round trip to the app's
  hottest endpoint for one short column. Now fetched in parallel with the day's
  progress.

**Recorded, not fixed:**

- **Existing current-affairs embeddings are stamped `uppsc`, not shared.** All
  3,588 of them, from 0106's backfill. Correct today (every CA item is
  UPPSC-only), but `caEmbeddingExamCode` only applies to NEW writes — so before a
  second exam goes live, existing CA items need `exam_codes` recomputed and a
  `ca:embed --all` re-embed, or genuinely national items stay invisible to it.
  This is the one caveat to "no re-embed was needed"; it is true for syllabus,
  question and note chunks, and only conditionally true for CA.
- **40 published questions have no syllabus node**, so nothing derives their exam
  and their embeddings fall back to the default. Already an open question
  (`docs/OUTSTANDING.md` §8d M19); `ingest:embed` now warns with the count
  instead of being silent about it.
- **`getScoreTrajectory` renders a raw paper code** for an attempt on another
  exam's paper, since the title map is now exam-scoped. Unreachable today (there
  is no exam-switching UI — M13), and dropping such attempts silently would be
  worse than labelling them plainly.

### 3a. Daily quiz — ✅ resolved (M6)

Found by a post-0106 edge-case audit; none was a defect while one exam was live,
each broke the moment a second exam built daily quizzes. All fixed 2026-07-29,
plus a **fourth site the fix itself surfaced**:

- `services/daily.ts` `findDailyQuizRow` — was `(kind, is_published,
  scheduled_date, paper_code)` + `.maybeSingle()`. Two exams sharing a paper
  code on one date would **throw PGRST116 → 500**, not return the wrong row. Now
  exam-scoped, so the single-row expectation is true by construction rather than
  by an invariant enforced two tables away.
- `daily/quiz.ts` `upsertDailyQuizTest` — never set `exam_code`, so a second
  exam's quiz was silently tagged `uppsc` by the column default. Now explicit.
- `daily/quiz.ts` `recentlyUsedInDailyQuiz` — filtered on `paper_code` alone, so
  two exams' recency windows blended and one exam's quiz would suppress
  questions a different cohort had never seen. Now exam-scoped.
- **`currentAffairsPool` (found by the post-commit edge-case audit).** The other
  three slices scope through `paper_code`, but CA MCQs all sit under the
  synthetic `CURRENT_AFFAIRS` paper, so this one had nothing to scope by and
  pulled the UPPSC pipeline's current affairs into any exam's quiz. Proven by
  reverting the fix: a UPSC quiz with `includeCurrentAffairs: true` pulled a
  real UPPSC CA MCQ. Now filters `overlaps(exam_codes, [exam])`, matching the
  feed. (The original M6 verification missed it because the test variant had
  `includeCurrentAffairs: false`.)
- **`tests.slug`, the idempotency key (new).** It was `daily:<date>:<gs|csat>`,
  so two exams both building a "gs" quiz on one date would upsert onto the SAME
  row, each overwriting the other's paper, title and membership. A non-default
  exam now gets `daily:<date>:<exam>:<gs|csat>`; UPPSC keeps its historical bare
  slug so no existing row is orphaned.

`DailyQuizVariant` carries an explicit `examCode` rather than deriving it from
`paperCode`: the derivation would be *correct* (paper codes are globally unique)
but would still leave every read and write filtering on paper alone, which is
exactly how the four defects above arose. `listDailyQuizzes`/`ensureTodayQuizzes`
are exam-scoped too, and `variantsForExam` returns **empty** for an exam with no
daily quiz — an honest empty state rather than another exam's quiz.

Note `tests.paper_code` is still plain `text` with **no FK**, so nothing at the
DB level enforces §0 for that table — only `syllabus_nodes` is protected by a
unique index.

### 3d. Answer-writing boards + the rubric registry (M5)

`evaluations` gained two columns, both stamped at persist time by the registry:

- **`exam_code`** — the exam the answer BELONGS to (which board it competes on).
  This deliberately revises 0106 §13's "evaluations derive their exam via the
  question FK": `answer_submissions.question_id` is **nullable** (custom
  prompts), so it does not derive for every row, and the only remaining
  derivation is the author's *mutable* `target_exam` — which would retroactively
  re-bucket their entire answer history the day they switch exams. The exam an
  answer was written for is a fact about the past.
- **`rubric_kind`** (`gs`|`essay`) — the segmentation axis, so SQL can split
  without knowing any version string.

`RubricDefinition` gained `examCode` (the scheme's owner), `kind`, `paperCodes`
(empty = that exam's default) and `defaults` (word limit / max marks, which are
exam-specific — 700 words at 50 marks is UPPSC's essay, not UPSC's). A load-time
assertion rejects two default rubrics for one exam or two rubrics claiming one
paper, either of which would make `resolveRubric`'s answer depend on object key
order. A live exam with content but **no authored rubric** falls back to the
default exam's scheme rather than 500ing at the billing point — visibly, since
the persisted `rubric_version` still reads `v1`, while the evaluation's own
`exam_code` keeps that exam's users on their own board.

Also fixed alongside: the **daily** board pooled two exams' entirely different
quizzes into one ranking (now partitioned by the exam derived through `tests`),
and `demo:seed` left its seeded `essay-v1` rows on the `rubric_kind` default.

`scoreboard_rank_snapshots.board_key` gains the exam **only for a non-default
exam** (`week_start|upsc`). A user can hold rows in two exam buckets in one week
— they switched exams, and their earlier answers keep their original exam_code
by design — which under a bare key collides on
`unique(user_id, board_type, board_key, snapshot_date)`. Reformatting every
historical UPPSC key instead would make one week's board count as two in
`countDistinctBoardAppearances` and inflate the ">=3 boards" milestone.

### 3e. Community is separated per exam (M9 / M17)

The product decision (founder, 2026-07-29) is **exam-separated**.
`createThread` stamps the anchor's own exam (falling back to the creator's) and
`shareAnswerForPeerReview` — the system-created path `createThread` refuses —
stamps it too. `0110` backfilled every pre-existing thread to `uppsc`, which is
a fact rather than a default: `exams` was only created by 0106, `upsc`/`mppsc`
have zero content, and all 141 backfilled profiles are `uppsc`.

Reads filtered by the viewer's exam: `listThreadsForAnchor`, `getThreadDetail`,
`getCommunityHub` (recent **and** my-threads), `listSharedAnswers`,
`getSharedAnswer`. Participation writes gated identically, so a thread you
cannot read is one you cannot reply to or vote on: `addPost`, `votePost`.
`listSharedAnswers` was re-pointed to page over `discussion_threads` rather than
`shared_answers` (the exam lives on the thread, so paging the answers and
filtering afterwards returns short pages once two exams share the feed — this
also removed its per-row N+1 thread lookup).

A NULL `exam_code` still means "not exam-specific, visible to all" (0106 §12)
and every read admits it, so a genuine cross-exam announcement thread remains
possible. It simply stops being the accidental default.

### 3b. Fixed during the audit rather than deferred

- **`users_profile.target_exam` accepted a non-live exam.** `PATCH /profile
  {"target_exam":"upsc"}` validated and persisted, stranding the user in an app
  with zero syllabus nodes, questions and chapters, with no UI path back. The FK
  proves an exam EXISTS but cannot express "and it is ready". Fixed with
  `lib/exams.ts` `assertSelectableExam`, called from `updateProfile` — a 400.
- **`ingest/_shared.ts` redeclared `ExamCode`** as a local copy of the shared
  enum and had already drifted: it never gained `mppsc`, so the ingest pipeline
  could not classify or label an MPPSC paper — silently, with no typecheck error.
  It now re-exports the shared type, and both `EXAM_PREFIXES` and
  `classifyPyqId`'s regex derive from `examCodeSchema.options` so the pattern
  cannot fall behind the enum again.

### 3c. Known naming trap left in place (deliberate)

`GET /daily/cutoffs` takes a query param literally named `exam` whose value is a
PAPER code (`PRE_GS1`), mirrored in `use-mocks.ts`'s `useCutoffs(exam)` and its
query key. This is the exact collision 0106 §7 renamed the DB column to kill,
surviving one layer up at the HTTP boundary. It is behaviourally correct today
and predates this work; renaming it changes a public query param and a client
cache key, so it is recorded here rather than changed as a drive-by.

---

## 4. Product decisions (not decided by the schema)

**Decided 2026-07-29 (founder) — four of the five are now closed.** Each is
recorded with its reasoning in `docs/OUTSTANDING.md` §8d; the schema
consequences are summarised here so this file stands on its own.

| # | Decision | What it means for the schema |
|---|---|---|
| M15 | **Study chapters are exam-SPECIFIC**, authored by free coding-agent subagents, **drafted from the corresponding UPPSC chapter** where the topic is genuinely common. | Nothing changes: `notes.syllabus_node_id` stays UNIQUE, no join table, `notes:embed` / the reader / the review queue / `getPaperSummaries`' coverage counts are untouched. **The authoring rule is §5 — mandatory reading for any chapter-generation session.** |
| M17 | **Community is exam-separated** (see §3e). | Shipped with M9 + `0110`. |
| M18 | **One exam-agnostic price ladder**, for now. | Nothing changes: `plans` / `subscriptions` / `billing_events` carry no exam. Flagged for revisit in `docs/OUTSTANDING.md` §7 under the same "reopen only with explicit discussion" convention as the transparent-pricing call — **do not add per-exam plans as a drive-by**. |
| M19 | **No cross-exam question sharing.** | Nothing changes: `questions.syllabus_node_id` stays scalar, no `question_syllabus_nodes` join table. The sharing case that IS worth having is already built — current affairs (§5d). |

**Still open — M16: one exam per user, or several concurrently?** The schema
encodes **one** (`users_profile.target_exam` is scalar), reinforced by two
pre-existing keys: `study_plans unique(user_id) where is_active` and
`daily_quiz_board_entries unique(user_id, quiz_date)`. Changing that is a
product decision, not a migration.

---

## 5. Authoring study chapters for a second exam — READ THIS FIRST

> **This section is the standing instruction for every future chapter-generation
> session, for any exam.** It is not history. If you are about to generate,
> assemble or roll out study chapters, the rule below applies to you.

### 5a. The rule (M15 — founder decision, 2026-07-29)

**1. Chapters stay exam-SPECIFIC.** One `notes` row per syllabus node;
`notes.syllabus_node_id` stays UNIQUE. There is no `note_syllabus_nodes` join
table and no exam-agnostic body + per-exam overlay. Nothing downstream changes:
`notes:embed`'s per-section chunking, the reader's Study/Quick-Revision tabs,
the review queue's resolve-then-publish gate, and `getPaperSummaries`'
`chapters_published_count` all keep working exactly as they do for UPPSC.

**2. Authoring is done by free Claude Code subagents, NOT the paid
`notes:chapter` API path.** This is the reason duplication is affordable and it
is the crux of the decision: the "3x authoring and fact-audit cost" that made
M15 look expensive is a **one-time cost in agent time, not recurring API
spend**. **283 of the 284** existing chapters were authored this way for $0 of
app Anthropic spend (`model:'claude-code-agent'`, `meta.authored_by` — verified
live, not assumed). The single exception is one PRE_CSAT node regenerated
through the real API during an unrelated caching investigation on 2026-07-23
(`model:'claude-sonnet-5'`, `meta.authored_by:'api'`, $1.83) — which is also the
only per-chapter API cost ever actually measured, and it is roughly the ~$1.2
estimate `chapter-cli.ts` uses. See `docs/OUTSTANDING.md` A1 and CLAUDE.md
Sessions 28 / 28.5 / 29 for the working
fan-out mechanics (batches of **5**, then a checkpoint pass of assemble →
resolve fact-audit flags → `approveNote` → `embedNotes({nodeId})` **in
process**, never shelling out per note). The real-API path
(`pnpm notes:chapter`) stays reserved for production/cron use.

**3. Do NOT blank-slate author.** Where a topic is genuinely common across exams
— and most GS content is — **the corresponding UPPSC chapter is the starting
draft.** Read it, then tailor and expand it for the target exam's real emphasis.
Blank-slate re-authoring the same topic per exam wastes agent time twice over:
it re-does settled research, and it produces gratuitous divergence on facts that
are identical between exams (two chapters silently disagreeing on the same
figure is worse than one shared figure). Where a topic has **no** genuine UPPSC
counterpart (a paper or subject the source exam does not have), author it fresh
— the rule is "start from the counterpart where one exists", not "force a
mapping".

### 5b. What must be RE-DERIVED, never copied

Drafting from the UPPSC chapter is a starting point for **prose and settled
facts**. These five are exam-specific and must come from the target exam's own
context pack:

1. **PYQ id chips (`pyq_ids` on sections and boxes) — the one that fails
   SILENTLY.** `validatePyqIds` in `notes/chapter-assemble.ts` checks only that
   an id exists in `questions` **at all**; it has **no exam scoping**. So a
   copied UPPSC `pyq_id` resolves cleanly, passes the loader without a warning,
   and renders a chip deep-linking the reader to *another exam's* question.
   Always take ids from the target node's own `notes:chapter:context` pack.
   Tracked as **M21** in `docs/OUTSTANDING.md` §8c — until it is fixed, this is
   a human-discipline guard, not an enforced one.
2. **The state / regional angle.** In the DIGEST layer this is a literal field:
   `up_angle` on `noteBodySchema`, with `notes/prompts.ts` naming Uttar Pradesh
   in both the instruction and the JSON schema (a chapter has no such field —
   `chapter-persist.ts` writes `up_angle: ""` when it has to synthesise a digest
   — so in a chapter the angle lives in ordinary prose, boxes and section
   headings, which is exactly what makes it easy to carry across unnoticed). For
   another exam this is that exam's own state (MPPSC → Madhya Pradesh) or, for a
   national exam, not a state angle at all. Never carry UPPSC's UP paragraphs
   across.
3. **Weightage-driven emphasis and section order.** The pack's
   `weightage.total_pyqs` / `by_year` come from `mv_node_weightage` **for that
   exam**. A topic that is heavy in UPPSC can be light in UPSC and vice versa;
   section depth and ordering follow the target exam's numbers, not the source's.
4. **Exam-pattern references.** Paper names, marks, word limits and stage
   structure are per-exam and are seeded on `exams.paper_structure` (0106) — for
   example UPPSC's UP-specific GS-V/GS-VI papers have no UPSC counterpart, and
   UPPSC's 700-word / 50-mark essay defaults are not UPSC's.
5. **The fact-audit for anything changed.** Every rewritten or newly added
   decisive fact goes through the same web-search audit as a fresh chapter;
   `approveNote` blocks publish while any flagged/unverifiable fact is
   unresolved. A claim carried over genuinely unchanged keeps its existing audit
   entry — that reuse is the point of drafting from the counterpart.

### 5c. Mechanics

- Dump the target node's pack exactly as for UPPSC:
  `pnpm notes:chapter:context --node <uuid|PAPER_CODE> [--top N] --dir <dir>`.
  Everything it reads is scoped through the node, so it is exam-correct with one
  caveat: the weightage block comes from `mv_node_weightage` via
  `loadNodeWeightage`, which **every caller still invokes bare** and intersects
  by node id (§1c). That is correct today and stays correct under M19 (a
  question maps into exactly one exam's tree), but it sums across exams if a
  question tagged with one exam's *provenance* is ever mapped onto another
  exam's node — pass the exam if you hit that.
- **There is no CLI that dumps an existing chapter.** Read the counterpart's
  `notes.study_content_i18n` for the UPPSC node directly (service-role select,
  or the reader route). If cross-exam drafting becomes routine, the natural
  wiring is a `--source-node` flag on `notes:chapter:context` that inlines the
  counterpart chapter into the pack — deliberately not built ahead of a real
  second-exam rollout.
- Finding the counterpart is a **judgement call, not a title match**: syllabus
  trees differ in shape between exams, so one target node may draw on two UPPSC
  chapters or half of one. Say which source chapter(s) a draft came from in the
  session log.
- Load via `pnpm notes:chapter:assemble --file|--dir`, which is byte-identical
  downstream to a real-API chapter apart from the recorded author.
- **If you reach for the paid `pnpm notes:chapter` path anyway, know that it is
  UPPSC-hardcoded** — `notes/chapter-prompts.ts` names UPPSC in **8** places
  (outline persona, research persona, section-authoring persona, the grounding
  header, and both fact-audit personas) and takes no exam, so it would produce
  UPPSC-framed, UPPSC-fact-checked chapters for another exam **silently**. There
  is no guard. Tracked as **M22** in `docs/OUTSTANDING.md` §8c; the free-subagent
  path this decision mandates is unaffected, because its instructions are
  written per rollout rather than baked into that module.

### 5d. Where sharing IS the right answer (M19's other half)

M19 decided questions are **not** shared across exams — `questions.
syllabus_node_id` stays scalar. That is not a blanket "never share"; it is the
right answer for questions specifically, because a PYQ is an artefact of one
commission's paper and its provenance (`questions.exam_code`) is a fact about
which exam asked it.

The case where sharing genuinely is right is **already built, and is the model
to follow if another one appears**: current affairs. `current_affairs_items.
syllabus_node_ids` is a bare `uuid[]` (no FK, no cardinality limit) and
`exam_codes` is an array read with `overlaps`, so one national story maps into
several exams' trees from **one row** — never duplicated, never re-triaged and
re-enriched per exam (the two most expensive calls in `ca:run`), and its single
embedding row is stamped `exam_code = NULL` — "shared across all exams" — by
`ca/embed-exam.ts`, **precisely when it maps to more than one** (an item scoped
to a single exam is stamped with that exam, as it should be). No schema change
is needed for that case anywhere.
