-- Sukoon F8/F9 (Wellbeing Check-ins + Weekly Insights) — additive columns only.
-- The sukoon_checkins and sukoon_insights TABLES already exist (0078 core); this
-- migration adds (a) the two insights consent flags on sukoon_profiles and
-- (b) the structured/denormalised fields the weekly-insights job writes onto
-- sukoon_insights. No new tables, no RLS changes: both tables are already
-- owner-scoped (0079), and RLS is row-level, so new columns inherit the existing
-- policies. Fully idempotent (add-column-if-not-exists) — safe to re-run.

-- F9 consent flags. insights_opt_in defaults TRUE (the Sunday job is a paid
-- benefit the user opted into by subscribing, honoured as opt-OUT). The existing
-- profiles CHECK/trigger set is untouched.
alter table public.sukoon_profiles
  add column if not exists insights_opt_in       boolean not null default true,
  add column if not exists deep_insights_opt_in  boolean not null default false;

-- deep_insights_opt_in is the STRICTER, Pro-only consent to let the model read
-- decrypted journal bodies (not just metadata). The tier gate is enforced in
-- services/insights.ts — this column only records the preference.
comment on column public.sukoon_profiles.deep_insights_opt_in is
  'F9: consent to include decrypted journal excerpts in weekly insights. Honoured only for tier=pro (server-enforced), never by trusting this flag alone.';

-- F9 sukoon_insights enrichment. The base table has (id, user_id, week_start,
-- content, created_at, unique(user_id, week_start)). `content` stays the warm
-- ~150-word summary; the rest is the structured output + denormalised journey
-- titles so the FE card renders fields without a join. `meta` carries the
-- non-display record (model, tokens, cost, the signal counts the insight was
-- built from) for cost:report / debugging.
alter table public.sukoon_insights
  add column if not exists suggestion       text,
  add column if not exists journey_slug     text,
  add column if not exists journey_reason   text,
  add column if not exists journey_title_hi text,
  add column if not exists journey_title_en text,
  add column if not exists language         text,
  add column if not exists meta             jsonb not null default '{}'::jsonb;
