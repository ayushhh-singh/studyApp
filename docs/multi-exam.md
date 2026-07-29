# Multi-exam foundation

Companion to migration `0106_multi_exam_foundation.sql`. That file holds the
schema and the per-table decisions; this file holds the **call-site audit** and
the **ordered prerequisites** for actually ingesting a second exam.

Status: **schema only.** `uppsc` is the only `is_live` exam. `upsc` and `mppsc`
exist as registry rows with real paper structures and honest launch-scope copy,
and carry **zero** syllabus nodes, questions, chapters or current affairs.

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

### 1a. Services

| Site | Function | Class |
|---|---|---|
| `attempts.ts:457` | `getAttemptResult` | SAFE-BY-ID |
| `community.ts:70` | `fetchNodeLabels` | SAFE-BY-ID |
| `community.ts:91` | `assertAnchorExists` | SAFE-BY-ID *(should also assert exam match)* |
| `dashboard.ts:156` | `getContinue` | SAFE-BY-ID |
| **`dashboard.ts:319`** | `getPerformanceAndWeakness` | **NEEDS-EXAM-FILTER** — whole table; `paper_code::path` key collides; also unranged (1000-row cap) |
| `entitlements.ts:320` | `listFreeNoteNodeIds` | SAFE-BY-ID (join) — free-notes bucket key must become `(exam_code, paper_code)` |
| **`learner-profile.ts:50`** | `buildNodeBuckets` | **NEEDS-EXAM-FILTER** — whole table, same shape as dashboard |
| `learner-profile.ts:175` | `buildRecentNodes` | SAFE-BY-ID |
| **`mentor/retrieval.ts:111,148`** | `resolveCitations` | **NEEDS-EXAM-FILTER** — ids come from the un-exam-scoped `embeddings` store (§3) |
| `mentor/teacher.ts:50` | `loadRelatedPyqs` | SAFE-BY-PAPER (helper) |
| `mentor/teacher.ts:120,139,148` | `loadAdjacentNodes` | SAFE-BY-ID — parent chain is exam-closed |
| `mocks.ts:88` | `topLevelByNode` | SAFE-BY-PAPER |
| `notes.ts:238,295` | `listReviewNotes` | SAFE-BY-ID (join) |
| **`on-demand.ts:154`** | `resolveNodes` | **NEEDS-EXAM-FILTER** — node ids are untrusted request body, only same-`paper_code` is asserted |
| `on-demand.ts:178` | `depth1AncestorIds` | SAFE-BY-ID |
| `on-demand.ts:196` | `depth1AncestorIds` | SAFE-BY-PAPER |
| **`on-demand.ts:209`** | `paperRootNodeId` | SAFE-BY-PAPER — but `.maybeSingle()` **hard-errors** if §0 is ever violated |
| **`profile-analytics.ts:47`** | `getScoreTrajectory` | **NEEDS-EXAM-FILTER** — all paper roots; duplicate keys overwrite paper titles |
| `question-reports.ts:151` | `listQuestionReportsQueue` | SAFE-BY-ID (join) |
| `review.ts:34,161` | `listReviewQueue` | SAFE-BY-ID (join) |
| `srs.ts:40` | `addNodeToRevision` | SAFE-BY-ID |
| **`syllabus.ts:74`** | `getSyllabusTree` | **NEEDS-EXAM-FILTER** — whole table, feeds the command palette; also unranged |
| **`syllabus.ts:94,99`** | `getPaperSummaries` | **NEEDS-EXAM-FILTER** — the papers grid; renders every exam's papers, double-counts topics |
| `syllabus.ts:117` | `getPaperSummaries` coverage | SAFE-BY-ID (join) — bucket key needs exam |
| `syllabus.ts:211` | `getPaperTree` | SAFE-BY-PAPER — `buildTree` assumes exactly one root |
| `syllabus.ts:371` | `getNodeDetail` | SAFE-BY-ID |
| `syllabus.ts:401` | `getNodeDetail` breadcrumb | SAFE-BY-PAPER |
| `syllabus.ts:480` | `getPaperTrends` | SAFE-BY-PAPER |
| **`tests.ts:259`** | `resolveOrderedNodes` | **NEEDS-EXAM-FILTER** — untrusted body ids, same-`paper_code` only |
| `time-attack.ts:177` | `getTimeAttackTopics` | SAFE-BY-PAPER — `idByPath` map would collide without §0 |
| `time-attack.ts:220` | `startTimeAttack` | SAFE-BY-ID |
| `tour.ts:141` | `getSuggestedChapterNode` | SAFE-BY-ID (join) — "best chapter" should be picked within the user's exam |
| `user-notes.ts:92,94` | user-note reads | SAFE-BY-ID (join) |
| **`user-notes.ts:198`** | `inferNode` | **NEEDS-EXAM-FILTER** — inherits the mentor/embeddings gap |
| **`lib/syllabus-subtree.ts:14,26`** | `resolveSubtreeNodeIds` | SAFE-BY-ID + SAFE-BY-PAPER — **one helper behind 8 call sites** |

