/**
 * Consistency sweep — catches "explanation right, key wrong" (and structural
 * corruption) WITHOUT re-solving the question. Two sub-checks per published MCQ:
 *
 *  1. Structural / permutation integrity (code only, no LLM): 2-4 uniquely-keyed
 *     options, both languages present per option, correct_option_key valid, and —
 *     for the dominant UPPSC "1 and 2 only" statement/pair format — the digit set
 *     in each option's Hindi and English text must match (a translation must
 *     never drop/add/reorder a statement number).
 *  2. Explanation-vs-key (claude-haiku-4-5, Batch API): the model reads ONLY the
 *     explanation (and the option list, to map the conclusion to a key) and
 *     reports which option the explanation ARGUES for — it is told NOT to solve
 *     the question itself. If that disagrees with correct_option_key, the row is
 *     internally inconsistent → flagged.
 *
 * Note this deliberately does NOT judge factual correctness (the Somnath case —
 * a wrong key whose wrong explanation agrees with it — passes here; the re-solve
 * audit is what catches that). This check is cheap, runs on the full bank, and
 * catches the specific "the two halves of the row disagree" failure.
 */
import type { Anthropic } from "@anthropic-ai/sdk";
import { MODELS } from "../lib/models.js";
import { structuredParams } from "../lib/anthropic.js";
import type { AuditQuestion } from "./shared.js";

// ---------------------------------------------------------------------------
// 1. Structural / permutation check (no LLM)
// ---------------------------------------------------------------------------
export interface StructuralResult {
  permutation_ok: boolean;
  number_set_ok: boolean;
  issues: string[];
}

const DEVANAGARI_DIGITS = "०१२३४५६७८९";

/** Sorted-unique arabic digits in a string (Devanagari numerals normalized to arabic). */
function digitSet(s: string): string {
  const norm = s.replace(/[०-९]/g, (d) => String(DEVANAGARI_DIGITS.indexOf(d)));
  const digits = new Set((norm.match(/\d/g) ?? []));
  return [...digits].sort().join("");
}

export function structuralCheck(q: AuditQuestion): StructuralResult {
  const issues: string[] = [];
  const opts = q.options_i18n ?? [];
  if (opts.length < 2 || opts.length > 4) issues.push(`option_count=${opts.length}`);
  const keys = opts.map((o) => o.key);
  if (new Set(keys).size !== keys.length) issues.push("duplicate_keys");
  for (const o of opts) {
    if (!o.text_i18n?.en?.trim()) issues.push(`missing_en:${o.key}`);
    if (!o.text_i18n?.hi?.trim()) issues.push(`missing_hi:${o.key}`);
  }
  if (!q.correct_option_key || !keys.includes(q.correct_option_key)) issues.push("bad_correct_key");

  // Statement/pair format: the digit set must be identical across languages.
  let numberSetOk = true;
  for (const o of opts) {
    const en = digitSet(o.text_i18n?.en ?? "");
    const hi = digitSet(o.text_i18n?.hi ?? "");
    if (en.length > 0 && hi.length > 0 && en !== hi) {
      numberSetOk = false;
      issues.push(`number_mismatch:${o.key}(${en}|${hi})`);
    }
  }

  const permutationOk = issues.filter((i) => !i.startsWith("number_mismatch")).length === 0;
  return { permutation_ok: permutationOk, number_set_ok: numberSetOk, issues };
}

