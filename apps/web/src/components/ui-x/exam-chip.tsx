import { useTranslation } from "react-i18next";
import type { BilingualText, ExamCode } from "@neev/shared";
import { useLocale } from "@/hooks/use-locale";
import { cn } from "@/lib/utils";

/** Fallback labels when a row has no denormalised exam_label_i18n (legacy rows). */
const EXAM_FALLBACK: Record<ExamCode, BilingualText> = {
  uppsc: { en: "UPPSC", hi: "यूपीपीएससी" },
  upsc: { en: "UPSC", hi: "यूपीएससी" },
  up_ro_aro: { en: "UP RO/ARO", hi: "यूपी आरओ/एआरओ" },
  upsssc_pet: { en: "UPSSSC PET", hi: "यूपीएसएसएससी पीईटी" },
  other: { en: "Other", hi: "अन्य" },
};

/**
 * The "exam + year" attribution chip rendered wherever a question shows
 * (PYQ lists, the in-test player). Reads the row's denormalised
 * exam_label_i18n, falling back to a per-exam-code label. When the question is
 * out of the UPPSC syllabus, an unobtrusive marker flags it.
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
  const label = (examLabel ?? EXAM_FALLBACK[examCode])[locale];
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
          title={t("Learn.outOfSyllabus")}
          className="rounded-sm bg-marigold/20 px-1 text-[0.65rem] font-semibold text-marigold-foreground"
        >
          {t("Learn.outOfSyllabusShort")}
        </span>
      )}
    </span>
  );
}
