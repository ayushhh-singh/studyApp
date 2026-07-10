import { useTranslation } from "react-i18next";
import { Trophy } from "lucide-react";
import type { RankCard as RankCardData } from "@prayasup/shared";

/** "You ranked N of M today/this test" — embedded right after a quiz/mock result. Renders nothing if not applicable. */
export function RankCard({ card }: { card: RankCardData | null | undefined }) {
  const { t } = useTranslation();
  if (!card) return null;

  return (
    <div className="flex items-center justify-center gap-2 rounded-xl border border-marigold/30 bg-marigold/10 px-4 py-3 text-sm font-medium text-marigold-foreground">
      <Trophy className="size-4" aria-hidden />
      {t(card.board_type === "daily_quiz" ? "Scoreboard.rankCardToday" : "Scoreboard.rankCardTest", {
        rank: card.rank,
        participants: card.participants,
      })}
    </div>
  );
}
