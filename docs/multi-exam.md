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

Still open: §8c's ops items (M12, M42; **M21 and M23 are now closed**) and **M20** (the CA magazine
and its two UPPSC-shaped fields, deferred together — see §3 item 7). **M11 and M14
closed 2026-07-29** — M11 as a reasoned decision *not* to add a paper-code FK
registry (§0a, which also records the one place the invariant genuinely leaks:
the unguarded PYQ-ingest writer, now **M23**), M14 as a verified idempotency fix
to `0106`.

**The prompt layer landed 2026-07-30 and has its own standing instruction: §6.**
Every model-facing string in `apps/api` that named UPPSC now reads from
`lib/exam-config.ts`, verified by a 128-prompt byte-identity harness
(`pnpm prompts:snapshot`); the web app reads the registry through a new public
`GET /exams`. That closed **M13** (no exams route) and **M22** (chapter prompts
hardcoded UPPSC), and left **U6** — 74 unauthored config slots per non-UPPSC
exam, the authoring work a second exam actually needs (`docs/OUTSTANDING.md`
§8f). **§6 is required reading before authoring a second exam or touching any
`cache: true`.**

**The product decisions in §4 are now closed** (founder, 2026-07-29): community
is exam-separated (M17, §3e), **study chapters stay exam-specific and are
drafted from the corresponding UPPSC chapter — see §5, which every future
chapter-generation session must read first** (M15), pricing stays one
exam-agnostic ladder (M18), and questions are not shared across exams (M19).
**M16** (one exam per user, or several concurrently?) is implicitly settled by
U3's shipped switcher below in favour of "one, switchable" — flagged in
`docs/OUTSTANDING.md` §8d as a decision that should still go to the founder
explicitly, not one to treat as closed just because it was inherited from an
implementation.

**U5 (UPSC PYQ ingest) shipped 2026-07-31 — see §3h.** It closed **M23** first, as §0a
required, and uncovered a live production bug: the mentor had been answering
UNGROUNDED because `match_embeddings` timed out through PostgREST (migration
`0113`).

**U3 (exam selection UX) shipped and was verified live 2026-07-30 — see §3g.**
Onboarding gained an exam-picker step and Profile gained a switcher, both
built on the same `ExamPickerList` component and both rendering
`launch_scope_i18n` honestly (no fabricated dates — the field carries none).
Switching parks/restores the outgoing exam's streak (migration
`0111_user_exam_streaks.sql`) in the same statement that changes
`target_exam`, so a client never sees a half-applied state; the SRS deck stays
deliberately shared across exams (0106 §13). §3g's live verification found and
fixed two more bleed bugs beyond M1-M9 — `dashboard.ts`'s "Last 5 scores" /
"Accuracy by paper" and `attempts.ts`'s `listAttempts` (Practice History) —
both had zero exam scoping and both are now fixed the same way as `listTests`.

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
- **Fixed:** `getCutoffs` had an `examCode` parameter its only caller never
  passed (M24), so `GET /mocks/cutoffs` served UPPSC's cut-offs to everyone.
  Both parameters are required now. **A trailing defaulted exam parameter does
  not make a caller decide — it lets the caller keep the bug silently. This is
  the second time it has bitten** (`getMasteryMap`'s `targetExam`, §3f).
- **⚑ TRACKED AS M23 — DO THIS BEFORE THE FIRST `ingest:pyq` RUN OF A SECOND
  EXAM.** The prefix rule is enforced in `ingest:syllabus` only.
  `classifyPyqId` (`ingest/_shared.ts`) maps `upsc_prelims_2024_gs1` to a
  **bare `PRE_GS1`**, and `pyq-load.ts`'s `resolveSyllabusId` resolves a paper
  code to a node with **no exam filter** — so a second exam's PYQs would take
  UPPSC's paper code and attach to UPPSC's tree, silently. It is the exact
  mirror of M21/M22 for chapters: fix it as step 1 of U5, not afterwards. Today
  the only thing standing in the way is the convention *"never ingest
  `upsc_*`/`upsssc_*` files"* — which U5 is by definition the act of relaxing.

**Swept and deliberately LEFT paper-code-only — do not "fix" these as a
drive-by.** Every route that takes a paper code from the request was checked.
`getPaperTree`, `getPaperTrends` and `getTimeAttackTopics` all read
`syllabus_nodes` / `questions` filtered by `paper_code` alone with an untrusted
code, and that is the intended design: they serve **public, published reference
content** (`syllabus_nodes` is a content table with public read under 0053), the
UI never links across exams because `getPaperSummaries` is exam-scoped, and §0
blesses exactly this pattern for ~30 call sites. The boards are the different
case — `getTestBoard` already exam-checked `test_id`, so `getMockSeriesBoard`
was *inconsistent with its own sibling*, and M17 decided boards/community are
exam-separated, which makes serving another exam's board contradict a decision
rather than merely look odd. **If you ever do want to gate public syllabus
browsing per exam, that is a product decision, not a bug fix.**

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
- ~~**`getScoreTrajectory` renders a raw paper code** for an attempt on another
  exam's paper, since the title map is now exam-scoped. Unreachable today (there
  is no exam-switching UI — M13), and dropping such attempts silently would be
  worse than labelling them plainly.~~ **RESOLVED 2026-07-30 by U3** (see §3g):
  the `attempts` select itself now filters `.eq("tests.exam_code", examCode)`,
  so a cross-exam attempt can no longer reach this function at all — the
  fallback (`titleByPaper.get(paper_code) ?? {hi: paper_code, en: paper_code}`)
  now only fires for a same-exam paper with no `syllabus_nodes` depth-0 root
  (e.g. `CURRENT_AFFAIRS`), an unrelated, harmless edge case. And U3 shipped
  the exam-switching UI this note said made the concern unreachable, closing
  the "unreachable today" caveat from the other direction too.

