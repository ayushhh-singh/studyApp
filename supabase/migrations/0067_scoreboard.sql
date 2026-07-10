-- =============================================================================
-- 0066_scoreboard.sql — the real Scoreboard, built on the hidden Session-15
-- leaderboard groundwork (digest.ts's getLeaderboard/GET /leaderboard, which
-- this migration's service-layer replacement supersedes with real per-board
-- SQL aggregation instead of an N+1 per-profile loop).
--
-- Hard rules from the brief:
--   1. Every count shown is real. No seeded/fake rows, ever.
--   2. Mains scores are personal — the Mains board is opt-in
--      (users_profile.show_on_mains_board, default FALSE).
--   3. Ranks can't be farmed: ghost-battle replays, re-attempts (only the
--      user's FIRST submitted attempt on a test counts), and Time Attack runs
--      are excluded from every board.
--
-- Data layer:
--   - daily_quiz_board_entries: a real table (not a materialized view) so
--     TODAY's daily quiz board can update the instant a user submits — see
--     services/scoreboard.ts's recordDailyQuizResult, hooked into
--     services/attempts.ts's submitAttempt. unique(user_id, quiz_date) +
--     on-conflict-do-nothing at the call site means only the user's FIRST
--     submitted attempt on that day's quiz is ever recorded (anti-farming).
--   - v_test_leaderboard (plain view): the qualifying-attempt logic for
--     mock/sectional boards, defined once and reused two ways — LIVE (a
--     single test_id lookup, cheap, used by the instant "you ranked N of M"
--     rank card right after a result) and MATERIALIZED (mv_test_leaderboard,
--     refreshed nightly, used by the browsable Scoreboard page so listing
--     many tests' worth of rows doesn't recompute the join every request).
--   - mv_mock_series_board: per paper_code (GS-I / CSAT are separate series),
--     the average of each user's per-mock qualifying score — since only the
--     first non-ghost attempt counts per (user, mock) at all, "average of
--     each user's best per mock" and "average of each user's one counted
--     attempt per mock" are the same number by construction.
--   - mv_mains_weekly_board: weekly (IST-aligned) average evaluation score +
--     per-dimension bests, gated at the VIEW level on show_on_mains_board=true
--     AND >=3 evaluations that week — so any reader of this view already only
--     sees users who opted in and qualify, no service-layer re-filtering
--     needed. A user's own private stats (before opting in, or below the
--     3-evaluation floor) are computed separately, live, straight off
--     evaluations/answer_submissions.
--   - scoreboard_rank_snapshots: nightly-populated per-user rank history,
--     backing the profile "my ranks" sparkline and the ">=3 board
--     appearances" milestone. Entirely internal (service-role only) — the
--     API composes it into handle+number-only responses.
--
-- RLS/grants: daily_quiz_board_entries and scoreboard_rank_snapshots are
-- internal tables (RLS on, no policy, explicit revoke from anon/authenticated
-- — same shape as billing_events in 0057) since only the Express API (service
-- role) ever reads them, and it must apply the opt-in/anti-farm/percentile
-- rules itself before anything reaches the browser. The three materialized
-- views can't carry RLS at all (Postgres doesn't support RLS on matviews), so
-- the same anon/authenticated revoke is done via plain grants instead.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Mains board opt-in (default FALSE — never force it).
-- ---------------------------------------------------------------------------
alter table public.users_profile
  add column if not exists show_on_mains_board boolean not null default false;

-- ---------------------------------------------------------------------------
-- 2. daily_quiz_board_entries — the one incrementally-updated board.
-- ---------------------------------------------------------------------------
create table public.daily_quiz_board_entries (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.users_profile(id) on delete cascade,
  quiz_date          date not null,
  test_id            uuid not null references public.tests(id) on delete cascade,
  attempt_id         uuid not null references public.attempts(id) on delete cascade,
  score              numeric not null,
  total              numeric not null,
  accuracy_pct       numeric,
  time_taken_seconds int,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (user_id, quiz_date)
);
create index daily_quiz_board_entries_date_idx on public.daily_quiz_board_entries (quiz_date);

create trigger set_updated_at before update on public.daily_quiz_board_entries
  for each row execute function public.set_updated_at();

