import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { History, Loader2, Lock, Mic, Plus, Send, Sparkles, Wind } from "lucide-react";
import type { SukoonCrisisLevel } from "@neev/shared";
import { useAuth } from "@/providers/auth-provider";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui-x/sheet";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import { useSukoonLanguage } from "@/sukoon/lib/use-sukoon-language";
import { useSukoonProfile } from "@/sukoon/lib/use-sukoon-profile";
import { useSukoonPaywallStore } from "@/sukoon/stores/sukoon-paywall-store";
import { NotTherapyFooter } from "@/sukoon/components/not-therapy-footer";
import { CrisisInlineCard } from "@/sukoon/components/crisis-inline-card";
import { CrisisTakeover } from "@/sukoon/components/crisis-takeover";
import { ExamEveJourneyCard } from "@/sukoon/components/journeys/exam-eve-journey-card";
import { MoodPatternNudge } from "@/sukoon/components/mood-pattern-nudge";
import { SukoonFeedbackWidget } from "@/sukoon/components/sukoon-feedback-widget";
import { daysUntil } from "@/sukoon/lib/days-until";
import { useTrackSukoonFeatureView } from "@/sukoon/lib/use-sukoon-analytics";
import {
  useSaathiConversations,
  useSaathiHistory,
  useSaathiStream,
  useSaathiUsage,
  type SaathiSettled,
} from "@/sukoon/lib/use-sukoon-chat";
import { useVoiceUsage } from "@/sukoon/lib/use-sukoon-voice";

interface ChatMsg {
  id: string;
  role: "user" | "assistant";
  content: string;
  crisis_level: SukoonCrisisLevel | null;
}

/**
 * Rotating conversation starters (blueprint F2): time-of-day + exam-proximity
 * aware, bilingual via i18n keys. Returns ~4 starter keys.
 */
function pickStarterKeys(hour: number, daysToExam: number | null): string[] {
  const keys: string[] = [];
  if (daysToExam != null && daysToExam >= 0 && daysToExam <= 1) keys.push("examTomorrow");
  else if (daysToExam != null && daysToExam > 1 && daysToExam <= 7) keys.push("examSoon");

  if (hour >= 22 || hour < 5) keys.push("night");
  else if (hour < 12) keys.push("morning");
  else if (hour < 17) keys.push("afternoon");
  else keys.push("evening");

  keys.push("general1", "general2");
  return keys.slice(0, 4).map((k) => `Sukoon.saathi.starters.${k}`);
}

