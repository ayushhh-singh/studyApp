/**
 * Sukoon F4 — Journaling service. The journal is the most sensitive data in the
 * product (SUKOON_CONTEXT / blueprint F4): entry BODIES are encrypted at rest
 * (pgcrypto) and only ever decrypted on the single-entry fetch + export paths,
 * via the SQL RPCs in migration 0081 (which are the only place JOURNAL_ENC_KEY
 * is ever bound). Everything list/search/heatmap-related is METADATA ONLY — no
 * decryption, no body — which is why a list card can never show a text preview
 * (the documented privacy tradeoff). Journal text must NEVER reach logs,
 * analytics, or error messages, so this file logs only ids/counts, never body.
 *
 * Functions take `userId` first (routes pass currentUserId()) and every DB call
 * is owner-scoped by user_id — defense in depth alongside RLS (0079), and the
 * real guard since the API uses the service-role client (bypasses RLS).
 */
import type {
  SukoonJournalEntry,
  SukoonJournalHeatmapDay,
  SukoonJournalListItem,
  SukoonJournalListQuery,
  SukoonJournalPrompt,
  SukoonJournalStreak,
} from "@neev/shared";
import { supabase } from "../../lib/supabase.js";
import { HttpError } from "../../lib/http-error.js";
import { istDateString, istDayRangeUtc, istToday, shiftDate } from "../../lib/ist.js";
import { journalEncKey } from "../config.js";
import { distillAndStoreJournalMemory, deleteMemoryForSource } from "./memory.js";

export const JOURNAL_PAGE_SIZE = 20;
/** Bound the metadata scans that back tag-cloud + streak (a heavy journaler). */
const METADATA_SCAN_CAP = 2000;

/** The one place the key is required — a clear 500 if the env var is unset. */
function requireKey(): string {
  const key = journalEncKey();
  if (!key) {
    throw new HttpError(500, "Journal is not configured (missing encryption key)", {
      feature: "journal_unconfigured",
    });
  }
  return key;
}

/** A raw prompt row (embedded or standalone) → the client prompt shape. */
interface PromptRow {
  id: string;
  text_hi: string;
  text_en: string;
  category: string | null;
  exam_phase: string | null;
}
function toPrompt(row: PromptRow | null): SukoonJournalPrompt | null {
  if (!row) return null;
  return {
    id: row.id,
    text_hi: row.text_hi,
    text_en: row.text_en,
    category: row.category,
    exam_phase: row.exam_phase,
  };
}

const PROMPT_EMBED = "prompt:sukoon_journal_prompts(id,text_hi,text_en,category,exam_phase)";
const LIST_COLUMNS = `id, mood, tags, reflection_at, created_at, updated_at, ${PROMPT_EMBED}`;