### 3g. U3 — exam selection UX (2026-07-30) — ✅ shipped and verified live

The picker/switcher session `docs/OUTSTANDING.md` §8c's "M13 → U3 handoff"
checklist was written for. Onboarding gained a new step 2 of 4 (exam picker,
`components/ui-x/exam-picker-list.tsx`, `ExamPickerList`); Profile gained a
switcher card (`components/profile/exam-switcher-card.tsx`) with a
confirmation dialog; `services/profile.ts`'s `updateProfile()` gained a
**park/restore streak swap** on a `target_exam` change, backed by a new table
(migration `0111_user_exam_streaks.sql`, `(user_id, exam_code)` primary key,
owner-only RLS matching every other user-scoped table).

**Design: the active exam's streak columns on `users_profile` are UNCHANGED in
shape and meaning** — every existing reader (dashboard greeting, TopBar flame,
`GuidedTodayCard`, milestone `streak_7`/`streak_30` triggers) needed zero
changes, because those columns still mean "the currently active exam's live
streak state" at all times. `user_exam_streaks` is a parking spot for exams
that are NOT currently active: switching upserts the outgoing exam's current
scalar values into it, then reads (or defaults) the incoming exam's row and
writes those values back onto `users_profile` **in the same statement** that
changes `target_exam` — a swap, not a copy, so no history is lost in either
direction and a client never observes a half-applied state.

**Verified against a real throwaway account with real seeded UPPSC history**
(a genuine submitted MCQ attempt driven through the actual test-player UI, a
seeded streak, one manually-created SRS card) — not a fresh, contentless
account, which would have made the "does real content actually disappear and
come back" check trivial. `exams.upsc.is_live` flipped `true` temporarily
(the same sanctioned pattern M1-M9's own verification runs used), switched via
the real switcher UI: **zero** UPPSC content on dashboard, practice (incl.
History), learn, current-affairs, magazine (index/prelims/mains), scoreboard,
or revision; streak reset to a fresh state; switching back restored
`streak_count`/`last_active_date`/`streak_freezes`/`streak_freeze_used_on`/
`days_to_exam`/`next_exam_label_i18n` **byte-identically**, and the SRS card
added *while on the second exam* was still present afterward — the concrete
proof the deck really is shared across exams (0106 §13), not per-exam.
Confirmation dialog checked at 390px in Hindi: no horizontal overflow, all 3
bullets render legibly. `exams.upsc.is_live` restored to `false` at the end;
the throwaway account and every row it touched (`users_profile`,
`user_exam_streaks`, `attempts`, `srs_cards`, the auth user itself) deleted by
the explicit id captured at creation, verified 0 leftovers afterward.

**Two more live bleed bugs found by this pass, beyond what M1-M9 had already
closed** — both caught by *looking at rendered content* after switching, not
by re-reading the earlier fix's diff:

- **`services/dashboard.ts`'s `getPerformanceAndWeakness`.** The "Last 5
  scores" sparkline (`submitted` attempts query) had no exam filter at all,
  and "Accuracy by paper" was built straight from the exam-agnostic
  `getGradedAnswers(userId)` (shared with the papers grid and the mentor's
  learner profile, each of which does its own filtering) with no cross-check
  against the current exam. Live-visible result: a UPPSC CSAT attempt's
  `PRE_CSAT 50%` rendered on a UPSC dashboard's Performance Snapshot card,
  right next to a Weakness Radar that WAS correctly empty (its node lookup was
  already exam-scoped by M2) — the two cards silently disagreed with each
  other. Fixed: `submitted` now joins `tests!inner(exam_code)` and filters on
  it; `accuracyByPaper` is filtered against a `validPaperCodes` set built from
  the exam's own `syllabus_nodes` roots. **One trap caught before shipping,
  not after:** `CURRENT_AFFAIRS` is a synthetic `paper_code`
  (`lib/question-visibility.ts`) with no `syllabus_nodes` row for ANY exam —
  a naive "must have a real root" filter would have zeroed out every exam's
  current-affairs accuracy, a regression from the pre-fix (merely unscoped,
  not broken-for-everyone) behaviour. `validPaperCodes` always includes
  `CURRENT_AFFAIRS_PAPER_CODE` explicitly, matching
  `lib/question-visibility.ts`'s own precedent for the same code.
- **`services/attempts.ts`'s `listAttempts`** (backs Practice's History tab) —
  zero exam scoping, so a switched-away user's entire MCQ attempt history kept
  listing. Fixed with the identical `tests!inner(exam_code)` pattern already
  used by `listTests`/`startAttempt` (the earlier pass in this same session).

