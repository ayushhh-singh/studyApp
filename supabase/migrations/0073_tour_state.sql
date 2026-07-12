-- 0073_tour_state.sql
-- Five-layer onboarding/discovery tour: a welcome moment, a two-stage
-- Dashboard checklist, first-arrival section coachmarks, a permanent
-- "Explore Neev" surface, and real discovery instrumentation.
--
--   users_profile.tour_state   {welcome_seen, checklist_stage, sections_seen,
--                                dismissed} — small enough to live inline on
--                                the profile row the app already fetches on
--                                every load, merged server-side (services/
--                                tour.ts), never overwritten wholesale by a
--                                plain profile PATCH.
--   feature_first_touch        one row per (user, feature_key), stamped once
--                                at the natural point each feature is
--                                actually used (never at coachmark-dismiss).
--                                Backs both the checklist's stage-2 items
--                                that have no other natural "done" signal
--                                (scoreboard/community/magazine — viewing IS
--                                the action) and the Explore page's "not
--                                tried yet" badges, plus the
--                                feature-discovery:report script.

alter table public.users_profile
  add column if not exists tour_state jsonb not null default '{}'::jsonb;

create table if not exists public.feature_first_touch (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.users_profile(id) on delete cascade,
  feature_key      text not null,
  first_touched_at timestamptz not null default now(),
  unique (user_id, feature_key)
);

create index if not exists idx_feature_first_touch_user on public.feature_first_touch (user_id);
create index if not exists idx_feature_first_touch_key on public.feature_first_touch (feature_key);

alter table public.feature_first_touch enable row level security;

-- Owner-only read (same shape as every other user-scoped table since 0053).
-- Writes are service-role only (the API's touchFeature() helper) — no
-- insert/update/delete policy, matching the llm_calls/embeddings pattern.
drop policy if exists feature_first_touch_select_own on public.feature_first_touch;
create policy feature_first_touch_select_own on public.feature_first_touch
  for select using (auth.uid() = user_id);
