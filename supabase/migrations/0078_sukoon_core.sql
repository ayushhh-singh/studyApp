-- =============================================================================
-- 0078_sukoon_core.sql — Sukoon (wellness companion) schema, blueprint §6.
--
-- Lives in the flat migrations sequence (deployed the standard Neev way via
-- `supabase db push`, tracked in schema_migrations alongside 0001-0077) — the
-- blueprint pictured a self-contained supabase/migrations/sukoon/ subfolder, but
-- db push only globs the flat dir, so the SELF-CONTAINMENT that actually enables
-- a later standalone extraction is preserved in the SQL itself, not the folder:
-- every table is prefixed sukoon_, the only cross-schema reference is auth.users
-- (allowed per the Sukoon rules — never a FK into a Neev feature table), and this
-- file defines its OWN helper (sukoon_set_updated_at) instead of reusing Neev's
-- public.set_updated_at. To extract Sukoon later, 0078/0079 move UNCHANGED into
-- the standalone repo's own migrations dir.
--
-- Extensions are `create ... if not exists` so this is a no-op on the shared
-- Neev DB (0001_extensions already created them) and correct on a fresh project.
--
-- RLS lives in the sibling 0079_sukoon_rls.sql (schema, then policies — the same
-- split Neev uses, 0001-0012 tables then 0053 strict RLS). Apply 0078 then 0079.
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;   -- pgp_sym_encrypt (journal body_enc)
create extension if not exists vector   with schema extensions;   -- semantic-cache embeddings

-- Self-contained updated_at trigger (deliberately NOT public.set_updated_at —
-- see the header note on standalone portability).
create or replace function public.sukoon_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Content tables first (they are FK targets for the user tables below).
-- These carry NO user_id: they are shared, human-reviewed content, written by
-- the service role only (0002 gives them read-for-all-authenticated, no write
-- policy). Bilingual per SUKOON_CONTEXT: every content string has _hi AND _en.
-- ---------------------------------------------------------------------------

