-- Sukoon F7 (Guided Journeys) — content columns the 0078 schema didn't yet
-- have: bilingual catalog description (for the catalog card + detail header)
-- and per-user completion-reflection storage + a small step-response jsonb
-- (checkin_scale picks, etc.) on sukoon_journey_progress. Both tables already
-- have RLS from 0079 (content_read on sukoon_journeys, owner CRUD on
-- sukoon_journey_progress) — purely additive columns, no policy change needed.
--
-- Applied to the cloud DB via `db push --db-url` — see [[supabase-headless-migrations]].

alter table public.sukoon_journeys
  add column if not exists description_hi text not null default '',
  add column if not exists description_en text not null default '';

alter table public.sukoon_journey_progress
  add column if not exists reflection    text,
  add column if not exists reflection_at timestamptz,
  add column if not exists step_responses jsonb not null default '{}'::jsonb;
