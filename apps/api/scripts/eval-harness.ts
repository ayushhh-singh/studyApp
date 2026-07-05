/**
 * eval:answers — end-to-end tuning harness for the AI answer-evaluation engine.
 *
 *   pnpm eval:answers [--runs N] [--keep] [--lang en|hi]
 *
 * Runs three sample answers (a strong one, a mediocre one, and an off-topic one)
 * to the SAME question through the REAL pipeline (createSubmission → RAG
 * grounding → two-pass claude-sonnet-5 evaluation → persist) and prints the
 * scores. We tune the prompt in services/evaluation/prompts.ts until:
 *   1. the ranking is sane:      good > mediocre > off-topic, and
 *   2. repeat runs are stable:   overall score spread within ±5%.
 *
 * The three answers below are editable fixtures — paste your own good / mediocre
 * / off-topic answers in place of them and re-run. Created submissions (and
 * their cascaded evaluations) are deleted afterwards unless --keep is passed, so
 * the dev DB stays at its zero-activity baseline.
 */
import {
  RUBRIC_DIMENSION_KEYS,
  type CreateSubmissionBody,
  type Locale,
  type RubricDimensionKey,
} from "@prayasup/shared";
import { supabase } from "../src/lib/supabase.js";
import { devUserId } from "../src/lib/dev-user.js";
import { createSubmission, runEvaluation, type EvalEmit } from "../src/services/evaluation/evaluate.js";

// ---------------------------------------------------------------------------
// The question all three answers respond to. (Custom prompt path — no
// catalogued descriptive question exists in the dev DB yet.)
// ---------------------------------------------------------------------------
const QUESTION =
  "E-governance has emerged as a key instrument for improving transparency and accountability in " +
  "public administration. Discuss its significance with particular reference to initiatives " +
  "undertaken in Uttar Pradesh. (Answer in about 200 words)";
const WORD_LIMIT = 200;
const MARKS = 15;

// ------------------------------- PASTE ANSWERS HERE -------------------------------
const SAMPLE_GOOD = `Introduction: E-governance is the use of ICT to deliver public services, enabling citizen-centric, transparent and accountable administration. It operationalises the Right to Information (2005) by making government processes visible.

Transparency: Online delivery removes discretionary human interfaces where corruption breeds. In Uttar Pradesh, the Jansunwai (IGRS) portal lets citizens lodge and track grievances online; the e-District platform issues caste, income and domicile certificates without middlemen; and Bhulekh digitises land records, curbing the discretion of local revenue officials.

Accountability: Time-bound service delivery creates answerability. The UP CM Helpline 1076 assigns grievances to officers with escalation and monitoring, while Direct Benefit Transfer (DBT) routes scheme money straight to Aadhaar-linked accounts, plugging leakages. Real-time dashboards let seniors track pendency officer-wise.

Challenges: The digital divide, low digital literacy and patchy rural connectivity can exclude the very citizens governance must reach.

Conclusion: Backed by Digital India and the JAM trinity, e-governance in UP has shifted administration from opacity toward measurable accountability. Its promise, however, depends on last-mile digital literacy and robust grievance-escalation, so that transparency becomes substantive rather than merely procedural.`;

const SAMPLE_MEDIOCRE = `E-governance means using computers and the internet in government work. It is very important today because it makes the government more transparent and accountable to the people. Nowadays many services are available online so people do not have to visit government offices again and again.

Because of e-governance, corruption is reduced and people can get their work done easily. The Digital India programme has helped a lot in this. People can now apply for many things online and also file RTI to get information. This makes the system transparent.

Accountability also increases because everything is recorded online and officers have to do their work properly. Citizens can complain online if there is any problem.

So e-governance is a good step for the country and it should be expanded more. There are some problems like many people do not know how to use the internet, but the government is working on it. Overall e-governance is very useful for transparency and accountability in administration.`;

const SAMPLE_OFF_TOPIC = `Climate change is one of the biggest challenges facing the world today. Rising global temperatures are caused by greenhouse gas emissions from burning fossil fuels like coal and petroleum. This leads to melting glaciers, rising sea levels and extreme weather events such as floods and droughts.

India is particularly vulnerable because of its large population and dependence on agriculture. The monsoon has become unpredictable, affecting crop yields and farmers' incomes. Air pollution in cities is also a serious health hazard.

To fight climate change, we should promote renewable energy such as solar and wind power, plant more trees, and reduce our use of plastic. International cooperation through agreements like the Paris Agreement is also important. Every individual should also do their part by saving electricity and using public transport.`;
// ----------------------------------------------------------------------------------

