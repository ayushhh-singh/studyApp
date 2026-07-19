import { Link } from "react-router";
import { Sparkles, Crown, Clock } from "lucide-react";
import { useLocale } from "@/hooks/use-locale";
import { useEntitlements } from "@/hooks/use-billing";
import { Button } from "@/components/ui/button";
import { billingCopy as c, pick, daysUntil } from "@/lib/billing-copy";

/** Profile plan row: a Pro-trial countdown, a paid-Pro crown, or a Free → upgrade CTA. */
export function PlanBanner() {
  const locale = useLocale();
  const { data } = useEntitlements();
  if (!data) return null;

  // On the 7-day trial (plan is 'pro', but it's not a paid subscription): show
  // the countdown + a "Keep Pro" CTA so the lapse is never a silent surprise.
  if (data.is_on_trial) {
    const days = daysUntil(data.plan_expires_at);
    const daysLabel =
      days <= 0 ? pick(locale, c.trialLastDay) : `${days} ${pick(locale, days === 1 ? c.trialDayLeftOne : c.trialDaysLeft)}`;
    return (
      <div className="flex flex-col gap-3 rounded-xl border border-marigold/30 bg-marigold/10 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-marigold/20 text-marigold-foreground">
            <Clock className="size-5" aria-hidden />
          </span>
          <div className="text-sm">
            <p className="font-semibold">{pick(locale, c.trialActive)}</p>
            <p className="text-muted-foreground">{daysLabel}</p>
          </div>
        </div>
        <Button asChild className="shrink-0">
          <Link to={`/${locale}/pricing`}>{pick(locale, c.trialKeepPro)}</Link>
        </Button>
      </div>
    );
  }

  if (data.plan === "pro") {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/10 p-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
          <Crown className="size-5" aria-hidden />
        </span>
        <div className="text-sm">
          <p className="font-semibold text-primary">{pick(locale, c.youArePro)}</p>
          {data.plan_expires_at && (
            <p className="text-muted-foreground">
              {pick(locale, c.proUntil)}{" "}
              {new Date(data.plan_expires_at).toLocaleDateString(locale === "hi" ? "hi-IN" : "en-IN", {
                day: "numeric",
                month: "short",
                year: "numeric",
              })}
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-marigold/30 bg-marigold/10 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-marigold/20 text-marigold-foreground">
          <Sparkles className="size-5" aria-hidden />
        </span>
        <div className="text-sm">
          <p className="font-semibold">{pick(locale, c.upgradeToPro)}</p>
          <p className="text-muted-foreground">{pick(locale, c.pricingSubtitle)}</p>
        </div>
      </div>
      <Button asChild className="shrink-0">
        <Link to={`/${locale}/pricing`}>{pick(locale, c.seePlans)}</Link>
      </Button>
    </div>
  );
}
