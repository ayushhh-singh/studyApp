import { useState } from "react";
import { Navigate, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { ArrowRight, Check, Flame, Languages, PenSquare } from "lucide-react";
import { useProfile } from "@/hooks/use-profile";
import { useUpdateTourState } from "@/hooks/use-tour";
import { useLocale } from "@/hooks/use-locale";
import { Button } from "@/components/ui/button";
import { BrandMark } from "@/components/marketing/brand-mark";
import { FullScreenLoader, ProfileLoadError } from "@/routes/require-auth";
import { cn } from "@/lib/utils";

const TOTAL_SLIDES = 3;
const SLIDE_ICONS = [PenSquare, Languages, Flame];

/**
 * The tour's welcome moment (layer 2) — 2-3 skippable value-prop screens shown
 * exactly once, between the onboarding wizard and the Dashboard (see
 * require-auth.tsx's welcome_seen redirect). No permission prompts here —
 * that's a deliberate constraint, not an oversight.
 */
export function Component() {
  const { t } = useTranslation();
  const locale = useLocale();
  const navigate = useNavigate();
  const profileQuery = useProfile();
  const updateTour = useUpdateTourState();
  const [slide, setSlide] = useState(0);

  if (profileQuery.isPending) return <FullScreenLoader />;
  if (profileQuery.isError) return <ProfileLoadError onRetry={() => profileQuery.refetch()} />;
  if (!profileQuery.data?.onboarding_completed) return <Navigate to={`/${locale}/onboarding`} replace />;
  if (profileQuery.data.tour_state.welcome_seen) return <Navigate to={`/${locale}/dashboard`} replace />;

  async function finish() {
    // Await, don't fire-and-forget: navigating before the profile cache's
    // tour_state is patched would send RequireAuth right back here for one
    // more render (it still reads welcome_seen: false from the stale cache).
    await updateTour.mutateAsync({ welcome_seen: true });
    navigate(`/${locale}/dashboard`, { replace: true });
  }

  const Icon = SLIDE_ICONS[slide];
  const isLast = slide === TOTAL_SLIDES - 1;

  return (
    <div className="flex min-h-svh flex-col bg-background px-4 py-8">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col">
        <div className="mb-6 flex items-center justify-between">
          <BrandMark />
          <Button type="button" variant="ghost" size="sm" onClick={finish}>
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
            <Button type="button" onClick={finish}>
              <Check className="size-4" /> {t("Welcome.getStarted")}
            </Button>
          ) : (
            <Button type="button" onClick={() => setSlide((s) => s + 1)}>
              {t("Welcome.next")} <ArrowRight className="size-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
