-- =============================================================================
-- 0093_sukoon_analytics_feedback_beta.sql — Session 14 (blueprint §7 Session 14):
-- beta hardening & launch. Three self-contained sukoon_ tables (module rules:
-- every reference is auth.users, never a Neev feature table; never write into
-- Neev's own `events`/`llm_calls`):
--
--   sukoon_analytics_events — privacy-aware product analytics (activation
--     funnel, DAU/feature usage, cap hits, paywall views/conversions,
--     AGGREGATE-ONLY crisis-level counts). `name` is a closed set enforced at
--     the API layer (packages/shared/src/sukoon.ts sukoonAnalyticsEventNameSchema)
--     and every prop value is sanitized to a short primitive server-side
--     (services/analytics.ts) BEFORE it ever reaches this table — so even a
--     buggy/malicious caller cannot smuggle journal/chat free text through as
--     a "prop". Mirrors Neev's own lightweight `events` table (0012) in shape.
--
--   sukoon_feedback — thumbs (+optional short note) on a Saathi reply, a
--     completed journey, or general app feedback (the beta banner's link).
--     `target_id` is FK-BY-CONVENTION only (a sukoon_messages id or a journey
--     slug — never a real FK, so a message can be purged independently without
--     orphaning a delete). Re-rating the SAME target upserts (one opinion per
--     user per target) via the unique index below; general feedback (target_id
--     null) is unaffected — a plain (non-partial) unique index already treats
--     every NULL as distinct from every other NULL, so a user may still leave
--     several general notes without colliding.
--
--   sukoon_beta_cohort — the SUKOON_BETA_COHORT gate's membership list (which
--     of Neev's users are in the initial ~300-user beta). Not personal CONTENT
--     (no journal/chat/mood data), just an ops allow-list, but still scoped to
--     auth.users like everything else here for a clean whole-account cascade.
--
-- RLS: all three are INTERNAL tables (0079's "internal_tables" category, e.g.
-- sukoon_semantic_cache) — RLS on, NO policy for anon/authenticated. The
-- Express API always talks to Postgres with the SERVICE ROLE (BYPASSRLS) and
-- scopes every query by currentUserId() itself; nothing here is ever read
-- directly by the browser via the anon key (unlike sukoon_profiles etc, which
-- need owner-select for that path). A direct `db push --db-url` connection
-- gets no automatic Supabase API-role grants, so grants are spelled out
-- per table (the 42501 gotcha, see [[supabase-headless-migrations]]).
-- Idempotent: `if not exists` + drop-policy-if-exists (defensive; none created).
-- =============================================================================

create table if not exists public.sukoon_analytics_events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  name       text not null,
  props      jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists sukoon_analytics_events_user_idx on public.sukoon_analytics_events(user_id, created_at desc);
create index if not exists sukoon_analytics_events_name_idx on public.sukoon_analytics_events(name, created_at desc);

create table if not exists public.sukoon_feedback (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  target_type text not null check (target_type in ('message', 'journey', 'general')),
  target_id   text,                                  -- null for 'general'; FK-by-convention otherwise
  rating      text check (rating in ('up', 'down')),
  body_text   text,                                   -- optional short note; NEVER journal/chat content
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- One opinion per (user, target) for message/journey feedback — re-rating the
-- same reply/journey UPDATEs in place rather than piling up duplicates.
--
-- DELIBERATELY NOT a partial index (`where target_id is not null`): Postgres
-- can only use a partial index as an ON CONFLICT arbiter when the ON CONFLICT
-- clause repeats the identical WHERE predicate, but supabase-js's
-- `.upsert(row, { onConflict: "user_id,target_type,target_id" })` generates a
-- plain `ON CONFLICT (user_id, target_type, target_id)` with no predicate —
-- so a partial index here would make every re-rate upsert fail with 42P10
-- "no unique or exclusion constraint matching the ON CONFLICT specification"
-- (the exact bug 0019_fix_questions_external_id_unique.sql already hit and
-- fixed the same way). A plain unique index has identical real-world
-- behaviour for general feedback (target_id null): Postgres unique indexes
-- already treat NULL as distinct from every other NULL, so several general
-- rows for the same user still coexist without colliding.
create unique index if not exists sukoon_feedback_user_target_uidx
  on public.sukoon_feedback(user_id, target_type, target_id);

create index if not exists sukoon_feedback_created_idx on public.sukoon_feedback(created_at desc);

create trigger sukoon_feedback_set_updated_at
  before update on public.sukoon_feedback
  for each row execute function public.sukoon_set_updated_at();

create table if not exists public.sukoon_beta_cohort (
  user_id  uuid primary key references auth.users(id) on delete cascade,
  note     text,
  added_at timestamptz not null default now()
);

do $$
declare
  t text;
  internal_tables text[] := array[
    'sukoon_analytics_events', 'sukoon_feedback', 'sukoon_beta_cohort'
  ];
  p record;
begin
  foreach t in array internal_tables loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('revoke all on public.%I from anon, authenticated;', t);
    execute format('grant all on public.%I to service_role;', t);
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy if exists %I on public.%I;', p.policyname, t);
    end loop;
  end loop;
end $$;
