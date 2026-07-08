-- =============================================================================
-- 0057_billing.sql — Monetization (freemium) schema.
--
-- Pricing is DATA, not code: the `plans` table is the single source of truth for
-- what a Pro subscription costs. `subscriptions` records each user's billing
-- state (driven ENTIRELY by signature-verified Razorpay webhooks, never by a
-- client call), and `billing_events` gives webhook idempotency — a replayed
-- Razorpay event id is a no-op because its row already exists.
--
-- users_profile.plan (the user_plan enum, since 0003) is the flag every
-- entitlement reads; the webhook flips it to 'pro' on activation and back to
-- 'free' on cancel/expiry. plan_expires_at (added here) lets entitlements lazily
-- downgrade a lapsed Pro without needing a cron.
--
-- RLS follows the 0053 model: plans are public-read (active only), a user reads
-- only their own subscriptions, and billing_events is service-role-only. All
-- writes go through the API's service-role client (BYPASSRLS) — no client ever
-- inserts a subscription or a billing event directly.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. plans — the priceable products (pricing lives here, as data).
-- ---------------------------------------------------------------------------
create table if not exists public.plans (
  id             uuid primary key default gen_random_uuid(),
  code           text        not null unique,                 -- 'pro_yearly' | 'pro_monthly'
  tier           user_plan   not null default 'pro',          -- the plan this grants
  name_i18n      jsonb       not null,
  description_i18n jsonb     not null default '{}'::jsonb,
  price_paise    integer     not null check (price_paise >= 0),-- INR paise (₹1 = 100)
  currency       text        not null default 'INR',
  interval       text        not null check (interval in ('month', 'year')),
  interval_count integer     not null default 1 check (interval_count >= 1),
  is_intro       boolean     not null default false,
  is_active      boolean     not null default true,
  sort_order     integer     not null default 0,
  meta           jsonb       not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 2. subscriptions — per-user billing state (webhook-driven, service-role only).
-- ---------------------------------------------------------------------------
create table if not exists public.subscriptions (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references public.users_profile(id) on delete cascade,
  plan_id                uuid references public.plans(id),
  plan_code              text,
  -- Lifecycle: created (order placed, unpaid) → active (paid) → cancelled /
  -- expired; failed = a payment attempt that did not capture.
  status                 text not null default 'created'
                           check (status in ('created', 'active', 'cancelled', 'expired', 'failed', 'halted')),
  razorpay_order_id      text,
  razorpay_payment_id    text,
  razorpay_subscription_id text,
  amount_paise           integer,
  currency               text not null default 'INR',
  current_period_start   timestamptz,
  current_period_end     timestamptz,
  started_at             timestamptz,
  cancelled_at           timestamptz,
  meta                   jsonb not null default '{}'::jsonb,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index if not exists subscriptions_user_idx on public.subscriptions (user_id, created_at desc);
create unique index if not exists subscriptions_order_idx on public.subscriptions (razorpay_order_id)
  where razorpay_order_id is not null;
create index if not exists subscriptions_payment_idx on public.subscriptions (razorpay_payment_id)
  where razorpay_payment_id is not null;

-- ---------------------------------------------------------------------------
-- 3. billing_events — processed Razorpay events (webhook idempotency).
--    A replayed webhook finds its event_id already here and no-ops.
-- ---------------------------------------------------------------------------
create table if not exists public.billing_events (
  id                uuid primary key default gen_random_uuid(),
  razorpay_event_id text not null unique,       -- x-razorpay-event-id header
  event_type        text not null,              -- e.g. 'payment.captured'
  subscription_id   uuid references public.subscriptions(id) on delete set null,
  payload           jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now()
);

create index if not exists billing_events_type_idx on public.billing_events (event_type, created_at desc);

-- ---------------------------------------------------------------------------
-- 4. users_profile.plan_expires_at — when the current Pro grant lapses.
-- ---------------------------------------------------------------------------
alter table public.users_profile
  add column if not exists plan_expires_at timestamptz;

-- ---------------------------------------------------------------------------
-- 5. updated_at triggers (set_updated_at() exists since 0002).
-- ---------------------------------------------------------------------------
drop trigger if exists set_updated_at on public.plans;
create trigger set_updated_at before update on public.plans
  for each row execute function set_updated_at();
drop trigger if exists set_updated_at on public.subscriptions;
create trigger set_updated_at before update on public.subscriptions
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- 6. RLS (mirrors 0053): plans public-read-active, subscriptions owner-read,
--    billing_events service-role-only (RLS on, no policy).
-- ---------------------------------------------------------------------------
alter table public.plans enable row level security;
alter table public.subscriptions enable row level security;
alter table public.billing_events enable row level security;

drop policy if exists plans_public_read on public.plans;
create policy plans_public_read on public.plans
  for select to anon, authenticated using (is_active);

drop policy if exists owner_select on public.subscriptions;
create policy owner_select on public.subscriptions
  for select to authenticated using (auth.uid() = user_id);

-- Grants: read-only for the client roles; the service role bypasses RLS and
-- does every write. Anon lost write privileges globally in 0053; these grants
-- only add the SELECTs the browser needs.
grant select on public.plans to anon, authenticated;
grant select on public.subscriptions to authenticated;
-- billing_events: no grants to anon/authenticated → fully service-role-only.
revoke all on public.billing_events from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. Seed the two Pro plans (idempotent upsert on code). Prices per the
--    monetization brief: yearly ₹1,499 intro (the committed-aspirant deal),
--    monthly ₹299 (covers heavy months profitably).
-- ---------------------------------------------------------------------------
insert into public.plans (code, tier, name_i18n, description_i18n, price_paise, currency, interval, is_intro, sort_order)
values
  (
    'pro_yearly', 'pro',
    '{"en": "Pro — Yearly", "hi": "प्रो — वार्षिक"}'::jsonb,
    '{"en": "Best value. Everything in Pro for a full year.", "hi": "सर्वोत्तम मूल्य। पूरे वर्ष के लिए प्रो की सभी सुविधाएँ।"}'::jsonb,
    149900, 'INR', 'year', true, 0
  ),
  (
    'pro_monthly', 'pro',
    '{"en": "Pro — Monthly", "hi": "प्रो — मासिक"}'::jsonb,
    '{"en": "Full Pro access, billed monthly.", "hi": "संपूर्ण प्रो एक्सेस, मासिक बिलिंग।"}'::jsonb,
    29900, 'INR', 'month', false, 1
  )
on conflict (code) do update set
  tier             = excluded.tier,
  name_i18n        = excluded.name_i18n,
  description_i18n  = excluded.description_i18n,
  price_paise      = excluded.price_paise,
  currency         = excluded.currency,
  interval         = excluded.interval,
  is_intro         = excluded.is_intro,
  sort_order       = excluded.sort_order,
  is_active        = true;
