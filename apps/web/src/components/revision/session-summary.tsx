import { useTranslation } from "react-i18next";
import { CheckCircle2 } from "lucide-react";
import type { SrsRating } from "@prayasup/shared";
import { Button } from "@/components/ui/button";

const RATING_LABEL: Record<SrsRating, string> = {
  1: "Revision.again",
  2: "Revision.hard",
  3: "Revision.good",
  4: "Revision.easy",
};
// text-*-foreground, not the raw --coral/--marigold/--tulsi tokens: at this
// size (text-xl, not bold-large enough to drop to the 3:1 UI-text floor in
// every case) the raw tokens read as low as ~2.1:1 on a light card.
const RATING_COLOR: Record<SrsRating, string> = {
  1: "text-coral-foreground",
  2: "text-marigold-foreground",
  3: "text-primary",
  4: "text-tulsi-foreground",
};

export function SessionSummary({
  ratings,
  total,
  onDone,
}: {
  ratings: Partial<Record<SrsRating, number>>;
  total: number;
  onDone: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-6 bg-background p-6 text-center">
      <span className="flex size-16 items-center justify-center rounded-full bg-tulsi/15 text-tulsi">
        <CheckCircle2 className="size-8" aria-hidden />
      </span>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold">{t("Revision.sessionComplete")}</h1>
        <p className="text-sm text-muted-foreground">{t("Revision.sessionCompleteDescription", { count: total })}</p>
      </div>
      <div className="grid grid-cols-4 gap-3">
        {([1, 2, 3, 4] as SrsRating[]).map((rating) => (
          <div key={rating} className="flex flex-col items-center gap-1 rounded-lg border border-border bg-card px-3 py-2">
            <span className={`text-xl font-bold tabular-nums ${RATING_COLOR[rating]}`}>{ratings[rating] ?? 0}</span>
            <span className="text-[10px] text-muted-foreground">{t(RATING_LABEL[rating])}</span>
          </div>
        ))}
      </div>
      <Button onClick={onDone}>{t("Revision.backToRevision")}</Button>
    </div>
  );
}
