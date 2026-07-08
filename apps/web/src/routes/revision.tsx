import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { Brain, PlayCircle } from "lucide-react";
import { PageHeader } from "@/components/ui-x/page-header";
import { StatCardSkeleton } from "@/components/ui-x/skeleton";
import { EmptyState } from "@/components/ui-x/empty-state";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RevisionStatsHeader } from "@/components/revision/stats-header";
import { RevisionEmptyState } from "@/components/revision/revision-empty-state";
import { ManageCardList } from "@/components/revision/manage-card-list";
import { useSrsStats } from "@/hooks/use-srs";
import { useLocale } from "@/hooks/use-locale";

export const handle = { titleKey: "Nav.revision" };

export function Component() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const locale = useLocale();
  const { data: stats, isLoading } = useSrsStats();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("Revision.title")} description={t("Revision.description")} />

      {isLoading || !stats ? (
        <div className="grid grid-cols-3 gap-3 max-w-lg">
          <StatCardSkeleton />
          <StatCardSkeleton />
          <StatCardSkeleton />
        </div>
      ) : stats.total_cards === 0 ? (
        <RevisionEmptyState />
      ) : (
        <Tabs defaultValue="review">
          <TabsList>
            <TabsTrigger value="review">{t("Revision.reviewTab")}</TabsTrigger>
            <TabsTrigger value="manage">{t("Revision.manageTab")}</TabsTrigger>
          </TabsList>

          <TabsContent value="review" className="flex flex-col gap-6">
            <RevisionStatsHeader stats={stats} />
            {stats.due_today > 0 ? (
              <Button size="lg" onClick={() => navigate(`/${locale}/revision/session`)}>
                <PlayCircle className="size-4" aria-hidden />
                {t("Revision.startReview", { count: stats.due_today })}
              </Button>
            ) : (
              <EmptyState icon={Brain} title={t("Revision.allCaughtUp")} description={t("Revision.allCaughtUpDescription")} />
            )}
          </TabsContent>

          <TabsContent value="manage">
            <ManageCardList />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
