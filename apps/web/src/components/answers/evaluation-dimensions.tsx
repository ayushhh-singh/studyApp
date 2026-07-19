import { motion, useReducedMotion } from "framer-motion";
import { useTranslation } from "react-i18next";
import type { DimensionScoreEvent } from "@neev/shared";
import { ScoreGauge } from "@/components/ui-x/score-gauge";
import { DIMENSION_LABEL_KEYS } from "@/lib/rubric-labels";
import { formatScoreValue } from "@/lib/format-score";

export function EvaluationDimensions({ dimensions }: { dimensions: DimensionScoreEvent[] }) {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
      {dimensions.map((d, i) => (
        <motion.div
          key={d.key}
          initial={reduceMotion ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: reduceMotion ? 0 : i * 0.12, duration: 0.35 }}
          className="flex flex-col items-center gap-2 rounded-xl border border-border bg-card p-4 text-center"
        >
          <ScoreGauge
            value={(d.score / 10) * 100}
            label={`${t(DIMENSION_LABEL_KEYS[d.key])} · ${formatScoreValue(d.score)}/10`}
            size={132}
          />
          <p className="text-xs text-muted-foreground">{d.justification}</p>
        </motion.div>
      ))}
    </div>
  );
}
