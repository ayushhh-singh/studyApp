-- =============================================================================
-- 0130_seed_max_plans.sql — the priced Max rows.
--
-- Separate from 0129 (which adds the enum value) because Postgres refuses to
-- USE a new enum value in the transaction that added it — verified live:
-- "unsafe use of new value \"max\" of enum type user_plan". These rows carry
-- tier='max', so they must land after 0129 has committed. Same reason the repo
-- keeps 0040/0046 single-statement.
--
-- PRICE, signed off by the product owner 2026-08-14 (docs/max-tier-design.md §7,
-- option A): monthly ₹749, yearly ₹5,999. That is a 33% discount for paying
-- annually (₹749 × 12 = ₹8,988), consistent with the existing Pro ladder's
-- monotonic discount toward yearly, and it keeps the repo's standing
-- TRANSPARENT-SINGLE-PRICING decision — no struck-through MRP, no countdown
-- (docs/OUTSTANDING.md §7).
--
-- ⚑ WHY THE MONTHLY OPTION IS THE RISKY ONE, recorded so it is not mistaken for
-- an oversight. A Mains series peaks at ~160 evaluations/month, which costs
-- ~₹822 of AI against a ₹749 monthly price — i.e. a subscriber who takes Max
-- monthly for exactly the Mains season is served at a loss. That is bounded, not
-- open-ended: LIMITS.max caps the year at 600 evaluations, so the worst case is
-- ~3 such months (~₹3,084 cost against ~₹2,247 revenue) and no further. The
-- owner chose to ship monthly with that trade understood. The yearly plan has no
-- such exposure: 600 evaluations ≈ ₹3,084 against ₹5,999.
--
-- Idempotent on `code` like 0075, so a re-run repairs drift rather than
-- duplicating. `is_active` is forced true by the upsert, matching 0075.
-- =============================================================================

insert into public.plans (code, tier, name_i18n, description_i18n, price_paise, currency, interval, interval_count, is_intro, sort_order)
values
  (
    'max_monthly', 'max',
    '{"en": "Max — Monthly", "hi": "मैक्स — मासिक"}'::jsonb,
    '{"en": "Everything in Pro, plus the scheduled test series. Billed monthly.", "hi": "प्रो का सब कुछ, साथ में निर्धारित टेस्ट सीरीज़। मासिक बिलिंग।"}'::jsonb,
    74900, 'INR', 'month', 1, false, 10
  ),
  (
    'max_yearly', 'max',
    '{"en": "Max — Yearly", "hi": "मैक्स — वार्षिक"}'::jsonb,
    '{"en": "The full test-series calendar for a whole prep season, at the lowest per-month price.", "hi": "पूरे तैयारी सत्र के लिए संपूर्ण टेस्ट सीरीज़ कैलेंडर, न्यूनतम प्रति-माह मूल्य पर।"}'::jsonb,
    599900, 'INR', 'year', 1, true, 11
  )
on conflict (code) do update set
  tier             = excluded.tier,
  name_i18n        = excluded.name_i18n,
  description_i18n = excluded.description_i18n,
  price_paise      = excluded.price_paise,
  currency         = excluded.currency,
  interval         = excluded.interval,
  interval_count   = excluded.interval_count,
  is_intro         = excluded.is_intro,
  sort_order       = excluded.sort_order,
  is_active        = true;

-- ---------------------------------------------------------------------------
-- Assert the end state. Data assertions are safe here (unlike 0129's, which had
-- to be a schema assertion): these rows are written by THIS migration, so the
-- checks are true on first apply and on every replay.
-- ---------------------------------------------------------------------------
do $$
declare
  n_max int;
  yearly_paise int;
begin
  select count(*) into n_max from public.plans where tier = 'max' and is_active;
  if n_max <> 2 then
    raise exception '0130: expected exactly 2 active max plans, found %', n_max;
  end if;

  select price_paise into yearly_paise from public.plans where code = 'max_yearly';
  if yearly_paise <> 599900 then
    raise exception '0130: max_yearly must be the signed-off ₹5,999 (599900 paise), found %', yearly_paise;
  end if;

  -- Max must never be cheaper than Pro at the same cadence, or the ladder
  -- inverts and the higher tier undercuts the lower one.
  if (select price_paise from public.plans where code = 'max_monthly')
     <= (select price_paise from public.plans where code = 'pro_monthly') then
    raise exception '0130: max_monthly must cost more than pro_monthly';
  end if;
  if (select price_paise from public.plans where code = 'max_yearly')
     <= (select price_paise from public.plans where code = 'pro_yearly') then
    raise exception '0130: max_yearly must cost more than pro_yearly';
  end if;
end $$;
