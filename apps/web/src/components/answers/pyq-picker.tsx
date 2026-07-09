import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { NotebookPen } from "lucide-react";
import { SectionCard } from "@/components/ui-x/section-card";
import { EmptyState } from "@/components/ui-x/empty-state";
import { QueryErrorState } from "@/components/ui-x/query-error-state";
import { ListRowSkeleton } from "@/components/ui-x/skeleton";
import { useQuestions } from "@/hooks/use-questions";
import { usePaperSummaries } from "@/hooks/use-paper-summaries";
import { useLocale } from "@/hooks/use-locale";

const SELECT_CLASS =
  "h-9 rounded-md border border-input bg-background px-2.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function PyqPicker() {
  const { t } = useTranslation();
  const locale = useLocale();
  const [paper, setPaper] = useState("");
  const { data: papers } = usePaperSummaries();
  const { data, isLoading, isError, refetch } = useQuestions({
    type: "descriptive",
    paper: paper || undefined,
    page: 1,
  });

  return (
    <SectionCard title={t("Answers.pyqPickerTitle")}>
      <select
        className={`${SELECT_CLASS} self-start`}
        value={paper}
        onChange={(e) => setPaper(e.target.value)}
        aria-label={t("Answers.pyqPickerPaperFilter")}
      >
        <option value="">{t("Answers.pyqPickerAllPapers")}</option>
        {(papers ?? []).map((p) => (
          <option key={p.paper_code} value={p.paper_code}>
            {p.title_i18n[locale]}
          </option>
        ))}
      </select>

      {isLoading ? (
        <div className="flex flex-col gap-2">
          <ListRowSkeleton />
          <ListRowSkeleton />
        </div>
      ) : isError ? (
        <QueryErrorState onRetry={() => refetch()} />
      ) : !data || data.items.length === 0 ? (
        <EmptyState
          icon={NotebookPen}
          title={t("Answers.emptyTitle")}
          description={t("Answers.emptyDescription")}
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {data.items.map((question) => (
            <li key={question.id}>
              <Link
                to={`/${locale}/answers/write?question=${question.id}`}
                className="flex flex-col gap-1.5 rounded-lg border border-border bg-background px-3 py-2.5 transition-colors hover:border-primary/40 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <p className="text-sm" lang={locale}>
                  {question.stem_i18n[locale]}
                </p>
                <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <span>{question.paper_code}</span>
                  {question.marks !== null && <span>{t("Answers.marks", { count: question.marks })}</span>}
                  {question.word_limit !== null && (
                    <span>{t("Answers.wordLimit", { count: question.word_limit })}</span>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
