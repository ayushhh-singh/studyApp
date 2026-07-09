import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Clock, ListChecks, Award } from "lucide-react";
import type { TestSummary, Locale } from "@prayasup/shared";
import { scoreBandColor } from "@/lib/score-band";

export function TestCard({
  test,
  locale,
  href,
}: {
  test: TestSummary;
  locale: Locale;
  /** Overrides the default MCQ test-player link — used by the Answers (descriptive) test tabs, which start a timed session instead. */
  href?: string;
}) {
  const { t } = useTranslation();
  const bestPct =
    test.best_score !== null && test.total_marks ? Math.max(0, (test.best_score / test.total_marks) * 100) : null;

  return (
    <Link
      to={href ?? `/${locale}/practice/test/${test.id}`}
      className="flex flex-col gap-2 rounded-lg border border-border bg-background px-3 py-2.5 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-sm font-medium">{test.title_i18n[locale]}</span>
        <span className="text-xs text-muted-foreground">{test.paper_code ?? t("Practice.mixed")}</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
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
        {test.total_marks != null && <span>{t("Practice.marks", { count: test.total_marks })}</span>}
        {bestPct !== null && (
          <span
            className="flex items-center gap-1 font-semibold tabular-nums"
            style={{ color: scoreBandColor(bestPct) }}
          >
            <Award className="size-3.5" aria-hidden />
            {t("Practice.bestScore", { score: test.best_score, total: test.total_marks })}
          </span>
        )}
      </div>
    </Link>
  );
}
