import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Bell, BellOff, BellRing } from "lucide-react";
import type { PushPreferences } from "@prayasup/shared";
import { SectionCard } from "@/components/ui-x/section-card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { usePushStatus, useEnablePush, useDisablePush, useUpdatePushPreferences } from "@/hooks/use-push";
import { isPushSupported, notificationPermission } from "@/lib/push-client";

const TYPES: { key: keyof PushPreferences; labelKey: string }[] = [
  { key: "quiz_ready", labelKey: "Pwa.prefQuizReady" },
  { key: "srs_due", labelKey: "Pwa.prefSrsDue" },
  { key: "streak_at_risk", labelKey: "Pwa.prefStreakAtRisk" },
];

export function PushNotificationsCard() {
  const { t } = useTranslation();
  const { data: status } = usePushStatus();
  const enable = useEnablePush();
  const disable = useDisablePush();
  const updatePrefs = useUpdatePushPreferences();
  const [showPrePrompt, setShowPrePrompt] = useState(false);

  if (!isPushSupported()) return null;
  const permission = notificationPermission();

  return (
    <SectionCard title={t("Pwa.settingsTitle")} description={t("Pwa.settingsDescription")}>
      {permission === "denied" ? (
        <p className="rounded-lg border border-coral/30 bg-coral/5 p-3 text-sm text-muted-foreground">
          {t("Pwa.blockedHint")}
        </p>
      ) : status?.subscribed ? (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
            <span className="flex items-center gap-2 text-sm font-medium text-tulsi-foreground">
              <BellRing className="size-4" aria-hidden />
              {t("Pwa.enabled")}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => disable.mutate()}
              disabled={disable.isPending}
              className="gap-2"
            >
              <BellOff className="size-4" aria-hidden />
              {t("Pwa.turnOff")}
            </Button>
          </div>
          <div className="flex flex-col gap-2">
            {TYPES.map(({ key, labelKey }) => (
              <label
                key={key}
                className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm"
              >
                <span>{t(labelKey)}</span>
                <Switch
                  checked={status.preferences[key]}
                  onCheckedChange={(checked) => updatePrefs.mutate({ [key]: checked })}
                />
              </label>
            ))}
          </div>
        </div>
      ) : showPrePrompt ? (
        <div className="flex flex-col gap-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
          <p className="text-sm text-foreground">{t("Pwa.prePromptBody")}</p>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              onClick={() => enable.mutate()}
              disabled={enable.isPending}
              className="gap-2"
            >
              <Bell className="size-4" aria-hidden />
              {t("Pwa.enableButton")}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setShowPrePrompt(false)}>
              {t("Pwa.notNow")}
            </Button>
          </div>
          {enable.isError && <p className="text-xs text-destructive">{t("Pwa.enableError")}</p>}
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
          <span className="flex items-center gap-2 text-sm">
            <Bell className="size-4 text-muted-foreground" aria-hidden />
            {t("Pwa.disabledHint")}
          </span>
          <Button type="button" variant="outline" size="sm" onClick={() => setShowPrePrompt(true)}>
            {t("Pwa.enableButton")}
          </Button>
        </div>
      )}
    </SectionCard>
  );
}
