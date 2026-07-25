import { useParams } from "react-router";
import { PageHeader } from "@/components/ui-x/page-header";
import { useAuth } from "@/providers/auth-provider";
import { useSukoonLanguage } from "@/sukoon/lib/use-sukoon-language";
import { useTrackSukoonFeatureView } from "@/sukoon/lib/use-sukoon-analytics";
import { SignInPrompt } from "@/sukoon/components/journal/journal-ui";
import { SukoonFeedbackWidget } from "@/sukoon/components/sukoon-feedback-widget";
import { NotTherapyFooter } from "@/sukoon/components/not-therapy-footer";

/**
 * Session 14 — general app feedback (the beta banner's link, also reachable
 * from You → Settings). Reuses the same widget every other feedback surface
 * uses, in its "full" variant (target_type: "general", no target_id).
 */
export function Component() {
  const { t } = useSukoonLanguage();
  const { session, loading: authLoading } = useAuth();
  useTrackSukoonFeatureView("feedback");
  const { locale } = useParams<{ locale?: string }>();

  if (authLoading) return null;

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-6">
      <PageHeader title={t("Sukoon.feedback.pageTitle")} description={t("Sukoon.feedback.pageSub")} />
      {!session ? (
        <SignInPrompt locale={locale} />
      ) : (
        <SukoonFeedbackWidget
          targetType="general"
          variant="full"
          prompt={t("Sukoon.feedback.generalPrompt")}
          className="rounded-2xl border border-border bg-card p-4"
        />
      )}
      <NotTherapyFooter />
    </div>
  );
}