interface Sample {
  name: string;
  text: string;
}
const SAMPLES: Sample[] = [
  { name: "good", text: SAMPLE_GOOD },
  { name: "mediocre", text: SAMPLE_MEDIOCRE },
  { name: "off-topic", text: SAMPLE_OFF_TOPIC },
];

interface Captured {
  dimensions: Partial<Record<RubricDimensionKey, number>>;
  overallScore: number | null;
  maxScore: number | null;
  isOffTopic: boolean | null;
  groundingChunks: number;
  feedbackChars: number;
  modelAnswerChars: number;
  errored: string | null;
}

function makeCapture(): { emit: EvalEmit; captured: Captured } {
  const captured: Captured = {
    dimensions: {},
    overallScore: null,
    maxScore: null,
    isOffTopic: null,
    groundingChunks: 0,
    feedbackChars: 0,
    modelAnswerChars: 0,
    errored: null,
  };
  const emit: EvalEmit = (event, data) => {
    const d = data as Record<string, unknown>;
    switch (event) {
      case "dimension_score":
        captured.dimensions[d.key as RubricDimensionKey] = d.score as number;
        break;
      case "analysis":
        captured.isOffTopic = d.is_off_topic as boolean;
        break;
      case "feedback_delta":
        captured.feedbackChars += String(d.text ?? "").length;
        break;
      case "model_answer_delta":
        captured.modelAnswerChars += String(d.text ?? "").length;
        break;
      case "done":
        captured.overallScore = d.overall_score as number;
        captured.maxScore = d.max_score as number;
        break;
      case "error":
        captured.errored = String(d.message ?? "unknown");
        break;
      default:
        break;
    }
  };
  return { emit, captured };
}

function parseArgs(argv: string[]): { runs: number; keep: boolean; lang: Locale } {
  let runs = 2;
  let keep = false;
  let lang: Locale = "en";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--runs") runs = Math.max(1, Number(argv[++i]) || 2);
    else if (argv[i] === "--keep") keep = true;
    else if (argv[i] === "--lang") lang = argv[++i] === "hi" ? "hi" : "en";
  }
  return { runs, keep, lang };
}

function fmt(n: number | null, dp = 2): string {
  return n === null ? "—" : n.toFixed(dp);
}

