/**
 * Sukoon F11 — Settings' per-type notification-reminder toggles (You page).
 * Reads/writes the same profile the rest of Settings already uses — a toggle
 * flip is a plain PATCH /profile, same as any other profile field.
 */
import { Switch } from "@/components/ui/switch";
import { SectionCard } from "@/components/ui-x/section-card";
import { useSukoonLanguage } from "@/sukoon/lib/use-sukoon-language";
import { useSukoonProfile, useUpdateSukoonProfile } from "@/sukoon/lib/use-sukoon-profile";

type PrefKey = "mood_reminder_enabled" | "journey_reminder_enabled" | "exam_eve_reminder_enabled";

const ROWS: { key: PrefKey; labelKey: string; descKey: string }[] = [
  {
    key: "mood_reminder_enabled",
    labelKey: "Sukoon.notifications.moodReminder",
    descKey: "Sukoon.notifications.moodReminderDesc",
  },
  {
    key: "journey_reminder_enabled",
    labelKey: "Sukoon.notifications.journeyReminder",
    descKey: "Sukoon.notifications.journeyReminderDesc",
  },
  {
    key: "exam_eve_reminder_enabled",
    labelKey: "Sukoon.notifications.examEve",
    descKey: "Sukoon.notifications.examEveDesc",
  },
];

export function NotificationPrefsCard() {
  const { t } = useSukoonLanguage();
  const profileQuery = useSukoonProfile();
  const updateProfile = useUpdateSukoonProfile();
  const profile = profileQuery.data?.profile;

  if (!profile) return null;

  return (
    <SectionCard title={t("Sukoon.notifications.title")} description={t("Sukoon.notifications.subtitle")}>
      <div className="flex flex-col divide-y divide-border">
        {ROWS.map((row) => (
          <div key={row.key} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-sm font-medium text-foreground">{t(row.labelKey)}</span>
              <span className="text-xs text-muted-foreground">{t(row.descKey)}</span>
            </div>
            <Switch
              checked={profile[row.key]}
              disabled={updateProfile.isPending}
              onCheckedChange={(checked) => updateProfile.mutate({ [row.key]: checked })}
              aria-label={t(row.labelKey)}
            />
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{t("Sukoon.notifications.quietHoursNote")}</p>
    </SectionCard>
  );
}
