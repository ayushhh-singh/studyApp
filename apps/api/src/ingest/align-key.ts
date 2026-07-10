/**
 * ingest:align-key — align an official answer key to an extracted paper by
 * QUESTION CONTENT, not by question number, so a Set-A key applied to a
 * differently-ordered (Set-B / reconstructed) paper still maps each answer to
 * the RIGHT question. This is the guard against the booklet-series trap.
 *
 *   pnpm ingest:align-key --raw <extract.json> --key <key.json> --out <aligned.json>
 *
 * extract.json : [{ q_no, stem_en, ... }]                (our extracted paper)
 * key.json     : [{ q_no, question_en, answer }]         (official key as a marked question paper)
 * aligned.json : { "<our_q_no>": "A", ... }              (answer keyed to OUR q_no; feeds ingest:assemble --keyjson)
 *
 * Method: normalized token-Jaccard between each of our stems and every key
 * question; best match above a similarity floor wins. Reports the match rate,
 * average similarity, whether the mapping is position-preserving (same series)
 * or shuffled (different series — content-match still resolves it), and any of
 * our questions that found no confident key match (left unkeyed → blind-resolve).
 * A LOW match rate means the key is for a different paper/exam and must not be
 * trusted — the caller should then skip the key entirely.
 */
import { readFile, writeFile } from "node:fs/promises";
import { parseArgs, report } from "./_shared.js";

interface RawQ { q_no: number; stem_en?: string }
interface KeyQ { q_no: number; question_en?: string; answer?: string }

const STOP = new Set([
  "the", "a", "an", "of", "in", "on", "to", "and", "or", "is", "are", "which", "following",
  "statements", "statement", "consider", "correct", "incorrect", "given", "below", "with",
  "reference", "for", "by", "as", "from", "that", "this", "these", "was", "were", "has", "have",
]);

/** Normalize a stem to a bag of significant word tokens. */
function tokens(s: string): Set<string> {
  return new Set(
    (s || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w)),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

const SIM_FLOOR = 0.35; // below this, treat as "no confident match"

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const rawPath = typeof args.raw === "string" ? args.raw : null;
  const keyPath = typeof args.key === "string" ? args.key : null;
  const outPath = typeof args.out === "string" ? args.out : null;
  if (!rawPath || !keyPath || !outPath) throw new Error("Provide --raw, --key, and --out.");

  const raw = JSON.parse(await readFile(rawPath, "utf8")) as RawQ[];
  const key = JSON.parse(await readFile(keyPath, "utf8")) as KeyQ[];
  report.section(`ingest:align-key  (${raw.length} paper Qs × ${key.length} key entries)`);

  const keyTok = key.map((k) => ({ ...k, tok: tokens(k.question_en ?? "") }));
  const aligned: Record<string, string> = {};
  let matched = 0;
  let simSum = 0;
  let positionPreserved = 0;
  const unmatched: number[] = [];
  const lowSim: number[] = [];

  for (const q of raw) {
    const qt = tokens(q.stem_en ?? "");
    let best: { k: KeyQ; sim: number } | null = null;
    for (const k of keyTok) {
      const sim = jaccard(qt, k.tok);
      if (!best || sim > best.sim) best = { k, sim };
    }
    if (best && best.sim >= SIM_FLOOR && best.k.answer) {
      const ans = best.k.answer.trim().toUpperCase();
      if (["A", "B", "C", "D"].includes(ans)) {
        aligned[String(q.q_no)] = ans;
        matched++;
        simSum += best.sim;
        if (best.k.q_no === q.q_no) positionPreserved++;
        if (best.sim < 0.55) lowSim.push(q.q_no);
        continue;
      }
    }
    unmatched.push(q.q_no);
  }

  await writeFile(outPath, JSON.stringify(aligned, null, 1));

  const matchRate = raw.length ? (100 * matched) / raw.length : 0;
  const posRate = matched ? (100 * positionPreserved) / matched : 0;
  report.ok(`content-matched ${matched}/${raw.length} (${matchRate.toFixed(1)}%) → ${outPath.replace(/^.*scratchpad/, "scratchpad")}`);
  console.log(`  avg similarity (matched)  ${matched ? (simSum / matched).toFixed(2) : "n/a"}`);
  console.log(`  position-preserved        ${posRate.toFixed(0)}%  ${posRate > 90 ? "(same series / ordering)" : "(SHUFFLED — content-match resolved it)"}`);
  if (lowSim.length) report.warn(`weak matches (verify) q_no: ${lowSim.slice(0, 30).join(", ")}${lowSim.length > 30 ? " …" : ""}`);
  if (unmatched.length) report.warn(`no confident key match (→ blind-resolve) q_no: ${unmatched.slice(0, 40).join(", ")}${unmatched.length > 40 ? " …" : ""}`);
  report.section("Trust verdict");
  if (matchRate >= 90) report.ok(`match rate ${matchRate.toFixed(0)}% — key aligns to this paper; trust it (assemble --keyjson ${outPath.split("/").pop()})`);
  else if (matchRate >= 60) report.warn(`match rate ${matchRate.toFixed(0)}% — PARTIAL; use aligned answers but expect more Review-Queue items`);
  else report.warn(`match rate ${matchRate.toFixed(0)}% — key does NOT align (wrong paper/series/exam). DO NOT use this key; blind-resolve only.`);
}

main().catch((err) => {
  console.error("\ningest:align-key failed:", err instanceof Error ? err.stack : err);
  process.exit(1);
});
