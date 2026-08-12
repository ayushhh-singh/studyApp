-- =============================================================================
-- 0123_user_notes_doubt_threads_exam_scope.sql
--
-- Exam-scope the two remaining PRIVATE, user-owned content tables: "My notes"
-- (`user_notes`, 0066) and AI-Mentor conversations (`doubt_threads`, 0011).
--
-- Both were missed by the multi-exam sweep. 0106 §13 catalogued them under
-- USER-SCOPED, on the reasoning that a per-user table needs no exam dimension —
-- true while `uppsc` was the only exam. It stopped being true on 2026-08-11 when
-- `upsc` went live: a candidate who switches exams now carries every mentor
-- thread and every saved note from the other syllabus into their sidebar, with
-- no way to tell which is which.
--
-- VERIFIED BEFORE WRITING THIS (the task's own instruction, and the answer was
-- not what was assumed): `doubt_threads` had NO exam_code column and
-- `createThread` set none. 0106 touched `doubt_faq_cache` — the semantic FAQ
-- cache — NOT `doubt_threads`; the two are easy to conflate by name. Both
-- tables genuinely needed a column.
--
-- ---------------------------------------------------------------------------
-- WHY NULLABLE, AND WHY NULL IS LOAD-BEARING
-- ---------------------------------------------------------------------------
-- NULL means "exam unknown, or not exam-specific — visible to its owner under
-- ANY exam". Same third state as `discussion_threads.exam_code` (0106 §12), read
-- with the same predicate shape (`examVisibilityFilter` in services/community.ts:
-- `exam_code.eq.<exam>,exam_code.is.null`).
--
-- NOT `not null default 'uppsc'`, for two independent reasons:
--
--   1. 0110's argument, unchanged: a NOT NULL DEFAULT takes the decision away
--      from the service layer and silently tags every future row.
--
--   2. Stronger here than it was for 0110, because `upsc` is LIVE with real
--      users. A default would silently mis-file a UPSC user's note as `uppsc`,
--      and the row would then VANISH from the only list that shows it. On
--      PRIVATE content the user owns, that is data loss as far as they can tell.
--      Nullable + a read that admits NULL fails OPEN instead: a write path that
--      forgets the column leaves the row visible everywhere rather than nowhere.
--
-- ---------------------------------------------------------------------------
-- THE BACKFILL — derived from per-row evidence, not from a default
-- ---------------------------------------------------------------------------
-- 0110 could say "every existing row is uppsc" as a plain fact, because `upsc`
-- had zero content and zero users. That is NOT available here: `upsc` is live
-- and 5 of 174 profiles are on it. So each row was classified against evidence
-- measured on the live DB (2026-08-13):
--
--   * `user_exam_streaks` (0111) is the decisive signal. updateProfile parks the
--     OUTGOING exam's streak there in the same statement that changes
--     target_exam, so a row for exam X is written exactly when that user
--     switched AWAY FROM X. All 5 upsc-target users have a parked `uppsc` row,
--     so the moment each of them left UPPSC is known.
--
--   * Cross-checked against `syllabus_nodes.exam_code` via `user_notes`'
--     `syllabus_node_id` (6 of 15 rows carry one; all 6 resolve to UPPSC nodes,
--     zero contradict) and against `upsc.is_live` flipping on 2026-08-11.
--
-- Result — every row but four was created while its owner was on UPPSC:
--
--   user_notes      15 rows -> ALL 'uppsc'. Every one predates both 2026-08-11
--                              and its own owner's switch. No ambiguity at all.
--   doubt_threads  101 rows -> 'uppsc' (same reasoning)
--                    1 row  -> 'upsc'  (explicit id below)
--                    3 rows -> LEFT NULL (explicit ids below)
--
-- TWO SIGNALS THAT LOOK USABLE AND ARE NOT — do not re-derive from them:
--
--   * `llm_calls.exam_code` (0114) exists but the mentor never populates it:
--     NULL on every `mentor_*` row ever written. No signal.
--
--   * Stored message citations are SELF-CONTRADICTORY. 7 threads cite both
--     exams' notes, one of them within a SINGLE answer — verified not to be a
--     stamping fault (`embeddings.exam_code` matches its source node on all
--     1000 note chunks scanned) and not a current code fault (`retrieveContext`
--     passes a required `examCode` to both `match_embeddings` calls). Those
--     threads all date 2026-08-04..06; `filter_exam_code` defaults to NULL in
--     SQL by design (0107, so the migration could land before the API deploy),
--     so the likeliest explanation is a deployed API that predated the filter.
--     Historical rows, not a live leak — but it makes citations useless as
--     evidence of a thread's exam.
--
-- WHY THREE ROWS STAY NULL rather than being tagged: all three are the founder's
-- (an account that has switched exams 10 times, per its own activity timeline).
-- `user_exam_streaks` keeps only the LAST park per exam, so an earlier UPSC
-- period's start is unrecoverable, and these three sit inside that gap. Their
-- nearest PRECEDING activity is UPPSC in all three cases (7-15 min before, vs
-- ~20 h to the next UPSC activity) — but that activity is a syllabus-node view,
-- and node reads are deliberately NOT exam-scoped (public reference content,
-- docs/multi-exam.md §0a), so it is circumstantial, not proof. Tagging on a
-- coin-flip would hide one of the founder's own conversations from them;
-- NULL shows all three under either exam, which is both honest and harmless.
--
-- The `created_at` bound makes the backfill replay-safe AND fail-safe: a row
-- inserted between this file being written and being applied is not swept into
-- `uppsc` on a guess — it stays NULL, i.e. visible, and the service layer stamps
-- every row created after the deploy.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------
alter table public.user_notes
  add column if not exists exam_code text
    references public.exams(exam_code) on update cascade;

