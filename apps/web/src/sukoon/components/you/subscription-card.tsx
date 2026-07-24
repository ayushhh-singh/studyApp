import { useState } from "react";
import { Link, useParams } from "react-router";
import { Sparkles, Crown, Leaf } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSukoonLanguage } from "@/sukoon/lib/use-sukoon-language";
import {
  useSukoonBillingState,
  useCancelSukoonSubscription,
  useStartSukoonTrial,
  useRefreshSukoonBilling,
} from "@/sukoon/lib/use-sukoon-billing";

/**
 * The Sukoon "manage subscription" screen (F13 item 7), rendered under
 * /sukoon/you. Shows the current plan + status, an honest end-of-period message,
 * cancel (keeps access until the period ends — data is never deleted), and the
 * route to change/see plans. Calm and non-alarming throughout.
 */
export function SubscriptionCard() {
  const { t, language } = useSukoonLanguage();
  const { locale } = useParams<{ locale?: string }>();
  const base = locale ? `/${locale}/sukoon` : "";

  const stateQuery = useSukoonBillingState();
  const cancel = useCancelSukoonSubscription();
  const startTrial = useStartSukoonTrial();
  const refresh = useRefreshSukoonBilling();
  const [armed, setArmed] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  if (stateQuery.isLoading) {
    return <div className="h-36 animate-pulse rounded-2xl border border-border bg-muted/40" />;
  }
  const ent = stateQuery.data?.entitlements ?? null;
  const sub = stateQuery.data?.subscription ?? null;
  if (!ent) return null;

  const dateFmt = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleDateString(language === "hi" ? "hi-IN" : "en-IN", {
          day: "numeric",
          month: "long",
          year: "numeric",
        })
      : "";
  const daysLeft = ent.current_period_end
    ? Math.max(0, Math.ceil((new Date(ent.current_period_end).getTime() - Date.now()) / 86_400_000))
    : 0;

  const tierLabel =
    ent.tier === "pro"
      ? t("Sukoon.pricing.pro.name")
      : ent.tier === "plus"
        ? t("Sukoon.pricing.plus.name")
        : t("Sukoon.pricing.free.name");
  const cancelledInPeriod = sub?.status === "cancelled" && !!ent.current_period_end;

  const onCancel = () => {
    cancel.mutate(undefined, {
      onSuccess: () => {
        refresh();
        setArmed(false);
        setNote(t("Sukoon.manage.cancelledNote"));
      },
    });
  };
  const onStartTrial = () => {
    startTrial.mutate(undefined, {
      onSuccess: () => {
        refresh();
        setNote(t("Sukoon.pricing.trialStarted"));
      },
    });
  };

  const Icon = ent.tier === "pro" ? Crown : ent.tier === "plus" ? Sparkles : Leaf;

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-full bg-secondary/15 text-secondary">
            <Icon className="size-4" aria-hidden />
          </span>
          <div>
            <p className="text-sm font-semibold text-foreground">{tierLabel}</p>
            <p className="text-xs text-muted-foreground">
              {ent.tier_source === "trial"
                ? t("Sukoon.manage.trialStatus", { days: daysLeft })
                : ent.tier_source === "paid"
                  ? cancelledInPeriod
                    ? t("Sukoon.manage.cancelledStatus", { date: dateFmt(ent.current_period_end) })
                    : t("Sukoon.manage.paidStatus", { date: dateFmt(ent.current_period_end) })
                  : t("Sukoon.manage.freeStatus")}
            </p>
          </div>
        </div>
      </div>

      {note ? <p className="text-xs text-secondary">{note}</p> : null}

      <div className="flex flex-wrap gap-2">
        {ent.tier === "free" ? (
          <>
            {ent.trial_eligible ? (
              <Button size="sm" onClick={onStartTrial} disabled={startTrial.isPending}>
                {startTrial.isPending ? t("Sukoon.pricing.starting") : t("Sukoon.pricing.startTrial")}
              </Button>
            ) : null}
            <Button asChild size="sm" variant={ent.trial_eligible ? "outline" : "default"}>
              <Link to={`${base}/pricing`}>{t("Sukoon.pricing.seePlans")}</Link>
            </Button>
          </>
        ) : (
          <>
            <Button asChild size="sm" variant="outline">
              <Link to={`${base}/pricing`}>{t("Sukoon.manage.changePlan")}</Link>
            </Button>
            {/* Cancel only makes sense for a paid, not-already-cancelled sub. */}
            {ent.tier_source === "paid" && !cancelledInPeriod ? (
              armed ? (
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={onCancel}
                  onBlur={() => setArmed(false)}
                  disabled={cancel.isPending}
                >
                  {cancel.isPending ? t("Sukoon.manage.cancelling") : t("Sukoon.manage.confirmCancel")}
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-muted-foreground"
                  onClick={() => setArmed(true)}
                >
                  {t("Sukoon.manage.cancel")}
                </Button>
              )
            ) : null}
          </>
        )}
      </div>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {t("Sukoon.manage.dataSafeNote")}
      </p>
    </div>
  );
}
