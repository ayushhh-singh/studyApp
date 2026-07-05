import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams, useSearchParams } from "react-router";
import { BookOpen, Brain, Check, ChevronRight, ListChecks, PenSquare } from "lucide-react";
import type { SyllabusNodeWithStats } from "@prayasup/shared";
import { PageHeader } from "@/components/ui-x/page-header";
import { Breadcrumbs } from "@/components/ui-x/breadcrumbs";
import { EmptyState } from "@/components/ui-x/empty-state";
import { ListRowSkeleton } from "@/components/ui-x/skeleton";
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
          {node.pyq_count > 0 && (
            <Button asChild variant="ghost" size="xs">
              <Link to={`/${locale}/practice?node=${node.id}`}>
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
  const { data: tree, isLoading, isError } = usePaperTree(paperCode);
  const [searchParams, setSearchParams] = useSearchParams();
  const addToRevision = useAddToRevision();
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());
  const [pendingId, setPendingId] = useState<string | null>(null);

  const expanded = new Set((searchParams.get("open") ?? "").split(",").filter(Boolean));

  function handleAddToRevision(nodeId: string) {
    setPendingId(nodeId);
    addToRevision.mutate(nodeId, {
      onSuccess: () => setAddedIds((prev) => new Set(prev).add(nodeId)),
      onSettled: () => setPendingId((current) => (current === nodeId ? null : current)),
    });
  }

  function toggleNode(id: string) {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (next.size > 0) params.set("open", [...next].join(","));
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
      />

      {isLoading || !tree ? (
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
              addedIds={addedIds}
              addingId={pendingId}
              onAddToRevision={handleAddToRevision}
            />
          ))}
        </div>
      )}
    </div>
  );
}
