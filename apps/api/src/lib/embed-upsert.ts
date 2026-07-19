/**
 * Shared, statement-timeout-hardened upsert into the pgvector `embeddings` table.
 * Inserting vectors into the HNSW-indexed table is index-maintenance-heavy, so a
 * large batch can trip Postgres `statement_timeout` (observed live at 96 and
 * intermittently even at 24 rows during a sustained re-embed). Every embed writer
 * (ingest/embed.ts, ca/embed-backfill.ts) goes through this one helper so the
 * small-batch + exponential-backoff behaviour is defined once, not re-derived.
 */
import { supabase } from "./supabase.js";

export interface EmbeddingRow {
  source_type: string;
  source_id: string;
  locale: string;
  chunk_index: number;
  chunk_text: string;
  embedding: string; // pgvector literal, e.g. "[0.1,0.2,…]" — see toVectorLiteral
}

/** number[] → the pgvector text literal PostgREST accepts for an `embedding` column. */
export function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const DEFAULT_BACKOFF_MS = [500, 1000, 2000, 4000];

async function upsertSlice(rows: EmbeddingRow[], onWarn?: (msg: string) => void): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    const { error } = await supabase()
      .from("embeddings")
      .upsert(rows, { onConflict: "source_type,source_id,locale,chunk_index" });
    if (!error) return;
    const timeout = /statement timeout/i.test(error.message);
    if (timeout && attempt < DEFAULT_BACKOFF_MS.length) {
      onWarn?.(`upsert timed out (${rows.length} rows) — retry ${attempt + 1}/${DEFAULT_BACKOFF_MS.length} after ${DEFAULT_BACKOFF_MS[attempt]}ms…`);
      await sleep(DEFAULT_BACKOFF_MS[attempt]);
      continue;
    }
    throw new Error(`upsert embeddings: ${error.message}`);
  }
}

/**
 * Upsert `rows` in small DB batches (default 12) so each statement stays under
 * `statement_timeout`, retrying a transient timeout with backoff. Keyed on
 * (source_type, source_id, locale, chunk_index) — idempotent.
 */
export async function upsertEmbeddingRows(
  rows: EmbeddingRow[],
  opts: { batchSize?: number; onWarn?: (msg: string) => void } = {},
): Promise<void> {
  const batchSize = opts.batchSize ?? 12;
  for (let k = 0; k < rows.length; k += batchSize) {
    await upsertSlice(rows.slice(k, k + batchSize), opts.onWarn);
  }
}
