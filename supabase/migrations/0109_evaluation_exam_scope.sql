-- =============================================================================
-- 0109_evaluation_exam_scope.sql — gives answer-writing an EXAM dimension.
-- Closes docs/OUTSTANDING.md §8b M5.
--
-- THE BUG THIS PREVENTS: mv_mains_weekly_board pools every evaluation in a
-- week into ONE ranking. The moment a second exam goes live it would rank a
-- UPSC candidate's answers against a UPPSC candidate's — different papers,
-- different mark schemes, one leaderboard. Nothing errors; the board is just
-- silently meaningless.
--
-- THE SECOND, SUBTLER BUG: 0069 splits Essay from GS with the literal
-- comparison `rubric_version <> 'essay-v1'`, mirrored in services/scoreboard.ts
-- and getEvaluationPercentile. That string is UPPSC's essay rubric. A second
-- exam's essay rubric (say 'upsc-essay-v1' — UPSC's essay is ~1000-1200 words
-- at 125 marks, a genuinely different scheme) satisfies `<> 'essay-v1'` and
-- would be swept into the GS board, double-counting one skill into another's
-- ranking exactly as 0069 was written to prevent. Encoding the segmentation
-- axis as a literal version string does not survive a second exam.
--
-- SHAPE OF THE FIX: two columns on `evaluations`, both stamped at persist time
-- from the exam-aware rubric registry
-- (apps/api/src/services/evaluation/rubric.ts):
--
--   exam_code   — the exam this answer BELONGS to (which board it competes on),
--                 taken from the question's syllabus node, or from the author's
--                 target exam for a custom prompt.
--   rubric_kind — 'gs' | 'essay', the segmentation axis, so SQL can split
--                 without knowing any version string. The registry derives it
--                 from the version, so the two can never disagree.
--
-- WHY A STORED exam_code, when 0106 §13 said evaluations DERIVE their exam via
-- the question FK — a deliberate revision of that decision, with the reasons:
--   1. It does not actually derive for every row. `answer_submissions.
--      question_id` is NULLABLE (custom prompts, the writing room's own
--      free-text mode), and those submissions have no question and no node.
--   2. The only remaining derivation for those is the AUTHOR'S CURRENT
--      `users_profile.target_exam` — mutable state. A user who switches exams
--      would retroactively re-bucket their entire answer history onto the new
--      exam's board. The exam an answer was written for is a fact about the
--      past and must be captured when it happens.
--   3. The materialized board would otherwise need a 3-way join
--      (evaluations -> answer_submissions -> questions -> syllabus_nodes) plus
--      a coalesce into users_profile, on every refresh.
--
-- NOT bumping RUBRIC_VERSION: the version string means "which rubric variant",
-- is persisted on every existing evaluations row, and is part of the
-- `question_model_answers (question_id, locale, rubric_version)` reuse key.
-- Renaming UPPSC's 'v1'/'essay-v1' would invalidate that cache and rewrite live
-- history for zero behavioural gain. New exams use '<exam>-<kind>-v<n>'.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. evaluations.exam_code + rubric_kind
-- ---------------------------------------------------------------------------
-- Both `not null default` — every existing row is genuinely UPPSC (0106's
-- backfill verified 100% of syllabus nodes, profiles and tests as uppsc), and a
-- nullable column here would just push a coalesce into every board query. The
-- FK is validated against already-seeded `exams` rows (0106 §1), so the ALTER
-- does not need a separate seed step — the ordering trap recorded in
-- [[supabase-headless-migrations]] does not apply.
alter table public.evaluations
  add column if not exists exam_code text not null default 'uppsc'
    references public.exams(exam_code) on update cascade;

comment on column public.evaluations.exam_code is
  'The exam this answer belongs to — which Mains board it competes on. From the question''s syllabus node, or the author''s target exam for a custom prompt. Stamped at persist time, never re-derived: it is a fact about the past, and target_exam is mutable.';

alter table public.evaluations
  add column if not exists rubric_kind text not null default 'gs';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'evaluations_rubric_kind_check'
  ) then
    alter table public.evaluations
      add constraint evaluations_rubric_kind_check check (rubric_kind in ('gs', 'essay'));
  end if;
end $$;

comment on column public.evaluations.rubric_kind is
  'GS vs Essay — the board/percentile segmentation axis, derived from rubric_version by the exam-aware registry at persist time. Replaces the literal `rubric_version <> ''essay-v1''` comparison, which silently assumed UPPSC''s was the only essay rubric.';

-- Backfill using the ONE rule that was ever true before this migration: the
-- only essay rubric that has ever existed is UPPSC's 'essay-v1'.
update public.evaluations set rubric_kind = 'essay' where rubric_version = 'essay-v1';

-- The board/percentile access pattern: a week's rows for one exam and one kind.
create index if not exists evaluations_exam_kind_created_idx
  on public.evaluations (exam_code, rubric_kind, created_at desc);

