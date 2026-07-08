import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, MessageSquare, Trash2, ChevronLeft, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/ui-x/page-header";
import { Button } from "@/components/ui/button";
import { MentorChat } from "@/components/mentor/mentor-chat";
import { useDoubtThreads, useCreateThread, useDeleteThread } from "@/hooks/use-mentor";
import { cn } from "@/lib/utils";

export const handle = { titleKey: "Mentor.title" };

export function Component() {
  const { t } = useTranslation();
  const threads = useDoubtThreads();
  const createThread = useCreateThread();
  const deleteThread = useDeleteThread();
  const [selected, setSelected] = useState<string | null>(null);

  const items = threads.data?.items ?? [];

  // Auto-select the most recent thread once loaded.
  useEffect(() => {
    if (!selected && items.length > 0) setSelected(items[0].id);
  }, [selected, items]);

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
          {items.length === 0 && (
            <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
              {t("Mentor.noThreads")}
            </p>
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
              <MentorChat threadId={selected} />
            </>
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
