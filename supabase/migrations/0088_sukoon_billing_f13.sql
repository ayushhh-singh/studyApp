-- =============================================================================
-- 0088_sukoon_billing_f13.sql — Sukoon billing (F13), Session 10.
--
-- Reuses Neev's ORDER-BASED Razorpay pattern (server-authoritative amount +
-- signature-verified webhook state machine + lazy tier downgrade), NOT the
-- Razorpay Subscriptions/autopay API — the same one-time-order flow Neev's
-- 0057 billing uses, so Neev's razorpay lib + webhook shape are reused verbatim.
--
-- SELF-CONTAINED per the Sukoon rules (SUKOON_CONTEXT / CLAUDE.md): this file is
-- purely sukoon_-prefixed, references only auth.users, and mirrors Neev's plans/
-- subscriptions/billing_events into sukoon_ tables so a standalone Sukoon project
-- needs NO Neev billing schema. The ONE cross-product coupling (the Neev-bundle
-- 40%-off eligibility check) lives entirely in application code behind an
-- integration seam (sukoon/lib/neev-bridge.ts, a no-op in standalone mode) — the
-- schema here has zero dependency on any Neev table.
--
-- sukoon_subscriptions + sukoon_usage + sukoon_voice_usage already exist (0078
-- core); this migration (a) creates the sukoon_plans catalog + seeds it, (b)
-- fleshes out sukoon_subscriptions with the full order/state-machine columns, and
-- (c) adds sukoon_billing_events for webhook idempotency. RLS/grants for the two
-- new tables follow 0079's per-table style (a direct db-push connection gets no
-- automatic API-role grants — the 0015 gotcha). Idempotent; safe to re-run.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. sukoon_plans — the priceable Sukoon products (price is DATA, mirrors Neev's
--    `plans`). `tier` is 'plus' | 'pro' (a paid plan never grants 'free').
--    bundle_discount_pct is the Neev-bundle discount applied server-side at order
--    time for a bundle-eligible user (data, so it's tunable without a deploy).
-- ---------------------------------------------------------------------------
create table if not exists public.sukoon_plans (
  id                  uuid primary key default gen_random_uuid(),
  code                text        not null unique,                    -- 'sukoon_plus_monthly' …
  tier                text        not null check (tier in ('plus', 'pro')),
  name_i18n           jsonb       not null,
  description_i18n    jsonb       not null default '{}'::jsonb,
  price_paise         integer     not null check (price_paise >= 0),  -- INR paise (₹1 = 100)
  currency            text        not null default 'INR',
  interval            text        not null check (interval in ('month', 'year')),
  interval_count      integer     not null default 1 check (interval_count >= 1),
  -- The Neev-bundle discount (blueprint §4: any active paid Neev plan → 40% off).
  -- Applied server-side to the authoritative order amount; 0 disables the bundle
  -- for a plan. A percentage rather than a second "bundle" plan row so the
  -- catalog stays 6 rows, not 12, and the price stays computed in one place.
  bundle_discount_pct integer     not null default 40 check (bundle_discount_pct between 0 and 100),
  is_intro            boolean     not null default false,             -- the "best value" flag
  is_active           boolean     not null default true,
  sort_order          integer     not null default 0,
  meta                jsonb       not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
drop trigger if exists sukoon_plans_set_updated_at on public.sukoon_plans;
create trigger sukoon_plans_set_updated_at
  before update on public.sukoon_plans
  for each row execute function public.sukoon_set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. sukoon_subscriptions — extend the 0078 mirror into a full order/state
--    machine (webhook-driven, service-role writes only). Additive columns; the
--    table is empty pre-Session-10 so the NOT NULL DEFAULTs are safe.
-- ---------------------------------------------------------------------------
alter table public.sukoon_subscriptions
  add column if not exists plan_id              uuid references public.sukoon_plans(id),
  add column if not exists plan_code            text,
  add column if not exists razorpay_order_id    text,
  add column if not exists razorpay_payment_id  text,
  add column if not exists amount_paise         integer,
  add column if not exists currency             text not null default 'INR',
  add column if not exists current_period_start timestamptz,
  add column if not exists started_at           timestamptz,   -- set only on paid activation (paid-vs-trial marker)
  add column if not exists cancelled_at         timestamptz,
  -- is_trial marks the 7-day full-Pro trial row (status 'trialing', tier 'pro').
  -- One trial per user is enforced by "does ANY sukoon_subscriptions row with
  -- is_trial=true exist for this user" — durable even after the trial lapses.
  add column if not exists is_trial             boolean not null default false,
  -- bundle_applied records that the Neev-bundle discount was applied to this
  -- purchase (for the receipt/manage screen + auditing).
  add column if not exists bundle_applied       boolean not null default false,
  add column if not exists meta                 jsonb not null default '{}'::jsonb;

-- Widen the status lifecycle to the Neev set: created (order placed, unpaid) →
-- active (paid) → cancelled / expired; failed = a payment that didn't capture;
-- trialing = the 7-day trial. (0078 seeded only active/cancelled/expired/trialing.)
alter table public.sukoon_subscriptions
  drop constraint if exists sukoon_subscriptions_status_check;
alter table public.sukoon_subscriptions
  add constraint sukoon_subscriptions_status_check
  check (status in ('created', 'active', 'cancelled', 'expired', 'failed', 'trialing'));

create unique index if not exists sukoon_subscriptions_order_idx
  on public.sukoon_subscriptions (razorpay_order_id) where razorpay_order_id is not null;
create index if not exists sukoon_subscriptions_payment_idx
  on public.sukoon_subscriptions (razorpay_payment_id) where razorpay_payment_id is not null;
create index if not exists sukoon_subscriptions_user_created_idx
  on public.sukoon_subscriptions (user_id, created_at desc);
-- One trial per user, enforced at the DB (belt-and-suspenders alongside the app
-- check): at most one is_trial row per user.
create unique index if not exists sukoon_subscriptions_one_trial_idx
  on public.sukoon_subscriptions (user_id) where is_trial;

-- ---------------------------------------------------------------------------
-- 3. sukoon_billing_events — webhook idempotency (mirror of Neev billing_events).
--    A replayed Razorpay event finds its id already here and no-ops. Internal:
--    service-role only (RLS on, no policy).
-- ---------------------------------------------------------------------------
create table if not exists public.sukoon_billing_events (
  id                uuid primary key default gen_random_uuid(),
  razorpay_event_id text not null unique,
  event_type        text not null,
  subscription_id   uuid references public.sukoon_subscriptions(id) on delete set null,
  payload           jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now()
);
create index if not exists sukoon_billing_events_type_idx
  on public.sukoon_billing_events (event_type, created_at desc);

-- ---------------------------------------------------------------------------
-- 4. RLS + grants for the two NEW tables (per-table, 0079 style — a direct
--    db-push connection gets no automatic API-role grants).
--    sukoon_plans: read-for-authenticated (active only); writes service-role
--    only. Sukoon is an authenticated product (0079), so anon gets nothing.
--    sukoon_billing_events: RLS on, NO policy → service role only.
-- ---------------------------------------------------------------------------
alter table public.sukoon_plans enable row level security;
revoke all on public.sukoon_plans from anon, authenticated;
grant all on public.sukoon_plans to service_role;
grant select on public.sukoon_plans to authenticated;
drop policy if exists content_read on public.sukoon_plans;
create policy content_read on public.sukoon_plans
  for select to authenticated using (is_active);

alter table public.sukoon_billing_events enable row level security;
revoke all on public.sukoon_billing_events from anon, authenticated;
grant all on public.sukoon_billing_events to service_role;

-- ---------------------------------------------------------------------------
-- 4b. SECURITY: lock sukoon_subscriptions WRITES to the service role.
--     0079 provisionally gave the owner full CRUD (owner_insert/update/delete)
--     — correct when this table was an empty scaffold, but it is now the billing
--     SOURCE OF TRUTH (getSukoonTier reads it). A user must NEVER be able to
--     self-insert/update a row via the anon key + their JWT to grant themselves
--     a tier. Mirror Neev's `subscriptions`: owner-SELECT only; every write goes
--     through the service-role API (createSukoonOrder / the webhook / cancel).
--     Account-deletion (DPDP) still works via the auth.users ON DELETE CASCADE,
--     so removing owner DELETE loses no user right.
-- ---------------------------------------------------------------------------
drop policy if exists owner_insert on public.sukoon_subscriptions;
drop policy if exists owner_update on public.sukoon_subscriptions;
drop policy if exists owner_delete on public.sukoon_subscriptions;
revoke insert, update, delete on public.sukoon_subscriptions from anon, authenticated;
-- owner_select (read your own subscription) from 0079 stays; service_role keeps all.

-- ---------------------------------------------------------------------------
-- 5. Seed the six Sukoon plans (blueprint §4). Idempotent upsert on code.
--    Plus: ₹99 / ₹249(3mo) / ₹799(yr).  Pro: ₹249 / ₹649(3mo) / ₹1,999(yr).
--    Multi-month tiers use interval_count (month × N), same as Neev's 0075.
--    Yearly = is_intro (the flagged best-value tier).
-- ---------------------------------------------------------------------------
insert into public.sukoon_plans
  (code, tier, name_i18n, description_i18n, price_paise, currency, interval, interval_count, is_intro, sort_order)
values
  (
    'sukoon_plus_monthly', 'plus',
    '{"en": "Sukoon Plus — Monthly", "hi": "सुकून प्लस — मासिक"}'::jsonb,
    '{"en": "AI journal reflections, all journeys, weekly insights & the full calm library.", "hi": "एआई जर्नल रिफ्लेक्शन, सभी जर्नी, साप्ताहिक इनसाइट्स और पूरी शांति लाइब्रेरी।"}'::jsonb,
    9900, 'INR', 'month', 1, false, 0
  ),
  (
    'sukoon_plus_quarterly', 'plus',
    '{"en": "Sukoon Plus — 3 Months", "hi": "सुकून प्लस — 3 माह"}'::jsonb,
    '{"en": "Three months of Plus — cheaper per month.", "hi": "तीन माह का प्लस — प्रति माह सस्ता।"}'::jsonb,
    24900, 'INR', 'month', 3, false, 1
  ),
  (
    'sukoon_plus_yearly', 'plus',
    '{"en": "Sukoon Plus — Yearly", "hi": "सुकून प्लस — वार्षिक"}'::jsonb,
    '{"en": "A full year of Plus — the calmest value.", "hi": "पूरे वर्ष का प्लस — सबसे शांत मूल्य।"}'::jsonb,
    79900, 'INR', 'year', 1, true, 2
  ),
  (
    'sukoon_pro_monthly', 'pro',
    '{"en": "Sukoon Pro — Monthly", "hi": "सुकून प्रो — मासिक"}'::jsonb,
    '{"en": "Everything in Plus + Voice Mode, priority deep conversations & deep insights.", "hi": "प्लस की सभी सुविधाएँ + वॉइस मोड, प्राथमिकता वाली गहरी बातचीत और डीप इनसाइट्स।"}'::jsonb,
    24900, 'INR', 'month', 1, false, 3
  ),
  (
    'sukoon_pro_quarterly', 'pro',
    '{"en": "Sukoon Pro — 3 Months", "hi": "सुकून प्रो — 3 माह"}'::jsonb,
    '{"en": "Three months of Pro — cheaper per month.", "hi": "तीन माह का प्रो — प्रति माह सस्ता।"}'::jsonb,
    64900, 'INR', 'month', 3, false, 4
  ),
  (
    'sukoon_pro_yearly', 'pro',
    '{"en": "Sukoon Pro — Yearly", "hi": "सुकून प्रो — वार्षिक"}'::jsonb,
    '{"en": "A full year of Pro — everything Sukoon offers.", "hi": "पूरे वर्ष का प्रो — सुकून की हर सुविधा।"}'::jsonb,
    199900, 'INR', 'year', 1, true, 5
  )
on conflict (code) do update set
  tier                = excluded.tier,
  name_i18n           = excluded.name_i18n,
  description_i18n     = excluded.description_i18n,
  price_paise         = excluded.price_paise,
  currency            = excluded.currency,
  interval            = excluded.interval,
  interval_count      = excluded.interval_count,
  is_intro            = excluded.is_intro,
  sort_order          = excluded.sort_order,
  is_active           = true;
