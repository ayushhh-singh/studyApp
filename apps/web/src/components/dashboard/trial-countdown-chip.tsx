import { Link } from "react-router";
import { Clock } from "lucide-react";
import { useLocale } from "@/hooks/use-locale";
import { useEntitlements } from "@/hooks/use-billing";
import { billingCopy as c, pick, daysUntil } from "@/lib/billing-copy";
import { cn } from "@/lib/utils";

/**
 * Compact "Pro trial · N days left" pill for the dashboard greeting — so a
 * trial user always sees the countdown and the lapse is never a surprise. Only
 * renders during an active trial; links to pricing to keep Pro. Goes coral on
 * the final day.
 */
export function TrialCountdownChip() {
  const locale = useLocale();
  const { data } = useEntitlements();
  if (!data?.is_on_trial) return null;

  const days = daysUntil(data.plan_expires_at);
  const label =
    days <= 0
      ? pick(locale, c.trialLastDay)
      : `${pick(locale, c.trialActive)} · ${days} ${pick(locale, days === 1 ? c.trialDayLeftOne : c.trialDaysLeft)}`;
  const urgent = days <= 1;

  return (
    <Link
      to={`/${locale}/pricing`}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        urgent
          ? "border-coral/40 bg-coral/10 text-coral-foreground hover:brightness-95"
          : "border-marigold/40 bg-marigold/15 text-marigold-foreground hover:brightness-95",
      )}
    >
      <Clock className="size-3.5" aria-hidden />
      {label}
    </Link>
  );
}
