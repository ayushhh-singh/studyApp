/**
 * The ONE definition of how deep an MCQ explanation has to be, shared by every
 * prompt in the repo that asks a model to write one.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * Before it, the same instruction was pasted at FIVE sites in four files —
 * `services/question-explanation.ts` (twice: the persisted bilingual author and
 * the streamed on-demand one), `ingest/prompts.ts` (the bulk batch author),
 * `qgen/prompts.ts` (inline, as one clause of the MCQ writer) and
 * `ca/prompts.ts` (likewise). Three carried a byte-identical "concise
 * explanation (3-5 sentences per language) … and briefly why each other option
 * is wrong"; the other two carried "a short explanation".
 *
 * That duplication is not cosmetic — it is how the cap survived. An improvement
 * applied at one site leaves the other four writing to the old standard, and
 * nothing fails: the output still parses and still renders. The repo has been
 * bitten by exactly this shape before (`ingest/_shared.ts` redeclaring
 * `ExamCode` and silently drifting on the first extension). One definition,
 * imported everywhere, makes the next change reach every site or none.
 *
 * DEPENDENCY-FREE ON PURPOSE. `ingest/prompts.ts`'s own docblock states that it
 * imports nothing but the exam-config lookups, because it exists to be readable
 * by `pnpm prompts:snapshot` without dragging a CLI's side effects in. So this
 * module imports NOTHING at all — that is what lets all five sites share it.
 *
 * NOT EXAM-CONFIGURABLE, deliberately. What varies per commission is WHICH exam
 * is being explained, and that already lives in `exam-config.ts`'s
 * `misc.explanationFraming` / `misc.streamExplanationFraming`. How much depth an
 * explanation needs is not a judgment about a commission — it is a judgment
 * about what helps a person learn. A per-exam slot here would add two more
 * UNAUTHORED entries per unlaunched exam (U6) and buy nothing.
 *
 * ---------------------------------------------------------------------------
 * GROUNDED IN A MEASURED STANDARD, NOT IN TASTE (research pass, 2026-08-13)
 * ---------------------------------------------------------------------------
 * Seven artefacts were read: Vision IAS's UPSC Prelims 2024 CSAT explanation PDF
 * (verbatim), ForumIAS's 2024 GS key, Drishti's 2022/2023 UPSC analyses AND its
 * UP PCS Pre 2025 GS key, InsightsOnIndia's daily quiz, GS SCORE's 2025 key, and
 * the official UPSC 2023 GS-I key. Findings that shaped the text below, INCLUDING
 * the two that contradicted this module's own first draft:
 *
 *  1. VERDICT FIRST, then reasoning, then the verdict restated at the close.
 *     Every source without exception. Redundant on paper; it is the convention.
 *  2. On a statement-type item the unit of adjudication is the STATEMENT, never
 *     the option letter — ZERO of the seven walk through (a)/(b)/(c)/(d) — and
 *     EVERY statement gets an explicit verdict, including the correct ones.
 *  3. A wrong statement is never merely negated, it is CORRECTED: the pattern is
 *     verdict then the true fact that replaces it ("Dr. Rajendra Prasad did the
 *     Pran-Pratistha", not "S. Radhakrishnan is wrong").
 *  4. ⚑ CONTRADICTED THE FIRST DRAFT — mechanically refuting all three wrong
 *     options is what PADDING looks like, not what good keys do. On a
 *     straightforward factual item four of the sources refute NONE; they explain
 *     the entity and stop. They go option-by-option only where a distractor is a
 *     genuine confusable. Hence "proportionate to how much of a trap it is"
 *     below, rather than the blanket per-option rebuttal drafted first.
 *  5. ⚑ ALSO CONTRADICTED THE FIRST DRAFT — measured lengths are ~78-142 words
 *     for a simple factual item and ~185-285 for a multi-statement one (roughly
 *     55-70 words per statement adjudicated). "No sentence limit" was drafted
 *     here and is wrong in the other direction: the one source that runs 350-650
 *     words is flagged as burying the point. The calibration is stated as an
 *     anchor, deliberately not as a hard cap.
 *  6. Vision IAS ships `Answer:(b)` with NO explanation for a cube-cutting item.
 *     Where nothing needs saying, nothing is said. That is why the anti-padding
 *     clause is as prominent as the depth clause.
 *  7. NOT PRESENT IN ANY SOURCE, so deliberately NOT requested: mnemonics,
 *     "remember this" boxes, and "why this distinction is frequently tested"
 *     meta-commentary. Those live in paper-level analysis, never inside a
 *     question's explanation. What IS real is adjacent facts likely to be tested
 *     next, which is what the closing clause asks for instead.
 *  8. NOT REQUESTED THOUGH IT IS THE MOST CONSISTENT REAL COMPONENT: a source
 *     citation with a URL (ForumIAS attaches one to every question). We cannot
 *     reproduce it safely — asking a model for a citation invites a fabricated
 *     one, and this pipeline's whole grounding discipline exists to stop exactly
 *     that. The consuming prompts require grounding in the retrieved passages
 *     instead, which is the same guarantee without the fabrication surface.
 *  9. Coaching keys mark statement verdicts with bold lead-ins. Our three
 *     renderers show explanation text verbatim with no markdown renderer, so the
 *     adaptation is a plain sentence ("Statement 2 is incorrect.") and every
 *     consuming prompt separately forbids markdown syntax.
 *
 * TWO GRANULARITIES, one intent:
 *  - `EXPLANATION_DEPTH_SPEC` for the three prompts whose ONLY job is to write
 *    an explanation.
 *  - `EXPLANATION_DEPTH_CLAUSE`, the compact form, for the two generation
 *    prompts where the explanation is one field among many. It is deliberately
 *    short: `ca/prompts.ts` carries a recorded, measured incident (2026-08-13)
 *    where adding a rule block to that system prompt cost real question yield,
 *    so anything added there earns its length or is not added.
 */

