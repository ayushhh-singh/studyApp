/**
 * `pnpm ca:flag-mcqs [--apply]`
 *
 * Retroactive cleanup for the CA-MCQ exam-worthiness gap (the "How many students
 * reside in the hostels of KGMU?" class of question). ca:run now applies an
 * exam-relevance filter at generation time (ca/prompts.ts's generateMcqs) and a
 * higher bar on `misc`-kind fact extraction (enrichItem) — but LIVE CA MCQs
 * generated BEFORE that filter existed are already published+approved.
 *
 * This surfaces the clearest low-quality candidates for a HUMAN second look
 * WITHOUT changing anything a user sees. It leaves the row fully LIVE — status
 * approved, is_published=true — and only stamps generation_meta.re_review. The
 * Review Queue's Current Affairs tab then ALSO surfaces re_review-flagged live
 * rows (see services/review.ts's applyTab), showing a "Live — re-review" marker,
 * where a reviewer either keeps it (Approve clears the flag — services/review.ts
 * approveQuestion) or removes it (Reject → unpublished). Both are the human's
 * call, never this script's.
 *
 * IMPORTANT — why NOT flip review_state to needs_review: an approved CA MCQ
 * carries exam_code='uppsc' and a real syllabus_node_id, and the catalog
 * visibility scope (lib/question-visibility.ts) has no paper_code exclusion, so
 * it is genuinely user-visible in the Learn node PYQ browse and general question
 * search (empirically confirmed: ~18 CA MCQs in one node's 65-row browse).
 * Flipping it to needs_review would remove it from those catalog surfaces — a
 * silent partial-unpublish, exactly what the brief says NOT to do. Keeping it
 * approved leaves it live everywhere it already is; the flag is metadata only.
 *
 * CANDIDATE CRITERION (the "start with the clearest signal" bar from the brief):
 * a live CA MCQ whose SOURCE current-affairs item has NO anchored prelims fact —
 * every prelims_fact is kind='misc' (or the item has no prelims_facts at all).
 * That is exactly the shape of the KGMU example: an incidental headcount boxed
 * as a `misc` fact with no scheme/report/appointment/place/org anchor. An MCQ
 * can't be mapped back to the specific fact it used, so this flags at the item
 * level and stays conservative — an item with even ONE anchored fact is left
 * alone (its MCQ is plausibly about that anchor). It also skips a row already
 * flagged, so re-running is idempotent.
 *
 * A question has no back-reference to its owning current_affairs_items row; only
 * the item's `mcq_question_ids` array points forward — so this inverts that map
 * first, exactly like ca:distribute-mcqs.
 *
 * Dry-run unless --apply.
 */
import type { GenerationMeta } from "@neev/shared";
import { supabase } from "../src/lib/supabase.js";
import { selectAll } from "../src/lib/paginate.js";
import { CURRENT_AFFAIRS_PAPER_CODE } from "../src/lib/question-visibility.js";

const APPLY = process.argv.includes("--apply");

interface CaItemRow {
  id: string;
  mcq_question_ids: string[] | null;
  prelims_facts: { kind?: string }[] | null;
}

interface LiveMcqRow {
  id: string;
  generation_meta: GenerationMeta | null;
}

/** An item is a candidate when it has NO fact anchored on a non-`misc` kind. */
function hasNoAnchoredFact(facts: CaItemRow["prelims_facts"]): boolean {
  if (!facts || facts.length === 0) return true;
  return facts.every((f) => !f.kind || f.kind === "misc");
}

