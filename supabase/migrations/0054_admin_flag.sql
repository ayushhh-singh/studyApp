-- 0054_admin_flag.sql
-- Replaces the ADMIN_MODE env flag with a real per-user `is_admin` flag on
-- users_profile. The Review Queue (question + notes moderation) is gated on it:
-- the API's requireAdmin now looks up is_admin for the authenticated user
-- instead of reading process.env.ADMIN_MODE.
--
-- Seeding the founder: a single admin email is baked in here (the only admin
-- today). The seed is applied two ways so it works no matter the order of
-- operations — (a) an immediate backfill for the account if it has already
-- signed in, and (b) handle_new_user() is taught to stamp is_admin at first
-- sign-in for the same email, so signing in later still lands admin.

alter table public.users_profile
  add column if not exists is_admin boolean not null default false;

-- (a) Backfill: if the founder has already signed in, their profile row exists
-- and is joined to auth.users by id — flip it now.
update public.users_profile p
set is_admin = true
from auth.users u
where u.id = p.id
  and lower(u.email) = lower('asingh9@ee.iitr.ac.in');

-- (b) Provision-time: recreate handle_new_user() so a first sign-in by an admin
-- email is stamped is_admin immediately. Keeps the display_name best-effort and
-- the idempotent on-conflict from 0052.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users_profile (id, display_name, is_admin)
  values (
    new.id,
    nullif(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'), ''),
    lower(coalesce(new.email, '')) = lower('asingh9@ee.iitr.ac.in')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
