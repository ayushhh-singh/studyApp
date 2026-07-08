import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Ghost } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Quiet "past you" marker for Ghost Battle. Past-you's position comes from the
 * cumulative per-question times of the original attempt: at elapsed E, they've
 * finished every question whose cumulative time is <= E. Deliberately understated
 * — a nudge to keep pace, never a taunt.
 */
export function GhostMarker({
  startedAt,
  cumulativeSeconds,
  total,
  yourIndex,
}: {
  startedAt: string;
  cumulativeSeconds: number[];
  total: number;
  yourIndex: number;
}) {
  const { t } = useTranslation();
  const [elapsed, setElapsed] = useState(() => (Date.now() - new Date(startedAt).getTime()) / 1000);

  useEffect(() => {
    const id = setInterval(() => setElapsed((Date.now() - new Date(startedAt).getTime()) / 1000), 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  // Questions past-you has finished by now (their known per-question pace).
  const ghostDone = cumulativeSeconds.filter((c) => c <= elapsed).length;
  const ghostAt = Math.min(ghostDone + 1, total); // the question they're working on
  // "yourIndex" is 0-based on the question you're viewing; +1 to compare 1-based.
  const ahead = yourIndex + 1 > ghostAt;
  const behind = yourIndex + 1 < ghostAt;

  return (
    <span
      className={cn(
        "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium tabular-nums",
        ahead ? "bg-tulsi/15 text-tulsi-foreground" : behind ? "bg-coral/15 text-coral-foreground" : "bg-muted text-muted-foreground",
      )}
      title={t("Ghost.markerTitle")}
    >
      <Ghost className="size-3.5" aria-hidden />
      {t("Ghost.marker", { n: ghostAt, total })}
    </span>
  );
}
