/**
 * Async moderation screen for Community posts/threads — a cheap
 * claude-haiku-4-5 classification (same shape as ca/prompts.ts's classifyItem),
 * fired-and-forgotten right after a thread/post is created so submission never
 * blocks on it. A positive hit flips the row's moderation_status to 'flagged',
 * which every read path (RLS in 0056 + services/community.ts's own filters)
 * already excludes from anyone but the author and admins.
 */
import { structuredJson } from "./anthropic.js";
import { MODELS } from "./models.js";
import { supabase } from "./supabase.js";
import { logger } from "./logger.js";

interface ScreenResult {
  is_abusive: boolean;
  is_spam: boolean;
  has_pii: boolean;
  reason: string;
}

async function screenText(text: string): Promise<ScreenResult> {
  return structuredJson<ScreenResult>({
    model: MODELS.haiku,
    purpose: "community_screen_post",
    system:
      "You screen user-generated posts on a UPPSC exam-prep community for abuse, spam, and PII. " +
      "is_abusive: harassment, hate speech, threats, or sexual content. is_spam: unsolicited " +
      "advertising, off-topic promotional links, or repetitive gibberish. has_pii: the poster's own " +
      "or another named person's phone number, email, home address, or government ID number. Normal " +
      "exam-prep discussion, disagreement, or criticism of content is NOT abusive. Give a one-sentence " +
      "reason either way.",
    content: text,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        is_abusive: { type: "boolean" },
        is_spam: { type: "boolean" },
        has_pii: { type: "boolean" },
        reason: { type: "string" },
      },
      required: ["is_abusive", "is_spam", "has_pii", "reason"],
    },
    maxTokens: 300,
  });
}

async function flag(table: "discussion_threads" | "discussion_posts", id: string): Promise<void> {
  const { error } = await supabase().from(table).update({ moderation_status: "flagged" }).eq("id", id);
  if (error) logger.warn({ error, table, id }, "failed to flag community row after moderation hit");
}

/**
 * Screen a newly created post's body. Fire-and-forget from the route/service
 * that created it (never awaited on the response path) — a screening failure
 * degrades to "leave it visible," never blocks or retroactively fails the post.
 */
export async function screenPost(postId: string, body: string): Promise<void> {
  try {
    const result = await screenText(body);
    await supabase()
      .from("post_screenings")
      .insert({
        post_id: postId,
        is_abusive: result.is_abusive,
        is_spam: result.is_spam,
        has_pii: result.has_pii,
        reason: result.reason,
        model: MODELS.haiku,
      });
    if (result.is_abusive || result.is_spam || result.has_pii) {
      await flag("discussion_posts", postId);
    }
  } catch (err) {
    logger.warn({ err, postId }, "community post screen failed; leaving post visible");
  }
}

/**
 * Screen a newly created thread's title + first post body together (a title
 * can itself be abusive/spam independent of the body). Flags the thread (and,
 * separately, the post is screened via screenPost by the same call site).
 */
export async function screenThread(threadId: string, title: string, body: string): Promise<void> {
  try {
    const result = await screenText(`Title: ${title}\n\nBody: ${body}`);
    await supabase()
      .from("post_screenings")
      .insert({
        thread_id: threadId,
        is_abusive: result.is_abusive,
        is_spam: result.is_spam,
        has_pii: result.has_pii,
        reason: result.reason,
        model: MODELS.haiku,
      });
    if (result.is_abusive || result.is_spam || result.has_pii) {
      await flag("discussion_threads", threadId);
    }
  } catch (err) {
    logger.warn({ err, threadId }, "community thread screen failed; leaving thread visible");
  }
}