async function main(): Promise<void> {
  const { runs, keep, lang } = parseArgs(process.argv.slice(2));
  const userId = devUserId();
  const createdIds: string[] = [];

  console.log("=".repeat(78));
  console.log(`AI Answer-Evaluation Harness   runs=${runs}  lang=${lang}  marks=${MARKS}  wl=${WORD_LIMIT}`);
  console.log(`Question: ${QUESTION.slice(0, 72)}...`);
  console.log("=".repeat(78));

  // sampleName -> array of overall scores across runs
  const overallBySample = new Map<string, number[]>();
  // sampleName -> last run's captured (for the detail table)
  const lastCaptured = new Map<string, Captured>();

  for (let run = 1; run <= runs; run++) {
    console.log(`\n--- Run ${run}/${runs} ---`);
    for (const sample of SAMPLES) {
      const body: CreateSubmissionBody = {
        custom_question_text: QUESTION,
        mode: "typed",
        typed_text: sample.text,
        language: lang,
        word_limit: WORD_LIMIT,
        marks: MARKS,
      };
      const submission = await createSubmission(userId, body);
      createdIds.push(submission.id);

      const { emit, captured } = makeCapture();
      const t0 = Date.now();
      await runEvaluation(userId, submission.id, emit);
      const secs = ((Date.now() - t0) / 1000).toFixed(1);

      if (captured.errored) {
        console.log(`  ${sample.name.padEnd(10)} ERROR: ${captured.errored}`);
        continue;
      }
      const arr = overallBySample.get(sample.name) ?? [];
      if (captured.overallScore !== null) arr.push(captured.overallScore);
      overallBySample.set(sample.name, arr);
      lastCaptured.set(sample.name, captured);
      console.log(
        `  ${sample.name.padEnd(10)} overall ${fmt(captured.overallScore)}/${fmt(captured.maxScore, 0)}` +
          `  off_topic=${captured.isOffTopic}  ${secs}s`,
      );
    }
  }

  // Per-dimension detail (from the last run of each sample)
  console.log("\n" + "=".repeat(78));
  console.log("Per-dimension scores (last run)");
  console.log("=".repeat(78));
  const header = ["dimension".padEnd(22), ...SAMPLES.map((s) => s.name.padStart(10))].join("");
  console.log(header);
  for (const key of RUBRIC_DIMENSION_KEYS) {
    const row = [key.padEnd(22)];
    for (const s of SAMPLES) {
      const v = lastCaptured.get(s.name)?.dimensions[key];
      row.push((v === undefined ? "—" : String(v)).padStart(10));
    }
    console.log(row.join(""));
  }
  const overallRow = ["OVERALL (/marks)".padEnd(22)];
  for (const s of SAMPLES) {
    const v = lastCaptured.get(s.name)?.overallScore;
    overallRow.push((v === undefined || v === null ? "—" : v.toFixed(2)).padStart(10));
  }
  console.log(overallRow.join(""));

  // Ranking check
  console.log("\n" + "=".repeat(78));
  console.log("Checks");
  console.log("=".repeat(78));
  const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
  const meanGood = mean(overallBySample.get("good") ?? []);
  const meanMed = mean(overallBySample.get("mediocre") ?? []);
  const meanOff = mean(overallBySample.get("off-topic") ?? []);
  const rankingOk = meanGood > meanMed && meanMed > meanOff;
  console.log(
    `Ranking  good(${meanGood.toFixed(2)}) > mediocre(${meanMed.toFixed(2)}) > off-topic(${meanOff.toFixed(2)}): ` +
      `${rankingOk ? "PASS ✅" : "FAIL ❌"}`,
  );

  // Repeatability check. Two denominators are reported:
  //  - of-scale: spread as a % of the max marks (the meaningful one — this is
  //    how exam scores are compared; a stable score repeats within a small
  //    fraction of full marks). This is the pass/fail gate.
  //  - of-mean:  spread relative to the sample's own mean (informational; very
  //    strict for low/borderline scores where the base is small).
  if (runs > 1) {
    console.log("\nRepeatability (target: spread ≤5% of full marks):");
    let allStable = true;
    for (const s of SAMPLES) {
      const arr = overallBySample.get(s.name) ?? [];
      if (arr.length < 2) {
        console.log(`  ${s.name.padEnd(10)} n<2, skipped`);
        continue;
      }
      const m = mean(arr);
      const min = Math.min(...arr);
      const max = Math.max(...arr);
      const absSpread = max - min;
      const ofScalePct = (absSpread / MARKS) * 100;
      const ofMeanPct = m > 0 ? (absSpread / m) * 100 : 0;
      const stable = ofScalePct <= 5;
      if (!stable) allStable = false;
      console.log(
        `  ${s.name.padEnd(10)} [${arr.map((x) => x.toFixed(2)).join(", ")}]  ` +
          `abs ${absSpread.toFixed(2)}  of-scale ${ofScalePct.toFixed(1)}%  of-mean ${ofMeanPct.toFixed(1)}%: ` +
          `${stable ? "PASS ✅" : "FAIL ❌"}`,
      );
    }
    console.log(`\nOverall: ranking ${rankingOk ? "PASS" : "FAIL"}, repeatability ${allStable ? "PASS" : "FAIL"}`);
  }

  // Cleanup
  if (!keep && createdIds.length) {
    const { error } = await supabase().from("answer_submissions").delete().in("id", createdIds);
    if (error) console.log(`\n⚠️  cleanup failed (${error.message}); ${createdIds.length} rows left`);
    else console.log(`\nCleaned up ${createdIds.length} submissions (+ cascaded evaluations).`);
  } else if (keep) {
    console.log(`\nKept ${createdIds.length} submissions: ${createdIds.join(", ")}`);
  }
}

main().catch((err) => {
  console.error("\neval:answers failed:", err instanceof Error ? err.stack : err);
  process.exit(1);
});
