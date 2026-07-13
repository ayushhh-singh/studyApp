import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { Plus, MessageSquare, Trash2, ChevronLeft, Sparkles, Loader2 } from "lucide-react";
import type { MentorDepth } from "@neev/shared";
import { PageHeader } from "@/components/ui-x/page-header";
import { Button } from "@/components/ui/button";
import { MentorChat } from "@/components/mentor/mentor-chat";
import { useDoubtThreads, useCreateThread, useDeleteThread } from "@/hooks/use-mentor";
import { useQuestion } from "@/hooks/use-questions";
import { useLocale } from "@/hooks/use-locale";
import { cn } from "@/lib/utils";

function parseDepth(raw: string | null): MentorDepth {
  return raw === "quick" || raw === "in_depth" ? raw : "standard";
}

export const handle = { titleKey: "Mentor.title" };

/**
 * The active thread lives in the URL (/doubts/:threadId), not local component
 * state — a specific conversation is now bookmarkable, survives a refresh, and
 * behaves correctly with browser back/forward. Bare /doubts (no id) always
 * shows the thread list + a neutral empty state — deliberately NOT an
 * auto-redirect into "your most recent thread": that would fight the mobile
 * "back to list" link (which returns to bare /doubts specifically to show the
 * list) and, worse, re-select a thread the user just deleted from underneath
 * them. An explicit click is always what puts you in a thread, except the one
 * well-justified automatic case below.
 *
 * Arriving from "Ask a doubt" on a practice result (/doubts?question=<id>) —
 * see components/practice/result-review-list.tsx — creates a fresh thread,
 * moves the question id onto the new thread's own URL
 * (/doubts/:threadId?question=<id>), and has MentorChat send it immediately:
 * the mentor should already be answering by the time this page appears, not
 * sitting with unsent text the user still has to notice and click Send on.
 * The `?question=` marker survives the redirect so revisiting/bookmarking
 * that exact thread URL later still identifies what it was seeded from —
 * harmless since MentorChat only ever auto-sends into a thread it confirms is
 * genuinely empty.
 */
