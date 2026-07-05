-- 0034_question_model_answers.sql
-- Model-answer reuse: a catalogued question's rubric-conformant model answer
-- is identical for every candidate who submits against it, in a given
-- language, under a given rubric version — so it only needs generating once.
-- executeEvaluation (services/evaluation/evaluate.ts) checks this table before
-- calling the model for the pass-2 model-answer step; a miss generates and
-- persists it, a hit streams the stored text with no model call. Custom-prompt
-- submissions (no question_id) always generate and are never persisted here.
--
-- No RLS — same posture as llm_calls (0021): a service-only table never read
-- or written directly by the browser.

create table public.question_model_answers (
  id             uuid primary key default gen_random_uuid(),
  question_id    uuid not null references public.questions(id) on delete cascade,
  locale         locale not null,
  rubric_version text not null,
  model_answer   text not null,
  tokens         int not null default 0,
  cost_usd       numeric not null default 0,
  created_at     timestamptz not null default now(),
  unique (question_id, locale, rubric_version)
);