Both live-verified: the Dashboard's Performance Snapshot now reads "Complete a
test to see your score trend." / "No paper-wise accuracy yet." and Practice
History reads "No attempts yet" on the second exam, with the real UPPSC
content back on both after switching to UPPSC. `pnpm --filter api typecheck`
clean before and after each fix.

**Confirmed pre-existing, not a U3 regression:** asking the mentor
(`/doubts`, "New doubt") a real question while on the second exam does not
answer at all — it renders `exam-config: "mentor.teacherPlatformFraming" is
UNAUTHORED for exam "upsc". This slot carries examiner judgment and must be
researched and authored for upsc — never derived from another exam's text by
substitution (U6).` as the reply. Traced to `lib/exam-config.ts`'s `UNAUTHORED`
gate, committed (`27fd7d9`, `ac83785`) before this session started — see §6.
This is a **stronger** safety guarantee than "answers without citing UPPSC
content" (a total, loud refusal beats a soft degraded answer that might still
carry UPPSC-flavoured framing) and is explicitly out of U3's scope; U6 (74
config slots to research and author per non-UPPSC exam) is tracked separately
in `docs/OUTSTANDING.md` §8f.

### 3h. U5 — UPSC PYQ ingest (2026-07-31) — ✅ shipped, and the live bug it uncovered

**2,791 questions across 72 papers (2016-2026), 2,760 visible**, all from the official
`www.upsc.gov.in` host; 22/22 official answer keys with Set A confirmed; 5,670
embeddings; 927 `mv_node_weightage` rows. `upsc` is still `is_live: false`.
Full actionable index: `docs/OUTSTANDING.md` **§8i**.

**M23 was fixed FIRST, before the first `ingest:pyq` run**, exactly as §0a
prescribed. The decision that had been missing is now `productExamForProvenance`
in `ingest/_shared.ts`:

- a provenance exam that IS a product exam (uppsc/upsc/mppsc) ingests into
  **itself**, with exam-prefixed paper codes;
- a provenance-ONLY exam (`up_ro_aro`, `upsssc_pet`, `other`) keeps mapping onto
  the DEFAULT exam's shared prelims tree — the pre-existing deliberate overlap
  documented on `classifyPyqId`, not a fallback invented here.

Because every pre-existing id resolves to the default exam, whose prefix is `""`,
**all 70 existing manifest ids classify byte-identically to before** — verified,
not assumed. `resolveSyllabusId` additionally gained an explicit exam filter so
neither guard is load-bearing alone, and `pyq.ts` stopped hardcoding the product
exam (it threads `cls.productExam` as a REQUIRED parameter into every prompt
path — the M24 lesson). Live after loading: **0 UPSC questions on a UPPSC node,
0 UPPSC questions on a UPSC node, 0 questions on a `UPSC_*` code with a
non-`upsc` exam.**

**⚑ The find that matters most for the platform, not just for UPSC: the mentor
had been answering UNGROUNDED on the LIVE exam.** Every `match_embeddings` call
through PostgREST failed with `57014 statement timeout` at ~8s — every filter,
even `match_count=1` — while the same SQL on a direct connection ran in ~100ms.
`retrieveGrounding` degrades gracefully on an RPC error, so it returned **0
chunks silently** rather than erroring, which is why nothing surfaced it.

Root cause: **a `language sql` function is INLINED into the caller's statement.**
PostgREST executes RPCs as prepared statements, so Postgres switched them to a
GENERIC plan where `query_embedding` is an unknown parameter — and a generic plan
cannot use the HNSW index for the ORDER BY, so it fell back to a seq scan plus a
sort over 28k × 1536-dim vectors (measured: 20.6s with a 60s function timeout).
Migration **`0113`** converts both vector RPCs to **plpgsql + dynamic EXECUTE**,
which makes the body opaque to inlining. The negative results are worth keeping:
`pg_stat_activity` showed ZERO active backends during an 8s failure; RLS was
excluded (`service_role` has `bypassrls`); and `plan_cache_mode=force_custom_plan`
did NOT help — itself the proof, since a SET clause attaches to function
*execution* and an inlined SQL function never executes as one.

`0113` also fixes a **second, quieter** bug: with a post-filter, plain HNSW
returns only those of its `ef_search` (40) candidates that survive, so a
selective filter **silently under-returns** — `filter_exam_code='upsc'` asked for
8 and got 5. That bites the **smallest partition hardest, i.e. always the newest
exam**. Fixed with pgvector 0.8 `iterative_scan`: `relaxed_order` for
`match_embeddings` (callers consume the whole top-k) and `strict_order` for
`match_doubt_faq` (its top-1 similarity drives hard 0.95/0.86 cache thresholds).

**Also closed here: a cross-exam embedding leak this ingest itself introduced.**
`collectQuestionChunks` fell back to the DEFAULT exam for a question with no
syllabus node, under a comment reading *"every such row is UPPSC"* — true when
written, false the moment UPSC PYQs landed (~57 of them). Now falls back to
`paper_code`, which is globally unique across exams (§0) and exam-prefixed by
M23 — never to `questions.exam_code`, which is provenance.

