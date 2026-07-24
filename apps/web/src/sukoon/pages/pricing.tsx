import { useEffect, useMemo, useState } from "react";
import { Check, Sparkles, ShieldCheck, Loader2 } from "lucide-react";
import type { SukoonPlan, SukoonTier } from "@neev/shared";
import { applyBundleDiscount, sukoonPaiseToRupees, sukoonPlanMonths } from "@neev/shared";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui-x/page-header";
import { openRazorpayCheckout } from "@/lib/razorpay-checkout";
import { useSukoonLanguage } from "@/sukoon/lib/use-sukoon-language";
import {
  useSukoonPlans,
  useSukoonBillingState,
  useCreateSukoonOrder,
  useStartSukoonTrial,
  useRefreshSukoonBilling,
} from "@/sukoon/lib/use-sukoon-billing";

/** Sukoon brand teal — the checkout accent. */
const SUKOON_THEME = "#4FB3A9";
const IS_STANDALONE = import.meta.env.VITE_APP === "sukoon";

type IntervalKey = "monthly" | "quarterly" | "yearly";
const INTERVALS: IntervalKey[] = ["monthly", "quarterly", "yearly"];

function intervalKey(plan: Pick<SukoonPlan, "interval" | "interval_count">): IntervalKey {
  if (plan.interval === "year") return "yearly";
  return plan.interval_count === 3 ? "quarterly" : "monthly";
}

type Status = "idle" | "starting" | "activating" | "done" | "error";

