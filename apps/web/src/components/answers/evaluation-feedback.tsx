import { useTranslation } from "react-i18next";
import { Lightbulb, ThumbsUp } from "lucide-react";

export function EvaluationFeedback({
  strengths,
  improvements,
  isStreaming,
}: {
  strengths: string;
  improvements: string;
  isStreaming: boolean;
}) {
  const { t } = useTranslation();
  const strengthsCursor = isStreaming && strengths.length > 0 && improvements.length === 0;
  const improvementsCursor = isStreaming && improvements.length > 0;

  if (!strengths && !improvements) return null;

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="flex flex-col gap-2 rounded-xl border border-tulsi/30 bg-tulsi/5 p-4">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-tulsi-foreground">
          <ThumbsUp className="size-4" aria-hidden />
          {t("Answers.strengthsTitle")}
        </h3>
        <p className="whitespace-pre-line text-sm leading-[1.75]">
          {strengths}
          {strengthsCursor && <span className="animate-pulse">▍</span>}
        </p>
      </div>
      <div className="flex flex-col gap-2 rounded-xl border border-marigold/30 bg-marigold/5 p-4">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-marigold-foreground">
          <Lightbulb className="size-4" aria-hidden />
          {t("Answers.improvementsTitle")}
        </h3>
        <p className="whitespace-pre-line text-sm leading-[1.75]">
          {improvements}
          {improvementsCursor && <span className="animate-pulse">▍</span>}
        </p>
      </div>
    </div>
  );
}
