import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { ChevronDown, ChevronRight, Target } from "lucide-react";
import type { DashboardWeaknessNode } from "@neev/shared";
import { SectionCard } from "@/components/ui-x/section-card";
import { EmptyState } from "@/components/ui-x/empty-state";
import { useLocale } from "@/hooks/use-locale";
import { scoreBandColor } from "@/lib/score-band";
import { cn } from "@/lib/utils";

/**
 * How many weak topics to show before the "show all" toggle.
 *
 * The API caps this at nothing — weakness_radar returns EVERY top-level node
 * the user has answered in, which is 13 on a four-week-old account and grows
 * with every paper they touch. A focus tool that lists thirteen things to fix
 * is not a focus tool, and as full rows it buried the rest of the dashboard.
 * The list is already sorted weakest-first, so the first four ARE the four to
 * work on.
 */
const VISIBLE_WEAKNESSES = 4;

export function WeaknessCard({ nodes }: { nodes: DashboardWeaknessNode[] }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? nodes : nodes.slice(0, VISIBLE_WEAKNESSES);
  const hiddenCount = nodes.length - visible.length;

  return (
    <SectionCard title={t("Dashboard.weaknessTitle")} description={nodes.length > 0 ? t("Dashboard.weaknessDescription") : undefined}>
      {nodes.length === 0 ? (
        <EmptyState
          icon={Target}
          title={t("Dashboard.weaknessEmptyTitle")}
          description={t("Dashboard.weaknessEmptyDescription")}
        />
      ) : (
        // docs/design/reference-1's "Recommended for You" row: a tinted icon
        // tile, title over a muted sub-line, and the action at the far right.
        // The whole row is the link (a 44px+ target on a phone) and the button
        // is presentational inside it, rather than a small tappable word.
        <div className="flex flex-col divide-y divide-border">
          {visible.map((node) => (
            <Link
              key={node.syllabus_node_id}
              to={`/${locale}/learn/${node.paper_code}/${node.syllabus_node_id}`}
              className="group flex min-h-11 items-center gap-3 rounded-lg px-1 py-3 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
                <Target className="size-5" aria-hidden />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="truncate text-sm font-medium">{node.title_i18n[locale]}</span>
                <span className="flex items-center gap-2">
                  <span className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-muted">
                    <span
                      className="block h-full rounded-full"
                      style={{ width: `${node.accuracy_pct}%`, backgroundColor: scoreBandColor(node.accuracy_pct) }}
                    />
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {t("Dashboard.weaknessRowMeta", {
                      pct: Math.round(node.accuracy_pct),
                      count: node.answered_count,
                    })}
                  </span>
                </span>
              </span>
              <span className="hidden shrink-0 items-center rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-primary transition-colors group-hover:border-primary/40 sm:inline-flex">
                {t("Dashboard.weaknessStartCta")}
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground sm:hidden" aria-hidden />
            </Link>
          ))}
          {nodes.length > VISIBLE_WEAKNESSES && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              aria-expanded={showAll}
              className="mt-1 flex min-h-11 items-center justify-center gap-1.5 rounded-lg text-sm font-semibold text-primary transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {showAll ? t("Dashboard.weaknessShowFewer") : t("Dashboard.weaknessShowAll", { count: hiddenCount })}
              <ChevronDown className={cn("size-4 transition-transform", showAll && "rotate-180")} aria-hidden />
            </button>
          )}
        </div>
      )}
    </SectionCard>
  );
}
