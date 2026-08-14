-- =============================================================================
-- 0128_test_series_deferred_papers.sql
--
-- Let a series entry EXIST ON THE PUBLISHED CALENDAR BEFORE ITS PAPER IS
-- ASSEMBLED — which is how a real test series actually works, and which 0127
-- made impossible by requiring `test_id`.
--
-- WHY. The calendar is published months ahead: dates, per-test syllabus and
-- sources are the product a student buys (docs/test-series-design.md §2.4).
-- The PAPER is a different artefact with a different best moment. Assembling
-- all 25 or 35 papers up front freezes them against whatever the question bank
-- held on build day, and this bank is a FLOW, not a stock — `ca:run` publishes
-- ~90-100 items/day and `qgen:topup` now plans 395 shortfall nodes a night
-- (§6.6). A paper assembled the week it opens is drawn from a materially larger
-- and fresher pool than the same paper assembled eight months earlier.
--
-- Measured at the moment 0127's calendars were built: PRE_GS1 had 17 approved
-- generated MCQs and UPSC_PRE_GS1 had ZERO, so every full-length fell far short
-- of its requested qgen share and backfilled from PYQs. That is not a reason to
-- shrink the series — it is a reason to assemble later.
--
-- This also removes the only real argument for cutting the test count: supply
-- at BUILD time stops being the constraint, because each paper is built against
-- the bank as it will be, not as it is today.
--
-- WHAT CHANGES: `test_id` becomes nullable. Nothing else.
--   * NULL means "scheduled, not yet assembled". The row still carries
--     opens_at / closes_at / ranked_until / syllabus_note / sources / ca_window,
--     so the calendar renders in full from day one.
--   * `unique (test_id)` still holds and is still what makes
--     v_test_leaderboard's left join fan-out-free: Postgres treats NULLs as
--     distinct in a unique index, so any number of unassembled entries coexist
--     while at most one entry can ever claim a given test. The join predicate
--     `e.test_id = a.test_id` never matches NULL, so an unassembled entry is
--     simply absent from the board — which is correct, it has no attempts.
--   * The window gate is unaffected: an entry with no paper has nothing to
--     start, and the API refuses before a test id is ever needed.
-- =============================================================================

alter table public.test_series_entries
  alter column test_id drop not null;

comment on column public.test_series_entries.test_id is
  'NULL = scheduled but not yet assembled. The calendar is published months ahead; the paper is built shortly before it opens, so it is drawn from the bank as it will be rather than as it was on build day. See series/build.ts''s --window mode.';

do $$
begin
  -- Nullable now...
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'test_series_entries'
      and column_name = 'test_id' and is_nullable = 'NO'
  ) then
    raise exception '0128: test_series_entries.test_id is still NOT NULL';
  end if;

  -- ...but the uniqueness that v_test_leaderboard's left join depends on MUST
  -- survive. Dropping NOT NULL is safe only because this still holds.
  if not exists (
    select 1 from pg_constraint
    where conname = 'test_series_entries_test_key'
      and conrelid = 'public.test_series_entries'::regclass
  ) then
    raise exception '0128: unique(test_id) is missing — the board join could fan out';
  end if;
end $$;
