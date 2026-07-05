-- 0008_answer_submissions_evaluations.sql
-- Flagship feature: descriptive answer submissions (typed or handwritten photo)
-- and their AI rubric evaluations. One evaluation per submission.

create table public.answer_submissions (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references public.users_profile(id) on delete cascade,
  question_id              uuid references public.questions(id) on delete set null,
  custom_question_text_i18n jsonb,                 -- when answering a non-catalogued prompt
  mode                     submission_mode   not null,
  typed_text               text,
  image_paths              text[],                 -- storage paths for handwritten uploads
  ocr_text                 text,
  ocr_confidence           numeric,
  status                   submission_status not null default 'pending',
  language                 locale            not null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  -- must target either a catalogued question or a custom prompt
  constraint answer_submissions_has_prompt
    check (question_id is not null or custom_question_text_i18n is not null)
);

create index answer_submissions_user_idx     on public.answer_submissions(user_id, created_at desc);
create index answer_submissions_question_idx on public.answer_submissions(question_id);
create index answer_submissions_status_idx   on public.answer_submissions(status);

create trigger trg_answer_submissions_updated_at
  before update on public.answer_submissions
  for each row execute function public.set_updated_at();

create table public.evaluations (
  id               uuid primary key default gen_random_uuid(),
  submission_id    uuid not null unique references public.answer_submissions(id) on delete cascade,
  model            text        not null,
  rubric_version   text        not null,
  overall_score    numeric,
  max_score        numeric,
  -- { structure, content_coverage, keywords, examples_data, presentation, word_limit }
  dimension_scores jsonb,
  strengths_i18n   jsonb,
  improvements_i18n jsonb,
  model_answer_i18n jsonb,
  raw_response     jsonb,
  tokens_used      int,
  cost_usd         numeric,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create trigger trg_evaluations_updated_at
  before update on public.evaluations
  for each row execute function public.set_updated_at();
