import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router";
import { PenSquare, Clock, ListChecks, X } from "lucide-react";
import { PageHeader } from "@/components/ui-x/page-header";
import { SectionCard } from "@/components/ui-x/section-card";
import { EmptyState } from "@/components/ui-x/empty-state";
import { ListRowSkeleton } from "@/components/ui-x/skeleton";
import { Button } from "@/components/ui/button";
import { PyqList } from "@/components/learn/pyq-list";
import { useTests } from "@/hooks/use-tests";
import { useSyllabusNode } from "@/hooks/use-syllabus-node";
import { useLocale } from "@/hooks/use-locale";

export const handle = { titleKey: "Nav.practice" };

function PyqFilterView({ nodeId }: { nodeId: string }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const { data: node } = useSyllabusNode(nodeId);
  const [searchParams, setSearchParams] = useSearchParams();
  const page = Number(searchParams.get("page") ?? "1") || 1;

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

  return (
    <SectionCard
      title={node ? t("Practice.filteredTitle", { topic: node.title_i18n[locale] }) : t("Practice.filteredTitleFallback")}
      action={
        <Button asChild variant="ghost" size="sm">
          <Link to={`/${locale}/practice`}>
            <X aria-hidden />
            {t("Practice.clearFilter")}
          </Link>
        </Button>
      }
    >
      <PyqList nodeId={nodeId} locale={locale} page={page} onPageChange={setPage} />
    </SectionCard>
  );
}

export function Component() {
  const { t } = useTranslation();
  const locale = useLocale();
  const { data: tests, isLoading } = useTests();
  const [searchParams] = useSearchParams();
  const nodeFilter = searchParams.get("node");

  if (nodeFilter) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title={t("Practice.title")} description={t("Practice.description")} />
        <PyqFilterView nodeId={nodeFilter} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("Practice.title")} description={t("Practice.description")} />

      <SectionCard title={t("Practice.available")}>
        {isLoading ? (
          <div className="flex flex-col gap-2">
            <ListRowSkeleton />
            <ListRowSkeleton />
            <ListRowSkeleton />
          </div>
        ) : !tests || tests.length === 0 ? (
          <EmptyState
            icon={PenSquare}
            title={t("Practice.emptyTitle")}
            description={t("Practice.emptyDescription")}
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {tests.map((test) => (
              <li
                key={test.id}
                className="flex min-h-11 items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2.5"
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-sm font-medium">{test.title_i18n[locale]}</span>
                  <span className="text-xs text-muted-foreground">{test.paper_code ?? t("Practice.mixed")}</span>
                </div>
                <div className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <ListChecks className="size-3.5" aria-hidden />
                    {test.question_count}
                  </span>
                  {test.duration_minutes && (
                    <span className="flex items-center gap-1">
                      <Clock className="size-3.5" aria-hidden />
                      {t("Practice.minutes", { count: test.duration_minutes })}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
