import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { ChevronLeft, Lock } from "lucide-react";
import { Skeleton } from "@/components/ui-x/skeleton";
import { useLocale } from "@/hooks/use-locale";
import { useCommunityThread } from "@/hooks/use-community";
import { PostList } from "@/components/community/post-list";
import { PostComposer } from "@/components/community/post-composer";
import { CommunityAuthorLine } from "@/components/community/community-author-line";
import { ReportSheet } from "@/components/community/report-sheet";

export const handle = { titleKey: "Community.threadTitle" };

export function Component() {
  const { t } = useTranslation();
  const locale = useLocale();
  const { threadId } = useParams<{ threadId: string }>();
  const detail = useCommunityThread(threadId);

  if (detail.isLoading) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (!detail.data) {
    return <p className="text-sm text-muted-foreground">{t("Community.threadNotFound")}</p>;
  }

  const { thread, posts } = detail.data;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <Link
        to={`/${locale}/community`}
        className="flex items-center gap-1 self-start text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" aria-hidden /> {t("Community.backToHub")}
      </Link>

      <div className="flex items-start justify-between gap-3 border-b border-border pb-4">
        <div className="flex flex-col gap-1">
          {thread.anchor_node_title_i18n && (
            <span className="w-fit max-w-full truncate rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
              {thread.anchor_node_title_i18n[locale]}
            </span>
          )}
          <h1 className="text-xl font-bold text-balance">{thread.title}</h1>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <CommunityAuthorLine author={thread.author} />
            <span>{new Date(thread.created_at).toLocaleDateString(locale)}</span>
            {thread.is_locked && (
              <span className="flex items-center gap-1">
                <Lock className="size-3" aria-hidden /> {t("Community.locked")}
              </span>
            )}
          </div>
        </div>
        <ReportSheet targetType="thread" targetId={thread.id} />
      </div>

      <PostList threadId={thread.id} posts={posts} />

      <PostComposer threadId={thread.id} disabled={thread.is_locked} />
    </div>
  );
}
