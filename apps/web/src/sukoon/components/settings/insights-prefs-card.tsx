/**
 * F9 — Settings toggles for weekly insights (on the You page). Hidden for free
 * (nothing to configure — the InsightsFeed shows them the sample + upsell). Plus
 * sees the on/off toggle; Pro additionally sees the stricter "deep insights"
 * consent (let the reflection read journal entries, not just metadata) with an
 * explicit privacy note. Both are plain PATCH /profile flips.
 */
import { Switch } from "@/components/ui/switch";
import { SectionCard } from "@/components/ui-x/section-card";
import { useSukoonLanguage } from "@/sukoon/lib/use-sukoon-language";
import { useSukoonProfile, useUpdateSukoonProfile } from "@/sukoon/lib/use-sukoon-profile";
import { useInsights } from "@/sukoon/lib/use-sukoon-insights";

export function InsightsPrefsCard() {
  const { t } = useSukoonLanguage();
  const profileQuery = useSukoonProfile();
  const insightsQuery = useInsights();
  const updateProfile = useUpdateSukoonProfile();

  const profile = profileQuery.data?.profile;
  const tier = insightsQuery.data?.tier;
  // Hide entirely for free (nothing to toggle) and until we know the tier.
  if (!profile || !tier || tier === "free") return null;

  return (
    <SectionCard title={t("Sukoon.insights.settingsTitle")} description={t("Sukoon.insights.settingsSub")}>
      <div className="flex flex-col divide-y divide-border">
        <div className="flex items-center justify-between gap-4 py-3 first:pt-0">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-sm font-medium text-foreground">{t("Sukoon.insights.optInLabel")}</span>
            <span className="text-xs text-muted-foreground">{t("Sukoon.insights.optInDesc")}</span>
          </div>
          <Switch
            checked={profile.insights_opt_in}
            disabled={updateProfile.isPending}
            onCheckedChange={(checked) => updateProfile.mutate({ insights_opt_in: checked })}
            aria-label={t("Sukoon.insights.optInLabel")}
          />
        </div>

        {tier === "pro" ? (
          <div className="flex items-center justify-between gap-4 py-3 last:pb-0">
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-sm font-medium text-foreground">{t("Sukoon.insights.deepLabel")}</span>
              <span className="text-xs text-muted-foreground">{t("Sukoon.insights.deepDesc")}</span>
            </div>
            <Switch
              checked={profile.deep_insights_opt_in}
              // Deep insights only apply while weekly insights are on at all.
              disabled={updateProfile.isPending || !profile.insights_opt_in}
              onCheckedChange={(checked) => updateProfile.mutate({ deep_insights_opt_in: checked })}
              aria-label={t("Sukoon.insights.deepLabel")}
            />
          </div>
        ) : null}
      </div>
    </SectionCard>
  );
}
