import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { DiscussionPost } from "@prayasup/shared";
import { Pencil, ShieldOff, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/providers/auth-provider";
import { useLocale } from "@/hooks/use-locale";
import { useDeletePost, useEditPost, useVotePost } from "@/hooks/use-community";
import { useBlockUser } from "@/hooks/use-community";
import { CommunityAuthorLine } from "./community-author-line";
import { VoteButtons } from "./vote-buttons";
import { ReportSheet } from "./report-sheet";

function PostRow({ threadId, post }: { threadId: string; post: DiscussionPost }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const { user } = useAuth();
  const isOwn = post.author.id === user?.id;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(post.body);
  const [blockArmed, setBlockArmed] = useState(false);

  const votePost = useVotePost(threadId);
  const editPost = useEditPost(threadId);
  const deletePost = useDeletePost(threadId);
  const blockUser = useBlockUser(threadId);

  if (post.is_deleted) {
    return (
      <div className="flex gap-3 py-3">
        <div className="w-7 shrink-0" />
        <p className="text-sm text-muted-foreground italic">{t("Community.postDeleted")}</p>
      </div>
    );
  }

  return (
    <div className="flex gap-3 border-b border-border py-3 last:border-0">
      <VoteButtons
        score={post.vote_score}
        myVote={post.my_vote}
        disabled={votePost.isPending}
        onVote={(value) => votePost.mutate({ postId: post.id, value })}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <CommunityAuthorLine author={post.author} className="font-medium text-foreground" />
          <span>{new Date(post.created_at).toLocaleDateString(locale)}</span>
          {post.edited_at && <span>({t("Community.edited")})</span>}
          {post.moderation_status === "flagged" && isOwn && (
            <span className="rounded-full bg-marigold/15 px-2 py-0.5 text-marigold-foreground">
              {t("Community.pendingReview")}
            </span>
          )}
        </div>

        {editing ? (
          <div className="flex flex-col gap-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={3}
              className="rounded-xl border border-input bg-background px-3.5 py-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={editPost.isPending || !draft.trim()}
                onClick={() =>
                  editPost.mutate({ postId: post.id, body: { body: draft.trim() } }, { onSuccess: () => setEditing(false) })
                }
              >
                {t("Community.save")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                {t("Community.cancel")}
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-sm whitespace-pre-wrap text-foreground">{post.body}</p>
        )}

        {!editing && (
          <div className="flex items-center gap-1 pt-0.5">
            {isOwn ? (
              <>
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  aria-label={t("Community.edit")}
                  className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Pencil className="size-3.5" aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() => deletePost.mutate(post.id)}
                  aria-label={t("Community.delete")}
                  className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-coral/10 hover:text-coral focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Trash2 className="size-3.5" aria-hidden />
                </button>
              </>
            ) : (
              <>
                <ReportSheet targetType="post" targetId={post.id} />
                <button
                  type="button"
                  onClick={() => {
                    if (blockArmed) blockUser.mutate(post.author.id);
                    else setBlockArmed(true);
                  }}
                  onBlur={() => setBlockArmed(false)}
                  aria-label={t("Community.block")}
                  className="flex items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground hover:bg-coral/10 hover:text-coral focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <ShieldOff className="size-3.5" aria-hidden />
                  {blockArmed && t("Community.blockConfirm")}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function PostList({ threadId, posts }: { threadId: string; posts: DiscussionPost[] }) {
  return (
    <div className="flex flex-col">
      {posts.map((post) => (
        <PostRow key={post.id} threadId={threadId} post={post} />
      ))}
    </div>
  );
}
