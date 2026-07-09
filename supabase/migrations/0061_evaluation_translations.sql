-- 0061_evaluation_translations.sql
-- An evaluation's AI-written feedback (strengths/improvements/model answer,
-- each dimension's justification, and the pass-1 analysis text) is generated
-- and persisted in ONLY the locale the candidate submitted their answer in
-- (answer_submissions.language) — see evaluations.strengths_i18n etc, a
-- bilingual JSONB column where only one side is ever filled. Viewing that
-- same evaluation at the OTHER locale's URL previously left every piece of
-- actual AI-written substance in the original language, with only UI chrome
-- translating — a real gap against "Hindi/English equal-first" for the
-- flagship feature's actual content.
--
-- This table is a lazy, generate-once-per-(evaluation,locale) translation
-- cache, same "generate once, cache, reuse" pattern as
-- question_model_answers (0034): the replay path checks here first, a miss
-- translates via claude-haiku-4-5 (lib/anthropic.ts's translateBatch) and
-- persists, a hit never re-spends a model call. Deleting the parent
-- evaluation cascades its translations.
--
-- No RLS policies — same posture as llm_calls/question_model_answers: a
-- service-only table the browser never reads or writes directly.

create table public.evaluation_translations (
  id                     uuid primary key default gen_random_uuid(),
  evaluation_id          uuid not null references public.evaluations(id) on delete cascade,
  locale                 locale not null,
  strengths              text not null default '',
  improvements           text not null default '',
  model_answer           text not null default '',
  -- {dimension_key: translated justification}
  dimension_justifications jsonb not null default '{}'::jsonb,
  overall_comment        text not null default '',
  missed_key_points      jsonb not null default '[]'::jsonb,
  -- factual_errors[].issue only, aligned by index to the original array —
  -- .quote is the candidate's own answer text verbatim and is never translated.
  factual_error_issues   jsonb not null default '[]'::jsonb,
  tokens_used            int not null default 0,
  cost_usd               numeric not null default 0,
  created_at             timestamptz not null default now(),
  unique (evaluation_id, locale)
);

alter table public.evaluation_translations enable row level security;
