-- =============================================================================
-- 0124_srs_exam_scope_and_null_thread_backfill.sql
--
-- Two live cross-exam leaks the founder reported after 0123, both measured on
-- the live DB (2026-08-13). Unrelated causes, one migration because both are
-- small data/column changes in the same reported symptom.
--
-- =============================================================================
-- PART 1 — three community peer-review threads with a NULL exam_code
-- =============================================================================
-- 0110 backfilled every `discussion_threads` row to 'uppsc' and the service
-- layer stamps every new one, so NULL should have been unreachable. It was not:
-- `shareAnswerForPeerReview` — the SYSTEM-created path, which `createThread`
-- deliberately refuses and which therefore does its own insert — did not stamp
-- the column when it shipped. Three threads were created through it on
-- 2026-08-06, AFTER 0110's backfill, so they escaped both. That gap is already
-- closed in code (services/community.ts stamps `getUserExam(userId)` there now,
-- and a later thread on 2026-08-09 carries 'uppsc' correctly) — this is the
-- data half.
--
-- WHY THIS WAS VISIBLE AND WHY IT LOOKED LIKE 0123 HAD NOT WORKED: NULL means
-- "not exam-specific — visible under every exam" (0106 §12), so these three sat
-- in EVERY user's community hub and peer-review feed regardless of exam. A UPPSC
-- candidate was being shown UPSC Mains peer-review threads, and a UPSC candidate
-- saw three threads where the exam filter should have shown them none.
--
-- BACKFILL TARGET: 'upsc', which is the ANCHOR's exam, not merely the owner's
-- current one — both agree here, and the anchor is the stronger evidence. All
-- three anchor `shared_answers` rows whose submission's question is a real UPSC
-- paper (UPSC_MAINS_GS1 ×2, UPSC_MAINS_GS3), i.e. answers written against the
-- UPSC syllabus, so UPSC's community is where peer review of them belongs.
--
-- Targeted by EXPLICIT ID rather than `where exam_code is null`: a bare
-- predicate would also sweep any FUTURE genuinely-cross-exam announcement
-- thread, which is a state 0106 §12 deliberately keeps available.
-- =============================================================================

update public.discussion_threads
   set exam_code = 'upsc'
 where exam_code is null
   and anchor_type = 'shared_answer'
   and id in (
     '1f8ec991-2961-451c-9984-f5ea27b71507',  -- 2026-08-06, anchors a UPSC_MAINS_GS1 answer
     '195cdfe4-8f9f-47bf-8023-bbfa0618bcfe',  -- 2026-08-06, anchors a UPSC_MAINS_GS1 answer
     'e695e0a5-c9e7-4fac-b347-7f718ada989a'   -- 2026-08-06, anchors a UPSC_MAINS_GS3 answer
   );

-- =============================================================================
-- PART 2 — srs_cards.exam_code: the revision deck becomes exam-scoped
-- =============================================================================
-- ⚑ THIS DELIBERATELY REVERSES 0106 §13's recorded decision that the SRS deck is
-- shared across exams ("a user switching exams should keep their deck"), on the
-- founder's explicit report. Do not restore the old behaviour without a fresh
-- decision — the reasoning below is why it changed.
--
-- The old decision optimised for not LOSING cards. Measured, what it actually
-- produced is worse than the loss it avoided: the one user on a second exam has
-- 14 of 14 cards sourced from the OTHER exam's questions, so their entire daily
-- review — the one feature whose whole value is drilling what they are about to
-- be examined on — was UPPSC PYQs for a UPSC candidate. Nothing is lost by
-- scoping it, because the cards are not deleted: they reappear the moment that
-- exam is selected again, exactly like `user_exam_streaks` parks a streak.
--
-- NULLABLE, and NULL = "not exam-specific → due under every exam", the same
-- third state as 0123 and `discussion_threads`. That is the load-bearing choice
-- here, because most of this table is NOT resolvable to an exam after the fact.
-- Measured, by `source_type` as actually used:
--
--   130 cards = 83 `manual` + 37 `question` + 10 `current_affairs`
--   of which exactly 29 have a `source_id` that is a real `questions.id`
--
-- Everything else carries a **sha256-DERIVED** uuid-shaped `source_id` —
-- deliberately, so that re-adding the same source is idempotent under the
-- `(user_id, source_type, source_id)` unique index — and a hash cannot be
-- resolved back to what it was made from. That covers ALL of `manual` (which is
-- overloaded: syllabus-node cards, note decks, note blocks, evaluation
-- takeaways, personal-note decks and genuinely hand-written cards all use it)
-- and all of `current_affairs`.
--
-- ⚑ CORRECTION, and the reason this paragraph is worth reading carefully. An
-- earlier draft of this file claimed "a left join of every card's source_id
-- against syllabus_nodes matches ZERO rows, so there is no node-sourced backfill
-- to write". THAT WAS FALSE: it was read off a TRUNCATED query result whose
-- `manual` row was cut off, and `manual` is precisely where the node-sourced
-- cards live (`addNodeToRevision` writes source_type='manual' with the real node
-- id). Re-measured with paged reads: 8 `manual` cards carry a real
-- `syllabus_nodes.id` and 2 carry a real `answer_submissions.id`. The draft also
-- tried `source_type = 'node'`, which the replay test rejected outright because
-- `srs_source_type` has no such value — the enum's values in use are exactly
-- `manual`, `question`, `current_affairs`.
--
-- This migration deliberately still writes only the ONE `question` backfill,
-- because the rest needs application code, not SQL: the derived ids are sha256
-- hashes that have to be RE-COMPUTED from `notes`/`user_notes`/
-- `current_affairs_items` and matched back. That ran as a one-off pass
-- immediately after this migration (see the commit message): it stamped a
-- further 78 cards — 68 by recomputing the three derived-id formats, 10 by the
-- direct node/submission ids above — taking the table to 107 classified and 23
-- NULL, of which 9 are genuinely hand-written cards whose `source_id` IS NULL and
-- which correctly stay NULL forever.
--
-- Nothing is taken away by any of it: every write path stamps the column from
-- here on (it knows the exam at add time, where this migration cannot recover
-- it), so the unresolvable set only ever shrinks. The 8 `question` cards that do
-- NOT resolve point at a question that has since been deleted.
--
-- NOT `not null default`: it would silently tag all 101 unresolvable cards as
-- UPPSC and make a real UPSC user's own note-deck and CA cards vanish — the same
-- argument as 0123, and worse here because the mis-tagged majority is invisible
-- rather than merely wrong.
-- =============================================================================