export function Component() {
  const { t, language: uiLang } = useSukoonLanguage();
  const { locale } = useParams<{ locale?: string }>();
  const base = locale ? `/${locale}/sukoon` : "";
  const [searchParams, setSearchParams] = useSearchParams();
  const { session, loading: authLoading } = useAuth();
  const queryClient = useQueryClient();
  useTrackSukoonFeatureView("saathi");

  const profileQuery = useSukoonProfile({ enabled: !!session });
  const profile = profileQuery.data?.profile ?? null;
  const restricted = profile?.restricted_mode ?? false;

  // History LOAD target: undefined = latest, string = a picked conversation.
  // `freshThread` = the user started a new chat → don't seed from history.
  const [loadId, setLoadId] = useState<string | undefined>(undefined);
  const [freshThread, setFreshThread] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [takeoverOpen, setTakeoverOpen] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // The id to CONTINUE on send (decoupled from the load target so a fresh
  // thread keeps its locally-built messages after the server mints its id).
  const threadIdRef = useRef<string | null>(null);
  const optimisticIdRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const canChat = !!session && !restricted;
  const historyQuery = useSaathiHistory(loadId, { enabled: canChat && !freshThread });
  const usageQuery = useSaathiUsage({ enabled: canChat });
  const conversationsQuery = useSaathiConversations({ enabled: canChat && drawerOpen });
  const voiceUsageQuery = useVoiceUsage({ enabled: canChat });
  const stream = useSaathiStream();

  // Seed the message list from the loaded conversation (skip for a fresh thread).
  useEffect(() => {
    if (freshThread) return;
    const data = historyQuery.data;
    if (!data) return;
    setMessages(
      data.messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        crisis_level: m.crisis_level,
      })),
    );
    threadIdRef.current = data.conversation?.id ?? null;
  }, [historyQuery.data, freshThread]);

  // Autoscroll to the newest content.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, stream.reply, stream.isStreaming]);

  const usage = usageQuery.data;
  const capReached = !!usage && usage.remaining <= 0;
  const openPaywall = useSukoonPaywallStore((s) => s.openPaywall);
  // A free/plus user can move to a higher tier for more daily messages; a Pro
  // user is already at the top, so the cap banner stays a gentle notice for them.
  const canUpgradeFromCap = capReached && usage?.tier !== "pro";

  const onDone = useCallback(
    (r: SaathiSettled) => {
      threadIdRef.current = r.conversationId ?? threadIdRef.current;

      if (r.outcome === "cap") {
        // The turn produced nothing — roll back the optimistic user bubble.
        const optimisticId = optimisticIdRef.current;
        setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
      } else if (r.outcome === "takeover") {
        setTakeoverOpen(true); // keep the user message; the AI never replies to a crisis
      } else if (r.outcome === "error") {
        setSendError(r.error ?? t("Sukoon.saathi.errorGeneric"));
      } else {
        setMessages((prev) => [
          ...prev,
          {
            id: r.doneMessageId ?? `a-${Date.now()}`,
            role: "assistant",
            content: r.reply,
            crisis_level: r.crisisLevel,
          },
        ]);
      }

      queryClient.invalidateQueries({ queryKey: queryKeys.sukoonChatUsage() });
      queryClient.invalidateQueries({ queryKey: queryKeys.sukoonConversations() });
      stream.reset();
    },
    [queryClient, stream, t],
  );

  const handleSend = useCallback(
    (text: string) => {
      const content = text.trim();
      if (!content || stream.isStreaming || capReached) return;
      setSendError(null);
      const optimisticId = `u-${Date.now()}`;
      optimisticIdRef.current = optimisticId;
      setMessages((prev) => [...prev, { id: optimisticId, role: "user", content, crisis_level: null }]);
      setInput("");
      stream.send(content, threadIdRef.current, { onDone });
    },
    [stream, capReached, onDone],
  );

  const startNewChat = useCallback(() => {
    stream.reset();
    setFreshThread(true);
    setLoadId(undefined);
    setMessages([]);
    setSendError(null);
    setTakeoverOpen(false);
    threadIdRef.current = null;
    setDrawerOpen(false);
  }, [stream]);

  const openConversation = useCallback((id: string) => {
    stream.reset();
    setFreshThread(false);
    setLoadId(id);
    setSendError(null);
    setDrawerOpen(false);
  }, [stream]);

  const starterKeys = useMemo(
    () => pickStarterKeys(new Date().getHours(), daysUntil(profile?.exam_date ?? null)),
    [profile?.exam_date],
  );

  // A journey's saathi_checkin step deep-links in via `?seed=` (blueprint F7:
  // "deep-links into Saathi with a context seed message") — sent as the FIRST
  // user turn of a fresh thread, exactly like tapping a starter chip. Fires
  // once (seededRef guards StrictMode's double-invoke + any later re-render)
  // and strips the param afterward so a refresh/back-nav never re-sends it.
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current || !canChat) return;
    const seed = searchParams.get("seed");
    if (!seed) return;
    seededRef.current = true;
    startNewChat();
    handleSend(seed);
    const next = new URLSearchParams(searchParams);
    next.delete("seed");
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canChat, searchParams]);

  // Restricted (under-18) — no open chat; a friendly tools screen instead (F1/F3).
  // Safe to check before `authLoading`: `restricted` derives from `profile`,
  // which is null until profileQuery has data, so it never reads true during
  // the loading window.
  if (restricted) {
    return <RestrictedScreen locale={locale} />;
  }
  // Signed out — Sukoon pages are reachable pre-login, but chat needs an
  // account. Check `authLoading` first: `session` is null until the initial
  // getSession() resolves, and profileQuery is DISABLED while signed out, so
  // its isPending never flips (a disabled query never fetches) — the old
  // `!session && !profileQuery.isPending` combination could never be true,
  // meaning SignInScreen never rendered for a genuinely signed-out visitor.
  if (authLoading) return null;
  if (!session) {
    return <SignInScreen locale={locale} />;
  }

  // `isLoading` (not `isPending`) so a DISABLED query — e.g. signed-out, or a
  // fresh thread — never spins forever: isPending stays true for a disabled
  // query, isLoading is true only while actually fetching.
  const historyLoading = historyQuery.isLoading;
  // A load failure must never be masked as "start a new chat" — without the
  // isError guard, an errored historyQuery still flips historyLoading false
  // with zero messages, which showStarters previously read as a genuinely
  // fresh/empty thread.
  const historyFailed = historyQuery.isError && !freshThread;
  const showStarters =
    messages.length === 0 && !stream.isStreaming && !stream.reply && !historyLoading && !historyFailed;
  const composerDisabled = stream.isStreaming || capReached;

  return (
    <div className="mx-auto flex min-h-[calc(100svh-13rem)] max-w-2xl flex-col" lang={uiLang}>
      {/* Header row: title + new chat + history */}
      <div className="mb-4 flex items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold tracking-tight">{t("Sukoon.saathiTitle")}</h1>
          <p className="text-sm text-muted-foreground">{t("Sukoon.saathiSub")}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {/* F10 Voice Mode entry point. Eligible (Pro) → a real link into the
              full-screen voice screen; free/plus → a locked badge that opens
              the shared upgrade sheet, same "with upsell" pattern as F6/F7's
              premium content locks. Rendered only once the eligibility check
              has actually resolved — no flash of the wrong state. */}
          {voiceUsageQuery.data?.eligible ? (
            <Button asChild variant="ghost" size="sm" className="gap-1.5">
              <Link to={`${base}/saathi/voice`}>
                <Mic className="size-4" aria-hidden />
                <span className="hidden sm:inline">{t("Sukoon.saathi.voiceEntry")}</span>
              </Link>
            </Button>
          ) : voiceUsageQuery.data && !voiceUsageQuery.data.eligible ? (
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-muted-foreground"
              onClick={() => openPaywall("voice")}
            >
              <Lock className="size-3.5" aria-hidden />
              <span className="hidden sm:inline">{t("Sukoon.saathi.voiceEntry")}</span>
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" className="gap-1.5" onClick={startNewChat}>
            <Plus className="size-4" aria-hidden />
            <span className="hidden sm:inline">{t("Sukoon.saathi.newChat")}</span>
          </Button>
          <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-1.5">
                <History className="size-4" aria-hidden />
                <span className="hidden sm:inline">{t("Sukoon.saathi.history")}</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="right" title={t("Sukoon.saathi.history")}>
              <HistoryDrawer
                onPick={openConversation}
                activeId={threadIdRef.current}
                loading={conversationsQuery.isPending}
                conversations={conversationsQuery.data ?? []}
                emptyLabel={t("Sukoon.saathi.historyEmpty")}
                nowLabel={t("Sukoon.saathi.untitledChat")}
              />
            </SheetContent>
          </Sheet>
        </div>
      </div>

      {/* Exam-eve surfacing (blueprint F7): only alongside a fresh/empty
          thread, so an active conversation isn't interrupted by it. */}
      {showStarters ? <ExamEveJourneyCard className="mb-4" /> : null}

      {/* Proactive bridge (F5×F6): only on a fresh/empty thread, so an active
          conversation is never interrupted. Self-hides unless a real declining
          trend is detected. The "talk to Saathi" CTA is redundant here. */}
      {showStarters ? <MoodPatternNudge hideSaathiCta className="mb-4" /> : null}

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto pb-4">
        {historyLoading && !freshThread ? (
          <div className="flex justify-center py-10">
            <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label={t("Sukoon.saathi.loading")} />
          </div>
        ) : null}

        {historyFailed ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <p className="max-w-xs text-sm text-destructive">{t("Sukoon.saathi.historyLoadError")}</p>
            <Button variant="outline" size="sm" onClick={() => void historyQuery.refetch()}>
              {t("Sukoon.pricing.retry")}
            </Button>
          </div>
        ) : null}

        {showStarters ? (
          // Chat is a CALM surface (it can turn crisis-adjacent), so it keeps
          // the teal accent and never the warm joy one — only a slow, gentle
          // entrance is added, nothing celebratory.
          <div className="sukoon-rise flex flex-col items-center gap-5 py-8 text-center">
            <span className="flex size-14 items-center justify-center rounded-full bg-secondary/15 text-secondary" aria-hidden>
              <Sparkles className="size-7" />
            </span>
            <p className="max-w-xs text-sm leading-relaxed text-muted-foreground">
              {t("Sukoon.saathi.welcome")}
            </p>
            <div className="flex w-full flex-col gap-2">
              {starterKeys.map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => handleSend(t(key))}
                  className="min-h-11 rounded-2xl border border-border bg-card px-4 py-3 text-left text-sm leading-snug transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {t(key)}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {messages.map((m) =>
          m.role === "assistant" ? (
            <div key={m.id} className="sukoon-rise space-y-2">
              {/* Crisis card stays full-width, above the avatar row. */}
              {m.crisis_level === "moderate" ? <CrisisInlineCard /> : null}
              <AssistantRow>
                <AssistantBubble text={m.content} />
                {/* Session 14 — thumbs feedback on every REAL (persisted) reply;
                    the synthetic "a-<timestamp>" fallback id never round-tripped
                    to a real message row, so skip it rather than feedback that
                    can't attach to anything server-side. */}
                {!m.id.startsWith("a-") ? (
                  <SukoonFeedbackWidget targetType="message" targetId={m.id} className="pl-1" />
                ) : null}
              </AssistantRow>
            </div>
          ) : (
            <UserBubble key={m.id} text={m.content} />
          ),
        )}

        {/* Live streaming bubble (hidden for a takeover, which carries no reply) */}
        {(stream.isStreaming || stream.reply) && stream.crisisSurface !== "takeover" ? (
          <div className="sukoon-rise space-y-2">
            {stream.crisisSurface === "inline" ? <CrisisInlineCard /> : null}
            <AssistantRow breathing>
              {stream.reply ? (
                <AssistantBubble text={stream.reply} streaming />
              ) : (
                <ThinkingBubble label={t("Sukoon.saathi.thinking")} />
              )}
            </AssistantRow>
          </div>
        ) : null}

        {sendError ? (
          <p role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 px-3.5 py-2.5 text-sm text-destructive">
            {sendError}
          </p>
        ) : null}
      </div>

      {/* Cap-reached banner (gentle, upgrade hint — no paywall yet) */}
      {capReached ? (
        <div className="mb-3 rounded-2xl border border-secondary/30 bg-secondary/5 px-4 py-3 text-sm leading-relaxed">
          <p className="font-medium text-foreground">{t("Sukoon.saathi.capTitle")}</p>
          <p className="mt-1 text-muted-foreground">
            {t("Sukoon.saathi.capBody", { limit: usage?.limit ?? 0 })}
          </p>
          {canUpgradeFromCap ? (
            <Button
              size="sm"
              variant="outline"
              className="mt-3"
              onClick={() => openPaywall("chat_cap")}
            >
              {t("Sukoon.paywall.seePlans")}
            </Button>
          ) : null}
        </div>
      ) : null}

      {/* Composer */}
      <Composer
        value={input}
        onChange={setInput}
        onSend={() => handleSend(input)}
        disabled={composerDisabled}
        hardBlocked={capReached}
        placeholder={
          capReached ? t("Sukoon.saathi.capComposer") : t("Sukoon.saathi.composerPlaceholder")
        }
        remainingLabel={
          usage && usage.remaining <= 5 && usage.remaining > 0
            ? t("Sukoon.saathi.remaining", { count: usage.remaining })
            : null
        }
        sendLabel={t("Sukoon.saathi.send")}
      />

      <NotTherapyFooter className="mt-4" />

      <CrisisTakeover open={takeoverOpen} onAcknowledge={() => setTakeoverOpen(false)} />
    </div>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="sukoon-rise flex justify-end">
      <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-secondary px-4 py-2.5 text-sm leading-relaxed text-secondary-foreground shadow-sm">
        {text}
      </div>
    </div>
  );
}

