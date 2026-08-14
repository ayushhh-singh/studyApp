import { useLocation, useNavigate } from "react-router";
import { Sparkles, Check } from "lucide-react";
import { useLocale } from "@/hooks/use-locale";
import { useAuth } from "@/providers/auth-provider";
import { usePaywallStore, type PaywallFeature } from "@/stores/paywall-store";
import { useProfileAnalytics } from "@/hooks/use-profile-analytics";
import { useEntitlements } from "@/hooks/use-billing";
import { Sheet, SheetContent } from "@/components/ui-x/sheet";
import { Button } from "@/components/ui/button";
import { billingCopy as c, pick } from "@/lib/billing-copy";

/**
 * Global upgrade prompt, opened from anywhere a 402 (or a locked surface) fires
 * via usePaywallStore.openPaywall(feature). Mounted once in the app shell.
 *
 * For the evaluation paywall it shows THE USER'S proven before/after gains (from
 * profile analytics' improvement_proof) — the "here's what more of this buys
 * you" moment, not a generic sales pitch.
 */
function featureCopy(feature: PaywallFeature) {
  switch (feature) {
    case "evaluation":
      return { title: c.paywallEvalTitle, body: c.paywallEvalBody };
    case "handwritten_ocr":
      return { title: c.paywallOcrTitle, body: c.paywallOcrBody };
    case "mock_tests":
      return { title: c.paywallMocksTitle, body: c.paywallMocksBody };
    case "micro_drills":
      return { title: c.paywallDrillsTitle, body: c.paywallDrillsBody };
    case "all_notes":
      return { title: c.paywallNotesTitle, body: c.paywallNotesBody };
    case "magazine_pdf":
      return { title: c.paywallMagazineTitle, body: c.paywallMagazineBody };
    case "test_series":
      return { title: c.paywallSeriesTitle, body: c.paywallSeriesBody };
    default:
      return { title: c.paywallGenericTitle, body: c.pricingSubtitle };
  }
}

const PRO_BULLETS = [c.featEvalPro, c.featNotesPro, c.featOcr, c.featMocks, c.featAnalytics];
// The series paywall is the one that sells MAX, not Pro — leading with Pro
// bullets there would pitch a tier that does not include the thing being asked for.
const MAX_BULLETS = [c.featSeries, c.featEvalMax, c.featOcr, c.featMocks, c.featAnalytics];

export function PaywallModal() {
  const locale = useLocale();
  const navigate = useNavigate();
  const location = useLocation();
  const { isGuest } = useAuth();
  const { open, feature, close } = usePaywallStore();
  /** The series is the only Max-tier gate, so it sells a different tier. */
  const isSeries = feature === "test_series";
  // Only the eval paywall needs the gains data — fetch lazily, only when shown
  // (and never for a guest, who has no analytics and sees the signup variant).
  const analytics = useProfileAnalytics({ enabled: open && !isGuest && feature === "evaluation" });
  const avgGain = analytics.data?.improvement_proof.avg_delta_pct ?? null;
  // The eval paywall means three different things depending on plan state, and
  // each wants different copy + CTA (see #6): a free user should upgrade; a
  // trial user's daily cap resets tomorrow (upgrade for more); a PAID Pro who
  // hit the monthly fair-use cap can't "upgrade" out of it — it just resets.
  const entitlements = useEntitlements({ enabled: open && !isGuest && feature === "evaluation" });
  const ent = entitlements.data;
  const evalState: "free" | "trial" | "proCap" | null =
    feature !== "evaluation" ? null : ent?.is_on_trial ? "trial" : ent?.plan === "pro" || ent?.plan === "max" ? "proCap" : "free";

  // A paid Pro at the monthly cap has nothing to upgrade to — drop the sales CTA.
  const hideUpgrade = evalState === "proCap";

  const cp =
    evalState === "trial"
      ? { title: c.paywallEvalTrialTitle, body: c.paywallEvalTrialBody }
      : evalState === "proCap"
        ? { title: c.paywallEvalProCapTitle, body: c.paywallEvalProCapBody }
        : featureCopy(feature);
  const goPricing = () => {
    close();
    navigate(`/${locale}/pricing`);
  };
  const goSignup = () => {
    close();
    const redirect = `${location.pathname}${location.search}`;
    navigate(`/${locale}/auth?redirect=${encodeURIComponent(redirect)}`);
  };

  // Guests can't do ANY gated action without an account, so every paywall
  // trigger becomes a "create your free account + 7-day trial" prompt, not an
  // upgrade-to-Pro pitch (they have nothing to pay from yet).
  if (isGuest) {
    return (
      <Sheet open={open} onOpenChange={(o) => !o && close()}>
        <SheetContent side="bottom" title={pick(locale, c.guestUnlockTitle)} className="mx-auto max-w-lg gap-5">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
              <Sparkles className="size-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold leading-snug">{pick(locale, c.guestUnlockTitle)}</h2>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{pick(locale, c.guestUnlockBody)}</p>
            </div>
          </div>
          <ul className="grid gap-2">
            {(isSeries ? MAX_BULLETS : PRO_BULLETS).map((b, i) => (
              <li key={i} className="flex items-center gap-2 text-sm">
                <Check className="size-4 shrink-0 text-tulsi" aria-hidden />
                <span>{pick(locale, b)}</span>
              </li>
            ))}
          </ul>
          <div className="flex flex-col gap-2 sm:flex-row-reverse">
            <Button size="lg" className="w-full sm:flex-1" onClick={goSignup}>
              {pick(locale, c.guestUnlockCta)}
            </Button>
            <Button size="lg" variant="ghost" className="w-full sm:w-auto" onClick={close}>
              {pick(locale, c.guestKeepBrowsing)}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Sheet open={open} onOpenChange={(o) => !o && close()}>
      <SheetContent side="bottom" title={pick(locale, isSeries ? c.upgradeToMax : c.upgradeToPro)} className="mx-auto max-w-lg gap-5">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <Sparkles className="size-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold leading-snug">{pick(locale, cp.title)}</h2>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{pick(locale, cp.body)}</p>
          </div>
        </div>

        {feature === "evaluation" && !hideUpgrade && avgGain !== null && avgGain > 0 && (
          <div className="rounded-xl border border-tulsi/30 bg-tulsi/10 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-tulsi-foreground">
              {pick(locale, c.yourGains)}
            </p>
            <p className="mt-1 text-sm text-foreground">
              {pick(locale, c.gainsAvg)}{" "}
              <span className="font-[800] tabular-nums text-tulsi-foreground">+{Math.round(avgGain)}%</span>{" "}
              {pick(locale, c.onAverage)}.
            </p>
          </div>
        )}

        {!hideUpgrade && (
          <ul className="grid gap-2">
            {(isSeries ? MAX_BULLETS : PRO_BULLETS).map((b, i) => (
              <li key={i} className="flex items-center gap-2 text-sm">
                <Check className="size-4 shrink-0 text-tulsi" aria-hidden />
                <span>{pick(locale, b)}</span>
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          {hideUpgrade ? (
            // Paid Pro at the monthly cap: nothing to sell, just acknowledge.
            <Button size="lg" className="w-full" onClick={close}>
              {pick(locale, c.gotIt)}
            </Button>
          ) : (
            <>
              <Button size="lg" className="w-full sm:flex-1" onClick={goPricing}>
                {pick(locale, isSeries ? c.upgradeToMax : c.upgradeToPro)}
              </Button>
              <Button size="lg" variant="ghost" className="w-full sm:w-auto" onClick={close}>
                {pick(locale, c.maybeLater)}
              </Button>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
