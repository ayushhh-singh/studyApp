import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Target } from "lucide-react";
import type { DashboardWeaknessNode } from "@neev/shared";
import { SectionCard } from "@/components/ui-x/section-card";
import { EmptyState } from "@/components/ui-x/empty-state";
import { useLocale } from "@/hooks/use-locale";
import { scoreBandColor } from "@/lib/score-band";

export function WeaknessCard({ nodes }: { nodes: DashboardWeaknessNode[] }) {
  const { t } = useTranslation();
  const locale = useLocale();

  return (
    <SectionCard title={t("Dashboard.weaknessTitle")}>
      {nodes.length === 0 ? (
        <EmptyState
          icon={Target}
          title={t("Dashboard.weaknessEmptyTitle")}
          description={t("Dashboard.weaknessEmptyDescription")}
        />
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">{t("Dashboard.weaknessDescription")}</p>
          {nodes.map((node) => (
            <div key={node.syllabus_node_id} className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-2">
                <Link
                  to={`/${locale}/learn/${node.paper_code}/${node.syllabus_node_id}`}
                  className="truncate rounded-sm text-sm font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {node.title_i18n[locale]}
                </Link>
                <span
                  className="shrink-0 text-sm font-semibold tabular-nums"
                  style={{ color: scoreBandColor(node.accuracy_pct) }}
                >
                  {Math.round(node.accuracy_pct)}%
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${node.accuracy_pct}%`, backgroundColor: scoreBandColor(node.accuracy_pct) }}
                />
              </div>
              <span className="text-xs text-muted-foreground">
                {t("Dashboard.weaknessAnsweredCount", { count: node.answered_count })}
              </span>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}
