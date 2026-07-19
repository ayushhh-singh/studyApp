import { Zap } from "lucide-react";
import { useLocale } from "@/hooks/use-locale";
import { useEntitlements } from "@/hooks/use-billing";
import { usePaywallStore } from "@/stores/paywall-store";
import { cn } from "@/lib/utils";
import { billingCopy as c, pick } from "@/lib/billing-copy";

/**
 * Remaining-evaluations chip for the Answers hub. Pro shows "Unlimited"; Free
 * shows the count, coral at zero (tapping it raises the eval paywall).
 */
export function EvaluationQuotaChip({ className }: { className?: string }) {
  const locale = useLocale();
  const { data } = useEntitlements();
  const openPaywall = usePaywallStore((s) => s.openPaywall);
  if (!data) return null;

  // A trial user is plan==='pro' but has a real, tighter daily cap — show the
  // count, never "Unlimited". Only a PAID Pro is truly unlimited-ish here.
  const unlimited = data.plan === "pro" && !data.is_on_trial;
  const remaining = data.evaluations.remaining;
  const empty = !unlimited && remaining <= 0;
  const perDay = data.evaluations.period === "day";
  const leftLabel = perDay
    ? pick(locale, c.evalsLeftToday)
    : pick(locale, remaining === 1 ? c.evalLeftOne : c.evalsLeft);

  const label = unlimited ? pick(locale, c.unlimited) : `${remaining} ${leftLabel}`;

  const tone = unlimited
    ? "border-primary/30 bg-primary/10 text-primary"
    : empty
      ? "border-coral/40 bg-coral/10 text-coral-foreground"
      : remaining <= 1
        ? "border-marigold/40 bg-marigold/15 text-marigold-foreground"
        : "border-border bg-muted text-muted-foreground";

  return (
    <button
      type="button"
      onClick={empty ? () => openPaywall("evaluation") : undefined}
      disabled={!empty}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium",
        tone,
        empty && "cursor-pointer hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        !empty && "cursor-default",
        className,
      )}
    >
      <Zap className="size-3.5" aria-hidden />
      {label}
    </button>
  );
}
