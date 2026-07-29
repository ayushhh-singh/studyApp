import { useTranslation } from "react-i18next";
import type { BilingualText, ExamCode } from "@neev/shared";
import { useCurrentExam } from "@/hooks/use-current-exam";
import { useLocale } from "@/hooks/use-locale";
import { PROVENANCE_EXAM_LABEL } from "@/lib/exam-label";
import { cn } from "@/lib/utils";

/**
 * The "exam + year" attribution chip rendered wherever a question shows
 * (PYQ lists, the in-test player). Reads the row's denormalised
 * exam_label_i18n, falling back to a per-exam-code label.
 *
 * The fallback map is PROVENANCE-keyed and stays that way — see
 * lib/exam-label.ts. `examCode` here answers "which commission set this
 * question", which is a different question from "which exam is the viewer
 * preparing for": a UPPSC aspirant legitimately sees an RO/ARO chip on a
 * borrowed PYQ. Only the out-of-syllabus marker, which IS about the viewer's own
 * syllabus, reads the target exam.
 */
export function ExamYearChip({
  examCode,
  examLabel,
  year,
  outOfSyllabus,
  className,
}: {
  examCode: ExamCode;
  examLabel?: BilingualText | null;
  year?: number | null;
  outOfSyllabus?: boolean;
  className?: string;
}) {
  const locale = useLocale();
  const { t } = useTranslation();
  const { name: currentExamName } = useCurrentExam();
  const label = (examLabel ?? PROVENANCE_EXAM_LABEL[examCode])[locale];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary",
        className,
      )}
    >
      <span>{year ? `${label} · ${year}` : label}</span>
      {outOfSyllabus && (
        <span
          title={t("Learn.outOfSyllabus", { exam: currentExamName })}
          className="rounded-sm bg-marigold/20 px-1 text-[0.65rem] font-semibold text-marigold-foreground"
        >
          {t("Learn.outOfSyllabusShort")}
        </span>
      )}
    </span>
  );
}