**Three extractor bugs, all found by ONE invariant: summing `marks` per paper**
(a UPSC Mains GS paper is always 250). Every structural check passed on all
three. Sub-parts (`1.(a)`/`1.(b)`) collided on the integer `q_no` and one part of
every Q1-6 was discarded; Essay sections that both number 1-4 collided and lost 4
of 8 topics; and `marks: integer` could not represent 2016's 12.5. **Keep the
marks-total check** — it is the only thing that has ever seen this bug class.

**Still open after U5:** ~~**M21** (chapter `pyq_ids` validated for existence, not
exam)~~ **— M21 ✅ closed 2026-07-31, and U6 is down to 3 deliberate slots (§6f),
so neither gates a UPSC chapter rollout any more; `docs/multi-exam.md` §5's
re-derivation rule is the remaining discipline, and it is human, not enforced.**
Historically, **U6** gated every model-facing path —
U5 needed only **6** of U6's 74 slots, authored per-slot from directly observed
evidence (e.g. UPSC prints a large standalone series letter AND a separate T.B.C.
code whose own letters mislead — a booklet coded `HGY-D-LKUV` is Series **A**),
so the other 68 are untouched and still throw.

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
   SILENTLY — ~~and nothing catches it~~ **NO LONGER SILENT: M21 ✅ FIXED
   2026-07-31.** `validatePyqIds` in `notes/chapter-assemble.ts` now derives the
   chapter node's own exam (`examCodeForNode`) and scopes the check with
   `questionExamScopeFilter`, so a copied UPPSC `pyq_id` in another exam's
   chapter is **dropped with an explicit warning** naming the node's exam and
   saying the chapter was probably drafted from another exam's without being
   re-grounded. **`missing` (typo / truncated id) and `foreign` (copied draft)
   are reported separately because they mean different things.** It is now an
   enforced guard, not merely a human one — but still **take ids from the target
   node's own `notes:chapter:context` pack**, because the loader can only *drop*
   a wrong chip, never invent the right one, so a carried-over draft silently
   loses its PYQ chips rather than gaining correct ones.
   **Two limits of that guard, measured 2026-07-31 and recorded as `docs/OUTSTANDING.md`
   A11 + M44 — read them before relying on it.** (a) `validatePyqIds` runs **only at
   assemble time**; nothing re-validates a chapter once persisted, and **12 dangling
   `pyq_id`s are live in 8 published chapters right now** because the questions were
   deleted after the chapters were written. (b) `foreign` is **warn-and-drop, not a
   gate**, and the CLI still counts such a file in its `N/M chapter(s) assembled`
   line — so a copied chapter that loses *every* chip still reports as a success.
   For this workflow specifically, that is the case most worth knowing about.
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
- **The paid `pnpm notes:chapter` path is no longer UPPSC-hardcoded — but it now
  FAILS LOUDLY for an unauthored exam, which is the intended behaviour, not a
  bug.** M22 (resolved 2026-07-30, §6): `notes/chapter-prompts.ts` and
  `notes/prompts.ts` read `lib/exam-config.ts`, and `chapter-generate.ts` derives
  the exam from the node's own row (`row.exam_code`). Where it once would have
  produced UPPSC-framed, UPPSC-fact-checked chapters for another exam
  **silently**, it now throws naming the first unauthored field (e.g.
  `notes.outlineFacultyFraming`). **So running it for a second exam is gated on
  authoring that exam's `notes.*` config slots first (U6, §6a)** — the
  free-subagent path this decision mandates stays unaffected either way, because
  its instructions are written per rollout rather than baked into that module.

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

---

## 6. The prompt layer — `lib/exam-config.ts` — READ THIS BEFORE AUTHORING A SECOND EXAM

> **This section is a standing instruction, like §5.** Every model-facing string
> in `apps/api` that named UPPSC now reads from one module. If you are adding an
> exam, adding a prompt, or touching `cache: true`, the rules below apply to you.

Landed 2026-07-30 as a 9-commit sweep (`14a1493`..`27fd7d9`). Schema-side nothing
changed; `uppsc` remains the only `is_live` exam.

### 6a. The one rule: parameterise STRUCTURE, never JUDGMENT

`apps/api/src/lib/exam-config.ts` is the single source of every per-exam prompt
string. Each `uppsc` value is copied **byte-for-byte** out of the prompt it came
from — that is what made byte-identity provable. For `upsc` and `mppsc`, every
judgment-bearing slot is the `UNAUTHORED` sentinel (tracked as **U6** in
`docs/OUTSTANDING.md` §8f). **Re-measured 2026-07-31: `uppsc` 0 unauthored,
`upsc` 40, `mppsc` 96** — the "74 unauthored each" this section used to state is
stale, because the config has grown slots since it was written. `upsc` fell to 40
when the authoring pass filled 50 of them (§6e). **Measure, do not restate:** the
count is a property of the current object, not of a changelog.

**It is wrong to author a second exam's value by string-replacing "UPPSC" with
"UPSC" in UPPSC's text.** The severity anchor encodes empirical findings about
how Mains is *actually* marked (topper percentages, the 45-55%-per-answer
calibration recorded in `services/evaluation/prompts.ts`); the qgen, CA-relevance
and mentor slots encode one commission's examiner judgment. Those do not transfer
by renaming. Building any converted prompt for an unauthored exam **throws**,
naming the exam and the exact field:

