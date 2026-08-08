-- 0119_admin_user_activity.sql
-- One batched aggregate behind the admin "Users" list: per user, when they were
-- last genuinely active, how many tests they have submitted, and how many SRS
-- reviews they have logged.
--
-- WHY A SQL FUNCTION rather than PostgREST calls: the list is paginated at 20
-- users, and "last active" is a max() across FIVE tables. Expressed through
-- PostgREST that is 5 queries per user (PostgREST cannot GROUP BY), i.e. ~100
-- round trips per page. This follows the established convention for exactly
-- this problem — 0050's profile_accuracy_time_buckets / profile_improvement_pairs
-- (and mv_node_weightage, match_embeddings): real Postgres aggregation instead
-- of pulling raw rows into JS.
--
-- WHY THOSE FIVE TABLES, and NOT users_profile.last_active_date: that column is
-- only written on a study-DAY activity (daily/streak.ts's any-activity rule), so
-- a user who browses chapters and current affairs every day but never completes a
-- study action would look inactive. `events` alone is also wrong — it is fired
-- only from the learn/notes pages, so revision-only or notes-only activity is
-- invisible to it. This is the SAME durable-activity set, for the SAME reason,
-- that services/guest-cleanup.ts's pruneAbandonedGuests already uses; the two
-- must not disagree about what "active" means. See that file's header.
--
-- Returns EXACTLY ONE ROW PER REQUESTED ID, including ids with no activity at
-- all (last_active_at NULL, counts 0) — a user with zero activity must render as
-- "never active", never silently vanish from the admin list.
--
-- ⚑ GRANTED TO service_role ONLY — deliberately NARROWER than 0050's functions.
-- Those take the caller's own user id and read the caller's own rows under RLS,
-- so anon/authenticated grants are safe there. This one takes an ARBITRARY array
-- of user ids and returns other people's activity, so an authenticated grant
-- would be a cross-user data leak reachable by any signed-in account calling
-- /rest/v1/rpc directly. The API reaches it with the service role and gates the
-- route with lib/admin.ts's requireAdmin, the same gate as every other /admin/*
-- endpoint.

create or replace function public.admin_user_activity(p_user_ids uuid[])
returns table (
  user_id           uuid,
  last_active_at    timestamptz,
  tests_taken       int,
  srs_reviews_count int
)
language sql
stable
as $$
  with activity as (
    select u.user_id, max(u.created_at) as last_at
    from (
      select e.user_id, e.created_at from public.events      e where e.user_id = any(p_user_ids)
      union all
      select a.user_id, a.created_at from public.attempts    a where a.user_id = any(p_user_ids)
      union all
      select r.user_id, r.created_at from public.srs_reviews r where r.user_id = any(p_user_ids)
      union all
      select c.user_id, c.created_at from public.srs_cards   c where c.user_id = any(p_user_ids)
      union all
      select n.user_id, n.created_at from public.user_notes  n where n.user_id = any(p_user_ids)
    ) u
    group by u.user_id
  ),
  -- Only SUBMITTED attempts count as a test taken: an abandoned/in-progress
  -- attempt row exists from the moment the player opens, so counting all rows
  -- would overstate activity. Matches how services/tests.ts derives
  -- attempts_count / best_score.
  tests as (
    select a.user_id, count(*)::int as n
    from public.attempts a
    where a.user_id = any(p_user_ids) and a.submitted_at is not null
    group by a.user_id
  ),
  reviews as (
    select r.user_id, count(*)::int as n
    from public.srs_reviews r
    where r.user_id = any(p_user_ids)
    group by r.user_id
  )
  select
    ids.id                 as user_id,
    activity.last_at       as last_active_at,
    coalesce(tests.n, 0)   as tests_taken,
    coalesce(reviews.n, 0) as srs_reviews_count
  from unnest(p_user_ids) as ids(id)
  left join activity on activity.user_id = ids.id
  left join tests    on tests.user_id    = ids.id
  left join reviews  on reviews.user_id  = ids.id;
$$;

comment on function public.admin_user_activity(uuid[]) is
  'Batched per-user activity summary (last-active across events/attempts/srs_reviews/srs_cards/user_notes, submitted-test count, SRS review count) for the admin Users list. service_role only — takes arbitrary user ids.';

-- A fresh function needs its own execute grant beyond 0015's default table
-- privileges (same reason 0027/0049/0050 grant explicitly). Revoke the PUBLIC
-- default first so the service-role-only intent above is actually enforced
-- rather than merely documented.
revoke all on function public.admin_user_activity(uuid[]) from public;
grant execute on function public.admin_user_activity(uuid[]) to service_role;
