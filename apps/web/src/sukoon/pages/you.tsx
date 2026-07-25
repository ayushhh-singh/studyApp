import { ShieldCheck, Lock, Info, MessageSquareHeart, LifeBuoy } from "lucide-react";
import { Link, useParams } from "react-router";
import { PageHeader } from "@/components/ui-x/page-header";
import { useAuth } from "@/providers/auth-provider";
import { useSukoonLanguage } from "@/sukoon/lib/use-sukoon-language";
import { useTrackSukoonFeatureView } from "@/sukoon/lib/use-sukoon-analytics";
import { SignInPrompt } from "@/sukoon/components/journal/journal-ui";
import { MoodTrends } from "@/sukoon/components/mood-trends";
import { useSukoonAdminStatus } from "@/sukoon/lib/use-sukoon-admin-journeys";
import { NotificationPrefsCard } from "@/sukoon/components/settings/notification-prefs-card";
import { InsightsPrefsCard } from "@/sukoon/components/settings/insights-prefs-card";
import { SubscriptionCard } from "@/sukoon/components/you/subscription-card";
import { CheckinCard } from "@/sukoon/components/checkin/checkin-card";
import { CheckinTrendCard } from "@/sukoon/components/checkin/checkin-trend-card";
import { InsightsFeed } from "@/sukoon/components/insights/insights-feed";

export function Component() {
  const { t } = useSukoonLanguage();
  const { session, loading: authLoading } = useAuth();
  useTrackSukoonFeatureView("you");
  const { locale } = useParams<{ locale?: string }>();
  const base = locale ? `/${locale}/sukoon` : "";
  const adminStatus = useSukoonAdminStatus({ enabled: !!session });

  // `session` starts null until the initial getSession() resolves — checking
  // `!session` alone (without `authLoading`) would flash SignInPrompt at a
  // signed-in user on every page load, before it flips to the real content.
  if (authLoading) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        <PageHeader title={t("Sukoon.youTitle")} description={t("Sukoon.youSub")} />
        <div className="h-40 animate-pulse rounded-xl bg-muted" />
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <PageHeader title={t("Sukoon.youTitle")} description={t("Sukoon.youSub")} />
      {!session ? (
        <SignInPrompt locale={locale} />
      ) : (
        <>
          <SubscriptionCard />
          <CheckinCard />
          <InsightsFeed />
          <MoodTrends />
          <CheckinTrendCard />
          <InsightsPrefsCard />
          <NotificationPrefsCard />
          <Link
            to={`${base}/you/privacy`}
            className="flex items-center gap-2 rounded-2xl border border-border bg-card px-4 py-3 text-sm font-medium text-foreground transition-colors duration-300 hover:border-secondary/50"
          >
            <Lock className="size-4 text-secondary" aria-hidden />
            {t("Sukoon.privacy.navLink")}
          </Link>
          <Link
            to={`${base}/you/support`}
            className="flex items-center gap-2 rounded-2xl border border-border bg-card px-4 py-3 text-sm font-medium text-foreground transition-colors duration-300 hover:border-secondary/50"
          >
            <LifeBuoy className="size-4 text-secondary" aria-hidden />
            {t("Sukoon.support.navLink")}
          </Link>
          <Link
            to={`${base}/you/about`}
            className="flex items-center gap-2 rounded-2xl border border-border bg-card px-4 py-3 text-sm font-medium text-foreground transition-colors duration-300 hover:border-secondary/50"
          >
            <Info className="size-4 text-secondary" aria-hidden />
            {t("Sukoon.about.navLink")}
          </Link>
          <Link
            to={`${base}/feedback`}
            className="flex items-center gap-2 rounded-2xl border border-border bg-card px-4 py-3 text-sm font-medium text-foreground transition-colors duration-300 hover:border-secondary/50"
          >
            <MessageSquareHeart className="size-4 text-secondary" aria-hidden />
            {t("Sukoon.feedback.navLink")}
          </Link>
          {adminStatus.data?.is_admin ? (
            <>
              <Link
                to={`${base}/admin/journeys`}
                className="flex items-center gap-2 rounded-2xl border border-border bg-card px-4 py-3 text-sm font-medium text-foreground transition-colors duration-300 hover:border-secondary/50"
              >
                <ShieldCheck className="size-4 text-secondary" aria-hidden />
                {t("Sukoon.admin.journeys.navLink")}
              </Link>
              <Link
                to={`${base}/admin/feedback`}
                className="flex items-center gap-2 rounded-2xl border border-border bg-card px-4 py-3 text-sm font-medium text-foreground transition-colors duration-300 hover:border-secondary/50"
              >
                <ShieldCheck className="size-4 text-secondary" aria-hidden />
                {t("Sukoon.admin.feedback.navLink")}
              </Link>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
