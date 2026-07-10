/**
 * Mentor FAQ-cache health probe (Session 26.5).
 *
 * Migrations are pushed manually, so 0049 (the doubt_faq_cache table +
 * match_doubt_faq RPC) or 0070 (the mode column + new RPC signature) can be
 * missing in an environment nobody remembered to migrate — and the failure is
 * silent: lookups just error, get swallowed, and every doubt regenerates from
 * scratch with no cache. This probe makes that loud: it runs once at boot (an
 * ERROR log, not a swallowed warn, when broken) and feeds a line into the
 * /health detail so it's visible without reading logs.
 */
import { supabase } from "../../lib/supabase.js";
import { logger } from "../../lib/logger.js";
import { EMBEDDING_DIMENSIONS } from "../../lib/embeddings.js";

export interface MentorCacheHealth {
  /** doubt_faq_cache table exists and is selectable. */
  table_ok: boolean;
  /** match_doubt_faq RPC exists, runs, and returns the post-0070 `mode` column. */
  rpc_ok: boolean;
  checked_at: string;
  detail: string;
}

/** A cheap, valid non-zero unit vector literal for probing the ANN RPC. */
function probeVectorLiteral(): string {
  const v = new Array(EMBEDDING_DIMENSIONS).fill(0);
  v[0] = 1;
  return `[${v.join(",")}]`;
}

let cached: MentorCacheHealth | null = null;
const TTL_MS = 30_000;

async function probe(): Promise<MentorCacheHealth> {
  const db = supabase();

  // (a) table present + selectable, AND carries the post-0070 `mode` column
  // (selecting `mode` fails on a pre-0070 table even when the cache is empty,
  // which the RPC probe below can't catch on an empty cache).
  const { error: tableErr } = await db.from("doubt_faq_cache").select("id, mode").limit(1);
  const tableOk = !tableErr;

  // (b) RPC present, runs, and returns the mode column (proves 0070 applied)
  let rpcOk = false;
  const { data: rpcData, error: rpcErr } = await db.rpc("match_doubt_faq", {
    query_embedding: probeVectorLiteral(),
    filter_locale: "en",
    match_count: 1,
  });
  if (!rpcErr) {
    const rows = (rpcData ?? []) as Record<string, unknown>[];
    // An empty cache is fine (rpcOk); if there IS a row it must carry `mode`.
    rpcOk = rows.length === 0 || "mode" in rows[0];
  }

  const detail = tableOk && rpcOk
    ? "ok"
    : [
        !tableOk ? "doubt_faq_cache table missing or pre-0070 (migrations 0049/0070)" : null,
        tableOk && !rpcOk ? "match_doubt_faq RPC missing or pre-0070 (migrations 0049/0070)" : null,
      ]
        .filter(Boolean)
        .join("; ");

  return { table_ok: tableOk, rpc_ok: rpcOk, checked_at: new Date().toISOString(), detail };
}

/** Probe with a short TTL cache so /health never hammers the DB per request. */
export async function getMentorCacheHealth(force = false): Promise<MentorCacheHealth> {
  if (!force && cached && Date.now() - Date.parse(cached.checked_at) < TTL_MS) return cached;
  try {
    cached = await probe();
  } catch (err) {
    cached = {
      table_ok: false,
      rpc_ok: false,
      checked_at: new Date().toISOString(),
      detail: `probe failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  return cached;
}

/**
 * Boot-time check: logs at ERROR (not a swallowed warn) when the cache is broken
 * so a missing manual migration is surfaced immediately. Best-effort — never
 * throws, so it can't crash-loop the process.
 */
export async function checkMentorCacheHealthAtBoot(): Promise<void> {
  const health = await getMentorCacheHealth(true);
  if (health.table_ok && health.rpc_ok) {
    logger.info("mentor FAQ cache: healthy (doubt_faq_cache + match_doubt_faq OK)");
    return;
  }
  logger.error(
    { health },
    "mentor FAQ cache UNAVAILABLE — every doubt will regenerate with no caching. " +
      `Apply the pending migration(s): ${health.detail}`,
  );
}
