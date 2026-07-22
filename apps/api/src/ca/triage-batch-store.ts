/**
 * Data access over `ca_triage_batches` (migration 0076) — the exactly-once
 * ledger between SUBMITTING a CA item for batched triage and COLLECTING its
 * result in a later process.
 *
 * THE CONTRACT
 * Every item that is submitted ends in exactly ONE terminal state:
 *   - 'collected' — its triage result was applied and the pipeline continued.
 *   - 'failed'    — unrecoverable (the batch errored/expired, the response was
 *                   unusable, or the row outlived PENDING_TTL_HOURS).
 * A crash mid-collect leaves the row 'pending', so the NEXT run simply picks it
 * up again — retry is safe because the downstream insert into
 * current_affairs_items is keyed on `content_hash`: a re-insert of an item that
 * did land raises 23505 and is treated as a duplicate, not a new item.
 *
 * THE LOCK
 * Between submit and collect an item is NOT yet in current_affairs_items, so
 * the pipeline's normal content_hash dedupe cannot see it and RSS would happily
 * re-feed it. The partial unique index on `content_hash where status in
 * ('claimed','pending')` is what prevents paying for the same item twice.
 * `loadInFlightHashes` is the cheap read-side of that lock (skip these items
 * before spending an embedding/LLM call); `claimForSubmission` is the
 * authoritative write-side, and tolerates the 23505 that a race produces.
 */
import type { PostgrestError } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase.js";
import { selectAll } from "../lib/paginate.js";
import { logger } from "../lib/logger.js";

/** 'claimed' rows older than this are orphans from a died-mid-submit process. */
export const CLAIM_TTL_MINUTES = 15;

/**
 * 'pending' rows older than this are declared failed. 26h is just past
 * Anthropic's 24h batch-completion guarantee, so a batch that has not ended by
 * then is never going to.
 */
export const PENDING_TTL_HOURS = 26;

/** Terminal rows older than this are pruned so the ledger stays bounded. */
const PRUNE_AFTER_DAYS = 30;

/** Postgres unique-violation SQLSTATE — the in-flight lock rejecting a duplicate. */
const UNIQUE_VIOLATION = "23505";

const TABLE = "ca_triage_batches";

export interface PendingTriagePayload {
  link: string;
  title: string;
  snippet: string;
  /** IST calendar date string YYYY-MM-DD, already computed at submit time. */
  date: string;
  sourceId: string;
  sourceIsUp: boolean;
  /** The syllabus candidate ids the model was actually SHOWN (post pre-filter). */
  candidateIds: string[];
}

export interface PendingTriageRow {
  id: string;
  batchId: string;
  customId: string;
  contentHash: string;
  payload: PendingTriagePayload;
}

export interface ClaimInput {
  customId: string;
  contentHash: string;
  payload: PendingTriagePayload;
}

export interface ReapResult {
  releasedClaims: number;
  failedStale: number;
  pruned: number;
}

function isUniqueViolation(error: PostgrestError | null): boolean {
  return error?.code === UNIQUE_VIOLATION;
}

