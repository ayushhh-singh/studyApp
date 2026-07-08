import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

/** Compact up/down vote column used on each post — the same mechanism backs "mark helpful" in peer review. */
export function VoteButtons({
  score,
  myVote,
  onVote,
  disabled,
}: {
  score: number;
  myVote: -1 | 0 | 1;
  onVote: (value: -1 | 1) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <button
        type="button"
        aria-label="Upvote"
        aria-pressed={myVote === 1}
        disabled={disabled}
        onClick={() => onVote(1)}
        className={cn(
          "flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-tulsi/10 hover:text-tulsi focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
          myVote === 1 && "bg-tulsi/15 text-tulsi",
        )}
      >
        <ChevronUp className="size-4" aria-hidden />
      </button>
      <span className="min-w-[1.5ch] text-center text-xs font-semibold tabular-nums text-foreground">{score}</span>
      <button
        type="button"
        aria-label="Downvote"
        aria-pressed={myVote === -1}
        disabled={disabled}
        onClick={() => onVote(-1)}
        className={cn(
          "flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-coral/10 hover:text-coral focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
          myVote === -1 && "bg-coral/15 text-coral",
        )}
      >
        <ChevronDown className="size-4" aria-hidden />
      </button>
    </div>
  );
}
