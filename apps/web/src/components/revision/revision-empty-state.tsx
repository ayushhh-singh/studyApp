import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Brain } from "lucide-react";
import { EmptyState } from "@/components/ui-x/empty-state";
import { Button } from "@/components/ui/button";
import { useSeedNoteFacts, useSeedWrongAnswers } from "@/hooks/use-srs";

/**
 * Teaches the feature and offers two one-tap seeds against the user's real
 * data — never sample/placeholder cards.
 */
export function RevisionEmptyState() {
  const { t } = useTranslation();
  const seedWrong = useSeedWrongAnswers();
  const seedNotes = useSeedNoteFacts();
  const [message, setMessage] = useState<string | null>(null);

  function handleSeed(mutation: typeof seedWrong, foundKey: string, emptyKey: string) {
    setMessage(null);
    mutation.mutate(undefined, {
      onSuccess: (result) => {
        const total = result.added + result.already;
        setMessage(total === 0 ? t(emptyKey) : t(foundKey, { count: result.added }));
      },
    });
  }

  return (
    <EmptyState
      icon={Brain}
      title={t("Revision.emptyTitle")}
      description={t("Revision.emptyDescription")}
      action={
        <div className="flex flex-col items-center gap-3">
          <div className="flex flex-wrap justify-center gap-2">
            <Button
              variant="outline"
              onClick={() => handleSeed(seedWrong, "Revision.seedWrongAnswersResult", "Revision.seedWrongAnswersEmpty")}
              disabled={seedWrong.isPending}
            >
              {t("Revision.seedWrongAnswers")}
            </Button>
            <Button
              variant="outline"
              onClick={() => handleSeed(seedNotes, "Revision.seedNoteFactsResult", "Revision.seedNoteFactsEmpty")}
              disabled={seedNotes.isPending}
            >
              {t("Revision.seedNoteFacts")}
            </Button>
          </div>
          {message && <p className="text-sm font-medium text-tulsi">{message}</p>}
        </div>
      }
    />
  );
}
