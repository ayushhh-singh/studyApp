import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/ui-x/page-header";
import { ActivityHeatmapCard } from "@/components/dashboard/activity-heatmap-card";
import { ProfileCard } from "@/components/profile/profile-card";
import { AnalyticsTeaserCard } from "@/components/profile/analytics-teaser-card";
import { ScoreTrajectoryCard } from "@/components/profile/score-trajectory-card";
import { AccuracyTimeCard } from "@/components/profile/accuracy-time-card";
import { StrengthWeaknessCard } from "@/components/profile/strength-weakness-card";
import { WritingProgressCard } from "@/components/profile/writing-progress-card";
import { ImprovementProofCard } from "@/components/profile/improvement-proof-card";
import { MicroDrillsCard } from "@/components/profile/micro-drills-card";
import { MyRanksCard } from "@/components/profile/my-ranks-card";
import { SettingsCard } from "@/components/profile/settings-card";
import { ChangePasswordCard } from "@/components/profile/change-password-card";
import { PushNotificationsCard } from "@/components/profile/push-notifications-card";
import { HelpAboutCard } from "@/components/profile/help-about-card";
import { PlanBanner } from "@/components/billing/plan-banner";
import { useProfile } from "@/hooks/use-profile";
import { useProfileAnalytics } from "@/hooks/use-profile-analytics";

export const handle = { titleKey: "Nav.profile" };

export function Component() {
  const { t } = useTranslation();
  const { data: profile, isLoading: profileLoading } = useProfile();
  const { data: analytics, isLoading: analyticsLoading } = useProfileAnalytics();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("Profile.title")} description={t("Profile.description")} />

      <ProfileCard profile={profile} isLoading={profileLoading} />

      <PlanBanner />

      <AnalyticsTeaserCard analytics={analytics} isLoading={analyticsLoading} />

      <h2 className="text-lg font-bold tracking-tight">{t("Profile.helpSectionTitle")}</h2>

      <HelpAboutCard />

      <h2 id="profile-analytics" className="scroll-mt-20 text-lg font-bold tracking-tight">
        {t("Profile.analyticsSectionTitle")}
      </h2>

      <ActivityHeatmapCard weeks={26} />

      <ScoreTrajectoryCard data={analytics?.score_trajectory} isLoading={analyticsLoading} />

      <AccuracyTimeCard data={analytics?.accuracy_time_buckets} isLoading={analyticsLoading} />

      <StrengthWeaknessCard />

      <WritingProgressCard
        trend={analytics?.evaluation_trend}
        insights={analytics?.dimension_insights}
        isLoading={analyticsLoading}
      />

      <ImprovementProofCard
        items={analytics?.improvement_proof.items}
        avgDeltaPct={analytics?.improvement_proof.avg_delta_pct}
        isLoading={analyticsLoading}
      />

      <MyRanksCard />

      <h2 className="text-lg font-bold tracking-tight">{t("Profile.growthSectionTitle")}</h2>

      <MicroDrillsCard />

      <h2 className="text-lg font-bold tracking-tight">{t("Profile.settingsSectionTitle")}</h2>

      <SettingsCard />

      <ChangePasswordCard />

      <PushNotificationsCard />
    </div>
  );
}