interface ListRow {
  id: string;
  mood: number | null;
  tags: string[];
  reflection_at: string | null;
  created_at: string;
  updated_at: string;
  prompt: PromptRow | null;
}
function toListItem(row: ListRow): SukoonJournalListItem {
  return {
    id: row.id,
    mood: row.mood,
    tags: row.tags ?? [],
    prompt: toPrompt(row.prompt),
    has_reflection: row.reflection_at != null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** Normalize tags: trim, drop empties, dedupe (case-insensitive), keep order. */
function cleanTags(tags: string[] | undefined): string[] {
  if (!tags) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const t = raw.trim();
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Single-entry read (the ONLY place a body is decrypted for one entry)
// ---------------------------------------------------------------------------

interface GetRow {
  id: string;
  body: string | null;
  mood: number | null;
  tags: string[];
  prompt_id: string | null;
  audio_path: string | null;
  reflection: string | null;
  reflection_at: string | null;
  created_at: string;
  updated_at: string;
}

export async function getEntry(userId: string, id: string): Promise<SukoonJournalEntry> {
  const key = requireKey();
  const { data, error } = await supabase().rpc("sukoon_journal_get", {
    p_user_id: userId,
    p_id: id,
    p_key: key,
  });
  if (error) throw new HttpError(500, `journal read failed: ${error.message}`);
  const rows = (data as GetRow[] | null) ?? [];
  if (rows.length === 0) throw new HttpError(404, "Entry not found");
  const row = rows[0];

  // Resolve the linked guided prompt (if any) for display context.
  let prompt: SukoonJournalPrompt | null = null;
  if (row.prompt_id) {
    const { data: pr } = await supabase()
      .from("sukoon_journal_prompts")
      .select("id,text_hi,text_en,category,exam_phase")
      .eq("id", row.prompt_id)
      .maybeSingle();
    prompt = toPrompt(pr as PromptRow | null);
  }

  return {
    id: row.id,
    body: row.body,
    mood: row.mood,
    tags: row.tags ?? [],
    prompt,
    has_reflection: row.reflection_at != null,
    reflection: row.reflection,
    reflection_at: row.reflection_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Create / update / delete
// ---------------------------------------------------------------------------

export async function createEntry(
  userId: string,
  input: { body?: string; mood?: number | null; tags?: string[]; prompt_id?: string | null },
): Promise<SukoonJournalEntry> {
  const key = requireKey();
  const { data, error } = await supabase().rpc("sukoon_journal_create", {
    p_user_id: userId,
    p_body: input.body ?? null,
    p_mood: input.mood ?? null,
    p_tags: cleanTags(input.tags),
    p_prompt_id: input.prompt_id ?? null,
    p_key: key,
  });
  if (error) throw new HttpError(500, `journal create failed: ${error.message}`);
  const entry = await getEntry(userId, data as string);
  // RAG memory (blueprint F2): distil a gentle, non-verbatim theme note from the
  // decrypted body ALREADY in hand (no extra decryption) so Saathi can recall
  // this later. Fire-and-forget + best-effort inside — never blocks the save,
  // and the raw body stays encrypted at rest (see services/memory.ts).
  void distillAndStoreJournalMemory({
    userId,
    entryId: entry.id,
    body: entry.body,
    occurredAt: entry.created_at,
  });
  return entry;
}

export async function updateEntry(
  userId: string,
  id: string,
  input: { body?: string; mood?: number | null; tags?: string[] },
): Promise<SukoonJournalEntry> {
  const key = requireKey();
  const { data, error } = await supabase().rpc("sukoon_journal_update", {
    p_user_id: userId,
    p_id: id,
    p_body: input.body ?? null,
    p_mood: input.mood ?? null,
    p_tags: cleanTags(input.tags),
    p_key: key,
  });
  if (error) throw new HttpError(500, `journal update failed: ${error.message}`);
  if ((data as number) === 0) throw new HttpError(404, "Entry not found");
  const entry = await getEntry(userId, id);
  // Re-distil memory from the CURRENT persisted body (an emptied body clears the
  // memory item, keeping it in sync). Same fire-and-forget/encryption posture as
  // create above.
  void distillAndStoreJournalMemory({
    userId,
    entryId: entry.id,
    body: entry.body,
    occurredAt: entry.created_at,
  });
  return entry;
}

/** Soft delete (blueprint F12: deleted_at now, purged later). Owner-scoped. */
export async function deleteEntry(userId: string, id: string): Promise<void> {
  const { data, error } = await supabase()
    .from("sukoon_journal_entries")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .select("id");
  if (error) throw new HttpError(500, `journal delete failed: ${error.message}`);
  if (!data || data.length === 0) throw new HttpError(404, "Entry not found");
  // A deleted entry's distilled memory goes with it (best-effort) — a soft-
  // deleted journal must never keep resurfacing through Saathi's recall.
  void deleteMemoryForSource(userId, "journal", id);
}

// ---------------------------------------------------------------------------
// List / search (METADATA ONLY — never decrypts a body)
// ---------------------------------------------------------------------------

export interface JournalListResult {
  entries: SukoonJournalListItem[];
  total: number;
  page: number;
  page_size: number;
  all_tags: string[];
}

/** Apply the shared metadata filters (mood/tag/category/date-range) to a query. */
function applyFilters<T>(query: T, q: SukoonJournalListQuery): T {
  // Narrow just enough to chain the PostgREST filter builders.
  let qb = query as unknown as {
    eq: (c: string, v: unknown) => typeof qb;
    contains: (c: string, v: unknown) => typeof qb;
    gte: (c: string, v: unknown) => typeof qb;
    lt: (c: string, v: unknown) => typeof qb;
  };
  if (q.mood != null) qb = qb.eq("mood", q.mood);
  if (q.tag) qb = qb.contains("tags", [q.tag]);
  if (q.category) qb = qb.eq("prompt.category", q.category);
  if (q.from) qb = qb.gte("created_at", istDayRangeUtc(q.from).startUtc);
  if (q.to) qb = qb.lt("created_at", istDayRangeUtc(q.to).endUtc);
  return qb as unknown as T;
}

/** Re-count under the same filters (used when an over-range page nulls count). */
async function countEntries(userId: string, q: SukoonJournalListQuery): Promise<number> {
  const inner = q.category ? "!inner" : "";
  const base = supabase()
    .from("sukoon_journal_entries")
    .select(`id, prompt:sukoon_journal_prompts${inner}(category)`, { count: "exact", head: true })
    .eq("user_id", userId)
    .is("deleted_at", null);
  const { count, error } = await applyFilters(base, q);
  if (error) return 0;
  return count ?? 0;
}

export async function listEntries(
  userId: string,
  q: SukoonJournalListQuery,
): Promise<JournalListResult> {
  const page = q.page ?? 1;
  const from = (page - 1) * JOURNAL_PAGE_SIZE;
  const to = from + JOURNAL_PAGE_SIZE - 1;

  // A category filter is a filter on the joined prompt → needs an inner join.
  const selectStr = q.category
    ? LIST_COLUMNS.replace("sukoon_journal_prompts(", "sukoon_journal_prompts!inner(")
    : LIST_COLUMNS;

  const base = supabase()
    .from("sukoon_journal_entries")
    .select(selectStr, { count: "exact" })
    .eq("user_id", userId)
    .is("deleted_at", null);

  const query = applyFilters(base, q).order("created_at", { ascending: false }).range(from, to);

  const { data, error, count } = await query;
  if (error) {
    // A page past the end of the data → PostgREST "range not satisfiable"
    // (PGRST103); return an empty page with the real total instead of a 500
    // (matches the Neev review-queue fix for the same class of bug).
    if (error.code === "PGRST103") {
      const total = await countEntries(userId, q);
      const all_tags = await collectTags(userId);
      return { entries: [], total, page, page_size: JOURNAL_PAGE_SIZE, all_tags };
    }
    throw new HttpError(500, `journal list failed: ${error.message}`);
  }

  const entries = ((data as unknown as ListRow[]) ?? []).map(toListItem);
  const all_tags = await collectTags(userId);
  return { entries, total: count ?? 0, page, page_size: JOURNAL_PAGE_SIZE, all_tags };
}

/** Distinct tag set across the user's non-deleted entries (for filter chips). */
async function collectTags(userId: string): Promise<string[]> {
  const { data, error } = await supabase()
    .from("sukoon_journal_entries")
    .select("tags")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(METADATA_SCAN_CAP);
  if (error) return [];
  const seen = new Set<string>();
  for (const row of (data as { tags: string[] }[] | null) ?? []) {
    for (const t of row.tags ?? []) seen.add(t);
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}

// ---------------------------------------------------------------------------
// Calendar heatmap (metadata only) — per-IST-day count + average mood
// ---------------------------------------------------------------------------

export async function heatmap(userId: string, month: string): Promise<SukoonJournalHeatmapDay[]> {
  // month = "YYYY-MM" → [first-of-month 00:00 IST, first-of-next-month 00:00 IST)
  const firstDay = `${month}-01`;
  const startUtc = istDayRangeUtc(firstDay).startUtc;
  const endUtc = istDayRangeUtc(shiftDate(firstDay, 31)).startUtc; // safely past month end
  const monthEndUtc = istDayRangeUtc(`${nextMonth(month)}-01`).startUtc;

  const { data, error } = await supabase()
    .from("sukoon_journal_entries")
    .select("created_at, mood")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .gte("created_at", startUtc)
    .lt("created_at", monthEndUtc < endUtc ? monthEndUtc : endUtc);
  if (error) throw new HttpError(500, `journal heatmap failed: ${error.message}`);

  const byDay = new Map<string, { count: number; moodSum: number; moodN: number }>();
  for (const row of (data as { created_at: string; mood: number | null }[] | null) ?? []) {
    const day = istDateString(new Date(row.created_at).getTime());
    const cur = byDay.get(day) ?? { count: 0, moodSum: 0, moodN: 0 };
    cur.count += 1;
    if (row.mood != null) {
      cur.moodSum += row.mood;
      cur.moodN += 1;
    }
    byDay.set(day, cur);
  }
  return [...byDay.entries()]
    .map(([date, v]) => ({
      date,
      count: v.count,
      mood: v.moodN > 0 ? Math.round((v.moodSum / v.moodN) * 10) / 10 : null,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function nextMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Gentle "self-care days" streak (blueprint F4 — no loss-aversion; 1 free
// weekly skip so a single missed day never resets the count)
// ---------------------------------------------------------------------------

export async function streak(userId: string): Promise<SukoonJournalStreak> {
  const { data, error } = await supabase()
    .from("sukoon_journal_entries")
    .select("created_at")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(METADATA_SCAN_CAP);
  if (error) throw new HttpError(500, `journal streak failed: ${error.message}`);

  const covered = new Set<string>();
  for (const row of (data as { created_at: string }[] | null) ?? []) {
    covered.add(istDateString(new Date(row.created_at).getTime()));
  }
  const today = istToday();
  const activeToday = covered.has(today);

  // Current streak: walk back from today, counting self-care days (days with an
  // entry). A missed day is forgiven at most once per trailing 7 walked-days
  // (the "1 skip/week"); today itself, if not yet done, is neither a miss nor a
  // break (the day isn't over). A forgiven gap only counts as a USED skip once a
  // covered day actually follows it (i.e. the skip really bridged the streak) —
  // a gap that leads straight to a break preserved nothing.
  let current = 0;
  let skipUsed = false;
  let pendingSkip = false;
  let lastSkipIndex = -Infinity;
  for (let d = 0; d < 400; d++) {
    const date = shiftDate(today, -d);
    if (covered.has(date)) {
      current += 1;
      if (pendingSkip) {
        skipUsed = true;
        pendingSkip = false;
      }
      continue;
    }
    if (d === 0) continue; // today not done yet — don't count, don't break
    if (d - lastSkipIndex >= 7) {
      lastSkipIndex = d;
      pendingSkip = true;
      continue; // forgive this single miss (only "used" if a covered day follows)
    }
    break;
  }

  // Longest: strict max run of consecutive covered days over all history.
  const dates = [...covered].sort();
  let longest = 0;
  let run = 0;
  let prev: string | null = null;
  for (const date of dates) {
    if (prev && shiftDate(prev, 1) === date) run += 1;
    else run = 1;
    if (run > longest) longest = run;
    prev = date;
  }

  return { current, longest, active_today: activeToday, skip_used: skipUsed };
}

// ---------------------------------------------------------------------------
// Guided prompts (F4 picker)
// ---------------------------------------------------------------------------

export async function listPrompts(filters: {
  category?: string;
  exam_phase?: string;
}): Promise<SukoonJournalPrompt[]> {
  let query = supabase()
    .from("sukoon_journal_prompts")
    .select("id,text_hi,text_en,category,exam_phase")
    .eq("active", true);
  if (filters.category) query = query.eq("category", filters.category);
  if (filters.exam_phase) query = query.eq("exam_phase", filters.exam_phase);
  const { data, error } = await query.order("category", { ascending: true });
  if (error) throw new HttpError(500, `journal prompts failed: ${error.message}`);
  return ((data as PromptRow[] | null) ?? []).map((p) => toPrompt(p)!);
}

// ---------------------------------------------------------------------------
// Persist an AI reflection (used by the reflection endpoint after streaming)
// ---------------------------------------------------------------------------

export async function persistReflection(
  userId: string,
  id: string,
  reflection: string,
): Promise<void> {
  const key = requireKey();
  const { data, error } = await supabase().rpc("sukoon_journal_set_reflection", {
    p_user_id: userId,
    p_id: id,
    p_reflection: reflection,
    p_key: key,
  });
  if (error) throw new HttpError(500, `journal reflection persist failed: ${error.message}`);
  if ((data as number) === 0) throw new HttpError(404, "Entry not found");
}

// ---------------------------------------------------------------------------
// Export a date range (decrypted) for the print-to-PDF flow
// ---------------------------------------------------------------------------

interface ExportRow {
  id: string;
  body: string | null;
  mood: number | null;
  tags: string[];
  prompt_id: string | null;
  reflection: string | null;
  created_at: string;
}

export async function exportRange(
  userId: string,
  fromDate: string,
  toDate: string,
): Promise<SukoonJournalEntry[]> {
  const key = requireKey();
  const { data, error } = await supabase().rpc("sukoon_journal_export", {
    p_user_id: userId,
    p_from: istDayRangeUtc(fromDate).startUtc,
    p_to: istDayRangeUtc(toDate).endUtc,
    p_key: key,
  });
  if (error) throw new HttpError(500, `journal export failed: ${error.message}`);
  const rows = (data as ExportRow[] | null) ?? [];

  // Resolve linked prompts in one batch (metadata, non-sensitive).
  const promptIds = [...new Set(rows.map((r) => r.prompt_id).filter((v): v is string => !!v))];
  const promptById = new Map<string, SukoonJournalPrompt>();
  if (promptIds.length > 0) {
    const { data: prompts } = await supabase()
      .from("sukoon_journal_prompts")
      .select("id,text_hi,text_en,category,exam_phase")
      .in("id", promptIds);
    for (const p of (prompts as PromptRow[] | null) ?? []) promptById.set(p.id, toPrompt(p)!);
  }

  return rows.map((r) => ({
    id: r.id,
    body: r.body,
    mood: r.mood,
    tags: r.tags ?? [],
    prompt: r.prompt_id ? (promptById.get(r.prompt_id) ?? null) : null,
    has_reflection: r.reflection != null,
    reflection: r.reflection,
    reflection_at: null,
    created_at: r.created_at,
    updated_at: r.created_at, // export doesn't carry updated_at; entry date suffices
  }));
}
