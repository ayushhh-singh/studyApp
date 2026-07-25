/**
 * Sukoon clinical-language guard — fails if Sukoon UI copy, prompts, or i18n
 * introduce the banned clinical vocabulary as a CLAIM (drift), while allowing
 * the same words in their legitimate DISCLAIMER / negated form.
 *
 * WHY THIS EXISTS
 * ---------------
 * SUKOON_CONTEXT.md is a hard product rule: Sukoon is a WELLNESS companion, NOT
 * therapy, and must never present itself in clinical terms. The banned words are:
 *   therapy · therapist · psychologist · treatment · diagnosis · patient ·
 *   medication · cure · clinical
 * Risk #2 in the blueprint ("clinical-language drift") calls for exactly this
 * CI guard so a future edit can't quietly reframe the product as medical.
 *
 * WHY IT'S NEGATION-AWARE (not a blunt presence check)
 * ----------------------------------------------------
 * These words appear CORRECTLY and often in Sukoon — but only ever to DENY the
 * clinical frame: "Saathi does NOT diagnose", "never a treatment", "not a cure",
 * the mandated <NotTherapyFooter/> disclaimer component. Those are the safety
 * message, not drift. So a match is an offence ONLY when it is NOT in a negated
 * / disclaimer context. Three things make a match legitimate:
 *   1. it sits inside the sanctioned "NotTherapy…" disclaimer identifier;
 *   2. the line/value also carries a negation cue (not / never / no / नहीं …);
 *   3. "patient" reads as the ADJECTIVE ("be patient with yourself"), warm copy,
 *      never the medical noun.
 * A source line that legitimately needs one of these words in a POSITIVE context
 * (rare — e.g. a styling comment) can suppress the check with a `clinical-words-allow`
 * marker on the line, exactly like the portability guard's escape hatch.
 *
 * SCOPE (per the session brief): client/src/sukoon (all), server/src/sukoon
 * prompts, and the "Sukoon" subtree of the shared i18n message files.
 *
 * USAGE
 *   node scripts/check-sukoon-clinical-words.mjs      (also: pnpm check:clinical-words)
 *   Exit 0 = clean, exit 1 = at least one clinical-drift offence (prints them).
 *
 * Dependency-free plain node so it runs identically in CI and on any machine.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

// Word-boundary, case-insensitive. `patient` is flagged as the medical noun but
// exempted when it reads as an adjective (see PATIENT_ADJ below).
const WORDS = [
  { re: /\btherapy\b/i, label: "therapy" },
  { re: /\btherapist\b/i, label: "therapist" },
  { re: /\bpsychologist\b/i, label: "psychologist" },
  { re: /\btreatment\b/i, label: "treatment" },
  { re: /\bdiagnos(?:is|es|e|ed|ing|tic)\b/i, label: "diagnosis/diagnose" },
  { re: /\bmedication\b/i, label: "medication" },
  { re: /\bclinical\b/i, label: "clinical" },
  { re: /\bcure[sd]?\b/i, label: "cure" },
  { re: /\bpatient\b/i, label: "patient", medicalNoun: true },
];

// The mandated "not therapy" disclaimer component — its name legitimately
// contains "therapy" and is imported/referenced across the module.
const ALLOWED_IDENTIFIERS = ["NotTherapyFooter", "not-therapy-footer", "NotTherapy"];

// A banned word inside a negated / disclaimer sentence is correct framing.
const NEGATION = /\b(?:not|never|no|cannot|can['’]?t|don['’]?t|does\s*n['’]?t|without|nor|neither)\b|न'?ही|नहीं|बिना|कभी/i;

// "patient" as an adjective ("be patient with yourself") — warm copy, not the noun.
const PATIENT_ADJ = /\b(?:be|being|been|stay|staying|feel|feeling|so|more|very|really|too|remain|remaining)\s+patient\b/i;

const MARKER = "clinical-words-allow"; // per-line escape hatch (source files only)

const SKIP_EXT = /\.(png|jpe?g|webp|gif|ico|svg|pdf|woff2?|ttf|otf|eot|mp[34]|zip|gz|wasm)$/i;

// The i18n files are scanned only within their Sukoon subtree (the rest is Neev
// copy, out of scope). Their whole-file paths are handled separately.
const I18N_FILES = [
  "apps/web/src/messages/en.json",
  "apps/web/src/messages/hi.json",
];

function isSourceTarget(f) {
  return (
    (f.startsWith("apps/web/src/sukoon/") || f.startsWith("apps/api/src/sukoon/prompts/")) &&
    !SKIP_EXT.test(f)
  );
}

function trackedFiles() {
  const out = execFileSync("git", ["ls-files", "-z"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return out.split("\0").filter(Boolean);
}

/** Is a banned-word match in `text` legitimate (disclaimer / adjective / identifier)? */
function isLegit(text, word) {
  if (ALLOWED_IDENTIFIERS.some((id) => text.includes(id))) return true;
  if (NEGATION.test(text)) return true;
  if (word.medicalNoun && PATIENT_ADJ.test(text)) return true;
  return false;
}

const offenders = [];

// --- 1. Sukoon source + prompts, line by line ----------------------------
for (const file of trackedFiles()) {
  if (!isSourceTarget(file)) continue;
  let text;
  try {
    text = readFileSync(join(ROOT, file), "utf8");
  } catch {
    continue;
  }
  if (text.includes("\0")) continue;
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes(MARKER)) continue;
    for (const w of WORDS) {
      if (w.re.test(line) && !isLegit(line, w)) {
        offenders.push({ where: `${file}:${i + 1}`, label: w.label, text: line.trim() });
      }
    }
  }
}

// --- 2. The Sukoon subtree of each i18n message file ----------------------
function walkStrings(node, path, visit) {
  if (typeof node === "string") {
    visit(path, node);
    return;
  }
  if (node && typeof node === "object") {
    for (const k of Object.keys(node)) walkStrings(node[k], `${path}.${k}`, visit);
  }
}

for (const file of I18N_FILES) {
  let json;
  try {
    json = JSON.parse(readFileSync(join(ROOT, file), "utf8"));
  } catch {
    continue;
  }
  const sukoon = json.Sukoon;
  if (!sukoon) continue;
  walkStrings(sukoon, "Sukoon", (keyPath, value) => {
    for (const w of WORDS) {
      if (w.re.test(value) && !isLegit(value, w)) {
        offenders.push({ where: `${file} → ${keyPath}`, label: w.label, text: value });
      }
    }
  });
}

if (offenders.length > 0) {
  console.error(
    `\n✖ Sukoon clinical-language guard: found ${offenders.length} clinical-drift offence(s).\n` +
      `  Sukoon is a WELLNESS companion, never therapy — these words must not appear\n` +
      `  as a claim (SUKOON_CONTEXT.md). Rephrase in wellness language, or — if the word\n` +
      `  is genuinely part of a DISCLAIMER — keep it in a negated sentence ("does not\n` +
      `  diagnose", "not a treatment"). A rare legit positive use in source can add a\n` +
      `  \`${MARKER}\` marker on the line.\n`,
  );
  for (const o of offenders) {
    console.error(`  ${o.where}  [${o.label}]`);
    console.error(`      ${o.text}`);
  }
  console.error("");
  process.exit(1);
}

console.log("✓ Sukoon clinical-language guard: no clinical drift in Sukoon copy, prompts, or i18n.");
