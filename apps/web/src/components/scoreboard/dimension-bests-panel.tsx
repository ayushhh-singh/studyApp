import { useTranslation } from "react-i18next";
import { Trophy } from "lucide-react";
import type { DimensionBestBoard, RubricDimensionKey } from "@neev/shared";
import { SectionCard } from "@/components/ui-x/section-card";
import { EmptyState } from "@/components/ui-x/empty-state";
import { cn } from "@/lib/utils";
import { DIMENSION_LABEL_KEYS } from "@/lib/rubric-labels";

export function DimensionBestsPanel({ boards }: { boards: DimensionBestBoard[] }) {
  const { t } = useTranslation();
  const nonEmpty = boards.filter((b) => b.rows.length > 0);

  if (nonEmpty.length === 0) {
    return (
      <EmptyState
        icon={Trophy}
        title={t("Scoreboard.emptyBoardTitle")}
        description={t("Scoreboard.emptyBoardDescription")}
      />
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {nonEmpty.map((board) => (
        <SectionCard key={board.dimension} title={t(DIMENSION_LABEL_KEYS[board.dimension as RubricDimensionKey])}>
          <ol className="flex flex-col gap-1.5 text-sm">
            {board.rows.map((row) => (
              <li
                key={`${board.dimension}-${row.rank}-${row.handle ?? "anon"}-${row.is_you ? "you" : row.score}`}
                className={cn(
                  "flex items-center justify-between gap-2 rounded-md px-2 py-1",
                  row.is_you && "bg-primary/10",
                )}
              >
                <span className="flex items-center gap-2">
                  <span className="w-5 text-right font-semibold tabular-nums text-muted-foreground">{row.rank}</span>
                  <span className={cn(row.is_you && "font-semibold")}>{row.handle ?? t("Scoreboard.anonymous")}</span>
                  {row.is_you && <span className="text-xs text-muted-foreground">{t("Scoreboard.you")}</span>}
                </span>
                <span className="tabular-nums text-muted-foreground">{Math.round(row.score * 10) / 10}</span>
              </li>
            ))}
          </ol>
        </SectionCard>
      ))}
    </div>
  );
}
