import { WifiOff } from "lucide-react";
import { useSukoonLanguage } from "@/sukoon/lib/use-sukoon-language";
import { useSukoonOnline } from "@/sukoon/lib/use-sukoon-online";

/** A small banner shown across F6 when offline — the grid + cached configs
 *  still work; only un-pinned audio is unavailable (see sukoon-audio-cache.ts). */
export function OfflineIndicator() {
  const online = useSukoonOnline();
  const { t } = useSukoonLanguage();
  if (online) return null;
  return (
    <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
      <WifiOff className="size-3.5 shrink-0" aria-hidden />
      {t("Sukoon.tools.offlineBanner")}
    </div>
  );
}
