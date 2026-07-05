-- =============================================================================
-- 0013_dev_permissive_rls.sql
-- REPLACED IN AUTH PHASE (Session 15).
--
-- RLS is ENABLED on every table, but the policies below are intentionally
-- WIDE OPEN (using true / with check true) for anon + authenticated so the
-- pre-auth dev user can read/write everything. These MUST be dropped and
-- replaced with strict per-user (auth.uid()) policies when real auth lands.
-- Do NOT ship these to production.
-- =============================================================================

do $$
declare
  t text;
  tables text[] := array[
    'users_profile',
    'syllabus_nodes',
    'questions',
    'tests',
    'test_questions',
    'attempts',
    'attempt_answers',
    'answer_submissions',
    'evaluations',
    'current_affairs_items',
    'srs_cards',
    'srs_reviews',
    'study_plans',
    'doubt_threads',
    'doubt_messages',
    'embeddings',
    'events'
  ];
begin
  foreach t in array tables loop
    execute format('alter table public.%I enable row level security;', t);
    -- single permissive policy covering all commands for both dev roles
    execute format($f$
      create policy dev_permissive_all on public.%I
        for all
        to anon, authenticated
        using (true)
        with check (true);
    $f$, t);
  end loop;
end;
$$;
