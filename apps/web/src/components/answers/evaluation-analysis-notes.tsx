import { useTranslation } from "react-i18next";
import type { AnalysisEvent } from "@prayasup/shared";
import { SectionCard } from "@/components/ui-x/section-card";

export function EvaluationAnalysisNotes({ analysis }: { analysis: AnalysisEvent }) {
  const { t } = useTranslation();
  if (analysis.missed_key_points.length === 0 && analysis.factual_errors.length === 0) return null;

  return (
    <SectionCard title={t("Answers.analysisNotesTitle")}>
      <div className="grid gap-4 sm:grid-cols-2">
        {analysis.missed_key_points.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("Answers.missedKeyPointsTitle")}
            </h4>
            <ul className="flex list-disc flex-col gap-1 pl-4 text-sm">
              {analysis.missed_key_points.map((point, i) => (
                <li key={i}>{point}</li>
              ))}
            </ul>
          </div>
        )}
        {analysis.factual_errors.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-coral">
              {t("Answers.factualErrorsTitle")}
            </h4>
            <ul className="flex flex-col gap-1.5 text-sm">
              {analysis.factual_errors.map((e, i) => (
                <li key={i}>
                  <span className="italic">&ldquo;{e.quote}&rdquo;</span> — {e.issue}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </SectionCard>
  );
}
