-- 0002_types_and_helpers.sql
-- Shared enum types + helper functions/triggers used across the schema.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type locale                as enum ('hi', 'en');            -- bilingual: Hindi + English
create type user_plan             as enum ('free', 'pro');
create type exam_stage            as enum ('prelims', 'mains');
create type question_type         as enum ('mcq', 'descriptive');
create type question_source       as enum ('pyq', 'generated', 'manual');
create type difficulty            as enum ('easy', 'medium', 'hard');
create type test_kind             as enum ('pyq_full', 'sectional', 'daily_quiz', 'custom');
create type submission_mode       as enum ('typed', 'handwritten');
create type submission_status     as enum ('pending', 'ocr_done', 'evaluating', 'complete', 'failed');
create type srs_source_type       as enum ('question', 'current_affairs', 'manual');
create type doubt_role            as enum ('user', 'assistant');
create type embedding_source_type as enum ('syllabus', 'question', 'current_affairs', 'note');

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Bilingual publish gate helper.
-- Returns true only when an *_i18n JSONB value has BOTH a non-blank `hi` and a
-- non-blank `en`. IMMUTABLE so it can back generated columns and CHECKs.
-- ---------------------------------------------------------------------------
create or replace function public.i18n_complete(v jsonb)
returns boolean
language sql
immutable
as $$
  select v is not null
     and coalesce(length(btrim(v ->> 'hi')), 0) > 0
     and coalesce(length(btrim(v ->> 'en')), 0) > 0;
$$;
