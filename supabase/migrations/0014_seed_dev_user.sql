-- 0014_seed_dev_user.sql
-- Seed the single pre-auth dev user with a FIXED uuid. Every API call acts as
-- this user until real auth (Session 15). Copy the id below into DEV_USER_ID in
-- apps/api/.env.
--
--   DEV_USER_ID = 00000000-0000-4000-8000-000000000001

insert into public.users_profile (id, display_name, preferred_locale, medium, plan)
values ('00000000-0000-4000-8000-000000000001', 'Dev User', 'hi', 'hi', 'pro')
on conflict (id) do nothing;

do $$
begin
  raise notice 'Seeded dev user. Set DEV_USER_ID=00000000-0000-4000-8000-000000000001 in apps/api/.env';
end;
$$;
