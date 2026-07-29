-- =============================================================================
-- 0079_sukoon_rls.sql — RLS + API-role grants for every sukoon_ table.
--
-- Model (mirrors Neev's 0053 strict RLS, adapted to a wellness/privacy product):
--   * USER-SCOPED tables (own user_id): owner-only — auth.uid() = user_id for
--     SELECT/INSERT/UPDATE/DELETE. Unlike Neev (which grants DELETE only where a
--     specific UI button deletes), Sukoon grants owner DELETE on EVERY personal
--     table: DPDP + the Privacy Center (F12) make "delete my own data" a
--     first-class user right, and every row is strictly the user's own.
--   * CHILD tables with no user_id (sukoon_messages) are scoped through their
--     owning parent (sukoon_conversations) via EXISTS.
--   * CONTENT tables (prompts, exercises, journeys, journey_steps): read for all
--     AUTHENTICATED users (Sukoon is an authenticated product — anon gets
--     nothing), refined by publish/active state; NO write policy → writable only
--     by the service role ("write-admin-only").
--   * INTERNAL (sukoon_semantic_cache): RLS on, NO policy → service role only.
--
-- Why the API still works: the Express API uses the SERVICE ROLE key
-- (lib/supabase.ts, BYPASSRLS) and scopes every query by the token-derived
-- currentUserId(). RLS here is DEFENSE IN DEPTH for any direct anon-key + user
-- JWT access (the standalone project, or a future direct-to-PostgREST path).
--
-- GRANTS: tables created over a direct `db push --db-url` connection do NOT get
-- Supabase's automatic API-role grants (the 42501 gotcha fixed for Neev by
-- 0015). 0015's `alter default privileges` covers new tables on the SHARED Neev
-- DB, but a fresh STANDALONE project has no such default — so this file grants
-- per sukoon_ table explicitly (never `on all tables in schema public`, which
-- would also re-touch Neev's tables and, via the anon revoke, break Neev's
-- public reads). Idempotent: drops its own policies first.
-- =============================================================================

-- Group the tables so grants + policies can loop instead of repeating 24×.
do $$
declare
  user_tables text[] := array[
    'sukoon_profiles','sukoon_consents','sukoon_conversations','sukoon_chat_summaries',
    'sukoon_crisis_events','sukoon_journal_entries','sukoon_mood_entries','sukoon_checkins',
    'sukoon_exercise_sessions','sukoon_journey_progress','sukoon_insights','sukoon_usage',
    'sukoon_voice_usage','sukoon_subscriptions'
  ];
  content_tables text[] := array[
    'sukoon_journal_prompts','sukoon_exercises','sukoon_journeys','sukoon_journey_steps'
  ];
  child_tables   text[] := array['sukoon_messages'];
  internal_tables text[] := array['sukoon_semantic_cache'];
  all_tables text[] := user_tables || content_tables || child_tables || internal_tables;
  t text;
  p record;
begin
  -- Enable RLS + reset grants on every sukoon_ table. Sukoon is authenticated-
  -- only, so anon is fully revoked everywhere; service_role gets all (BYPASSRLS
  -- still needs the table grant present).
  foreach t in array all_tables loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('revoke all on public.%I from anon, authenticated;', t);
    execute format('grant all on public.%I to service_role;', t);
    -- Drop any policy this migration previously created (idempotent re-run).
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy if exists %I on public.%I;', p.policyname, t);
    end loop;
  end loop;

  -- USER TABLES: full owner CRUD. sukoon_profiles is owned via its PK user_id
  -- (same column name, so the identical predicate works for it too).
  foreach t in array user_tables loop
    execute format('grant select, insert, update, delete on public.%I to authenticated;', t);
    execute format($f$
      create policy owner_select on public.%1$I
        for select to authenticated using (auth.uid() = user_id);
      create policy owner_insert on public.%1$I
        for insert to authenticated with check (auth.uid() = user_id);
      create policy owner_update on public.%1$I
        for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
      create policy owner_delete on public.%1$I
        for delete to authenticated using (auth.uid() = user_id);
    $f$, t);
  end loop;

  -- CONTENT TABLES: read-for-all-authenticated, no write policy (service role
  -- only). Publish/active refinement is applied per-table below, so here just
  -- grant SELECT and skip the generic read policy for the ones that need a
  -- predicate.
  foreach t in array content_tables loop
    execute format('grant select on public.%I to authenticated;', t);
  end loop;
end;
$$;

-- Content read policies (predicate-refined; kept out of the loop for clarity).
create policy content_read on public.sukoon_exercises
  for select to authenticated using (true);
create policy content_read on public.sukoon_journal_prompts
  for select to authenticated using (active);
create policy content_read on public.sukoon_journeys
  for select to authenticated using (published);
create policy content_read on public.sukoon_journey_steps
  for select to authenticated
  using (exists (
    select 1 from public.sukoon_journeys j
    where j.id = journey_id and j.published
  ));

-- CHILD: sukoon_messages scoped through its owning conversation.
grant select, insert, update, delete on public.sukoon_messages to authenticated;
create policy owner_select on public.sukoon_messages
  for select to authenticated
  using (exists (select 1 from public.sukoon_conversations c
                 where c.id = conversation_id and c.user_id = auth.uid()));
create policy owner_insert on public.sukoon_messages
  for insert to authenticated
  with check (exists (select 1 from public.sukoon_conversations c
                      where c.id = conversation_id and c.user_id = auth.uid()));
create policy owner_delete on public.sukoon_messages
  for delete to authenticated
  using (exists (select 1 from public.sukoon_conversations c
                 where c.id = conversation_id and c.user_id = auth.uid()));

-- INTERNAL: sukoon_semantic_cache gets RLS on + NO policy above → anon and
-- authenticated fully denied; only the service role (BYPASSRLS) reaches it.