/**
 * The small Saathi presence beside every assistant reply — echoes the Sukoon
 * ripple mark (concentric rings + teal core) so the companion feels like it's
 * sitting beside the person, not a faceless widget. `breathing` gives it a
 * barely-there "present and listening" pulse while a reply is being composed.
 * Purely decorative (aria-hidden) — the bubble text is the accessible content.
 */
function SaathiAvatar({ breathing }: { breathing?: boolean }) {
  return (
    <span
      className={cn(
        "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary/15 text-secondary ring-1 ring-secondary/20",
        breathing && "sukoon-avatar-breathe",
      )}
      aria-hidden
    >
      <svg viewBox="0 0 40 40" className="size-5">
        <circle cx="20" cy="20" r="16" fill="none" stroke="currentColor" strokeWidth="2.5" opacity="0.3" />
        <circle cx="20" cy="20" r="10.5" fill="none" stroke="currentColor" strokeWidth="2.5" opacity="0.55" />
        <circle cx="20" cy="20" r="5" fill="currentColor" />
      </svg>
    </span>
  );
}

/** Avatar + a content column — the shared shape for every assistant turn (a
 *  persisted reply, or the live streaming/thinking bubble). */
function AssistantRow({ children, breathing }: { children: ReactNode; breathing?: boolean }) {
  return (
    <div className="flex items-start gap-2.5">
      <SaathiAvatar breathing={breathing} />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">{children}</div>
    </div>
  );
}