-- ---------------------------------------------------------------------------
-- 2. mv_mains_weekly_board — now keyed (week_start, exam_code, user_id)
-- ---------------------------------------------------------------------------
-- Everything else is carried over from 0069 verbatim, including its two fixes:
-- the essay exclusion (now expressed as `rubric_kind = 'gs'`, which is the same
-- predicate for every row that exists today and stays correct for every exam
-- added later), and the jsonb_array_elements unnest guarded by jsonb_typeof
-- (dimension_scores is an ARRAY of dimension objects, not a flat map — calling
-- jsonb_each_text on it throws, and refresh_scoreboard_views swallows each
-- view's exception independently, so that failure mode is silent).
drop materialized view if exists public.mv_mains_weekly_board;

create materialized view public.mv_mains_weekly_board as
with graded as (
  select
    s.user_id,
    e.exam_code,
    date_trunc('week', (e.created_at + interval '5.5 hours'))::date as week_start,
    (e.overall_score / nullif(e.max_score, 0)) * 100 as pct,
    e.dimension_scores
  from public.evaluations e
  join public.answer_submissions s on s.id = e.submission_id
  where e.overall_score is not null and e.max_score is not null and e.max_score > 0
    and e.rubric_kind = 'gs'
),
overall as (
  select week_start, exam_code, user_id, count(*)::int as evaluations_count, round(avg(pct), 2) as avg_pct
  from graded
  group by week_start, exam_code, user_id
),
dims as (
  select
    g.week_start,
    g.exam_code,
    g.user_id,
    elem ->> 'key' as dim,
    max((elem ->> 'score')::numeric) as best
  from graded g,
    jsonb_array_elements(
      case when jsonb_typeof(g.dimension_scores) = 'array' then g.dimension_scores else '[]'::jsonb end
    ) as elem
  where elem ->> 'key' is not null and elem ->> 'score' is not null
  group by g.week_start, g.exam_code, g.user_id, elem ->> 'key'
),
dim_agg as (
  select week_start, exam_code, user_id, jsonb_object_agg(dim, best) as dimension_bests
  from dims
  group by week_start, exam_code, user_id
)
select
  o.week_start,
  o.exam_code,
  o.user_id,
  o.evaluations_count,
  o.avg_pct,
  coalesce(d.dimension_bests, '{}'::jsonb) as dimension_bests
from overall o
left join dim_agg d
  on d.week_start = o.week_start and d.exam_code = o.exam_code and d.user_id = o.user_id
where o.evaluations_count >= 3
  and exists (
    select 1 from public.users_profile up
    where up.id = o.user_id and up.show_on_mains_board = true
  );

create unique index mv_mains_weekly_board_key
  on public.mv_mains_weekly_board (week_start, exam_code, user_id);
revoke all on public.mv_mains_weekly_board from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. refresh_scoreboard_views — rank WITHIN an exam, and key snapshots by it
-- ---------------------------------------------------------------------------
-- Only the mains_weekly block changes; the other three are 0067's verbatim.
--
-- WHY board_key gains the exam: `scoreboard_rank_snapshots` is unique on
-- (user_id, board_type, board_key, snapshot_date). A user CAN hold rows in two
-- exam buckets in one week — they switched exams mid-week, and their earlier
-- answers keep their original exam_code by design — which under a bare
-- week_start key produces two inserts colliding on one key, with
-- `on conflict do update` silently keeping whichever landed last.
--
-- WHY only for a non-default exam: the suffix is appended ONLY when
-- exam_code <> 'uppsc', so every existing key stays byte-identical. board_key
-- is opaque to `getRankHistory` (returned unparsed; my-ranks-card.tsx groups by
-- board_type alone), but `countDistinctBoardAppearances` counts distinct
-- board_type:board_key pairs to award the ">=3 boards" milestone — so
-- reformatting every historical UPPSC key would make one week''s board count as
-- two and inflate that milestone for existing users. Two exams'' boards ARE two
-- boards; one exam''s board across a format change is not.
--
-- The daily-quiz block gains an exam PARTITION but keeps its bare quiz_date
-- key: `daily_quiz_board_entries` is unique(user_id, quiz_date), so one user
-- has at most one row per date and no key collision is possible — only the
-- ranking POPULATION was wrong, pooling two exams'' entirely different quizzes
-- into one ranking.
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
  select
    user_id,
    'mains_weekly',
    case when exam_code = 'uppsc' then week_start::text else week_start::text || '|' || exam_code end,
    rnk, cnt, p_snapshot_date
  from (
    select week_start, exam_code, user_id,
      rank() over (partition by week_start, exam_code order by avg_pct desc) as rnk,
      count(*) over (partition by week_start, exam_code) as cnt
    from public.mv_mains_weekly_board
  ) x
  on conflict (user_id, board_type, board_key, snapshot_date) do update
    set rank = excluded.rank, participants = excluded.participants, updated_at = now();

  -- The daily board ranks one exam's quiz-takers against each other. The exam is
  -- derived through the entry's test rather than stored: `daily_quiz_board_
  -- entries.test_id` is NOT NULL and `tests.exam_code` is NOT NULL (0106 §5), so
  -- unlike evaluations the derivation genuinely holds for every row and no
  -- column is needed. The join is therefore total — it drops nothing.
  insert into public.scoreboard_rank_snapshots (user_id, board_type, board_key, rank, participants, snapshot_date)
  select user_id, 'daily_quiz', quiz_date::text, rnk, cnt, p_snapshot_date
  from (
    select e.quiz_date, e.user_id,
      rank() over (partition by e.quiz_date, t.exam_code order by e.score desc) as rnk,
      count(*) over (partition by e.quiz_date, t.exam_code) as cnt
    from public.daily_quiz_board_entries e
    join public.tests t on t.id = e.test_id
  ) x
  on conflict (user_id, board_type, board_key, snapshot_date) do update
    set rank = excluded.rank, participants = excluded.participants, updated_at = now();
end;
$$;

revoke all on function public.refresh_scoreboard_views(date) from public, anon, authenticated;
