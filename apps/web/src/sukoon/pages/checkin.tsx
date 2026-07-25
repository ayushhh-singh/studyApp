/**
 * F8 check-in page — /sukoon/checkin/:type (who5 | stress_self_check). A calm,
 * focused, full-width flow (like a journey step). Auth-gated; an unknown type
 * redirects home rather than rendering a broken form.
 */
import { Navigate, useParams } from "react-router";
import { sukoonCheckinTypeSchema } from "@neev/shared";
import { PageHeader } from "@/components/ui-x/page-header";
import { useAuth } from "@/providers/auth-provider";
import { useSukoonLanguage } from "@/sukoon/lib/use-sukoon-language";
import { useTrackSukoonFeatureView } from "@/sukoon/lib/use-sukoon-analytics";
import { SignInPrompt } from "@/sukoon/components/journal/journal-ui";
import { CheckinFlow } from "@/sukoon/components/checkin/checkin-flow";

export function Component() {
  const { t } = useSukoonLanguage();
  const { session, loading: authLoading } = useAuth();
  useTrackSukoonFeatureView("checkin");
  const { locale, type } = useParams<{ locale?: string; type?: string }>();
  const base = locale ? `/${locale}/sukoon` : "";

  const parsed = sukoonCheckinTypeSchema.safeParse(type);
  if (!parsed.success) return <Navigate to={base || "/"} replace />;
  const checkinType = parsed.data;

  if (authLoading) return null;
  if (!session) return <SignInPrompt locale={locale} />;

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-5">
      <PageHeader
        title={t(`Sukoon.checkin.title.${checkinType}`)}
        description={t(`Sukoon.checkin.subtitle.${checkinType}`)}
      />
      <CheckinFlow type={checkinType} />
    </div>
  );
}
