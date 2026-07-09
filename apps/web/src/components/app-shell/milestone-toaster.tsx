import { useEffect, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AnimatePresence, motion } from "framer-motion";
import { Trophy, X } from "lucide-react";
import { useMilestones, useMarkMilestoneSeen } from "@/hooks/use-engagement";
import { useLocale } from "@/hooks/use-locale";

const AUTO_DISMISS_MS = 8000;

/** One toast's own auto-dismiss timer, reset if its content changes. */
function useAutoDismiss(id: string, onDismiss: () => void) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
}

/**
 * Subtle, dismissible achievement toasts. Renders the user's unseen milestones
 * as a bottom-left stack, dismissing one marks it seen server-side so it never
 * reappears. Deliberately quiet — no auto-fireworks, just a small badge.
 *
 * Bottom-LEFT, not bottom-right: the floating "Ask mentor" button and the PWA
 * update toast both live in the bottom-right corner, and a toast tall enough
 * to reach the mentor button's hit area (no auto-dismiss previously) would
 * silently eat clicks meant for it, since it's both higher z-index and
 * pointer-events-auto. Opposite corners make that class of overlap
 * impossible rather than trying to out-stack it with z-index.
 *
 * `bottom-24` (not `bottom-4`) below `md`: the mobile bottom tab bar
 * (`bottom-tab-bar.tsx`, `fixed inset-x-0 bottom-0 h-16`, `md:hidden`) is
 * full-width, so opposite-corner placement alone doesn't clear it — a stack
 * of 2-3 toasts is tall enough that `bottom-4` sits its lower toast(s)
 * directly under/behind the tab bar (confirmed live: a 3-toast stack at
 * 390px measured bottom-4's toasts extending to y=828, well past the tab
 * bar's own top at y=780). Matches `floating-mentor-button.tsx`'s existing
 * `bottom-24 md:bottom-6` convention for the same reason.
 */
export function MilestoneToaster() {
  const { t } = useTranslation();
  const locale = useLocale();
  const { data } = useMilestones();
  const markSeen = useMarkMilestoneSeen();
  const items = (data ?? []).slice(0, 3); // cap the stack

  return (
    <div className="pointer-events-none fixed bottom-24 left-4 z-50 flex w-[calc(100vw-2rem)] max-w-sm flex-col gap-2 md:bottom-4">
      <AnimatePresence>
        {items.map((m) => (
          <MilestoneToast key={m.id} id={m.id} onDismiss={() => markSeen.mutate(m.id)}>
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
          </MilestoneToast>
        ))}
      </AnimatePresence>
    </div>
  );
}

function MilestoneToast({
  id,
  onDismiss,
  children,
}: {
  id: string;
  onDismiss: () => void;
  children: ReactNode;
}) {
  useAutoDismiss(id, onDismiss);
  return (
    <motion.div
      initial={{ opacity: 0, y: 16, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, x: -24 }}
      transition={{ duration: 0.25 }}
      className="pointer-events-auto flex items-start gap-3 rounded-xl border border-marigold/40 bg-card p-3 shadow-lg"
    >
      {children}
    </motion.div>
  );
}
