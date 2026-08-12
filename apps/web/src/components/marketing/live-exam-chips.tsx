import { useTranslation } from "react-i18next";
import { useExams } from "@/hooks/use-exams";
import { useLocale } from "@/hooks/use-locale";
import { shortExamName } from "@/lib/exam-label";
import { cn } from "@/lib/utils";

/**
 * "Built for: UPSC Civil Services · UPPSC (UP PCS)" — the exam names on the
 * public marketing pages, read from the exam REGISTRY rather than written into
 * the copy.
 *
 * This exists because the marketing copy used to say "UPPSC only" in ~20
 * places, which stopped being true the day `exams.upsc.is_live` flipped
 * (2026-08-11). Naming exams in translated strings means every launch is a
 * copy edit in two languages that somebody has to remember; naming them here
 * means a launch is the one-row `is_live` update it already is.
 *
 * Renders NOTHING until the registry resolves, and nothing if it fails. That
 * is deliberate on a PRERENDERED page (`scripts/prerender.mjs` snapshots the
 * pre-fetch DOM): the surrounding copy is written to stand on its own without
 * this line, so a crawler that never runs the fetch sees complete, honest
 * prose rather than a dangling "Built for" label. Never add a hardcoded
 * fallback list here — that would reintroduce exactly the drift this removes.
 */
export function LiveExamChips({
  className,
  /** Off where the surrounding sentence already introduces the list (the FAQ's "these are live today:"). */
  showLabel = true,
}: {
  className?: string;
  showLabel?: boolean;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  const { data: exams } = useExams();

  const live = (exams ?? []).filter((e) => e.is_live).sort((a, b) => a.sort_order - b.sort_order);
  if (live.length === 0) return null;

  return (
    <div className={cn("flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm", className)}>
      {showLabel ? <span className="text-muted-foreground">{t("Landing.builtFor")}</span> : null}
      {live.map((exam) => (
        <span
          key={exam.exam_code}
          className="rounded-full border border-border bg-card px-2.5 py-0.5 text-xs font-semibold text-foreground"
        >
          {shortExamName(exam, locale)}
        </span>
      ))}
    </div>
  );
}
