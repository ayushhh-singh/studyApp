import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { Flame } from "lucide-react";

/**
 * Subtle combo flame — appears only at 3+ consecutive correct, pops once on each
 * increment. Below 3 it renders nothing, so a miss (reset to 0) just quietly
 * removes it rather than flashing a "you lost your streak" message.
 */
export function ComboFlame({ combo }: { combo: number }) {
  const { t } = useTranslation();
  const reduce = useReducedMotion();

  return (
    <AnimatePresence>
      {combo >= 3 && (
        <motion.span
          key="combo"
          initial={reduce ? false : { scale: 0.6, opacity: 0 }}
          animate={reduce ? { opacity: 1 } : { scale: 1, opacity: 1 }}
          exit={reduce ? { opacity: 0 } : { scale: 0.6, opacity: 0 }}
          className="inline-flex items-center gap-1 rounded-full bg-marigold/15 px-2.5 py-1 text-sm font-bold tabular-nums text-marigold-foreground"
          aria-label={t("Practice.combo", { count: combo })}
        >
          <motion.span
            key={combo}
            initial={reduce ? false : { scale: 1.4 }}
            animate={{ scale: 1 }}
            transition={{ duration: 0.25 }}
            className="inline-flex items-center gap-1"
          >
            <Flame className="size-4 text-marigold" aria-hidden />
            {combo}
          </motion.span>
        </motion.span>
      )}
    </AnimatePresence>
  );
}