/**
 * Shared by both forms — the part that stops "explain each wrong option"
 * degenerating into circular nonsense on the formats these exams actually set.
 *
 * A "consider the following statements" item is ~55% of real UPSC Prelims GS-I
 * (measured; see CLAUDE.md's qgen corpus work), and on that format the options
 * are COMBINATIONS. Told bare to "say why each other option is wrong", a model
 * writes "option B is wrong because statements 1 and 3 are not both correct",
 * which restates the key instead of teaching anything — and it is the same
 * confusion that once made a per-view key-check unreliable on this format (see
 * `services/question-explanation.ts`'s header). Making the STATEMENT the unit of
 * adjudication is also what all seven researched sources actually do.
 */
const STRUCTURE_RULE =
  "Match the question's own structure. Where it is built on numbered statements, give an explicit verdict on EACH " +
  "statement — including the ones that are correct — and let the right option follow from those verdicts instead of " +
  "discussing option letters at all. Where it is a match-list, rule on EACH pairing. Where it is an assertion and a " +
  "reason, rule on the assertion, on the reason, and on whether the reason actually explains the assertion.";

/**
 * Shared by both forms — correct, do not merely negate. Research finding 3.
 */
const CORRECTION_RULE =
  "Whenever you call something wrong, replace it: give the fact that is actually true, rather than only saying the " +
  "statement or option is incorrect.";

/**
 * ⚑ FOUND BY TESTING, NOT BY REVIEW — and it is the one rule here that exists to
 * counteract a pressure the REST of this spec creates.
 *
 * Asking for a step-by-step derivation makes the model's reasoning visible. On a
 * real UPPSC CSAT speed/distance item (800 km journey, compounding speed
 * reductions), the depth prompt correctly showed its working, reached v = 100,
 * noticed that contradicted the stored key of 200 — and then FABRICATED a bridge:
 * "However, this gives 100 km/h. Re-examining … yields v = 200 km/h as the
 * solution when the calculation is carried through with the correct
 * interpretation." No such re-examination was performed. The pre-change prompt
 * hid the same wrong derivation behind a one-line hand-wave, so depth did not
 * cause the error — it exposed it, and then "justify the given key" did the rest.
 * (For the record the key WAS right and both arms' physics was wrong: the two
 * reductions compound, so the third leg runs at v/8, not v/4.)
 *
 * The same run also hit `maxTokens` and needed structuredJson's 1.75x retry —
 * the model was flailing at the contradiction rather than writing a long answer.
 * So this rule is a correctness fix and a cost fix at once.
 *
 * DELIBERATELY NOT A GATE. `services/question-explanation.ts`'s header records
 * that a per-view "does the evidence support the key?" check was tried and is
 * unreliable on the statement-combination format — it reads a deliberately-false
 * statement as evidence the key is wrong and withholds a correct question. So
 * this asks the model to SAY the disagreement inside the explanation it still
 * writes; it never suppresses one. A visible, honest mismatch is also exactly the
 * signal the `ai_key_dispute` review flag exists for, and this bank has shipped a
 * whole mis-keyed paper before (the 2024 CSAT quarantine).
 */
