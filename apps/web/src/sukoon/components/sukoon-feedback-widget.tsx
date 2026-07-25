import { useState } from "react";
import { ThumbsUp, ThumbsDown, Check } from "lucide-react";
import type { SukoonFeedbackRating, SukoonFeedbackTargetType } from "@neev/shared";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useSukoonLanguage } from "@/sukoon/lib/use-sukoon-language";
import { useSubmitSukoonFeedback } from "@/sukoon/lib/use-sukoon-feedback";

interface SukoonFeedbackWidgetProps {
  targetType: SukoonFeedbackTargetType;
  /** null/omitted only for `general` feedback — every message/journey target needs a real id. */
  targetId?: string | null;
  /** compact: thumbs-only, instant-submit (a Saathi reply under every bubble).
   *  full: thumbs + an always-visible optional note + one Send action (a
   *  completed journey, or the general feedback page). */
  variant?: "compact" | "full";
  /** Shown above the widget in `full` variant only. */
  prompt?: string;
  className?: string;
}

/**
 * Session 14 — the one feedback widget every surface reuses (Saathi replies,
 * journey completions, general app feedback from the beta banner). The server
 * upserts by (user, target_type, target_id) — re-rating the same target never
 * duplicates a row (see 0093 / services/feedback.ts).
 */
export function SukoonFeedbackWidget({
  targetType,
  targetId = null,
  variant = "compact",
  prompt,
  className,
}: SukoonFeedbackWidgetProps) {
  const { t } = useSukoonLanguage();
  const submit = useSubmitSukoonFeedback();
  const [rating, setRating] = useState<SukoonFeedbackRating | null>(null);
  const [note, setNote] = useState("");
  const [noteOpen, setNoteOpen] = useState(variant === "full");
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <p className={cn("flex items-center gap-1.5 text-xs text-muted-foreground", className)}>
        <Check className="size-3.5 text-tulsi" aria-hidden />
        {t("Sukoon.feedback.thanks")}
      </p>
    );
  }

  const canSend = !!rating || note.trim().length > 0;

  const pickRating = (next: SukoonFeedbackRating) => {
    setRating(next);
    if (variant === "compact") {
      submit.mutate(
        { target_type: targetType, target_id: targetId, rating: next, body_text: null },
        { onSuccess: () => setDone(true) },
      );
    }
  };

  const send = () => {
    if (!canSend || submit.isPending) return;
    submit.mutate(
      { target_type: targetType, target_id: targetId, rating, body_text: note.trim() || null },
      { onSuccess: () => setDone(true) },
    );
  };

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {prompt ? <p className="text-sm font-medium text-foreground">{prompt}</p> : null}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          aria-pressed={rating === "up"}
          aria-label={t("Sukoon.feedback.helpful")}
          onClick={() => pickRating("up")}
          className={cn(
            "flex size-8 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            rating === "up" && "border-tulsi bg-tulsi/10 text-tulsi",
          )}
        >
          <ThumbsUp className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          aria-pressed={rating === "down"}
          aria-label={t("Sukoon.feedback.notHelpful")}
          onClick={() => pickRating("down")}
          className={cn(
            "flex size-8 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            rating === "down" && "border-destructive bg-destructive/10 text-destructive",
          )}
        >
          <ThumbsDown className="size-4" aria-hidden />
        </button>
        {variant === "compact" && !noteOpen ? (
          <button
            type="button"
            onClick={() => setNoteOpen(true)}
            className="rounded-full px-2 py-1 text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t("Sukoon.feedback.addNote")}
          </button>
        ) : null}
      </div>
      {noteOpen ? (
        <div className="flex flex-col gap-2">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={1000}
            rows={variant === "full" ? 3 : 2}
            placeholder={t("Sukoon.feedback.notePlaceholder")}
            className="w-full resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Button size="sm" onClick={send} disabled={!canSend || submit.isPending} className="self-start">
            {t("Sukoon.feedback.send")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
