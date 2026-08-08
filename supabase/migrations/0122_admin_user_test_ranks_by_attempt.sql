-- 0122_admin_user_test_ranks_by_attempt.sql
-- Fixes a defect in 0121: admin_user_test_ranks keyed its result by TEST, but a
-- rank belongs to ONE ATTEMPT.
--
-- ⚑ THE BUG. `mv_test_leaderboard` (0067) admits only each user's FIRST
-- non-ghost attempt per test — 0067's own header states the intent plainly:
-- "Ranks can't be farmed: ghost-battle replays, RE-ATTEMPTS (only the first
-- non-ghost attempt counts per (user, mock))". 0121 returned `test_id` only, so
-- `listUserAttempts` built a test_id -> rank map and attached that rank to EVERY
-- attempt on the test. A user's second, third, … attempt on a published
-- mock/sectional would therefore display the FIRST attempt's rank as if it had
-- earned it — inflating a re-attempt's apparent standing, which is exactly the
-- farming the leaderboard's first-attempt-only rule exists to prevent.
--
-- MEASURED BEFORE FIXING: latent today, not live. 8 (user, test) pairs already
-- have more than one submitted attempt, but 0 of those tests are a published
-- mock/sectional, so no wrong rank is currently rendered. It becomes live the
-- first time anyone re-attempts a published mock — which the product actively
-- invites (Practice re-runs, and the "Race this again" ghost flow, whose own
-- replays are excluded from the mv but whose ORIGINAL test remains re-attemptable).
--
-- THE FIX: return `attempt_id`, which the matview already carries (0067 selects
-- `a.id as attempt_id`), so the caller matches on the attempt that was actually
-- ranked and every other attempt correctly shows "not ranked". `test_id` is kept
-- in the result — it costs nothing and keeps the row self-describing.
--
-- DROP + CREATE, not CREATE OR REPLACE: Postgres refuses to replace a function
-- whose RETURN TABLE signature changed ("cannot change return type of existing
-- function"). Same reason 0070 had to drop and recreate match_doubt_faq.
-- Everything else — the getTestBoard mirroring on source/order/ties/is_published,
-- and the service_role-only grant — is carried over unchanged from 0121.

drop function if exists public.admin_user_test_ranks(uuid);

create function public.admin_user_test_ranks(p_user_id uuid)
returns table (
  attempt_id  uuid,
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
      l.attempt_id,
      l.test_id,
      l.user_id,
      rank() over (partition by l.test_id order by l.score desc nulls last) as rnk,
      count(*) over (partition by l.test_id)                               as cohort
    from public.mv_test_leaderboard l
    join mine m on m.test_id = l.test_id
  )
  select r.attempt_id, r.test_id, r.rnk::int, r.cohort::int
  from ranked r
  where r.user_id = p_user_id;
$$;

comment on function public.admin_user_test_ranks(uuid) is
  'Per-ATTEMPT competition rank + cohort size for one user, mirroring getTestBoard exactly (mv_test_leaderboard, score DESC, rank(), is_published). Keyed by attempt_id because only the first non-ghost attempt per test is ranked. Admin drill-down only; service_role only.';

-- A dropped function loses its grants, and 0015's `alter default privileges`
-- re-grants EXECUTE to anon/authenticated on every newly created function — so
-- the recreate silently reopens what 0120/0121 closed unless revoked again by
-- role name. See 0120 for the full explanation of that trap.
revoke all on function public.admin_user_test_ranks(uuid) from public;
revoke execute on function public.admin_user_test_ranks(uuid) from anon, authenticated;
grant execute on function public.admin_user_test_ranks(uuid) to service_role;

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
