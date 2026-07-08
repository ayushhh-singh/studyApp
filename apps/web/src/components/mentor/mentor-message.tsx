import { useTranslation } from "react-i18next";
import { Sparkles, Zap, Info } from "lucide-react";
import type { MentorCitation, MentorMessageMeta } from "@prayasup/shared";
import { Markdown } from "@/components/ui-x/markdown";
import { CitationChip } from "./citation-chip";
import { QuizCards } from "./quiz-cards";
import { cn } from "@/lib/utils";

export interface MentorMessageView {
  role: "user" | "assistant";
  content: string;
  citations?: MentorCitation[];
  meta?: MentorMessageMeta;
  weak?: boolean;
  fromCache?: boolean;
}

export function MentorMessage({ message }: { message: MentorMessageView }) {
  const { t } = useTranslation();

  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3.5 py-2 text-sm text-primary-foreground">
          {message.content}
        </div>
      </div>
    );
  }

  const quiz = message.meta?.kind === "quiz" ? message.meta.questions ?? [] : null;
  const fromCache = message.fromCache ?? message.meta?.from_cache ?? false;

  return (
    <div className="flex gap-2">
      <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Sparkles className="size-4" aria-hidden />
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        {fromCache && (
          <p className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Zap className="size-3" aria-hidden /> {t("Mentor.fromSimilarDoubt")}
          </p>
        )}
        {quiz ? (
          <>
            <p className="text-sm text-muted-foreground">{t("Mentor.quizIntro")}</p>
            <QuizCards questions={quiz} />
          </>
        ) : (
          message.content && <Markdown content={message.content} />
        )}
        {message.weak && (
          <p className={cn("inline-flex items-start gap-1 rounded-md bg-marigold/10 px-2 py-1 text-xs text-marigold-foreground")}>
            <Info className="mt-0.5 size-3 shrink-0" aria-hidden /> {t("Mentor.notCovered")}
          </p>
        )}
        {message.citations && message.citations.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {message.citations.map((c) => (
              <CitationChip key={c.ref} citation={c} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
