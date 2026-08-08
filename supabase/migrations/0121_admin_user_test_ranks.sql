-- 0121_admin_user_test_ranks.sql
-- Per-test rank + cohort size for ONE user, for the admin per-user drill-down's
-- test-history table. One set-based query instead of a count-per-test.
--
-- ⚑ THE POINT OF THIS FUNCTION IS TO AGREE WITH WHAT THE USER SEES. Rank is not
-- stored anywhere — `mv_test_leaderboard` (0067) holds score/accuracy/time but no
-- rank, and services/scoreboard.ts::getTestBoard derives it at query time. If the
-- admin surface computed rank its own way, an admin and the student would read
-- different numbers off the same test. So this deliberately mirrors getTestBoard
-- exactly, on all four axes:
--
--   1. SOURCE: mv_test_leaderboard, which already encodes the qualifying rules —
--      only `mock`/`sectional` kinds, only each user's FIRST attempt per test
--      (row_number() = 1), ghost attempts excluded. Those rules are therefore
--      inherited, never restated here.
--   2. ORDER: score DESC and nothing else, matching `.order("score", {ascending:
--      false})`.
--   3. TIES: `rank()` is competition ranking — tied rows share the lower number
--      and the next rank skips — which is precisely what computeRanks() does
--      (`for k in i..j: ranks[k] = i + 1`). `dense_rank()` would NOT match.
--   4. PUBLISHED: getTestBoard refuses a board whose test is not is_published
--      (its own comment explains why: an unpublished draft's real scores must not
--      leak). Joining `tests` and requiring the same keeps a rank from appearing
--      here that the student cannot see. An unpublished test simply yields no
--      row, and the caller renders "no rank" — honest, and consistent.
--
-- NULLS: `nulls last` is defensive only — measured live, 0 of the current
-- mv_test_leaderboard rows have a null score, so this ordering clause cannot
-- currently diverge from PostgREST's default. It is stated explicitly rather
-- than left to the Postgres DESC default (which is NULLS FIRST) so a future null
-- sorts to the bottom instead of silently taking rank 1.
--
-- COVERAGE IS GENUINELY SPARSE, and that is expected, not a bug: because only
-- mock/sectional first-attempts qualify, most rows in a user's test history
-- (daily quizzes, PYQ practice, custom sets, time attack) have no rank at all.
-- "Ranks where applicable" means exactly this subset.
--
-- service_role only, for the reason spelled out in 0120: 0015's `alter default
-- privileges` makes every new function anon-executable, so the revoke must name
-- the roles. This one returns nothing about other users individually, but
-- cohort_size is still aggregate information about other people's participation.

create or replace function public.admin_user_test_ranks(p_user_id uuid)
returns table (
  test_id     uuid,
  user_rank   int,
  cohort_size int
)
language sql
stable
as $$
  with mine as (
    select l.test_id
    from public.mv_test_leaderboard l
    join public.tests t on t.id = l.test_id
    where l.user_id = p_user_id
      and t.is_published
  ),
  ranked as (
    select
      l.test_id,
      l.user_id,
      rank() over (partition by l.test_id order by l.score desc nulls last) as rnk,
      count(*) over (partition by l.test_id)                               as cohort
    from public.mv_test_leaderboard l
    join mine m on m.test_id = l.test_id
  )
  select r.test_id, r.rnk::int, r.cohort::int
  from ranked r
  where r.user_id = p_user_id;
$$;

comment on function public.admin_user_test_ranks(uuid) is
  'Per-test competition rank + cohort size for one user, mirroring getTestBoard exactly (mv_test_leaderboard, score DESC, rank(), is_published). Admin drill-down only; service_role only.';

revoke all on function public.admin_user_test_ranks(uuid) from public;
revoke execute on function public.admin_user_test_ranks(uuid) from anon, authenticated;
grant execute on function public.admin_user_test_ranks(uuid) to service_role;

-- Same end-state assertion as 0120: exactly one role may execute this.
do $$
declare
  grantees text;
begin
  select coalesce(string_agg(distinct r.grantee, ',' order by r.grantee), '(none)')
    into grantees
  from information_schema.routine_privileges r
  where r.routine_schema = 'public'
    and r.routine_name = 'admin_user_test_ranks'
    and r.privilege_type = 'EXECUTE'
    and r.grantee in ('anon', 'authenticated', 'PUBLIC');
  if grantees <> '(none)' then
    raise exception
      'admin_user_test_ranks is still EXECUTE-able by: % — it must be service_role only', grantees;
  end if;
end $$;
