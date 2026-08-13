-- =============================================================================
-- 0127_test_series.sql — scheduled test series (docs/test-series-design.md §5).
--
-- A series is a SCHEDULING AND PACKAGING LAYER over existing `tests` rows
-- (design decision D-1). Nothing here changes `tests`, `test_questions`,
-- `attempts`, `attempt_answers` or `answer_test_sessions`; a series entry points
-- at a test row that the ordinary attempt engine already knows how to serve,
-- grade, review and rank. A parallel test model would fork that engine.
--
-- Three tables + one view predicate. No new `test_kind` value — see §3 below.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. test_series — the product a student enrols in.
--
-- `exam_code` is stored, not derived. A series can contain a test whose
-- paper_code is the synthetic CURRENT_AFFAIRS (§6.2's current-affairs papers),
-- and that code resolves to no syllabus tree, so there is nothing to derive the
-- exam FROM for those entries.
--
-- `stage` reuses the EXISTING `exam_stage` enum (0002) rather than the design
-- doc's `text check (stage in ('prelims','mains'))`. exam_calendar already uses
-- that enum for the identical concept; a parallel text column would be a second
-- source of truth for "prelims or mains" that could drift from the first.
--
-- `paper_scope` exists because the market ships GS and CSAT as separate products
-- at separate prices (Vision IAS: ₹16,000 vs ₹9,000 — §2.1). Null = the whole
-- stage (a Mains series spans every paper).
-- ---------------------------------------------------------------------------
create table if not exists public.test_series (
  id               uuid primary key default gen_random_uuid(),
  exam_code        text not null references public.exams(exam_code) on update cascade,
  stage            exam_stage not null,
  paper_scope      text,
  slug             text not null unique,
  title_i18n       jsonb not null,
  description_i18n jsonb,
  status           text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  starts_on        date not null,
  ends_on          date not null,
  target_exam_year int,
  meta             jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint test_series_dates_ordered check (ends_on >= starts_on)
);

comment on table public.test_series is
  'A scheduled test series — a packaging/scheduling layer over existing tests rows. See docs/test-series-design.md §5.1.';

create index if not exists test_series_exam_status_idx
  on public.test_series (exam_code, status, starts_on);

-- ---------------------------------------------------------------------------
-- 2. test_series_entries — one scheduled paper.
--
-- ⚑ `unique (test_id)` IS LOAD-BEARING, not merely tidy. §4's window predicate
-- LEFT JOINs this table onto `attempts` inside v_test_leaderboard's qualifying
-- CTE. A left join that could match two rows for one test would DUPLICATE that
-- attempt and silently corrupt every mock and sectional board — including the
-- boards of standalone tests that have nothing to do with a series. This
-- constraint is what makes the join provably fan-out-free. Do not drop it
-- without changing that view first.
--
-- `syllabus_note_i18n`, `sources_i18n` and `ca_window` are the product, not
-- decoration: every real institute schedule publishes a "Topics covered" and a
-- "Sources covered" column per test, and a rolling current-affairs window
-- (§2.4). `syllabus_note_i18n` is also what the T−24h reminder carries, and
-- `ca_window` bounds the CA slice's selection at build time (§6.2).
--
-- THREE TIMESTAMPS, because "attemptable" and "ranked" are separate predicates
-- (design decision D-2). That is what delivers the market's real rule —
-- "allowing for test postponement but not preponement" (Vision IAS, verbatim)
-- — from one mechanism, and makes policy a data change rather than a code change:
--   opens_at     — before this, the test is locked. Preponement: NO.
--   closes_at    — null means never closes. Postponement: YES, indefinitely.
--   ranked_until — null means never ranked; normally equals closes_at. A late
--                  attempt still runs, as unranked practice.
--
-- ⚑ `ranked_until` MUST BE TREATED AS IMMUTABLE ONCE PASSED. The board derives
-- ranked-ness by comparing against it rather than storing a flag, so editing it
-- retroactively re-ranks history that students have already seen. Deliberately
-- NOT enforced by a trigger: a `now()`-based trigger would make the row
-- unrestorable from a backup (restoring a pre-`ranked_until` row after that
-- moment would be rejected by the very rule meant to protect it). Enforce it in
-- the admin write path instead.
-- ---------------------------------------------------------------------------
create table if not exists public.test_series_entries (
  id                 uuid primary key default gen_random_uuid(),
  series_id          uuid not null references public.test_series(id) on delete cascade,
  -- restrict, not cascade: a test row carries real attempt history. Removing a
  -- paper from a series must be a deliberate act, not a side effect.
  test_id            uuid not null references public.tests(id) on delete restrict,
  sequence_no        int  not null,
  entry_kind         text not null check (entry_kind in (
                       'fundamental', 'applied', 'sectional', 'full_length',
                       'current_affairs', 'state_special')),
  opens_at           timestamptz not null,
  closes_at          timestamptz,
  ranked_until       timestamptz,
  syllabus_note_i18n jsonb,
  sources_i18n       jsonb,
  ca_window          daterange,
  meta               jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint test_series_entries_series_seq_key unique (series_id, sequence_no),
  constraint test_series_entries_test_key unique (test_id),
  constraint test_series_entries_window_ordered check (closes_at is null or closes_at >= opens_at),
  constraint test_series_entries_rank_window check (ranked_until is null or ranked_until >= opens_at)
);

comment on table public.test_series_entries is
  'One scheduled paper inside a series. unique(test_id) is load-bearing for v_test_leaderboard''s left join — see the migration header.';
comment on column public.test_series_entries.ranked_until is
  'Immutable once passed: the board compares against it rather than storing a flag, so editing it retroactively re-ranks history. Enforced in the admin write path, deliberately not by a trigger.';

create index if not exists test_series_entries_series_idx
  on public.test_series_entries (series_id, sequence_no);
create index if not exists test_series_entries_opens_idx
  on public.test_series_entries (opens_at);

-- ---------------------------------------------------------------------------
-- 3. test_series_enrollments — who to notify, and who the ranked cohort is.
--
-- Withdrawal is a STATUS CHANGE, not a delete, so a withdrawn student's past
-- ranked attempts stay attributable and re-enrolling does not mint a second row
-- (the unique key would reject it anyway).
-- ---------------------------------------------------------------------------
create table if not exists public.test_series_enrollments (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users_profile(id) on delete cascade,
  series_id   uuid not null references public.test_series(id) on delete cascade,
  enrolled_at timestamptz not null default now(),
  status      text not null default 'active' check (status in ('active', 'withdrawn')),
  updated_at  timestamptz not null default now(),
  constraint test_series_enrollments_user_series_key unique (user_id, series_id)
);

create index if not exists test_series_enrollments_series_idx
  on public.test_series_enrollments (series_id) where status = 'active';

-- updated_at triggers (0002's shared helper). Dropped first: Postgres has no
-- CREATE TRIGGER IF NOT EXISTS, so this is what makes the migration replayable
-- (docs/OUTSTANDING.md M14) — same pattern as 0052/0057/0066/0070.
drop trigger if exists trg_test_series_updated_at on public.test_series;
create trigger trg_test_series_updated_at
  before update on public.test_series
  for each row execute function public.set_updated_at();

drop trigger if exists trg_test_series_entries_updated_at on public.test_series_entries;
create trigger trg_test_series_entries_updated_at
  before update on public.test_series_entries
  for each row execute function public.set_updated_at();

drop trigger if exists trg_test_series_enrollments_updated_at on public.test_series_enrollments;
create trigger trg_test_series_enrollments_updated_at
  before update on public.test_series_enrollments
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS — 0053's shapes exactly.
--
-- A table created AFTER 0053 does not inherit its sweep; CLAUDE.md records four
-- tables that shipped with no RLS at all for exactly this reason. So enable and
-- policy each one explicitly here rather than assuming.
--
--   test_series / test_series_entries  → CONTENT: public read gated on the
--     series being published, writes have NO policy so only the service role
--     (which the Express API uses, and which bypasses RLS) can write.
--   test_series_enrollments            → OWNER-ONLY, the 0053/0111 shape.
-- ---------------------------------------------------------------------------
alter table public.test_series enable row level security;
alter table public.test_series_entries enable row level security;
alter table public.test_series_enrollments enable row level security;

revoke insert, update, delete on public.test_series from anon, authenticated;
revoke insert, update, delete on public.test_series_entries from anon, authenticated;
revoke all on public.test_series_enrollments from anon;

drop policy if exists content_read on public.test_series;
create policy content_read on public.test_series
  for select to anon, authenticated using (status = 'published');

-- An entry is readable exactly when its series is — mirrors test_questions →
-- tests (0053), so a draft calendar cannot leak through the child table.
drop policy if exists content_read on public.test_series_entries;
create policy content_read on public.test_series_entries
  for select to anon, authenticated
  using (exists (
    select 1 from public.test_series s
    where s.id = series_id and s.status = 'published'
  ));

drop policy if exists owner_select on public.test_series_enrollments;
drop policy if exists owner_insert on public.test_series_enrollments;
drop policy if exists owner_update on public.test_series_enrollments;
create policy owner_select on public.test_series_enrollments
  for select to authenticated using (auth.uid() = user_id);
create policy owner_insert on public.test_series_enrollments
  for insert to authenticated with check (auth.uid() = user_id);
create policy owner_update on public.test_series_enrollments
  for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 4. v_test_leaderboard — add the ranked-window predicate.
--
-- REPRODUCED FROM 0105 (the current live definition, which added the guest
-- exclusion) with exactly ONE addition: the left join to test_series_entries and
-- the `ranked_until` comparison. Everything else — the column list, its order,
-- the first-attempt row_number, the ghost exclusion, the guest exclusion, the
-- accuracy CTE — is byte-identical to 0105, because a `create or replace view`
-- that altered the column list would be rejected while mv_test_leaderboard
-- depends on it, and because every existing board must be unchanged.
--
-- `left join` + the three-way OR is what makes this a no-op for standalone
-- tests: an attempt on a test that is in no series has `e.id is null` and
-- qualifies exactly as before. `e.ranked_until is null` covers a series entry
-- deliberately configured never to close ranking.
--
-- Fan-out is impossible: test_series_entries has unique(test_id) (§2 above), so
-- the join matches at most one row per attempt.
-- ---------------------------------------------------------------------------
create or replace view public.v_test_leaderboard as
with qualifying as (
  select
    a.id as attempt_id,
    a.test_id,
    a.user_id,
    a.score,
    a.total,
    a.submitted_at,
    a.started_at,
    row_number() over (partition by a.test_id, a.user_id order by a.submitted_at asc) as rn
  from public.attempts a
  join public.tests t on t.id = a.test_id
  left join public.test_series_entries e on e.test_id = a.test_id
  where a.submitted_at is not null
    and t.kind in ('mock', 'sectional')
    and coalesce(a.meta ->> 'source', '') <> 'ghost'
    -- Exclude anonymous (guest) users from the competitive board.
    and not exists (
      select 1 from auth.users u where u.id = a.user_id and u.is_anonymous
    )
    -- Series entries rank only inside their window; a late attempt still exists
    -- and is still shown to its owner as practice, it just does not place.
    and (e.id is null or e.ranked_until is null or a.submitted_at <= e.ranked_until)
),
first_attempts as (
  select * from qualifying where rn = 1
),
accuracy as (
  select
    aa.attempt_id,
    count(*) filter (where aa.chosen_option_key is not null) as attempted,
    count(*) filter (where aa.is_correct) as correct
  from public.attempt_answers aa
  join first_attempts fa on fa.attempt_id = aa.attempt_id
  group by aa.attempt_id
)
select
  fa.test_id,
  fa.user_id,
  fa.attempt_id,
  fa.score,
  fa.total,
  case when coalesce(acc.attempted, 0) > 0
    then round((acc.correct::numeric / acc.attempted) * 100, 2)
    else null end as accuracy_pct,
  extract(epoch from (fa.submitted_at - fa.started_at))::int as time_taken_seconds,
  fa.submitted_at
from first_attempts fa
left join accuracy acc on acc.attempt_id = fa.attempt_id;

revoke all on public.v_test_leaderboard from anon, authenticated;

-- The matview reads the view, so it needs a refresh to pick the predicate up.
-- Non-concurrent is fine in a migration (small dataset, and CONCURRENTLY cannot
-- run inside the implicit transaction anyway). mv_mock_series_board reads
-- mv_test_leaderboard, so refresh it after.
refresh materialized view public.mv_test_leaderboard;
refresh materialized view public.mv_mock_series_board;

-- ---------------------------------------------------------------------------
-- 5. Assert the end state rather than claiming it. True on a first apply AND on
--    a replay (M14) — every check below is about SCHEMA shape, not row counts,
--    which is the distinction that made 0116's first assertion non-replayable.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.test_series') is null
     or to_regclass('public.test_series_entries') is null
     or to_regclass('public.test_series_enrollments') is null then
    raise exception '0127: one or more test_series tables are missing';
  end if;

  -- The constraint v_test_leaderboard's left join depends on.
  if not exists (
    select 1 from pg_constraint
    where conname = 'test_series_entries_test_key'
      and conrelid = 'public.test_series_entries'::regclass
  ) then
    raise exception '0127: unique(test_id) on test_series_entries is missing — v_test_leaderboard''s left join could fan out';
  end if;

  -- RLS must be ON for all three; a table created after 0053 does not inherit it.
  if exists (
    select 1 from pg_class
    where relname in ('test_series', 'test_series_entries', 'test_series_enrollments')
      and relnamespace = 'public'::regnamespace
      and not relrowsecurity
  ) then
    raise exception '0127: RLS is not enabled on every test_series table';
  end if;

  -- The predicate actually landed in the view body.
  if position('ranked_until' in pg_get_viewdef('public.v_test_leaderboard'::regclass)) = 0 then
    raise exception '0127: v_test_leaderboard does not reference ranked_until';
  end if;

  -- ...and the guest exclusion 0105 added is still there (a careless
  -- re-paste of the pre-0105 body would silently put guests back on the board).
  if position('is_anonymous' in pg_get_viewdef('public.v_test_leaderboard'::regclass)) = 0 then
    raise exception '0127: v_test_leaderboard lost 0105''s guest exclusion';
  end if;
end $$;
