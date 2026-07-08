import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw, WifiOff, X } from "lucide-react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { Button } from "@/components/ui/button";

/**
 * Mounted once at the app root (not inside app-shell, so it also covers the
 * public/auth routes). registerType:'prompt' means a new SW build sits
 * "waiting" until the user explicitly refreshes here — never a silent
 * mid-session swap that could yank state out from under an in-progress test
 * or evaluation stream.
 */
export function PwaUpdateToast() {
  const { t } = useTranslation();
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError: (err) => console.error("SW registration failed", err),
  });

  useEffect(() => {
    if (!offlineReady) return;
    const timer = setTimeout(() => setOfflineReady(false), 4000);
    return () => clearTimeout(timer);
  }, [offlineReady, setOfflineReady]);

  if (needRefresh) {
    return (
      <div className="fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-sm items-center gap-3 rounded-xl border border-border bg-card p-3 shadow-lg sm:inset-x-auto sm:right-4">
        <RefreshCw className="size-4 shrink-0 text-primary" aria-hidden />
        <p className="flex-1 text-sm">{t("Pwa.updateAvailable")}</p>
        <Button type="button" size="sm" onClick={() => updateServiceWorker(true)}>
          {t("Pwa.refresh")}
        </Button>
        <button
          type="button"
          aria-label={t("Notifications.dismiss")}
          className="text-muted-foreground hover:text-foreground"
          onClick={() => setNeedRefresh(false)}
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>
    );
  }

  if (offlineReady) {
    return (
      <div className="fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-sm items-center gap-3 rounded-xl border border-border bg-card p-3 shadow-lg sm:inset-x-auto sm:right-4">
        <WifiOff className="size-4 shrink-0 text-tulsi" aria-hidden />
        <p className="flex-1 text-sm">{t("Pwa.offlineReady")}</p>
      </div>
    );
  }

  return null;
}
