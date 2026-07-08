-- 0050_profile_analytics_functions.sql
-- Two aggregate SQL functions backing GET /profile/analytics — real Postgres
-- aggregation (matching this app's existing convention, e.g. mv_node_weightage,
-- match_embeddings) rather than pulling raw rows into JS for these two.
--
--   profile_accuracy_time_buckets — MCQ accuracy bucketed by time-spent-per-
--     question (<30s / 30-60s / 60-120s / >120s), for the "am I rushing or
--     overthinking" chart.
--   profile_improvement_pairs — per catalogued question the user has evaluated
--     (descriptive answer) MORE THAN ONCE, the FIRST and LAST evaluation, via
--     window functions — "proof of improvement" on a re-attempted question.
--
-- Both are STABLE SQL functions, SECURITY INVOKER (the default) — reads flow
-- through the same dev-permissive RLS as any other PostgREST call. Grants
-- mirror 0027/0049 (this project's other explicit function grants) since a
-- fresh function needs its own execute grant beyond 0015's default privileges
-- on tables.

create or replace function public.profile_accuracy_time_buckets(p_user_id uuid)
returns table (bucket_label text, accuracy_pct numeric, cnt int)
language sql
stable
as $$
  select
    case
      when aa.time_spent_seconds < 30 then '<30s'
      when aa.time_spent_seconds < 60 then '30-60s'
      when aa.time_spent_seconds < 120 then '60-120s'
      else '>120s'
    end as bucket_label,
    round(100.0 * sum(case when aa.is_correct then 1 else 0 end) / count(*), 1) as accuracy_pct,
    count(*)::int as cnt
  from public.attempt_answers aa
  join public.attempts a on a.id = aa.attempt_id
  where a.user_id = p_user_id
    and aa.is_correct is not null
    and aa.time_spent_seconds is not null
  group by 1;
$$;

grant execute on function public.profile_accuracy_time_buckets(uuid)
  to anon, authenticated, service_role;

create or replace function public.profile_improvement_pairs(p_user_id uuid)
returns table (
  question_id          uuid,
  before_submission_id uuid,
  after_submission_id  uuid,
  before_score         numeric,
  before_max_score     numeric,
  after_score          numeric,
  after_max_score      numeric,
  before_date          timestamptz,
  after_date           timestamptz
)
language sql
stable
as $$
  with ranked as (
    select
      s.question_id,
      e.submission_id,
      e.overall_score,
      e.max_score,
      e.created_at,
      row_number() over (partition by s.question_id order by e.created_at asc)  as rn_asc,
      row_number() over (partition by s.question_id order by e.created_at desc) as rn_desc,
      count(*)     over (partition by s.question_id)                            as cnt
    from public.evaluations e
    join public.answer_submissions s on s.id = e.submission_id
    where s.user_id = p_user_id
      and s.question_id is not null
      and e.overall_score is not null
      and e.max_score is not null
      and e.max_score > 0
  )
  select
    b.question_id,
    b.submission_id as before_submission_id,
    a.submission_id as after_submission_id,
    b.overall_score  as before_score,
    b.max_score      as before_max_score,
    a.overall_score  as after_score,
    a.max_score      as after_max_score,
    b.created_at     as before_date,
    a.created_at     as after_date
  from ranked b
  join ranked a on a.question_id = b.question_id and a.rn_desc = 1
  where b.rn_asc = 1 and b.cnt >= 2;
$$;

grant execute on function public.profile_improvement_pairs(uuid)
  to anon, authenticated, service_role;
