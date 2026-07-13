import { useTranslation } from "react-i18next";
import type { ExamCode } from "@neev/shared";
import { cn } from "@/lib/utils";

/**
 * The "UPPSC only / All exams" filter used on Practice, Learn node pages, and
 * Trends. `value === undefined` means all exams; `"uppsc"` narrows to UPPSC.
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
  const options: { label: string; value: ExamCode | undefined }[] = [
    { label: t("Exam.uppscOnly"), value: "uppsc" },
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
