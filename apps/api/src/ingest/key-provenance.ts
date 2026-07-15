/**
 * Key-provenance publish-gate logic — the ONE place that decides, from a PYQ
 * question's answer-key provenance + verification + blind-resolve verdict, whether
 * it may auto-publish. Used by both ingest:pyq:load (new loads) and ingest:regate
 * (recomputing already-loaded rows) so the two never drift.
 *
 * See migration 0074 for the schema + backfill. The provenance map here is the
 * SOURCE OF TRUTH for future loads; the migration backfilled existing rows to
 * match it, so any new (paper, year) whose key is sourced must be added HERE.
 */

export type KeyProvenance = "official_commission" | "coaching_reproduced" | "none";

/**
 * (paper_code, year) → key provenance, from the documented, evidence-based key
 * sourcing (CLAUDE.md Session 27.5 + the official answer-key PDFs actually present
 * in content-raw/answer_key/). Provenance describes where the KEY came from — it is
 * orthogonal to whether a verified key was successfully applied (answer_key_verified).
 *
 * official_commission — an official commission answer-key PDF was downloaded for
 *   this (paper, year) and used as the key source.
 * coaching_reproduced — the key came from a theexampillar single-series keymap.
 * Anything not listed is 'none' (no key sourced; Mains descriptive has no key).
 *
 * CSAT 2019/2020/2021/2023 upgraded from coaching_reproduced (2026-07-15, "CSAT
 * key sourcing" session — matched-set / series-verified strategy, same method as
 * the 2021 GS-I booklet-series fix): each year's official multi-series "Key Sheet
 * of General Studies Paper-II (GS-24)" / "Answer Key for Inviting Objections" PDF
 * was located (dhyeyaias.com combined-series mirrors for 2019/2020, theexampillar's
 * per-series Google Drive mirror of the same official document for 2021, dhyeyaias
 * for 2023), the correct booklet series picked via blind-resolve agreement (2019
 * Series A 82%→93% post-escalation, 2020 Series A 79%→97%, 2021 Series C 63%→96%,
 * all far above the ~20-30% chance level of the other 3 series each year — 2023's
 * official Series C matched the ALREADY-applied coaching key answer-for-answer,
 * 100/100, confirming it had been correct all along), then a fresh blind-resolve +
 * escalation run against the corrected key. CSAT 2022 stays coaching_reproduced —
 * no official key for that year is retrievable from any source this app trusts
 * (confirmed: absent from dhyeyaias's and drishtiias's per-year listings, absent
 * from uppsc.up.nic.in's current archive, only a session/objection-window-only
 * page ever existed for it). See docs/OUTSTANDING.md A4-followups.
 */
const OFFICIAL_COMMISSION: Record<string, number[]> = {
  PRE_GS1: [2019, 2020, 2021, 2023, 2024],
  PRE_CSAT: [2019, 2020, 2021, 2023, 2024],
};
const COACHING_REPRODUCED: Record<string, number[]> = {
  PRE_GS1: [2018, 2025],
  PRE_CSAT: [2022],
};

export function keyProvenanceFor(paperCode: string, year: number | null): KeyProvenance {
  if (year == null) return "none";
  if (OFFICIAL_COMMISSION[paperCode]?.includes(year)) return "official_commission";
  if (COACHING_REPRODUCED[paperCode]?.includes(year)) return "coaching_reproduced";
  return "none";
}

// ---------------------------------------------------------------------------
// The gate itself (pure — no I/O), for MCQ (prelims) questions.
// ---------------------------------------------------------------------------
export type ReviewState = "draft" | "needs_review" | "approved" | "rejected";

/** Minimal blind-resolve verdict status persisted in meta.blind_resolve.status. */
export type BlindStatus = "ok" | "flagged" | "error" | "no_key" | undefined;

export interface McqGateInput {
  provenance: KeyProvenance;
  /** meta.answer_key_verified === true — a real key was applied AND verified. */
  keyVerified: boolean;
  /** meta.blind_resolve?.status */
  blindStatus: BlindStatus;
  /** Mirror of the DB publish gate (bilingual stem + options + key match). */
  publishable: boolean;
  /** source_kind === 'compilation' → Tier-B, keep a human eye even when it passes. */
  compilation: boolean;
}

export interface McqGateResult {
  reviewState: ReviewState;
  isPublished: boolean;
  /**
   * True when this question is published on the strength of an OFFICIAL key but the
   * independent blind re-solve DISAGREED with that key. The publish is NOT blocked
   * (an official key is ground truth), but a system flag is raised for a human to
   * investigate — the 2021 GS-I "official key is genuinely wrong" case (item 3).
   */
  keyDispute: boolean;
}

/**
 * The provenance-driven MCQ publish gate.
 *
 *  (A) official_commission + a verified key  → publish on key + bilingual ALONE,
 *      WITHOUT requiring blind-resolve agreement. An official commission key IS the
 *      ground truth; requiring an unreliable independent solve (esp. on CSAT) to
 *      corroborate it was the bug this fixes. Blind still runs as a NON-BLOCKING
 *      safety net: a 'flagged' disagreement sets keyDispute (→ Review Queue) but
 *      never holds the publish.
 *
 *  (B) everything else — coaching_reproduced, OR official-source WITHOUT a verified
 *      key (e.g. a stripped misaligned key), OR none — keeps the blind-resolve-
 *      required gate UNCHANGED: a less-trustworthy key must be corroborated by the
 *      independent solve (verified key AND blind 'ok'); a 'flagged'/'error' solve
 *      or an unverified/absent key holds it in the Review Queue.
 *
 * This is applied uniformly by provenance, not CSAT-special-cased.
 */
export function gateMcq(i: McqGateInput): McqGateResult {
  if (!i.publishable) return { reviewState: "draft", isPublished: false, keyDispute: false };

  // (A) Official-commission verified key → authoritative.
  if (i.provenance === "official_commission" && i.keyVerified) {
    return { reviewState: "approved", isPublished: true, keyDispute: i.blindStatus === "flagged" };
  }

  // (B) Blind-resolve-required gate (coaching / unverified-official / none).
  if (i.blindStatus === "flagged" || i.blindStatus === "error") {
    return { reviewState: "needs_review", isPublished: false, keyDispute: false };
  }
  if (!i.keyVerified || i.blindStatus !== "ok") {
    return { reviewState: "needs_review", isPublished: false, keyDispute: false };
  }
  return i.compilation
    ? { reviewState: "needs_review", isPublished: true, keyDispute: false }
    : { reviewState: "approved", isPublished: true, keyDispute: false };
}
