import { AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Shown when a query genuinely FAILED (network blip, rate limit, transient
 * 5xx) rather than legitimately returning no data — the two must never
 * collapse into the same generic empty-state copy, or a transient failure
 * reads to the user as "your data is gone" (confirmed live: a rate-limited
 * fetch on Current Affairs rendered the exact "no current affairs yet" copy
 * a genuinely empty catalog would, with 49 real published items hidden
 * behind it; the Answers hub did the same with real submission history).
 * Visually distinct from EmptyState (coral, not neutral) for the same
 * reason — an error should look different, not just read different.
 */
export function QueryErrorState({
  onRetry,
  title,
  description,
  className,
}: {
  onRetry: () => void;
  title?: string;
  description?: string;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center gap-3 rounded-xl border border-coral/30 bg-coral/5 px-6 py-12 text-center",
        className,
      )}
    >
      <AlertTriangle className="size-8 text-coral" aria-hidden />
      <div className="flex flex-col gap-1">
        <p className="text-sm font-semibold text-foreground">{title ?? t("Common.loadErrorTitle")}</p>
        <p className="mx-auto max-w-sm text-sm text-muted-foreground">
          {description ?? t("Common.loadErrorDescription")}
        </p>
      </div>
      <Button type="button" variant="outline" size="sm" onClick={onRetry}>
        {t("Common.retry")}
      </Button>
    </div>
  );
}
