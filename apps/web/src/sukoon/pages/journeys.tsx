/**
 * F7 — Guided Journeys catalog: exam-stress programs, each a multi-day mix of
 * psychoeducation, an exercise, a journal prompt, and a Saathi check-in.
 */
import { useParams } from "react-router";
import { Milestone } from "lucide-react";
import { PageHeader } from "@/components/ui-x/page-header";
import { EmptyState } from "@/components/ui-x/empty-state";
import { Skeleton } from "@/components/ui-x/skeleton";
import { useAuth } from "@/providers/auth-provider";
import { useSukoonLanguage } from "@/sukoon/lib/use-sukoon-language";
import { useJourneys } from "@/sukoon/lib/use-sukoon-journeys";
import { SignInPrompt } from "@/sukoon/components/journal/journal-ui";
import { JourneyCard } from "@/sukoon/components/journeys/journey-card";

export function Component() {
  const { t } = useSukoonLanguage();
  const { session, loading: authLoading } = useAuth();
  const { locale } = useParams<{ locale?: string }>();
  const base = locale ? `/${locale}/sukoon` : "";

  const query = useJourneys({ enabled: !!session });

  if (authLoading) return null;
  if (!session) return <SignInPrompt locale={locale} />;

  const journeys = query.data?.journeys ?? [];

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <PageHeader title={t("Sukoon.journeys.title")} description={t("Sukoon.journeys.subtitle")} />

      {query.isLoading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-2xl" />
          ))}
        </div>
      ) : query.isError ? (
        <EmptyState
          icon={Milestone}
          title={t("Sukoon.tools.loadErrorTitle")}
          description={t("Sukoon.tools.loadErrorBody")}
        />
      ) : journeys.length === 0 ? (
        <EmptyState icon={Milestone} title={t("Sukoon.journeys.emptyTitle")} description={t("Sukoon.journeys.emptyBody")} />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {journeys.map((journey) => (
            <JourneyCard key={journey.id} journey={journey} base={base} />
          ))}
        </div>
      )}
    </div>
  );
}
