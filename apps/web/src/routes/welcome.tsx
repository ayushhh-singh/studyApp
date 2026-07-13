import { useState } from "react";
import { Navigate, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { ArrowRight, Compass, Flame, Languages, MapPinned, PenSquare } from "lucide-react";
import { GUIDED_TOUR_STOPS, type WelcomeTourChoice } from "@neev/shared";
import { useProfile } from "@/hooks/use-profile";
import { useUpdateTourState } from "@/hooks/use-tour";
import { useLocale } from "@/hooks/use-locale";
import { Button } from "@/components/ui/button";
import { BrandMark } from "@/components/marketing/brand-mark";
import { FullScreenLoader, ProfileLoadError } from "@/routes/require-auth";
import { guidedTourStopPath } from "@/lib/guided-tour";
import { cn } from "@/lib/utils";

const TOTAL_SLIDES = 3;
const SLIDE_ICONS = [PenSquare, Languages, Flame];
/** A step beyond the value-prop slides — the explicit binary tour choice. */
const CHOICE_STEP = "choice" as const;
type Step = number | typeof CHOICE_STEP;

/**
 * The tour's welcome moment — 2-3 skippable value-prop screens, followed by
 * an explicit binary choice ("Take a 90-second tour" vs "Skip, I'll explore
 * myself") shown exactly once, between the onboarding wizard and the
 * Dashboard (see require-auth.tsx's welcome_seen redirect). The guided tab
 * tour is NEVER auto-launched — this choice screen is the only place it can
 * be opted into from onboarding; /explore's launcher is the other.
 */
export function Component() {
  const { t } = useTranslation();
  const locale = useLocale();
  const navigate = useNavigate();
  const profileQuery = useProfile();
  const updateTour = useUpdateTourState();
  const [step, setStep] = useState<Step>(0);

  if (profileQuery.isPending) return <FullScreenLoader />;
  if (profileQuery.isError) return <ProfileLoadError onRetry={() => profileQuery.refetch()} />;
  if (!profileQuery.data?.onboarding_completed) return <Navigate to={`/${locale}/onboarding`} replace />;
  if (profileQuery.data.tour_state.welcome_seen) {
    // Must agree with choose()'s own post-mutation navigate() target below —
    // this same guard re-evaluates the instant the mutation's onSuccess
    // patches the cache (welcome_seen flips true while still mounted here),
    // racing our own imperative navigate(). Hardcoding "dashboard" here (the
    // old always-dashboard behavior) would win that race for the "tour"
    // choice and strand the guided tour before its first stop ever showed.
    const guidedTour = profileQuery.data.tour_state.guided_tour;
    const target =
      guidedTour.status === "in_progress"
        ? guidedTourStopPath(GUIDED_TOUR_STOPS[guidedTour.step_index], locale)
        : `/${locale}/dashboard`;
    return <Navigate to={target} replace />;
  }

  async function choose(choice: WelcomeTourChoice) {
    // Await, don't fire-and-forget: navigating before the profile cache's
    // tour_state is patched would send RequireAuth right back here for one
    // more render (it still reads welcome_seen: false from the stale cache).
    await updateTour.mutateAsync({ welcome_seen: true, guided_tour_choice: choice });
    if (choice === "tour") {
      navigate(guidedTourStopPath(GUIDED_TOUR_STOPS[0], locale), { replace: true });
    } else {
      navigate(`/${locale}/dashboard`, { replace: true });
    }
  }

  if (step === CHOICE_STEP) {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center bg-background px-4 py-8">
        <div className="flex w-full max-w-md flex-col items-center gap-6 rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
          <BrandMark />
          <div className="space-y-2">
            <h1 className="text-xl font-bold tracking-tight">{t("Welcome.choiceTitle")}</h1>
            <p className="text-sm leading-relaxed text-muted-foreground">{t("Welcome.choiceBody")}</p>
          </div>
          <div className="flex w-full flex-col gap-2.5">
            <Button type="button" size="lg" onClick={() => choose("tour")} disabled={updateTour.isPending}>
              <Compass className="size-4" aria-hidden /> {t("Welcome.choiceTakeTour")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="lg"
              onClick={() => choose("skip")}
              disabled={updateTour.isPending}
            >
              <MapPinned className="size-4" aria-hidden /> {t("Welcome.choiceSkip")}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const slide = step;
  const Icon = SLIDE_ICONS[slide];
  const isLast = slide === TOTAL_SLIDES - 1;

  return (
    <div className="flex min-h-svh flex-col bg-background px-4 py-8">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col">
        <div className="mb-6 flex items-center justify-between">
          <BrandMark />
          <Button type="button" variant="ghost" size="sm" onClick={() => setStep(CHOICE_STEP)}>
            {t("Welcome.skip")}
          </Button>
        </div>

        <div className="mb-6 flex items-center gap-2" aria-hidden>
          {Array.from({ length: TOTAL_SLIDES }, (_, i) => (
            <span
              key={i}
              className={cn("h-1.5 flex-1 rounded-full transition-colors", i <= slide ? "bg-primary" : "bg-border")}
            />
          ))}
        </div>

        <div className="flex flex-1 flex-col items-center justify-center gap-5 rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
          <span className="flex size-16 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Icon className="size-8" aria-hidden />
          </span>
          <div className="space-y-2">
            <h1 className="text-xl font-bold tracking-tight">{t(`Welcome.slide${slide + 1}Title`)}</h1>
            <p className="text-sm leading-relaxed text-muted-foreground">{t(`Welcome.slide${slide + 1}Body`)}</p>
          </div>
        </div>

        <div className="mt-6 flex justify-end">
          {isLast ? (
            <Button type="button" onClick={() => setStep(CHOICE_STEP)}>
              {t("Welcome.next")} <ArrowRight className="size-4" />
            </Button>
          ) : (
            <Button type="button" onClick={() => setStep((s) => (typeof s === "number" ? s + 1 : s))}>
              {t("Welcome.next")} <ArrowRight className="size-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
