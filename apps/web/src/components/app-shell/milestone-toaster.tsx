import { useTranslation } from "react-i18next";
import { AnimatePresence, motion } from "framer-motion";
import { Trophy, X } from "lucide-react";
import { useMilestones, useMarkMilestoneSeen } from "@/hooks/use-engagement";
import { useLocale } from "@/hooks/use-locale";

/**
 * Subtle, dismissible achievement toasts. Renders the user's unseen milestones
 * as a bottom-right stack; dismissing one marks it seen server-side so it never
 * reappears. Deliberately quiet — no auto-fireworks, just a small badge.
 */
export function MilestoneToaster() {
  const { t } = useTranslation();
  const locale = useLocale();
  const { data } = useMilestones();
  const markSeen = useMarkMilestoneSeen();
  const items = (data ?? []).slice(0, 3); // cap the stack

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[calc(100vw-2rem)] max-w-sm flex-col gap-2">
      <AnimatePresence>
        {items.map((m) => (
          <motion.div
            key={m.id}
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: 24 }}
            transition={{ duration: 0.25 }}
            className="pointer-events-auto flex items-start gap-3 rounded-xl border border-marigold/40 bg-card p-3 shadow-lg"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-marigold/15 text-marigold">
              <Trophy className="size-4" aria-hidden />
            </span>
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-sm font-semibold">{m.title_i18n[locale]}</span>
              <span className="text-xs text-muted-foreground">{m.body_i18n[locale]}</span>
            </div>
            <button
              type="button"
              aria-label={t("Milestones.dismiss")}
              className="flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => markSeen.mutate(m.id)}
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
