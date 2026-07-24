import { Download, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useInstallPrompt } from "@/hooks/use-install-prompt";
import { useSukoonVisitCount } from "@/sukoon/lib/use-sukoon-visit-count";
import { useSukoonLanguage } from "@/sukoon/lib/use-sukoon-language";

const MIN_VISITS_BEFORE_PROMPT = 3;

/**
 * Standalone-only install nudge (mounted from root.tsx, gated on
 * VITE_APP=sukoon there) — deliberately quieter than Neev's own banner
 * (components/app-shell/pwa-install-banner.tsx): it waits until the 3rd
 * visit before ever showing, so a first-time visitor isn't asked to commit
 * to installing before they know if this calm space is even for them.
 * Reuses hooks/use-install-prompt.ts as-is (same beforeinstallprompt
 * capture/dismiss contract as Neev's banner) — only the "when to show" gate
 * and the presentation are Sukoon's own.
 */
export function SukoonInstallPrompt() {
  const { t } = useSukoonLanguage();
  const { canInstall, promptInstall, dismissed, dismiss } = useInstallPrompt();
  const visits = useSukoonVisitCount();

  if (!canInstall || dismissed || visits < MIN_VISITS_BEFORE_PROMPT) return null;

  return (
    <div className="fixed inset-x-4 bottom-20 z-40 mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-border bg-card p-3 shadow-lg sm:bottom-6">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary/15 text-secondary">
        <Download className="size-4" aria-hidden />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm font-semibold text-foreground">{t("Sukoon.installPrompt.title")}</span>
        <span className="text-xs text-muted-foreground">{t("Sukoon.installPrompt.description")}</span>
      </div>
      <Button type="button" size="sm" className="shrink-0" onClick={() => void promptInstall()}>
        {t("Sukoon.installPrompt.cta")}
      </Button>
      <button
        type="button"
        aria-label={t("Sukoon.installPrompt.dismiss")}
        className="flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={dismiss}
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}
