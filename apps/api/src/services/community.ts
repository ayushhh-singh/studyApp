import type {
  BilingualText,
  CommunityAuthor,
  CommunityHub,
  DimensionScore,
  DiscussionAnchorType,
  DiscussionPost,
  DiscussionThread,
  DiscussionThreadDetail,
  PaginationMeta,
  ReportReason,
  ReportTargetType,
  SharedAnswer,
} from "@prayasup/shared";
import { supabase } from "../lib/supabase.js";
import { badRequest, HttpError, notFound } from "../lib/http-error.js";
import { screenPost, screenThread } from "../lib/community-moderation.js";
import { logger } from "../lib/logger.js";
import { questionVisibilityOrFilter } from "../lib/question-visibility.js";

const THREAD_PAGE_SIZE = 20;
const POST_PAGE_SIZE = 30;
const HUB_LIST_SIZE = 10;
const SHARED_ANSWERS_PAGE_SIZE = 20;

// ---------------------------------------------------------------------------
// Author lookups + blocklist filtering — shared by every list/detail below.
// ---------------------------------------------------------------------------
async function fetchAuthors(userIds: string[]): Promise<Map<string, CommunityAuthor>> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return new Map();
  const { data, error } = await supabase()
    .from("users_profile")
    .select("id, handle, display_name")
    .in("id", ids);
  if (error) throw new HttpError(500, `author lookup failed: ${error.message}`);
  return new Map((data ?? []).map((row) => [row.id as string, row as CommunityAuthor]));
}

/** IDs the viewer has blocked — server-side content filtering per CLAUDE.md's spec. */
async function fetchBlockedIds(viewerId: string): Promise<Set<string>> {
  const { data, error } = await supabase().from("user_blocks").select("blocked_id").eq("blocker_id", viewerId);
  if (error) throw new HttpError(500, `block list lookup failed: ${error.message}`);
  return new Set((data ?? []).map((r) => r.blocked_id as string));
}

async function assertAnchorExists(anchorType: DiscussionAnchorType, anchorId: string): Promise<void> {
  if (anchorType === "question") {
    const { data, error } = await supabase()
      .from("questions")
      .select("id")
      .eq("id", anchorId)
      .or(questionVisibilityOrFilter("catalog"))
      .maybeSingle();
    if (error) throw new HttpError(500, `question lookup failed: ${error.message}`);
    if (!data) throw notFound("Question not found");
  } else if (anchorType === "node") {
    const { data, error } = await supabase().from("syllabus_nodes").select("id").eq("id", anchorId).maybeSingle();
    if (error) throw new HttpError(500, `syllabus node lookup failed: ${error.message}`);
    if (!data) throw notFound("Syllabus node not found");
  } else if (anchorType === "ca_item") {
    const { data, error } = await supabase()
      .from("current_affairs_items")
      .select("id")
      .eq("id", anchorId)
      .eq("is_published", true)
      .maybeSingle();
    if (error) throw new HttpError(500, `current affairs item lookup failed: ${error.message}`);
    if (!data) throw notFound("Current affairs item not found");
  } else {
    const { data, error } = await supabase().from("shared_answers").select("id").eq("id", anchorId).maybeSingle();
    if (error) throw new HttpError(500, `shared answer lookup failed: ${error.message}`);
    if (!data) throw notFound("Shared answer not found");
  }
}

interface ThreadRow {
  id: string;
  anchor_type: DiscussionAnchorType;
  anchor_id: string;
  title: string;
  user_id: string;
  is_locked: boolean;
  moderation_status: DiscussionThread["moderation_status"];
  post_count: number;
  created_at: string;
  updated_at: string;
}