// ---------------------------------------------------------------------------
// 2. Explanation-vs-key (haiku, batched)
// ---------------------------------------------------------------------------
// NO PROMPT CACHING HERE — INVESTIGATED, DO NOT "FIX" (2026-07-23). A prior
// cost-audit commit (9e03929) claimed audit/resolve.ts already had caching
// that this file lacked, as if to copy from. That claim was checked and is
// FALSE — neither audit/resolve.ts nor ingest/resolve.ts has any
// cache_control/PromptSegment usage; there is no sibling pattern here at all.
// Building the split fresh (per the Session 13 evaluation/prompts.ts
// static/dynamic pattern) was then evaluated and rejected on its own merits:
// ARGUED_SYSTEM is 122 tokens (messages.count_tokens against claude-haiku-4-5)
// against haiku's ~4096-token minimum cacheable prefix — ~34x under, a much
// wider gap than the near-misses documented elsewhere in this codebase
// (Session 13's ~1000-vs-1024 shared block, ca/prompts.ts's enrich/generateMcqs
// calls). Unlike CA triage's ~8.6k-token candidate list, there is no batch-
// invariant content anywhere in buildArguedParams to legitimately move into
// `system` and clear the floor — stem/options/explanation are all per-question,
// and ARGUED_SCHEMA goes through output_config.format, not system, so it isn't
// cacheable material either. Marking `{text, cache: true}` here would compile
// and ship but cache nothing, while still risking the 1.25x cache-write
// premium on every batch item — a silent no-op, not a small win.
const ARGUED_SYSTEM =
  "You are auditing an exam question for INTERNAL CONSISTENCY. You are given a multiple-choice question, its options, " +
  "and its written explanation. Reading ONLY the explanation, report which single option it CONCLUDES is correct — " +
  "the option the explanation itself argues for. Do NOT solve the question with your own knowledge; do NOT judge whether " +
  "the explanation is factually right. Just identify the option key the explanation lands on. If the explanation is " +
  "ambiguous, self-contradictory, or names no clear option, return \"unclear\". Return strict JSON only.";

export const ARGUED_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    argued_key: { type: "string", enum: ["A", "B", "C", "D", "unclear"] },
    cited_phrase: { type: "string" },
  },
  required: ["argued_key", "cited_phrase"],
};

export interface ArguedResult {
  argued_key: string;
  cited_phrase: string;
}

/** True iff this question has an explanation worth reading (an en side present). */
export function hasExplanation(q: AuditQuestion): boolean {
  return !!(q.explanation_i18n?.en?.trim() || q.explanation_i18n?.hi?.trim());
}

export function buildArguedParams(q: AuditQuestion): Anthropic.MessageCreateParamsNonStreaming {
  const opts = (q.options_i18n ?? []).map((o) => `${o.key}) ${o.text_i18n.en ?? o.text_i18n.hi ?? ""}`).join("\n");
  const expl = q.explanation_i18n?.en?.trim() || q.explanation_i18n?.hi?.trim() || "";
  return structuredParams({
    model: MODELS.haiku,
    maxTokens: 300,
    system: ARGUED_SYSTEM,
    content:
      `Question:\n${q.stem_i18n.en ?? q.stem_i18n.hi ?? ""}\n\nOptions:\n${opts}\n\n` +
      `Explanation:\n${expl}\n\nWhich option does THIS EXPLANATION argue is correct?`,
    schema: ARGUED_SCHEMA,
  });
}

// ---------------------------------------------------------------------------
// Combine
// ---------------------------------------------------------------------------
export interface ConsistencyVerdict {
  status: "ok" | "flagged" | "skipped";
  detail: Record<string, unknown>;
}

export function interpretConsistency(
  q: AuditQuestion,
  structural: StructuralResult,
  argued: ArguedResult | null,
): ConsistencyVerdict {
  const storedKey = q.correct_option_key ?? null;
  const explanationChecked = argued !== null;
  const explanationMismatch =
    explanationChecked && argued!.argued_key !== "unclear" && argued!.argued_key !== storedKey;

  const flagged = !structural.permutation_ok || !structural.number_set_ok || explanationMismatch;

  return {
    status: flagged ? "flagged" : "ok",
    detail: {
      stored_key: storedKey,
      permutation_ok: structural.permutation_ok,
      number_set_ok: structural.number_set_ok,
      structural_issues: structural.issues,
      explanation_checked: explanationChecked,
      argued_key: argued?.argued_key ?? null,
      explanation_mismatch: explanationMismatch,
      cited_phrase: argued?.cited_phrase ?? null,
      source_kind: q.source_kind,
    },
  };
}
