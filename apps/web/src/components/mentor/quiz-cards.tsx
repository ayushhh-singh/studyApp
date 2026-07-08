import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, X, BookmarkPlus, BookmarkCheck } from "lucide-react";
import type { MentorQuizQuestion } from "@prayasup/shared";
import { useLocale } from "@/hooks/use-locale";
import { useCreateSrsCard } from "@/hooks/use-srs";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * In-thread "quiz me" cards — 3 ephemeral MCQs (never persisted to the bank).
 * Tap an option to reveal the answer + explanation; a wrong answer offers to
 * save the question to spaced-revision.
 */
function QuizCard({ q, index }: { q: MentorQuizQuestion; index: number }) {
  const locale = useLocale();
  const { t } = useTranslation();
  const [picked, setPicked] = useState<string | null>(null);
  const createCard = useCreateSrsCard();
  const [saved, setSaved] = useState(false);

  const correct = picked === q.correct_option_key;
  const correctOption = q.options.find((o) => o.key === q.correct_option_key);

  const save = () => {
    const back = {
      en: [`Answer: ${q.correct_option_key}. ${correctOption?.text_i18n.en ?? ""}`, q.explanation_i18n.en]
        .filter(Boolean)
        .join("\n\n"),
      hi: [`उत्तर: ${q.correct_option_key}. ${correctOption?.text_i18n.hi ?? ""}`, q.explanation_i18n.hi]
        .filter(Boolean)
        .join("\n\n"),
    };
    createCard.mutate({ front_i18n: q.stem_i18n, back_i18n: back }, { onSuccess: () => setSaved(true) });
  };

  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <p className="mb-2 text-sm font-medium">
        {index + 1}. {q.stem_i18n[locale]}
      </p>
      <div className="flex flex-col gap-1.5">
        {q.options.map((o) => {
          const isCorrect = o.key === q.correct_option_key;
          const isPicked = picked === o.key;
          return (
            <button
              key={o.key}
              type="button"
              disabled={picked !== null}
              onClick={() => setPicked(o.key)}
              className={cn(
                "flex items-center gap-2 rounded-md border px-2.5 py-2 text-left text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default",
                picked === null && "border-border hover:bg-accent",
                picked !== null && isCorrect && "border-tulsi/40 bg-tulsi/10 text-tulsi-foreground",
                picked !== null && isPicked && !isCorrect && "border-coral/40 bg-coral/10 text-coral-foreground",
                picked !== null && !isCorrect && !isPicked && "border-border opacity-60",
              )}
            >
              <span className="font-semibold">{o.key}.</span>
              <span className="flex-1">{o.text_i18n[locale]}</span>
              {picked !== null && isCorrect && <Check className="size-4 text-tulsi" aria-hidden />}
              {picked !== null && isPicked && !isCorrect && <X className="size-4 text-coral" aria-hidden />}
            </button>
          );
        })}
      </div>
      {picked !== null && (
        <div className="mt-2 space-y-2">
          <p className="text-xs text-muted-foreground">{q.explanation_i18n[locale]}</p>
          {!correct &&
            (saved ? (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-tulsi">
                <BookmarkCheck className="size-3.5" aria-hidden /> {t("Mentor.savedToRevision")}
              </span>
            ) : (
              <Button variant="outline" size="xs" onClick={save} disabled={createCard.isPending}>
                <BookmarkPlus className="size-3.5" aria-hidden /> {t("Mentor.saveToRevision")}
              </Button>
            ))}
        </div>
      )}
    </div>
  );
}

export function QuizCards({ questions }: { questions: MentorQuizQuestion[] }) {
  return (
    <div className="flex flex-col gap-2">
      {questions.map((q, i) => (
        <QuizCard key={i} q={q} index={i} />
      ))}
    </div>
  );
}