```
exam-config: "evaluation.examinerFraming" is UNAUTHORED for exam "upsc".
This slot carries examiner judgment and must be researched and authored for
upsc — never derived from another exam's text by substitution (U6).
```

Two type-level decisions worth not re-litigating:

- **`UNAUTHORED` is a `unique symbol`, not a sentinel string** — verified
  empirically, not assumed: TypeScript refuses to interpolate it (TS2731),
  concatenate it (TS2469), or pass it where a string is wanted (TS2345). A
  sentinel *string* would have compiled and shipped into a live prompt. Even a
  forced cast renders `Symbol(unauthored-exam-config)`, not plausible prose.
- **`EXAM_CONFIGS` is typed `Record<TargetExamCode, ExamConfig>`**, so adding a
  fourth exam to the shared enum is a **compile error here until it is
  configured** — verified by temporarily adding `"bpsc"` (TS2741), then
  reverting. Do not weaken that type to a partial.

`TargetExamCode` / `TARGET_EXAM_CODES` / `DEFAULT_EXAM_CODE` are **imported from
`@neev/shared`, never redeclared**, and `paper_structure` / `launch_scope_i18n`
are **not copied into TypeScript** — they stay DB-authoritative (0106, verified
against commission notification PDFs), with `assertExamConfigMatchesRegistry()`
as a boot-time drift guard. This is the lesson of `ingest/_shared.ts`, which once
redeclared `ExamCode` as a local copy and **silently drifted on the very first
extension with no typecheck error** (§3b).

### 6b. The cache-partitioning rule, and the `[0]+[1]` gotcha

The sweep's central claim is that **per-exam text partitions every prompt cache
and destroys none.** A cache breakpoint keys on the segment *and everything
before it*, so:

- **Per-EXAM text is free.** It turns one cache entry into one entry per exam.
  Each exam keeps its own stable prefix and its own hit rate.
- **Per-REQUEST text in a cached prefix is fatal.** It makes the prefix vary per
  call and destroys the entry outright. Nothing per-request was added.

**⚑ The refinement that is easy to get wrong.** In the four two-segment builders
(`buildMcqGenParams`, `buildDescGenParams`, `buildNoteGenParams`,
`buildSectionParams`) the `cache: true` sits on segment `[1]`, so the cached
prefix is `[0]+[1]` — **the "uncached-looking" persona segment `[0]` is inside
the cache key.** Per-exam text there partitions correctly (that is what the
sweep added); anything per-request there would silently destroy `[1]`'s entry.

`sharedFeedbackContext` (evaluation strengths/improvements, cached segment `[0]`
shared byte-identically by both sibling calls) **deliberately carries no exam
text and gained none** — interpolating there would kill the N=2 sibling hit. Its
byte-identity between the two calls was re-verified in the audit.

### 6c. Minimum cacheable prefix — the trap that makes `cache: true` a silent no-op

A `cache: true` whose prefix is below the model's minimum simply does not cache.
No error, no warning, `cache_creation_input_tokens` just stays 0 forever.

| Model | Minimum cacheable prefix |
|---|---|
| `claude-haiku-4-5` | **4096** tokens |
| `claude-sonnet-5` | **1024** tokens |
| Opus 4.6 / 4.5 | 4096 tokens |
| Newest Opus | 512 tokens |

Two facts that make this un-guessable: haiku-4-5's minimum is **four times**
sonnet-5's, and the minimum is **not monotonic across generations**, so it cannot
be inferred from model recency — look it up. And **measure, do not estimate**:
`chars / 4` under-counts by ~30% at this codebase's real ~2.85 chars/token and
will tell you a failing prompt passes. Use `client.messages.countTokens` (free).

Of the **14** executable `cache: true` flags in `apps/api/src`, **5 are measured
no-ops** — all pre-existing, none caused by the sweep, each now annotated in
place with its own measured count: qgen `verifySystem` **107** (haiku, ~38× short
— no realistic growth reaches 4096), notes `CRITIC_SYSTEM` **206**, OCR
`buildTranscribeSystem` **270/280**, qgen `criticSystem` **611**, and
`buildTeacherPersona` **879 (en) / 888 (hi)**, the closest near-miss. Flags were
left in place deliberately: a below-minimum prefix is not billed the 1.25× write
premium either, and they become correct for free if a prompt grows. The canonical
write-up lives on `PromptSegment` in `lib/anthropic.ts`, where someone typing
`cache: true` actually looks.

**⚑ A REAL SECOND-EXAM TRAP: the mentor persona has +22 tokens of headroom.**
`buildMentorPersona` is the **only** cached segment on the generic-doubt path and
measures **1046 tokens (en) / 1055 (hi)** against sonnet-5's 1024 — of which
**102 tokens now come from config** (`mentor.testingLens` 81,
`mentor.platformFraming` 21). A second exam whose framing is **≥23 tokens
terser** silently drops under the minimum and Anthropic just stops caching: no
error, and every mentor doubt re-bills the full persona forever. **Shorter
per-exam text kills a cache just as surely as per-request text does.** Guarded by
a 2950-char floor in the snapshot harness (which runs in `--write` mode too, so
`--write` cannot bless a persona that fell below the line) and recorded at both
config keys. The WARN it prints for uppsc is accurate, not noise — the margin
genuinely is 22 tokens, and the honest fix if it becomes irritating is to
lengthen the persona, not to lower the threshold.

