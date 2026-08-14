import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { User } from "lucide-react";
import { handleSchema, type Locale, type Profile, type ProfileUpdateBody } from "@neev/shared";
import { SectionCard } from "@/components/ui-x/section-card";
import { StreakFlame } from "@/components/ui-x/streak-flame";
import { FreezePips } from "@/components/ui-x/freeze-pips";
import { ExamCountdownChip } from "@/components/dashboard/exam-countdown-chip";
import { Button } from "@/components/ui/button";
import { useUpdateProfile } from "@/hooks/use-profile";
import { cn } from "@/lib/utils";

const INPUT_CLASS =
  "min-h-11 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * People type "@ayush", "Ayush", "ayush singh" — all of which `handleSchema`
 * rejects. Normalising as they type turns three guaranteed validation failures
 * into no failure at all, and leaves the schema as the single source of truth
 * for what is actually legal.
 */
function normalizeHandle(raw: string): string {
  return raw.trim().replace(/^@+/, "").toLowerCase();
}

export function ProfileCard({ profile, isLoading }: { profile: Profile | undefined; isLoading: boolean }) {
  const { t } = useTranslation();
  const updateProfile = useUpdateProfile();

  const [displayName, setDisplayName] = useState("");
  const [handle, setHandle] = useState("");
  const [targetYear, setTargetYear] = useState("");
  const [medium, setMedium] = useState<Locale>("en");

  useEffect(() => {
    if (!profile) return;
    setDisplayName(profile.display_name ?? "");
    setHandle(profile.handle ?? "");
    setTargetYear(profile.target_exam_year ? String(profile.target_exam_year) : "");
    setMedium(profile.medium);
  }, [profile]);

  // Empty is legal — it means "no handle", i.e. appear as Anonymous. Only a
  // non-empty value has to satisfy the shared rule.
  const handleValid = handle === "" || handleSchema.safeParse(handle).success;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!handleValid) return;
    const body: ProfileUpdateBody = { medium };
    if (displayName.trim()) body.display_name = displayName.trim();
    const year = Number(targetYear);
    if (targetYear && Number.isInteger(year)) body.target_exam_year = year;
    // Send `handle` only when it actually changed. Sending it on every save
    // would make an unrelated edit (medium, target year) collide with someone
    // who took the handle in between, failing a save that had nothing to do
    // with it. `null` is the explicit "clear it" signal the PATCH schema
    // documents; `undefined` would mean "leave it alone".
    const nextHandle = handle === "" ? null : handle;
    if (nextHandle !== (profile?.handle ?? null)) body.handle = nextHandle;
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
              {/* The profile now carries the dashboard's own shape, so the chip is fed
                  directly — no adapter to get exam_stage or is_tentative wrong. */}
              <ExamCountdownChip exam={profile.next_exam} />
              <span
                className={cn(
                  "inline-flex h-9 items-center rounded-full px-3 text-xs font-bold uppercase tracking-wide",
                  // Max gets the primary treatment and Pro keeps marigold, so
                  // the two paid tiers are distinguishable at a glance rather
                  // than Max silently rendering as "Free".
                  profile.plan === "max"
                    ? "bg-primary/15 text-primary"
                    : profile.plan === "pro"
                      ? "bg-marigold/15 text-marigold-foreground"
                      : "bg-muted text-muted-foreground",
                )}
              >
                {t(
                  profile.plan === "max"
                    ? "Profile.planMax"
                    : profile.plan === "pro"
                      ? "Profile.planPro"
                      : "Profile.planFree",
                )}
              </span>
            </div>
          )}
          {isLoading && !profile && <div className="h-9 w-64 animate-pulse rounded-full bg-muted" />}
        </div>

        <form className="flex flex-col gap-4 border-t border-border pt-5" onSubmit={handleSubmit}>
          <h3 className="text-sm font-semibold">{t("Profile.editProfileTitle")}</h3>
          <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
              {t("Profile.handle")}
              <input
                className={cn(INPUT_CLASS, !handleValid && "border-destructive")}
                value={handle}
                onChange={(e) => setHandle(normalizeHandle(e.target.value))}
                placeholder={t("Profile.handlePlaceholder")}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                aria-invalid={!handleValid}
                aria-describedby="profile-handle-hint"
              />
              {/* Always visible, never only-on-error: a field called "Handle"
                  means nothing on its own, and a rule you only learn by
                  breaking it is a bad rule to hide. Same reasoning as the
                  password-strength hint added in the auth-gap session. */}
              <span id="profile-handle-hint" className="text-xs font-normal text-muted-foreground">
                {handleValid ? t("Profile.handleHint") : t("Profile.handleInvalid")}
              </span>
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

          <Button type="submit" disabled={updateProfile.isPending || !handleValid} className="self-start">
            {updateProfile.isPending ? t("Profile.saving") : t("Profile.save")}
          </Button>

          {updateProfile.isSuccess && <p className="text-sm text-tulsi-foreground">{t("Profile.saved")}</p>}
          {updateProfile.isError && <p className="text-sm text-destructive">{updateProfile.error.message}</p>}
        </form>
      </div>
    </SectionCard>
  );
}