comment on column public.user_notes.exam_code is
  'Which exam this personal note was written under (FK exams.exam_code). Set from getUserExam() at save time and never changed afterwards — it records the syllabus the note was authored against, so it stays correct when the user later switches exams. NULL = exam unknown (pre-0123 row that could not be derived) and the note is shown under every exam; see the 0123 header.';

alter table public.doubt_threads
  add column if not exists exam_code text
    references public.exams(exam_code) on update cascade;

comment on column public.doubt_threads.exam_code is
  'Which exam this mentor conversation belongs to (FK exams.exam_code). Stamped from getUserExam() at thread creation. NULL = exam unknown (pre-0123 row that could not be derived) and the thread is shown under every exam; see the 0123 header.';

-- ---------------------------------------------------------------------------
-- 2. Backfill — user_notes: all 15 rows are UPPSC (evidenced; see header)
-- ---------------------------------------------------------------------------
update public.user_notes
   set exam_code = 'uppsc'
 where exam_code is null
   and created_at < '2026-08-13T00:00:00+00';

-- ---------------------------------------------------------------------------
-- 3. Backfill — doubt_threads
-- ---------------------------------------------------------------------------
-- The one genuinely-UPSC thread: created 2026-08-11T15:19:06Z, forty seconds
-- after its owner's `uppsc` streak was parked at 15:18:26Z — i.e. they switched
-- to UPSC and immediately opened the mentor. Set FIRST so the bulk update's
-- `exam_code is null` guard skips it.
update public.doubt_threads
   set exam_code = 'upsc'
 where id = '715ced37-0cd8-4a33-b297-1f002f7755db'
   and exam_code is null;

-- Everything else that predates this migration, EXCEPT the three ambiguous
-- founder threads, which are deliberately left NULL (see header).
update public.doubt_threads
   set exam_code = 'uppsc'
 where exam_code is null
   and created_at < '2026-08-13T00:00:00+00'
   and id not in (
     '4ee7e586-472c-4a68-b4b3-e7efef45e8c3',  -- 2026-08-01T14:18Z, founder
     'ca6b2538-c52d-44bf-9437-226bd3bb54bb',  -- 2026-08-01T14:20Z, founder
     '484796b1-249c-4e13-9379-7a48aede4457'   -- 2026-08-11T10:09Z, founder
   );

-- ---------------------------------------------------------------------------
-- 4. Indexes
-- ---------------------------------------------------------------------------
-- Both list queries are now (user_id, exam-or-null, ORDER BY recency). The
-- pre-existing `user_notes_user_idx` / `doubt_threads_user_idx` cannot serve the
-- added predicate, and are deliberately NOT dropped — `user_notes_user_node_idx`
-- still serves the `?node_id=` filter, and the plain user indexes still serve
-- the ownership-only by-id reads.
create index if not exists user_notes_user_exam_idx
  on public.user_notes (user_id, exam_code, created_at desc);

create index if not exists doubt_threads_user_exam_idx
  on public.doubt_threads (user_id, exam_code, updated_at desc);

-- ---------------------------------------------------------------------------
-- 5. Self-assertion (replayable — see docs/OUTSTANDING.md M14)
-- ---------------------------------------------------------------------------
-- Deliberately a SCHEMA assertion, not a row-count one. 0116 shipped a
-- count-based assertion that was true exactly once and failed on every replay
-- afterwards; the schema shape is what actually guarantees the property this
-- migration claims ("no existing row was reshaped, and NULL stayed meaningful"),
-- and it is true on a fresh apply AND on a replay.
do $$
declare
  bad text;
begin
  select string_agg(format('%s.%s(nullable=%s, default=%s)', table_name, column_name,
                           is_nullable, coalesce(column_default, 'none')), ', ')
    into bad
    from information_schema.columns
   where table_schema = 'public'
     and (table_name, column_name) in (('user_notes', 'exam_code'), ('doubt_threads', 'exam_code'))
     and (is_nullable <> 'YES' or column_default is not null);
  if bad is not null then
    raise exception '0123: exam_code must be NULLABLE with NO default (NULL is the "unknown / show under every exam" state). Offending: %', bad;
  end if;

  if (select count(*) from information_schema.columns
       where table_schema = 'public'
         and (table_name, column_name) in (('user_notes', 'exam_code'), ('doubt_threads', 'exam_code'))) <> 2 then
    raise exception '0123: expected exam_code on BOTH user_notes and doubt_threads';
  end if;

  -- Every non-null value must be a real exam (the FK guarantees it; assert the
  -- FK itself exists, since a dropped constraint would be silent).
  if (select count(*) from information_schema.table_constraints tc
        join information_schema.key_column_usage kcu
          on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
       where tc.table_schema = 'public' and tc.constraint_type = 'FOREIGN KEY'
         and tc.table_name in ('user_notes', 'doubt_threads')
         and kcu.column_name = 'exam_code') <> 2 then
    raise exception '0123: exam_code must carry an FK to exams(exam_code) on BOTH tables';
  end if;
end $$;
