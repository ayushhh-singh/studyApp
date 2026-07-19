/**
 * ingest:embed:verify — REAL embedding-coverage numbers, per source_type:
 * eligible content rows vs. distinct source_ids actually embedded, flagging both
 * undercoverage (eligible-but-missing → RAG-invisible) and staleness
 * (embedded-but-no-longer-eligible → orphan chunks).
 *
 *   pnpm ingest:embed:verify [--strict] [--show N] [--purge-orphans]
 *
 *   --strict         exit 1 if any type has missing embeddings (for CI / a gate)
 *   --show N         print up to N sample missing/orphan ids per type (default 5)
 *   --purge-orphans  delete embeddings whose source_id is no longer eligible
 *                    (a syllabus node / question that was deleted or un-published
 *                    after it was embedded). A re-embed can't reach these — they
 *                    aren't in the eligible set — so this is the only way to clear
 *                    them. Explicitly opt-in (a verify run never mutates by default).
 *
 * When missing > 0, close the gap with `pnpm ingest:embed` (questions/syllabus)
 * or `pnpm notes:embed` (notes); CA re-embeds on the next `pnpm ca:run`.
 */
import { supabase } from "../lib/supabase.js";
import { report } from "./_shared.js";
import { computeEmbedCoverage, hasCoverageGap, INGEST_EMBED_TYPES, REMEDY, type TypeCoverage } from "./embed-coverage.js";

async function purgeOrphans(coverage: TypeCoverage[]): Promise<number> {
  const IN_BATCH = 100;
  let deleted = 0;
  for (const c of coverage) {
    if (c.orphan.length === 0) continue;
    for (let i = 0; i < c.orphan.length; i += IN_BATCH) {
      const slice = c.orphan.slice(i, i + IN_BATCH);
      const { error } = await supabase()
        .from("embeddings")
        .delete()
        .eq("source_type", c.source_type)
        .in("source_id", slice);
      if (error) throw new Error(`purge ${c.source_type} orphans: ${error.message}`);
      deleted += slice.length;
    }
    report.step(`purged ${c.orphan.length} orphan ${c.source_type} source(s)`);
  }
  return deleted;
}

function pct(n: number, d: number): string {
  return d === 0 ? "  n/a" : `${((100 * n) / d).toFixed(1)}%`;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const strict = argv.includes("--strict");
  const purge = argv.includes("--purge-orphans");
  const showIdx = argv.indexOf("--show");
  const show = showIdx >= 0 ? Math.max(0, Number(argv[showIdx + 1]) || 0) : 5;

  report.section("ingest:embed:verify  (embedding coverage)");
  let coverage = await computeEmbedCoverage();

  console.log(
    `  ${"source_type".padEnd(16)} ${"eligible".padStart(9)} ${"embedded".padStart(9)} ${"missing".padStart(8)} ${"orphan".padStart(7)}  coverage`,
  );
  console.log("  " + "-".repeat(66));
  for (const c of coverage) {
    console.log(
      `  ${c.source_type.padEnd(16)} ${String(c.eligible).padStart(9)} ${String(c.embedded).padStart(9)} ` +
        `${String(c.missing.length).padStart(8)} ${String(c.orphan.length).padStart(7)}  ${pct(c.eligible - c.missing.length, c.eligible)}`,
    );
    if (c.missing.length > 0) {
      console.log(`      → fix: ${REMEDY[c.source_type]}`);
      if (show > 0) console.log(`      missing e.g.: ${c.missing.slice(0, show).join(", ")}${c.missing.length > show ? " …" : ""}`);
    }
    if (show > 0 && c.orphan.length > 0) {
      console.log(`      orphan  e.g.: ${c.orphan.slice(0, show).join(", ")}${c.orphan.length > show ? " …" : ""}`);
    }
  }
  console.log();

  const totalOrphans = coverage.reduce((n, c) => n + c.orphan.length, 0);
  if (purge && totalOrphans > 0) {
    report.section("Purging orphan embeddings");
    const deleted = await purgeOrphans(coverage);
    report.ok(`deleted ${deleted} orphan embedding source(s); re-checking coverage…`);
    coverage = await computeEmbedCoverage();
  } else if (totalOrphans > 0 && !purge) {
    report.warn(`${totalOrphans} orphan embedding source(s) — pass --purge-orphans to remove them.`);
  }

  // A gap in an ingest:embed-managed type (syllabus/question) is what this script
  // gates on; note/CA gaps are surfaced but fixed by their own pipelines.
  const managedGap = hasCoverageGap(coverage, INGEST_EMBED_TYPES);
  const otherGap = hasCoverageGap(coverage) && !managedGap;
  if (managedGap) {
    report.warn("coverage gap in syllabus/question — run `pnpm ingest:embed` (or `--missing-only` to just close the gap).");
  } else if (otherGap) {
    report.warn("no syllabus/question gap; note/CA has a gap — see per-type `→ fix` above.");
  } else {
    report.ok("full coverage: every eligible source is embedded.");
  }
  if (strict && managedGap) process.exit(1);
}

main().catch((err) => {
  console.error("\ningest:embed:verify failed:", err instanceof Error ? err.stack : err);
  process.exit(1);
});
