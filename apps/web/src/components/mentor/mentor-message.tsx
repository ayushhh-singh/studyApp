import { useTranslation } from "react-i18next";
import { Sparkles, Zap, Info, GraduationCap, RefreshCw } from "lucide-react";
import type {
  MentorCitation,
  MentorContinueNode,
  MentorMessageMeta,
  MentorPyqRef,
  MentorQuizQuestion,
  MentorWebSource,
} from "@prayasup/shared";
import { Markdown } from "@/components/ui-x/markdown";
import { CitationChip } from "./citation-chip";
import { QuizCards } from "./quiz-cards";
import { TeacherExtras } from "./teacher-extras";
import { SaveAsMaterial } from "./save-as-material";
import { cn } from "@/lib/utils";

export interface MentorMessageView {
  role: "user" | "assistant";
  content: string;
  citations?: MentorCitation[];
  meta?: MentorMessageMeta;
  weak?: boolean;
  fromCache?: boolean;
  /** A "from a similar doubt" (0.86–0.95) reply — shows the notice + "Answer fresh". */
  similar?: boolean;
  /** When provided (live bubble only), renders a one-tap "Answer fresh" on a similar-doubt reply. */
  onAnswerFresh?: () => void;
  /** Persisted message id — enables "Save as study material" (omitted for the live bubble). */
  id?: string;
  /** Page-context node (Learn/CA) → default topic for save-as-material. */
  pageNodeId?: string;
  // Live teacher extras (used only for the streaming bubble; persisted messages read meta).
  teacher?: boolean;
  relatedPyqs?: MentorPyqRef[];
  quickCheck?: MentorQuizQuestion[];
  continueWith?: MentorContinueNode[];
  webSources?: MentorWebSource[];
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

  const kind = message.meta?.kind;
  const quiz = kind === "quiz" ? message.meta?.questions ?? [] : null;
  // A silent (>=0.95) cache hit shows nothing; only a "similar doubt" (0.86–0.95)
  // reply carries the notice + "Answer fresh".
  const similar = message.similar ?? message.meta?.similar ?? false;
  const isTeacher = message.teacher || kind === "teacher";

  // Teacher extras come from meta (persisted) or the live props (streaming bubble).
  const relatedPyqs = message.relatedPyqs ?? message.meta?.related_pyqs;
  const quickCheck = message.quickCheck ?? message.meta?.quick_check;
  const continueWith = message.continueWith ?? message.meta?.continue_with;
  const webSources = message.webSources ?? message.meta?.web_sources;

  return (
    <div className="flex gap-2">
      <div className={cn(
        "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full",
        isTeacher ? "bg-tulsi/15 text-tulsi" : "bg-primary/10 text-primary",
      )}>
        {isTeacher ? <GraduationCap className="size-4" aria-hidden /> : <Sparkles className="size-4" aria-hidden />}
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        {isTeacher && (
          <p className="inline-flex items-center gap-1 text-xs font-medium text-tulsi">
            <GraduationCap className="size-3" aria-hidden /> {t("Mentor.teacherBadge")}
          </p>
        )}
        {similar && (
          <p className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Zap className="size-3" aria-hidden /> {t("Mentor.fromSimilarDoubt")}
            </span>
            {message.onAnswerFresh && (
              <button
                type="button"
                onClick={message.onAnswerFresh}
                className="inline-flex items-center gap-1 font-medium text-primary underline-offset-2 hover:underline"
              >
                <RefreshCw className="size-3" aria-hidden /> {t("Mentor.answerFresh")}
              </button>
            )}
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
        {isTeacher && (
          <TeacherExtras
            relatedPyqs={relatedPyqs}
            quickCheck={quickCheck}
            continueWith={continueWith}
            webSources={webSources}
          />
        )}
        {/* "Save as study material" — on any persisted mentor answer (not the
            quiz cards, and not the still-streaming live bubble). */}
        {message.id && kind !== "quiz" && message.content.trim() && (
          <SaveAsMaterial messageId={message.id} defaultNodeId={message.meta?.node_id ?? message.pageNodeId ?? undefined} />
        )}
      </div>
    </div>
  );
}
