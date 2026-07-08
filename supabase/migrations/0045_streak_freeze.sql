-- 0045_streak_freeze.sql
-- Streak Freeze: a banked "get-out-of-jail" that auto-protects the daily streak
-- on a missed day. Earned 1 per completed 7-day streak, banked to a hard max of
-- 2, and NEVER purchasable (no store, no IAP — this is a study aid, not a
-- monetisation hook). Consumed automatically by the nightly streak settle.

alter table public.users_profile
  add column if not exists streak_freezes int not null default 0,
  add column if not exists streak_freeze_used_on date;

comment on column public.users_profile.streak_freezes is 'Banked streak freezes (max 2). Earned per 7-day streak, never purchasable.';
comment on column public.users_profile.streak_freeze_used_on is 'IST date a freeze last protected the streak (for the "Freeze used — streak safe" notice).';
