-- 0019_fix_questions_external_id_unique.sql
-- Fix questions.external_id uniqueness so ingest:pyq:load's plain
-- `.upsert(row, { onConflict: "external_id" })` works.
--
-- 0018 created a PARTIAL unique index (`where external_id is not null`).
-- Postgres can only use a partial index as an ON CONFLICT arbiter when the
-- ON CONFLICT clause repeats the same WHERE predicate — plain
-- `ON CONFLICT (external_id)` (what supabase-js generates) does not, so every
-- upsert failed with 42P10 "no unique or exclusion constraint matching the
-- ON CONFLICT specification".
--
-- A plain (non-partial) unique index has identical real-world behaviour here:
-- Postgres unique indexes already treat NULL as distinct from every other
-- NULL, so rows with external_id IS NULL (manual/generated questions) can
-- still coexist without colliding. Dropping the predicate only fixes the
-- ON CONFLICT inference, it does not loosen any constraint.

drop index if exists public.questions_external_id_key;

create unique index questions_external_id_key
  on public.questions(external_id);
