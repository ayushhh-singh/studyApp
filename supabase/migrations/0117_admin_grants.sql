-- 0117_admin_grants.sql
-- Audit trail for the new admin "Users" surface — an admin granting/revoking
-- Pro access or admin privilege for a specific user. Append-only, internal
-- only (no RLS policy at all — service role only), same pattern as
-- post_screenings/llm_calls/generation_batches (0055/0009).
--
-- This does NOT introduce a parallel access-control field. Pro access is
-- still decided entirely by users_profile.plan + plan_expires_at
-- (services/entitlements.ts's getPlanFor), and admin access by
-- users_profile.is_admin (lib/admin.ts). This table only records WHO changed
-- those existing fields, WHEN, and what changed — the actual grant/revoke
-- still writes through the same columns every other part of the app reads.

create type admin_grant_action as enum ('grant_pro', 'revoke_pro', 'grant_admin', 'revoke_admin');

create table public.admin_grants (
  id             uuid primary key default gen_random_uuid(),
  -- `set null`, not cascade: deleting the ADMIN account must never delete the
  -- historical record of an action they took (mirrors question_reports.resolved_by
  -- / reports.resolved_by — the established "who performed this" pattern).
  admin_user_id  uuid references public.users_profile(id) on delete set null,
  -- `cascade`: once the TARGET user's whole profile is gone, a grant record
  -- about them carries no further meaning.
  target_user_id uuid not null references public.users_profile(id) on delete cascade,
  action         admin_grant_action not null,
  detail         jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);

comment on table public.admin_grants is
  'Append-only audit trail of admin-initiated Pro/admin access grants and revocations (the /admin/users surface). Internal-only — service role only, no RLS policy.';

create index admin_grants_target_idx on public.admin_grants (target_user_id, created_at desc);
create index admin_grants_admin_idx on public.admin_grants (admin_user_id, created_at desc);

alter table public.admin_grants enable row level security;
