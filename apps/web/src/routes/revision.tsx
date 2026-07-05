import { useTranslation } from "react-i18next";
import { Brain } from "lucide-react";
import { PageHeader } from "@/components/ui-x/page-header";
import { StatCard } from "@/components/ui-x/stat-card";
import { StatCardSkeleton } from "@/components/ui-x/skeleton";
import { EmptyState } from "@/components/ui-x/empty-state";
import { useDashboardSummary } from "@/hooks/use-dashboard-summary";

export const handle = { titleKey: "Nav.revision" };

export function Component() {
  const { t } = useTranslation();
  const { data, isLoading } = useDashboardSummary();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("Revision.title")} description={t("Revision.description")} />

      <div className="max-w-xs">
        {isLoading || !data ? (
          <StatCardSkeleton />
        ) : (
          <StatCard label={t("Revision.due")} value={data.srs_due_count} icon={Brain} hint={t("Revision.dueHint")} />
        )}
      </div>

      <EmptyState
        icon={Brain}
        title={t("Revision.emptyTitle")}
        description={t("Revision.emptyDescription")}
      />
    </div>
  );
}
