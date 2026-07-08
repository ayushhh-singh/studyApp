import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams, useSearchParams } from "react-router";
import { BarChart3, BookOpen, Brain, Check, ChevronRight, ListChecks, Map as MapIcon, PenSquare, Rows3 } from "lucide-react";
import type { ExamCode, SyllabusNodeWithStats } from "@prayasup/shared";
import { examCodeSchema } from "@prayasup/shared";
import { PageHeader } from "@/components/ui-x/page-header";
import { Breadcrumbs } from "@/components/ui-x/breadcrumbs";
import { EmptyState } from "@/components/ui-x/empty-state";
import { ListRowSkeleton } from "@/components/ui-x/skeleton";
import { ExamFilter } from "@/components/ui-x/exam-filter";
import { WeightageBar } from "@/components/ui-x/weightage-bar";
import { ConquestMap } from "@/components/learn/conquest-map";
import { Button } from "@/components/ui/button";
import { usePaperTree } from "@/hooks/use-paper-tree";
import { useAddToRevision } from "@/hooks/use-add-to-revision";
import { useLocale } from "@/hooks/use-locale";
import { scoreBandColor } from "@/lib/score-band";
import { cn } from "@/lib/utils";

export const handle = { titleKey: "Nav.learn" };

function NodeRow({
  node,
  depth,
  paperCode,
  expanded,
  onToggle,
  locale,
  exam,
  addedIds,
  addingId,
  onAddToRevision,
}: {
  node: SyllabusNodeWithStats;
  depth: number;
  paperCode: string;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  locale: "hi" | "en";
  exam?: ExamCode;
  addedIds: Set<string>;
  addingId: string | null;
  onAddToRevision: (nodeId: string) => void;
}) {
  const { t } = useTranslation();
  const isExpanded = expanded.has(node.id);
  const hasChildren = node.children.length > 0;
  const isAdded = addedIds.has(node.id);

  return (
    <div className="flex flex-col gap-0.5">
      <div
        className="flex flex-col gap-1 rounded-lg px-2 py-1.5 hover:bg-accent/50"
        style={{ marginInlineStart: depth * 16 }}
      >
        <div className="flex items-center gap-2">
          {hasChildren ? (
            <button
              type="button"
              onClick={() => onToggle(node.id)}
              aria-expanded={isExpanded}
              className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ChevronRight className={cn("size-4 transition-transform", isExpanded && "rotate-90")} aria-hidden />
            </button>
          ) : (
            <span className="size-7 shrink-0" />
          )}
          <Link
            to={`/${locale}/learn/${paperCode}/${node.id}`}
            className={cn(
              "min-w-0 flex-1 truncate rounded-sm text-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              depth === 0 && "font-semibold",
            )}
          >
            {node.title_i18n[locale]}
          </Link>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 ps-9 text-xs text-muted-foreground">
          <span className="flex shrink-0 items-center gap-1">
            <ListChecks className="size-3.5" aria-hidden />
            {node.pyq_count}
          </span>
          {node.accuracy_pct !== null && (
            <span
              className="shrink-0 font-semibold tabular-nums"
              style={{ color: scoreBandColor(node.accuracy_pct) }}
            >
              {Math.round(node.accuracy_pct)}%
            </span>
          )}
          <WeightageBar weightage={node.weightage} />
          {node.own_pyq_count > 0 && (
            <Button asChild variant="ghost" size="xs">
              {/* Forwards the active exam filter — practice.tsx's PyqFilterView
                  reads the same `?exam=` param, so without this a "UPPSC only"
                  filter on this outline silently reset to "All exams" the
                  moment you followed this link (the sibling "View trends"
                  link a few lines up already does forward it). */}
              <Link to={`/${locale}/practice?node=${node.id}${exam ? `&exam=${exam}` : ""}`}>
                <PenSquare aria-hidden />
                {t("Learn.practicePyqs")}
              </Link>
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={isAdded || addingId === node.id}
            onClick={() => onAddToRevision(node.id)}
          >
            {isAdded ? <Check aria-hidden /> : <Brain aria-hidden />}
            {isAdded ? t("Learn.addedToRevision") : t("Learn.addToRevision")}
          </Button>
        </div>
      </div>
      {hasChildren && isExpanded && (
        <div className="flex flex-col gap-0.5">
          {node.children.map((child) => (
            <NodeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              paperCode={paperCode}
              expanded={expanded}
              onToggle={onToggle}
              locale={locale}
              exam={exam}
              addedIds={addedIds}
              addingId={addingId}
              onAddToRevision={onAddToRevision}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function Component() {
  const { t } = useTranslation();
  const locale = useLocale();
  const { paperCode = "" } = useParams<{ paperCode: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const examParam = examCodeSchema.safeParse(searchParams.get("exam"));
  const exam: ExamCode | undefined = examParam.success ? examParam.data : undefined;
  const { data: tree, isLoading, isError } = usePaperTree(paperCode, exam);
  const view = searchParams.get("view") === "map" ? "map" : "outline";

  function setView(next: "map" | "outline") {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (next === "map") params.set("view", "map");
        else params.delete("view");
        return params;
      },
      { replace: true },
    );
  }
  const addToRevision = useAddToRevision();
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());
  // Derived straight from the mutation object rather than tracked separately —
  // isPending/variables already update together, so a second piece of state
  // would just be a second (and occasionally stale) source of truth.
  const pendingId = addToRevision.isPending ? (addToRevision.variables ?? null) : null;

  const expanded = new Set((searchParams.get("open") ?? "").split(",").filter(Boolean));

  function handleAddToRevision(nodeId: string) {
    addToRevision.mutate(nodeId, {
      onSuccess: () => setAddedIds((prev) => new Set(prev).add(nodeId)),
    });
  }

  function setExam(next: ExamCode | undefined) {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (next) params.set("exam", next);
        else params.delete("exam");
        return params;
      },
      { replace: true },
    );
  }

  function toggleNode(id: string) {
    // Derive `next` from `prev` inside the updater (not from the outer-scope
    // `expanded`) so two toggles that both fire before a re-render commits
    // can't clobber each other by both reading the same stale snapshot.
    setSearchParams(
      (prev) => {
        const current = new Set((prev.get("open") ?? "").split(",").filter(Boolean));
        if (current.has(id)) current.delete(id);
        else current.add(id);
        const params = new URLSearchParams(prev);
        if (current.size > 0) params.set("open", [...current].join(","));
        else params.delete("open");
        return params;
      },
      { replace: true },
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumbs
        items={[
          { label: t("Nav.learn"), to: `/${locale}/learn` },
          { label: tree ? tree.title_i18n[locale] : t("Learn.title") },
        ]}
      />
      <PageHeader
        title={tree ? tree.title_i18n[locale] : t("Learn.title")}
        description={tree?.description_i18n?.[locale]}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-lg border border-border p-0.5" role="tablist" aria-label={t("Learn.viewToggle")}>
              <Button
                type="button"
                variant={view === "outline" ? "default" : "ghost"}
                size="sm"
                role="tab"
                aria-selected={view === "outline"}
                onClick={() => setView("outline")}
              >
                <Rows3 aria-hidden />
                {t("Learn.outlineView")}
              </Button>
              <Button
                type="button"
                variant={view === "map" ? "default" : "ghost"}
                size="sm"
                role="tab"
                aria-selected={view === "map"}
                onClick={() => setView("map")}
              >
                <MapIcon aria-hidden />
                {t("Learn.mapView")}
              </Button>
            </div>
            {/* Shown in both views now — it used to disappear entirely in Map
                view, silently reading as "the filter doesn't apply here"
                when actually the map was just never wired to it at all. */}
            <ExamFilter value={exam} onChange={setExam} />
            {view === "outline" && (
              <Button asChild variant="outline" size="sm">
                <Link to={`/${locale}/learn/${paperCode}/trends${exam ? `?exam=${exam}` : ""}`}>
                  <BarChart3 aria-hidden />
                  {t("Learn.viewTrends")}
                </Link>
              </Button>
            )}
          </div>
        }
      />

      {view === "map" ? (
        <ConquestMap paperCode={paperCode} locale={locale} exam={exam} />
      ) : isLoading || !tree ? (
        isError ? (
          <EmptyState
            icon={BookOpen}
            title={t("Learn.paperNotFoundTitle")}
            description={t("Learn.paperNotFoundDescription")}
          />
        ) : (
          <div className="flex flex-col gap-2">
            <ListRowSkeleton />
            <ListRowSkeleton />
            <ListRowSkeleton />
          </div>
        )
      ) : tree.children.length === 0 ? (
        <EmptyState icon={BookOpen} title={t("Learn.emptyTitle")} description={t("Learn.emptyDescription")} />
      ) : (
        <>
          {addToRevision.isError && (
            <p className="text-sm text-coral">{t("Learn.addToRevisionFailed")}</p>
          )}
          <div className="flex flex-col gap-0.5 rounded-xl border border-border bg-card p-3 shadow-sm">
            {tree.children.map((node) => (
              <NodeRow
                key={node.id}
                node={node}
                depth={0}
                paperCode={paperCode}
                expanded={expanded}
                onToggle={toggleNode}
                locale={locale}
                exam={exam}
                addedIds={addedIds}
                addingId={pendingId}
                onAddToRevision={handleAddToRevision}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