const NO_FABRICATED_BRIDGE_RULE =
  "If your own reasoning or working does not actually reach the option you were told is correct, do NOT invent a " +
  "reconciliation to get there. Show the working you genuinely get, state plainly that it does not match the given " +
  "answer, and stop. An honest, visible disagreement is useful to the student and to us; a manufactured one is not. " +
  // ⚑ ADDED AFTER THE BLIND PANEL. All three judges independently called out
  // that an explanation which OPENS "the correct option is A (200)" and then
  // spends 200 words arguing for 100 "undermines the key" and leaves the
  // student with an unresolved contradiction — a real cost of the honesty rule
  // above, created by this spec's own "state the verdict first" convention.
  // Resolved by ordering rather than by dropping either: lead with the doubt.
  "In that case do not open by asserting the given option as fact and then contradict yourself — say up front that " +
  "your working disagrees with the given answer, then show it.";

/**
 * ⚑ ALSO FOUND BY THE BLIND PANEL, and flagged UNANIMOUSLY by all three judges
 * as a defect BOTH the old and the new prompt shared.
 *
 * The sample included a real CSAT item, "The number of parallelograms in the
 * adjoining figure is" — and no figure is stored anywhere in the question. Both
 * arms invented a count and dressed it in the language of systematic
 * enumeration ("careful counting of all valid combinations yields exactly 15"),
 * which is a confident fabrication about something neither could see. One judge
 * put it exactly right: the honest answer — "the figure is not available; here
 * is the method you would apply" — would have beaten both.
 *
 * MEASURED SCOPE: 9 live MCQs across UPPSC and UPSC CSAT genuinely reference a
 * figure/diagram/map that is not in the stem text (9 of 5,277 live MCQs, 0.2%).
 * NONE of the 9 currently has a stored explanation — so every one of them is
 * still waiting to be written on a student's first view, and without this rule
 * every one would be confabulated. Small population, 100% failure rate on it.
 */
const MISSING_ARTEFACT_RULE =
  "If the question refers to something you have not actually been given — an adjoining figure, a diagram, a map, a " +
  "chart — do NOT infer or invent its contents. Say plainly that the figure is not available to you, then give the " +
  "method the aspirant should apply to it. Never dress a guess in the language of careful counting or enumeration.";

/**
 * The full specification. Written as instructions to the model, so it uses
 * dashes — every consuming prompt separately forbids bullets IN THE OUTPUT.
 */
export const EXPLANATION_DEPTH_SPEC =
  // ⚑ THE TWO HONESTY CONSTRAINTS COME FIRST, AND PLACEMENT IS MEASURABLY
  // LOAD-BEARING — but read the numbers before trusting them further.
  //
  // Written first as trailing clauses inside the bullet list below, they did not
  // fire at all: 2/2 runs invented a parallelogram count for a figure they had
  // not been given, and 2/2 opened "The correct option is A (200)" before
  // arguing for 100. That is the same failure `qgen/prompts.ts`'s `mcqSystem`
  // already records — "a GS-shaped body followed by a one-sentence exception,
  // which the model did not honour". Hoisting them to the front helped, and the
  // honest scorecard at n=5 each is:
  //
  //   fabricates a bridge to the key      0/5   FIXED (was the original defect)
  //   invents contents of a missing figure 1/5   much better than 2/2, not gone
  //   admits the figure is absent          3/5
  //   still opens by asserting the key     4/5   the ordering refinement FAILED
  //
  // So: the ANTI-FABRICATION half works and is worth the placement. The
  // "lead with the doubt instead of the verdict" refinement essentially does
  // not, and is left in only because it costs nothing. DO NOT keep tuning this
  // prompt to chase it — that is precisely what `ca/prompts.ts`'s reverted rule
  // block and G3's model-answer work both concluded: past this point the
  // instrument is a verification STAGE, not more instruction text.
  //
  // (One caveat on the 2/5 "flags the disagreement" figure not shown above: it
  // is not interpretable on its own, because a run that correctly uses the
  // compounding reading reaches the keyed answer and has nothing to flag.)
  //
  // Do not demote these two back into the list.
  "Two things override everything else below.\n" +
  `FIRST: ${MISSING_ARTEFACT_RULE}\n` +
  `SECOND: ${NO_FABRICATED_BRIDGE_RULE}\n` +
  "Now, subject to those two: write the explanation a strong answer key would write — one an aspirant can STUDY " +
  "from, not a one-line justification. Follow the conventions real answer keys use:\n" +
  "- Open by stating which option is correct — unless the FIRST or SECOND constraint above applies, in which case " +
  "lead with that instead — then give the reasoning that actually makes it correct: the fact, " +
  "provision, rule or derivation it turns on, stated in full. Never restate the option's own text back as its " +
  "justification. If the stem turns on a term whose meaning decides the question, define that term first in one " +
  "sentence.\n" +
  `- ${STRUCTURE_RULE}\n` +
  "- On an item that is NOT statement-based, deal with the other options in proportion to how much of a trap each " +
  "one is: a distractor a well-prepared aspirant could genuinely be pulled towards — a confusable entity, a close " +
  "date, a similar-sounding scheme — gets its own explicit rebuttal, while an option that is merely wrong can be " +
  "dismissed in a few words. Do not manufacture a paragraph for a distractor nobody would pick.\n" +
  `- ${CORRECTION_RULE}\n` +
  "- If the item is quantitative or a reasoning puzzle, show the worked solution step by step, so the aspirant can " +
  `reproduce the method on a similar question rather than just reading off the result. ${NO_FABRICATED_BRIDGE_RULE}\n` +
  `- ${MISSING_ARTEFACT_RULE}\n` +
  "- Where it genuinely helps, close with one or two adjacent facts a paper is likely to test next on the same " +
  "entity, or the fact it is most often confused with. Leave this out when nothing useful comes to mind — do not " +
  "invent a connection to fill the slot.\n" +
  "As a calibration, real answer keys run about 100 words for a straightforward factual item and about 200 for a " +
  "multi-statement one, roughly 55 to 70 words per statement adjudicated. Treat that as the shape of a complete " +
  "answer, not as a limit to hit: go longer when the question genuinely needs it, stop early when it does not, and " +
  "never pad to look thorough.";

