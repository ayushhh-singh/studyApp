-- 0005_questions.sql
-- MCQ + descriptive questions (PYQs, AI-generated, manual).
-- `publish_gate_ok` is a STORED generated column: true only when the bilingual
-- stem has both hi + en. A trigger blocks is_published unless the gate passes.

create table public.questions (
  id                 uuid primary key default gen_random_uuid(),
  type               question_type   not null,
  stage              exam_stage      not null,
  paper_code         text            not null,
  syllabus_node_id   uuid            references public.syllabus_nodes(id) on delete set null,
  year               int,                                  -- non-null for PYQs
  source             question_source not null,
  stem_i18n          jsonb           not null,
  options_i18n       jsonb,                                -- [{ "key": "A", "text_i18n": {"hi":"","en":""} }]
  correct_option_key text,
  explanation_i18n   jsonb,
  difficulty         difficulty      not null default 'medium',
  word_limit         int,                                  -- descriptive only
  marks              int,
  is_published       boolean         not null default false,
  publish_gate_ok    boolean         generated always as (public.i18n_complete(stem_i18n)) stored,
  created_at         timestamptz     not null default now(),
  updated_at         timestamptz     not null default now()
);

create index questions_syllabus_idx  on public.questions(syllabus_node_id);
create index questions_paper_idx      on public.questions(stage, paper_code);
create index questions_type_idx       on public.questions(type);
create index questions_published_idx  on public.questions(is_published) where is_published;

create trigger trg_questions_updated_at
  before update on public.questions
  for each row execute function public.set_updated_at();

-- Enforce the bilingual publish gate. We recompute from stem_i18n directly
-- because generated columns are not yet populated in a BEFORE trigger.
create or replace function public.enforce_question_publish_gate()
returns trigger
language plpgsql
as $$
begin
  if new.is_published and not public.i18n_complete(new.stem_i18n) then
    raise exception 'Cannot publish question %: stem_i18n must contain both non-empty hi and en', new.id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger trg_questions_publish_gate
  before insert or update on public.questions
  for each row execute function public.enforce_question_publish_gate();
