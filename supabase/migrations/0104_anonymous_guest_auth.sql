-- =============================================================================
-- 0104_anonymous_guest_auth.sql — guest/anonymous browsing support.
--
-- Supabase native anonymous auth (supabase.auth.signInAnonymously()) creates a
-- REAL auth.users row with is_anonymous = true and a normal 'authenticated'-
-- audience JWT. That row fires handle_new_user() (0052) exactly like a real
-- sign-up — which, since 0075, UNCONDITIONALLY grants a 7-day Pro trial.
--
-- THAT IS WRONG for a guest: a purely anonymous visitor who never converts must
-- NOT consume or hold a trial. The 7-day trial is a REAL-signup perk. This
-- migration makes handle_new_user() branch on is_anonymous:
--   * anonymous   -> provision a plain FREE profile (plan/locale column defaults,
--                    has_used_trial stays false). No trial, no expiry.
--   * real signup -> the 0075 behavior: plan='pro', now()+7d, has_used_trial=true.
--
-- The trial for a guest who LATER upgrades/links to a real identity is granted at
-- CONVERSION time IN CODE (services/trial.ts::claimTrial, called by the web app
-- after auth.updateUser()/linkIdentity()), NOT here — because converting an
-- anonymous user is an UPDATE to the existing auth.users row (is_anonymous flips
-- to false), which does NOT re-fire this AFTER INSERT trigger. So the "trial only
-- at real signup" rule holds for BOTH a fresh signup (this trigger, else-branch)
-- and an anonymous->real upgrade (claimTrial), and never for a pure guest.
--
-- Idempotent: create-or-replace of one function. auth.users.is_anonymous has
-- existed since GoTrue shipped anonymous auth (the column is present regardless
-- of whether the project's anonymous-sign-in toggle is on), so new.is_anonymous
-- always resolves. NOT enabling the toggle itself — that is a project auth
-- setting (dashboard: Authentication -> Sign In / Providers -> Anonymous, or
-- config.toml enable_anonymous_sign_ins for local); documented in CLAUDE.md.
-- =============================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(new.is_anonymous, false) then
    -- Guest: a free profile on the column defaults. No display_name (an
    -- anonymous user has no provider metadata), no plan/expiry/trial flag.
    insert into public.users_profile (id)
    values (new.id)
    on conflict (id) do nothing;
  else
    -- Real signup (email/password or OAuth): grant the 7-day Pro trial (0075).
    insert into public.users_profile (id, display_name, plan, plan_expires_at, has_used_trial)
    values (
      new.id,
      nullif(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'), ''),
      'pro',
      now() + interval '7 days',
      true
    )
    on conflict (id) do nothing;
  end if;
  return new;
end;
$$;
-- The on_auth_user_created trigger (0052) already binds this function — unchanged.
