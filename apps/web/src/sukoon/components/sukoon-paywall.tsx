import { useNavigate, useParams } from "react-router";
import { Sparkles, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui-x/sheet";
import { useSukoonLanguage } from "@/sukoon/lib/use-sukoon-language";
import { useSukoonPaywallStore } from "@/sukoon/stores/sukoon-paywall-store";
import {
  useSukoonEntitlements,
  useStartSukoonTrial,
  useRefreshSukoonBilling,
} from "@/sukoon/lib/use-sukoon-billing";

/**
 * The ONE Sukoon paywall interstitial (F13 item 5) — opened by the chat-cap,
 * reflections, premium-journeys and insights-preview surfaces via
 * useSukoonPaywallStore. Calm, bilingual, and deliberately NOT guilt-tripping:
 * it frames the upgrade as "more of what helps", offers the free trial when the
 * user is eligible, and always leaves an easy "not now". Mounted once in the
 * Sukoon shell.
 */
export function SukoonPaywall() {
  const { t } = useSukoonLanguage();
  const { locale } = useParams<{ locale?: string }>();
  const navigate = useNavigate();
  const base = locale ? `/${locale}/sukoon` : "";

  const open = useSukoonPaywallStore((s) => s.open);
  const feature = useSukoonPaywallStore((s) => s.feature);
  const close = useSukoonPaywallStore((s) => s.close);

  const entQuery = useSukoonEntitlements({ enabled: open });
  const ent = entQuery.data ?? null;
  const startTrial = useStartSukoonTrial();
  const refresh = useRefreshSukoonBilling();

  const canStartTrial = !!ent?.trial_eligible && ent.tier === "free";
  const bundleEligible = !!ent?.bundle_eligible;
  const discountPct = ent?.bundle_discount_pct ?? 40;

  const goPlans = () => {
    close();
    navigate(`${base}/pricing`);
  };

  const onStartTrial = () => {
    startTrial.mutate(undefined, {
      onSuccess: () => {
        refresh();
        close();
      },
      // If the trial was already used (400), fall back to the plans page.
      onError: () => goPlans(),
    });
  };

  return (
    <Sheet open={open} onOpenChange={(o) => !o && close()}>
      <SheetContent
        side="bottom"
        title={t(`Sukoon.paywall.${feature}.title`)}
        className="mx-auto max-w-lg rounded-t-3xl"
      >
        <div className="flex flex-col gap-5 px-1 pb-2">
          <div className="flex items-start gap-3">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-secondary/15 text-secondary">
              <Sparkles className="size-5" aria-hidden />
            </span>
            <p className="pt-1 text-sm leading-relaxed text-muted-foreground">
              {t(`Sukoon.paywall.${feature}.body`)}
            </p>
          </div>

          {bundleEligible ? (
            <div className="rounded-2xl border border-secondary/40 bg-secondary/10 px-4 py-3 text-sm text-foreground">
              {t("Sukoon.paywall.bundleStrip", { pct: discountPct })}
            </div>
          ) : null}

          <div className="flex flex-col gap-2">
            {canStartTrial ? (
              <>
                <Button onClick={onStartTrial} disabled={startTrial.isPending} className="w-full">
                  {startTrial.isPending
                    ? t("Sukoon.paywall.starting")
                    : t("Sukoon.paywall.startTrial")}
                </Button>
                <Button variant="outline" onClick={goPlans} className="w-full">
                  {t("Sukoon.paywall.seePlans")}
                </Button>
              </>
            ) : (
              <Button onClick={goPlans} className="w-full">
                {t("Sukoon.paywall.seePlans")}
              </Button>
            )}
            <Button variant="ghost" onClick={close} className="w-full text-muted-foreground">
              {t("Sukoon.paywall.notNow")}
            </Button>
          </div>

          <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="size-3.5" aria-hidden />
            {t("Sukoon.paywall.privacyNote")}
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
