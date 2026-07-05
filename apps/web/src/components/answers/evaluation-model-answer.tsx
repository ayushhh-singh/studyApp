import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp } from "lucide-react";
import { SectionCard } from "@/components/ui-x/section-card";
import { Button } from "@/components/ui/button";

export function EvaluationModelAnswer({
  yourAnswer,
  modelAnswer,
  isStreaming,
}: {
  yourAnswer: string;
  modelAnswer: string;
  isStreaming: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  if (!modelAnswer && !isStreaming) return null;

  return (
    <SectionCard
      title={t("Answers.modelAnswerTitle")}
      action={
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen((o) => !o)}>
          {open ? <ChevronUp aria-hidden /> : <ChevronDown aria-hidden />}
          {open ? t("Answers.modelAnswerCollapse") : t("Answers.modelAnswerExpand")}
        </Button>
      }
    >
      {open && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("Answers.yourAnswerLabel")}
            </h4>
            <p className="whitespace-pre-line rounded-lg bg-muted/50 p-3 text-sm leading-[1.75]">{yourAnswer}</p>
          </div>
          <div className="flex flex-col gap-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-tulsi">
              {t("Answers.modelAnswerLabel")}
            </h4>
            <p className="whitespace-pre-line rounded-lg bg-tulsi/5 p-3 text-sm leading-[1.75]">
              {modelAnswer}
              {isStreaming && <span className="animate-pulse">▍</span>}
            </p>
          </div>
        </div>
      )}
    </SectionCard>
  );
}
