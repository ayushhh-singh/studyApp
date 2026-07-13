import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useQueries } from "@tanstack/react-query";
import { Link } from "react-router";
import { Target } from "lucide-react";
import { masteryMapResponseSchema, type BilingualText, type MasteryNode } from "@neev/shared";
import { SectionCard } from "@/components/ui-x/section-card";
import { Skeleton } from "@/components/ui-x/skeleton";
import { EmptyState } from "@/components/ui-x/empty-state";
import { usePaperSummaries } from "@/hooks/use-paper-summaries";
import { useLocale } from "@/hooks/use-locale";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { MASTERY_COLOR, masteryLevelKey } from "@/lib/mastery";
import { cn } from "@/lib/utils";

interface MatrixRow {
  node: MasteryNode;
  paperCode: string;
  paperTitle: BilingualText;
}

/**
 * Strength/weakness matrix — top-level (depth 1) syllabus nodes across every
 * paper that actually has PYQ data, merged and sorted by exam weight. Reuses
 * `GET /mastery` per paper (already computes accuracy x volume x recency and
 * the `is_priority` "weak AND heavily asked" flag) rather than a new endpoint.
 */
export function StrengthWeaknessCard() {
  const { t } = useTranslation();
  const locale = useLocale();
  const { data: papers, isLoading: papersLoading } = usePaperSummaries();

  // Mastery is an MCQ-accuracy concept (graded attempt_answers rolled up the
  // tree) — only Prelims papers have that signal. Filtering on pyq_count
  // alone would also pull in every Mains (descriptive) paper once PYQs are
  // ingested for it, firing a useless mastery call per paper and needlessly
  // padding out the matrix with all-unseen rows.
  const papersWithPyq = useMemo(
    () => (papers ?? []).filter((p) => p.exam_stage === "prelims" && p.pyq_count > 0),
    [papers],
  );

  const masteryQueries = useQueries({
    queries: papersWithPyq.map((paper) => ({
      queryKey: queryKeys.mastery(paper.paper_code),
      queryFn: () => api.get("/api/v1/mastery", masteryMapResponseSchema, { paper: paper.paper_code }),
    })),
  });

  const isLoading = papersLoading || (papersWithPyq.length > 0 && masteryQueries.some((q) => q.isLoading));

  const rows: MatrixRow[] = useMemo(() => {
    const merged: MatrixRow[] = [];
    papersWithPyq.forEach((paper, i) => {
      const map = masteryQueries[i]?.data;
      if (!map) return;
      map.nodes
        .filter((n) => n.depth === 1)
        .forEach((node) => merged.push({ node, paperCode: paper.paper_code, paperTitle: paper.title_i18n }));
    });
    return merged.sort((a, b) => b.node.weight_pct - a.node.weight_pct);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [papersWithPyq, masteryQueries.map((q) => q.dataUpdatedAt).join(",")]);

  return (
    <SectionCard title={t("Profile.matrixTitle")} description={t("Profile.matrixDescription")}>
      {isLoading ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Target}
          title={t("Profile.matrixEmptyTitle")}
          description={t("Profile.matrixEmptyDescription")}
        />
      ) : (
        <div className="flex flex-col gap-2">
          <div className="hidden grid-cols-[2fr_1fr_1fr_1fr] gap-2 px-3 text-xs font-medium text-muted-foreground sm:grid">
            <span>{t("Profile.matrixColTopic")}</span>
            <span className="text-right">{t("Profile.matrixColWeight")}</span>
            <span className="text-right">{t("Profile.matrixColMastery")}</span>
            <span className="text-right">{t("Profile.matrixColAttempted")}</span>
          </div>
          {rows.map((row) => (
            <Link
              key={row.node.id}
              to={`/${locale}/learn/${row.paperCode}/${row.node.id}`}
              className={cn(
                "flex flex-col gap-1.5 rounded-lg border border-border bg-card p-3 text-sm outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring sm:grid sm:grid-cols-[2fr_1fr_1fr_1fr] sm:items-center sm:gap-2",
                row.node.is_priority && "conquest-pulse",
              )}
            >
              <span className="truncate font-medium" lang={locale}>
                {row.node.title_i18n[locale]}
              </span>
              {/* sm:contents: on mobile this is a normal flex row of labeled
                  mini-stats; at sm+ it disappears from layout so its three
                  children become direct grid items lining up under the
                  column headers above instead. */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground sm:contents">
                <span className="sm:text-right sm:text-sm">
                  <span className="sm:hidden">{t("Profile.matrixColWeight")}: </span>
                  {Math.round(row.node.weight_pct)}%
                </span>
                <span className="flex items-center gap-1.5 font-semibold text-foreground sm:justify-end sm:text-sm">
                  <span
                    className="inline-block size-2 shrink-0 rounded-full"
                    style={{ background: MASTERY_COLOR[row.node.mastery_level] }}
                    aria-hidden
                  />
                  {t(masteryLevelKey(row.node.mastery_level))}
                </span>
                <span className="sm:text-right sm:text-sm">
                  <span className="sm:hidden">{t("Profile.matrixColAttempted")}: </span>
                  {row.node.attempted}
                </span>
              </div>
            </Link>
          ))}
          <p className="pt-1 text-xs text-muted-foreground">{t("Profile.matrixGlowHint")}</p>
        </div>
      )}
    </SectionCard>
  );
}
