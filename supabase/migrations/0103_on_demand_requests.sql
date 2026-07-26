-- =============================================================================
-- 0103_on_demand_requests.sql — the demand signal behind "Show me a new set".
-- (Numbered 0103 to sit above the 0079–0100 range already applied to the shared
-- cloud DB by a concurrent branch.)
--
-- A lightweight log of "this user asked for a fresh set on this topic today".
-- It is NOT the fresh set itself (that's a normal tests/test_questions row the
-- user is navigated straight into) — it is the DEMAND SIGNAL that
-- qgen/topup.ts's nightly run reads to size a per-node ON-DEMAND RESERVE on top
-- of the baseline weightage floor, so a heavily-requested topic keeps a stock of
-- fresh (unseen) generated questions ready to select instantly. Same
-- continuously-generate → review-gate → publish pipeline current affairs already
-- uses (ca:run), extended to general syllabus topics rather than reinvented.
--
-- DEDUP / ABUSE RESISTANCE (step 4): one row per (user, node, scope, IST day)
-- via a unique index — repeatedly clicking "Show me a new set" on the same
-- scope the same day can't multiply the demand signal (a single curious click
-- and a hammering user both contribute exactly one request-day). scope_type
-- keeps a custom (topic) request and a mock (whole-paper) request as distinct
-- signals, since they drive different reserve needs.
--
-- DECAY (step 3): the reserve is recomputed each night from a ROLLING recent
-- window (ON_DEMAND_WINDOW_DAYS in qgen/on-demand-reserve.ts), so a
-- briefly-popular topic's target tapers back to its baseline floor once the
-- requests age out of the window — it is not a one-way ratchet. Nothing here
-- deletes the accumulated questions (a sunk asset that still serves), it just
-- stops adding to the target.
-- =============================================================================

create table if not exists public.on_demand_requests (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users_profile(id) on delete cascade,
  -- The specific syllabus node the user requested. For a custom set that's each
  -- selected topic; for a mock it's the paper's depth-0 root node (a
  -- whole-paper signal). No trigger/FK-by-convention subtlety — a real FK, since
  -- a request only ever names a real node id.
  node_id      uuid not null references public.syllabus_nodes(id) on delete cascade,
  scope_type   text not null check (scope_type in ('custom', 'mock')),
  exam         text,
  requested_at timestamptz not null default now(),
  -- IST calendar day of the request, for per-day dedup (matches the app's
  -- IST-day convention used everywhere else — lib/ist.ts).
  requested_on date not null default ((now() at time zone 'Asia/Kolkata')::date)
);

-- Dedup: at most one demand row per user + node + scope + IST day.
create unique index if not exists on_demand_requests_dedup_idx
  on public.on_demand_requests (user_id, node_id, scope_type, requested_on);

-- Reserve sizing scans the recent window across all users, grouped by node.
create index if not exists on_demand_requests_window_idx
  on public.on_demand_requests (requested_at desc, node_id);

-- RLS: owner-only, same shape as every other user-scoped table (0053). The API
-- writes/reads this table with the service role (BYPASSRLS) and scopes by the
-- token-derived user id — these policies are the defense-in-depth layer for the
-- browser's anon-key + JWT, which never touches this table directly today.
alter table public.on_demand_requests enable row level security;
revoke all on public.on_demand_requests from anon;

drop policy if exists owner_select on public.on_demand_requests;
drop policy if exists owner_insert on public.on_demand_requests;
create policy owner_select on public.on_demand_requests
  for select to authenticated using (auth.uid() = user_id);
create policy owner_insert on public.on_demand_requests
  for insert to authenticated with check (auth.uid() = user_id);
