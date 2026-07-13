/**
 * ingest:regate — recompute the PYQ publish gate over ALREADY-LOADED questions,
 * WITHOUT re-ingesting. This is the tool for a gate-LOGIC change (e.g. the
 * key-provenance fix, migration 0074) applied to data already in the bank.
 *
 *   pnpm ingest:regate                       (dry-run, both prelims MCQ papers)
 *   pnpm ingest:regate --paper PRE_CSAT       (dry-run, one paper)
 *   pnpm ingest:regate --apply                (write the recomputed gate + flags)
 *
 * For every prelims MCQ it recomputes {review_state, is_published, keyDispute} from
 * the SAME gate as ingest:pyq:load (gateMcq, keyed on key_provenance + verification
 * + blind-resolve verdict), compares to the current DB state, prints a per-(paper,
 * year) before/after and a transition matrix, and (with --apply) writes the changes
 * and raises the official-key-dispute safety-net flags. A row a HUMAN has rejected
 * (or explicitly acted on) is left untouched.
 */
import { supabase } from "../lib/supabase.js";
import { parseArgs, report } from "./_shared.js";
import { gateMcq, type BlindStatus, type KeyProvenance, type ReviewState } from "./key-provenance.js";
import { raiseKeyDisputeFlag } from "./key-dispute-flag.js";

interface QRow {
  id: string;
  paper_code: string;
  year: number | null;
  key_provenance: KeyProvenance;
  publish_gate_ok: boolean;
  is_published: boolean;
  review_state: ReviewState;
  source_kind: string | null;
  correct_option_key: string | null;
  meta: {
    answer_key_verified?: boolean;
    blind_resolve?: { status?: string; stored_key?: string; chosen_key?: string; confidence?: number };
    key_corrected?: unknown;
    audit_flag?: { kind?: string };
  } | null;
}

const PAPERS = ["PRE_CSAT", "PRE_GS1"];

