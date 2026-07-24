/**
 * Saathi chat read-side (blueprint F2): conversation list for the history
 * drawer, and the message history of one conversation. Both owner-scoped by
 * user_id (defense in depth alongside RLS). `system` rows are never returned.
 */
import type {
  SukoonChatHistory,
  SukoonConversation,
  SukoonMessage,
} from "@neev/shared";
import { supabase } from "../../lib/supabase.js";
import { HttpError } from "../../lib/http-error.js";

const CONVERSATION_LIST_LIMIT = 50;
const MESSAGE_LIMIT = 200;

interface ConversationRow {
  id: string;
  started_at: string;
  last_message_at: string | null;
  summary: string | null;
}

function toConversation(row: ConversationRow): SukoonConversation {
  return {
    id: row.id,
    started_at: row.started_at,
    last_message_at: row.last_message_at,
    preview: row.summary,
  };
}

/** The user's conversations, newest activity first (history drawer). */
export async function listSukoonConversations(userId: string): Promise<SukoonConversation[]> {
  const { data, error } = await supabase()
    .from("sukoon_conversations")
    .select("id, started_at, last_message_at, summary")
    .eq("user_id", userId)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(CONVERSATION_LIST_LIMIT);
  if (error) throw new HttpError(500, `conversation list failed: ${error.message}`);
  return ((data as ConversationRow[] | null) ?? []).map(toConversation);
}

/**
 * The messages of one conversation (the most recent conversation when
 * `conversationId` is omitted). Returns `{ conversation: null, messages: [] }`
 * when the user has no conversations yet — a fresh Saathi screen, not an error.
 */
export async function getSukoonChatHistory(
  userId: string,
  conversationId?: string,
): Promise<SukoonChatHistory> {
  const db = supabase();

  let conversation: ConversationRow | null;
  if (conversationId) {
    const { data, error } = await db
      .from("sukoon_conversations")
      .select("id, started_at, last_message_at, summary")
      .eq("id", conversationId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new HttpError(500, `conversation lookup failed: ${error.message}`);
    if (!data) throw new HttpError(404, "Conversation not found");
    conversation = data as ConversationRow;
  } else {
    const { data, error } = await db
      .from("sukoon_conversations")
      .select("id, started_at, last_message_at, summary")
      .eq("user_id", userId)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new HttpError(500, `latest conversation lookup failed: ${error.message}`);
    conversation = (data as ConversationRow | null) ?? null;
  }

  if (!conversation) return { conversation: null, messages: [] };

  // Fetch the MOST RECENT window (order desc + limit), then flip to chronological
  // — a plain `ascending limit` would return the OLDEST N and hide recent turns
  // once a conversation grows past MESSAGE_LIMIT.
  const { data: msgData, error: msgError } = await db
    .from("sukoon_messages")
    .select("id, role, content, model_used, crisis_level, created_at")
    .eq("conversation_id", conversation.id)
    .in("role", ["user", "assistant"])
    .order("created_at", { ascending: false })
    .limit(MESSAGE_LIMIT);
  if (msgError) throw new HttpError(500, `message history failed: ${msgError.message}`);

  const messages = ((msgData as SukoonMessage[] | null) ?? []).reverse().map((m) => ({
    ...m,
    // A stored 'none' level carries no UI meaning — normalise to null.
    crisis_level: m.crisis_level === "none" ? null : m.crisis_level,
  }));

  return { conversation: toConversation(conversation), messages };
}
