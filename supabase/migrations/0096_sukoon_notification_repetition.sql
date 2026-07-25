-- =============================================================================
-- 0096_sukoon_notification_repetition.sql — repetition-guard support for
-- services/reminders.ts.
--
-- Records WHICH bilingual copy variant was actually sent for a (user, type,
-- day) slot, so a later tick/day can compare the user's real recent
-- notification history instead of guessing. Additive + nullable: pre-existing
-- rows (from before this feature existed) simply have variant_key = null.
-- reminders.ts's `recentSentVariants` filters `variant_key is not null`, so
-- those old rows — and any row where nothing was actually sent — are
-- correctly excluded from repetition comparisons (there is nothing to feel
-- repetitive about a notification the user never received).
-- =============================================================================

alter table public.sukoon_notification_log
  add column if not exists variant_key text;

comment on column public.sukoon_notification_log.variant_key is
  'Which COPY variant (services/reminders.ts) was sent for this (user, type, day) row. Null means either a pre-repetition-guard row, or a same-day slot where nothing was actually pushed (every variant was judged too semantically similar to something sent recently).';