/**
 * The compact form for the two prompts that generate a question and its
 * explanation together. Same intent, ~1/3 the tokens.
 */
export const EXPLANATION_DEPTH_CLAUSE =
  "The explanation must be one an aspirant can study from, in the shape a real answer key uses: state which option " +
  "is correct, then give the reasoning that actually makes it correct rather than restating it. " +
  `${STRUCTURE_RULE} On a non-statement item, rebut each distractor that is a genuine trap and dismiss the merely ` +
  `wrong ones briefly. ${CORRECTION_RULE} Show the worked steps for a quantitative or reasoning item. ` +
  `${NO_FABRICATED_BRIDGE_RULE} ${MISSING_ARTEFACT_RULE} About 100 words for a simple factual item and about 200 ` +
  "for a multi-statement one is the right shape — longer where the question needs it, never padded.";

/**
 * ⚑ THE CURRENT-AFFAIRS FORM, AND IT IS SHORTER FOR A MEASURED REASON — do not
 * "unify" it with `EXPLANATION_DEPTH_CLAUSE` to tidy up.
 *
 * `ca/prompts.ts` is the one consumer where the NUMBER of questions is a free
 * variable: qgen is told "Generate ${count} distinct questions", but the CA
 * prompt ends "QUANTITY IS NOT A TARGET: return 0, 1, or 2 … return an EMPTY
 * questions array". Adding demanding text to that prompt therefore trades
 * against yield, which is exactly the recorded 2026-08-13 incident where a rule
 * block cost 11 questions -> 7 and was reverted.
 *
 * MEASURED on the same 12 real published CA items, one call each:
 *
 *   arm                     yield   mean explanation words
 *   old (control run A)        15            28
 *   old (control run B)        15            —      <- noise floor: delta 0
 *   full EXPLANATION_DEPTH_CLAUSE  12        79     <- -20%, a REAL regression
 *   this minimal form          14            51     <- -1, inside per-item noise
 *
 * The old-vs-old control arm is what makes that readable: it came back 15/15, so
 * the full clause's -3 (three separate items each dropping 2 questions to 1) is
 * signal, not variance. The minimal form keeps ~82% more explanation than the
 * old line for a yield cost indistinguishable from noise, which is the trade
 * worth making on a high-volume pipeline whose output is review-gated anyway.
 *
 * It is deliberately phrased as a swap for the ORIGINAL line's "and a short
 * explanation" clause, preserving that line's shape — the measurement above is
 * only valid for this phrasing at this length.
 */
export const EXPLANATION_DEPTH_CLAUSE_MINIMAL =
  "an explanation that gives the reasoning behind the correct option and says what is wrong with each genuine trap " +
  "among the others — ruling on each numbered statement where the question is built that way";

/**
 * The output-formatting rule shared by the prompts that persist a bilingual
 * explanation. Paragraph breaks are ALLOWED and the renderers honour them
 * (`whitespace-pre-line`); markdown is not, because the explanation is rendered
 * verbatim with no markdown renderer at any of its three surfaces.
 */
export const EXPLANATION_FORMAT_RULE =
  "Plain prose only, rendered verbatim with no markdown renderer: no headers, no bold or italic asterisks, no " +
  "bullet characters, no numbered-list markup. You may separate paragraphs with a blank line, and should where " +
  "that makes a longer explanation easier to read.";
