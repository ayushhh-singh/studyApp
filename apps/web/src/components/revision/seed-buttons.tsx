import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useSeedNoteFacts, useSeedWrongAnswers } from "@/hooks/use-srs";

/**
 * The two one-tap seeds against the user's real data (never sample/placeholder
 * cards) — idempotent, so re-running after cards already exist just reports
 * "already added" for anything not new. Shared between the empty state (first
 * run) and the Manage tab (so the seeds stay reachable once the deck isn't
 * empty anymore — the Review tab drops its empty state after the first card).
 */
export function SeedButtons() {
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
    <div className="flex flex-col items-center gap-2">
      <div className="flex flex-wrap justify-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => handleSeed(seedWrong, "Revision.seedWrongAnswersResult", "Revision.seedWrongAnswersEmpty")}
          disabled={seedWrong.isPending}
        >
          {t("Revision.seedWrongAnswers")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => handleSeed(seedNotes, "Revision.seedNoteFactsResult", "Revision.seedNoteFactsEmpty")}
          disabled={seedNotes.isPending}
        >
          {t("Revision.seedNoteFacts")}
        </Button>
      </div>
      {message && <p className="text-sm font-medium text-tulsi">{message}</p>}
    </div>
  );
}
