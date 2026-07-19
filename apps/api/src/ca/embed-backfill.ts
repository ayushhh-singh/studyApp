/**
 * ca:embed — backfill / refresh current-affairs embeddings for the RAG store.
 *
 * The `ca:run` pipeline embeds each item inline the moment it's published, but
 * that embed's error path only LOGS a failure (it doesn't retry), and older
 * published items predate the embed step entirely — so published CA items
 * accumulate with no embedding, which makes them invisible to the mentor's doubt
 * grounding (a real, silent RAG gap: ~40% coverage observed). This closes that
 * gap and is the safety net to run after `ca:run` (or weekly).
 *
 *   pnpm ca:embed            # embed only published items with no embedding (default)
 *   pnpm ca:embed --all      # re-embed ALL published items (refresh after edits)
 *   pnpm ca:embed --limit N  # cap the number of items processed
 *
 * The embedded text per item per locale is `${title}. ${summary}` — byte-identical
 * to the ca:run pipeline (pipeline.ts's embedTasks), so a backfilled embedding is
 * indistinguishable from an inline one. One chunk per (item, locale), chunk_index=0
 * (CA content is a short headline+summary, never split). Idempotent: upsert on
 * (source_type, source_id, locale, chunk_index).
 */
import { supabase } from "../lib/supabase.js";
import { selectAll } from "../lib/paginate.js";
import { embeddings } from "../lib/embeddings.js";
import { toVectorLiteral, upsertEmbeddingRows, type EmbeddingRow } from "../lib/embed-upsert.js";
import { computeEmbedCoverage } from "../ingest/embed-coverage.js";

type Loc = "hi" | "en";
const LOCALES: Loc[] = ["hi", "en"];

interface CaItemRow {
  id: string;
  title_i18n: { hi?: string; en?: string } | null;
  summary_i18n: { hi?: string; en?: string } | null;
}

/** Exactly the pipeline's per-locale embed text: `${title}. ${summary}`. */
function embedText(title: string | undefined, summary: string | undefined): string {
  return `${title ?? ""}. ${summary ?? ""}`.replace(/\s+/g, " ").trim();
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const all = argv.includes("--all");
  const limIdx = argv.indexOf("--limit");
  const limit = limIdx >= 0 ? Math.max(0, Number(argv[limIdx + 1]) || 0) : undefined;

  console.log(`ca:embed  (provider: ${embeddings().id}, ${embeddings().dimensions}d)${all ? "  [all published]" : "  [missing only]"}`);

  // Default: only items with NO embedding (reuse the shared coverage source of truth).
  let targetIds: Set<string> | null = null; // null → every published item (--all)
  if (!all) {
    const coverage = await computeEmbedCoverage();
    const ca = coverage.find((c) => c.source_type === "current_affairs");
    targetIds = new Set(ca?.missing ?? []);
    console.log(`  published CA items missing an embedding: ${targetIds.size}`);
    if (targetIds.size === 0) {
      console.log("nothing to embed.");
      return;
    }
  }

  // Every published item (bilingual publish gate guarantees title+summary in both
  // locales; page past PostgREST's 1000-row cap — the published set exceeds 1000).
  const items = await selectAll<CaItemRow>(() =>
    supabase().from("current_affairs_items").select("id, title_i18n, summary_i18n").eq("status", "published").order("id"),
  );

  interface Task {
    id: string;
    locale: Loc;
    text: string;
  }
  const tasks: Task[] = [];
  let skippedEmptyLocale = 0;
  for (const it of typeof limit === "number" ? items.slice(0, limit) : items) {
    if (targetIds && !targetIds.has(it.id)) continue;
    for (const loc of LOCALES) {
      const title = it.title_i18n?.[loc];
      const summary = it.summary_i18n?.[loc];
      if (!title && !summary) {
        // Defensive: a published item should have both (publish gate), but never
        // embed a degenerate lone "." — skip and count it so the gap stays visible.
        skippedEmptyLocale++;
        continue;
      }
      tasks.push({ id: it.id, locale: loc, text: embedText(title, summary) });
    }
  }

  if (skippedEmptyLocale > 0) console.log(`  ⚠ skipped ${skippedEmptyLocale} empty locale(s) (published item missing title+summary — unexpected)`);
  if (tasks.length === 0) {
    console.log("nothing to embed (no eligible item text).");
    return;
  }

  const provider = embeddings();
  const EMBED_BATCH = 96;
  let done = 0;
  for (let i = 0; i < tasks.length; i += EMBED_BATCH) {
    const batch = tasks.slice(i, i + EMBED_BATCH);
    const vectors = await provider.embed(batch.map((t) => t.text));
    const rows: EmbeddingRow[] = batch.map((t, j) => ({
      source_type: "current_affairs",
      source_id: t.id,
      locale: t.locale,
      chunk_index: 0,
      chunk_text: t.text,
      embedding: toVectorLiteral(vectors[j]),
    }));
    await upsertEmbeddingRows(rows, { batchSize: 12, onWarn: (m) => console.warn(`  (warn) ${m}`) });
    done += rows.length;
    console.log(`  embedded ${done}/${tasks.length}`);
  }
  const itemCount = new Set(tasks.map((t) => t.id)).size;
  console.log(`✓ ${done} CA embedding chunk(s) upserted across ${itemCount} item(s).`);
}

main().catch((err) => {
  console.error("\nca:embed failed:", err instanceof Error ? err.stack : err);
  process.exit(1);
});
