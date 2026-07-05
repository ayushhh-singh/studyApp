-- 0017_mcq_publish_gate.sql
-- Strengthen the publish gate for MCQs. Previously the gate was stem-only, so an
-- MCQ could be published with no options and no correct answer (unanswerable).
--
-- New rule (single source of truth: public.question_publishable):
--   * ALL questions: stem_i18n must be bilingual-complete (hi + en non-blank).
--   * MCQ additionally: options_i18n is a JSON array of >= 2 options; every option
--     has a non-blank `key` and a bilingual-complete `text_i18n`; and
--     correct_option_key matches one of the option keys.
--   * Descriptive: unchanged (stem-only).

create or replace function public.question_publishable(
  p_type       question_type,
  p_stem       jsonb,
  p_options    jsonb,
  p_correct_key text
) returns boolean
language sql
immutable
as $$
  select
    public.i18n_complete(p_stem)
    and (
      p_type <> 'mcq'
      or (
        p_options is not null
        and jsonb_typeof(p_options) = 'array'
        and jsonb_array_length(p_options) >= 2
        -- no option with a blank key or an incomplete bilingual text
        and not exists (
          select 1
          from jsonb_array_elements(p_options) as o
          where coalesce(length(btrim(o ->> 'key')), 0) = 0
             or not public.i18n_complete(o -> 'text_i18n')
        )
        -- correct_option_key must reference an existing option
        and p_correct_key is not null
        and exists (
          select 1
          from jsonb_array_elements(p_options) as o
          where o ->> 'key' = p_correct_key
        )
      )
    );
$$;

-- Rebuild the generated column to use the type-aware gate.
alter table public.questions drop column publish_gate_ok;
alter table public.questions
  add column publish_gate_ok boolean
  generated always as (
    public.question_publishable(type, stem_i18n, options_i18n, correct_option_key)
  ) stored;

-- Enforce the same gate on publish.
create or replace function public.enforce_question_publish_gate()
returns trigger
language plpgsql
as $$
begin
  if new.is_published
     and not public.question_publishable(new.type, new.stem_i18n, new.options_i18n, new.correct_option_key)
  then
    raise exception
      'Cannot publish question %: fails publish gate (needs bilingual stem; MCQ also needs >=2 bilingual options and a correct_option_key matching an option)',
      new.id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