async function fetchRows(paper: string): Promise<QRow[]> {
  const rows: QRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase()
      .from("questions")
      .select(
        "id, paper_code, year, key_provenance, publish_gate_ok, is_published, review_state, source_kind, correct_option_key, meta",
      )
      .eq("paper_code", paper)
      .eq("type", "mcq")
      .range(from, from + 999);
    if (error) throw new Error(`fetch ${paper}: ${error.message}`);
    rows.push(...((data ?? []) as unknown as QRow[]));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

/** A human decision we must never auto-overwrite on a re-gate. */
function humanLocked(r: QRow): boolean {
  return (
    r.review_state === "rejected" ||
    !!r.meta?.key_corrected ||
    r.meta?.audit_flag?.kind === "admin_unpublish"
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const apply = !!args.apply;
  // --publish-only: apply only the NON-destructive effects — publish questions the
  // new gate now clears (held→published), benign review-state changes that keep a
  // row published, and the official-key dispute flags. Never un-publish a currently-
  // live question. Use when a strict re-gate's tightening (published→held) is out of
  // scope or would collide with a separately-tracked issue (e.g. the 2021 GS-I key).
  const publishOnly = !!args["publish-only"];
  const papers = typeof args.paper === "string" ? [args.paper] : PAPERS;
  report.section(
    `ingest:regate — recompute publish gate over loaded prelims MCQ ${apply ? "(APPLY" : "(dry-run"}${publishOnly ? ", publish-only)" : ")"}`,
  );

  let grandBeforePub = 0;
  let grandAfterPub = 0;
  let grandChanged = 0;
  let grandFlags = 0;

  for (const paper of papers) {
    const rows = await fetchRows(paper);
    report.section(`${paper}: ${rows.length} MCQ`);

    // Per-year before/after published counts + transition tallies.
    const years = new Map<string, { beforePub: number; afterPub: number }>();
    let toPublish = 0; // held → published
    let toHold = 0; // published → held
    let stateOnly = 0; // review_state change, publish unchanged
    let flags = 0; // official-key disputes to flag
    let humanSkipped = 0;
    let skipped = 0; // transitions skipped by --publish-only (would reduce visibility)
    const updates: { id: string; is_published: boolean; review_state: ReviewState }[] = [];
    const appliedBreakdown = new Map<string, number>();
    const flagTargets: QRow[] = [];

    for (const r of rows) {
      const y = String(r.year ?? "null");
      const bucket = years.get(y) ?? { beforePub: 0, afterPub: 0 };
      if (r.is_published) bucket.beforePub++;

      const res = gateMcq({
        provenance: r.key_provenance,
        keyVerified: r.meta?.answer_key_verified === true,
        blindStatus: r.meta?.blind_resolve?.status as BlindStatus,
        publishable: r.publish_gate_ok,
        compilation: r.source_kind === "compilation",
      });

      // A human-locked row keeps its current state (no auto-overwrite).
      const locked = humanLocked(r);
      const target = locked
        ? { isPublished: r.is_published, reviewState: r.review_state, keyDispute: false }
        : res;
      if (locked && (res.isPublished !== r.is_published || res.reviewState !== r.review_state)) humanSkipped++;

      const wouldUnpublish = !target.isPublished && r.is_published;
      // Visibility = is_published AND review_state='approved' (RLS 0053). A flip
      // approved→needs_review with is_published staying true still HIDES the row.
      const currentVisible = r.is_published && r.review_state === "approved";
      const targetVisible = target.isPublished && target.reviewState === "approved";
      const gainsVisibility = targetVisible && !currentVisible; // held/hidden → visible

      // publish-only mode: apply ONLY genuine visibility GAINS (held→published),
      // nothing else — no un-publishes, no demotions, and no benign relabels among
      // already-invisible rows. Full mode applies every gate change.
      const applied =
        !publishOnly || gainsVisibility
          ? { isPublished: target.isPublished, reviewState: target.reviewState }
          : { isPublished: r.is_published, reviewState: r.review_state };

      if (applied.isPublished) bucket.afterPub++;
      years.set(y, bucket);

      // Transition tallies describe the FULL gate outcome (what a strict re-gate
      // would do), independent of publish-only skipping.
      const fullChanged = target.isPublished !== r.is_published || target.reviewState !== r.review_state;
      if (fullChanged) {
        if (target.isPublished && !r.is_published) toPublish++;
        else if (wouldUnpublish) toHold++;
        else stateOnly++;
        if (publishOnly && !gainsVisibility) skipped++;
      }

      const appliedChanged = applied.isPublished !== r.is_published || applied.reviewState !== r.review_state;
      if (appliedChanged) {
        updates.push({ id: r.id, is_published: applied.isPublished, review_state: applied.reviewState });
        const key = `${r.review_state}${r.is_published ? "+pub" : ""} → ${applied.reviewState}${applied.isPublished ? "+pub" : ""}`;
        appliedBreakdown.set(key, (appliedBreakdown.get(key) ?? 0) + 1);
      }
      if (target.keyDispute) {
        flags++;
        flagTargets.push(r);
      }
    }

    // Report per-year before/after.
    let beforePub = 0;
    let afterPub = 0;
    for (const y of [...years.keys()].sort()) {
      const b = years.get(y)!;
      beforePub += b.beforePub;
      afterPub += b.afterPub;
      const delta = b.afterPub - b.beforePub;
      report.step(`  ${y}: published ${b.beforePub} → ${b.afterPub}  ${delta === 0 ? "(unchanged)" : delta > 0 ? `(+${delta})` : `(${delta})`}`);
    }
    report.ok(`${paper} published${publishOnly ? " (publish-only, effective)" : ""}: ${beforePub} → ${afterPub}  (Δ ${afterPub - beforePub})`);
    report.ok(`full-gate transitions: held→published ${toPublish}, published→held ${toHold}, review-state-only ${stateOnly}`);
    if (publishOnly) report.ok(`publish-only: applying ${updates.length} visibility gains, SKIPPING ${skipped} other gate changes (left live/untouched)`);
    for (const [k, n] of [...appliedBreakdown.entries()].sort()) report.step(`    apply: ${k}  ×${n}`);
    report.ok(`official-key dispute flags: ${flags}${humanSkipped ? `, human-locked skipped: ${humanSkipped}` : ""}`);

    grandBeforePub += beforePub;
    grandAfterPub += afterPub;
    grandChanged += updates.length;
    grandFlags += flags;

    if (apply) {
      report.step(`applying ${updates.length} gate changes + ${flags} flags…`);
      let done = 0;
      for (const u of updates) {
        const { error } = await supabase()
          .from("questions")
          .update({ is_published: u.is_published, review_state: u.review_state })
          .eq("id", u.id);
        if (error) report.warn(`update ${u.id}: ${error.message}`);
        else done++;
      }
      let flagged = 0;
      for (const r of flagTargets) {
        const br = r.meta?.blind_resolve;
        try {
          await raiseKeyDisputeFlag(supabase(), r.id, {
            official_key: br?.stored_key ?? r.correct_option_key,
            blind_key: br?.chosen_key ?? null,
            confidence: br?.confidence ?? null,
          });
          flagged++;
        } catch (e) {
          report.warn(`flag ${r.id}: ${e instanceof Error ? e.message : e}`);
        }
      }
      report.ok(`${paper}: applied ${done}/${updates.length} changes, raised ${flagged}/${flags} flags`);
    }
  }

  report.section("Summary");
  report.ok(`published (all selected papers): ${grandBeforePub} → ${grandAfterPub}  (Δ ${grandAfterPub - grandBeforePub})`);
  report.ok(`rows whose gate outcome changed: ${grandChanged}`);
  report.ok(`official-key dispute flags: ${grandFlags}`);
  if (!apply) report.warn("DRY-RUN — nothing written. Re-run with --apply to persist.");
}

main().catch((err) => {
  console.error("\ningest:regate failed:", err instanceof Error ? err.stack : err);
  process.exit(1);
});
