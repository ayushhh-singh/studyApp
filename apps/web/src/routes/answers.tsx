import { useTranslation } from "react-i18next";
import { NotebookPen } from "lucide-react";
import { PageHeader } from "@/components/ui-x/page-header";
import { SectionCard } from "@/components/ui-x/section-card";
import { EmptyState } from "@/components/ui-x/empty-state";
import { ListRowSkeleton } from "@/components/ui-x/skeleton";
import { useQuestions } from "@/hooks/use-questions";
import { useLocale } from "@/hooks/use-locale";

export const handle = { titleKey: "Nav.answers" };

export function Component() {
  const { t } = useTranslation();
  const locale = useLocale();
  const { data, isLoading } = useQuestions({ type: "descriptive", page: 1 });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("Answers.title")}
        description={t("Answers.description")}
        action={
          <span className="inline-flex items-center gap-1.5 rounded-full bg-marigold/15 px-3 py-1 text-xs font-semibold text-marigold-foreground">
            <NotebookPen className="size-3.5" aria-hidden />
            {t("Answers.flagshipBadge")}
          </span>
        }
      />

      <SectionCard
        title={t("Answers.available")}
        className="border-marigold/30"
        action={
          data && (
            <span className="text-xs font-medium text-muted-foreground">
              {t("Answers.totalCount", { count: data.pagination.total })}
            </span>
          )
        }
      >
        {isLoading ? (
          <div className="flex flex-col gap-2">
            <ListRowSkeleton />
            <ListRowSkeleton />
            <ListRowSkeleton />
          </div>
        ) : !data || data.items.length === 0 ? (
          <EmptyState
            icon={NotebookPen}
            title={t("Answers.emptyTitle")}
            description={t("Answers.emptyDescription")}
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {data.items.map((question) => (
              <li
                key={question.id}
                className="flex flex-col gap-1.5 rounded-lg border border-border bg-background px-3 py-2.5"
              >
                <p className="text-sm">{question.stem_i18n[locale]}</p>
                <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <span>{question.paper_code}</span>
                  {question.marks && <span>{t("Answers.marks", { count: question.marks })}</span>}
                  {question.word_limit && (
                    <span>{t("Answers.wordLimit", { count: question.word_limit })}</span>
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
