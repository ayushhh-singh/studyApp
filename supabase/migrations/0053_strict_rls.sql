-- =============================================================================
-- 0053_strict_rls.sql  — AUTH PHASE.
--
-- Replaces the wide-open dev RLS policies (0013 for tables, 0030 for the
-- answer-images storage bucket, and the per-feature `dev_permissive_all`/
-- `notes_dev_all` policies added by 0038-0051) with strict, real policies:
--
--   * Owner-only (auth.uid() = user_id) for every user-scoped table. Child
--     tables with no own user_id (attempt_answers, evaluations, doubt_messages)
--     are scoped through their owning parent via EXISTS. DELETE is granted only
--     where the UI actually deletes (srs_cards, doubt_threads); everywhere else
--     rows are immutable-except-by-owner-update and removed only by cascade.
--   * Content tables (syllabus, questions, tests, current affairs, notes, model
--     answers, exam calendar/cutoffs): public read, gated by the SAME
--     published/approved predicate lib/question-visibility.ts encodes for
--     questions. Writes have NO policy, so only the service role (BYPASSRLS)
--     can write them — which is exactly how ingestion / the API run.
--   * Internal tables (embeddings, generation_batches, llm_calls,
--     doubt_faq_cache): RLS on, NO policy at all → anon + authenticated are
--     fully denied; only the service role reaches them.
--
-- IMPORTANT — why the API keeps working: the Express API talks to Postgres with
-- the SERVICE ROLE key (lib/supabase.ts), which bypasses RLS entirely, and it
-- already scopes every query by the token-derived currentUserId(). RLS here is
-- DEFENSE IN DEPTH against the ONE place the browser holds a Supabase credential
-- directly: the anon key + the signed-in user's JWT (auth + answer-image storage
-- uploads). It guarantees that even a hand-crafted PostgREST/Storage call with a
-- real user's token can only ever touch that user's own rows.
--
-- Idempotent: drops every existing policy on public tables first, so a re-run
-- (or a partial prior run) lands cleanly.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. Clean slate: drop every existing policy on public tables (the dev
--    permissive ones, and any prior run of this migration).
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
  loop
    execute format('drop policy if exists %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. Enable RLS on every table (idempotent; several already had it on). This
--    closes the gap where tables created after 0013 (exam_calendar,
--    generation_batches, llm_calls, question_model_answers) never had RLS
--    enabled at all and were reachable via the broad grants.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  all_tables text[] := array[
    -- user-scoped
    'users_profile','attempts','attempt_answers','answer_submissions','evaluations',
    'srs_cards','srs_reviews','study_plans','doubt_threads','doubt_messages','events',
    'learner_profiles','mentor_insights','node_mastery','personal_bests',
    'notification_schedule','milestones','daily_stats','drill_sessions',
    -- content
    'syllabus_nodes','questions','tests','test_questions','current_affairs_items',
    'notes','question_model_answers','exam_calendar','exam_cutoffs',
    -- internal / service-role only
    'embeddings','generation_batches','llm_calls','doubt_faq_cache'
  ];
begin
  foreach t in array all_tables loop
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Owner-only tables that carry their OWN user_id column.
--    SELECT / INSERT / UPDATE scoped to auth.uid() = user_id.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  owner_tables text[] := array[
    'attempts','answer_submissions','srs_cards','srs_reviews','study_plans',
    'doubt_threads','events','learner_profiles','mentor_insights','node_mastery',
    'personal_bests','notification_schedule','milestones','daily_stats','drill_sessions'
  ];
begin
  foreach t in array owner_tables loop
    execute format($f$
      create policy owner_select on public.%1$I
        for select to authenticated using (auth.uid() = user_id);
      create policy owner_insert on public.%1$I
        for insert to authenticated with check (auth.uid() = user_id);
      create policy owner_update on public.%1$I
        for update to authenticated
        using (auth.uid() = user_id) with check (auth.uid() = user_id);
    $f$, t);
  end loop;
end;
$$;

-- DELETE only where the app actually lets a user delete their own row:
--   srs_cards   — Revision → Manage → delete card (DELETE /srs/cards/:id)
--   doubt_threads — AI Mentor → delete conversation
create policy owner_delete on public.srs_cards
  for delete to authenticated using (auth.uid() = user_id);
create policy owner_delete on public.doubt_threads
  for delete to authenticated using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 3. users_profile — owned via its PK `id` (= auth.uid()). Row is created by
--    the handle_new_user() trigger (SECURITY DEFINER), so no INSERT policy;
--    no self-delete.
-- ---------------------------------------------------------------------------
create policy owner_select on public.users_profile
  for select to authenticated using (auth.uid() = id);
create policy owner_update on public.users_profile
  for update to authenticated
  using (auth.uid() = id) with check (auth.uid() = id);

-- ---------------------------------------------------------------------------
-- 4. Child tables scoped through their owning parent (no own user_id).
-- ---------------------------------------------------------------------------
-- attempt_answers → attempts
create policy owner_select on public.attempt_answers
  for select to authenticated
  using (exists (select 1 from public.attempts a where a.id = attempt_id and a.user_id = auth.uid()));
create policy owner_insert on public.attempt_answers
  for insert to authenticated
  with check (exists (select 1 from public.attempts a where a.id = attempt_id and a.user_id = auth.uid()));
create policy owner_update on public.attempt_answers
  for update to authenticated
  using (exists (select 1 from public.attempts a where a.id = attempt_id and a.user_id = auth.uid()))
  with check (exists (select 1 from public.attempts a where a.id = attempt_id and a.user_id = auth.uid()));

-- evaluations → answer_submissions (read-only for the user; written by service role)
create policy owner_select on public.evaluations
  for select to authenticated
  using (exists (select 1 from public.answer_submissions s where s.id = submission_id and s.user_id = auth.uid()));

-- doubt_messages → doubt_threads
create policy owner_select on public.doubt_messages
  for select to authenticated
  using (exists (select 1 from public.doubt_threads d where d.id = thread_id and d.user_id = auth.uid()));
create policy owner_insert on public.doubt_messages
  for insert to authenticated
  with check (exists (select 1 from public.doubt_threads d where d.id = thread_id and d.user_id = auth.uid()));

-- ---------------------------------------------------------------------------
-- 5. Content tables — public read, gated by the published/approved predicate.
--    Writes have NO policy → service role only.
-- ---------------------------------------------------------------------------
-- Fully public content (no publish concept):
create policy content_read on public.syllabus_nodes
  for select to anon, authenticated using (true);
create policy content_read on public.exam_calendar
  for select to anon, authenticated using (true);
create policy content_read on public.exam_cutoffs
  for select to anon, authenticated using (true);

-- Questions: the exact catalog rule from lib/question-visibility.ts.
create policy content_read on public.questions
  for select to anon, authenticated
  using (is_published and review_state = 'approved');

-- Tests + their question mapping: only published tests.
create policy content_read on public.tests
  for select to anon, authenticated using (is_published);
create policy content_read on public.test_questions
  for select to anon, authenticated
  using (exists (select 1 from public.tests t where t.id = test_id and t.is_published));

-- Current affairs: only published items.
create policy content_read on public.current_affairs_items
  for select to anon, authenticated using (is_published);

-- Notes: only published notes.
create policy content_read on public.notes
  for select to anon, authenticated using (status = 'published');

-- Model answers: readable only when their question is itself visible.
create policy content_read on public.question_model_answers
  for select to anon, authenticated
  using (exists (
    select 1 from public.questions q
    where q.id = question_id and q.is_published and q.review_state = 'approved'
  ));

-- ---------------------------------------------------------------------------
-- 6. Internal tables get NO policy (RLS on + no policy = only the service role,
--    which bypasses RLS, can touch them): embeddings, generation_batches,
--    llm_calls, doubt_faq_cache. Nothing to create here — documented for the
--    next reader.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 7. Least-privilege grants (completes the TODO in 0015). The service role and
--    authenticated keep their grants (RLS gates the rows); anon becomes
--    read-only — it can no longer even attempt a write. RLS still decides which
--    rows a SELECT returns, so anon sees published content and nothing else.
-- ---------------------------------------------------------------------------
revoke insert, update, delete, truncate on all tables in schema public from anon;
alter default privileges in schema public
  revoke insert, update, delete on tables from anon;

-- ---------------------------------------------------------------------------
-- 8. Storage: replace the dev-permissive answer-images policy with a per-user
--    folder policy. Object keys are `<auth.uid()>/<draftId>/<page>.jpg`; a user
--    may only read/write objects under their own uid prefix. The bucket stays
--    private (created private in 0030); display uses short-lived signed URLs,
--    which createSignedUrl issues under the SELECT policy for the owner.
-- ---------------------------------------------------------------------------
drop policy if exists dev_permissive_answer_images on storage.objects;
drop policy if exists answer_images_owner_select on storage.objects;
drop policy if exists answer_images_owner_insert on storage.objects;
drop policy if exists answer_images_owner_update on storage.objects;
drop policy if exists answer_images_owner_delete on storage.objects;

create policy answer_images_owner_select on storage.objects
  for select to authenticated
  using (bucket_id = 'answer-images' and (storage.foldername(name))[1] = auth.uid()::text);
create policy answer_images_owner_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'answer-images' and (storage.foldername(name))[1] = auth.uid()::text);
create policy answer_images_owner_update on storage.objects
  for update to authenticated
  using (bucket_id = 'answer-images' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'answer-images' and (storage.foldername(name))[1] = auth.uid()::text);
create policy answer_images_owner_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'answer-images' and (storage.foldername(name))[1] = auth.uid()::text);
