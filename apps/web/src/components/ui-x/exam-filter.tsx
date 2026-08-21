import { useTranslation } from "react-i18next";
import type { ExamCode } from "@neev/shared";
import { useCurrentExam } from "@/hooks/use-current-exam";
import { cn } from "@/lib/utils";

/**
 * The "<my exam> only / All exams" filter used on Practice, Learn node pages,
 * and Trends. `value === undefined` means all exams; the narrow option selects
 * the viewer's own target exam.
 *
 * The narrowing VALUE is a provenance code (`questions.exam_code` — "which exam
 * asked this"), not a product-exam id, which is why the filter can offer "all
 * exams" at all: the bank also holds RO/ARO and UPSSSC-PET papers that overlap
 * the syllabus. The two enums overlap on exactly the three product exams, so the
 * viewer's target exam is always a valid provenance value here.
 *
 * A compact segmented control so it reads as a scope switch, not a form field.
 */
export function ExamFilter({
  value,
  onChange,
  className,
}: {
  value: ExamCode | undefined;
  onChange: (value: ExamCode | undefined) => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const { examCode, name } = useCurrentExam();
  const options: { label: string; value: ExamCode | undefined }[] = [
    { label: t("Exam.examOnly", { exam: name }), value: examCode as ExamCode },
    { label: t("Exam.allExams"), value: undefined },
  ];
  return (
    <div
      role="group"
      aria-label={t("Exam.filterLabel")}
      className={cn("inline-flex items-center rounded-lg border border-border bg-card p-0.5", className)}
    >
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.label}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              "rounded-md px-3 py-1 text-xs font-medium transition-colors",
              active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
