import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router";
import { ChevronRight, BookOpen } from "lucide-react";
import type { SyllabusNode } from "@prayasup/shared";
import { PageHeader } from "@/components/ui-x/page-header";
import { SectionCard } from "@/components/ui-x/section-card";
import { EmptyState } from "@/components/ui-x/empty-state";
import { ListRowSkeleton } from "@/components/ui-x/skeleton";
import { useSyllabusTree } from "@/hooks/use-syllabus-tree";
import { useLocale } from "@/hooks/use-locale";
import { cn } from "@/lib/utils";

export const handle = { titleKey: "Nav.learn" };

function findAncestorPath(nodes: SyllabusNode[], targetId: string, path: string[] = []): string[] | null {
  for (const node of nodes) {
    const nextPath = [...path, node.id];
    if (node.id === targetId) return nextPath;
    const found = findAncestorPath(node.children, targetId, nextPath);
    if (found) return found;
  }
  return null;
}

function SyllabusNodeRow({
  node,
  depth,
  expanded,
  onToggle,
  locale,
  highlightId,
}: {
  node: SyllabusNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  locale: "hi" | "en";
  highlightId: string | null;
}) {
  const isExpanded = expanded.has(node.id);
  const hasChildren = node.children.length > 0;

  return (
    <div>
      <div
        id={`syllabus-node-${node.id}`}
        className={cn(
          "flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm transition-colors",
          node.id === highlightId && "bg-accent text-accent-foreground",
        )}
        style={{ marginInlineStart: depth * 16 }}
      >
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
        <span className={cn(depth === 0 && "font-semibold")}>{node.title_i18n[locale]}</span>
      </div>
      {hasChildren && isExpanded && (
        <div className="flex flex-col gap-0.5">
          {node.children.map((child) => (
            <SyllabusNodeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              locale={locale}
              highlightId={highlightId}
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
  const { data, isLoading } = useSyllabusTree();
  const [searchParams] = useSearchParams();
  const targetNodeId = searchParams.get("node");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!data || !targetNodeId) return;
    const path = findAncestorPath(data, targetNodeId);
    if (!path) return;
    setExpanded((prev) => new Set([...prev, ...path]));
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    requestAnimationFrame(() => {
      document
        .getElementById(`syllabus-node-${targetNodeId}`)
        ?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
    });
  }, [data, targetNodeId]);

  const toggleNode = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const grouped = useMemo(() => {
    if (!data) return { prelims: [] as SyllabusNode[], mains: [] as SyllabusNode[] };
    return {
      prelims: data.filter((node) => node.exam_stage === "prelims"),
      mains: data.filter((node) => node.exam_stage === "mains"),
    };
  }, [data]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("Learn.title")} description={t("Learn.description")} />

      {isLoading || !data ? (
        <div className="flex flex-col gap-2">
          <ListRowSkeleton />
          <ListRowSkeleton />
          <ListRowSkeleton />
        </div>
      ) : data.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title={t("Learn.emptyTitle")}
          description={t("Learn.emptyDescription")}
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <SectionCard title={t("Learn.prelims")}>
            <div className="flex flex-col gap-0.5">
              {grouped.prelims.map((node) => (
                <SyllabusNodeRow
                  key={node.id}
                  node={node}
                  depth={0}
                  expanded={expanded}
                  onToggle={toggleNode}
                  locale={locale}
                  highlightId={targetNodeId}
                />
              ))}
            </div>
          </SectionCard>
          <SectionCard title={t("Learn.mains")}>
            <div className="flex flex-col gap-0.5">
              {grouped.mains.map((node) => (
                <SyllabusNodeRow
                  key={node.id}
                  node={node}
                  depth={0}
                  expanded={expanded}
                  onToggle={toggleNode}
                  locale={locale}
                  highlightId={targetNodeId}
                />
              ))}
            </div>
          </SectionCard>
        </div>
      )}
    </div>
  );
}
