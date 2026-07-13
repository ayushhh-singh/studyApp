import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { Brain } from "lucide-react";
import type { SrsQueueCard } from "@neev/shared";
import { EmptyState } from "@/components/ui-x/empty-state";
import { Button } from "@/components/ui/button";
import { ReviewPlayer } from "@/components/revision/review-player";
import { useSrsDueQueue } from "@/hooks/use-srs";
import { useLocale } from "@/hooks/use-locale";

export function Component() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const locale = useLocale();
  const { data, isLoading } = useSrsDueQueue();

  // Snapshot the queue once at session start. Rating a card invalidates the
  // `srs` query family (so the header stats stay fresh), which would otherwise
  // refetch this same query in the background mid-session and silently shrink
  // or reorder the `cards` array out from under the player.
  const [session, setSession] = useState<SrsQueueCard[] | null>(null);
  useEffect(() => {
    if (data && session === null) setSession(data.cards);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  function exit() {
    navigate(`/${locale}/revision`);
  }

  if (isLoading || (data && session === null)) return null;

  if (!session || session.length === 0) {
    return (
      <div className="flex h-dvh items-center justify-center p-6">
        <EmptyState
          icon={Brain}
          title={t("Revision.noDueCards")}
          description={t("Revision.noDueCardsDescription")}
          action={<Button onClick={exit}>{t("Revision.backToRevision")}</Button>}
        />
      </div>
    );
  }

  return <ReviewPlayer cards={session} locale={locale} onExit={exit} />;
}
