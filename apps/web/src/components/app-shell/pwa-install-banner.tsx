import { Download, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useInstallPrompt } from "@/hooks/use-install-prompt";

/**
 * Quiet, non-blocking nudge to install the PWA — renders nothing unless the
 * browser has actually fired `beforeinstallprompt` (Chromium-only, and only
 * once genuine installability criteria are met) and the user hasn't already
 * dismissed it once in this browser.
 *
 * Deliberately an inline card at the top of the shell's content area, NOT a
 * fixed-position overlay: bottom-right already holds the floating "Ask
 * mentor" button (bottom-24/right-4 on mobile, bottom-6/right-4 on desktop)
 * and the PWA update toast, and bottom-left holds the milestone toaster — an
 * inline placement can't collide with any of those.
 */
export function PwaInstallBanner() {
  const { t } = useTranslation();
  const { canInstall, promptInstall, dismissed, dismiss } = useInstallPrompt();

  if (!canInstall || dismissed) return null;

  return (
    <div className="mb-4 flex items-center gap-3 rounded-xl border border-border bg-card p-3 shadow-sm">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
        <Download className="size-4" aria-hidden />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm font-semibold">{t("Pwa.installTitle")}</span>
        <span className="text-xs text-muted-foreground">{t("Pwa.installDescription")}</span>
      </div>
      <Button type="button" size="sm" className="shrink-0" onClick={() => void promptInstall()}>
        {t("Pwa.installCta")}
      </Button>
      <button
        type="button"
        aria-label={t("Pwa.installDismiss")}
        className="flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={dismiss}
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}
