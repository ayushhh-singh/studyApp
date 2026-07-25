import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { motion, useReducedMotion } from "framer-motion";
import { HeartHandshake, X } from "lucide-react";
import { useLocale } from "@/hooks/use-locale";
import { useSukoonBetaVisible } from "@/sukoon/lib/use-sukoon-beta";
import { Button } from "@/components/ui/button";

const HARD_SCORE_PCT_THRESHOLD = 40;
const DISMISS_STORAGE_PREFIX = "sukoon-eval-nudge-dismissed:";

function isDismissed(submissionId: string): boolean {
  try {
    return localStorage.getItem(`${DISMISS_STORAGE_PREFIX}${submissionId}`) === "1";
  } catch {
    return false;
  }
}

function persistDismiss(submissionId: string) {
  try {
    localStorage.setItem(`${DISMISS_STORAGE_PREFIX}${submissionId}`, "1");
  } catch {
    // localStorage unavailable (private mode / quota) — the nudge just
    // reappears next visit, which is a harmless degrade, not a broken feature.
  }
}

/**
 * A soft, optional, always-dismissible bridge to Sukoon after a hard
 * evaluation score — never framed as a consequence of the score, never a
 * modal. Teal-tinted like the landing page's Wellness Companion card so it
 * visually reads as "a different, optional track," not another study CTA.
 * Gated behind useSukoonBetaVisible() so it never appears for a user who
 * can't reach Sukoon at all. Dismissal is per-submission (localStorage) —
 * closing it never reappears for that specific evaluation, but a genuinely
 * new hard result later gets its own chance to offer this.
 */
export function SukoonCheckinNudge({
  submissionId,
  overallScore,
  maxScore,
  isOffTopic,
}: {
  submissionId: string;
  overallScore: number;
  maxScore: number;
  isOffTopic: boolean;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  const reduceMotion = useReducedMotion();
  const sukoonBetaVisible = useSukoonBetaVisible();
  // Tracks only the id most recently dismissed IN THIS RENDER SESSION, not a
  // one-shot "is this submission dismissed" flag — the route element for
  // /answers/evaluation/:submissionId is reused across param changes (e.g.
  // clicking between two results in submission-history-list.tsx never
  // remounts this component), so a plain `useState(() => isDismissed(id))`
  // initializer would only ever run once and leak a dismiss on evaluation A
  // into evaluation B. Comparing against the CURRENT submissionId on every
  // render, alongside a fresh localStorage read, keeps this correct across
  // both a full reload (localStorage) and an in-session id switch (state).
  const [justDismissedId, setJustDismissedId] = useState<string | null>(null);
  const dismissed = justDismissedId === submissionId || isDismissed(submissionId);

  const pct = maxScore > 0 ? (overallScore / maxScore) * 100 : 0;
  const isHardScore = pct <= HARD_SCORE_PCT_THRESHOLD;

  if (!sukoonBetaVisible || isOffTopic || !isHardScore || dismissed) return null;

  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className="flex items-center gap-3 rounded-2xl border border-[#4FB3A9]/30 bg-[#4FB3A9]/8 px-4 py-3"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#4FB3A9]/15 text-[#2E2A5E]">
        <HeartHandshake className="size-4.5" aria-hidden />
      </span>
      <p className="min-w-0 flex-1 text-sm text-foreground">{t("Answers.sukoonNudgeText")}</p>
      <Button asChild variant="outline" size="sm" className="shrink-0 border-[#4FB3A9]/40">
        <Link to={`/${locale}/sukoon`}>{t("Answers.sukoonNudgeCta")}</Link>
      </Button>
      <button
        type="button"
        onClick={() => {
          persistDismiss(submissionId);
          setJustDismissedId(submissionId);
        }}
        aria-label={t("Answers.sukoonNudgeDismiss")}
        className="flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="size-4" aria-hidden />
      </button>
    </motion.div>
  );
}