export function Component() {
  const { t, language } = useSukoonLanguage();
  const plansQuery = useSukoonPlans();
  const stateQuery = useSukoonBillingState();
  const createOrder = useCreateSukoonOrder();
  const startTrial = useStartSukoonTrial();
  const refresh = useRefreshSukoonBilling();

  const [interval, setInterval] = useState<IntervalKey>("yearly");
  const [status, setStatus] = useState<Status>("idle");
  const [busyCode, setBusyCode] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const ent = stateQuery.data?.entitlements ?? null;
  const currentTier: SukoonTier = ent?.tier ?? "free";
  const bundleEligible = !IS_STANDALONE && !!ent?.bundle_eligible;
  const discountPct = ent?.bundle_discount_pct ?? 40;
  const trialEligible = !!ent?.trial_eligible && currentTier === "free";

  // Group the six plans by tier → interval so each card can pick the right price.
  const byTier = useMemo(() => {
    const map: Record<"plus" | "pro", Partial<Record<IntervalKey, SukoonPlan>>> = { plus: {}, pro: {} };
    for (const p of plansQuery.data?.plans ?? []) {
      if (p.tier === "plus" || p.tier === "pro") map[p.tier][intervalKey(p)] = p;
    }
    return map;
  }, [plansQuery.data]);

  // Poll for the webhook-driven tier flip after checkout (source of truth).
  useEffect(() => {
    if (status !== "activating") return;
    const started = Date.now();
    const id = window.setInterval(() => {
      void stateQuery.refetch();
      if (Date.now() - started > 20_000) {
        setStatus("done");
        window.clearInterval(id);
      }
    }, 2_000);
    return () => window.clearInterval(id);
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (status === "activating" && currentTier !== "free") setStatus("done");
  }, [currentTier, status]);

  const pick = (v: { hi: string; en: string }) => (language === "hi" ? v.hi : v.en);

  const buy = async (plan: SukoonPlan) => {
    setMessage(null);
    setStatus("starting");
    setBusyCode(plan.code);
    try {
      const order = await createOrder.mutateAsync(plan.code);
      await openRazorpayCheckout({
        keyId: order.key_id,
        orderId: order.order_id,
        amountPaise: order.amount_paise,
        currency: order.currency,
        name: "Sukoon",
        description: pick(plan.name_i18n),
        prefillName: order.prefill_name ?? undefined,
        themeColor: SUKOON_THEME,
        onSuccess: () => {
          setStatus("activating");
          refresh();
        },
        onDismiss: () => {
          setStatus("idle");
          setBusyCode(null);
          setMessage(t("Sukoon.pricing.paymentCancelled"));
        },
      });
    } catch {
      setStatus("error");
      setBusyCode(null);
      setMessage(t("Sukoon.pricing.orderError"));
    }
  };

  const beginTrial = () => {
    setMessage(null);
    startTrial.mutate(undefined, {
      onSuccess: () => {
        refresh();
        setMessage(t("Sukoon.pricing.trialStarted"));
      },
      onError: () => setMessage(t("Sukoon.pricing.trialError")),
    });
  };

  const priceFor = (plan: SukoonPlan) => {
    const base = plan.price_paise;
    const effective = bundleEligible ? applyBundleDiscount(base, plan.bundle_discount_pct) : base;
    const months = sukoonPlanMonths(plan);
    return {
      base,
      effective,
      discounted: effective < base,
      perMonth: Math.round(effective / months),
    };
  };

  const activating = status === "activating";

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <PageHeader title={t("Sukoon.pricing.title")} description={t("Sukoon.pricing.subtitle")} />

      {/* Free 7-day Pro trial */}
      {trialEligible ? (
        <div className="flex flex-col gap-3 rounded-2xl border border-secondary/40 bg-secondary/10 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary/20 text-secondary">
              <Sparkles className="size-4" aria-hidden />
            </span>
            <div>
              <p className="text-sm font-semibold text-foreground">{t("Sukoon.pricing.trialTitle")}</p>
              <p className="text-xs text-muted-foreground">{t("Sukoon.pricing.trialBody")}</p>
            </div>
          </div>
          <Button onClick={beginTrial} disabled={startTrial.isPending} className="shrink-0">
            {startTrial.isPending ? t("Sukoon.pricing.starting") : t("Sukoon.pricing.startTrial")}
          </Button>
        </div>
      ) : null}

      {/* Neev bundle strip (integrated only) */}
      {bundleEligible ? (
        <div className="rounded-2xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm text-foreground">
          {t("Sukoon.pricing.bundleStrip", { pct: discountPct })}
        </div>
      ) : null}

      {message ? (
        <div className="rounded-xl border border-border bg-muted/40 px-4 py-2.5 text-sm text-muted-foreground">
          {message}
        </div>
      ) : null}
      {activating ? (
        <div className="flex items-center gap-2 rounded-xl border border-secondary/40 bg-secondary/10 px-4 py-2.5 text-sm text-foreground">
          <Loader2 className="size-4 animate-spin text-secondary" aria-hidden />
          {t("Sukoon.pricing.activating")}
        </div>
      ) : null}

      {/* Interval toggle */}
      <div className="flex justify-center">
        <div className="inline-flex rounded-full border border-border bg-muted/40 p-1">
          {INTERVALS.map((iv) => (
            <button
              key={iv}
              type="button"
              onClick={() => setInterval(iv)}
              className={cn(
                "rounded-full px-4 py-1.5 text-xs font-medium transition-colors",
                interval === iv
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t(`Sukoon.pricing.interval_${iv}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {/* Free */}
        <TierCard
          name={t("Sukoon.pricing.free.name")}
          priceLabel="₹0"
          features={t("Sukoon.pricing.free.features", { returnObjects: true }) as unknown as string[]}
          isCurrent={currentTier === "free"}
          currentLabel={t("Sukoon.pricing.currentPlan")}
        />

        {/* Plus */}
        <PaidCard
          tier="plus"
          plan={byTier.plus[interval]}
          priceFor={priceFor}
          pick={pick}
          currentTier={currentTier}
          isOnTrial={!!ent?.is_on_trial}
          busy={busyCode !== null && status === "starting"}
          busyThis={busyCode === byTier.plus[interval]?.code}
          onBuy={buy}
          t={t}
        />

        {/* Pro */}
        <PaidCard
          tier="pro"
          plan={byTier.pro[interval]}
          priceFor={priceFor}
          pick={pick}
          currentTier={currentTier}
          isOnTrial={!!ent?.is_on_trial}
          busy={busyCode !== null && status === "starting"}
          busyThis={busyCode === byTier.pro[interval]?.code}
          onBuy={buy}
          highlighted
          t={t}
        />
      </div>

      {/* Trust copy */}
      <div className="flex flex-col items-center gap-2 pt-2 text-center">
        <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="size-3.5" aria-hidden />
          {t("Sukoon.pricing.privacy1")}
        </p>
        <p className="max-w-md text-xs text-muted-foreground">{t("Sukoon.pricing.privacy2")}</p>
        <p className="max-w-md text-[11px] text-muted-foreground">{t("Sukoon.pricing.notTherapyNote")}</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function TierCard({
  name,
  priceLabel,
  perMonthLabel,
  features,
  isCurrent,
  currentLabel,
  highlighted,
  children,
}: {
  name: string;
  priceLabel: string;
  perMonthLabel?: string;
  features: string[];
  isCurrent?: boolean;
  currentLabel?: string;
  highlighted?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4 rounded-2xl border bg-card p-5",
        highlighted ? "border-secondary/60 ring-1 ring-secondary/30" : "border-border",
      )}
    >
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-foreground">{name}</h3>
          {isCurrent ? (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              {currentLabel}
            </span>
          ) : null}
        </div>
        <div className="flex items-baseline gap-1">
          <span className="text-2xl font-bold text-foreground">{priceLabel}</span>
        </div>
        {perMonthLabel ? <p className="text-xs text-muted-foreground">{perMonthLabel}</p> : null}
      </div>
      <ul className="flex flex-col gap-2">
        {/* Defensive: a missing i18n key returns the key STRING, not the array —
            guard so `.map` never runs on a string and white-screens the page. */}
        {(Array.isArray(features) ? features : []).map((f) => (
          <li key={f} className="flex items-start gap-2 text-xs text-muted-foreground">
            <Check className="mt-0.5 size-3.5 shrink-0 text-secondary" aria-hidden />
            <span>{f}</span>
          </li>
        ))}
      </ul>
      {children ? <div className="mt-auto pt-1">{children}</div> : null}
    </div>
  );
}

function PaidCard({
  tier,
  plan,
  priceFor,
  pick,
  currentTier,
  isOnTrial,
  busy,
  busyThis,
  onBuy,
  highlighted,
  t,
}: {
  tier: "plus" | "pro";
  plan: SukoonPlan | undefined;
  priceFor: (p: SukoonPlan) => { base: number; effective: number; discounted: boolean; perMonth: number };
  pick: (v: { hi: string; en: string }) => string;
  currentTier: SukoonTier;
  isOnTrial: boolean;
  busy: boolean;
  busyThis: boolean;
  onBuy: (p: SukoonPlan) => void;
  highlighted?: boolean;
  t: (k: string, o?: Record<string, unknown>) => string;
}) {
  if (!plan) return null;
  const price = priceFor(plan);
  const isCurrent = currentTier === tier && !isOnTrial;
  const trialOnThis = isOnTrial && tier === "pro";
  const features = t(`Sukoon.pricing.${tier}.features`, { returnObjects: true }) as unknown as string[];

  return (
    <TierCard
      name={pick(plan.name_i18n)}
      priceLabel={`₹${sukoonPaiseToRupees(price.effective)}`}
      perMonthLabel={t("Sukoon.pricing.perMonth", { amount: sukoonPaiseToRupees(price.perMonth) })}
      features={Array.isArray(features) ? features : []}
      isCurrent={isCurrent}
      currentLabel={t("Sukoon.pricing.currentPlan")}
      highlighted={highlighted}
    >
      {price.discounted ? (
        <p className="mb-2 text-xs text-muted-foreground">
          <span className="line-through">₹{sukoonPaiseToRupees(price.base)}</span>{" "}
          <span className="font-medium text-secondary">{t("Sukoon.pricing.bundlePrice")}</span>
        </p>
      ) : null}
      {trialOnThis ? (
        <div className="rounded-lg bg-secondary/10 px-3 py-1.5 text-center text-[11px] font-medium text-secondary">
          {t("Sukoon.pricing.trialActive")}
        </div>
      ) : isCurrent ? (
        <Button variant="outline" disabled className="w-full">
          {t("Sukoon.pricing.currentPlan")}
        </Button>
      ) : (
        <Button onClick={() => onBuy(plan)} disabled={busy} className="w-full">
          {busyThis ? t("Sukoon.pricing.starting") : t("Sukoon.pricing.choosePlan")}
        </Button>
      )}
    </TierCard>
  );
}
