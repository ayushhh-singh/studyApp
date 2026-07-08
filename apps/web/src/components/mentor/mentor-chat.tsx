import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { Send, Sparkles, ListChecks, Loader2 } from "lucide-react";
import { useLocale } from "@/hooks/use-locale";
import { useDoubtThread, useQuizMe } from "@/hooks/use-mentor";
import { useDoubtStream } from "@/hooks/use-doubt-stream";
import { queryKeys } from "@/lib/query-keys";
import { Button } from "@/components/ui/button";
import { MentorMessage } from "./mentor-message";
import { cn } from "@/lib/utils";

/**
 * The shared mentor chat surface — a thread's message list + composer, used by
 * both the full /doubts page and the floating slide-over. `nodeId` scopes RAG
 * retrieval to the page's syllabus context when opened from Learn.
 * `seed` pre-fills the composer with page context (the note/question in view).
 */
export function MentorChat({
  threadId,
  nodeId,
  seed,
  className,
}: {
  threadId: string;
  nodeId?: string;
  seed?: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  const qc = useQueryClient();
  const detail = useDoubtThread(threadId);
  const stream = useDoubtStream(threadId, locale);
  const quiz = useQuizMe(threadId);

  const [input, setInput] = useState(seed ?? "");
  const [revision, setRevision] = useState(false);
  const [pendingUser, setPendingUser] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const messages = detail.data?.messages ?? [];

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, stream.answer, pendingUser, quiz.isPending]);

  const busy = stream.isStreaming || quiz.isPending;

  const submit = () => {
    const content = input.trim();
    if (!content || busy) return;
    setInput("");
    setPendingUser(content);
    stream.send(content, {
      mode: revision ? "revision" : "normal",
      nodeId,
      onDone: async () => {
        await Promise.all([
          qc.invalidateQueries({ queryKey: queryKeys.doubtThread(threadId) }),
          qc.invalidateQueries({ queryKey: queryKeys.doubtThreads() }),
        ]);
        stream.reset();
        setPendingUser(null);
      },
    });
  };

  const askQuiz = () => {
    if (busy) return;
    quiz.mutate();
  };

  const isEmpty = messages.length === 0 && !pendingUser && !stream.isStreaming;

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-1 py-2">
        {isEmpty && (
          <div className="flex h-full flex-col items-center justify-center gap-2 py-8 text-center text-muted-foreground">
            <Sparkles className="size-8 text-primary" aria-hidden />
            <p className="text-sm font-medium text-foreground">{t("Mentor.emptyTitle")}</p>
            <p className="max-w-xs text-xs">{t("Mentor.emptyHint")}</p>
          </div>
        )}

        {messages.map((m) => (
          <MentorMessage
            key={m.id}
            message={{ role: m.role, content: m.content, citations: m.citations, meta: m.meta }}
          />
        ))}

        {/* In-flight turn */}
        {pendingUser && <MentorMessage message={{ role: "user", content: pendingUser }} />}
        {stream.isStreaming && (
          <MentorMessage
            message={{
              role: "assistant",
              content: stream.answer,
              citations: stream.citations,
              weak: stream.weak,
              fromCache: stream.fromCache,
            }}
          />
        )}
        {stream.isStreaming && !stream.answer && (
          <p className="flex items-center gap-2 pl-9 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" aria-hidden />
            {t(`Mentor.phase_${stream.phase ?? "thinking"}`)}
          </p>
        )}
        {quiz.isPending && (
          <p className="flex items-center gap-2 pl-9 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" aria-hidden /> {t("Mentor.buildingQuiz")}
          </p>
        )}
        {stream.error && <p className="pl-9 text-xs text-coral">{stream.error}</p>}
      </div>

      <div className="border-t border-border pt-2">
        <div className="mb-2 flex items-center gap-2">
          <Button
            type="button"
            variant={revision ? "default" : "outline"}
            size="xs"
            onClick={() => setRevision((v) => !v)}
            aria-pressed={revision}
          >
            <ListChecks className="size-3.5" aria-hidden /> {t("Mentor.revisionMode")}
          </Button>
          <Button type="button" variant="outline" size="xs" onClick={askQuiz} disabled={busy || messages.length === 0}>
            <Sparkles className="size-3.5" aria-hidden /> {t("Mentor.quizMe")}
          </Button>
        </div>
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={2}
            placeholder={t("Mentor.placeholder")}
            className="max-h-32 min-h-[2.75rem] flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Button type="button" size="icon" onClick={submit} disabled={busy || !input.trim()} aria-label={t("Mentor.send")}>
            <Send className="size-4" aria-hidden />
          </Button>
        </div>
      </div>
    </div>
  );
}