function toThread(row: ThreadRow, authors: Map<string, CommunityAuthor>): DiscussionThread {
  return {
    id: row.id,
    anchor_type: row.anchor_type,
    anchor_id: row.anchor_id,
    title: row.title,
    author: authors.get(row.user_id) ?? { id: row.user_id, handle: null, display_name: null },
    is_locked: row.is_locked,
    moderation_status: row.moderation_status,
    post_count: row.post_count,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

const THREAD_COLUMNS =
  "id, anchor_type, anchor_id, title, user_id, is_locked, moderation_status, post_count, created_at, updated_at";

// ---------------------------------------------------------------------------
// Threads
// ---------------------------------------------------------------------------
export async function listThreadsForAnchor(
  viewerId: string,
  anchorType: DiscussionAnchorType,
  anchorId: string,
  page: number,
): Promise<{ items: DiscussionThread[]; pagination: PaginationMeta }> {
  const from = (page - 1) * THREAD_PAGE_SIZE;
  const to = from + THREAD_PAGE_SIZE - 1;

  const { data, count, error } = await supabase()
    .from("discussion_threads")
    .select(THREAD_COLUMNS, { count: "exact" })
    .eq("anchor_type", anchorType)
    .eq("anchor_id", anchorId)
    .or(`moderation_status.eq.visible,user_id.eq.${viewerId}`)
    .order("updated_at", { ascending: false })
    .range(from, to);
  if (error) throw new HttpError(500, `thread list failed: ${error.message}`);

  const blocked = await fetchBlockedIds(viewerId);
  const rows = (data ?? []).filter((r) => !blocked.has(r.user_id as string)) as unknown as ThreadRow[];
  const authors = await fetchAuthors(rows.map((r) => r.user_id));
  const total = count ?? 0;
  return {
    items: rows.map((r) => toThread(r, authors)),
    pagination: { page, page_size: THREAD_PAGE_SIZE, total, total_pages: Math.max(1, Math.ceil(total / THREAD_PAGE_SIZE)) },
  };
}

export async function createThread(
  userId: string,
  anchorType: DiscussionAnchorType,
  anchorId: string,
  title: string,
  body: string,
): Promise<DiscussionThread> {
  // shared_answer-anchored threads are system-managed: shareAnswerForPeerReview
  // creates exactly one per shared answer and every other read (getSharedAnswer,
  // the re-share idempotency check) looks it up with .maybeSingle(), which
  // errors if more than one row matches. Letting an arbitrary user create a
  // second thread on the same anchor via this generic endpoint would break
  // those lookups for everyone, not just the caller.
  if (anchorType === "shared_answer") {
    throw badRequest("Peer-review threads are created automatically when an answer is shared");
  }
  await assertAnchorExists(anchorType, anchorId);

  const { data: thread, error } = await supabase()
    .from("discussion_threads")
    .insert({ anchor_type: anchorType, anchor_id: anchorId, title, user_id: userId })
    .select(THREAD_COLUMNS)
    .single();
  if (error) throw new HttpError(500, `thread creation failed: ${error.message}`);
  const row = thread as unknown as ThreadRow;

  const { data: post, error: postError } = await supabase()
    .from("discussion_posts")
    .insert({ thread_id: row.id, user_id: userId, body })
    .select("id")
    .single();
  if (postError) throw new HttpError(500, `thread opening post failed: ${postError.message}`);

  // Fire-and-forget: never block the response on the moderation screen.
  void screenThread(row.id, title, body).catch((err) => logger.warn({ err }, "screenThread failed"));
  void screenPost((post as { id: string }).id, body).catch((err) => logger.warn({ err }, "screenPost failed"));

  const authors = await fetchAuthors([userId]);
  // post_count is bumped by the discussion_posts_after_write trigger, but the
  // row we already fetched predates the insert above — reflect it directly.
  return toThread({ ...row, post_count: 1 }, authors);
}

export async function getThreadDetail(
  viewerId: string,
  threadId: string,
  page: number,
): Promise<DiscussionThreadDetail> {
  const { data: threadRow, error } = await supabase()
    .from("discussion_threads")
    .select(THREAD_COLUMNS)
    .eq("id", threadId)
    .maybeSingle();
  if (error) throw new HttpError(500, `thread lookup failed: ${error.message}`);
  const row = threadRow as unknown as ThreadRow | null;
  if (!row) throw notFound("Thread not found");
  if (row.moderation_status !== "visible" && row.user_id !== viewerId) throw notFound("Thread not found");

  const from = (page - 1) * POST_PAGE_SIZE;
  const to = from + POST_PAGE_SIZE - 1;
  const { data: postRows, count, error: postsError } = await supabase()
    .from("discussion_posts")
    .select("id, thread_id, user_id, body, is_deleted, moderation_status, vote_score, edited_at, created_at", {
      count: "exact",
    })
    .eq("thread_id", threadId)
    .or(`moderation_status.eq.visible,user_id.eq.${viewerId}`)
    .order("created_at", { ascending: true })
    .range(from, to);
  if (postsError) throw new HttpError(500, `post list failed: ${postsError.message}`);

  const blocked = await fetchBlockedIds(viewerId);
  interface PostRow {
    id: string;
    thread_id: string;
    user_id: string;
    body: string;
    is_deleted: boolean;
    moderation_status: DiscussionPost["moderation_status"];
    vote_score: number;
    edited_at: string | null;
    created_at: string;
  }
  const rows = (postRows ?? []).filter((r) => !blocked.has(r.user_id as string)) as unknown as PostRow[];

  const [authors, myVotes] = await Promise.all([
    fetchAuthors([row.user_id, ...rows.map((r) => r.user_id)]),
    fetchMyVotes(viewerId, rows.map((r) => r.id)),
  ]);

  const posts: DiscussionPost[] = rows.map((r) => ({
    id: r.id,
    thread_id: r.thread_id,
    author: authors.get(r.user_id) ?? { id: r.user_id, handle: null, display_name: null },
    body: r.body,
    is_deleted: r.is_deleted,
    moderation_status: r.moderation_status,
    vote_score: r.vote_score,
    my_vote: myVotes.get(r.id) ?? 0,
    edited_at: r.edited_at,
    created_at: r.created_at,
  }));

  const total = count ?? 0;
  return {
    thread: toThread(row, authors),
    posts,
    pagination: { page, page_size: POST_PAGE_SIZE, total, total_pages: Math.max(1, Math.ceil(total / POST_PAGE_SIZE)) },
  };
}

// ---------------------------------------------------------------------------
// Posts
// ---------------------------------------------------------------------------
async function fetchMyVotes(userId: string, postIds: string[]): Promise<Map<string, -1 | 1>> {
  if (postIds.length === 0) return new Map();
  const { data, error } = await supabase()
    .from("post_votes")
    .select("post_id, value")
    .eq("user_id", userId)
    .in("post_id", postIds);
  if (error) throw new HttpError(500, `vote lookup failed: ${error.message}`);
  return new Map((data ?? []).map((r) => [r.post_id as string, r.value as -1 | 1]));
}

const POST_COLUMNS = "id, thread_id, user_id, body, is_deleted, moderation_status, vote_score, edited_at, created_at";

interface PostRow {
  id: string;
  thread_id: string;
  user_id: string;
  body: string;
  is_deleted: boolean;
  moderation_status: DiscussionPost["moderation_status"];
  vote_score: number;
  edited_at: string | null;
  created_at: string;
}

function toPost(row: PostRow, author: CommunityAuthor, myVote: -1 | 0 | 1): DiscussionPost {
  return {
    id: row.id,
    thread_id: row.thread_id,
    author,
    body: row.body,
    is_deleted: row.is_deleted,
    moderation_status: row.moderation_status,
    vote_score: row.vote_score,
    my_vote: myVote,
    edited_at: row.edited_at,
    created_at: row.created_at,
  };
}

export async function addPost(userId: string, threadId: string, body: string): Promise<DiscussionPost> {
  const { data: threadRow, error: threadError } = await supabase()
    .from("discussion_threads")
    .select("id, is_locked, moderation_status")
    .eq("id", threadId)
    .maybeSingle();
  if (threadError) throw new HttpError(500, `thread lookup failed: ${threadError.message}`);
  if (!threadRow) throw notFound("Thread not found");
  if ((threadRow as { moderation_status: string }).moderation_status === "removed") throw notFound("Thread not found");
  if ((threadRow as { is_locked: boolean }).is_locked) throw badRequest("This thread is locked");

  const { data: post, error } = await supabase()
    .from("discussion_posts")
    .insert({ thread_id: threadId, user_id: userId, body })
    .select(POST_COLUMNS)
    .single();
  if (error) throw new HttpError(500, `post creation failed: ${error.message}`);
  const row = post as unknown as PostRow;

  void screenPost(row.id, body).catch((err) => logger.warn({ err }, "screenPost failed"));

  const authors = await fetchAuthors([userId]);
  return toPost(row, authors.get(userId) ?? { id: userId, handle: null, display_name: null }, 0);
}

export async function editPost(userId: string, postId: string, body: string): Promise<DiscussionPost> {
  const { data: existing, error: fetchError } = await supabase()
    .from("discussion_posts")
    .select("id, user_id, is_deleted, moderation_status")
    .eq("id", postId)
    .maybeSingle();
  if (fetchError) throw new HttpError(500, `post lookup failed: ${fetchError.message}`);
  if (!existing || existing.user_id !== userId) throw notFound("Post not found");
  if ((existing as { is_deleted: boolean }).is_deleted) throw badRequest("Cannot edit a deleted post");
  if ((existing as { moderation_status: string }).moderation_status === "removed") {
    throw badRequest("This post was removed by a moderator and can no longer be edited");
  }

  const { data: post, error } = await supabase()
    .from("discussion_posts")
    .update({ body, edited_at: new Date().toISOString() })
    .eq("id", postId)
    .select(POST_COLUMNS)
    .single();
  if (error) throw new HttpError(500, `post edit failed: ${error.message}`);
  const row = post as unknown as PostRow;

  void screenPost(row.id, body).catch((err) => logger.warn({ err }, "screenPost failed"));

  const authors = await fetchAuthors([userId]);
  const myVote = (await fetchMyVotes(userId, [postId])).get(postId) ?? 0;
  return toPost(row, authors.get(userId) ?? { id: userId, handle: null, display_name: null }, myVote);
}

export async function deletePost(userId: string, postId: string): Promise<void> {
  const { data, error } = await supabase()
    .from("discussion_posts")
    .update({ is_deleted: true })
    .eq("id", postId)
    .eq("user_id", userId)
    .select("id");
  if (error) throw new HttpError(500, `post delete failed: ${error.message}`);
  if (!data || data.length === 0) throw notFound("Post not found");
}

export async function votePost(
  userId: string,
  postId: string,
  value: -1 | 1,
): Promise<{ vote_score: number; my_vote: -1 | 0 | 1 }> {
  const { data: targetPost, error: targetError } = await supabase()
    .from("discussion_posts")
    .select("user_id")
    .eq("id", postId)
    .maybeSingle();
  if (targetError) throw new HttpError(500, `post lookup failed: ${targetError.message}`);
  if (!targetPost) throw notFound("Post not found");
  if ((targetPost as { user_id: string }).user_id === userId) {
    throw badRequest("You cannot vote on your own post");
  }

  const { data: existing, error: existingError } = await supabase()
    .from("post_votes")
    .select("id, value")
    .eq("post_id", postId)
    .eq("user_id", userId)
    .maybeSingle();
  if (existingError) throw new HttpError(500, `vote lookup failed: ${existingError.message}`);

  let myVote: -1 | 0 | 1 = value;
  if (existing && (existing as { value: number }).value === value) {
    const { error } = await supabase().from("post_votes").delete().eq("id", (existing as { id: string }).id);
    if (error) throw new HttpError(500, `vote removal failed: ${error.message}`);
    myVote = 0;
  } else {
    const { error } = await supabase()
      .from("post_votes")
      .upsert({ post_id: postId, user_id: userId, value }, { onConflict: "post_id,user_id" });
    if (error) throw new HttpError(500, `vote cast failed: ${error.message}`);
  }

  const { data: post, error: postError } = await supabase()
    .from("discussion_posts")
    .select("vote_score")
    .eq("id", postId)
    .maybeSingle();
  if (postError) throw new HttpError(500, `post lookup failed: ${postError.message}`);
  if (!post) throw notFound("Post not found");
  return { vote_score: (post as { vote_score: number }).vote_score, my_vote: myVote };
}

// ---------------------------------------------------------------------------
// Shared answers — peer review
// ---------------------------------------------------------------------------
interface SubmissionForShareRow {
  user_id: string;
  question_id: string | null;
  custom_question_text_i18n: BilingualText | null;
  typed_text: string | null;
  image_paths: string[] | null;
  questions: { stem_i18n: BilingualText } | null;
}

interface EvaluationForShareRow {
  overall_score: number | null;
  max_score: number | null;
  dimension_scores: DimensionScore[] | null;
}

async function buildSharedAnswer(
  sharedAnswerId: string,
  submissionId: string,
  threadId: string,
  createdAt: string,
): Promise<SharedAnswer> {
  const { data: submission, error: subError } = await supabase()
    .from("answer_submissions")
    .select("user_id, question_id, custom_question_text_i18n, typed_text, image_paths, questions(stem_i18n)")
    .eq("id", submissionId)
    .maybeSingle();
  if (subError) throw new HttpError(500, `submission lookup failed: ${subError.message}`);
  const sub = submission as unknown as SubmissionForShareRow | null;
  if (!sub) throw notFound("Submission not found");

  const { data: evaluation, error: evalError } = await supabase()
    .from("evaluations")
    .select("overall_score, max_score, dimension_scores")
    .eq("submission_id", submissionId)
    .maybeSingle();
  if (evalError) throw new HttpError(500, `evaluation lookup failed: ${evalError.message}`);
  const evalRow = evaluation as unknown as EvaluationForShareRow | null;

  const { data: threadRow, error: threadError } = await supabase()
    .from("discussion_threads")
    .select("post_count")
    .eq("id", threadId)
    .maybeSingle();
  if (threadError) throw new HttpError(500, `thread lookup failed: ${threadError.message}`);

  const { data: threadPostIds, error: threadPostIdsError } = await supabase()
    .from("discussion_posts")
    .select("id")
    .eq("thread_id", threadId);
  if (threadPostIdsError) throw new HttpError(500, `thread post lookup failed: ${threadPostIdsError.message}`);
  const postIds = (threadPostIds ?? []).map((r) => r.id as string);
  let helpfulCount = 0;
  if (postIds.length > 0) {
    const { count, error: helpfulError } = await supabase()
      .from("post_votes")
      .select("id", { count: "exact", head: true })
      .eq("value", 1)
      .in("post_id", postIds);
    if (helpfulError) throw new HttpError(500, `helpful-count lookup failed: ${helpfulError.message}`);
    helpfulCount = count ?? 0;
  }

  const authors = await fetchAuthors([sub.user_id]);
  return {
    id: sharedAnswerId,
    submission_id: submissionId,
    author: authors.get(sub.user_id) ?? { id: sub.user_id, handle: null, display_name: null },
    thread_id: threadId,
    question_text_i18n: sub.questions?.stem_i18n ?? sub.custom_question_text_i18n ?? { hi: "", en: "" },
    answer_text: sub.typed_text,
    image_paths: sub.image_paths,
    overall_score: evalRow?.overall_score ?? null,
    max_score: evalRow?.max_score ?? null,
    dimension_scores: evalRow?.dimension_scores ?? null,
    helpful_count: helpfulCount,
    post_count: (threadRow as { post_count: number } | null)?.post_count ?? 0,
    created_at: createdAt,
  };
}

/** Excerpt of a question/answer for a peer-review thread title. */
function truncate(text: string, max = 80): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

/** Look up an already-shared answer's row + its anchor thread, if one exists. */
async function findExistingShare(submissionId: string): Promise<{ id: string; created_at: string; threadId: string } | null> {
  const { data: existing, error: existingError } = await supabase()
    .from("shared_answers")
    .select("id, created_at")
    .eq("submission_id", submissionId)
    .maybeSingle();
  if (existingError) throw new HttpError(500, `shared answer lookup failed: ${existingError.message}`);
  if (!existing) return null;

  const { data: existingThread, error: threadLookupError } = await supabase()
    .from("discussion_threads")
    .select("id")
    .eq("anchor_type", "shared_answer")
    .eq("anchor_id", (existing as { id: string }).id)
    .maybeSingle();
  if (threadLookupError) throw new HttpError(500, `thread lookup failed: ${threadLookupError.message}`);
  if (!existingThread) throw new HttpError(500, "shared answer is missing its discussion thread");

  return {
    id: (existing as { id: string }).id,
    created_at: (existing as { created_at: string }).created_at,
    threadId: (existingThread as { id: string }).id,
  };
}

export async function shareAnswerForPeerReview(userId: string, submissionId: string): Promise<SharedAnswer> {
  const { data: submission, error: subError } = await supabase()
    .from("answer_submissions")
    .select("user_id, status, custom_question_text_i18n, questions(stem_i18n)")
    .eq("id", submissionId)
    .maybeSingle();
  if (subError) throw new HttpError(500, `submission lookup failed: ${subError.message}`);
  const sub = submission as unknown as
    | { user_id: string; status: string; custom_question_text_i18n: BilingualText | null; questions: { stem_i18n: BilingualText } | null }
    | null;
  if (!sub || sub.user_id !== userId) throw notFound("Submission not found");
  if (sub.status !== "complete") throw badRequest("This answer hasn't finished evaluating yet");

  const existing = await findExistingShare(submissionId);
  if (existing) {
    return buildSharedAnswer(existing.id, submissionId, existing.threadId, existing.created_at);
  }

  const { data: shared, error: shareError } = await supabase()
    .from("shared_answers")
    .insert({ submission_id: submissionId, user_id: userId })
    .select("id, created_at")
    .single();
  if (shareError) {
    // 23505 = unique violation on submission_id — a concurrent request beat
    // us to it between the check above and this insert. Rather than surface
    // a raw 500 for what is really a successful (idempotent) share, look up
    // and return whatever the other request just created.
    if (shareError.code === "23505") {
      const wonByOther = await findExistingShare(submissionId);
      if (wonByOther) return buildSharedAnswer(wonByOther.id, submissionId, wonByOther.threadId, wonByOther.created_at);
    }
    throw new HttpError(500, `share failed: ${shareError.message}`);
  }
  const sharedRow = shared as { id: string; created_at: string };

  const questionExcerpt = truncate(sub.questions?.stem_i18n?.en ?? sub.custom_question_text_i18n?.en ?? "an answer");
  const { data: thread, error: threadError } = await supabase()
    .from("discussion_threads")
    .insert({
      anchor_type: "shared_answer",
      anchor_id: sharedRow.id,
      title: `Peer review: ${questionExcerpt}`,
      user_id: userId,
    })
    .select("id")
    .single();
  if (threadError) throw new HttpError(500, `peer-review thread creation failed: ${threadError.message}`);

  return buildSharedAnswer(sharedRow.id, submissionId, (thread as { id: string }).id, sharedRow.created_at);
}

export async function getSharedAnswer(id: string): Promise<SharedAnswer> {
  const { data, error } = await supabase().from("shared_answers").select("id, submission_id, created_at").eq("id", id).maybeSingle();
  if (error) throw new HttpError(500, `shared answer lookup failed: ${error.message}`);
  if (!data) throw notFound("Shared answer not found");
  const row = data as { id: string; submission_id: string; created_at: string };
  const { data: threadRow, error: threadError } = await supabase()
    .from("discussion_threads")
    .select("id")
    .eq("anchor_type", "shared_answer")
    .eq("anchor_id", id)
    .maybeSingle();
  if (threadError) throw new HttpError(500, `thread lookup failed: ${threadError.message}`);
  if (!threadRow) throw notFound("Shared answer not found");
  return buildSharedAnswer(row.id, row.submission_id, (threadRow as { id: string }).id, row.created_at);
}

export async function listSharedAnswers(
  viewerId: string,
  page: number,
): Promise<{ items: SharedAnswer[]; pagination: PaginationMeta }> {
  const from = (page - 1) * SHARED_ANSWERS_PAGE_SIZE;
  const to = from + SHARED_ANSWERS_PAGE_SIZE - 1;
  const { data, count, error } = await supabase()
    .from("shared_answers")
    .select("id, submission_id, user_id, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);
  if (error) throw new HttpError(500, `shared answers list failed: ${error.message}`);

  const blocked = await fetchBlockedIds(viewerId);
  const rows = (data ?? []).filter((r) => !blocked.has(r.user_id as string)) as {
    id: string;
    submission_id: string;
    user_id: string;
    created_at: string;
  }[];

  const items = await Promise.all(
    rows.map(async (r) => {
      const { data: threadRow } = await supabase()
        .from("discussion_threads")
        .select("id")
        .eq("anchor_type", "shared_answer")
        .eq("anchor_id", r.id)
        .maybeSingle();
      const threadId = (threadRow as { id: string } | null)?.id;
      if (!threadId) return null;
      return buildSharedAnswer(r.id, r.submission_id, threadId, r.created_at);
    }),
  );

  const total = count ?? 0;
  return {
    items: items.filter((i): i is SharedAnswer => i !== null),
    pagination: {
      page,
      page_size: SHARED_ANSWERS_PAGE_SIZE,
      total,
      total_pages: Math.max(1, Math.ceil(total / SHARED_ANSWERS_PAGE_SIZE)),
    },
  };
}

// ---------------------------------------------------------------------------
// Community hub
// ---------------------------------------------------------------------------
export async function getCommunityHub(userId: string): Promise<CommunityHub> {
  const blocked = await fetchBlockedIds(userId);

  const [recentResult, sharedResult, mineResult] = await Promise.all([
    supabase()
      .from("discussion_threads")
      .select(THREAD_COLUMNS)
      .eq("moderation_status", "visible")
      .order("updated_at", { ascending: false })
      .limit(HUB_LIST_SIZE * 2),
    listSharedAnswers(userId, 1),
    supabase()
      .from("discussion_threads")
      .select(THREAD_COLUMNS)
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(HUB_LIST_SIZE),
  ]);
  if (recentResult.error) throw new HttpError(500, `recent threads lookup failed: ${recentResult.error.message}`);
  if (mineResult.error) throw new HttpError(500, `my threads lookup failed: ${mineResult.error.message}`);

  const recentRows = ((recentResult.data ?? []) as unknown as ThreadRow[])
    .filter((r) => !blocked.has(r.user_id))
    .slice(0, HUB_LIST_SIZE);
  const mineRows = (mineResult.data ?? []) as unknown as ThreadRow[];

  const authors = await fetchAuthors([...recentRows.map((r) => r.user_id), ...mineRows.map((r) => r.user_id)]);

  return {
    recent_threads: recentRows.map((r) => toThread(r, authors)),
    open_peer_review: sharedResult.items.slice(0, HUB_LIST_SIZE),
    my_threads: mineRows.map((r) => toThread(r, authors)),
  };
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------
export async function reportContent(
  reporterId: string,
  targetType: ReportTargetType,
  targetId: string,
  reason: ReportReason,
  detail?: string,
): Promise<{ id: string; status: string }> {
  if (targetType === "post") {
    const { data, error } = await supabase().from("discussion_posts").select("id").eq("id", targetId).maybeSingle();
    if (error) throw new HttpError(500, `post lookup failed: ${error.message}`);
    if (!data) throw notFound("Post not found");
  } else {
    const { data, error } = await supabase().from("discussion_threads").select("id").eq("id", targetId).maybeSingle();
    if (error) throw new HttpError(500, `thread lookup failed: ${error.message}`);
    if (!data) throw notFound("Thread not found");
  }

  const { data: existing, error: existingError } = await supabase()
    .from("reports")
    .select("id, status")
    .eq("target_type", targetType)
    .eq("target_id", targetId)
    .eq("reporter_id", reporterId)
    .maybeSingle();
  if (existingError) throw new HttpError(500, `report lookup failed: ${existingError.message}`);

  // The unique index is on (target_type, target_id, reporter_id), so a
  // reporter can only ever have ONE row per target — including one an admin
  // already dismissed/actioned. If we just returned that stale row as-is, the
  // same reporter could never report the same content again even if it later
  // became newly problematic (e.g. edited after a dismissal for an unrelated
  // reason). Only short-circuit for a still-open report; otherwise reopen the
  // existing row with the fresh reason/detail rather than silently no-op'ing.
  if (existing && (existing as { status: string }).status === "open") {
    return existing as { id: string; status: string };
  }
  if (existing) {
    const { data: reopened, error: reopenError } = await supabase()
      .from("reports")
      .update({ status: "open", reason, detail: detail ?? null, resolved_by: null, resolved_at: null })
      .eq("id", (existing as { id: string }).id)
      .select("id, status")
      .single();
    if (reopenError) throw new HttpError(500, `report reopen failed: ${reopenError.message}`);
    return reopened as { id: string; status: string };
  }

  const { data: report, error } = await supabase()
    .from("reports")
    .insert({ target_type: targetType, target_id: targetId, reporter_id: reporterId, reason, detail: detail ?? null })
    .select("id, status")
    .single();
  if (error) throw new HttpError(500, `report creation failed: ${error.message}`);
  return report as { id: string; status: string };
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------
export async function blockUser(blockerId: string, blockedId: string): Promise<void> {
  if (blockerId === blockedId) throw badRequest("You cannot block yourself");
  const { error } = await supabase()
    .from("user_blocks")
    .upsert({ blocker_id: blockerId, blocked_id: blockedId }, { onConflict: "blocker_id,blocked_id" });
  if (error) throw new HttpError(500, `block failed: ${error.message}`);
}

export async function unblockUser(blockerId: string, blockedId: string): Promise<void> {
  const { error } = await supabase()
    .from("user_blocks")
    .delete()
    .eq("blocker_id", blockerId)
    .eq("blocked_id", blockedId);
  if (error) throw new HttpError(500, `unblock failed: ${error.message}`);
}

export async function listBlocks(
  blockerId: string,
): Promise<{ items: { blocked_user_id: string; handle: string | null; display_name: string | null; created_at: string }[] }> {
  const { data, error } = await supabase()
    .from("user_blocks")
    .select("blocked_id, created_at")
    .eq("blocker_id", blockerId)
    .order("created_at", { ascending: false });
  if (error) throw new HttpError(500, `block list failed: ${error.message}`);
  const rows = (data ?? []) as { blocked_id: string; created_at: string }[];
  const authors = await fetchAuthors(rows.map((r) => r.blocked_id));
  return {
    items: rows.map((r) => {
      const a = authors.get(r.blocked_id);
      return { blocked_user_id: r.blocked_id, handle: a?.handle ?? null, display_name: a?.display_name ?? null, created_at: r.created_at };
    }),
  };
}
