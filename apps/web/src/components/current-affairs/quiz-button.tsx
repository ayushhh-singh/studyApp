import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { ListChecks, PenLine } from "lucide-react";
import { useWeeklyCaSets } from "@/hooks/use-current-affairs";
import { useLocale } from "@/hooks/use-locale";
import { cn } from "@/lib/utils";

/**
 * The two weekly-assembly entry points: a Prelims MCQ quiz (→ the test player)
 * and a Mains descriptive practice set (→ the answer session). Each links to its
 * pre-built weekly test; disabled with a hint when there's no approved supply.
 */
export function CurrentAffairsWeeklyQuizButtons() {
  const { t } = useTranslation();
  const locale = useLocale();
  const { data, isLoading } = useWeeklyCaSets();

  const base =
    "inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  const prelims = data?.prelims;
  const mains = data?.mains;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {prelims ? (
        <Link to={`/${locale}/practice/test/${prelims.id}`} className={cn(base, "bg-primary text-primary-foreground hover:bg-primary/90")}>
          <ListChecks className="size-4" aria-hidden />
          {t("CurrentAffairs.prelimsQuizButton")}
        </Link>
      ) : (
        <span className={cn(base, "cursor-not-allowed border border-border text-muted-foreground")} title={t("CurrentAffairs.weeklyEmptyPrelims")}>
          <ListChecks className="size-4" aria-hidden />
          {isLoading ? t("CurrentAffairs.weeklyLoading") : t("CurrentAffairs.prelimsQuizButton")}
        </span>
      )}

      {mains ? (
        <Link to={`/${locale}/answers/session/${mains.id}`} className={cn(base, "bg-marigold text-marigold-foreground hover:bg-marigold/90")}>
          <PenLine className="size-4" aria-hidden />
          {t("CurrentAffairs.mainsPracticeButton")}
        </Link>
      ) : (
        <span className={cn(base, "cursor-not-allowed border border-border text-muted-foreground")} title={t("CurrentAffairs.weeklyEmptyMains")}>
          <PenLine className="size-4" aria-hidden />
          {isLoading ? t("CurrentAffairs.weeklyLoading") : t("CurrentAffairs.mainsPracticeButton")}
        </span>
      )}
    </div>
  );
}
