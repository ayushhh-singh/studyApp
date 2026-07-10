import { cn } from "@/lib/utils";

/**
 * A compact exam-relevance badge — a letter (P / M) followed by 3 dots filled to
 * the 0-3 score, e.g. "P ●●○". Prelims reads primary (blue), mains reads
 * marigold, matching the two-lives framing used across the Current Affairs UI.
 */
export function RelevanceBadge({
  letter,
  score,
  variant,
  title,
}: {
  letter: string;
  score: number;
  variant: "prelims" | "mains";
  title: string;
}) {
  const filled = variant === "prelims" ? "bg-primary" : "bg-marigold";
  const text = variant === "prelims" ? "text-primary" : "text-marigold-foreground";
  return (
    <span
      title={`${title}: ${score}/3`}
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold",
        variant === "prelims" ? "bg-primary/10" : "bg-marigold/15",
        text,
      )}
    >
      {letter}
      <span className="flex gap-0.5" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span key={i} className={cn("size-1.5 rounded-full", i < score ? filled : "bg-current/25")} />
        ))}
      </span>
    </span>
  );
}

/** Both badges in a row, each shown only when its score is present. */
export function RelevanceBadges({
  prelims,
  mains,
  labels,
}: {
  prelims: number | null;
  mains: number | null;
  labels: { prelimsShort: string; mainsShort: string; prelimsTitle: string; mainsTitle: string };
}) {
  if (prelims == null && mains == null) return null;
  return (
    <span className="inline-flex items-center gap-1">
      {prelims != null && (
        <RelevanceBadge letter={labels.prelimsShort} score={prelims} variant="prelims" title={labels.prelimsTitle} />
      )}
      {mains != null && (
        <RelevanceBadge letter={labels.mainsShort} score={mains} variant="mains" title={labels.mainsTitle} />
      )}
    </span>
  );
}