function AssistantBubble({ text, streaming }: { text: string; streaming?: boolean }) {
  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-bl-md border border-border bg-card px-4 py-2.5 text-sm leading-relaxed text-foreground shadow-sm">
        {text}
        {/* A slim teal caret at the tail of the live text — the reply feels
            written-to-you, not pasted. Only while streaming with text present. */}
        {streaming ? (
          <span
            className="sukoon-caret ml-0.5 inline-block h-[1.05em] w-0.5 translate-y-[0.15em] rounded-full bg-secondary align-baseline"
            aria-hidden
          />
        ) : null}
      </div>
    </div>
  );
}

/** The "gathering their words" indicator — three softly breathing dots (never
 *  the generic snappy bounce), shown before the first token arrives. */
function ThinkingBubble({ label }: { label: string }) {
  return (
    <div className="flex justify-start">
      <div
        className="flex items-center gap-1.5 rounded-2xl rounded-bl-md border border-border bg-card px-4 py-3 shadow-sm"
        role="status"
        aria-label={label}
      >
        <span className="sukoon-think-dot size-1.5 rounded-full bg-secondary" />
        <span className="sukoon-think-dot size-1.5 rounded-full bg-secondary [animation-delay:0.2s]" />
        <span className="sukoon-think-dot size-1.5 rounded-full bg-secondary [animation-delay:0.4s]" />
      </div>
    </div>
  );
}

