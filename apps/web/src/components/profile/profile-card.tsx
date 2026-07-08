import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { User } from "lucide-react";
import type { DashboardNextExam, Locale, Profile, ProfileUpdateBody } from "@prayasup/shared";
import { SectionCard } from "@/components/ui-x/section-card";
import { StreakFlame } from "@/components/ui-x/streak-flame";
import { FreezePips } from "@/components/ui-x/freeze-pips";
import { ExamCountdownChip } from "@/components/dashboard/exam-countdown-chip";
import { Button } from "@/components/ui/button";
import { useUpdateProfile } from "@/hooks/use-profile";
import { cn } from "@/lib/utils";

const INPUT_CLASS =
  "min-h-11 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Profile carries a flatter {days_to_exam, next_exam_label_i18n} shape than the
 * dashboard's DashboardNextExam — adapt it so both pages share one chip component
 * instead of two near-identical countdown renderers drifting apart over time. */
function toDashboardNextExam(profile: Profile): DashboardNextExam {
  if (profile.days_to_exam === null || !profile.next_exam_label_i18n) return null;
  return {
    exam_stage: "prelims",
    title_i18n: profile.next_exam_label_i18n,
    exam_date: "",
    days_until: profile.days_to_exam,
    is_tentative: false,
  };
}

export function ProfileCard({ profile, isLoading }: { profile: Profile | undefined; isLoading: boolean }) {
  const { t } = useTranslation();
  const updateProfile = useUpdateProfile();

  const [displayName, setDisplayName] = useState("");
  const [targetYear, setTargetYear] = useState("");
  const [medium, setMedium] = useState<Locale>("en");

  useEffect(() => {
    if (!profile) return;
    setDisplayName(profile.display_name ?? "");
    setTargetYear(profile.target_exam_year ? String(profile.target_exam_year) : "");
    setMedium(profile.medium);
  }, [profile]);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const body: ProfileUpdateBody = { medium };
    if (displayName.trim()) body.display_name = displayName.trim();
    const year = Number(targetYear);
    if (targetYear && Number.isInteger(year)) body.target_exam_year = year;
    updateProfile.mutate(body);
  }

  return (
    <SectionCard>
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <User className="size-6" aria-hidden />
            </span>
            <div className="flex flex-col gap-0.5">
              <span className="text-lg font-semibold">
                {profile?.display_name || t("Profile.namelessFallback")}
              </span>
              {profile?.target_exam_year && (
                <span className="text-xs text-muted-foreground">
                  {t("Profile.targetYearInline", { year: profile.target_exam_year })}
                </span>
              )}
            </div>
          </div>
          {profile && (
            <div className="flex flex-wrap items-center gap-2">
              <StreakFlame count={profile.streak_count} />
              <FreezePips count={profile.streak_freezes} />
              <ExamCountdownChip exam={toDashboardNextExam(profile)} />
              <span
                className={cn(
                  "inline-flex h-9 items-center rounded-full px-3 text-xs font-bold uppercase tracking-wide",
                  profile.plan === "pro"
                    ? "bg-marigold/15 text-marigold-foreground"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {t(profile.plan === "pro" ? "Profile.planPro" : "Profile.planFree")}
              </span>
            </div>
          )}
          {isLoading && !profile && <div className="h-9 w-64 animate-pulse rounded-full bg-muted" />}
        </div>

        <form className="flex flex-col gap-4 border-t border-border pt-5" onSubmit={handleSubmit}>
          <h3 className="text-sm font-semibold">{t("Profile.editProfileTitle")}</h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              {t("Profile.displayName")}
              <input
                className={INPUT_CLASS}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder={t("Profile.displayNamePlaceholder")}
              />
            </label>

            <label className="flex flex-col gap-1.5 text-sm font-medium">
              {t("Profile.targetYear")}
              <input
                className={INPUT_CLASS}
                type="number"
                min={2000}
                max={2100}
                value={targetYear}
                onChange={(e) => setTargetYear(e.target.value)}
                placeholder={t("Profile.targetYearPlaceholder")}
              />
            </label>

            <label className="flex flex-col gap-1.5 text-sm font-medium">
              {t("Profile.medium")}
              <select className={INPUT_CLASS} value={medium} onChange={(e) => setMedium(e.target.value as Locale)}>
                <option value="hi">{t("Profile.mediumHi")}</option>
                <option value="en">{t("Profile.mediumEn")}</option>
              </select>
            </label>
          </div>

          <Button type="submit" disabled={updateProfile.isPending} className="self-start">
            {updateProfile.isPending ? t("Profile.saving") : t("Profile.save")}
          </Button>

          {updateProfile.isSuccess && <p className="text-sm text-tulsi-foreground">{t("Profile.saved")}</p>}
          {updateProfile.isError && <p className="text-sm text-destructive">{updateProfile.error.message}</p>}
        </form>
      </div>
    </SectionCard>
  );
}
