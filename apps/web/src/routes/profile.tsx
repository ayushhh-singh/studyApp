import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { User } from "lucide-react";
import type { Locale, ProfileUpdateBody } from "@prayasup/shared";
import { PageHeader } from "@/components/ui-x/page-header";
import { SectionCard } from "@/components/ui-x/section-card";
import { StatCard } from "@/components/ui-x/stat-card";
import { StatCardSkeleton } from "@/components/ui-x/skeleton";
import { Button } from "@/components/ui/button";
import { useProfile, useUpdateProfile } from "@/hooks/use-profile";

export const handle = { titleKey: "Nav.profile" };

const INPUT_CLASS =
  "min-h-11 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function Component() {
  const { t } = useTranslation();
  const { data: profile, isLoading } = useProfile();
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
    <div className="flex flex-col gap-6">
      <PageHeader title={t("Profile.title")} description={t("Profile.description")} />

      <div className="grid grid-cols-2 gap-3 sm:max-w-md">
        {isLoading || !profile ? (
          <>
            <StatCardSkeleton />
            <StatCardSkeleton />
          </>
        ) : (
          <>
            <StatCard label={t("Profile.plan")} value={profile.plan.toUpperCase()} icon={User} />
            <StatCard label={t("Profile.streak")} value={profile.streak_count} />
          </>
        )}
      </div>

      <SectionCard title={t("Profile.settings")} className="max-w-md">
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
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

          <Button type="submit" disabled={updateProfile.isPending} className="self-start">
            {updateProfile.isPending ? t("Profile.saving") : t("Profile.save")}
          </Button>

          {updateProfile.isSuccess && <p className="text-sm text-tulsi-foreground">{t("Profile.saved")}</p>}
          {updateProfile.isError && (
            <p className="text-sm text-destructive">{updateProfile.error.message}</p>
          )}
        </form>
      </SectionCard>
    </div>
  );
}
