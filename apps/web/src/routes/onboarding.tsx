import { useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { ArrowLeft, ArrowRight, Check, Loader2, Sparkles } from "lucide-react";
import { handleSchema, type Locale, type OnboardingBody } from "@neev/shared";
import { useAuth } from "@/providers/auth-provider";
import { useProfile, useCompleteOnboarding } from "@/hooks/use-profile";
import { useStudyPlanStream } from "@/hooks/use-study-plan-stream";
import { useLocale } from "@/hooks/use-locale";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BrandMark } from "@/components/marketing/brand-mark";
import { FullScreenLoader, ProfileLoadError } from "@/routes/require-auth";
import { cn } from "@/lib/utils";

const CURRENT_YEAR = 2026;
const YEAR_OPTIONS = [CURRENT_YEAR, CURRENT_YEAR + 1, CURRENT_YEAR + 2];
const HOURS_OPTIONS = [1, 2, 3, 4, 6, 8];
const TOTAL_STEPS = 3;

export function Component() {
  const { t } = useTranslation();
  const locale = useLocale();
  const navigate = useNavigate();
  const { user } = useAuth();
  const profileQuery = useProfile();
  const onboard = useCompleteOnboarding();
  const planStream = useStudyPlanStream();

  const defaultName = useMemo(() => {
    const meta = user?.user_metadata as { full_name?: string; name?: string } | undefined;
    return profileQuery.data?.display_name ?? meta?.full_name ?? meta?.name ?? "";
  }, [user, profileQuery.data]);

  const [step, setStep] = useState(1);
  const [displayName, setDisplayName] = useState("");
  const [handle, setHandle] = useState("");
  const [medium, setMedium] = useState<Locale>(locale);
  const [targetYear, setTargetYear] = useState(CURRENT_YEAR);
  const [hours, setHours] = useState(3);
  const [generatePlan, setGeneratePlan] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<"form" | "generating">("form");

  // Seed the name field once the profile/user metadata resolves.
  const nameValue = displayName || defaultName;

  // isPending, not isLoading — see the identical fix + explanation in
  // routes/require-auth.tsx. Same query key, same underlying gotcha: isLoading
  // can read false for a render or two before real data has actually arrived.
  if (profileQuery.isPending) return <FullScreenLoader />;
  // A failed fetch (429, network blip) isn't "we don't know yet" — without
  // this, an already-onboarded user hitting a rate-limited profile fetch
  // would silently see the onboarding wizard again instead of a clear retry.
  if (profileQuery.isError) return <ProfileLoadError onRetry={() => profileQuery.refetch()} />;
  // Already onboarded (e.g. hit /onboarding directly) → straight to the app.
  if (profileQuery.data?.onboarding_completed) return <Navigate to={`/${locale}/dashboard`} replace />;

  const handleValid = handle === "" || handleSchema.safeParse(handle).success;
  const canSubmit = nameValue.trim().length > 0 && handleValid;

  async function finish() {
    setError(null);
    const body: OnboardingBody = {
      display_name: nameValue.trim(),
      handle: handle || undefined,
      medium,
      preferred_locale: medium,
      target_exam_year: targetYear,
      study_hours_per_day: hours,
    };
    try {
      await onboard.mutateAsync(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Onboarding.error"));
      return;
    }
    if (generatePlan) {
      setPhase("generating");
      planStream.start(hours);
    } else {
      navigate(`/${locale}/dashboard`, { replace: true });
    }
  }

  // Generating phase: wait for the plan stream, then head to the dashboard
  // (also proceed if generation errors — the plan is optional).
  if (phase === "generating") {
    const done = !planStream.isStreaming && (planStream.plan !== null || planStream.error !== null);
    if (done) return <Navigate to={`/${locale}/dashboard`} replace />;
    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-5 bg-background px-6 text-center">
        <Sparkles className="size-8 text-primary" />
        <div className="space-y-1.5">
          <p className="text-lg font-semibold">{t("Onboarding.generatingTitle")}</p>
          <p className="text-sm text-muted-foreground">{planStream.stage ?? t("Onboarding.generatingSub")}</p>
        </div>
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex min-h-svh flex-col bg-background px-4 py-8">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col">
        <BrandMark className="mb-6" />

        {/* Progress */}
        <div className="mb-6 flex items-center gap-2" aria-hidden>
          {Array.from({ length: TOTAL_STEPS }, (_, i) => (
            <span
              key={i}
              className={cn(
                "h-1.5 flex-1 rounded-full transition-colors",
                i < step ? "bg-primary" : "bg-border",
              )}
            />
          ))}
        </div>

        <div className="flex-1 rounded-2xl border border-border bg-card p-6 shadow-sm">
          {step === 1 ? (
            <div className="space-y-5">
              <div className="space-y-1.5">
                <h1 className="text-xl font-bold tracking-tight">{t("Onboarding.step1Title")}</h1>
                <p className="text-sm leading-relaxed text-muted-foreground">{t("Onboarding.step1Sub")}</p>
              </div>
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium">{t("Onboarding.nameLabel")}</span>
                <Input
                  value={nameValue}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder={t("Onboarding.namePlaceholder")}
                  maxLength={120}
                  autoFocus
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium">
                  {t("Onboarding.handleLabel")}{" "}
                  <span className="font-normal text-muted-foreground">{t("Onboarding.optional")}</span>
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">@</span>
                  <Input
                    value={handle}
                    onChange={(e) => setHandle(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
                    placeholder="aspirant_2027"
                    maxLength={20}
                    aria-invalid={!handleValid}
                  />
                </div>
                <span className="mt-1.5 block text-xs text-muted-foreground">{t("Onboarding.handleHint")}</span>
              </label>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="space-y-5">
              <div className="space-y-1.5">
                <h1 className="text-xl font-bold tracking-tight">{t("Onboarding.step2Title")}</h1>
                <p className="text-sm leading-relaxed text-muted-foreground">{t("Onboarding.step2Sub")}</p>
              </div>
              <div>
                <span className="mb-2 block text-sm font-medium">{t("Onboarding.mediumLabel")}</span>
                <div className="grid grid-cols-2 gap-2">
                  {(["hi", "en"] as Locale[]).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMedium(m)}
                      aria-pressed={medium === m}
                      className={cn(
                        "rounded-xl border px-4 py-3 text-left transition-colors",
                        medium === m
                          ? "border-primary bg-primary/10 ring-1 ring-primary"
                          : "border-border hover:bg-accent",
                      )}
                    >
                      <span className="block text-base font-semibold">
                        {m === "hi" ? "हिन्दी" : "English"}
                      </span>
                      <span className="block text-xs text-muted-foreground">{t(`Onboarding.medium_${m}`)}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <span className="mb-2 block text-sm font-medium">{t("Onboarding.targetYearLabel")}</span>
                <div className="grid grid-cols-3 gap-2">
                  {YEAR_OPTIONS.map((y) => (
                    <button
                      key={y}
                      type="button"
                      onClick={() => setTargetYear(y)}
                      aria-pressed={targetYear === y}
                      className={cn(
                        "rounded-xl border px-3 py-2.5 text-center text-base font-semibold tabular-nums transition-colors",
                        targetYear === y
                          ? "border-primary bg-primary/10 ring-1 ring-primary"
                          : "border-border hover:bg-accent",
                      )}
                    >
                      {y}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="space-y-5">
              <div className="space-y-1.5">
                <h1 className="text-xl font-bold tracking-tight">{t("Onboarding.step3Title")}</h1>
                <p className="text-sm leading-relaxed text-muted-foreground">{t("Onboarding.step3Sub")}</p>
              </div>
              <div>
                <span className="mb-2 block text-sm font-medium">{t("Onboarding.hoursLabel")}</span>
                <div className="grid grid-cols-3 gap-2">
                  {HOURS_OPTIONS.map((h) => (
                    <button
                      key={h}
                      type="button"
                      onClick={() => setHours(h)}
                      aria-pressed={hours === h}
                      className={cn(
                        "rounded-xl border px-3 py-2.5 text-center text-base font-semibold tabular-nums transition-colors",
                        hours === h
                          ? "border-primary bg-primary/10 ring-1 ring-primary"
                          : "border-border hover:bg-accent",
                      )}
                    >
                      {t("Onboarding.hoursValue", { count: h })}
                    </button>
                  ))}
                </div>
              </div>
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border p-4">
                <input
                  type="checkbox"
                  checked={generatePlan}
                  onChange={(e) => setGeneratePlan(e.target.checked)}
                  className="mt-0.5 size-4 accent-[var(--primary)]"
                />
                <span>
                  <span className="flex items-center gap-1.5 text-sm font-semibold">
                    <Sparkles className="size-4 text-primary" /> {t("Onboarding.planLabel")}
                  </span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                    {t("Onboarding.planHint")}
                  </span>
                </span>
              </label>
            </div>
          ) : null}

          {error ? (
            <p role="alert" className="mt-4 rounded-lg border border-coral/40 bg-coral/10 px-3 py-2 text-sm text-coral-foreground">
              {error}
            </p>
          ) : null}
        </div>

        {/* Nav */}
        <div className="mt-6 flex items-center justify-between gap-3">
          {step > 1 ? (
            <Button type="button" variant="ghost" onClick={() => setStep((s) => s - 1)}>
              <ArrowLeft className="size-4" /> {t("Onboarding.back")}
            </Button>
          ) : (
            <span />
          )}
          {step < TOTAL_STEPS ? (
            <Button
              type="button"
              onClick={() => setStep((s) => s + 1)}
              disabled={step === 1 && !canSubmit}
            >
              {t("Onboarding.next")} <ArrowRight className="size-4" />
            </Button>
          ) : (
            <Button type="button" onClick={finish} disabled={!canSubmit || onboard.isPending}>
              {onboard.isPending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
              {t("Onboarding.finish")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
