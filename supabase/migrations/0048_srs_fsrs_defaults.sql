-- 0048_srs_fsrs_defaults.sql
-- Every "add to revision" write path (srs.ts, notes.ts) upserts srs_cards
-- without ever touching fsrs_state, so it was left at the column default
-- '{}'::jsonb — and `fsrs_state ->> 'due_at'` on an empty object is NULL,
-- which never satisfies a `<= now()` due-lookup. Newly added cards were
-- therefore invisible to both this migration's new /srs/due queue and the
-- existing daily-progress.ts due-count query until their first review, which
-- can never happen because they never showed up as due. Fix at the DB layer
-- with a BEFORE INSERT trigger (fires only on INSERT, never UPDATE) so a card
-- is due immediately when added, and the idempotent re-add upserts used
-- throughout the app can keep never touching fsrs_state without this gap.
create or replace function public.srs_card_default_fsrs_state()
returns trigger
language plpgsql
as $$
begin
  if new.fsrs_state is null or new.fsrs_state = '{}'::jsonb then
    new.fsrs_state := jsonb_build_object(
      'due_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'stability', 0,
      'difficulty', 0,
      'elapsed_days', 0,
      'scheduled_days', 0,
      'learning_steps', 0,
      'reps', 0,
      'lapses', 0,
      'state', 0,
      'last_review', null
    );
  end if;
  return new;
end;
$$;

create trigger trg_srs_card_default_fsrs_state
  before insert on public.srs_cards
  for each row execute function public.srs_card_default_fsrs_state();

-- Backfill: any card already sitting at the bare '{}' default (never reviewed,
-- created before this migration) becomes due now too, not stuck forever.
update public.srs_cards
set fsrs_state = jsonb_build_object(
  'due_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'stability', 0,
  'difficulty', 0,
  'elapsed_days', 0,
  'scheduled_days', 0,
  'learning_steps', 0,
  'reps', 0,
  'lapses', 0,
  'state', 0,
  'last_review', null
)
where fsrs_state = '{}'::jsonb;