function Composer({
  value,
  onChange,
  onSend,
  disabled,
  hardBlocked,
  placeholder,
  remainingLabel,
  sendLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  /** Send is blocked (streaming or capped) — but composing stays allowed unless hardBlocked. */
  disabled: boolean;
  /** Fully block the input (cap reached) — composing a message you can't send is pointless. */
  hardBlocked: boolean;
  placeholder: string;
  remainingLabel: string | null;
  sendLabel: string;
}) {
  return (
    <div className="sticky bottom-2">
      <div className="flex items-end gap-2 rounded-2xl border border-border bg-card p-2 shadow-sm">
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (!disabled) onSend();
            }
          }}
          rows={1}
          maxLength={4000}
          placeholder={placeholder}
          className="max-h-40 min-h-11 flex-1 resize-none bg-transparent px-2 py-2.5 text-sm leading-relaxed outline-none placeholder:text-muted-foreground disabled:opacity-60"
          disabled={hardBlocked}
        />
        <Button
          type="button"
          size="icon"
          className="size-11 shrink-0 rounded-xl"
          onClick={onSend}
          disabled={disabled || !value.trim()}
          aria-label={sendLabel}
        >
          <Send className="size-4" aria-hidden />
        </Button>
      </div>
      {remainingLabel ? (
        <p className="mt-1.5 pl-1 text-xs text-muted-foreground">{remainingLabel}</p>
      ) : null}
    </div>
  );
}

