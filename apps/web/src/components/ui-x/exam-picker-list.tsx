import { useTranslation } from "react-i18next";
import { Check, Lock, Minus } from "lucide-react";
import type { Exam, Locale, TargetExamCode } from "@neev/shared";
import { useExams } from "@/hooks/use-exams";
import { useLocale } from "@/hooks/use-locale";
import { QueryErrorState } from "@/components/ui-x/query-error-state";
import { Skeleton } from "@/components/ui-x/skeleton";
import { cn } from "@/lib/utils";

/**
 * Every exam in the registry, rendered as a picker: `is_live` exams are
 * selectable, everything else is shown greyed with a "Coming soon" badge and
 * its real, honest `launch_scope_i18n` (what's covered today, what isn't) —
 * never a fabricated date/ETA, because the registry carries none.
 *
 * ONE component for both onboarding (the full first-run picker) and the
 * profile exam-switcher (`compact`) — the switcher still needs the launch-scope
 * detail (it's exactly what tells a curious user why a non-live exam can't be
 * picked yet), just at a denser size, so `compact` tightens spacing/type scale
 * rather than hiding content.
 */
export function ExamPickerList({
  value,
  onSelect,
  compact = false,
  className,
}: {
  value: TargetExamCode | null | undefined;
  onSelect: (code: TargetExamCode) => void;
  compact?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  const { data: exams, isLoading, isError, refetch } = useExams();

  if (isLoading) {
    return (
      <div className={cn("flex flex-col gap-3", className)}>
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-16 w-full rounded-xl" />
      </div>
    );
  }
  if (isError || !exams) {
    return <QueryErrorState onRetry={() => refetch()} className={className} />;
  }

  const sorted = [...exams].sort((a, b) => a.sort_order - b.sort_order);

  return (
    <div
      role="group"
      aria-label={t("ExamPicker.groupLabel")}
      className={cn("flex flex-col gap-3", className)}
    >
      {sorted.map((exam) =>
        exam.is_live ? (
          <LiveExamOption
            key={exam.exam_code}
            exam={exam}
            locale={locale}
            selected={value === exam.exam_code}
            compact={compact}
            onSelect={() => onSelect(exam.exam_code)}
          />
        ) : (
          <ComingSoonExamOption key={exam.exam_code} exam={exam} locale={locale} compact={compact} />
        ),
      )}
    </div>
  );
}

function LiveExamOption({
  exam,
  locale,
  selected,
  compact,
  onSelect,
}: {
  exam: Exam;
  locale: Locale;
  selected: boolean;
  compact: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        "flex min-h-11 items-center justify-between gap-3 rounded-xl border px-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        compact ? "py-2.5" : "py-3.5",
        selected
          ? "border-primary bg-primary/10 ring-1 ring-primary"
          : "border-border hover:bg-accent",
      )}
    >
      <span className={cn("font-semibold", compact ? "text-sm" : "text-base")}>
        {exam.display_name_i18n[locale]}
      </span>
      <span
        aria-hidden
        className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded-full border-2",
          selected ? "border-primary bg-primary text-primary-foreground" : "border-border",
        )}
      >
        {selected && <Check className="size-3" />}
      </span>
    </button>
  );
}

function ComingSoonExamOption({
  exam,
  locale,
  compact,
}: {
  exam: Exam;
  locale: Locale;
  compact: boolean;
}) {
  const { t } = useTranslation();
  const { summary_i18n, covered_i18n, not_covered_i18n } = exam.launch_scope_i18n;

  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-xl border border-dashed border-border bg-muted/30",
        compact ? "px-3.5 py-3" : "px-4 py-4",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={cn("font-semibold text-muted-foreground", compact ? "text-sm" : "text-base")}>
          {exam.display_name_i18n[locale]}
        </span>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-marigold/20 px-2 py-0.5 text-[0.65rem] font-semibold text-marigold-foreground">
          <Lock className="size-3" aria-hidden />
          {t("ExamPicker.comingSoon")}
        </span>
      </div>

      <p className="text-sm leading-relaxed text-muted-foreground">{summary_i18n[locale]}</p>

      {covered_i18n.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-semibold text-foreground">{t("ExamPicker.covered")}</p>
          <ul className="flex flex-col gap-1">
            {covered_i18n.map((item, i) => (
              <li key={i} className="flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
                <Check className="mt-0.5 size-3 shrink-0 text-tulsi" aria-hidden />
                <span>{item[locale]}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {not_covered_i18n.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-semibold text-foreground">{t("ExamPicker.notCovered")}</p>
          <ul className="flex flex-col gap-1">
            {not_covered_i18n.map((item, i) => (
              <li key={i} className="flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
                <Minus className="mt-0.5 size-3 shrink-0 text-muted-foreground" aria-hidden />
                <span>{item[locale]}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
