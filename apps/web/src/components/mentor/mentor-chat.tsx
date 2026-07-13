import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { Send, Sparkles, ListChecks, Loader2, GraduationCap } from "lucide-react";
import type { DoubtThreadDetail, MentorDepth } from "@neev/shared";
import { mentorQuotaCost } from "@neev/shared";
import { useLocale } from "@/hooks/use-locale";
import { useDoubtThread, useQuizMe } from "@/hooks/use-mentor";
import { useDoubtStream } from "@/hooks/use-doubt-stream";
import { useEntitlements } from "@/hooks/use-billing";
import { queryKeys } from "@/lib/query-keys";
import { Button } from "@/components/ui/button";
import { FirstVisitCoachmark } from "@/components/ui-x/first-visit-coachmark";
import { MentorMessage } from "./mentor-message";
import { cn } from "@/lib/utils";

/**
 * The shared mentor chat surface — a thread's message list + composer, used by
 * both the full /doubts page and the floating slide-over. `nodeId` scopes RAG
 * retrieval to the page's syllabus context when opened from Learn.
 * `seed` supplies page context (the question/note in view) — either pre-filled
 * into the composer for the user to review and send, or sent immediately if
 * `autoSend` is set. `seedTeach`/`seedDepth` come from the "Teach me this" entry
 * points: they open the composer in teacher mode at a given depth and (with
 * autoSend) fire a lesson request straight away. `onNotFound` fires once if the
 * thread turns out not to exist.
 */
const DEPTHS: MentorDepth[] = ["quick", "standard", "in_depth"];

