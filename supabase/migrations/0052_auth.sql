-- 0052_auth.sql
-- Real authentication (Supabase Auth). Two parts:
--   1. Onboarding columns on users_profile (handle for future community, a
--      completion flag that gates the onboarding wizard, study hours/day used to
--      seed the first AI study plan).
--   2. A trigger on auth.users that provisions a users_profile row on first
--      sign-in (Google OAuth or email OTP), keyed by the auth user's id.
--
-- NOT added here: a hard FK users_profile.id -> auth.users(id). The pre-auth dev
-- user (fixed uuid, not in auth.users) still owns all seeded data at this point;
-- the FK would reject it. It is added in a later migration AFTER the data-
-- migration script (scripts/migrate-dev-user.ts) re-points that data to the real
-- auth uuid and deletes the dev profile row. Until then, per-user scoping is
-- enforced at the API layer (every query filters by the token-derived user id).

alter table public.users_profile
  add column if not exists handle                text unique,
  add column if not exists onboarding_completed  boolean not null default false,
  add column if not exists study_hours_per_day   int;

-- Existing user-scoped data predates auth; the dev profile row stays as-is
-- (onboarding_completed = false) until the data-migration script folds it into
-- the real account.

-- Provision a profile row for every newly-created auth user. SECURITY DEFINER so
-- the trigger (run as the auth admin on insert into auth.users) may write into
-- public.users_profile. display_name is best-effort from the OAuth provider's
-- metadata (Google supplies full_name/name); email-OTP users have none and fill
-- it in during onboarding. Locale/medium keep the column defaults and are set by
-- the onboarding wizard. on conflict keeps this idempotent (re-runs, migration).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users_profile (id, display_name)
  values (
    new.id,
    nullif(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
