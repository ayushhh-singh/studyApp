import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { Check, Sparkles, Smartphone, X } from "lucide-react";
import { paiseToRupeeString, type Plan } from "@neev/shared";
import { useAuth } from "@/providers/auth-provider";
import { useLocale } from "@/hooks/use-locale";
import { useProfile } from "@/hooks/use-profile";
import { usePlans, useBillingSubscription, useCreateOrder, useRefreshBilling } from "@/hooks/use-billing";
import { openRazorpayCheckout } from "@/lib/razorpay-checkout";
import { Button } from "@/components/ui/button";
import { PageSeo } from "@/components/seo/page-seo";
import { MarketingHeader } from "@/components/marketing/marketing-header";
import { Footer } from "@/components/marketing/footer";
import { Skeleton } from "@/components/ui-x/skeleton";
import { QueryErrorState } from "@/components/ui-x/query-error-state";
import { cn } from "@/lib/utils";
import { billingCopy as c, pick, planPeriodLabel, planMonths } from "@/lib/billing-copy";

type Status = "idle" | "starting" | "activating" | "done" | "error";

export const handle = { titleI18n: { en: "Plans", hi: "प्लान" } };

// Public marketing page (see router.tsx) — rendered standalone with its own
// light header, not the signed-in app-shell chrome, so it reads correctly for
// both a signed-out visitor and a signed-in user who followed a link here.
export function Component() {
  const { t } = useTranslation();
  const locale = useLocale();
  const navigate = useNavigate();
  const { session } = useAuth();
  const plans = usePlans();
  const subscription = useBillingSubscription({ enabled: !!session });
  // Pricing sits outside RequireAuth (it's public), so its own onboarding
  // gate — checkout must never be reachable before onboarding, same as when
  // this page lived inside the auth-gated subtree.
  const profileQuery = useProfile({ enabled: !!session });
  const needsOnboarding = !!session && profileQuery.data != null && !profileQuery.data.onboarding_completed;
  const createOrder = useCreateOrder();
  const refreshBilling = useRefreshBilling();

  const [status, setStatus] = useState<Status>("idle");
  const [activePlan, setActivePlan] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const currentTier = (session && subscription.data?.entitlements.plan) || "free";
  const isPro = currentTier === "pro" || currentTier === "max";
  const proUntil = subscription.data?.entitlements.plan_expires_at ?? null;
  // Rank, never a string compare: "max" < "pro" lexically in JS, so `>=` would
  // silently let a Max user "upgrade" to Pro. Mirrors entitlements.ts's planRank.
  const RANK: Record<string, number> = { free: 0, pro: 1, max: 2 };
  /** A plan is already covered if the user is on that tier or a higher one. */
  const owned = (tier: string) => RANK[currentTier] >= RANK[tier];
  /**
   * The button label for a plan the user already has. "Your current plan" is
   * only true for the tier they are actually ON — saying it on a LOWER tier
   * (a Max user looking at the four Pro cards) is simply false, which is what
   * a browser check as a Max user caught.
   */
  const ownedLabel = (tier: string) => (tier === currentTier ? c.currentPlan : c.includedInPlan);
  /**
   * A strict upgrade from a tier the user already PAYS for gets prorated at
   * checkout (services/billing.ts computeProration). Say so before they click
   * — the card shows the list price, but the order will charge less, and a
   * user who is not told that reads the full price as a second full charge.
   */
  const willProrate = (tier: string) =>
    !!session && currentTier !== "free" && (RANK[tier] ?? 0) > (RANK[currentTier] ?? 0);

  // While confirming a fresh payment, poll the subscription until the webhook
  // flips the plan to Pro (the webhook is the source of truth, not checkout.js).
  useEffect(() => {
    if (status !== "activating") return;
    const id = setInterval(() => subscription.refetch(), 2000);
    const stop = setTimeout(() => setStatus("done"), 20000); // give up polling after 20s
    return () => {
      clearInterval(id);
      clearTimeout(stop);
    };
  }, [status, subscription]);

  useEffect(() => {
    if (status === "activating" && currentTier !== "free") setStatus("done");
  }, [status, currentTier]);

  async function choose(plan: Plan) {
    // Checkout itself stays auth-gated — bounce through sign-in and back.
    if (!session) {
      const params = new URLSearchParams({ redirect: `/${locale}/pricing` });
      navigate(`/${locale}/auth?${params.toString()}`);
      return;
    }
    // Don't decide before we actually know onboarding status — the button is
    // disabled while this is true, but guard here too against a click that
    // lands before that render.
    if (profileQuery.isLoading) return;
    // Signed in but hasn't finished onboarding — finish that first, same
    // protection RequireAuth gave this page before it became public.
    if (needsOnboarding) {
      navigate(`/${locale}/onboarding`);
      return;
    }
    setMessage(null);
    setActivePlan(plan.code);
    setStatus("starting");
    try {
      const order = await createOrder.mutateAsync(plan.code);
      await openRazorpayCheckout({
        keyId: order.key_id,
        orderId: order.order_id,
        amountPaise: order.amount_paise,
        currency: order.currency,
        name: "Neev",
        description: pick(locale, plan.name_i18n),
        prefillName: order.prefill_name,
        onSuccess: () => {
          setStatus("activating");
          refreshBilling();
        },
        onDismiss: () => {
          setStatus("idle");
          setMessage(pick(locale, c.paymentCancelled));
        },
      });
    } catch {
      setStatus("error");
      setMessage(pick(locale, c.paymentFailed));
    }
  }

  return (
    <div className="min-h-svh bg-background">
      <PageSeo
        locale={locale}
        path="/pricing"
        title={`${pick(locale, c.pricingTitle)} — ${t("Landing.brand")}`}
        description={pick(locale, c.pricingPageSubtitle)}
      />

      <MarketingHeader maxWidthClass="max-w-5xl" />

      <div className="mx-auto flex max-w-5xl flex-col gap-8 px-4 py-10 pb-16 sm:px-6 sm:py-14">
        {/* Centred title block — docs/design/reference-1's PRICING panel.
            PageHeader is the in-app left-aligned header and reads wrong on a
            marketing page that has no surrounding app chrome. */}
        <div className="mx-auto max-w-2xl text-center">
          <h1 className="font-heading text-3xl font-extrabold tracking-tight sm:text-4xl">
            {pick(locale, c.pricingTitle)}
          </h1>
          <p className="mt-3 text-base leading-relaxed text-muted-foreground">{pick(locale, c.pricingPageSubtitle)}</p>
        </div>

      {/* UPI-first assurance */}
      <div className="flex flex-col gap-1 rounded-xl border border-tulsi/30 bg-tulsi/10 p-4 sm:flex-row sm:items-center sm:gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-tulsi/20 text-tulsi-foreground">
          <Smartphone className="size-5" aria-hidden />
        </span>
        <div>
          <p className="text-sm font-semibold text-tulsi-foreground">{pick(locale, c.upiFirst)}</p>
          <p className="text-xs leading-[1.75] text-muted-foreground">{pick(locale, c.upiNote)}</p>
        </div>
      </div>

      {isPro && (
        <div className="flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/10 p-4 text-sm">
          <Sparkles className="size-5 text-primary" aria-hidden />
          <span className="font-semibold text-primary">
            {pick(locale, currentTier === "max" ? c.youAreMax : c.youArePro)}
          </span>
          {proUntil && (
            <span className="text-muted-foreground">
              · {pick(locale, currentTier === "max" ? c.maxUntil : c.proUntil)} {new Date(proUntil).toLocaleDateString(locale === "hi" ? "hi-IN" : "en-IN", { day: "numeric", month: "short", year: "numeric" })}
            </span>
          )}
        </div>
      )}

      {status === "done" && isPro && (
        <div className="rounded-xl border border-tulsi/40 bg-tulsi/15 p-4 text-center text-base font-semibold text-tulsi-foreground">
          {pick(locale, currentTier === "max" ? c.welcomeMax : c.welcomePro)}
        </div>
      )}
      {status === "activating" && (
        <div className="rounded-xl border border-marigold/40 bg-marigold/15 p-4 text-center text-sm font-medium text-marigold-foreground">
          {pick(locale, c.activating)}
        </div>
      )}
      {message && <p className="text-center text-sm text-muted-foreground">{message}</p>}

      {/* Plan cards.

          A failed /billing/plans used to render NOTHING here — no cards, no
          skeletons, no explanation — on the one page whose entire job is to
          sell. `plans.data?.plans.map(...)` is silently a no-op when the
          request fails, and that failure is now MORE likely: the landing page
          added two public API calls sharing this endpoint's per-IP limiter
          (docs/OUTSTANDING.md B9). Reproduced live by forcing a 429. */}
      {plans.isError ? (
        <QueryErrorState onRetry={() => void plans.refetch()} />
      ) : (
      <div className="flex flex-col gap-8">
        {plans.isLoading && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-64 rounded-2xl" />)}
          </div>
        )}
        {tierGroups(plans.data?.plans ?? []).map(({ tier, plans: tierPlans }) => (
        <section key={tier} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="font-heading text-xl font-bold tracking-tight">
              {pick(locale, tier === "max" ? c.max : c.pro)}
            </h2>
            {/* What actually separates the two — the page showed six price
                cards under two bare words and never said. leading-[1.75]
                because Tailwind's text-sm sets its own line-height and would
                otherwise win against the Devanagari floor. */}
            <p className="max-w-2xl text-sm leading-[1.75] text-muted-foreground">
              {pick(locale, tier === "max" ? c.maxTierNote : c.proTierNote)}
            </p>
          </div>
          <div className={cn("grid gap-4 sm:grid-cols-2", tierPlans.length > 2 && "lg:grid-cols-4")}>
        {tierPlans.map((plan) => {
          const highlight = plan.is_intro; // yearly = best value
          const per = planPeriodLabel(plan);
          const months = planMonths(plan);
          // Transparent per-month effective price on the multi-month tiers — the
          // whole point of the ladder, shown plainly rather than implied.
          const effPerMonth = months > 1 ? Math.round(plan.price_paise / months) : null;
          const busy = status === "starting" && activePlan === plan.code;
          return (
            <div
              key={plan.id}
              className={cn(
                "relative flex flex-col gap-4 rounded-2xl border p-5",
                highlight
                  ? "border-marigold bg-card shadow-lg shadow-marigold/20 sm:-mt-2 sm:pt-7"
                  : "border-border bg-card",
              )}
            >
              {highlight && (
                // The reference's "Most Popular" pill: gold, centred, riding
                // the card's top edge. Text is --brand-navy, never white —
                // white on this gold measures 1.6:1.
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-marigold px-3 py-1 text-xs font-semibold text-brand-navy shadow-sm">
                  {pick(locale, c.bestValue)}
                </span>
              )}
              <div>
                <h3 className="font-heading text-lg font-bold tracking-tight">{pick(locale, plan.name_i18n)}</h3>
                <p className="mt-0.5 text-sm text-muted-foreground">{pick(locale, plan.description_i18n)}</p>
              </div>
              <div>
                {/* wrap + nowrap on the numeral: at lg the 4-up card is ~220px
                    and "₹1,799 /6 months" does not fit on one line, which
                    otherwise breaks INSIDE the price itself ("₹ 1,799"). */}
                <div className="flex flex-wrap items-end gap-x-1">
                  <span className="font-display text-4xl font-extrabold tabular-nums tracking-tight whitespace-nowrap">
                    ₹{paiseToRupeeString(plan.price_paise)}
                  </span>
                  <span className="pb-1 text-sm text-muted-foreground">{pick(locale, per)}</span>
                </div>
                {effPerMonth !== null && (
                  <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                    ≈ ₹{paiseToRupeeString(effPerMonth)}
                    {pick(locale, c.perMonthShort)}
                  </p>
                )}
              </div>
              {willProrate(plan.tier) && (
                <p className="rounded-lg bg-primary/10 px-2.5 py-1.5 text-xs leading-[1.75] text-primary">
                  {pick(locale, c.proratedNote)}
                </p>
              )}
              {plan.is_intro && (
                <span className="w-fit rounded-full bg-marigold/15 px-2 py-0.5 text-xs font-medium text-marigold-foreground">
                  {pick(locale, c.introPrice)}
                </span>
              )}
              <Button
                size="lg"
                variant={highlight ? "default" : "outline"}
                className="mt-auto w-full"
                disabled={busy || owned(plan.tier) || status === "activating" || (!!session && profileQuery.isLoading)}
                onClick={() => choose(plan)}
              >
                {busy
                  ? pick(locale, c.processing)
                  : owned(plan.tier)
                    ? pick(locale, ownedLabel(plan.tier))
                    : pick(locale, c.choosePlan)}
              </Button>
            </div>
          );
        })}
          </div>
        </section>
        ))}
      </div>
      )}

      {/* Free vs Pro vs Max comparison */}
      <div className="flex flex-col gap-3">
        <h2 className="font-heading text-xl font-bold tracking-tight">{pick(locale, c.compareTitle)}</h2>
        <ComparisonTable locale={locale} />
      </div>
      </div>

      <Footer />
    </div>
  );
}

