# Multi-exam foundation

Companion to migration `0106_multi_exam_foundation.sql`. That file holds the
schema and the per-table decisions; this file holds the **call-site audit** and
the **ordered prerequisites** for actually ingesting a second exam.

Status: **the four blocking prerequisites (M1-M4) are CLOSED** — migrations
`0107`/`0108` plus the call-site work below. `uppsc` is still the only `is_live`
exam, and `upsc`/`mppsc` still carry **zero** syllabus nodes, questions, chapters
or current affairs; what changed is that ingesting a second exam's content is no
longer unsafe.

**Verified by seeding a real second exam against the live DB, not by checking
that uppsc still works** — a throwaway `upsc` tree (`UPSC_PRE_GS1`), its own
embeddings, a shared NULL-exam chunk, a cached FAQ answer per exam, and a real
throwaway user whose `target_exam` is `upsc`: **32/32 assertions passed**,
covering isolation in *both* directions. Every synthetic row was deleted by an
id captured at insert time, and `exams.upsc.is_live` was restored.

Still open before a second exam goes LIVE: **M5-M9** (`docs/OUTSTANDING.md` §8b)
and the product decisions in §4.

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
| `community.ts:91` | `assertAnchorExists` | SAFE-BY-ID *(should also assert exam match)* |
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
| **`on-demand.ts:154`** | `resolveNodes` | **STILL OPEN (M7)** — untrusted body ids, only same-`paper_code` asserted. Not in M1-M4's scope. |
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
| **`tests.ts:259`** | `resolveOrderedNodes` | **STILL OPEN (M7)** — untrusted body ids, same-`paper_code` only. Not in M1-M4's scope. |
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
5. **`mv_mains_weekly_board` has no exam dimension** and would rank three exams'
   answer writing against each other. Fixing it also means the rubric registry
   gains an exam dimension — the `rubric_version <> 'essay-v1'` split is
   hardcoded in `0069` and `services/scoreboard.ts`.
6. **Decide the chapters question** (0106 §13): duplicate the 284 fact-audited
   chapters per exam (~90% identical content, 3x authoring and fact-audit cost),
   or make chapter bodies exam-agnostic with a `note_syllabus_nodes` join table
   plus a per-exam state-angle overlay replacing the hardcoded `up_angle`. This
   is a content-strategy call with a real cost, deliberately left open.
7. **Generalise the UPPSC-shaped CA fields** — `gs_papers text[]` assumes GS1-6
   numbering and `is_up_specific` assumes UP.

**Still open (M7), deliberately left out of the M1-M4 pass:** `community.ts:91`,
`on-demand.ts:154` and `tests.ts:259` accept untrusted node ids and assert only a
shared `paper_code`; they should assert a shared `exam_code` too.

**One partial that landed with (3) as a side effect:** `ca/pipeline.ts` now
writes `current_affairs_items.exam_codes` from the nodes triage actually chose,
instead of relying on the `{uppsc}` column default — because the item's embedding
row is stamped from that same set, and the two must not disagree. That closes the
second half of `docs/OUTSTANDING.md` §8b **M8** ("nothing recomputes it"). The
rest of M8 — `gs_papers` assuming GS1-6 numbering and `is_up_specific` assuming
UP — is untouched.

### 3a. Daily quiz — three sites that ride on the §0 invariant

Found by a post-commit edge-case audit. None is a defect today; each breaks the
moment a second exam builds daily quizzes.

- `services/daily.ts` `findDailyQuizRow` — selects by `(kind, is_published,
  scheduled_date, paper_code)` and ends in `.maybeSingle()`. Two exams sharing a
  paper code on the same date would make it **throw PGRST116 → 500**, not return
  the wrong row. Add `.eq("exam_code", …)`.
- `daily/quiz.ts` `upsertDailyQuizTest` — writes with `onConflict: "slug"` and
  never sets `exam_code`, so a second exam's quiz would be silently tagged
  `uppsc` by the column default. Set it explicitly.
- `daily/quiz.ts` `recentlyUsedInDailyQuiz` — filters on `paper_code` alone, so
  two exams' question-recency windows would blend.

Note `tests.paper_code` is plain `text` with **no FK**, so nothing at the DB
level enforces §0 for that table — only `syllabus_nodes` is protected by a
unique index. Daily-quiz idempotency itself is keyed on `tests.slug` (globally
unique, untouched), so the 0106 index widening cannot cause duplicates.

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

## 4. Open product decisions (not decided by the schema)

The schema deliberately encodes **one exam per user at a time**
(`users_profile.target_exam` is scalar), reinforced by two pre-existing keys:
`study_plans unique(user_id) where is_active` and
`daily_quiz_board_entries unique(user_id, quiz_date)`. Changing that is a
product decision, not a migration.

Still open: whether community is cross-exam (0106 §12 allows both — a NULL
`exam_code` means a general thread); whether pricing stays one ladder across
exams (`plans`/`subscriptions` are exam-agnostic today, see
`docs/OUTSTANDING.md` §7); and the chapters question in §3.6.
