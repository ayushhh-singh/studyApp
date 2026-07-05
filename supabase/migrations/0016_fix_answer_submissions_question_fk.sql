-- 0016_fix_answer_submissions_question_fk.sql
-- Edge-case fix: answer_submissions.question_id was ON DELETE SET NULL, but the
-- `answer_submissions_has_prompt` CHECK requires question_id OR
-- custom_question_text_i18n to be non-null. Deleting a question referenced by a
-- plain (no custom text) submission set the FK to NULL and then failed the CHECK,
-- aborting the delete with a cryptic 23514 instead of a clean FK error.
--
-- Switch to ON DELETE RESTRICT: a question that has answer submissions cannot be
-- hard-deleted (protecting the user's answer + evaluation). To retire such a
-- question the app should snapshot its text into custom_question_text_i18n (or
-- delete the submissions) first.

do $$
declare
  cname text;
begin
  select con.conname
    into cname
  from pg_constraint con
  where con.conrelid = 'public.answer_submissions'::regclass
    and con.contype = 'f'
    and con.conkey = array[(
      select att.attnum
      from pg_attribute att
      where att.attrelid = 'public.answer_submissions'::regclass
        and att.attname = 'question_id'
    )];

  if cname is not null then
    execute format('alter table public.answer_submissions drop constraint %I', cname);
  end if;
end
$$;

alter table public.answer_submissions
  add constraint answer_submissions_question_id_fkey
  foreign key (question_id) references public.questions(id) on delete restrict;
