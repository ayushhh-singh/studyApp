import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { CheckCircle2, PenLine, ScrollText } from "lucide-react";
import type { DailyAnswerItem } from "@neev/shared";
import { SectionCard } from "@/components/ui-x/section-card";
import { ListRowSkeleton } from "@/components/ui-x/skeleton";
import { QueryErrorState } from "@/components/ui-x/query-error-state";
import { scoreBandColor } from "@/lib/score-band";
import { useDailyAnswerSet } from "@/hooks/use-answers";
import { useLocale } from "@/hooks/use-locale";
import { formatQuestionStem } from "@/lib/format-question-stem";

/** Short bilingual-ish paper label; falls back to the raw code. */
function paperLabel(code: string, t: (k: string, o?: Record<string, unknown>) => string): string {
  const key = `Answers.paper_${code}`;
  const label = t(key);
  return label === key ? code : label;
}

function AnswerRow({ item }: { item: DailyAnswerItem }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const evaluated = item.status === "evaluated";
  const pct =
    item.overall_score != null && item.max_score ? (item.overall_score / item.max_score) * 100 : null;

  // An already-evaluated item should reopen its existing result, not discard
  // that context by sending the user to write a brand-new answer from scratch.
  const href =
    evaluated && item.submission_id
      ? `/${locale}/answers/evaluation/${item.submission_id}`
      : `/${locale}/answers/write?question=${item.question_id}`;

  return (
    <Link
      to={href}
      className="flex flex-col gap-2 rounded-lg border border-border bg-background px-3 py-3 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
          {paperLabel(item.paper_code, t)}
        </span>
        {item.kind === "essay" && (
          <span className="inline-flex items-center gap-1 rounded-full bg-marigold/15 px-2 py-0.5 text-[11px] font-semibold text-marigold">
            <ScrollText className="size-3" aria-hidden />
            {t("Answers.dailySetEssayBadge")}
          </span>
        )}
        {item.marks != null && (
          <span className="text-[11px] text-muted-foreground">{t("Answers.dailySetMarks", { marks: item.marks })}</span>
        )}
      </div>
      <p className="line-clamp-2 text-sm whitespace-pre-line">{formatQuestionStem(item.stem_i18n[locale])}</p>
      <div className="flex items-center justify-between">
        {evaluated ? (
          <span
            className="inline-flex items-center gap-1 text-xs font-semibold tabular-nums"
            style={{ color: pct !== null ? scoreBandColor(pct) : undefined }}
          >
            <CheckCircle2 className="size-3.5" aria-hidden />
            {item.overall_score != null && item.max_score != null
              ? t("Answers.dailySetScore", { score: item.overall_score, total: item.max_score })
              : t("Answers.dailySetEvaluated")}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
            <PenLine className="size-3.5" aria-hidden />
            {t("Answers.dailySetStart")}
          </span>
        )}
      </div>
    </Link>
  );
}

export function DailyAnswerSet() {
  const { t } = useTranslation();
  const { data, isLoading, isError, refetch } = useDailyAnswerSet();

  return (
    <SectionCard
      title={t("Answers.dailySetTitle")}
      description={
        data
          ? t("Answers.dailySetProgress", { done: data.completed_count, total: data.items.length })
          : t("Answers.dailySetDescription")
      }
    >
      {isLoading ? (
        <div className="flex flex-col gap-2">
          <ListRowSkeleton />
          <ListRowSkeleton />
        </div>
      ) : isError ? (
        <QueryErrorState onRetry={() => refetch()} />
      ) : !data || data.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("Answers.dailySetEmpty")}</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {data.items.map((item) => (
            <li key={item.question_id}>
              <AnswerRow item={item} />
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
