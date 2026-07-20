import { useTranslation } from "react-i18next";
import { Check, Flag } from "lucide-react";
import { cn } from "@/lib/utils";

// The real NTA CBT convention (NEET/CUET/JEE) uses five distinct states, not
// four — "not visited" and "visited but not answered" are different signals
// (the latter tells a student they looked at it and skipped it, the former
// that they haven't reached it yet). "answered_marked" stays its own state
// too: a question the student answered but still flagged to double-check —
// real exams count it toward the score (unlike pure "marked"), so collapsing
// it into "marked" would misrepresent what actually happens on submit.
export type QuestionStatus = "not_visited" | "visited_not_answered" | "answered" | "marked" | "answered_marked";

function Legend({
  swatch,
  border,
  label,
  icons,
}: {
  swatch: string;
  border: string;
  label: string;
  icons?: React.ReactNode;
}) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn("relative flex size-3 items-center justify-center rounded-sm border", swatch, border)} aria-hidden>
        {icons}
      </span>
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

  function statusLabelFor(status: QuestionStatus): string {
    switch (status) {
      case "answered_marked":
        return t("Practice.paletteAnsweredMarked");
      case "answered":
        return t("Practice.paletteAnswered");
      case "marked":
        return t("Practice.paletteMarked");
      case "visited_not_answered":
        return t("Practice.paletteVisitedNotAnswered");
      case "not_visited":
        return t("Practice.paletteNotVisited");
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(2.75rem,1fr))] gap-2">
        {Array.from({ length: count }, (_, i) => {
          const status = statuses[i];
          const isCurrent = i === currentIndex;
          const statusLabel = statusLabelFor(status);
          return (
            <button
              key={i}
              type="button"
              onClick={() => onSelect(i)}
              aria-current={isCurrent}
              aria-label={`${t("Practice.paletteGoTo", { number: i + 1 })} — ${statusLabel}`}
              className={cn(
                "relative flex size-11 items-center justify-center rounded-md border text-sm font-semibold tabular-nums outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                // Solid full-opacity fills of a token paired with its -foreground
                // text fail contrast (as low as ~1.3:1 in dark mode) — the design
                // system's -foreground tokens are calibrated for a /15-/20-ish
                // tint pairing, not a 100%-opacity fill. A tint + border keeps the
                // "filled cell" read while passing AA in both themes (verified
                // computationally for the new violet token, matching the existing
                // tulsi/marigold/coral pattern).
                status === "answered" && "border-tulsi/60 bg-tulsi/20 text-tulsi-foreground",
                // Marked-for-review is purple/violet per the NTA convention — a
                // hue far from both the red (not-answered) and green (answered)
                // states, so it stays distinguishable under red-green color
                // vision deficiency without relying on color alone (see the icon
                // and border-style cues below).
                status === "marked" && "border-violet/60 bg-violet/20 text-violet-foreground",
                status === "answered_marked" && "border-violet/60 bg-violet/20 text-violet-foreground",
                status === "visited_not_answered" && "border-coral/60 bg-coral/20 text-coral-foreground",
                // Not-visited gets its own dashed border (not just a flat grey
                // fill) so it's distinguishable from "visited, not answered" by
                // shape/pattern too, not only by hue — a second non-color cue
                // for the pair a colorblind user is most likely to conflate.
                status === "not_visited" && "border-dashed border-border bg-muted text-muted-foreground",
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
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold text-foreground">{t("Practice.paletteLegendHeading")}</span>
        <div className="flex flex-wrap gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
          <Legend swatch="bg-muted" border="border-dashed border-border" label={t("Practice.paletteNotVisited")} />
          <Legend swatch="bg-coral/20" border="border-coral/60" label={t("Practice.paletteVisitedNotAnswered")} />
          <Legend
            swatch="bg-tulsi/20"
            border="border-tulsi/60"
            label={t("Practice.paletteAnswered")}
            icons={<Check className="size-2 text-tulsi-foreground" aria-hidden />}
          />
          <Legend
            swatch="bg-violet/20"
            border="border-violet/60"
            label={t("Practice.paletteMarked")}
            icons={<Flag className="size-2 text-violet-foreground" aria-hidden />}
          />
          <Legend
            swatch="bg-violet/20"
            border="border-violet/60"
            label={t("Practice.paletteAnsweredMarked")}
            icons={<Check className="size-2 text-violet-foreground" aria-hidden />}
          />
        </div>
      </div>
    </div>
  );
}
