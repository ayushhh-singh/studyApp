import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

export type QuestionStatus = "answered" | "marked" | "unanswered";

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
          return (
            <button
              key={i}
              type="button"
              onClick={() => onSelect(i)}
              aria-current={isCurrent}
              aria-label={t("Practice.paletteGoTo", { number: i + 1 })}
              className={cn(
                "flex size-11 items-center justify-center rounded-md text-sm font-semibold tabular-nums outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                status === "answered" && "bg-tulsi text-tulsi-foreground",
                status === "marked" && "bg-marigold text-marigold-foreground",
                status === "unanswered" && "bg-muted text-muted-foreground",
                isCurrent && "ring-2 ring-primary ring-offset-2 ring-offset-background",
              )}
            >
              {i + 1}
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
