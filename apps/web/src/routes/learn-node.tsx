import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams, useSearchParams } from "react-router";
import { BookOpen, ListChecks, Newspaper, PenSquare } from "lucide-react";
import { PageHeader } from "@/components/ui-x/page-header";
import { Breadcrumbs } from "@/components/ui-x/breadcrumbs";
import { SectionCard } from "@/components/ui-x/section-card";
import { EmptyState } from "@/components/ui-x/empty-state";
import { ListRowSkeleton } from "@/components/ui-x/skeleton";
import { Button } from "@/components/ui/button";
import { PyqList } from "@/components/learn/pyq-list";
import { useSyllabusNode } from "@/hooks/use-syllabus-node";
import { useRecordEvent } from "@/hooks/use-record-event";
import { useCreateCustomTest } from "@/hooks/use-create-custom-test";
import { useLocale } from "@/hooks/use-locale";
import { scoreBandColor } from "@/lib/score-band";

export const handle = { titleKey: "Nav.learn" };

export function Component() {
  const { t } = useTranslation();
  const locale = useLocale();
  const { paperCode = "", nodeId = "" } = useParams<{ paperCode: string; nodeId: string }>();
  const { data: node, isLoading, isError } = useSyllabusNode(nodeId);
  const recordEvent = useRecordEvent();
  const createTest = useCreateCustomTest();
  const [searchParams, setSearchParams] = useSearchParams();
  const page = Number(searchParams.get("page") ?? "1") || 1;

  useEffect(() => {
    // Deliberately depends on nodeId only — recordEvent is a fresh mutation
    // object every render, and including it here would re-fire the event on
    // every re-render instead of once per node visited.
    if (!nodeId) return;
    recordEvent.mutate({ name: "syllabus_node_view", props: { node_id: nodeId } });
  }, [nodeId]);

  function setPage(next: number) {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (next > 1) params.set("page", String(next));
        else params.delete("page");
        return params;
      },
      { replace: true },
    );
  }

  if (isLoading || !node) {
    return (
      <div className="flex flex-col gap-6">
        {isError ? (
          <EmptyState
            icon={BookOpen}
            title={t("Learn.nodeNotFoundTitle")}
            description={t("Learn.nodeNotFoundDescription")}
          />
        ) : (
          <div className="flex flex-col gap-2">
            <ListRowSkeleton />
            <ListRowSkeleton />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumbs
        items={[
          { label: t("Nav.learn"), to: `/${locale}/learn` },
          ...node.breadcrumb.map((crumb, index) => ({
            label: crumb.title_i18n[locale],
            to:
              index === node.breadcrumb.length - 1
                ? undefined
                : index === 0
                  ? `/${locale}/learn/${paperCode}`
                  : `/${locale}/learn/${paperCode}/${crumb.id}`,
          })),
        ]}
      />
      <PageHeader
        title={node.title_i18n[locale]}
        description={node.description_i18n?.[locale]}
        action={
          <Button
            type="button"
            onClick={() => createTest.mutate({ node_id: nodeId, count: Math.min(node.pyq_count, 20) })}
            disabled={node.pyq_count === 0 || createTest.isPending}
          >
            <PenSquare aria-hidden />
            {t("Learn.practiceThisTopic")}
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <ListChecks className="size-4" aria-hidden />
          {t("Learn.pyqCount", { count: node.pyq_count })}
        </span>
        {node.accuracy_pct !== null && (
          <span
            className="font-semibold tabular-nums"
            style={{ color: scoreBandColor(node.accuracy_pct) }}
          >
            {t("Learn.yourAccuracy", { pct: Math.round(node.accuracy_pct) })}
          </span>
        )}
      </div>

      {createTest.isSuccess && (
        <div className="rounded-lg border border-tulsi/30 bg-tulsi/10 px-4 py-3 text-sm text-tulsi-foreground">
          {t("Learn.customTestCreated", { count: createTest.data.question_count })}{" "}
          <Link to={`/${locale}/practice`} className="font-semibold underline">
            {t("Learn.goToPractice")}
          </Link>
        </div>
      )}
      {createTest.isError && (
        <div className="rounded-lg border border-coral/30 bg-coral/10 px-4 py-3 text-sm text-coral-foreground">
          {createTest.error.message}
        </div>
      )}

      <SectionCard title={t("Learn.pyqsTitle")}>
        <PyqList nodeId={nodeId} locale={locale} page={page} onPageChange={setPage} />
      </SectionCard>

      <SectionCard title={t("Learn.relatedCurrentAffairsTitle")}>
        {node.related_current_affairs.length === 0 ? (
          <EmptyState
            icon={Newspaper}
            title={t("Learn.noRelatedCurrentAffairsTitle")}
            description={t("Learn.noRelatedCurrentAffairsDescription")}
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {node.related_current_affairs.map((item) => (
              <li
                key={item.id}
                className="flex flex-col gap-1 rounded-lg border border-border bg-background px-3 py-2.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{item.title_i18n[locale]}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{item.date}</span>
                </div>
                {item.summary_i18n && (
                  <p className="text-xs text-muted-foreground">{item.summary_i18n[locale]}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