alter table public.daily_quiz_board_entries enable row level security;
revoke all on public.daily_quiz_board_entries from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. scoreboard_rank_snapshots — nightly rank history (sparkline + milestone).
-- ---------------------------------------------------------------------------
create table public.scoreboard_rank_snapshots (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.users_profile(id) on delete cascade,
  board_type     text not null, -- 'daily_quiz' | 'test' | 'mock_series' | 'mains_weekly'
  board_key      text not null, -- quiz_date / test_id / paper_code / week_start, as text
  rank           int not null,
  participants   int not null,
  snapshot_date  date not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (user_id, board_type, board_key, snapshot_date)
);
create index scoreboard_rank_snapshots_user_idx on public.scoreboard_rank_snapshots (user_id, board_type, snapshot_date);

create trigger set_updated_at before update on public.scoreboard_rank_snapshots
  for each row execute function public.set_updated_at();

alter table public.scoreboard_rank_snapshots enable row level security;
revoke all on public.scoreboard_rank_snapshots from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. v_test_leaderboard — the qualifying-attempt logic for mock/sectional
--    boards (a plain view, reused live and materialized below). Ghost-battle
--    replays are marked attempts.meta->>'source' = 'ghost' by
--    services/ghost.ts (via startAttempt's new opts.source) and excluded
--    here; Time Attack has its own test_kind and is excluded by the kind
--    filter; only the user's FIRST submitted attempt on a test counts
--    (row_number() = 1), so later re-attempts never move a rank.
-- ---------------------------------------------------------------------------
create view public.v_test_leaderboard as
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
  where a.submitted_at is not null
    and t.kind in ('mock', 'sectional')
    and coalesce(a.meta ->> 'source', '') <> 'ghost'
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

create materialized view public.mv_test_leaderboard as
  select * from public.v_test_leaderboard;

create unique index mv_test_leaderboard_key on public.mv_test_leaderboard (test_id, user_id);
create index mv_test_leaderboard_test_idx on public.mv_test_leaderboard (test_id);
revoke all on public.mv_test_leaderboard from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. mv_mock_series_board — per paper_code (series), avg of each user's
--    qualifying per-mock score.
-- ---------------------------------------------------------------------------
create materialized view public.mv_mock_series_board as
select
  t.paper_code,
  m.user_id,
  count(*)::int as mocks_attempted,
  round(avg(case when m.total > 0 then (m.score / m.total) * 100 else null end), 2) as avg_score_pct,
  round(avg(m.accuracy_pct), 2) as avg_accuracy_pct
from public.mv_test_leaderboard m
join public.tests t on t.id = m.test_id
where t.kind = 'mock'
group by t.paper_code, m.user_id;

create unique index mv_mock_series_board_key on public.mv_mock_series_board (paper_code, user_id);
revoke all on public.mv_mock_series_board from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. mv_mains_weekly_board — weekly avg evaluation score + per-dimension
--    bests. Week bucketed on IST wall-clock (created_at + 5.5h) so a
--    Sunday-night-IST evaluation doesn't fall into the wrong week purely
--    because Postgres truncates in UTC. Gated at the view level: only rows
--    for users who opted in (show_on_mains_board) AND cleared the
--    >=3-evaluations-this-week floor ever appear here.
-- ---------------------------------------------------------------------------
create materialized view public.mv_mains_weekly_board as
with graded as (
  select
    s.user_id,
    date_trunc('week', (e.created_at + interval '5.5 hours'))::date as week_start,
    (e.overall_score / nullif(e.max_score, 0)) * 100 as pct,
    e.dimension_scores
  from public.evaluations e
  join public.answer_submissions s on s.id = e.submission_id
  where e.overall_score is not null and e.max_score is not null and e.max_score > 0
),
overall as (
  select week_start, user_id, count(*)::int as evaluations_count, round(avg(pct), 2) as avg_pct
  from graded
  group by week_start, user_id
),
dims as (
  select g.week_start, g.user_id, kv.key as dim, max(kv.value::numeric) as best
  from graded g, jsonb_each_text(coalesce(g.dimension_scores, '{}'::jsonb)) as kv
  group by g.week_start, g.user_id, kv.key
),
dim_agg as (
  select week_start, user_id, jsonb_object_agg(dim, best) as dimension_bests
  from dims
  group by week_start, user_id
)
select
  o.week_start,
  o.user_id,
  o.evaluations_count,
  o.avg_pct,
  coalesce(d.dimension_bests, '{}'::jsonb) as dimension_bests
from overall o
left join dim_agg d on d.week_start = o.week_start and d.user_id = o.user_id
where o.evaluations_count >= 3
  and exists (
    select 1 from public.users_profile up
    where up.id = o.user_id and up.show_on_mains_board = true
  );

create unique index mv_mains_weekly_board_key on public.mv_mains_weekly_board (week_start, user_id);
revoke all on public.mv_mains_weekly_board from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. refresh_scoreboard_views(p_snapshot_date) — nightly RPC. Refreshes the
--    three materialized views (CONCURRENTLY where possible, matching the
--    mv_node_weightage try/fallback pattern from 0037), then upserts today's
--    rank for every board a user appears on into scoreboard_rank_snapshots.
--    p_snapshot_date is the IST calendar day (caller passes istToday()) — NOT
--    Postgres current_date, which would be off by one relative to IST at the
--    00:05 IST cron tick (18:35 UTC the previous day).
-- ---------------------------------------------------------------------------
create or replace function public.refresh_scoreboard_views(p_snapshot_date date)
returns void language plpgsql as $$
begin
  begin
    refresh materialized view concurrently public.mv_test_leaderboard;
  exception when others then
    refresh materialized view public.mv_test_leaderboard;
  end;

  begin
    refresh materialized view concurrently public.mv_mock_series_board;
  exception when others then
    refresh materialized view public.mv_mock_series_board;
  end;

  begin
    refresh materialized view concurrently public.mv_mains_weekly_board;
  exception when others then
    refresh materialized view public.mv_mains_weekly_board;
  end;

  insert into public.scoreboard_rank_snapshots (user_id, board_type, board_key, rank, participants, snapshot_date)
  select user_id, 'test', test_id::text, rnk, cnt, p_snapshot_date
  from (
    select test_id, user_id,
      rank() over (partition by test_id order by score desc) as rnk,
      count(*) over (partition by test_id) as cnt
    from public.mv_test_leaderboard
  ) x
  on conflict (user_id, board_type, board_key, snapshot_date) do update
    set rank = excluded.rank, participants = excluded.participants, updated_at = now();

  insert into public.scoreboard_rank_snapshots (user_id, board_type, board_key, rank, participants, snapshot_date)
  select user_id, 'mock_series', paper_code, rnk, cnt, p_snapshot_date
  from (
    select paper_code, user_id,
      rank() over (partition by paper_code order by avg_score_pct desc) as rnk,
      count(*) over (partition by paper_code) as cnt
    from public.mv_mock_series_board
  ) x
  on conflict (user_id, board_type, board_key, snapshot_date) do update
    set rank = excluded.rank, participants = excluded.participants, updated_at = now();

  insert into public.scoreboard_rank_snapshots (user_id, board_type, board_key, rank, participants, snapshot_date)
  select user_id, 'mains_weekly', week_start::text, rnk, cnt, p_snapshot_date
  from (
    select week_start, user_id,
      rank() over (partition by week_start order by avg_pct desc) as rnk,
      count(*) over (partition by week_start) as cnt
    from public.mv_mains_weekly_board
  ) x
  on conflict (user_id, board_type, board_key, snapshot_date) do update
    set rank = excluded.rank, participants = excluded.participants, updated_at = now();

  insert into public.scoreboard_rank_snapshots (user_id, board_type, board_key, rank, participants, snapshot_date)
  select user_id, 'daily_quiz', quiz_date::text, rnk, cnt, p_snapshot_date
  from (
    select quiz_date, user_id,
      rank() over (partition by quiz_date order by score desc) as rnk,
      count(*) over (partition by quiz_date) as cnt
    from public.daily_quiz_board_entries
  ) x
  on conflict (user_id, board_type, board_key, snapshot_date) do update
    set rank = excluded.rank, participants = excluded.participants, updated_at = now();
end;
$$;

-- Refreshes every user's data and writes rank snapshots — never callable by a
-- client role, only the API's service role (nightly cron) invokes this RPC.
revoke all on function public.refresh_scoreboard_views(date) from public, anon, authenticated;
