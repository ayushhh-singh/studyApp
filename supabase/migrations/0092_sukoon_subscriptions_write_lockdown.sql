-- =============================================================================
-- 0090_sukoon_subscriptions_write_lockdown.sql — SECURITY FIX (F13 follow-up).
--
-- 0088 was authored with this write-lockdown, but the migration was recorded as
-- applied to the remote DB by a concurrent `db push` BEFORE the lockdown block
-- was added to the 0088 file — so the actual lockdown SQL never ran, and
-- `db push` will never re-run 0088 (its hash is in the history). Verified live:
-- an authenticated user COULD self-INSERT a `tier='pro'` sukoon_subscriptions
-- row via the anon key + their JWT, granting themselves Pro. This migration
-- re-asserts the intended state as a fresh, idempotent, self-healing step.
--
-- Desired state (mirrors Neev's `subscriptions`): sukoon_subscriptions is the
-- billing SOURCE OF TRUTH (getSukoonTier reads it), so a user may only SELECT
-- their own row — every WRITE goes through the service-role API
-- (createSukoonOrder / the webhook / cancel). Account-deletion (DPDP) still
-- works via the auth.users ON DELETE CASCADE, so removing owner DELETE loses no
-- user right.
-- =============================================================================

-- RLS must be on (0079 enabled it; re-assert defensively).
alter table public.sukoon_subscriptions enable row level security;

-- Drop the owner WRITE policies 0079 created (owner_select stays — read your own).
drop policy if exists owner_insert on public.sukoon_subscriptions;
drop policy if exists owner_update on public.sukoon_subscriptions;
drop policy if exists owner_delete on public.sukoon_subscriptions;

-- Revoke the write GRANTS 0079 gave the client roles (grants gate reachability
-- BEFORE RLS is even consulted — both must be closed).
revoke insert, update, delete on public.sukoon_subscriptions from anon, authenticated;

-- Guarantee owner-SELECT still exists (so the manage screen's read works even if
-- some path had dropped it). Idempotent: drop-then-create.
drop policy if exists owner_select on public.sukoon_subscriptions;
create policy owner_select on public.sukoon_subscriptions
  for select to authenticated using (auth.uid() = user_id);
grant select on public.sukoon_subscriptions to authenticated;

-- The service role keeps full access (BYPASSRLS still needs the table grant present).
grant all on public.sukoon_subscriptions to service_role;