Separately, `ca/prompts.ts` has **zero** executable `cache: true` and its
item-text-first ordering is **load-bearing for quality**, not incidental —
hoisting the candidate list into `system` to cache it did cache (98.9%
`cache_read`) but regressed gate survivors 14 → 8 and mapped nodes 37 → 25,
about 3× beyond a 3-arm control's noise floor. Exam text is free there precisely
because nothing is cached. **Do not reorder that file.**

### 6d. The workflow — `pnpm prompts:snapshot`

`apps/api/scripts/prompt-snapshot.ts` assembles every reachable model-facing
prompt from **fixed fixtures** (no clock, random, DB or network) and diffs it
against the committed baseline at
`apps/api/scripts/__snapshots__/prompts.baseline.json` — currently **128 keys**.
Multi-segment systems are captured as `{segments:[{text,cache}]}`, so segment
boundaries and cache flags are part of the baseline: the cached-prefix
**structure** is guarded, not just the text. It was negative-tested (a mutated
baseline correctly reported CHANGED/MISSING/NEW and exited 1) — a harness that
always passes is worthless.

**Run it before and after any prompt-layer change.** For a second exam:

1. `pnpm prompts:snapshot` on a clean tree — it must report 128 byte-identical.
2. Author the exam's config values. **Every `UNAUTHORED` slot you fill is
   research, not translation** (§6a).
3. `pnpm prompts:snapshot` again — **the uppsc keys must still be byte-identical.**
   A diff there means you changed shared structure, not exam content.
   **⚑ CORRECTION (2026-07-31): "a new exam adds no keys" is true of every key
   EXCEPT ONE.** The harness dumps the **entire `RUBRICS` registry** into
   `rubric/RUBRICS:labels-and-weights`, so registering a rubric **for any exam**
   legitimately changes that key — it is not scoped to uppsc like the rest.
   Before re-baselining, prove the incumbent sub-objects (`v1`, `essay-v1`)
   byte-identical **individually**, then confirm `git diff --numstat` on the
   baseline shows **insertions only, 0 deletions**. A whole-key diff summary
   cannot distinguish "added a rubric" from "edited an existing one".
4. Watch the mentor-persona floor WARN (§6c). Below 2950 chars, the harness fails.

**Byte-identity alone is not sufficient proof** — it would also pass if nothing
had been parameterised. That is why each slice separately asserted that building
a converted prompt for `upsc`/`mppsc` **throws**, naming its own first-needed
field. And where a prompt was not snapshot-reachable, the stronger check is
comparing against the **pre-refactor literal extracted mechanically from
`git show <pre-refactor-sha>:<path>`** — never against today's output, which
would merely bless whatever the sweep produced.

Two limits of the harness, recorded honestly: prompts living in module-private
consts or inlined into the model call itself are only reachable once **exported**
(the sweep exported them as `memoisePerExam` builders, which is what makes them
verifiable at all); and for a CLI whose module ends in a bare `main().catch()`,
prompts were moved into a side-effect-free `ingest/prompts.ts` rather than
guarded with `argv` — this repo has a recorded incident where a scratch filename
ending in the same substring self-triggered a CLI.

### 6e. UPSC's prompt config — authored 2026-07-31 (50 of U6's slots)

`EXAM_CONFIGS.upsc` went from **90 UNAUTHORED to 40** (`notes` 20 + `misc` 20
remain). Authored: `relevanceLens` 2, `evaluation` 12, `qgen` 15, `mentor` 7,
`ca` 14. `mppsc` untouched at 96. Three rubrics were registered at the same time
(`upsc-gs-v1`, `upsc-essay-v1`, `upsc-ethics-v1`).

**The evidence standard actually used**, so a future author matches it rather
than lowering it. Every value came from one of two measured sources, never from
UPPSC's text with the name swapped (§6a):

- **The real UPSC PYQ corpus** — 2,791 rows ingested by U5, **read with
  pagination past PostgREST's 1000-row cap** (Prelims GS-I alone is 1,100 rows,
  so an unpaged read would have silently biased every percentage). This is what
  makes the qgen/mentor/CA guidance defensible: the statement-combination family
  is 55.3% of Prelims GS-I, **Assertion-Reason is 0 of 1,100**, "Critically
  examine" is only 2.3% of Mains stems, and **a third of Mains stems carry no
  directive verb at all**. UPPSC's own corpus differs on every one of those axes
  (A/R 6.6%, pair-matching 16.3% vs 3.4%, chronological 6.3% vs 0.5%), so
  reusing UPPSC's guidance would have over-produced two formats several-fold and
  emitted one UPSC has never set.
- **Sourced written-stage marksheets** for the severity anchor, with each figure
  labelled measured / interpolated / arithmetic-under-an-assumption in the
  comment above `UPSC_SEVERITY_ANCHOR`. **The trap it exists to block:** the
  widely quoted ~54% "topper" figure is the **blended written+interview**
  aggregate, and UPSC marks the interview far more generously (58-75%) than the
  written stage. An answer-writing evaluator never sees an interview, so
  anchoring near 54% inflates every score systematically — the anchor names the
  trap explicitly, because the model's own priors carry the blended number.

