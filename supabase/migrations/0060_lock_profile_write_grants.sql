-- =============================================================================
-- 0058_lock_profile_write_grants.sql — SECURITY FIX (privilege escalation).
--
-- The 0053 `owner_update` RLS policy on users_profile lets a user update their
-- OWN row. RLS is ROW-level, not column-level, so that policy also allowed a
-- signed-in user to PATCH sensitive columns of their own row directly via
-- PostgREST (anon key + their JWT), bypassing the API entirely:
--
--   * plan = 'pro' / plan_expires_at  → self-grant Pro, bypassing all billing.
--   * is_admin = true                 → self-grant admin (Review Queue /
--                                       moderation / note approval).
--
-- The browser NEVER writes users_profile directly — every profile write goes
-- through the Express API, which uses the SERVICE ROLE (BYPASSRLS, and not
-- affected by these grants). The only browser↔Supabase writes are Storage
-- uploads. So we revoke INSERT/UPDATE/DELETE on users_profile from the client
-- roles entirely; SELECT (owner_select) stays. This closes both escalations at
-- the grant layer, independent of any RLS policy.
--
-- (handle_new_user() provisioning is SECURITY DEFINER, so it does not rely on
-- the authenticated/anon grants either.)
-- =============================================================================

revoke insert, update, delete on public.users_profile from anon, authenticated;

-- The now-moot owner_update policy is left in place as documentation of intent;
-- with no UPDATE grant it can never be exercised by a client role. Also revoke
-- from PUBLIC in case a default grant ever lands there.
revoke insert, update, delete on public.users_profile from public;
