-- =============================================================================
-- 0100_sukoon_meditations.sql — Personalized guided meditations (extends F6).
--
-- A short AI-generated guided meditation SCRIPT, authored live from what a
-- person just talked about with Saathi (F2) or how they just checked in on
-- their mood (F5), narrated via the Voice-Mode TTS provider (F10) and played
-- over a real ambient bed (S2 soundscapes). Unlike the static F6 meditation
-- LIBRARY (sukoon_exercises, operator-seeded/generic), each row here is one
-- personalized meditation — and is CACHED (script + rendered audio path) so a
-- replay, or an identical re-request, never regenerates or re-renders (the
-- expensive parts: the LLM call and the one-time TTS render).
--
--   sukoon_meditations — a user-scoped personal-content table (owner CRUD RLS,
--     same category as sukoon_conversations et al in 0079). `audio_path` points
--     into the private `sukoon-audio` bucket (0084) under `meditations/<id>.<ext>`,
--     uploaded by the service role (lib/storage.ts) and served only via a
--     server-signed URL — the same "signing is the one place premium/ownership
--     is enforced for audio" posture as exercises. `cache_key` is the reuse
--     arbiter: sha256 of (source, source_ref, focus, duration, language, voice,
--     context_hash) — an identical request within the same unchanged context
--     replays the stored row instead of spending an LLM+TTS round trip.
--
-- Also adds sukoon_usage.meditations — the per-day generation counter that backs
-- the tier allowance (free: 3 LIFETIME; plus/pro: a daily budget), exactly
-- mirroring the existing chat_msgs / reflections counters in that table. A
-- REPLAY (cache hit) never touches this counter.
--
-- RLS: user-scoped owner-CRUD (auth.uid() = user_id), matching 0079's
-- user_tables category — the browser never reads this table directly today
-- (every read goes through the API's service-role client), but the owner
-- policy is defense-in-depth and keeps the table in the same shape as every
-- other personal-content table so a future direct-read path is safe for free.
-- A direct `db push --db-url` connection gets no automatic Supabase API-role
-- grants, so grants are spelled out explicitly (the 42501 gotcha, see
-- [[supabase-headless-migrations]]).
--
-- Idempotent: `if not exists` + drop-policy-if-exists.
-- =============================================================================

-- 1) The per-day generation counter (mirrors chat_msgs / reflections in 0078).
alter table public.sukoon_usage
  add column if not exists meditations integer not null default 0;

-- 2) The personalized-meditation store.
create table if not exists public.sukoon_meditations (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  -- Provenance + controls (all reproducible, so an identical request is cacheable).
  source        text not null check (source in ('chat', 'mood', 'manual')),
  -- FK-BY-CONVENTION only (a sukoon_conversations id when source='chat', else
  -- null) — same idiom as sukoon_feedback.target_id; never a real FK, so a
  -- conversation can be purged independently without orphaning a delete.
  source_ref    uuid,
  focus         text not null,
  duration_min  integer not null,
  language      text not null check (language in ('hi', 'en', 'hinglish')),
  voice         text not null,
  ambient       text,                       -- ambient bed id, or null (narration only)
  -- The generated content + its rendered audio.
  script        text not null,
  audio_path    text,                        -- sukoon-audio path; null if TTS render failed
  -- Reuse arbiter (see header) + the context digest it was built from, so a
  -- moved-on conversation / changed controls naturally miss the cache.
  cache_key     text not null,
  context_hash  text not null,
  -- Cost/provenance bookkeeping (never surfaced to the user).
  model         text,
  cost_usd      numeric(10, 6) not null default 0,
  created_at    timestamptz not null default now()
);

create index if not exists sukoon_meditations_user_idx
  on public.sukoon_meditations(user_id, created_at desc);

-- The reuse lookup: newest matching row for (user, cache_key). Not UNIQUE — a
-- regeneration after the cached audio expired/failed is allowed to write a new
-- row; the service reads the newest by created_at.
create index if not exists sukoon_meditations_cache_idx
  on public.sukoon_meditations(user_id, cache_key, created_at desc);

-- 3) RLS: owner CRUD (0079 user_tables category). Explicit grants for the
--    db-push-direct path (42501 gotcha).
alter table public.sukoon_meditations enable row level security;
grant select, insert, update, delete on public.sukoon_meditations to authenticated;

drop policy if exists owner_select on public.sukoon_meditations;
drop policy if exists owner_insert on public.sukoon_meditations;
drop policy if exists owner_update on public.sukoon_meditations;
drop policy if exists owner_delete on public.sukoon_meditations;

create policy owner_select on public.sukoon_meditations
  for select to authenticated using (auth.uid() = user_id);
create policy owner_insert on public.sukoon_meditations
  for insert to authenticated with check (auth.uid() = user_id);
create policy owner_update on public.sukoon_meditations
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy owner_delete on public.sukoon_meditations
  for delete to authenticated using (auth.uid() = user_id);