export function Component() {
  const { t } = useTranslation();
  const locale = useLocale();
  const navigate = useNavigate();
  const { threadId } = useParams<{ threadId?: string }>();
  const [searchParams] = useSearchParams();
  const seedQuestionId = searchParams.get("question") ?? undefined;
  const { data: seedQuestion, isLoading: isSeedQuestionLoading } = useQuestion(seedQuestionId);

  // "Teach me this" entry points (Learn node, CA item): ?teach=1&topic=<subject>
  // [&node=<id>][&depth=quick|standard|in_depth]. Seeds a teacher lesson.
  const wantsTeach = searchParams.get("teach") === "1";
  const teachTopic = searchParams.get("topic") ?? undefined;
  const teachNodeId = searchParams.get("node") ?? undefined;
  const teachDepth = parseDepth(searchParams.get("depth"));

  const threads = useDoubtThreads();
  const createThread = useCreateThread();
  const deleteThread = useDeleteThread();
  const seededForRef = useRef<string | null>(null);

  const items = threads.data?.items ?? [];

  // The ONE automatic navigation: a question to seed always starts a fresh
  // thread. Guarded by a ref keyed to the question id so it can only ever
  // fire once per distinct question — not on every render, and not again once
  // the redirect below lands (threadId becomes truthy and this whole effect
  // is skipped). Re-visiting /doubts?question=X again later (a second "Ask a
  // doubt" click) legitimately creates a second fresh thread — consistent
  // with "New doubt" always starting a new conversation, not a bug to guard against.
  useEffect(() => {
    if (threadId) return;
    // A "Teach me this" seed creates a fresh thread and moves its params onto
    // the new thread's URL, then MentorChat fires the lesson immediately.
    if (wantsTeach && teachTopic) {
      const key = `teach:${teachTopic}:${teachNodeId ?? ""}`;
      if (seededForRef.current === key) return;
      seededForRef.current = key;
      const qs = new URLSearchParams({ teach: "1", topic: teachTopic, depth: teachDepth });
      if (teachNodeId) qs.set("node", teachNodeId);
      createThread.mutate(undefined, {
        onSuccess: (thr) => navigate(`/${locale}/doubts/${thr.id}?${qs.toString()}`, { replace: true }),
      });
      return;
    }
    if (!seedQuestionId || isSeedQuestionLoading) return;
    if (seededForRef.current === seedQuestionId) return;
    seededForRef.current = seedQuestionId;
    createThread.mutate(undefined, {
      onSuccess: (thr) => navigate(`/${locale}/doubts/${thr.id}?question=${seedQuestionId}`, { replace: true }),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId, seedQuestionId, isSeedQuestionLoading, wantsTeach, teachTopic, teachNodeId]);

  const seedText = wantsTeach && teachTopic
    ? t("Mentor.seedTeach", { topic: teachTopic })
    : seedQuestion
      ? t("Mentor.seedFromQuestion", { stem: seedQuestion.stem_i18n[locale] })
      : undefined;

  const newThread = () =>
    createThread.mutate(undefined, { onSuccess: (thr) => navigate(`/${locale}/doubts/${thr.id}`) });

  const remove = (id: string) => {
    // Navigate away eagerly, before the request even settles, when deleting
    // the thread currently being viewed — there's no ambiguity to wait on a
    // network round-trip for (the user just asked to leave this exact
    // conversation), and doing it inside the mutation's onSuccess callback
    // instead was a real, intermittent race: MentorChat's own thread-detail
    // query can win the redraw first with its LAST successful cached result
    // before the delete's callback (or MentorChat's onNotFound 404 fallback)
    // gets a chance to run, silently leaving the deleted thread on screen.
    if (threadId === id) navigate(`/${locale}/doubts`, { replace: true });
    deleteThread.mutate(id);
  };

  // A stale/deleted thread id in the URL (bookmarked, or removed in another
  // tab) redirects to the bare list instead of leaving a broken, blank chat pane.
  const handleNotFound = () => navigate(`/${locale}/doubts`, { replace: true });

  return (
    // NOT h-full/flex-1 here: every other page in this app scrolls at the
    // document level (app-shell's <main> has no overflow boundary of its own,
    // by design), so trying to make this ONE page stretch-fill "remaining
    // viewport height" fights that model — it briefly made the panel grow to
    // its full CONTENT height instead of a bounded one, pushing the page well
    // past the viewport. A fixed, viewport-relative height on the panel alone
    // (tuned below) is far more predictable: it's always bounded, and the
    // message list scrolls internally via its own overflow-y-auto.
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <PageHeader
        title={t("Mentor.title")}
        description={t("Mentor.pageDescription")}
        tourAnchor="doubts"
        action={
          <Button size="sm" onClick={newThread} disabled={createThread.isPending}>
            <Plus className="size-4" aria-hidden /> {t("Mentor.newDoubt")}
          </Button>
        }
      />

      <div className="grid min-h-0 gap-4 md:grid-cols-[16rem_1fr]">
        {/* Thread list — capped to match the chat panel's own bounded height
            (see the panel below) and independently scrollable, so a long
            list scrolls internally instead of growing taller than the chat. */}
        <aside
          className={cn(
            "flex max-h-[calc(100svh-17rem)] flex-col gap-1 overflow-y-auto sm:max-h-[calc(100svh-13rem)]",
            threadId && "hidden md:flex",
          )}
        >
          {threads.isLoading ? (
            // Previously this briefly showed "No threads yet" even for a
            // returning user with real history, since `items` defaults to []
            // while the query is still in flight.
            <div className="flex flex-col gap-1.5">
              <div className="h-14 animate-pulse rounded-lg bg-muted" />
              <div className="h-14 animate-pulse rounded-lg bg-muted" />
            </div>
          ) : (
            items.length === 0 && (
              <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
                {t("Mentor.noThreads")}
              </p>
            )
          )}
          {items.map((thr) => (
            <div
              key={thr.id}
              className={cn(
                "group flex items-center gap-2 rounded-lg border px-3 py-2 text-left",
                threadId === thr.id ? "border-primary/40 bg-primary/5" : "border-border hover:bg-accent",
              )}
            >
              <Link
                to={`/${locale}/doubts/${thr.id}`}
                className="flex min-w-0 flex-1 items-center gap-2 text-left outline-none"
              >
                <MessageSquare className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{thr.title ?? t("Mentor.untitled")}</span>
                  {thr.last_message_preview && (
                    <span className="block truncate text-xs text-muted-foreground">{thr.last_message_preview}</span>
                  )}
                </span>
              </Link>
              <button
                type="button"
                onClick={() => remove(thr.id)}
                aria-label={t("Mentor.deleteThread")}
                className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-coral/10 hover:text-coral focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100"
              >
                <Trash2 className="size-3.5" aria-hidden />
              </button>
            </div>
          ))}
        </aside>

        {/* Chat */}
        <div className="flex h-[calc(100svh-17rem)] min-h-0 min-w-0 flex-col rounded-xl border border-border bg-card p-3 sm:h-[calc(100svh-13rem)]">
          {threadId ? (
            <>
              <Link
                to={`/${locale}/doubts`}
                className="mb-1 flex items-center gap-1 self-start text-xs text-muted-foreground hover:text-foreground md:hidden"
              >
                <ChevronLeft className="size-4" aria-hidden /> {t("Mentor.backToThreads")}
              </Link>
              <MentorChat
                key={threadId}
                threadId={threadId}
                nodeId={teachNodeId ?? seedQuestion?.syllabus_node_id ?? undefined}
                seed={seedText}
                autoSend={!!seedQuestionId || (wantsTeach && !!teachTopic)}
                seedTeach={wantsTeach}
                seedDepth={teachDepth}
                onNotFound={handleNotFound}
              />
            </>
          ) : seedQuestionId || (wantsTeach && teachTopic) ? (
            // The seeded-thread creation above is in flight — show a spinner
            // instead of the "ask me anything" empty state, which would
            // otherwise flash misleadingly for the instant before it redirects.
            <div className="flex flex-1 items-center justify-center">
              <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden />
            </div>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center text-muted-foreground">
              <Sparkles className="size-10 text-primary" aria-hidden />
              <p className="text-sm font-medium text-foreground">{t("Mentor.emptyTitle")}</p>
              <p className="max-w-xs text-xs">{t("Mentor.emptyHint")}</p>
              <Button size="sm" onClick={newThread} disabled={createThread.isPending}>
                <Plus className="size-4" aria-hidden /> {t("Mentor.newDoubt")}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
