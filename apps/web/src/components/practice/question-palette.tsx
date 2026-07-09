import { useTranslation } from "react-i18next";
import { Check, Flag } from "lucide-react";
import { cn } from "@/lib/utils";

// "answered_marked" was missing entirely — a normal real usage pattern
// (answer a question, then also mark it to double-check later) previously
// had nowhere to go: test-player.tsx's status computation was a strict
// if/else chain that let "marked" silently win, so the cell's tulsi
// "answered" styling, its Check icon, and its "Answered" aria-label all
// vanished the moment a question was also marked — genuine data loss in the
// display, not just a lower-priority visual cue.
export type QuestionStatus = "answered" | "marked" | "answered_marked" | "unanswered";

function Legend({ swatch, label }: { swatch: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn("size-3 rounded-sm", swatch)} aria-hidden />
      {label}
    </span>
  );
}

export function QuestionPalette({
  count,
  currentIndex,
  statuses,
  onSelect,
}: {
  count: number;
  currentIndex: number;
  statuses: QuestionStatus[];
  onSelect: (index: number) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(2.75rem,1fr))] gap-2">
        {Array.from({ length: count }, (_, i) => {
          const status = statuses[i];
          const isCurrent = i === currentIndex;
          const statusLabel =
            status === "answered_marked"
              ? `${t("Practice.paletteAnswered")}, ${t("Practice.paletteMarked")}`
              : status === "answered"
                ? t("Practice.paletteAnswered")
                : status === "marked"
                  ? t("Practice.paletteMarked")
                  : t("Practice.paletteUnanswered");
          return (
            <button
              key={i}
              type="button"
              onClick={() => onSelect(i)}
              aria-current={isCurrent}
              aria-label={`${t("Practice.paletteGoTo", { number: i + 1 })} — ${statusLabel}`}
              className={cn(
                "relative flex size-11 items-center justify-center rounded-md border text-sm font-semibold tabular-nums outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                // Solid full-opacity fills of --tulsi/--marigold paired with their
                // -foreground text fail contrast (as low as ~1.3:1 in dark mode) —
                // the design system's -foreground tokens are calibrated for the
                // /15-ish tint pairing, not a 100%-opacity fill. A tint + border
                // keeps the "filled cell" read while passing AA in both themes.
                status === "answered" && "border-tulsi/60 bg-tulsi/20 text-tulsi-foreground",
                status === "marked" && "border-marigold/60 bg-marigold/20 text-marigold-foreground",
                // Both cues at once, not one replacing the other: the tulsi
                // fill (still answered) with a marigold border (still marked).
                status === "answered_marked" && "border-marigold/60 bg-tulsi/20 text-tulsi-foreground",
                status === "unanswered" && "border-transparent bg-muted text-muted-foreground",
                isCurrent && "ring-2 ring-primary ring-offset-2 ring-offset-background",
              )}
            >
              {i + 1}
              {/* Non-color state signal for colorblind users scanning the grid —
                  the icon inherits the cell's own text-*-foreground color (via
                  currentColor), so it keeps the exact contrast ratio already
                  verified above rather than introducing a new filled badge. */}
              {(status === "answered" || status === "answered_marked") && (
                <Check
                  className={cn("absolute top-0.5 size-3", status === "answered_marked" ? "left-0.5" : "right-0.5")}
                  aria-hidden
                />
              )}
              {(status === "marked" || status === "answered_marked") && (
                <Flag className="absolute right-0.5 top-0.5 size-3" aria-hidden />
              )}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
        <Legend swatch="bg-tulsi" label={t("Practice.paletteAnswered")} />
        <Legend swatch="bg-marigold" label={t("Practice.paletteMarked")} />
        <Legend swatch="bg-muted" label={t("Practice.paletteUnanswered")} />
      </div>
    </div>
  );
}
