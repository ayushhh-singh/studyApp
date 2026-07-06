import { useTranslation } from "react-i18next";
import { Flame } from "lucide-react";
import type { NodeWeightage } from "@prayasup/shared";
import { cn } from "@/lib/utils";

/**
 * A compact per-node weightage indicator: a share bar (how much of the paper's
 * PYQ volume this topic carries) plus a terse "asked N× · last YYYY" label.
 * A flame marks a genuinely hot topic (high recency-weighted frequency). Renders
 * nothing when the topic has never been asked, so cold rows stay clean.
 */
export function WeightageBar({ weightage, className }: { weightage: NodeWeightage | null; className?: string }) {
  const { t } = useTranslation();
  if (!weightage || weightage.total === 0) return null;
  const { total, last_asked_year, share_pct, hotness } = weightage;
  const hot = hotness >= 60;
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div
        className="h-1.5 w-14 shrink-0 overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={t("Learn.weightageShare", { pct: share_pct })}
      >
        <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(share_pct, 4)}%` }} />
      </div>
      <span className="flex items-center gap-1 whitespace-nowrap text-xs text-muted-foreground tabular-nums">
        {hot && <Flame className="size-3 text-coral" aria-hidden />}
        {t("Learn.askedTimes", { count: total })}
        {last_asked_year != null && <span className="opacity-70">· {t("Learn.lastAsked", { year: last_asked_year })}</span>}
      </span>
    </div>
  );
}
