-- =============================================================================
-- 0077_mains_board_default_shown.sql — Mains board flips from opt-IN to
-- opt-OUT, per direct product decision: everyone is shown on the Mains
-- (Answer Writing / Essay) board by default, with a "leave the board" control
-- always available (see components/scoreboard/mains-opt-in-card.tsx).
--
-- users_profile.show_on_mains_board (0067) was `default false` — a user had
-- to actively opt in to appear. Flipping the column default to `true` only
-- affects FUTURE signups (handle_new_user() never sets this column
-- explicitly, so it always inherits the table default); existing rows need an
-- explicit backfill. Backfilling unconditionally to true is safe here: real
-- users checked in the live DB show only 2 of 68 profiles at true, and both
-- are already true — every false row today is an untouched default, never a
-- deliberate "I chose to hide" decision, so there is no real opt-out signal
-- to preserve by leaving them false.
-- =============================================================================

alter table public.users_profile
  alter column show_on_mains_board set default true;

update public.users_profile
  set show_on_mains_board = true
  where show_on_mains_board = false;