**Per-slot, not per-group.** `notes` and most of `misc` were deliberately left
`UNAUTHORED`: a slot is authored when a pipeline genuinely needs it, so the
sentinel keeps meaning "nobody has researched this yet" rather than decaying
into "somebody filled the group".

**The two things a future author most needs to know:**

1. **The mentor-persona cache floor (§6c, M26) binds you.** `upsc/en` came out
   at **3547 chars** against the harness's 2950 hard floor (uppsc reference
   2995), because `platformFraming` + `testingLens` supply **820 chars vs
   uppsc's 268** — ~216 tokens of headroom against uppsc's 22. That length is
   genuine UPSC-specific content, not padding. A **terser** exam silently
   disables the only cached segment on the generic-doubt path, with no error.
   The sanctioned fix is to lengthen the persona, never to lower the floor.
2. **The snapshot's `rubric/RUBRICS:labels-and-weights` key covers the WHOLE
   registry** — see the correction in §6d step 3. Registering a rubric for any
   exam legitimately changes it; verify the incumbent sub-objects individually
   before re-baselining.

**GS-IV gets its own rubric, and exactly one variant.** The load-bearing fact is
primary-source: UPSC's notification says GS-IV *"will include questions to test
the candidates' attitude and approach…"* and that *"questions may utilise the
case study approach"* — **a sentence with no counterpart anywhere else in the
notification**, since GS I-III, Essay and the Optionals are pure topic lists. So
`upsc-ethics-v1` re-weights and **redefines** `examples_data` (relabelled
"Realism & Practicability", explicitly *not* statistics or citations). Its
`kind` is **`gs`, not a third kind** — GS-IV is a General Studies paper and must
compete on the GS board, and `evaluations.rubric_kind` is a CHECK-constrained
column admitting only `gs`/`essay`, so a third kind means a migration *and* a
change to `mv_mains_weekly_board`'s segmentation.

The research recommended **two** sub-variants (theory vs case study); one was
shipped. Reasons and the reopening gate are recorded as **M33**
in `docs/OUTSTANDING.md` §8f — the short version is that the registry forbids
two rubrics claiming one paper code, the proposed discriminator is a hypothesis
at ~10-15% estimated error, and the `description` fields are prose read by a
model that sees the real question text, so they discriminate **conditionally**
better than a regex would. Two corrections worth preserving: the widely cited
GS-IV **"125/125" Section A/B split is wrong** (five real papers reconstruct to
**130/120**), and the "options → merits/demerits → recommend" arc is a
**coaching template, not a universal demand** — about half of real case studies
ask something structurally different, so a rubric hard-coding it would mis-score
half the corpus.

**Two real bugs were fixed in the same pass**, both invisible until a second
exam existed — worth knowing because they are the shape a third exam will hit:

- `services/evaluation/prompts.ts` compared the **literal `"essay-v1"`** in two
  places. `upsc-essay-v1` fails that test, so a UPSC essay would have been
  prompted as a GS "descriptive answer" and never seen `essayAnswerFraming` or
  the `MODEL ESSAY` framing. Both now ask the registry for the **kind**
  (`rubricKindOf(...) === "essay"`), the same fix `services/scoreboard.ts`
  already uses. **A version string is not a segmentation axis** — this is the
  identical lesson M5 recorded for the boards.
