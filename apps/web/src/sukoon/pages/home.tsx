import { Sparkles } from "lucide-react";
import { PageHeader } from "@/components/ui-x/page-header";
import { EmptyState } from "@/components/ui-x/empty-state";
import { useSukoonLanguage } from "@/sukoon/lib/use-sukoon-language";
import { useAuth } from "@/providers/auth-provider";
import { MoodHomeCard } from "@/sukoon/components/mood-home-card";
import { ExamEveJourneyCard } from "@/sukoon/components/journeys/exam-eve-journey-card";
import { JourneysHomeCard } from "@/sukoon/components/journeys/journeys-home-card";
import { SukoonGardenCard } from "@/sukoon/components/garden/sukoon-garden-card";

export function Component() {
  const { t } = useSukoonLanguage();
  const { session } = useAuth();
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <PageHeader title={t("Sukoon.homeTitle")} description={t("Sukoon.homeSub")} />
      {session ? <ExamEveJourneyCard /> : null}
      {session ? <MoodHomeCard /> : null}
      {session ? <SukoonGardenCard /> : null}
      {session ? <JourneysHomeCard /> : null}
      <EmptyState
        icon={Sparkles}
        title={t("Sukoon.comingSoonTitle")}
        description={t("Sukoon.homeComingSoon")}
      />
    </div>
  );
}