function minutesAgoIso(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

/**
 * content_hash of every item currently claimed or pending — never re-submit
 * these (see the lock note in the file header).
 *
 * PAGED: a submit run can leave hundreds of rows in flight at once and a
 * collect backlog compounds that, so this read can exceed PostgREST's 1000-row
 * cap. An unranged `.select()` would silently return the first 1000 and LIE
 * rather than error — which here would mean re-submitting (and re-paying for)
 * every item past the cap. This repo has been bitten by that exact truncation
 * three separate times; always page, always with a deterministic `.order()`.
 */
export async function loadInFlightHashes(): Promise<Set<string>> {
  const rows = await selectAll<{ content_hash: string }>(() =>
    supabase()
      .from(TABLE)
      .select("content_hash")
      .in("status", ["claimed", "pending"])
      .order("id", { ascending: true }), // stable key so paging can't skip/repeat
  );
  return new Set(rows.map((r) => r.content_hash));
}

/**
 * Insert `claimed` rows, taking the per-hash in-flight lock.
 *
 * Returns one `{ rowId, customId }` per input that was ACTUALLY claimed — a
 * 23505 on the partial content_hash index means another process (or a bug)
 * already has that item in flight, which must never abort the whole run. The
 * fast path is a single batch insert; if that trips the unique index we fall
 * back to inserting one at a time and silently skip the conflicting ones, so
 * the caller can tell exactly which items it owns.
 */
export async function claimForSubmission(
  items: ClaimInput[],
): Promise<{ rowId: string; customId: string }[]> {
  if (items.length === 0) return [];

  const payloadFor = (i: ClaimInput) => ({
    custom_id: i.customId,
    content_hash: i.contentHash,
    payload: i.payload,
    status: "claimed",
  });

  const { data, error } = await supabase()
    .from(TABLE)
    .insert(items.map(payloadFor))
    .select("id, custom_id");

  if (!error) {
    const byCustomId = new Map((data ?? []).map((r) => [r.custom_id as string, r.id as string]));
    // Preserve the caller's input order rather than PostgREST's return order.
    return items
      .filter((i) => byCustomId.has(i.customId))
      .map((i) => ({ rowId: byCustomId.get(i.customId)!, customId: i.customId }));
  }

  if (!isUniqueViolation(error)) {
    throw new Error(`ca_triage_batches claim failed: ${error.message}`);
  }

  // At least one item is already in flight — the whole batch insert was rolled
  // back, so retry individually and keep whatever we can legitimately claim.
  const claimed: { rowId: string; customId: string }[] = [];
  let skipped = 0;
  for (const item of items) {
    const one = await supabase().from(TABLE).insert(payloadFor(item)).select("id").single();
    if (one.error) {
      if (isUniqueViolation(one.error)) {
        skipped++;
        continue;
      }
      throw new Error(`ca_triage_batches claim failed: ${one.error.message}`);
    }
    claimed.push({ rowId: one.data.id as string, customId: item.customId });
  }
  if (skipped > 0) {
    logger.warn(
      { skipped, requested: items.length, claimed: claimed.length },
      "ca triage: some items were already in flight; skipped re-submitting them",
    );
  }
  return claimed;
}

/** Flip claimed rows -> pending, recording the real Anthropic batch id. */
export async function markSubmitted(rowIds: string[], batchId: string): Promise<void> {
  if (rowIds.length === 0) return;
  const { error } = await supabase()
    .from(TABLE)
    .update({ batch_id: batchId, status: "pending", submitted_at: new Date().toISOString() })
    .in("id", rowIds);
  if (error) throw new Error(`ca_triage_batches markSubmitted failed: ${error.message}`);
}

/**
 * Delete claimed rows because submission failed — releases their hash lock so
 * the items are re-fed from RSS on the next run instead of being stranded.
 */
export async function releaseClaims(rowIds: string[]): Promise<void> {
  if (rowIds.length === 0) return;
  const { error } = await supabase().from(TABLE).delete().in("id", rowIds);
  if (error) throw new Error(`ca_triage_batches releaseClaims failed: ${error.message}`);
}

/**
 * Distinct batch ids that still have pending rows, oldest submission first.
 *
 * Grouped in JS over a paged select: PostgREST has no GROUP BY, and at this
 * volume (a handful of batches, at most a few thousand pending rows) grouping
 * client-side is both simpler and cheap. Paged for the same 1000-row-cap
 * reason as loadInFlightHashes.
 */
export async function listPendingBatches(): Promise<
  { batchId: string; submittedAt: string; count: number }[]
> {
  const rows = await selectAll<{ batch_id: string | null; submitted_at: string | null }>(() =>
    supabase()
      .from(TABLE)
      .select("batch_id, submitted_at")
      .eq("status", "pending")
      .not("batch_id", "is", null)
      .order("id", { ascending: true }), // stable key so paging can't skip/repeat
  );

  const grouped = new Map<string, { submittedAt: string; count: number }>();
  for (const row of rows) {
    if (!row.batch_id) continue;
    const submittedAt = row.submitted_at ?? "";
    const existing = grouped.get(row.batch_id);
    if (!existing) {
      grouped.set(row.batch_id, { submittedAt, count: 1 });
      continue;
    }
    existing.count++;
    // Oldest submitted_at within the batch represents the batch itself.
    if (submittedAt && (!existing.submittedAt || submittedAt < existing.submittedAt)) {
      existing.submittedAt = submittedAt;
    }
  }

  return [...grouped.entries()]
    .map(([batchId, v]) => ({ batchId, submittedAt: v.submittedAt, count: v.count }))
    .sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));
}