- `services/evaluation/rubric.ts` pinned its dimension descriptions to
  `DEFAULT_EXAM_CODE`, so **every** rubric's `examples_data` described UPPSC's
  "UP-specific data" — meaning a UPSC evaluation would have carried a
  state-specific instruction for a national exam, inside its **cached** system
  prompt. Descriptions now read the rubric's own `examCode`, and the essay word
  limit was parameterised too (it hard-coded "~700-word", flatly wrong for
  UPSC's ~1200).

**The noise-floor rule (the 3-arm control design) correctly did NOT apply**, and
this is provable rather than a judgement call: it governs changes to *shared*
prompt structure, where model nondeterminism makes a plain before/after
uninterpretable. `getExamConfig` is a pure per-exam lookup memoised per exam
code, so `upsc` values are **unreachable from any `uppsc` prompt** — the byte
output cannot change, and the snapshot proves it mechanically (128 keys
byte-identical). `ca/prompts.ts`'s ordering was not touched and no `cache: true`
was added or moved.

### 6f. UPSC's `notes` + `misc` — authored 2026-07-31 (the last 37 slots, and the 3 deliberate holdouts)

`EXAM_CONFIGS.upsc` went from **40 UNAUTHORED to 3** — `notes` 20 and `misc` 17
authored, `mppsc` still untouched at 96, `uppsc` still 0. The evidence standard
was §6e's unchanged: measured corpus and the hand-authored tree, never UPPSC's
text with the name swapped.

**⚑ THE 3 REMAINING SLOTS ARE A LIVE GUARD. DO NOT AUTHOR THEM.**
`misc.syllabusExpertFraming`, `misc.syllabusStructureNote` and
`misc.translateDomainHint` are read *only* by `ingest:syllabus`'s LLM-structuring
path, which must never run for UPSC — for two independently fatal reasons, both
verified:

1. `upsertNode` conflicts on **`(paper_code, path)`, the identical key the
   hand-authored seed writes under**, so an invented tree would overwrite the
   coverage-gated 195-node UPSC tree *in place*: `title_i18n` /
   `description_i18n` / `meta` replaced wholesale and `meta.source` flipped from
   `official_syllabus_hand_authored` to `official_syllabus`.
2. `loadLangSource` **hardcodes UPPSC's manifest ids**, so a successfully
   authored run would build UPSC's tree from UPPSC's syllabus PDF.

Authoring those slots removes a guard and adds no capability. `upsc`'s real path
is `pnpm ingest:upsc-syllabus` (hand-authored, zero-LLM, coverage-gated).

**The refusal is now deliberately redundant.** `ingest/syllabus.ts` carries an
explicit `LLM_STRUCTURABLE_SYLLABUS_EXAMS = ["uppsc"]` allow-list that refuses
*before* `readManifest`/`loadLangSource`, because the `UNAUTHORED` guard lives in
a different file from the thing it protects — a future bulk-authoring pass could
legitimately fill those slots for the mentor/qgen paths and silently unblock this
pipeline without anyone noticing. It is an allow-list rather than
`=== DEFAULT_EXAM_CODE` so that "which exams may be LLM-structured" and "which
exam is the default" stay separate questions. **Both guards were verified to fire
independently.**

**FOR THE NEXT AUTHOR — the snapshot now carries `:upsc` fixtures, so a new
exam's values are no longer invisible to the harness.** This is the single most
useful change here. Before this pass, *every* fixture was pinned to `uppsc`, so
"N prompts byte-identical" was predominantly a **UPPSC** regression check and a
second exam's prose had **zero** machine coverage. There are now **157** keys
(the raw file has 159 — 157 prompts plus `__unreachable__` and
`__not_reachable_without_editing__`), of which 27 mention `upsc`.

Two things follow, and both are load-bearing:

- **Add a `:upsc`-style fixture for every slot you author**, alongside the value.
  A key costs one line and is the only thing that will ever notice a boundary
  defect in your prose. Six `misc` slots authored in the U5 pass still have no
  fixture despite reachable, already-snapshotted builders
  (`translateQuestionsDomainHint`, `seriesPaperFraming`,
  `seriesBookletCodeNote`, `pyqNodeClassifyFraming`, `auditSolverFraming`,
  `auditEscalateFraming`) — closable with the same one-line-per-key pattern.
- **The snapshot proves byte-identity; it does not proofread.** A new key is
  whatever you wrote, so adding it *blesses* your prose rather than checking it.
  **Read the assembled string, and diff it against the `uppsc` sibling key.**

**Why that last point is not advice but a finding: three grammar bugs in this
work were invisible to typecheck AND to reading the raw values.** All three lived
at the *boundary* between a fragment and its host template. Two were caught
during authoring (an em-dash gloss opening a clause the template never closes,
so the template's own trailing "and what a topper must know" read as part of the
gloss; and the same shape in `pyqAnalysisFraming`). The third survived both and
was caught only by a later audit — `notes.outlineCompletenessLens`, whose own
in-file comment asserted it was fine ("the colon closes at the parenthesis"),
**which is false: a colon has no closing bracket.** The host is:

```
The EXAM defines completeness: plan sections that map to ${value} and what a
topper must know — never padding.
```

The value opened a *second* colon inside the template's first; its internal
`A, and B` list then captured the template's trailing `and what a topper must
know` as a third list item; and `(use the weightage + PYQ patterns)` — which
modifies the whole clause for `uppsc` — ended up scoped to the Mains item alone.
Fixed value-only, to two **parallel `in …` phrases**, so the template's trailing
`and what …` is not an `in`-phrase and cannot be read into the list. The `uppsc`
sibling had read cleanly the entire time, which is what made the defect obvious
in a one-line diff.

**A census gotcha worth not re-deriving:** count slots by **walking
`EXAM_CONFIGS`**, never by `rg UNAUTHORED` — this file's comments name the
sentinel constantly, so a grep over-counts badly. And note **`upsc` has 119 slots
where `uppsc` and `mppsc` have 120: that is CORRECT, not a missing slot.**
`RelevanceLens` is a discriminated union — `state_specific` carries `state`,
`national` does not — so `upsc` legitimately has no `relevanceLens.state`,
TypeScript forces the sole consumer (`ca/prompts.ts`) to narrow on `kind` before
reading it, and that consumer omits the "Source hints at <state> focus" line
entirely rather than rendering a borrowed or empty state name.

**Cache boundaries were checked and none moved.** Per-exam text *partitions* a
cached prefix (one entry per exam) and cannot push it below a floor the shared
scaffolding already sits under. One measurement is worth recording because it is
**not** exam-specific: `buildNoteGenParams`'s cached prefix is **817 tokens with
an empty context — already below sonnet-5's 1024 minimum today, for `uppsc` too**
— so that flag is inert for a sparse node and active for a rich one, i.e. the
same key both hits and misses depending on input. Tracked as **M43**; §6c's rule
stands — measure with `messages.countTokens`, never `chars/4`.