export function MentorChat({
  threadId,
  nodeId,
  seed,
  autoSend = false,
  seedTeach = false,
  seedDepth = "standard",
  onNotFound,
  className,
}: {
  threadId: string;
  nodeId?: string;
  seed?: string;
  autoSend?: boolean;
  seedTeach?: boolean;
  seedDepth?: MentorDepth;
  onNotFound?: () => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  const qc = useQueryClient();
  const detail = useDoubtThread(threadId);
  const stream = useDoubtStream(threadId, locale);
  const quiz = useQuizMe(threadId);
  const entitlements = useEntitlements();

  const [input, setInput] = useState(autoSend ? "" : seed ?? "");
  const [revision, setRevision] = useState(false);
  const [teachMode, setTeachMode] = useState(seedTeach);
  const [depth, setDepth] = useState<MentorDepth>(seedDepth);
  const teachButtonRef = useRef<HTMLButtonElement>(null);
  const [pendingUser, setPendingUser] = useState<string | null>(null);
  // The last dispatched send, so "Answer fresh" can replay it with the cache
  // bypassed (same question, same mode/teach/depth).
  const lastSendRef = useRef<{ content: string; mode: "normal" | "revision"; teach: boolean; depth: MentorDepth } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isPinnedRef = useRef(true);
  const autoSentRef = useRef(false);

  const messages = detail.data?.messages ?? [];

  // Only auto-scroll while the user is pinned to the bottom. Previously every
  // streamed delta yanked the view back down, so scrolling up mid-answer was
  // impossible — now scrolling up un-pins and the stream is left in peace until
  // the user scrolls back to the bottom (or sends a new message).
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    isPinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };
  useEffect(() => {
    if (isPinnedRef.current) {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [messages.length, stream.answer, pendingUser, quiz.isPending, stream.relatedPyqs.length]);

  const busy = stream.isStreaming || quiz.isPending;

  const messagesRemaining = entitlements.data?.mentor_messages.remaining;
  const costOfSend = mentorQuotaCost({ teach: teachMode, depth });
  const overQuota = messagesRemaining !== undefined && messagesRemaining < costOfSend;

  const sendMessage = (
    content: string,
    override?: { teach?: boolean; depth?: MentorDepth; bypassCache?: boolean; mode?: "normal" | "revision" },
  ) => {
    const trimmed = content.trim();
    if (!trimmed || busy) return;
    const teach = override?.teach ?? teachMode;
    const d = override?.depth ?? depth;
    const mode = override?.mode ?? (revision && !teach ? ("revision" as const) : ("normal" as const));
    lastSendRef.current = { content: trimmed, mode, teach, depth: d };
    setInput("");
    setPendingUser(trimmed);
    isPinnedRef.current = true; // sending always jumps to the newest turn
    stream.send(trimmed, {
      mode,
      teach,
      depth: d,
      nodeId,
      bypassCache: override?.bypassCache ?? false,
      onDone: async () => {
        await Promise.all([
          qc.invalidateQueries({ queryKey: queryKeys.doubtThread(threadId) }),
          qc.invalidateQueries({ queryKey: queryKeys.doubtThreads() }),
          qc.invalidateQueries({ queryKey: ["billing", "entitlements"] }),
        ]);
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

  // "Answer fresh" on a similar-doubt reply — replay the same question with the
  // FAQ cache bypassed (which also updates the cached entry, newest wins).
  const answerFresh = () => {
    const last = lastSendRef.current;
    if (last) sendMessage(last.content, { mode: last.mode, teach: last.teach, depth: last.depth, bypassCache: true });
  };

  useEffect(() => {
    if (!autoSend || !seed || autoSentRef.current) return;
    if (detail.isLoading || messages.length > 0) return;
    autoSentRef.current = true;
    sendMessage(seed, { teach: seedTeach, depth: seedDepth });
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

  // The server inserts the user's turn at plan-time (before the stream opens),
  // so a mid-stream refetch of the thread (e.g. window refocus) can pull that
  // persisted turn into `messages` while the transient `pendingUser` bubble is
  // still showing — a duplicate user message. Suppress the transient once the
  // matching persisted turn is the last message.
  const lastMessage = messages[messages.length - 1];
  const pendingPersisted =
    pendingUser != null && lastMessage?.role === "user" && lastMessage.content === pendingUser;

  const askQuiz = () => {
    if (busy) return;
    quiz.mutate();
  };

  const isEmpty = !detail.isLoading && messages.length === 0 && !pendingUser && !stream.isStreaming;

  return (
    <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col", className)}>
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="min-h-0 min-w-0 flex-1 space-y-4 overflow-y-auto overflow-x-hidden px-1 py-2"
      >
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
            message={{ id: m.id, role: m.role, content: m.content, citations: m.citations, meta: m.meta, pageNodeId: nodeId }}
          />
        ))}

        {pendingUser && !doneMessageLanded && !pendingPersisted && (
          <MentorMessage message={{ role: "user", content: pendingUser }} />
        )}
        {(stream.isStreaming || stream.answer) && !stream.error && !doneMessageLanded && (
          <MentorMessage
            message={{
              role: "assistant",
              content: stream.answer,
              citations: stream.citations,
              weak: stream.weak,
              fromCache: stream.fromCache,
              similar: stream.similar,
              onAnswerFresh: answerFresh,
              teacher: stream.teacher,
              relatedPyqs: stream.relatedPyqs,
              quickCheck: stream.quickCheck,
              continueWith: stream.continueWith,
              webSources: stream.webSources,
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
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <FirstVisitCoachmark
            sectionKey="mentor_teach_mode"
            targetRef={teachButtonRef}
            message={t("Explore.coachmarkMentor")}
            dismissLabel={t("Explore.coachmarkGotIt")}
          />
          <Button
            ref={teachButtonRef}
            type="button"
            variant={teachMode ? "default" : "outline"}
            size="xs"
            onClick={() => setTeachMode((v) => !v)}
            aria-pressed={teachMode}
            className={teachMode ? "bg-tulsi text-tulsi-foreground hover:bg-tulsi/90" : ""}
          >
            <GraduationCap className="size-3.5" aria-hidden /> {t("Mentor.teachMe")}
          </Button>
          {!teachMode && (
            <Button
              type="button"
              variant={revision ? "default" : "outline"}
              size="xs"
              onClick={() => setRevision((v) => !v)}
              aria-pressed={revision}
            >
              <ListChecks className="size-3.5" aria-hidden /> {t("Mentor.revisionMode")}
            </Button>
          )}
          <Button type="button" variant="outline" size="xs" onClick={askQuiz} disabled={busy || messages.length === 0}>
            <Sparkles className="size-3.5" aria-hidden /> {t("Mentor.quizMe")}
          </Button>
        </div>

        {teachMode && (
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">{t("Mentor.depth")}</span>
            <div className="inline-flex overflow-hidden rounded-md border border-border">
              {DEPTHS.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDepth(d)}
                  aria-pressed={depth === d}
                  className={cn(
                    "px-2.5 py-1 text-xs font-medium transition-colors",
                    depth === d ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-accent",
                  )}
                >
                  {t(`Mentor.depth_${d}`)}
                </button>
              ))}
            </div>
            {depth === "in_depth" && (
              <span className="text-xs text-marigold-foreground">{t("Mentor.usesTwoMessages")}</span>
            )}
          </div>
        )}

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
            placeholder={teachMode ? t("Mentor.teachPlaceholder") : t("Mentor.placeholder")}
            className="max-h-32 min-h-[2.75rem] flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Button type="button" size="icon" onClick={submit} disabled={busy || !input.trim() || overQuota} aria-label={t("Mentor.send")}>
            <Send className="size-4" aria-hidden />
          </Button>
        </div>
        {overQuota && <p className="mt-1 text-xs text-coral">{t("Mentor.overQuota")}</p>}
      </div>
    </div>
  );
}
