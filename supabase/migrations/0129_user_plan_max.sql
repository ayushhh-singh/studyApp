-- =============================================================================
-- 0129_user_plan_max.sql — add the 'max' tier to the user_plan enum.
--
-- This is the WHOLE schema delta for the Max tier. That is not an oversight —
-- it is the payoff of the exam-interaction decision recorded in
-- docs/max-tier-design.md §3: Max is EXAM-AGNOSTIC, so `plans` needs no
-- `exam_code`, `subscriptions` needs no per-exam resolution, and no backfill
-- exists to get wrong. The per-exam alternative would have cost a column on
-- `plans`, a denormalised copy on `subscriptions` (set at webhook-activate
-- time), an `assertTestSeries(userId, examCode)` signature change, and a
-- migration of live rows if it were ever merged back. See §3 for why the
-- cost driver (Mains AI evaluation) is bounded by an evaluation cap rather
-- than by access scope, which is what makes the exam dimension unnecessary.
--
-- This also UPHOLDS M18 (docs/OUTSTANDING.md §7, docs/multi-exam.md §4), which
-- says the price ladder stays exam-agnostic and that per-exam plans must not be
-- added "as a drive-by ... reopen only with explicit discussion". The explicit
-- discussion happened; the answer was to keep it exam-agnostic. M18 is
-- confirmed, not reopened.
--
-- ⚑ THIS MIGRATION IS INERT ON ITS OWN, BY DESIGN. Adding the enum value
--   changes no behaviour, because nothing anywhere can produce it:
--     - billing.ts activate()/renew()  write the literal 'pro'
--     - trial.ts claimTrial()           writes the literal 'pro'
--     - admin-users.ts grant/revoke     write the literals 'pro'/'free'
--     - handle_new_user() (0075)        writes the literal 'pro'
--     - entitlements.ts lazy downgrade  writes the literal 'free'
--   and no `plans` row carries tier='max' yet, so no order can be created for
--   one either (createOrder → planByCode filters is_active=true).
--
-- ⚑ DO NOT ASSIGN 'max' TO ANY USER UNTIL THE CODE CHANGES IN
--   docs/max-tier-design.md §5 HAVE LANDED. Two of them fail SILENTLY:
--
--   1. entitlements.ts assertPro() is `if (plan !== "pro") throw paywall(...)`,
--      so a Max user is LOCKED OUT OF EVERY PRO FEATURE — OCR, micro-drills,
--      mocks, magazine PDF. Paying more would buy strictly less.
--   2. entitlements.ts getPlanFor()'s lazy downgrade is guarded
--      `row.plan === "pro"` and its UPDATE carries `.eq("plan","pro")`, so a
--      LAPSED MAX NEVER DOWNGRADES. It would keep full access forever after
--      the subscription ends — a permanent revenue leak with no error.
--
-- ⚑ ORDERING TRAP. `add value` appends, so in POSTGRES 'max' > 'pro' sorts
--   correctly. In JAVASCRIPT it does not: "max" < "pro" lexically (m < p), so
--   any TypeScript comparison of the form `plan >= "pro"` is silently WRONG for
--   the tier it is meant to admit. Tier comparison in TS must go through an
--   explicit rank map, never a string comparison. §5 specifies one.
--
-- Follows this repo's own convention for enum additions (0040, 0046): the
-- `alter type ... add value` gets its own migration containing nothing that
-- USES the new value. That is not stylistic — Postgres forbids referencing an
-- uncommitted enum value in the transaction that added it, so seeding a
-- `plans` row with tier='max' here would fail with "unsafe use of new value of
-- enum type". The priced `plans` rows land in their own later migration, once
-- a price is signed off (§6 — no number is chosen yet, and none is seeded here).
-- =============================================================================

alter type user_plan add value if not exists 'max';

-- ---------------------------------------------------------------------------
-- Assert the end state. Deliberately a SCHEMA assertion, not a data one: a
-- data assertion (e.g. "no user holds 'max'") is true on first apply and FALSE
-- on every replay after launch, which would make this migration
-- non-replayable — exactly the defect found in 0116 and fixed there (M14).
-- This assertion is true on first apply AND on every replay, forever.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
     where t.typname = 'user_plan'
       and e.enumlabel = 'max'
  ) then
    raise exception '0129: user_plan is missing the ''max'' value';
  end if;
end $$;
