import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { DiscussionAnchorType } from "@neev/shared";
import { MessageSquare, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui-x/empty-state";
import { useLocale } from "@/hooks/use-locale";
import { useCommunityThreads, useCreateThread } from "@/hooks/use-community";

/**
 * Anchor-scoped discussion — embedded on question/node/current-affairs pages
 * (Session's "Discussion" tab). Lists existing threads for this anchor and
 * offers a "start a new thread" composer; the full conversation itself lives
 * at its own route (/community/thread/:id), matching doubts.tsx's precedent
 * of not cramming unbounded-length content into an embedded panel.
 */
export function DiscussionPanel({ anchorType, anchorId }: { anchorType: DiscussionAnchorType; anchorId: string }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  const threads = useCommunityThreads(anchorType, anchorId);
  const createThread = useCreateThread(anchorType, anchorId);

  const items = threads.data?.items ?? [];

  const submit = () => {
    createThread.mutate(
      { anchor_type: anchorType, anchor_id: anchorId, title: title.trim(), body: body.trim() },
      {
        onSuccess: () => {
          setComposing(false);
          setTitle("");
          setBody("");
        },
      },
    );
  };

  return (
    <div className="flex flex-col gap-3">
      {threads.isLoading ? (
        <div className="flex flex-col gap-2">
          <div className="h-12 animate-pulse rounded-lg bg-muted" />
          <div className="h-12 animate-pulse rounded-lg bg-muted" />
        </div>
      ) : items.length === 0 && !composing ? (
        <EmptyState
          icon={MessageSquare}
          title={t("Community.emptyTitle")}
          description={t("Community.emptyDescription")}
        />
      ) : (
        <div className="flex flex-col gap-1.5">
          {items.map((thread) => (
            <Link
              key={thread.id}
              to={`/${locale}/community/thread/${thread.id}`}
              className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5 text-sm hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="min-w-0 flex-1 truncate font-medium">{thread.title}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {t("Community.replyCount", { count: thread.post_count - 1 })}
              </span>
            </Link>
          ))}
        </div>
      )}

      {composing ? (
        <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("Community.newThreadTitlePlaceholder")}
            maxLength={200}
            className="h-10 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={t("Community.newThreadBodyPlaceholder")}
            rows={3}
            maxLength={5000}
            className="rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
          {createThread.error && <p className="text-sm text-coral">{createThread.error.message}</p>}
          <div className="flex gap-2">
            <Button size="sm" disabled={createThread.isPending || title.trim().length < 3 || !body.trim()} onClick={submit}>
              {t("Community.startThread")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setComposing(false)}>
              {t("Community.cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <Button size="sm" variant="outline" className="self-start" onClick={() => setComposing(true)}>
          <Plus className="size-4" aria-hidden /> {t("Community.newThread")}
        </Button>
      )}
    </div>
  );
}
