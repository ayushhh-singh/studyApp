import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { ArrowRight, BookOpen, PenSquare } from "lucide-react";
import type { DashboardContinue } from "@prayasup/shared";
import { SectionCard } from "@/components/ui-x/section-card";
import { EmptyState } from "@/components/ui-x/empty-state";
import { useLocale } from "@/hooks/use-locale";

export function ContinueCard({ data }: { data: DashboardContinue }) {
  const { t } = useTranslation();
  const locale = useLocale();

  return (
    <SectionCard title={t("Dashboard.continueTitle")}>
      {data.type === "none" && (
        <EmptyState
          icon={BookOpen}
          title={t("Dashboard.continueEmptyTitle")}
          description={t("Dashboard.continueEmptyDescription")}
        />
      )}

      {data.type === "attempt" && (
        <div className="flex flex-col gap-3">
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <PenSquare className="size-4" aria-hidden />
            </span>
            <div className="flex min-w-0 flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">
                {t("Dashboard.continueAttemptLabel")}
              </span>
              <span className="truncate text-sm font-semibold">
                {data.test_title_i18n?.[locale] ?? t("Dashboard.continueAttemptFallbackTitle")}
              </span>
              <span className="text-xs text-muted-foreground">
                {t("Dashboard.continueAttemptDetail", { answered: data.answered_count, total: data.total_count })}
              </span>
              <div className="h-2 w-full max-w-48 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{
                    width: `${data.total_count > 0 ? Math.min(100, (data.answered_count / data.total_count) * 100) : 0}%`,
                  }}
                />
              </div>
            </div>
          </div>
          <Link
            to={`/${locale}/practice`}
            className="inline-flex h-9 w-fit items-center gap-1.5 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t("Dashboard.continueResumeCta")}
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        </div>
      )}

      {data.type === "syllabus_node" && (
        <div className="flex flex-col gap-3">
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <BookOpen className="size-4" aria-hidden />
            </span>
            <div className="flex min-w-0 flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">
                {t("Dashboard.continueSyllabusLabel")}
              </span>
              <span className="truncate text-sm font-semibold">{data.title_i18n[locale]}</span>
            </div>
          </div>
          <Link
            to={`/${locale}/learn/${data.paper_code}/${data.syllabus_node_id}`}
            className="inline-flex h-9 w-fit items-center gap-1.5 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t("Dashboard.continueSyllabusCta")}
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        </div>
      )}
    </SectionCard>
  );
}
