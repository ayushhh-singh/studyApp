-- 0058_push_subscriptions.sql
-- Web push: browser PushSubscription rows (one per subscribed device/browser)
-- plus a per-user, per-notification-type opt-out. The sender job (draining
-- notification_schedule, see apps/api/src/push/) reads both — it never pushes
-- a type the user has switched off, and prunes a subscription the push
-- service reports as gone (410/404) via its own delete path.

create table public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users_profile(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth_key    text not null,
  user_agent  text,
  created_at  timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index push_subscriptions_user_idx on public.push_subscriptions(user_id);

create table public.push_preferences (
  user_id         uuid primary key references public.users_profile(id) on delete cascade,
  quiz_ready      boolean not null default true,
  streak_at_risk  boolean not null default true,
  srs_due         boolean not null default true,
  updated_at      timestamptz not null default now()
);

create trigger trg_push_preferences_updated_at
  before update on public.push_preferences
  for each row execute function public.set_updated_at();

-- Strict RLS, matching 0053/0056's established shapes: owner-only, and the
-- browser is allowed to DELETE its own subscription (unsubscribe) directly —
-- though in practice the API's service-role key does this too when the push
-- service reports a dead endpoint.
alter table public.push_subscriptions enable row level security;
alter table public.push_preferences enable row level security;

create policy owner_select on public.push_subscriptions
  for select to authenticated using (auth.uid() = user_id);
create policy owner_insert on public.push_subscriptions
  for insert to authenticated with check (auth.uid() = user_id);
create policy owner_delete on public.push_subscriptions
  for delete to authenticated using (auth.uid() = user_id);

create policy owner_all on public.push_preferences
  for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