/**
 * Every still-pending row of one batch, with its payload rehydrated.
 *
 * PAGED — one batch can carry well over 1000 items, which is exactly the size
 * at which an unranged select silently truncates (and we would then mark a
 * batch fully collected while quietly dropping the tail).
 */
export async function loadPendingRows(batchId: string): Promise<PendingTriageRow[]> {
  const rows = await selectAll<{
    id: string;
    batch_id: string;
    custom_id: string;
    content_hash: string;
    payload: PendingTriagePayload;
  }>(() =>
    supabase()
      .from(TABLE)
      .select("id, batch_id, custom_id, content_hash, payload")
      .eq("batch_id", batchId)
      .eq("status", "pending")
      .order("id", { ascending: true }), // stable key so paging can't skip/repeat
  );
  return rows.map((r) => ({
    id: r.id,
    batchId: r.batch_id,
    customId: r.custom_id,
    contentHash: r.content_hash,
    payload: r.payload,
  }));
}

/** Terminal success: this item's triage result was applied. */
export async function markCollected(rowId: string): Promise<void> {
  const { error } = await supabase()
    .from(TABLE)
    .update({ status: "collected", collected_at: new Date().toISOString() })
    .eq("id", rowId);
  if (error) throw new Error(`ca_triage_batches markCollected failed: ${error.message}`);
}

/** Terminal failure: the item may re-enter via RSS on a later run. */
export async function markFailed(rowId: string, error: string): Promise<void> {
  const res = await supabase()
    .from(TABLE)
    .update({
      status: "failed",
      last_error: error.slice(0, 500),
      collected_at: new Date().toISOString(),
    })
    .eq("id", rowId);
  if (res.error) throw new Error(`ca_triage_batches markFailed failed: ${res.error.message}`);
}

/**
 * Housekeeping, run at the start of every collect phase:
 *  - `claimed` rows older than CLAIM_TTL_MINUTES (15) -> DELETED. These are
 *    orphans from a process that died between claiming and a successful
 *    batches.create; deleting releases the hash so the item is re-fed from RSS.
 *  - `pending` rows whose submitted_at is older than PENDING_TTL_HOURS (26,
 *    just past Anthropic's 24h completion guarantee) -> status 'failed'. The
 *    item then re-enters via RSS on a later run.
 *  - `collected`/`failed` rows older than 30 days -> deleted (bounded growth).
 */
export async function reapStale(): Promise<ReapResult> {
  const db = supabase();

  const releasedRes = await db
    .from(TABLE)
    .delete()
    .eq("status", "claimed")
    .lt("created_at", minutesAgoIso(CLAIM_TTL_MINUTES))
    .select("id");
  if (releasedRes.error) throw new Error(`ca_triage_batches reap (claims) failed: ${releasedRes.error.message}`);

  const failedRes = await db
    .from(TABLE)
    .update({
      status: "failed",
      last_error: `pending for more than ${PENDING_TTL_HOURS}h (past Anthropic's 24h batch guarantee)`,
      collected_at: new Date().toISOString(),
    })
    .eq("status", "pending")
    .lt("submitted_at", minutesAgoIso(PENDING_TTL_HOURS * 60))
    .select("id");
  if (failedRes.error) throw new Error(`ca_triage_batches reap (pending) failed: ${failedRes.error.message}`);

  const prunedRes = await db
    .from(TABLE)
    .delete()
    .in("status", ["collected", "failed"])
    .lt("created_at", minutesAgoIso(PRUNE_AFTER_DAYS * 24 * 60))
    .select("id");
  if (prunedRes.error) throw new Error(`ca_triage_batches reap (prune) failed: ${prunedRes.error.message}`);

  const result: ReapResult = {
    releasedClaims: releasedRes.data?.length ?? 0,
    failedStale: failedRes.data?.length ?? 0,
    pruned: prunedRes.data?.length ?? 0,
  };
  if (result.releasedClaims > 0 || result.failedStale > 0) {
    logger.warn(result, "ca triage: reaped stale batch-ledger rows");
  }
  return result;
}
