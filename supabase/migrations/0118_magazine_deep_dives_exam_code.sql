-- 0118_magazine_deep_dives_exam_code.sql
-- Scope magazine Deep Dives to the exam they are written FOR.
--
-- THE GAP THIS CLOSES. 0068 created this table before the multi-exam work, so a
-- deep dive carried no exam of its own. Everything downstream had to DERIVE one
-- at read time from the row's primary syllabus node (services/magazine.ts's
-- filterDeepDivesByExam), and — worse — ca/deepdive.ts's `rankIssues` pooled
-- EVERY exam's current affairs into one ranking and took a global top-5. With a
-- second exam live, one exam could take all five slots and the other get zero
-- deep dives, silently, with nothing in the schema to notice.
--
-- ⚑ AND THE UNIQUE CONSTRAINT ACTIVELY BLOCKED THE FIX. 0068 declared
-- `unique (month, rank)` with `rank between 1 and 5`. Per-exam generation
-- necessarily produces a rank 1 for EACH exam in the same month, so a second
-- exam's first dive would have failed on a 23505 — the exam column alone is not
-- enough, the uniqueness has to be per (month, exam) too.
--
-- Also replaces the read-time derivation with a real column: that derivation ran
-- one `examCodeForNode` lookup PER ROW on the Mains edition's hot path, and it
-- silently disagreed with the writer whenever an item was mapped into several
-- exams' trees (the shared-row case 0106 §11 exists for) — `syllabus_node_ids[0]`
-- is whichever node happened to be first, not the exam the dive was written for.

-- 1. The column. FK to `exams`, unlike questions.exam_code's deliberate CHECK:
--    that one is PROVENANCE (its domain includes up_ro_aro/upsssc_pet, exams
--    nobody can select), whereas this is the PRODUCT exam the dive is written
--    for and must be a registered one.
alter table public.magazine_deep_dives
  add column if not exists exam_code text references public.exams(exam_code);

-- 2. Backfill, mirroring EXACTLY the read-time rule this replaces
--    (filterDeepDivesByExam -> examCodeForNode(syllabus_node_ids[0])), so no
--    existing row changes which exam it belongs to. Postgres arrays are
--    1-indexed. Measured before writing this: 4 rows, all 2026-07/published,
--    all with a resolvable primary node, all resolving to 'uppsc'.
update public.magazine_deep_dives d
set exam_code = n.exam_code
from public.syllabus_nodes n
where d.exam_code is null
  and array_length(d.syllabus_node_ids, 1) >= 1
  and n.id = d.syllabus_node_ids[1];

-- 3. Any row whose primary node is missing/unresolvable falls back to the
--    default exam. Measured as 0 rows today; this exists so step 4 cannot fail
--    on a row shape that predates the column.
update public.magazine_deep_dives
set exam_code = 'uppsc'
where exam_code is null;

alter table public.magazine_deep_dives
  alter column exam_code set not null;

-- 4. Uniqueness becomes per-exam. Drop by the name Postgres auto-assigned to
--    0068's `unique (month, rank)`.
alter table public.magazine_deep_dives
  drop constraint if exists magazine_deep_dives_month_rank_key;

-- Postgres has no ADD CONSTRAINT IF NOT EXISTS, so guard on the catalogue —
-- this migration must be replayable (M14).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.magazine_deep_dives'::regclass
      and conname = 'magazine_deep_dives_month_exam_rank_key'
  ) then
    alter table public.magazine_deep_dives
      add constraint magazine_deep_dives_month_exam_rank_key unique (month, exam_code, rank);
  end if;
end $$;

-- 5. The Mains edition and the month-index count both read
--    (month, exam_code, status) together.
create index if not exists magazine_deep_dives_month_exam_status_idx
  on public.magazine_deep_dives(month, exam_code, status);

-- 6. Assert the SCHEMA shape, not row counts — a row-count assertion is true
--    exactly once and fails on every replay (the mistake 0116 shipped with and
--    had to be repaired).
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'magazine_deep_dives'
      and column_name = 'exam_code' and is_nullable = 'YES'
  ) then
    raise exception '0118: magazine_deep_dives.exam_code must be NOT NULL';
  end if;

  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.magazine_deep_dives'::regclass
      and conname = 'magazine_deep_dives_month_rank_key'
  ) then
    raise exception '0118: the old (month, rank) unique constraint must be gone — it blocks per-exam ranks';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.magazine_deep_dives'::regclass
      and conname = 'magazine_deep_dives_month_exam_rank_key'
  ) then
    raise exception '0118: the (month, exam_code, rank) unique constraint is missing';
  end if;
end $$;
