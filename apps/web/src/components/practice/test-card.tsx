import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Clock, FileText, ListChecks, Award } from "lucide-react";
import type { TestSummary, Locale } from "@neev/shared";
import { scoreBandTextColor } from "@/lib/score-band";
import { formatScoreValue } from "@/lib/format-score";

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
    // docs/design/reference-1's tests page leads each row with a tinted tile
    // and gives the row a real card surface rather than the page background.
    <Link
      to={href ?? `/${locale}/practice/test/${test.id}`}
      className="flex min-h-11 items-start gap-3 rounded-xl border border-border bg-card px-3 py-3 transition-colors hover:border-primary/40 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <FileText className="size-5" aria-hidden />
      </span>
      {/* div, not span: this wraps block-level children, and a <div> inside a
          <span> is invalid phrasing content. The parent is an <a>, which takes
          flow content, so a div here is correct. */}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
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
        {test.total_marks != null && (
          <span>{t("Practice.marks", { count: Number(formatScoreValue(test.total_marks)) })}</span>
        )}
        {bestPct !== null && (
          <span
            className="flex items-center gap-1 font-semibold tabular-nums"
            style={{ color: scoreBandTextColor(bestPct) }}
          >
            <Award className="size-3.5" aria-hidden />
            {t("Practice.bestScore", {
              score: formatScoreValue(test.best_score ?? 0),
              total: formatScoreValue(test.total_marks ?? 0),
            })}
          </span>
        )}
      </div>
      </div>
    </Link>
  );
}