function HistoryDrawer({
  conversations,
  onPick,
  activeId,
  loading,
  emptyLabel,
  nowLabel,
}: {
  conversations: { id: string; preview: string | null; last_message_at: string | null }[];
  onPick: (id: string) => void;
  activeId: string | null;
  loading: boolean;
  emptyLabel: string;
  nowLabel: string;
}) {
  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden />
      </div>
    );
  }
  if (conversations.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">{emptyLabel}</p>;
  }
  return (
    <div className="flex flex-col gap-1 overflow-y-auto">
      {conversations.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => onPick(c.id)}
          className={cn(
            "truncate rounded-xl px-3 py-2.5 text-left text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            c.id === activeId ? "bg-accent font-medium" : "text-foreground",
          )}
        >
          {c.preview?.trim() || nowLabel}
        </button>
      ))}
    </div>
  );
}

/** Signed-out: a gentle sign-in prompt (chat needs an account; reuses onboarding copy). */
function SignInScreen({ locale }: { locale?: string }) {
  const { t, language } = useSukoonLanguage();
  const redirect = encodeURIComponent(
    typeof window !== "undefined" ? window.location.pathname + window.location.search : "",
  );
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-5 py-12 text-center" lang={language}>
      <span className="flex size-14 items-center justify-center rounded-full bg-secondary/15 text-secondary" aria-hidden>
        <Sparkles className="size-7" />
      </span>
      <div className="space-y-1.5">
        <h1 className="text-xl font-bold tracking-tight">{t("Sukoon.onboarding.signInTitle")}</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">{t("Sukoon.onboarding.signInSub")}</p>
      </div>
      {locale ? (
        <Button asChild>
          <Link to={`/${locale}/auth?redirect=${redirect}`}>{t("Sukoon.onboarding.signInCta")}</Link>
        </Button>
      ) : null}
      <NotTherapyFooter className="mt-4" />
    </div>
  );
}

/** Under-18 / restricted: a warm "chat unlocks at 18+" screen pointing at the tools. */
function RestrictedScreen({ locale }: { locale?: string }) {
  const { t, language } = useSukoonLanguage();
  const base = locale ? `/${locale}/sukoon` : "";
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-5 py-12 text-center" lang={language}>
      <span className="flex size-14 items-center justify-center rounded-full bg-secondary/15 text-secondary" aria-hidden>
        <Wind className="size-7" />
      </span>
      <div className="space-y-1.5">
        <h1 className="text-xl font-bold tracking-tight">{t("Sukoon.saathi.restrictedTitle")}</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">{t("Sukoon.saathi.restrictedBody")}</p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <Button asChild variant="secondary">
          <Link to={`${base}/tools`}>{t("Sukoon.saathi.restrictedTools")}</Link>
        </Button>
        <Button asChild variant="outline">
          <Link to={`${base}/journal`}>{t("Sukoon.saathi.restrictedJournal")}</Link>
        </Button>
      </div>
      <NotTherapyFooter className="mt-4" />
    </div>
  );
}
