-- =============================================================================
-- 0091_sukoon_privacy_f12.sql — Session 13 (blueprint F12): Privacy Center &
-- DPDP compliance. Adds the account-lifecycle state, the async data-export job
-- ledger, and a privacy-action audit trail. Self-contained sukoon_ tables only
-- (module rules): every reference is auth.users, never a Neev feature table.
--
-- RLS follows the 0088 per-table style (a handful of new tables, so an explicit
-- block reads clearer than folding them into 0079's loop). A direct
-- `db push --db-url` connection gets no automatic Supabase API-role grants, so
-- grants are spelled out per table (the 42501 gotcha, see
-- [[supabase-headless-migrations]]). Idempotent: `if not exists` + drop-policy.
--
-- The API talks to Postgres with the SERVICE ROLE (BYPASSRLS) and scopes every
-- query by currentUserId(); RLS here is DEFENSE IN DEPTH for any direct anon-key
-- + user-JWT access (the standalone project / a future direct-PostgREST path).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Account-lifecycle state on the profile (F12 soft-delete → 7-day purge).
--    A deleted_at stamp == "account scheduled for deletion"; purge_after is the
--    hard-erase deadline the nightly cron (scripts/sukoon-purge.ts) enforces.
--    deletion_reason distinguishes an explicit account delete from a consent
--    withdrawal (blueprint: "withdraw consent → deactivates account", same
--    mechanism). All nullable/defaulted → additive, every existing row is
--    implicitly active.
-- ---------------------------------------------------------------------------
alter table public.sukoon_profiles
  add column if not exists deleted_at      timestamptz,
  add column if not exists purge_after     timestamptz,
  add column if not exists deletion_reason text
    check (deletion_reason is null or deletion_reason in ('user_request', 'consent_withdrawn'));

-- The cron scans this to find rows due for hard purge — a small partial index
-- keeps that scan cheap as the table grows (only soft-deleted rows are indexed).
create index if not exists sukoon_profiles_purge_idx
  on public.sukoon_profiles (purge_after)
  where deleted_at is not null;

-- ---------------------------------------------------------------------------
-- 2. Async data-export jobs (F12: "export all data — JSON + journal PDF; async
--    job with an expiring download link"). One row per export request. The API
--    creates the row (service role), then processes it best-effort in-process
--    and writes the artifact paths + expiry; the client polls status and, once
--    ready, the download endpoint mints a FRESH short-lived signed URL each time
--    (so a link never goes stale before the whole job expires). Artifacts live
--    in the private sukoon-exports bucket under <user_id>/<job_id>/… and are
--    removed by the same nightly purge once expires_at passes.
-- ---------------------------------------------------------------------------
create table if not exists public.sukoon_export_jobs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  status        text not null default 'pending'
                  check (status in ('pending', 'processing', 'ready', 'failed', 'expired')),
  error         text,                                  -- populated only on 'failed'
  json_path     text,                                  -- storage key of the full-data JSON
  journal_path  text,                                  -- storage key of the print-ready journal doc
  entry_count   integer,                               -- journal entries included (UI hint)
  requested_at  timestamptz not null default now(),
  completed_at  timestamptz,
  expires_at    timestamptz                            -- after this the links + artifacts are void
);
create index if not exists sukoon_export_jobs_user_idx
  on public.sukoon_export_jobs (user_id, requested_at desc);
-- At most one in-flight export per user (the endpoint returns the existing one
-- instead of stacking work) — a partial unique index makes that race-proof.
create unique index if not exists sukoon_export_jobs_one_active_idx
  on public.sukoon_export_jobs (user_id)
  where status in ('pending', 'processing');

-- ---------------------------------------------------------------------------
-- 3. Privacy-action audit trail (F12: "audit log of privacy actions"). Append-
--    only; written by the service role only. The user can READ their own trail
--    in the Privacy Center ("you requested an export on …"). detail is small,
--    non-sensitive metadata (never journal/chat text).
-- ---------------------------------------------------------------------------
create table if not exists public.sukoon_privacy_audit (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  action     text not null
               check (action in ('export_requested', 'export_ready', 'export_failed',
                                 'delete_requested', 'delete_cancelled', 'consent_withdrawn',
                                 'account_purged')),
  detail     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists sukoon_privacy_audit_user_idx
  on public.sukoon_privacy_audit (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 4. RLS + grants for the two new user-scoped tables. Unlike 0079's ordinary
--    user tables (full owner CRUD), these are READ-ONLY to the owner: a user
--    may view their own export jobs / audit trail but must NOT be able to forge
--    a job row or an audit entry over a direct anon-key path — those are written
--    exclusively by the trusted API (service role, BYPASSRLS). So: owner SELECT
--    policy only, no insert/update/delete policy → authenticated is write-denied.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['sukoon_export_jobs', 'sukoon_privacy_audit'] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('revoke all on public.%I from anon, authenticated;', t);
    execute format('grant all on public.%I to service_role;', t);
    execute format('grant select on public.%I to authenticated;', t);
    execute format('drop policy if exists owner_select on public.%I;', t);
    execute format($f$
      create policy owner_select on public.%1$I
        for select to authenticated using (auth.uid() = user_id);
    $f$, t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Private storage bucket for export artifacts. No bucket RLS policy (same
--    posture as sukoon-audio in 0084): every read goes through a server-minted,
--    short-lived signed URL from the SERVICE ROLE client, which is the one place
--    ownership is enforced (a job's paths are only ever signed for their owner —
--    see services/export.ts). JSON + a self-contained HTML journal doc only, so
--    the size cap is small and the mime allowlist is text.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'sukoon-exports', 'sukoon-exports', false,
  10485760, -- 10MB — a full JSON + HTML journal for one user stays well under this
  array['application/json', 'text/html']
)
on conflict (id) do nothing;
