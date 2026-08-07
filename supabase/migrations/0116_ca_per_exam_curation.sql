-- 0116_ca_per_exam_curation.sql
-- M20b — per-exam Mains paper placement + per-exam state focus on the SHARED
-- current-affairs row. Closes docs/OUTSTANDING.md §8c M20b.
--
-- ---------------------------------------------------------------------------
-- THE DEFECT THIS CLOSES
-- ---------------------------------------------------------------------------
-- `current_affairs_items` is deliberately ONE row shared across exams (0106 §11:
-- a national story maps into several exams' trees precisely so it is not
-- duplicated and its two most expensive LLM calls are not re-paid per exam).
-- But two of its columns are a single exam's VERDICT, not a property of the
-- story:
--
--   gs_papers text[]        -- which Mains GS papers the item feeds
--   is_up_specific boolean  -- whether it is state-focused
--
-- `ca/exam-fanout.ts`'s `mergeExamTriages` folds N per-exam verdicts onto that
-- one row by UNION (gs_papers) and OR (is_up_specific). Both collapses are
-- lossless at N=1 and LOSSY at N>1 — and the loss is silent and wrong, because
-- the `GS1..GS4`/`ESSAY` namespace COLLIDES across commissions while the
-- syllabi do not: UPPSC sets six Mains GS papers, UPSC four, and their contents
-- differ concretely (UPPSC GS2 carries "Uttar Pradesh Specific Governance and
-- Administration Issues", which UPSC GS2 does not; UPSC GS1 carries "History of
-- the World", which UPPSC GS1 does not).
--
-- So the moment one row carries two exam codes, each exam's Mains magazine
-- edition renders the OTHER commission's placements under its own paper
-- headings. Measured on the live corpus (2026-08-08): of 2,244 published
-- mains-life items, 2,243 carry a gs_papers assignment and 969 carry more than
-- one paper — 3,224 placements total, of which only 101 (GS5_UP + GS6_UP) are
-- structurally blocked by the per-exam enum, leaving **3,123 placements that
-- would be inherited wholesale from UPPSC triage into a UPSC edition**.
--
-- `ca:widen-exam` reaches the same defect from the other side: it declares
-- `gs_papers`/`is_up_specific` forbidden columns by design (it does not
-- re-triage, so it has no verdict to write), which leaves UPPSC's assignment
-- verbatim on a row it has just widened onto another exam.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS MIGRATION DOES — AND WHAT IT DELIBERATELY DOES NOT
-- ---------------------------------------------------------------------------
-- Two ADDITIVE, NULLABLE columns. There is no `UPDATE`, no `ALTER` of an
-- existing column, no backfill, and no index change, so **not one existing row
-- is touched or reshaped** — the whole UPPSC corpus reads back byte-identically
-- after this migration, which is what makes it safe to apply to the project
-- that serves dev AND production.
--
--   gs_papers_by_exam jsonb   -- { "<exam_code>": ["GS1","GS3"], ... }
--   state_focus       text[]  -- state codes this item is focused on, e.g. {UP}
--
-- ⚑ NULL IS LOAD-BEARING, ON BOTH COLUMNS. It means "written before this
-- migration, so fall back to the legacy column", and it is the ONLY thing that
-- lets the legacy value keep serving the exam that produced it while being
-- withheld from every other exam. A `not null default '{}'` would have been
-- indistinguishable from a genuine "this exam assigned no paper / no state
-- focus" and would have silently blanked all 4,459 existing rows' curation.
-- Do not add a default to either column.
--
-- The legacy columns are NOT dropped and NOT deprecated in this migration:
-- `gs_papers` and `is_up_specific` stay exactly as they are, remain written by
-- the pipeline, and remain the fallback for pre-migration rows. Read resolution
-- lives in `apps/api/src/ca/curation-scope.ts` (pure, unit-asserted); writes are
-- funnelled through `withExamScope` in `apps/api/src/ca/exam-fanout.ts`, which
-- makes omitting either new column a COMPILE ERROR rather than a silent default
-- — the same enforcement that was added after the published/draft insert was
-- found to have silently taken the `exam_codes` column default.
--
-- WHY `state_focus` IS AN ARRAY AND NOT A SCALAR CODE. It generalises a boolean
-- that `mergeExamTriages` already ORs across exams. A scalar would force that
-- merge to pick ONE winner and discard the rest — the same lossy collapse this
-- migration exists to remove, reintroduced one level down. An interstate story
-- (a UP-MP river dispute) is honestly focused on both; `{UP,MP}` says so.
--
-- WHY A jsonb MAP AND NOT A CHILD TABLE. The value is a small, always-read-
-- whole, per-row attribute of a row that is already fetched in full by every
-- consumer; a child table would add a join to five magazine reads and the CA
-- feed to hold at most one short array per live exam.

alter table public.current_affairs_items
  add column if not exists gs_papers_by_exam jsonb,
  add column if not exists state_focus       text[];

comment on column public.current_affairs_items.gs_papers_by_exam is
  'M20b. Per-exam Mains GS paper placement: {"<exam_code>": ["GS1",...]}. NULL = written '
  'before 0116; resolve via ca/curation-scope.ts, which falls back to the legacy gs_papers '
  'column for the DEFAULT exam only. An explicit [] means "this exam triaged the item and '
  'assigned it no Mains paper" and is NOT the same as an absent key.';

comment on column public.current_affairs_items.state_focus is
  'M20b. State codes this item is focused on, e.g. {UP}. Generalises is_up_specific, which '
  'is one commission''s verdict OR-ed onto a shared row. NULL = written before 0116; resolve '
  'via ca/curation-scope.ts, which falls back to is_up_specific for the DEFAULT exam only. '
  'A national exam has no state lens and therefore never matches, whatever this column says.';

-- ---------------------------------------------------------------------------
-- Assert the "touches nothing" property rather than claiming it.
--
-- ⚑ THE ASSERTION IS ON THE SCHEMA, NOT ON THE DATA, AND THAT IS DELIBERATE.
-- The first version of this block counted rows and demanded ZERO non-null ones.
-- That was correct exactly once — at first apply — and made the file
-- NON-REPLAYABLE from the moment the pipeline wrote its first row (verified:
-- re-running it against the live DB failed with "74 row(s) are non-null"), which
-- breaks the standard docs/OUTSTANDING.md M14 sets for every migration here.
--
-- What actually guarantees "no existing row was touched or reshaped" is that
-- both columns are NULLABLE and carry NO DEFAULT: a `not null default '{}'`
-- would have given every pre-existing row a value and destroyed the NULL
-- sentinel the read path depends on, whereas a nullable, defaultless ADD COLUMN
-- cannot change what any existing row means. That property is a fact about the
-- schema, so it is true on the first apply AND on every replay.
-- ---------------------------------------------------------------------------
do $$
declare
  bad text;
begin
  select string_agg(
           format('%s (nullable=%s, default=%s)', column_name, is_nullable, coalesce(column_default, 'none')),
           '; ')
    into bad
  from information_schema.columns
  where table_schema = 'public'
    and table_name   = 'current_affairs_items'
    and column_name in ('gs_papers_by_exam', 'state_focus')
    and (is_nullable <> 'YES' or column_default is not null);

  if bad is not null then
    raise exception
      '0116: % — both columns MUST stay nullable with no default. NULL is the sentinel meaning '
      '"written before 0116, fall back to the legacy gs_papers / is_up_specific column for the '
      'default exam only" (see apps/api/src/ca/curation-scope.ts). A default would make every '
      'pre-0116 row read as a genuine "no paper / no state focus" and silently blank its curation.', bad;
  end if;

  if (select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = 'current_affairs_items'
        and column_name in ('gs_papers_by_exam', 'state_focus')) <> 2 then
    raise exception '0116: expected both gs_papers_by_exam and state_focus to exist after this migration';
  end if;
end $$;