No writes to `syllabus_nodes` exist in any service.

### 1b. Pipelines / CLIs

| Site | Function | Class |
|---|---|---|
| **`ca/syllabus-candidates.ts:23`** | `loadSyllabusCandidates` | **NEEDS-EXAM-FILTER** — whole tree into the CA triage prompt; ~3x prompt size and cross-exam misclassification |
| `ca/prelims-node.ts:17` | `getPrelimsCurrentAffairsNodeId` | SAFE-BY-PAPER — module-level cache must become per-exam |
| `ingest/embed-coverage.ts:46` | `eligibleSyllabus` | NEEDS-EXAM-FILTER *(report only, low severity)* |
| `ingest/pyq-load.ts:112` | `resolveSyllabusId` | SAFE-BY-PAPER — cache keyed by `paperCode`; **writes** `questions.syllabus_node_id`, so a §0 violation is permanent bad data |
| `ingest/pyq.ts:421` | `loadSyllabusTree` | SAFE-BY-PAPER |
| **`ingest/syllabus.ts:286`** | `upsertNode` | **WRITE** — `onConflict: "paper_code,path"`; must set `exam_code` on the row literal (`PaperDef` needs an exam) |
| `ingest/tests.ts:78` | `topLevelByNode` | SAFE-BY-PAPER — `titleByPaperTop` keyed `paper_code::top` |
| `ingest/verify.ts:43` | `main` | NEEDS-EXAM-FILTER *(report only)* |
| **`mastery/compute.ts:82`** | `recomputeMastery` | SAFE-BY-PAPER — `idByPaperPath` key would mis-attribute mastery without §0 |
| **`mastery/compute.ts:152`** | `getMasteryMap` | **NEEDS-EXAM-FILTER** when `paper` is omitted; already takes an unused `exam?` arg — wire it in |
| `notes/chapter-generate.ts:64,76` | `loadChildTitles`, `loadWeightage` | SAFE-BY-PAPER |
| `notes/generate.ts:61` | `loadNoteNode` | SAFE-BY-ID — select `exam_code`, three callers need it |
| `notes/generate.ts:84,339` | `loadWeightageSnapshot`, `topWeightageNodes` | SAFE-BY-PAPER |
| **`notes/generate.ts:325`** | `resolvePaperCode` | SAFE-BY-PAPER — `.maybeSingle()` **hard-errors** if §0 is violated |
| **`qgen/cli.ts:44`** | `resolveNodeId` | SAFE-BY-PAPER — same `.maybeSingle()` hazard |
| `qgen/generate.ts:106` | `loadNodeContext` | SAFE-BY-ID |
| **`qgen/topup.ts:101,115`** | `computeNodeTargets` | SAFE-BY-PAPER — `like 'PRE_%'`; safe **only** because §0 mandates a prefix. Add an explicit exam filter anyway |

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

Blocking items, in the order they bite:

1. **`ingest/syllabus.ts` must stamp `exam_code`** and `PaperDef` must carry an
   exam. Paper codes must be exam-prefixed (§0). Nothing else matters if this is
   wrong — a collision overwrites the UPPSC tree.
2. **Exam-scope the NEEDS-EXAM-FILTER reads** in §1a/§1b, in particular
   `syllabus.ts` (`getSyllabusTree`, `getPaperSummaries`), `dashboard.ts:319`,
   `learner-profile.ts:50`, `profile-analytics.ts:47`,
   `ca/syllabus-candidates.ts` and `mastery/compute.ts:152`. Most of these need
   the caller's `users_profile.target_exam` threaded through.
3. **`embeddings.exam_code` must be populated for real and `match_embeddings`
   must filter on it.** The column exists (0106 §9) but defaults to `uppsc`;
   `lib/embed-upsert.ts` still writes that default. A vector ANN search cannot
   be post-filtered by exam without wrecking recall, so this is a hard blocker —
   otherwise the mentor cites another exam's chapters.
4. **`doubt_faq_cache.exam_code` must be added to `match_doubt_faq`'s filter and
   to `upsertFaqCache`'s near-duplicate match** (0106 §10). Until then the
   global semantic cache serves one exam's framing to another exam's user with
   no model call and no visible tell.
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

Non-blocking but worth doing with (2): `community.ts:91`, `on-demand.ts:154` and
`tests.ts:259` accept untrusted node ids and assert only a shared `paper_code`;
they should assert a shared `exam_code` too.

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
