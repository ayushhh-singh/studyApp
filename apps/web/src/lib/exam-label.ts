import type { BilingualText, Exam, ExamCode, Locale } from "@neev/shared";

/**
 * Short bilingual labels keyed by the PROVENANCE exam code
 * (`questions.exam_code` — "which exam ASKED this question").
 *
 * This map deliberately does NOT go through the product-exam registry, and must
 * not be "unified" with it. Its domain includes `up_ro_aro`, `upsssc_pet` and
 * `other`: exams whose PYQs we ingest because their papers overlap the UPPSC
 * syllabus, but which nobody can select as a target exam and which therefore
 * have no `exams` row at all. Routing this lookup through the registry would
 * either drop those labels or — worse — silently relabel a RO/ARO question as
 * the viewer's own exam. See migration 0106 §4 and lib/exam-config.ts's header.
 *
 * It doubles as the pre-load fallback for {@link shortExamName}: the three
 * product exams appear in both enums, so a target exam always has a label here
 * even before `GET /exams` resolves. That is what keeps the first paint of
 * exam-named copy from flashing an empty string.
 */
export const PROVENANCE_EXAM_LABEL: Record<ExamCode, BilingualText> = {
  uppsc: { en: "UPPSC", hi: "यूपीपीएससी" },
  upsc: { en: "UPSC", hi: "यूपीएससी" },
  mppsc: { en: "MPPSC", hi: "एमपीपीएससी" },
  up_ro_aro: { en: "UP RO/ARO", hi: "यूपी आरओ/एआरओ" },
  upsssc_pet: { en: "UPSSSC PET", hi: "यूपीएसएसएससी पीईटी" },
  other: { en: "Other", hi: "अन्य" },
};

/**
 * The exam's name as it should read INSIDE a sentence ("Browse the {{exam}}
 * syllabus").
 *
 * The registry's `display_name_i18n` is the formal name — "UPPSC (UP PCS)",
 * "एमपीपीएससी (एमपी राज्य सेवा)" — which is right for a picker and wrong mid-
 * sentence. A trailing parenthetical is the only decoration those names carry,
 * so stripping it yields exactly the short form the copy already used
 * ("UPPSC" / "यूपीपीएससी"), with no per-exam abbreviation table to keep in sync.
 *
 * An exam whose formal name has no parenthetical (UPSC's "UPSC Civil Services")
 * keeps its full name. That is deliberate: a wrong-but-shorter guess is worse
 * than a slightly long correct one, and there is nowhere in the registry that
 * carries an authored abbreviation to read instead.
 */
export function shortExamName(exam: Exam | null | undefined, locale: Locale, fallbackCode?: string): string {
  const formal = exam?.display_name_i18n[locale];
  if (formal) {
    const stripped = formal.replace(/\s*\([^()]*\)\s*$/u, "").trim();
    if (stripped) return stripped;
    return formal;
  }
  const code = (exam?.exam_code ?? fallbackCode) as ExamCode | undefined;
  if (code && code in PROVENANCE_EXAM_LABEL) return PROVENANCE_EXAM_LABEL[code][locale];
  return code ?? "";
}
