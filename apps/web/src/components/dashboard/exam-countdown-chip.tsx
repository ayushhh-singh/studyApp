import { CalendarClock } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { DashboardNextExam } from "@neev/shared";
import { useLocale } from "@/hooks/use-locale";
import { cn } from "@/lib/utils";

export function ExamCountdownChip({ exam, className }: { exam: DashboardNextExam; className?: string }) {
  const { t } = useTranslation();
  const locale = useLocale();

  if (!exam) {
    return (
      <span
        className={cn(
          "inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-muted px-3 text-sm text-muted-foreground",
          className,
        )}
      >
        <CalendarClock className="size-4" aria-hidden />
        {t("Dashboard.noExamDate")}
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex h-9 items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 text-sm font-semibold text-primary",
        className,
      )}
    >
      <CalendarClock className="size-4" aria-hidden />
      {exam.days_until === 0
        ? t("Dashboard.examToday", { title: exam.title_i18n[locale] })
        : t("Dashboard.examCountdown", { count: exam.days_until, title: exam.title_i18n[locale] })}
      {exam.is_tentative && (
        <span className="text-xs font-normal text-muted-foreground">({t("Dashboard.examTentative")})</span>
      )}
    </span>
  );
}
