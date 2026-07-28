-- =============================================================================
-- 0105_exclude_guests_from_leaderboards.sql
--
-- Keep GUEST (anonymous) users off the public competitive leaderboards. The
-- daily-quiz board is already handled at the write path (services/scoreboard.ts
-- recordDailyQuizResult skips guests), and the mains boards require evaluations
-- (which guests cannot create). The remaining surface is v_test_leaderboard —
-- the base view behind mv_test_leaderboard (per mock/SECTIONAL-test board) and,
-- transitively, mv_mock_series_board. Sectional practice is a FREE feature, so a
-- guest's sectional attempt would otherwise appear on that test's board with a
-- null handle. (Mocks are Pro-gated, so mocks never had guests regardless.)
--
-- Fix: add an `is_anonymous` exclusion to the view's qualifying CTE. The column
-- list is unchanged, so `create or replace view` keeps the dependent
-- mv_test_leaderboard intact; a refresh (below, + the nightly RPC) applies it.
-- The view reads auth.users as its OWNER (default security_invoker=false), which
-- has the access — same as every other object here.
-- =============================================================================

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
  where a.submitted_at is not null
    and t.kind in ('mock', 'sectional')
    and coalesce(a.meta ->> 'source', '') <> 'ghost'
    -- Exclude anonymous (guest) users from the competitive board.
    and not exists (
      select 1 from auth.users u where u.id = a.user_id and u.is_anonymous
    )
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

-- Apply immediately (non-concurrent is fine for a migration; small dataset).
-- mv_mock_series_board reads from mv_test_leaderboard, so refresh it after.
refresh materialized view public.mv_test_leaderboard;
refresh materialized view public.mv_mock_series_board;
