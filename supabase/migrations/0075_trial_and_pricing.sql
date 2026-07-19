-- =============================================================================
-- 0075_trial_and_pricing.sql — 7-day Pro free-trial + expanded plan ladder.
--
-- Trial design (deliberately REUSES existing state — no parallel state machine):
--   * A NEW auth user is provisioned by handle_new_user() (0052). It now ALSO
--     grants plan='pro' + plan_expires_at = now()+7d + has_used_trial=true at
--     that same moment. The EXISTING lazy-downgrade in entitlements.getPlanFor()
--     flips a lapsed trial back to 'free' exactly as it does a lapsed PAID Pro —
--     there is no second downgrade path.
--   * has_used_trial (the ONLY new column) exists purely to prevent literal
--     same-account trial replay. It is NOT a full anti-abuse system — the coarse
--     manual-review signal is trial_starts + the trial-abuse:report script.
--   * A trial user and a paid Pro user BOTH have plan='pro'. They are told apart
--     at read time by an ACTIVE subscriptions row (paid) vs none (trial) —
--     entitlements.isOnTrial encodes that, so no "is_trial" column is needed.
--
-- EXISTING users are deliberately UNTOUCHED: handle_new_user() fires only on an
-- auth.users INSERT (new sign-ups), and has_used_trial defaults to false, so no
-- already-provisioned profile is retroactively granted a trial. (Their permanent
-- free floor — the 3 lifetime evaluations, LIMITS.free — is unchanged.)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. has_used_trial — the single new column.
-- ---------------------------------------------------------------------------
alter table public.users_profile
  add column if not exists has_used_trial boolean not null default false;

-- ---------------------------------------------------------------------------
-- 2. Grant the 7-day Pro trial to every newly-provisioned user. Extends 0052's
--    handle_new_user() (same SECURITY DEFINER, same on-conflict idempotency).
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users_profile (id, display_name, plan, plan_expires_at, has_used_trial)
  values (
    new.id,
    nullif(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'), ''),
    'pro',
    now() + interval '7 days',
    true
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
-- The on_auth_user_created trigger (0052) already binds this function — unchanged.

-- ---------------------------------------------------------------------------
-- 3. trial_starts — coarse abuse signal (MANUAL REVIEW ONLY, never auto-blocks).
--    One row per user (idempotent), a coarse salted IP hash — never a raw IP at
--    rest. trial-abuse:report surfaces accounts sharing a hash in a short window
--    for a human to look at; nothing here restricts a user automatically.
--    Service-role only (RLS on, no policy — same pattern as billing_events).
-- ---------------------------------------------------------------------------
create table if not exists public.trial_starts (
  user_id    uuid primary key references public.users_profile(id) on delete cascade,
  ip_hash    text,
  created_at timestamptz not null default now()
);
create index if not exists trial_starts_ip_idx on public.trial_starts (ip_hash, created_at desc);

alter table public.trial_starts enable row level security;
revoke all on public.trial_starts from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Reprice + expand the plan ladder (idempotent upsert on code). The 2026
--    monetization decision is TRANSPARENT single pricing (not discount-theater —
--    see docs/OUTSTANDING.md). Effective per-month: monthly ₹399 > quarterly
--    ₹333 > half-yearly ₹300 > yearly ₹208 — a clean monotonic discount toward
--    yearly, which stays the flagged best-value tier. The multi-month tiers use
--    the EXISTING interval_count column (month × N) — no schema change.
--    sort_order: monthly, quarterly, half-yearly, yearly.
-- ---------------------------------------------------------------------------
insert into public.plans (code, tier, name_i18n, description_i18n, price_paise, currency, interval, interval_count, is_intro, sort_order)
values
  (
    'pro_monthly', 'pro',
    '{"en": "Pro — Monthly", "hi": "प्रो — मासिक"}'::jsonb,
    '{"en": "Full Pro access, billed monthly.", "hi": "संपूर्ण प्रो एक्सेस, मासिक बिलिंग।"}'::jsonb,
    39900, 'INR', 'month', 1, false, 0
  ),
  (
    'pro_quarterly', 'pro',
    '{"en": "Pro — 3 Months", "hi": "प्रो — 3 माह"}'::jsonb,
    '{"en": "Three months of full Pro — cheaper per month than monthly.", "hi": "तीन माह की संपूर्ण प्रो — मासिक से सस्ता प्रति माह।"}'::jsonb,
    99900, 'INR', 'month', 3, false, 1
  ),
  (
    'pro_half_yearly', 'pro',
    '{"en": "Pro — 6 Months", "hi": "प्रो — 6 माह"}'::jsonb,
    '{"en": "Half a year of full Pro — great value through the mains season.", "hi": "आधे वर्ष की संपूर्ण प्रो — मुख्य परीक्षा सीज़न के लिए बेहतरीन मूल्य।"}'::jsonb,
    179900, 'INR', 'month', 6, false, 2
  ),
  (
    'pro_yearly', 'pro',
    '{"en": "Pro — Yearly", "hi": "प्रो — वार्षिक"}'::jsonb,
    '{"en": "Best value. A full year of Pro for the committed aspirant.", "hi": "सर्वोत्तम मूल्य। प्रतिबद्ध अभ्यर्थी के लिए पूरे वर्ष की प्रो।"}'::jsonb,
    249900, 'INR', 'year', 1, true, 3
  )
on conflict (code) do update set
  tier             = excluded.tier,
  name_i18n        = excluded.name_i18n,
  description_i18n  = excluded.description_i18n,
  price_paise      = excluded.price_paise,
  currency         = excluded.currency,
  interval         = excluded.interval,
  interval_count   = excluded.interval_count,
  is_intro         = excluded.is_intro,
  sort_order       = excluded.sort_order,
  is_active        = true;
