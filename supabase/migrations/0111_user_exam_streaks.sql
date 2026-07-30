-- 0111_user_exam_streaks.sql
-- Per-exam streak snapshots, closing the multi-exam gap that streak (and its
-- sibling engagement scalars) is GLOBAL on users_profile while every other
-- exam-scoped surface (M1-M9, migrations 0106-0110) already isn't.
--
-- DESIGN (chosen to minimise blast radius across the many existing readers of
-- users_profile.streak_count/last_active_date/streak_freezes/
-- streak_freeze_used_on — dashboard greeting, ProfileCard, the TopBar streak
-- flame, GuidedTodayCard, milestones' streak_7/streak_30 triggers):
--
--   * users_profile's own scalar columns are UNCHANGED in shape and keep
--     meaning "the CURRENTLY ACTIVE exam's live streak state" — every existing
--     reader keeps working with zero changes.
--   * this table is a PARKING SPOT for exams that are NOT currently active.
--     Switching users_profile.target_exam (services/profile.ts's updateProfile)
--     upserts the OUTGOING exam's current scalar values in here, then reads
--     (or defaults) the INCOMING exam's row and writes those 4 values back onto
--     users_profile in the same update — a swap, not a copy, so no history is
--     ever lost in either direction.
--
-- Columns mirror users_profile's own streak family exactly:
--   streak_count           (0003)
--   last_active_date       (0003)
--   streak_freezes         (0045 — banked freezes, max 2, never purchasable)
--   streak_freeze_used_on  (0045)
--
-- daily_stats (0044, the Perfect Day ledger) is deliberately NOT part of this
-- swap set: it is already a per-(user_id, date) historical table, not a global
-- scalar on users_profile, so it needs no exam-scoping change here.

create table public.user_exam_streaks (
  user_id                uuid not null references public.users_profile(id) on delete cascade,
  exam_code              text not null references public.exams(exam_code) on update cascade,
  streak_count           int  not null default 0,
  last_active_date       date,
  streak_freezes         int  not null default 0,
  streak_freeze_used_on  date,
  updated_at             timestamptz not null default now(),
  primary key (user_id, exam_code)
);

comment on table public.user_exam_streaks is
  'Parking-spot snapshot of a user''s streak state for an exam that is NOT their currently-active target_exam. The active exam''s live state stays on users_profile''s own streak_count/last_active_date/streak_freezes/streak_freeze_used_on columns; switching target_exam swaps the outgoing exam''s values in here and restores the incoming exam''s values (or fresh defaults) back onto users_profile. See services/profile.ts''s updateProfile.';

create trigger trg_user_exam_streaks_updated_at
  before update on public.user_exam_streaks
  for each row execute function public.set_updated_at();

-- RLS: owner-only, same shape as every other user-scoped table (0053/0058/0103).
-- No delete policy — rows are swapped/updated in place, never deleted by the
-- app; cascades away only if the user account itself is deleted.
alter table public.user_exam_streaks enable row level security;
revoke all on public.user_exam_streaks from anon;

drop policy if exists owner_select on public.user_exam_streaks;
drop policy if exists owner_insert on public.user_exam_streaks;
drop policy if exists owner_update on public.user_exam_streaks;

create policy owner_select on public.user_exam_streaks
  for select to authenticated using (auth.uid() = user_id);
create policy owner_insert on public.user_exam_streaks
  for insert to authenticated with check (auth.uid() = user_id);
create policy owner_update on public.user_exam_streaks
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