alter table public.srs_cards
  add column if not exists exam_code text
    references public.exams(exam_code) on update cascade;

comment on column public.srs_cards.exam_code is
  'Which exam this card is revision for (FK exams.exam_code). Stamped at add time from the source''s exam. NULL = not exam-specific — the card is due under every exam; that is the state for a pre-0124 card whose source_id is a sha256-derived idempotency key and so cannot be resolved. Reverses 0106 §13''s shared-deck decision; see the 0124 header.';

-- The ONE resolvable backfill — cards sourced from a real question, classified
-- through that question's SYLLABUS NODE. Never through questions.exam_code,
-- which is PROVENANCE and whose domain includes exams nobody can select
-- (up_ro_aro, upsssc_pet) whose PYQs legitimately sit in the default exam's
-- bank; the assertion at the foot of this file would catch that mistake.
update public.srs_cards c
   set exam_code = n.exam_code
  from public.questions q
  join public.syllabus_nodes n on n.id = q.syllabus_node_id
 where c.exam_code is null
   and c.source_type = 'question'
   and c.source_id = q.id
   and c.created_at < '2026-08-13T00:00:00+00';

-- The due-queue and stats reads are (user_id, exam-or-null, due_at-from-jsonb).
-- The 0010 indexes cannot serve the added predicate; both are kept (they still
-- serve the ownership-only by-id reads and `submitReviews`).
create index if not exists srs_cards_user_exam_due_idx
  on public.srs_cards (user_id, exam_code, ((fsrs_state ->> 'due_at')));

-- ---------------------------------------------------------------------------
-- Self-assertion — SCHEMA-shaped, so it holds on a fresh apply AND on a replay
-- (0116 shipped a row-count assertion that was true exactly once).
-- ---------------------------------------------------------------------------
do $$
declare
  bad text;
begin
  select format('nullable=%s default=%s', is_nullable, coalesce(column_default, 'none'))
    into bad
    from information_schema.columns
   where table_schema = 'public' and table_name = 'srs_cards' and column_name = 'exam_code'
     and (is_nullable <> 'YES' or column_default is not null);
  if bad is not null then
    raise exception '0124: srs_cards.exam_code must be NULLABLE with NO default (NULL = due under every exam, and 101 of 130 cards cannot be resolved to an exam). Got %', bad;
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'srs_cards' and column_name = 'exam_code'
  ) then
    raise exception '0124: srs_cards.exam_code is missing';
  end if;

  if not exists (
    select 1 from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu
        on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
     where tc.table_schema = 'public' and tc.constraint_type = 'FOREIGN KEY'
       and tc.table_name = 'srs_cards' and kcu.column_name = 'exam_code'
  ) then
    raise exception '0124: srs_cards.exam_code must carry an FK to exams(exam_code)';
  end if;

  -- A card must never claim an exam its own source contradicts. Cheap, and it
  -- would catch a future backfill that resolved through questions.exam_code
  -- (provenance) instead of the syllabus node.
  if exists (
    select 1 from public.srs_cards c
      join public.questions q on q.id = c.source_id
      join public.syllabus_nodes n on n.id = q.syllabus_node_id
     where c.source_type = 'question' and c.exam_code is not null and c.exam_code <> n.exam_code
  ) then
    raise exception '0124: a question-sourced srs_card disagrees with its question''s syllabus-node exam';
  end if;
end $$;
