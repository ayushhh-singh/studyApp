import { CloudOff, RefreshCw } from "lucide-react";
import type { QueueStatus } from "@/lib/offline-queue";
import { cn } from "@/lib/utils";
import { useSukoonLanguage } from "@/sukoon/lib/use-sukoon-language";
import { useSukoonOnline } from "@/sukoon/lib/use-sukoon-online";

/**
 * A calm, unremarkable pill shown only while a journal entry or mood
 * check-in is still queued — never an alarm, never red. Renders nothing once
 * everything has synced (the same "quiet unless there's something to say"
 * baseline as OfflineIndicator). Shared by the journal editor and the mood
 * check-in screen so both features read the same way.
 */
export function SyncQueueIndicator({ status }: { status: QueueStatus }) {
  const { t } = useSukoonLanguage();
  const online = useSukoonOnline();
  if (status === "idle") return null;
  const Icon = online ? RefreshCw : CloudOff;
  return (
    <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
      <Icon className={cn("size-3.5 shrink-0", online && "animate-spin")} aria-hidden />
      {online ? t("Sukoon.sync.syncing") : t("Sukoon.sync.queuedOffline")}
    </div>
  );
}
