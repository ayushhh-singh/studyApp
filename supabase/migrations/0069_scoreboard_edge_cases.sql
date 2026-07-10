-- =============================================================================
-- 0069_scoreboard_edge_cases.sql — fixes from a post-ship edge-case review of
-- 0067_scoreboard.sql (the Scoreboard).
--
-- BUG: mv_mains_weekly_board's "graded" CTE pooled EVERY evaluation regardless
-- of rubric_version, so an Essay evaluation (rubric_version='essay-v1')
-- counted toward BOTH the Answer Writing weekly board/dimension-bests AND its
-- own separate Essay board — double-counting one skill's score into the
-- other's ranking, and diluting the Answer Writing (GS) board with a
-- structurally different rubric. The Essay board is scoped live to
-- rubric_version='essay-v1' (services/scoreboard.ts's
-- getMainsEssayWeeklyBoard) precisely so it stays separate; this migration
-- makes the materialized "Answer Writing" board exclude essay-v1 to match.
--
-- BUG: the "dims" CTE assumed evaluations.dimension_scores was a flat object
-- ({"structure_flow": 7, ...}), extracting keys via jsonb_each_text. The real,
-- live shape (confirmed against all 16 real evaluation rows in the dev DB) is
-- an ARRAY of full dimension objects
-- ([{"key":"structure_flow","score":7,...}, ...] — see
-- apps/api/src/services/evaluation/rubric.ts's DimensionScore type). Calling
-- jsonb_each_text on an array throws "cannot call jsonb_each_text on a
-- non-object" — this was a LATENT bug in 0067 that never surfaced there only
-- because zero evaluations existed at the moment 0067 was first applied; the
-- very first live refresh against real data (this migration's own push)
-- reproduced it immediately. Since refresh_scoreboard_views() swallows each
-- view's refresh exception independently (matching mv_node_weightage's
-- established try/fallback pattern), this would otherwise have silently and
-- permanently broken the Mains dimension-bests board with no visible error.
-- Fixed by unnesting the array via jsonb_array_elements and reading each
-- element's "key"/"score" fields, guarded by jsonb_typeof so a future
-- non-array value degrades to zero dimension rows instead of erroring.
-- =============================================================================

drop materialized view if exists public.mv_mains_weekly_board;

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
    and e.rubric_version <> 'essay-v1'
),
overall as (
  select week_start, user_id, count(*)::int as evaluations_count, round(avg(pct), 2) as avg_pct
  from graded
  group by week_start, user_id
),
dims as (
  select
    g.week_start,
    g.user_id,
    elem ->> 'key' as dim,
    max((elem ->> 'score')::numeric) as best
  from graded g,
    jsonb_array_elements(
      case when jsonb_typeof(g.dimension_scores) = 'array' then g.dimension_scores else '[]'::jsonb end
    ) as elem
  where elem ->> 'key' is not null and elem ->> 'score' is not null
  group by g.week_start, g.user_id, elem ->> 'key'
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
