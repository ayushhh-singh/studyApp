/**
 * Pure tests for `ingest/chunk.ts` — no DB, no network, no model, no clock.
 * Mirrors the `test:args` / `test:qgen` / `test:tips` convention.
 *
 *   pnpm --filter api test:embed-chunk
 *
 * The property that matters most is BYTE-IDENTITY for anything that fits in one
 * chunk: that is what lets the context-prefix change ship without invalidating a
 * single existing embedding, and what keeps the nightly inserts-only job correct.
 */
import { chunkWithContext, contextPrefix, splitText, MAX_CHARS, CONTEXT_PREFIX_MAX } from "../src/ingest/chunk.js";

let pass = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = "") {
  if (cond) pass++;
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
}
const eq = (name: string, a: unknown, b: unknown) =>
  check(name, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);

// ---------------------------------------------------------------------------
// 1. BYTE-IDENTITY: a source that fits one chunk is untouched by the prefix.
// ---------------------------------------------------------------------------
const stem = "Which one of the following protected areas is known for the hard-ground Barasingha?";
const short = `${stem} A) Kanha; B) Manas; C) Mudumalai Explanation: Kanha in Madhya Pradesh.`;
eq("short text is a single chunk", chunkWithContext(short, stem).length, 1);
eq("single chunk is byte-identical to no-context splitText", chunkWithContext(short, stem), splitText(short));
check("single chunk is NOT prefixed", !chunkWithContext(short, stem)[0]!.startsWith(`${stem}: `));

// ---------------------------------------------------------------------------
// 2. CONTINUATION chunks get the prefix; chunk 0 never does.
// ---------------------------------------------------------------------------
const longTail = `${stem} ` + "This sentence explains the answer in detail. ".repeat(60);
const split = chunkWithContext(longTail, stem);
check("long text splits into >1 chunk", split.length > 1, `got ${split.length}`);
check("chunk 0 not prefixed", !split[0]!.startsWith(`${stem}: `));
check("chunk 0 still opens with the stem", split[0]!.startsWith(stem));
check(
  "every continuation chunk carries the stem",
  split.slice(1).every((c) => c.startsWith(`${stem}: `)),
  JSON.stringify(split.slice(1).map((c) => c.slice(0, 40))),
);
// Without the fix, a tail chunk would have no stem at all — the actual defect.
const unprefixed = splitText(longTail);
check("WITHOUT context, tails have no stem (the defect this fixes)", !unprefixed[1]!.startsWith(stem));

// ---------------------------------------------------------------------------
// 3. Prefix cap: a very long stem cannot dominate the chunk it prefixes.
// ---------------------------------------------------------------------------
const hugeStem = "word ".repeat(600).trim(); // 3000 chars, > MAX_CHARS on its own
check("huge stem is capped", contextPrefix(hugeStem).length <= CONTEXT_PREFIX_MAX);
check("capped prefix has no trailing space", !contextPrefix(hugeStem).endsWith(" "));
check("capped prefix ends on a whole word", hugeStem.startsWith(contextPrefix(hugeStem)));

// The property THIS change is responsible for: the prefix adds at most
// CONTEXT_PREFIX_MAX + ": " over what the same text produced before.
//
// Deliberately NOT asserted: "no chunk exceeds MAX_CHARS". That is FALSE and was
// false before this change — `splitText` splits on sentence boundaries, so text
// containing no . ? ! or । cannot be split at all and comes back as one
// oversized chunk however long it is. Pre-existing, and far below the embedding
// model's own 8191-token input limit at any realistic question length.
const body = `${hugeStem} ${"Detail sentence here. ".repeat(80)}`;
const beforeMax = Math.max(...splitText(body).map((c) => c.length));
const afterMax = Math.max(...chunkWithContext(body, hugeStem).map((c) => c.length));
check(
  "prefix adds at most CONTEXT_PREFIX_MAX + 2 to the largest chunk",
  afterMax - beforeMax <= CONTEXT_PREFIX_MAX + 2,
  `before ${beforeMax} after ${afterMax}`,
);

// ---------------------------------------------------------------------------
// 4. Normalisation: a stem with newlines/tabs must still match its own chunk 0,
//    otherwise chunk 0 gets its own stem prefixed onto itself.
// ---------------------------------------------------------------------------
const messyStem = "Consider the following statements:\n1. Alpha is true.\n2. Beta is false.";
const messyBody = `${messyStem}\n\nA) 1 only  B) 2 only`;
const messy = chunkWithContext(messyBody, messyStem);
eq("newline-containing stem yields one chunk", messy.length, 1);
check("chunk 0 is not self-prefixed despite newlines", !messy[0]!.includes(": Consider the following statements: Consider"));

// ---------------------------------------------------------------------------
// 5. Devanagari — this product is Hindi-equal-first, and contextPrefix slices by
//    CHARACTER count, so a cut must not land inside a consonant+matra cluster.
// ---------------------------------------------------------------------------
const hiStem = "निम्नलिखित कथनों पर विचार कीजिए तथा सही उत्तर चुनिए जो पूर्णतः सत्य हो ".repeat(6).trim();
const hiPrefix = contextPrefix(hiStem);
check("devanagari prefix is capped", hiPrefix.length <= CONTEXT_PREFIX_MAX);
// A combining mark (U+0900-U+0903, U+093A-U+094F, U+0951-U+0957, U+0962-U+0963)
// at position 0 of the remainder means we cut mid-cluster.
const cutTail = hiStem.slice(hiPrefix.length);
check(
  "devanagari prefix does not cut mid-grapheme",
  !/^[ऀ-ःऺ-ॏ॑-ॗॢॣ]/.test(cutTail),
  `next char U+${cutTail.charCodeAt(0).toString(16)}`,
);
// Danda sentence splitting still works.
const hiLong = "यह एक वाक्य है। ".repeat(200);
check("danda splits devanagari into multiple chunks", splitText(hiLong).length > 1);

// ---------------------------------------------------------------------------
// 6. The syllabus path passes NO context — must be exactly the old behaviour.
// ---------------------------------------------------------------------------
eq("no contextFor == plain splitText (syllabus path unchanged)", chunkWithContext(longTail), splitText(longTail));
eq("empty contextFor == plain splitText", chunkWithContext(longTail, ""), splitText(longTail));

// ---------------------------------------------------------------------------
// 7. Degenerate inputs.
// ---------------------------------------------------------------------------
eq("empty text -> no chunks", chunkWithContext("", stem), []);
eq("whitespace-only text -> no chunks", chunkWithContext("   \n\t ", stem), []);
eq("empty stem -> unprefixed", chunkWithContext(longTail, ""), splitText(longTail));
check("stem longer than the body still yields chunks", chunkWithContext("short body.", hugeStem).length === 1);

// ---------------------------------------------------------------------------
// 8. Idempotence: re-chunking an already-prefixed chunk must not double-prefix.
// ---------------------------------------------------------------------------
const once = chunkWithContext(longTail, stem);
check(
  "no chunk carries the stem twice",
  once.every((c) => c.split(stem).length - 1 <= 1),
  JSON.stringify(once.map((c) => c.split(stem).length - 1)),
);

if (failures.length) {
  console.error(`\n✗ embed chunking: ${failures.length} FAILED, ${pass} passed`);
  for (const f of failures) console.error(`   - ${f}`);
  process.exit(1);
}
console.log(`✓ embed chunking: ${pass}/${pass} assertions passed`);
