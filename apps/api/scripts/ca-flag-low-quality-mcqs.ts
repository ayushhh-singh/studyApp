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
 * WITHOUT unpublishing anything: it flips a flagged live MCQ from approved back
 * to needs_review (keeping is_published=true, so its only serving surface — the
 * weekly CA quiz, which reads CA questions by paper_code regardless of
 * review_state, see lib/question-visibility.ts's "test" scope — stays live) and
 * stamps generation_meta.re_review. That drops it into the Review Queue's
 * Current Affairs tab with a "Live — re-review" marker, where a reviewer either
 * re-approves it (back to approved, nothing changed for the user) or rejects it
 * (unpublished — the human's call, never this script's).
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

  // Of those items' MCQs, keep only the ones that are actually LIVE
  // (published + approved) — a still-needs_review one is already in the queue,
  // and an already-flagged one (re_review present) is skipped for idempotency.
  const candidateQuestionIds = [...itemByQuestion.keys()];
  const liveToFlag: { id: string; meta: GenerationMeta | null; itemId: string }[] = [];
  let alreadyFlagged = 0;
  let notLive = 0;
  for (let i = 0; i < candidateQuestionIds.length; i += 300) {
    const batch = candidateQuestionIds.slice(i, i + 300);
    const { data, error } = await supabase()
      .from("questions")
      .select("id, generation_meta")
      .in("id", batch)
      .eq("paper_code", CURRENT_AFFAIRS_PAPER_CODE)
      .eq("type", "mcq")
      .eq("is_published", true)
      .eq("review_state", "approved");
    if (error) throw new Error(`live MCQ lookup failed: ${error.message}`);
    for (const row of (data ?? []) as LiveMcqRow[]) {
      if (row.generation_meta?.re_review) {
        alreadyFlagged++;
        continue;
      }
      liveToFlag.push({ id: row.id, meta: row.generation_meta, itemId: itemByQuestion.get(row.id)!.id });
    }
  }
  notLive = candidateQuestionIds.length - liveToFlag.length - alreadyFlagged;

  console.log(
    `Live approved MCQs to flag: ${liveToFlag.length}; ` +
      `already flagged (skipped): ${alreadyFlagged}; ` +
      `not live / not found (draft, needs_review, rejected, or non-MCQ): ${notLive}`,
  );
  if (liveToFlag.length === 0) {
    console.log("Nothing to flag.");
    process.exit(0);
  }
  if (!APPLY) {
    console.log("DRY-RUN — re-run with --apply to flip these to needs_review (kept published) for re-review.");
    process.exit(0);
  }

  const reason =
    "Source current-affairs item had no anchored prelims fact (all 'misc'/incidental) — " +
    "confirm this MCQ tests an examinable fact, not story colour.";
  let flagged = 0;
  for (const q of liveToFlag) {
    const nextMeta: GenerationMeta = {
      ...(q.meta ?? {}),
      re_review: { reason, flagged_at: flaggedAt, source_item_id: q.itemId },
    };
    // Kept published on purpose — review_state=needs_review is what surfaces it
    // in the queue; is_published stays true so the content is NOT taken down.
    const { error } = await supabase()
      .from("questions")
      .update({ review_state: "needs_review", generation_meta: nextMeta })
      .eq("id", q.id);
    if (error) throw new Error(`flag update failed for ${q.id}: ${error.message}`);
    flagged++;
  }
  console.log(`APPLIED: flagged ${flagged} live CA MCQs for re-review (still published; now in the Review Queue).`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : e);
  process.exit(1);
});