/**
 * Split the flat `plans` list into one group per tier, cheapest tier first.
 *
 * Six plans (four Pro cadences + two Max) do not read in a single 4-up grid —
 * the cards stop being comparable because adjacent ones are different products.
 * Grouping also makes each tier's `is_intro` "Best value" pill mean "best value
 * WITHIN this tier", which is the only reading that is actually true.
 *
 * Derived from the data rather than hardcoded, so a future tier appears without
 * touching this file. Order comes from the tier rank, not the string.
 */
function tierGroups(plans: Plan[]): { tier: string; plans: Plan[] }[] {
  const RANK: Record<string, number> = { free: 0, pro: 1, max: 2 };
  const byTier = new Map<string, Plan[]>();
  for (const p of plans) {
    const list = byTier.get(p.tier) ?? [];
    list.push(p);
    byTier.set(p.tier, list);
  }
  return [...byTier.entries()]
    .sort((a, b) => (RANK[a[0]] ?? 99) - (RANK[b[0]] ?? 99))
    .map(([tier, list]) => ({ tier, plans: list }));
}

function ComparisonTable({ locale }: { locale: ReturnType<typeof useLocale> }) {
  type Cell = { en: string; hi: string } | boolean;
  const rows: { label: { en: string; hi: string }; free: Cell; pro: Cell; max: Cell }[] = [
    { label: c.featPYQ, free: true, pro: true, max: true },
    { label: c.featDaily, free: true, pro: true, max: true },
    { label: c.featEval, free: c.featEvalFree, pro: c.featEvalPro, max: c.featEvalMax },
    { label: c.featNotes, free: c.featNotesFree, pro: c.featNotesPro, max: c.featNotesPro },
    { label: c.featMentor, free: c.featMentorFree, pro: c.featMentorPro, max: c.featMentorPro },
    { label: c.featOcr, free: false, pro: true, max: true },
    { label: c.featDrills, free: false, pro: true, max: true },
    { label: c.featMocks, free: false, pro: true, max: true },
    { label: c.featAnalytics, free: false, pro: true, max: true },
    { label: c.featMagazine, free: false, pro: true, max: true },
    // The one row that separates the tiers — last, so it reads as the payoff.
    { label: c.featSeries, free: false, pro: false, max: true },
  ];
  const cell = (v: Cell) => {
    if (v === true) return <Check className="mx-auto size-4 text-tulsi" aria-hidden />;
    if (v === false) return <X className="mx-auto size-4 text-muted-foreground/50" aria-hidden />;
    return <span className="block text-xs leading-[1.75]">{pick(locale, v)}</span>;
  };
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full min-w-[34rem] text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/50">
            <th className="px-4 py-3 text-left font-medium"> </th>
            <th className="px-4 py-3 text-center font-medium">{pick(locale, c.free)}</th>
            <th className="px-4 py-3 text-center font-semibold text-marigold-foreground">{pick(locale, c.pro)}</th>
            <th className="px-4 py-3 text-center font-semibold text-primary">{pick(locale, c.max)}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-border/60 last:border-0">
              <td className="px-4 py-3">{pick(locale, r.label)}</td>
              <td className="px-4 py-3 text-center text-muted-foreground">{cell(r.free)}</td>
              <td className="px-4 py-3 text-center">{cell(r.pro)}</td>
              <td className="px-4 py-3 text-center">{cell(r.max)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
