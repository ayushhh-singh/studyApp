import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { Send, Sparkles, ListChecks, Loader2 } from "lucide-react";
import type { DoubtThreadDetail } from "@prayasup/shared";
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
 * `seed` supplies page context (the question/note in view) — either pre-filled
 * into the composer for the user to review and send, or sent immediately if
 * `autoSend` is set (the "Ask a doubt" flow: the mentor should already be
 * answering by the time the page appears, not sitting with unsent text the
 * user has to notice and click). `onNotFound` fires once if the thread turns
 * out not to exist (e.g. a deleted or invalid id in the URL).
 */
export function MentorChat({
  threadId,
  nodeId,
  seed,
  autoSend = false,
  onNotFound,
  className,
}: {
  threadId: string;
  nodeId?: string;
  seed?: string;
  autoSend?: boolean;
  onNotFound?: () => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  const qc = useQueryClient();
  const detail = useDoubtThread(threadId);
  const stream = useDoubtStream(threadId, locale);
  const quiz = useQuizMe(threadId);

  const [input, setInput] = useState(autoSend ? "" : seed ?? "");
  const [revision, setRevision] = useState(false);
  const [pendingUser, setPendingUser] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const autoSentRef = useRef(false);

  const messages = detail.data?.messages ?? [];

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, stream.answer, pendingUser, quiz.isPending]);

  const busy = stream.isStreaming || quiz.isPending;

  const sendMessage = (content: string) => {
    const trimmed = content.trim();
    if (!trimmed || busy) return;
    setInput("");
    setPendingUser(trimmed);
    stream.send(trimmed, {
      mode: revision ? "revision" : "normal",
      nodeId,
      onDone: async () => {
        await Promise.all([
          qc.invalidateQueries({ queryKey: queryKeys.doubtThread(threadId) }),
          qc.invalidateQueries({ queryKey: queryKeys.doubtThreads() }),
        ]);
        // invalidateQueries() resolves once the triggered refetch settles —
        // including when that refetch itself errored (TanStack Query doesn't
        // reject here). Only clear the transient streamed bubble once the
        // assistant's turn is confirmed to have actually landed in the
        // refetched messages; otherwise a flaky refetch would make the
        // just-completed exchange silently vanish (both the question and the
        // streamed answer gone, with nothing having taken their place). The
        // render below independently suppresses the transient bubble once the
        // persisted message shows up, so leaving it visible here never risks
        // a duplicate — worst case it just stays until a later successful
        // refetch (e.g. next thread open) picks up what the server already persisted.
        const refreshed = qc.getQueryData<DoubtThreadDetail>(queryKeys.doubtThread(threadId));
        const landed = stream.doneMessageId != null && refreshed?.messages.some((m) => m.id === stream.doneMessageId);
        if (landed) {
          stream.reset();
          setPendingUser(null);
        }
      },
    });
  };

  const submit = () => sendMessage(input);

  // Auto-send the seeded doubt once the thread is confirmed genuinely empty —
  // gated on the thread detail having actually loaded (not just `seed` being
  // present) so this can never fire twice for a thread that already has real
  // history (e.g. revisiting a previously-seeded thread's bookmarked URL).
  useEffect(() => {
    if (!autoSend || !seed || autoSentRef.current) return;
    if (detail.isLoading || messages.length > 0) return;
    autoSentRef.current = true;
    sendMessage(seed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSend, seed, detail.isLoading, messages.length]);

  const notifiedNotFoundRef = useRef(false);
  useEffect(() => {
    if (detail.isError && !notifiedNotFoundRef.current) {
      notifiedNotFoundRef.current = true;
      onNotFound?.();
    }
  }, [detail.isError, onNotFound]);

  const doneMessageLanded =
    stream.doneMessageId != null && messages.some((m) => m.id === stream.doneMessageId);

  const askQuiz = () => {
    if (busy) return;
    quiz.mutate();
  };

  const isEmpty = !detail.isLoading && messages.length === 0 && !pendingUser && !stream.isStreaming;

  return (
    <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col", className)}>
      <div ref={scrollRef} className="min-h-0 min-w-0 flex-1 space-y-4 overflow-y-auto overflow-x-hidden px-1 py-2">
        {/* Previously this briefly flashed the "ask me anything" empty state
            for an EXISTING thread with real history, since `messages` reads
            [] while the thread's first fetch is still in flight. */}
        {detail.isLoading && (
          <div className="flex flex-col gap-3 px-1 py-2">
            <div className="h-10 w-2/3 animate-pulse self-end rounded-2xl bg-muted" />
            <div className="h-16 w-3/4 animate-pulse rounded-2xl bg-muted" />
          </div>
        )}
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

        {/* In-flight turn. The assistant block is gated on `answer` (not
            isStreaming) so the streamed text stays visible between the `done`
            event and the refetch landing — otherwise it would blink out.
            Also suppressed once doneMessageLanded, so if onDone's own refetch
            check above ever lags behind this render, the persisted message
            list and the transient bubble can never show the same turn twice. */}
        {pendingUser && !doneMessageLanded && <MentorMessage message={{ role: "user", content: pendingUser }} />}
        {(stream.isStreaming || stream.answer) && !stream.error && !doneMessageLanded && (
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
