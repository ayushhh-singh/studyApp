import { CircleUser } from "lucide-react";
import { useParams } from "react-router";
import { PageHeader } from "@/components/ui-x/page-header";
import { EmptyState } from "@/components/ui-x/empty-state";
import { useAuth } from "@/providers/auth-provider";
import { useSukoonLanguage } from "@/sukoon/lib/use-sukoon-language";
import { SignInPrompt } from "@/sukoon/components/journal/journal-ui";
import { MoodTrends } from "@/sukoon/components/mood-trends";

export function Component() {
  const { t } = useSukoonLanguage();
  const { session, loading: authLoading } = useAuth();
  const { locale } = useParams<{ locale?: string }>();

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
          <MoodTrends />
          <EmptyState
            icon={CircleUser}
            title={t("Sukoon.comingSoonTitle")}
            description={t("Sukoon.youComingSoon")}
          />
        </>
      )}
    </div>
  );
}
