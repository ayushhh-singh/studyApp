import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router";
import { Plus, MessageSquare, Trash2, ChevronLeft, Sparkles, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/ui-x/page-header";
import { Button } from "@/components/ui/button";
import { MentorChat } from "@/components/mentor/mentor-chat";
import { useDoubtThreads, useCreateThread, useDeleteThread } from "@/hooks/use-mentor";
import { useQuestion } from "@/hooks/use-questions";
import { useLocale } from "@/hooks/use-locale";
import { cn } from "@/lib/utils";

export const handle = { titleKey: "Mentor.title" };

export function Component() {
  const { t } = useTranslation();
  const locale = useLocale();
  const [searchParams] = useSearchParams();
  // Arriving from "Ask a doubt" on a practice result (?question=<id>) — see
  // components/practice/result-review-list.tsx. Previously this page ignored
  // the param entirely and just opened the most recent (unrelated) thread,
  // so the link was a context-blind stub even though it looked functional.
  const seedQuestionId = searchParams.get("question") ?? undefined;
  const { data: seedQuestion, isLoading: isSeedQuestionLoading } = useQuestion(seedQuestionId);

  const threads = useDoubtThreads();
  const createThread = useCreateThread();
  const deleteThread = useDeleteThread();
  const [selected, setSelected] = useState<string | null>(null);
  const seededRef = useRef(false);

  const items = threads.data?.items ?? [];

  // A question to ask about always starts a FRESH thread seeded with that
  // context, rather than reusing/auto-selecting an unrelated existing one.
  // Waits for the question lookup to settle first so the composer's initial
  // seed text (passed to MentorChat below) is correct the moment it mounts —
  // MentorChat only reads its `seed` prop once, on mount.
  useEffect(() => {
    if (!seedQuestionId || seededRef.current || selected || isSeedQuestionLoading) return;
    seededRef.current = true;
    createThread.mutate(undefined, { onSuccess: (thr) => setSelected(thr.id) });
  }, [seedQuestionId, selected, isSeedQuestionLoading, createThread]);

  // Otherwise, auto-select the most recent thread once loaded.
  useEffect(() => {
    if (!seedQuestionId && !selected && items.length > 0) setSelected(items[0].id);
  }, [seedQuestionId, selected, items]);

  const seedText = seedQuestion
    ? t("Mentor.seedFromQuestion", { stem: seedQuestion.stem_i18n[locale] })
    : undefined;

  const newThread = () =>
    createThread.mutate(undefined, { onSuccess: (thr) => setSelected(thr.id) });

  const remove = (id: string) => {
    deleteThread.mutate(id, {
      onSuccess: () => {
        if (selected === id) setSelected(null);
      },
    });
  };

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <PageHeader
        title={t("Mentor.title")}
        description={t("Mentor.pageDescription")}
        action={
          <Button size="sm" onClick={newThread} disabled={createThread.isPending}>
            <Plus className="size-4" aria-hidden /> {t("Mentor.newDoubt")}
          </Button>
        }
      />

      <div className="grid min-h-0 gap-4 md:grid-cols-[16rem_1fr]">
        {/* Thread list */}
        <aside className={cn("flex flex-col gap-1", selected && "hidden md:flex")}>
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
                selected === thr.id ? "border-primary/40 bg-primary/5" : "border-border hover:bg-accent",
              )}
            >
              <button type="button" onClick={() => setSelected(thr.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left outline-none">
                <MessageSquare className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{thr.title ?? t("Mentor.untitled")}</span>
                  {thr.last_message_preview && (
                    <span className="block truncate text-xs text-muted-foreground">{thr.last_message_preview}</span>
                  )}
                </span>
              </button>
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
        <div className="flex h-[70svh] min-h-0 flex-col rounded-xl border border-border bg-card p-3">
          {selected ? (
            <>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="mb-1 flex items-center gap-1 self-start text-xs text-muted-foreground hover:text-foreground md:hidden"
              >
                <ChevronLeft className="size-4" aria-hidden /> {t("Mentor.backToThreads")}
              </button>
              <MentorChat threadId={selected} nodeId={seedQuestion?.syllabus_node_id ?? undefined} seed={seedText} />
            </>
          ) : seedQuestionId ? (
            // Arriving with a question to seed: show a loading state instead
            // of the generic "ask me anything" empty state + New Doubt button,
            // which would otherwise flash misleadingly while the seeded
            // thread is still being created underneath.
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