async function main(): Promise<void> {
  const flaggedAt = new Date().toISOString();

  // Every CA item that produced at least one MCQ, with the fact kinds it was
  // built from.
  const items = await selectAll<CaItemRow>(() =>
    supabase()
      .from("current_affairs_items")
      .select("id, mcq_question_ids, prelims_facts")
      .not("mcq_question_ids", "eq", "{}")
      .order("id", { ascending: true }),
  );

  // question_id -> owning item, only for items with no anchored fact.
  const itemByQuestion = new Map<string, CaItemRow>();
  let candidateItems = 0;
  let anyMiscItems = 0; // wider surface, logged for context only (NOT flagged)
  for (const item of items) {
    const facts = item.prelims_facts ?? [];
    if (facts.some((f) => f.kind === "misc")) anyMiscItems++;
    if (!hasNoAnchoredFact(item.prelims_facts)) continue;
    candidateItems++;
    for (const qId of item.mcq_question_ids ?? []) itemByQuestion.set(qId, item);
  }

  console.log(
    `CA items with MCQs: ${items.length}; ` +
      `no-anchored-fact (candidates): ${candidateItems}; ` +
      `(for context — items with ANY misc fact, NOT flagged: ${anyMiscItems})`,
  );

  if (itemByQuestion.size === 0) {
    console.log("No candidate items — nothing to flag.");
    process.exit(0);
  }

  // Of those items' MCQs, act on the ones that are actually LIVE
  // (is_published=true). Desired end state for each = approved + re_review
  // stamped. A row already in that exact state is skipped (idempotent); a row
  // that a prior (buggy) run flipped to needs_review is self-healed back to
  // approved here, since keeping it approved is what keeps it live on the
  // catalog surfaces (see the header note).
  const candidateQuestionIds = [...itemByQuestion.keys()];
  const toFlag: { id: string; meta: GenerationMeta | null; itemId: string; wasNeedsReview: boolean }[] = [];
  let alreadyDone = 0;
  let notLive = 0;
  let seen = 0;
  for (let i = 0; i < candidateQuestionIds.length; i += 300) {
    const batch = candidateQuestionIds.slice(i, i + 300);
    const { data, error } = await supabase()
      .from("questions")
      .select("id, generation_meta, review_state")
      .in("id", batch)
      .eq("paper_code", CURRENT_AFFAIRS_PAPER_CODE)
      .eq("type", "mcq")
      .eq("is_published", true)
      // Approved (the normal live state) OR needs_review (self-heal a prior
      // wrongful flip that also carries the flag). Never touch a rejected row.
      .in("review_state", ["approved", "needs_review"]);
    if (error) throw new Error(`live MCQ lookup failed: ${error.message}`);
    for (const row of (data ?? []) as (LiveMcqRow & { review_state: string })[]) {
      seen++;
      const flagged = !!row.generation_meta?.re_review;
      if (flagged && row.review_state === "approved") {
        alreadyDone++;
        continue; // already in the desired end state
      }
      toFlag.push({
        id: row.id,
        meta: row.generation_meta,
        itemId: itemByQuestion.get(row.id)!.id,
        wasNeedsReview: row.review_state === "needs_review",
      });
    }
  }
  notLive = candidateQuestionIds.length - seen;
  const toHeal = toFlag.filter((q) => q.wasNeedsReview).length;

  console.log(
    `Live MCQs to flag/keep-live: ${toFlag.length} (of which self-heal a prior needs_review flip: ${toHeal}); ` +
      `already flagged+approved (skipped): ${alreadyDone}; ` +
      `not live / not found (draft, rejected, or non-MCQ): ${notLive}`,
  );
  if (toFlag.length === 0) {
    console.log("Nothing to do.");
    process.exit(0);
  }
  if (!APPLY) {
    console.log("DRY-RUN — re-run with --apply to stamp re_review (kept approved + live) for a Review Queue second pass.");
    process.exit(0);
  }

  const reason =
    "Source current-affairs item had no anchored prelims fact (all 'misc'/incidental) — " +
    "confirm this MCQ tests an examinable fact, not story colour.";
  let done = 0;
  for (const q of toFlag) {
    const nextMeta: GenerationMeta = {
      ...(q.meta ?? {}),
      re_review: { reason, flagged_at: flaggedAt, source_item_id: q.itemId },
    };
    // Kept approved + published on purpose — the row stays live on every surface
    // it's already on (catalog browse, search, weekly quiz). review_state is set
    // to 'approved' to self-heal any prior wrongful flip; generation_meta.re_review
    // is the ONLY thing that marks it for a second pass, and the Review Queue's CA
    // tab surfaces it via that flag (services/review.ts).
    const { error } = await supabase()
      .from("questions")
      .update({ review_state: "approved", generation_meta: nextMeta })
      .eq("id", q.id);
    if (error) throw new Error(`flag update failed for ${q.id}: ${error.message}`);
    done++;
  }
  console.log(
    `APPLIED: flagged ${done} live CA MCQs for re-review (kept approved + published; surfaced in the Review Queue via the re_review marker).`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : e);
  process.exit(1);
});
