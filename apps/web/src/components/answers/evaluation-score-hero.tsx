import { useTranslation } from "react-i18next";
import { motion, useReducedMotion } from "framer-motion";
import { AlertTriangle } from "lucide-react";
import { ScoreGauge } from "@/components/ui-x/score-gauge";
import { useCountUp } from "@/hooks/use-count-up";

export function EvaluationScoreHero({
  overallScore,
  maxScore,
  isOffTopic,
  overallComment,
}: {
  overallScore: number;
  maxScore: number;
  isOffTopic: boolean;
  overallComment: string;
}) {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();
  const pct = maxScore > 0 ? (overallScore / maxScore) * 100 : 0;
  const animatedPct = useCountUp(pct);
  const animatedScore = useCountUp(overallScore);

  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card p-6 shadow-sm sm:flex-row sm:items-center sm:justify-center sm:gap-8"
    >
      <div className="flex flex-col items-center gap-1">
        <ScoreGauge value={animatedPct} label={t("Answers.overallScoreLabel")} size={200} />
        <span className="font-display text-2xl tabular-nums text-muted-foreground">
          {(animatedScore ?? 0).toFixed(1)}
          <span className="text-base">/{maxScore}</span>
        </span>
      </div>
      <div className="flex max-w-md flex-col gap-2 text-center sm:text-start">
        {isOffTopic && (
          <span className="inline-flex w-fit items-center gap-1.5 self-center rounded-full bg-coral/15 px-2.5 py-1 text-xs font-semibold text-coral-foreground sm:self-start">
            <AlertTriangle className="size-3.5" aria-hidden />
            {t("Answers.offTopicWarning")}
          </span>
        )}
        <p className="text-sm text-muted-foreground">{overallComment}</p>
      </div>
    </motion.div>
  );
}
