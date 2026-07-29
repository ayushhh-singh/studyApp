-- =============================================================================
-- 0110_discussion_threads_exam_backfill.sql — community is separated PER EXAM.
-- Closes docs/OUTSTANDING.md §8b M9 and decides §8d M17.
--
-- THE DECISION (product, confirmed by the founder 2026-07-29): community is
-- exam-separated, not cross-exam. A UPPSC candidate and a UPSC candidate are
-- preparing different syllabi from different question banks and sitting
-- different papers; a shared feed fills each of their hubs with threads about
-- papers they will never sit, and makes peer review — which only works between
-- people marked by the same scheme — actively misleading.
--
-- 0106 §12 added `discussion_threads.exam_code` (nullable, FK to exams) and the
-- partial index `(exam_code, updated_at desc) where moderation_status='visible'`
-- but deliberately left the product decision open, so NOTHING wrote the column
-- and every existing thread is NULL. This migration + the service-layer changes
-- in services/community.ts close that.
--
-- THE BACKFILL: every existing thread -> 'uppsc'.
--
-- This is not a guess dressed as a default. `uppsc` has been the ONLY exam that
-- has ever existed in this product: `exams` was created by 0106 (2026-07-29),
-- `upsc`/`mppsc` are seeded reference rows with zero syllabus nodes, zero
-- questions and zero chapters, and every one of the 141 profiles backfilled by
-- 0106 has target_exam='uppsc'. So every thread here was written by a UPPSC
-- candidate about UPPSC material. Deriving it instead — through the polymorphic
-- `anchor_id`, which has no foreign key and spans four tables — would be a
-- 4-way conditional join that arrives at exactly the same answer.
--
-- WHY NOT LEAVE THEM NULL: NULL means "not exam-specific — visible to
-- everyone" (0106 §12), which is a real and useful third state kept alive by
-- the reads (see examVisibilityFilter in services/community.ts). Leaving the
-- existing threads NULL would silently redefine it as "written before the
-- decision", and would show every historical UPPSC thread — anchored to UPPSC
-- syllabus nodes and UPPSC PYQs, most of them 404ing on click for anyone else —
-- to a second exam's users on day one. The state stays available for a genuine
-- cross-exam announcement thread; it just stops being the accidental default.
--
-- Written as an UPDATE ... WHERE exam_code IS NULL rather than a column
-- default: the service layer stamps every new thread explicitly, and a NOT NULL
-- DEFAULT here would take that decision away from it and re-create the exact
-- silent-tagging problem 0109's daily-quiz work removed elsewhere.
-- =============================================================================

update public.discussion_threads
   set exam_code = 'uppsc'
 where exam_code is null;

-- The hub's "my threads" list and getThreadDetail both filter by exam on a
-- non-`visible` row too (a user always sees their own flagged thread), which
-- the 0106 partial index — restricted to moderation_status='visible' — cannot
-- serve. This one covers the owner path.
create index if not exists discussion_threads_user_exam_idx
  on public.discussion_threads (user_id, exam_code, updated_at desc);