-- F4 guided journal prompts (daily-rotating, exam-aware).
create table if not exists public.sukoon_journal_prompts (
  id         uuid primary key default gen_random_uuid(),
  text_hi    text not null,
  text_en    text not null,
  category   text,                                  -- gratitude | worry_dump | reflection | letter_future ...
  exam_phase text,                                  -- prep | pre_exam | post_result | any
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- F6 exercise library (breathing / grounding / PMR / meditation / timer).
create table if not exists public.sukoon_exercises (
  id          uuid primary key default gen_random_uuid(),
  type        text not null,                        -- breathing | grounding | pmr | meditation | timer
  title_hi    text not null,
  title_en    text not null,
  config_json jsonb not null default '{}'::jsonb,   -- per-type params (pattern, durations, ambient list)
  audio_hi    text,                                 -- Supabase Storage path (pre-rendered TTS)
  audio_en    text,
  premium     boolean not null default false,       -- entitlement gate is enforced server-side, not by RLS
  sort        integer not null default 0,
  created_at  timestamptz not null default now()
);

-- F7 guided journeys (multi-day exam-stress programs).
create table if not exists public.sukoon_journeys (
  id        uuid primary key default gen_random_uuid(),
  slug      text not null unique,
  title_hi  text not null,
  title_en  text not null,
  days      smallint not null default 1,
  premium   boolean not null default false,
  version   integer not null default 1,
  published boolean not null default false           -- unpublished drafts are invisible to users (0002)
);

create table if not exists public.sukoon_journey_steps (
  id           uuid primary key default gen_random_uuid(),
  journey_id   uuid not null references public.sukoon_journeys(id) on delete cascade,
  day          smallint not null,
  step_order   smallint not null,
  type         text not null,                        -- read | exercise | journal | saathi
  content_json jsonb not null,
  unique (journey_id, day, step_order)
);

-- ---------------------------------------------------------------------------
-- User-scoped tables (own user_id → auth.users; owner-only RLS in 0002).
-- ---------------------------------------------------------------------------

-- F1 profile — one row per Sukoon user, written by the onboarding endpoint.
-- `language` is the CHAT preference (hi | en | hinglish) — what Saathi replies
-- in — NOT the UI language (that follows Neev's global toggle). restricted_mode
-- is set true for under-18 self-declaration (no open chat; DPDP children's-data
-- caution). Existence of this row == the user has finished Sukoon onboarding.
create table if not exists public.sukoon_profiles (
  user_id              uuid primary key references auth.users(id) on delete cascade,
  language             text not null default 'hi' check (language in ('hi', 'en', 'hinglish')),
  exam                 text,
  exam_attempt         smallint,
  exam_date            date,
  restricted_mode      boolean not null default false,
  voice_pref           text,                          -- reserved for Voice Mode (F10)
  reminder_time        time,                          -- user-chosen local check-in time (F5/F11)
  onboarding_completed boolean not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create trigger sukoon_profiles_set_updated_at
  before update on public.sukoon_profiles
  for each row execute function public.sukoon_set_updated_at();

-- F1 consent — versioned, append-only. consent_version is a SERVER-side
-- constant (never sent by the client); a bump mints a fresh row on re-consent.
-- unique(user_id, consent_version) makes re-submitting the SAME version a
-- no-op (the onboarding endpoint upserts on-conflict-do-nothing).
create table if not exists public.sukoon_consents (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  consent_version text not null,
  consented_at    timestamptz not null default now(),
  unique (user_id, consent_version)
);
create index if not exists sukoon_consents_user_idx
  on public.sukoon_consents (user_id, consented_at desc);

-- F2 chat conversations + messages.
create table if not exists public.sukoon_conversations (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  started_at      timestamptz not null default now(),
  summary         text,
  last_message_at timestamptz
);
create index if not exists sukoon_conversations_user_idx
  on public.sukoon_conversations (user_id, last_message_at desc);

create table if not exists public.sukoon_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.sukoon_conversations(id) on delete cascade,
  role            text not null check (role in ('user', 'assistant', 'system')),
  content         text not null,
  model_used      text,
  crisis_level    text check (crisis_level in ('none', 'low', 'moderate', 'high', 'critical')),
  created_at      timestamptz not null default now()
);
create index if not exists sukoon_messages_conversation_idx
  on public.sukoon_messages (conversation_id, created_at);

-- F2 rolling per-user chat summary (memory compression).
create table if not exists public.sukoon_chat_summaries (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  summary    text,
  updated_at timestamptz not null default now()
);
create trigger sukoon_chat_summaries_set_updated_at
  before update on public.sukoon_chat_summaries
  for each row execute function public.sukoon_set_updated_at();

-- F3 crisis events — privacy-first: level + layer + time only, never raw text.
create table if not exists public.sukoon_crisis_events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  level      text not null check (level in ('low', 'moderate', 'high', 'critical')),
  layer      text not null check (layer in ('keyword', 'classifier')),
  created_at timestamptz not null default now()
);
create index if not exists sukoon_crisis_events_user_idx
  on public.sukoon_crisis_events (user_id, created_at desc);

-- F4 journal — body_enc is pgp_sym_encrypt ciphertext (bytea), never plaintext.
create table if not exists public.sukoon_journal_entries (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  body_enc   bytea,                                  -- pgp_sym_encrypt(body, <server key>)
  mood       smallint check (mood between 1 and 5),
  tags       text[] not null default '{}',
  prompt_id  uuid references public.sukoon_journal_prompts(id) on delete set null,
  audio_path text,                                   -- voice-note journal (premium)
  created_at timestamptz not null default now(),
  deleted_at timestamptz                             -- soft delete (F12 7-day purge)
);
create index if not exists sukoon_journal_entries_user_idx
  on public.sukoon_journal_entries (user_id, created_at desc);

-- F5 mood check-ins.
create table if not exists public.sukoon_mood_entries (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  score      smallint not null check (score between 1 and 5),
  emotions   text[] not null default '{}',
  factors    text[] not null default '{}',
  note       text,
  created_at timestamptz not null default now()
);
create index if not exists sukoon_mood_entries_user_idx
  on public.sukoon_mood_entries (user_id, created_at desc);

-- F8 wellbeing check-ins (WHO-5 + custom stress self-check — NOT clinical screeners).
create table if not exists public.sukoon_checkins (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  type         text not null check (type in ('who5', 'stress_self_check')),
  answers_json jsonb not null,
  score        numeric,
  created_at   timestamptz not null default now()
);
create index if not exists sukoon_checkins_user_idx
  on public.sukoon_checkins (user_id, created_at desc);

-- F6 exercise session logging.
create table if not exists public.sukoon_exercise_sessions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  exercise_id uuid references public.sukoon_exercises(id) on delete set null,
  duration_s  integer,
  completed   boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists sukoon_exercise_sessions_user_idx
  on public.sukoon_exercise_sessions (user_id, created_at desc);

-- F7 per-user journey progress.
create table if not exists public.sukoon_journey_progress (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  journey_id      uuid not null references public.sukoon_journeys(id) on delete cascade,
  current_day     smallint not null default 1,
  completed_steps text[] not null default '{}',
  started_at      timestamptz not null default now(),
  completed_at    timestamptz,
  unique (user_id, journey_id)
);
create index if not exists sukoon_journey_progress_user_idx
  on public.sukoon_journey_progress (user_id, started_at desc);

-- F9 weekly insights (Plus+).
create table if not exists public.sukoon_insights (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  week_start date not null,
  content    text not null,
  created_at timestamptz not null default now(),
  unique (user_id, week_start)
);
create index if not exists sukoon_insights_user_idx
  on public.sukoon_insights (user_id, week_start desc);

-- Tier-cap counters (server-enforced before any model call). Composite PKs.
create table if not exists public.sukoon_usage (
  user_id     uuid not null references auth.users(id) on delete cascade,
  date        date not null,
  chat_msgs   integer not null default 0,
  reflections integer not null default 0,
  primary key (user_id, date)
);

create table if not exists public.sukoon_voice_usage (
  user_id      uuid not null references auth.users(id) on delete cascade,
  month        text not null,                        -- 'YYYY-MM'
  seconds_used integer not null default 0,
  primary key (user_id, month)
);

-- F13 billing — a minimal MIRROR (blueprint §6 offers "reuse Neev tables OR
-- mirror"); mirrored so the standalone project needs no Neev billing schema.
-- Session 10 fleshes this out; scaffolded here so the set matches §6.
create table if not exists public.sukoon_subscriptions (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid not null references auth.users(id) on delete cascade,
  product                 text not null default 'sukoon',
  tier                    text not null check (tier in ('free', 'plus', 'pro')),
  status                  text not null check (status in ('active', 'cancelled', 'expired', 'trialing')),
  razorpay_subscription_id text,
  current_period_end      timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create index if not exists sukoon_subscriptions_user_idx
  on public.sukoon_subscriptions (user_id);
create trigger sukoon_subscriptions_set_updated_at
  before update on public.sukoon_subscriptions
  for each row execute function public.sukoon_set_updated_at();

-- Semantic FAQ cache (F2 cost spine) — INTERNAL, service-role only (0002 gives
-- it RLS-on + no policy). 1536-dim matches OpenAI text-embedding-3-small, the
-- provider already in the stack (blueprint §5); vector type/opclass are
-- schema-qualified to `extensions` per the Neev pgvector convention.
create table if not exists public.sukoon_semantic_cache (
  id         uuid primary key default gen_random_uuid(),
  embedding  extensions.vector(1536),
  prompt     text,
  response   text not null,
  lang       text not null check (lang in ('hi', 'en', 'hinglish')),
  hits       integer not null default 0,
  reviewed   boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists sukoon_semantic_cache_embedding_idx
  on public.sukoon_semantic_cache
  using hnsw (embedding extensions.vector_cosine_ops);
