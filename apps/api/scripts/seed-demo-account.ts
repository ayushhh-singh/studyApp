/**
 * demo:seed — creates ONE rich, realistic demo account for product
 * demos/screenshots, with ~4 weeks of plausible history across every
 * subsystem (MCQ attempts, answer-writing evaluations, SRS/FSRS, streak,
 * mastery, milestones, notifications, community).
 *
 *   pnpm demo:seed [--email you@example.com] [--reset]
 *
 * Auth: a REAL Supabase Auth user is created via the service-role admin API
 * (supabase.auth.admin.createUser), the same primitive migrate-dev-user.ts /
 * set-password.ts / rls-security-check.ts use — never a raw INSERT into
 * auth.users. The on_auth_user_created trigger provisions the users_profile
 * row; this script then fills in onboarding fields directly so the account
 * never hits the onboarding wizard.
 *
 * Idempotency: if an account with --email already exists, the script refuses
 * unless --reset is passed, in which case it wipes every row this user owns
 * (across every user-scoped table — see WIPE_SPECS) and reseeds from scratch,
 * reusing the same auth user id (so the login stays stable across re-runs).
 * It NEVER touches rows belonging to any other user.
 *
 * Reuse of real service logic (not hand-rolled DB writes) where practical:
 *   - MCQ attempts:      services/attempts.ts (startAttempt/upsertAttemptAnswers/submitAttempt)
 *   - SRS add-to-revision: services/srs.ts (addNodeToRevision/addQuestionToRevision/
 *                          createManualCard/seedWrongAnswers/seedNoteFacts)
 *   - SRS scheduling:    lib/fsrs.ts (reviewCard) — the exact FSRS engine the app uses
 *   - Mastery:           mastery/compute.ts (recomputeMastery)
 *   - Streak:            daily/streak.ts (refreshStreak), replayed day-by-day
 *                          over the seeded activity so the final streak_count
 *                          is exactly what the real nightly job would compute
 *                          — never hand-set.
 *   - Milestones:        services/milestones.ts (evaluateMilestones)
 *   - Notifications:     services/notifications.ts (generateForUser)
 *   - Community:         services/community.ts (createThread/addPost/shareAnswerForPeerReview)
 *
 * TRADEOFF (disclosed per the task brief): answer-writing evaluations are
 * inserted directly as structurally-valid answer_submissions + evaluations
 * rows (real dimension weights via services/evaluation/rubric.ts, real
 * MODELS.sonnet id, real i18n shape) rather than invoked through the live
 * two-pass claude-sonnet-5 pipeline — calling the real LLM for ~10 evaluations
 * would be slow and cost real money for what is placeholder demo content. The
 * strengths/improvements/model-answer/analysis text is generic, topic-agnostic
 * template copy, not a genuine per-answer critique. Everything else (MCQ
 * grading, FSRS scheduling, streak/mastery/milestone computation) runs the
 * real pipeline against real data, so those numbers are exactly what the app
 * itself would have produced.
 */
import { supabase } from "../src/lib/supabase.js";
import { MODELS } from "../src/lib/models.js";
import { istToday, shiftDate, istClockUtc } from "../src/lib/ist.js";
import { startAttempt, upsertAttemptAnswers, submitAttempt } from "../src/services/attempts.js";
import {
  addNodeToRevision,
  addQuestionToRevision,
  createManualCard,
  seedWrongAnswers,
  seedNoteFacts,
} from "../src/services/srs.js";
import { reviewCard, type FsrsStateJson, type SrsRating } from "../src/lib/fsrs.js";
import { recomputeMastery } from "../src/mastery/compute.js";
import { refreshStreak } from "../src/daily/streak.js";
import { evaluateMilestones } from "../src/services/milestones.js";
import { generateForUser as generateNotifications } from "../src/services/notifications.js";
import { createThread, addPost, shareAnswerForPeerReview } from "../src/services/community.js";
import {
  rubricDimensions,
  computeOverallScore,
  RUBRIC_VERSION,
  ESSAY_RUBRIC_VERSION,
} from "../src/services/evaluation/rubric.js";
import { ESSAY_PAPER_CODE, ESSAY_WORD_LIMIT, ESSAY_MAX_MARKS } from "../src/lib/exam-papers.js";
import type { BilingualText, DimensionScore, Locale, RubricDimensionKey } from "@prayasup/shared";

const DEMO_PASSWORD = "Demo1234!";
const TODAY = istToday();

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function dateOffset(daysAgo: number): string {
  return shiftDate(TODAY, -daysAgo);
}

function tsAt(daysAgo: number, hour: number, minute = 0): string {
  return istClockUtc(dateOffset(daysAgo), hour, minute);
}

function clamp10(n: number): number {
  return Math.min(10, Math.max(0, Math.round(n)));
}

/** Mostly Good/Easy, occasional Hard, rare Again — a plausible real reviewer's rating mix. */
function weightedRating(): SrsRating {
  const r = Math.random();
  if (r < 0.1) return 1;
  if (r < 0.3) return 2;
  if (r < 0.8) return 3;
  return 4;
}

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
interface Args {
  email: string;
  reset: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { email: "demo@prayasup.app", reset: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--email") args.email = argv[++i] ?? args.email;
    else if (argv[i] === "--reset") args.reset = true;
  }
  return args;
}

// ---------------------------------------------------------------------------
// Wipe (--reset) — every user-scoped table, keyed by the FK column that
// references users_profile(id). Never touches any other user's rows.
// ---------------------------------------------------------------------------
const WIPE_SPECS: { table: string; column: string }[] = [
  { table: "attempts", column: "user_id" },
  { table: "answer_submissions", column: "user_id" },
  { table: "srs_reviews", column: "user_id" },
  { table: "srs_cards", column: "user_id" },
  { table: "events", column: "user_id" },
  { table: "study_plans", column: "user_id" },
  { table: "doubt_threads", column: "user_id" },
  { table: "llm_calls", column: "user_id" },
  { table: "daily_stats", column: "user_id" },
  { table: "notification_schedule", column: "user_id" },
  { table: "milestones", column: "user_id" },
  { table: "node_mastery", column: "user_id" },
  { table: "drill_sessions", column: "user_id" },
  { table: "personal_bests", column: "user_id" },
  { table: "subscriptions", column: "user_id" },
  { table: "learner_profiles", column: "user_id" },
  { table: "mentor_insights", column: "user_id" },
  { table: "discussion_posts", column: "user_id" },
  { table: "discussion_threads", column: "user_id" },
  { table: "post_votes", column: "user_id" },
  { table: "shared_answers", column: "user_id" },
  { table: "reports", column: "reporter_id" },
  { table: "user_blocks", column: "blocker_id" },
  { table: "user_blocks", column: "blocked_id" },
  { table: "push_subscriptions", column: "user_id" },
  { table: "push_preferences", column: "user_id" },
];

async function wipeUserData(userId: string): Promise<void> {
  const db = supabase();
  for (const { table, column } of WIPE_SPECS) {
    const { error } = await db.from(table).delete().eq(column, userId);
    if (error) console.warn(`  ! wipe ${table}.${column} failed: ${error.message}`);
  }
  console.log(`  wiped existing rows for ${userId} across ${WIPE_SPECS.length} table/column pair(s)`);
}

// ---------------------------------------------------------------------------
// Auth user + profile
// ---------------------------------------------------------------------------
async function resolveOrCreateUser(email: string, password: string, reset: boolean): Promise<string> {
  const db = supabase();
  const { data, error } = await db.auth.admin.listUsers();
  if (error) throw new Error(`listUsers failed: ${error.message}`);
  const existing = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());

  if (existing) {
    if (!reset) {
      throw new Error(
        `An account with email ${email} already exists (id ${existing.id}). ` +
          `Pass --reset to wipe and reseed it (no other account is ever touched).`,
      );
    }
    console.log(`Existing account found (${existing.id}) — wiping its data (--reset)...`);
    await wipeUserData(existing.id);
    const upd = await db.auth.admin.updateUserById(existing.id, { password, email_confirm: true });
    if (upd.error) throw new Error(`password reset failed: ${upd.error.message}`);
    return existing.id;
  }

  const { data: created, error: createErr } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createErr || !created.user) throw new Error(`createUser failed: ${createErr?.message}`);
  console.log(`Created new auth user ${created.user.id} for ${email}`);
  return created.user.id;
}

async function setupProfile(userId: string): Promise<void> {
  const planExpiresAt = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
  const { error } = await supabase()
    .from("users_profile")
    .update({
      display_name: "Ananya Verma",
      handle: "ananya_uppsc",
      preferred_locale: "en",
      medium: "en",
      target_exam_year: 2026,
      plan: "pro",
      plan_expires_at: planExpiresAt,
      onboarding_completed: true,
      study_hours_per_day: 5,
      is_admin: false,
      streak_count: 0,
      streak_freezes: 0,
      streak_freeze_used_on: null,
      last_active_date: null,
    })
    .eq("id", userId);
  if (error) throw new Error(`profile setup failed: ${error.message}`);
}

// ---------------------------------------------------------------------------
// MCQ attempts (real startAttempt/upsertAttemptAnswers/submitAttempt, then a
// direct timestamp patch so the history spreads over the last ~4 weeks).
// ---------------------------------------------------------------------------
interface AttemptPlanItem {
  daysAgo: number;
  targetAccuracy: number;
  source: "sectional" | "mock";
}

const ATTEMPT_PLAN: AttemptPlanItem[] = [
  // Older, sparse history (outside the contiguous streak window) — lower scores.
  { daysAgo: 25, targetAccuracy: 0.55, source: "sectional" },
  { daysAgo: 22, targetAccuracy: 0.5, source: "sectional" },
  { daysAgo: 19, targetAccuracy: 0.6, source: "sectional" },
  { daysAgo: 16, targetAccuracy: 0.58, source: "sectional" },
  // Recent 15-day streak window — trending upward.
  { daysAgo: 14, targetAccuracy: 0.65, source: "sectional" },
  { daysAgo: 13, targetAccuracy: 0.68, source: "sectional" },
  { daysAgo: 11, targetAccuracy: 0.7, source: "sectional" },
  { daysAgo: 9, targetAccuracy: 0.62, source: "mock" },
  { daysAgo: 7, targetAccuracy: 0.75, source: "sectional" },
  { daysAgo: 6, targetAccuracy: 0.72, source: "sectional" },
  { daysAgo: 4, targetAccuracy: 0.7, source: "mock" },
  { daysAgo: 2, targetAccuracy: 0.8, source: "sectional" },
  { daysAgo: 1, targetAccuracy: 0.74, source: "mock" },
  { daysAgo: 0, targetAccuracy: 0.85, source: "sectional" },
];

interface TestPoolRow {
  id: string;
  kind: string;
}

async function fetchAttemptTestPool(): Promise<{ sectional: TestPoolRow[]; mock: TestPoolRow[] }> {
  const { data, error } = await supabase()
    .from("tests")
    .select("id, kind")
    .eq("is_published", true)
    .in("kind", ["sectional", "mock"]);
  if (error) throw new Error(`fetch tests failed: ${error.message}`);
  const rows = (data ?? []) as TestPoolRow[];
  return { sectional: rows.filter((r) => r.kind === "sectional"), mock: rows.filter((r) => r.kind === "mock") };
}

interface TestQuestionRow {
  id: string;
  question_id: string;
  marks: number | null;
  questions: { correct_option_key: string | null; options_i18n: { key: string }[] | null; marks: number | null } | null;
}

/** Standard UPPSC Prelims MCQ marks-per-question (matches the mocks:build convention). */
const DEFAULT_MCQ_MARKS = 2;

/**
 * Real data gap in this dev DB: most PRE_GS1/PRE_CSAT PYQs never got `marks`
 * backfilled onto `questions` or `test_questions` by the ingest pipeline (only
 * mocks:build sets it explicitly) — so a sectional/pyq_full attempt would
 * otherwise score a meaningless 0/0. Backfill ONLY nulls (never overwrites a
 * real value) for the questions this attempt actually uses, before starting
 * it, so the demo's own scores are genuine — this is a net-positive, scoped
 * data fix, not a behaviour change for anyone else's real (non-null) marks.
 */
async function ensureTestQuestionsHaveMarks(testId: string): Promise<void> {
  const { data: tq, error } = await supabase()
    .from("test_questions")
    .select("id, question_id, marks, questions(marks)")
    .eq("test_id", testId);
  if (error) throw new Error(`test_questions fetch (marks backfill) failed: ${error.message}`);
  const rows = (tq ?? []) as unknown as TestQuestionRow[];

  const questionIdsNeedingMarks = rows.filter((r) => r.marks == null && r.questions?.marks == null).map((r) => r.question_id);
  if (questionIdsNeedingMarks.length > 0) {
    const { error: qErr } = await supabase()
      .from("questions")
      .update({ marks: DEFAULT_MCQ_MARKS })
      .in("id", questionIdsNeedingMarks)
      .is("marks", null);
    if (qErr) throw new Error(`marks backfill (questions) failed: ${qErr.message}`);
  }
  const testQuestionIdsNeedingMarks = rows.filter((r) => r.marks == null).map((r) => r.id);
  if (testQuestionIdsNeedingMarks.length > 0) {
    const { error: tqErr } = await supabase()
      .from("test_questions")
      .update({ marks: DEFAULT_MCQ_MARKS })
      .in("id", testQuestionIdsNeedingMarks)
      .is("marks", null);
    if (tqErr) throw new Error(`marks backfill (test_questions) failed: ${tqErr.message}`);
  }
}

async function seedOneAttempt(
  userId: string,
  testId: string,
  targetAccuracy: number,
  daysAgo: number,
): Promise<string> {
  await ensureTestQuestionsHaveMarks(testId);
  const attempt = await startAttempt(userId, { test_id: testId });

  const { data: tqRows, error } = await supabase()
    .from("test_questions")
    .select("question_id, questions(correct_option_key, options_i18n)")
    .eq("test_id", testId);
  if (error) throw new Error(`test_questions fetch failed: ${error.message}`);

  const answers = ((tqRows ?? []) as unknown as TestQuestionRow[]).map((row) => {
    const correct = row.questions?.correct_option_key ?? null;
    const optionKeys = (row.questions?.options_i18n ?? []).map((o) => o.key);
    const isCorrect = Math.random() < targetAccuracy;
    let chosen = correct;
    if (!isCorrect) {
      const wrongKeys = optionKeys.filter((k) => k !== correct);
      chosen = wrongKeys.length > 0 ? wrongKeys[Math.floor(Math.random() * wrongKeys.length)] : correct;
    }
    return { question_id: row.question_id, chosen_option_key: chosen, time_spent_seconds: randInt(12, 160) };
  });

  if (answers.length > 0) await upsertAttemptAnswers(userId, attempt.id, answers);
  await submitAttempt(userId, attempt.id);

  const startedAt = tsAt(daysAgo, randInt(7, 21), randInt(0, 59));
  const submittedAt = new Date(new Date(startedAt).getTime() + randInt(15, 70) * 60_000).toISOString();
  const { error: patchErr } = await supabase()
    .from("attempts")
    .update({ started_at: startedAt, submitted_at: submittedAt, created_at: startedAt })
    .eq("id", attempt.id);
  if (patchErr) throw new Error(`attempt timestamp patch failed: ${patchErr.message}`);

  return dateOffset(daysAgo);
}

async function seedAllAttempts(userId: string): Promise<Set<string>> {
  const { sectional, mock } = await fetchAttemptTestPool();
  if (sectional.length === 0) {
    throw new Error("No published sectional tests found — run `pnpm ingest:tests` first");
  }
  const sectionalQueue = shuffle(sectional);
  const mockQueue = shuffle(mock);
  let si = 0;
  let mi = 0;
  const activeDates = new Set<string>();
  let count = 0;

  for (const item of ATTEMPT_PLAN) {
    let test: TestPoolRow;
    if (item.source === "mock" && mockQueue.length > 0) {
      test = mockQueue[mi % mockQueue.length];
      mi += 1;
    } else {
      test = sectionalQueue[si % sectionalQueue.length];
      si += 1;
    }
    const dateStr = await seedOneAttempt(userId, test.id, item.targetAccuracy, item.daysAgo);
    activeDates.add(dateStr);
    count += 1;
  }
  console.log(`  seeded ${count} MCQ attempts (sectional PYQ papers + mock tests, spread over ~4 weeks)`);
  return activeDates;
}

// ---------------------------------------------------------------------------
// Answer-writing evaluations — inserted directly (see header TRADEOFF note).
// ---------------------------------------------------------------------------
interface EvalPlanItem {
  daysAgo: number;
  paper: string;
  qIndex: number;
  fraction: number;
  language: Locale;
}

const EVAL_PLAN: EvalPlanItem[] = [
  { daysAgo: 24, paper: "MAINS_GS1", qIndex: 0, fraction: 0.45, language: "en" },
  { daysAgo: 18, paper: "MAINS_GS2", qIndex: 0, fraction: 0.5, language: "en" },
  { daysAgo: 13, paper: "MAINS_GS3", qIndex: 0, fraction: 0.6, language: "en" },
  // Same question as day -24 — an "improvement pair" for profile_improvement_pairs.
  { daysAgo: 10, paper: "MAINS_GS1", qIndex: 0, fraction: 0.78, language: "en" },
  { daysAgo: 8, paper: "MAINS_GS4", qIndex: 0, fraction: 0.65, language: "en" },
  { daysAgo: 6, paper: "MAINS_GS5", qIndex: 0, fraction: 0.7, language: "en" },
  { daysAgo: 4, paper: "MAINS_GS6", qIndex: 0, fraction: 0.72, language: "en" },
  { daysAgo: 3, paper: "MAINS_ESSAY", qIndex: 0, fraction: 0.68, language: "en" },
  { daysAgo: 1, paper: "MAINS_GS2", qIndex: 1, fraction: 0.8, language: "hi" },
  { daysAgo: 0, paper: "MAINS_GS1", qIndex: 1, fraction: 0.85, language: "en" },
];

const JUSTIFICATIONS_EN: Partial<Record<RubricDimensionKey, string>> = {
  structure_flow: "Clear intro-body-conclusion structure with logical progression between paragraphs.",
  content_coverage: "Addresses most facets of the question; a couple of dimensions could be developed further.",
  keywords_concepts: "Uses relevant constitutional/administrative terminology accurately in most places.",
  examples_data: "Backed by a few concrete examples and schemes, though more recent data would strengthen it.",
  presentation: "Readable paragraphing; a sub-heading or two would make the key points easier to locate.",
  word_limit_language: "Stays close to the word limit with clear, largely grammatical language.",
};
const JUSTIFICATIONS_HI: Partial<Record<RubricDimensionKey, string>> = {
  structure_flow: "स्पष्ट प्रस्तावना-मुख्य भाग-निष्कर्ष संरचना, अनुच्छेदों के बीच तार्किक प्रवाह के साथ।",
  content_coverage: "प्रश्न के अधिकांश पहलुओं को संबोधित करता है; कुछ बिंदुओं को और विकसित किया जा सकता है।",
  keywords_concepts: "अधिकांश स्थानों पर प्रासंगिक संवैधानिक/प्रशासनिक शब्दावली का सटीक प्रयोग।",
  examples_data: "कुछ ठोस उदाहरणों और योजनाओं से समर्थित, हालाँकि हाल के आंकड़े इसे और सुदृढ़ करेंगे।",
  presentation: "सुपाठ्य अनुच्छेद-विभाजन; एक-दो उप-शीर्षक मुख्य बिंदुओं को खोजना आसान बना देंगे।",
  word_limit_language: "शब्द-सीमा के करीब, स्पष्ट एवं अधिकांशतः व्याकरणिक रूप से सही भाषा में लिखा गया।",
};

const SAMPLE_STRENGTHS_EN =
  "The answer follows a clear structural arc and grounds most claims in relevant institutional detail. The concluding paragraph offers a genuinely forward-looking recommendation rather than a restatement of the introduction.";
const SAMPLE_IMPROVEMENTS_EN =
  "A specific constitutional article or a named committee/commission report would strengthen the substantiation dimension. Consider a short sub-heading before the concluding paragraph, and trim the second paragraph slightly to stay comfortably within the word limit.";
const SAMPLE_STRENGTHS_HI =
  "उत्तर एक स्पष्ट संरचना में लिखा गया है और अधिकांश तथ्यों को प्रासंगिक संस्थागत विवरण से जोड़ा गया है। निष्कर्ष अनुच्छेद प्रस्तावना की पुनरावृत्ति न होकर एक सार्थक आगे की दिशा प्रस्तुत करता है।";
const SAMPLE_IMPROVEMENTS_HI =
  "किसी विशिष्ट संवैधानिक अनुच्छेद या आयोग की रिपोर्ट का उल्लेख उत्तर को और सुदृढ़ करेगा। निष्कर्ष से पहले एक संक्षिप्त उप-शीर्षक जोड़ने पर विचार करें, तथा दूसरे अनुच्छेद को थोड़ा संक्षिप्त कर शब्द-सीमा के भीतर रखें।";

const SAMPLE_REFERENCE_POINTS = [
  "Constitutional/legal basis and the relevant articles or acts",
  "The institutional/administrative mechanism responsible for implementation",
  "A UP-specific scheme, data point or case",
  "Key implementation challenges and a forward-looking solution",
];
const SAMPLE_MISSED_POINTS = [
  "A more recent (post-2023) data point or committee recommendation",
  "An explicit UP-specific example beyond a generic national one",
];
const SAMPLE_OVERALL_EN =
  "A solidly structured answer that covers the core demand of the question; strengthening substantiation with named provisions or recent data would move it into the top scoring band.";
const SAMPLE_OVERALL_HI =
  "एक अच्छी तरह संरचित उत्तर जो प्रश्न की मुख्य माँग को कवर करता है; नामित प्रावधानों या हाल के आंकड़ों से इसे और सुदृढ़ करने पर यह शीर्ष स्कोरिंग बैंड में पहुँच सकता है।";

function sampleAnswerEn(topic: string): string {
  return [
    `The question of ${topic.replace(/[.?]+$/, "").toLowerCase()} touches on several interlinked constitutional, economic and administrative themes central to India's — and Uttar Pradesh's — governance framework.`,
    "To begin with, the historical and constitutional basis of this issue traces back to the founding debates of the Constituent Assembly and has been shaped since by successive amendments, Supreme Court judgments, and Finance/Administrative Commission recommendations. Key institutional actors include the relevant central ministries, State-level departments in Uttar Pradesh, and, where applicable, statutory bodies set up to monitor implementation.",
    "On the ground, several government schemes and policy interventions illustrate both the promise and the limitations of the current approach — inadequate last-mile delivery, capacity constraints at the district level, and uneven inter-state performance remain persistent challenges, even as digitisation and targeted welfare transfers have improved outcomes in recent years.",
    "In conclusion, a durable solution requires strengthening institutional capacity, improving inter-departmental coordination, and ensuring that UP-specific realities are factored into national policy design, so that the benefits of reform reach the last citizen in the queue.",
  ].join("\n\n");
}

function sampleAnswerHi(topic: string): string {
  return [
    `${topic} भारत और विशेष रूप से उत्तर प्रदेश के शासन ढांचे से जुड़ा एक बहुआयामी विषय है, जिसका संवैधानिक, आर्थिक और प्रशासनिक — तीनों दृष्टिकोणों से महत्व है।`,
    "ऐतिहासिक रूप से देखें तो इस विषय की जड़ें संविधान सभा की बहसों में मिलती हैं, और समय-समय पर संवैधानिक संशोधनों, न्यायपालिका के निर्णयों तथा वित्त/प्रशासनिक आयोगों की सिफारिशों के माध्यम से इसे नया आकार मिला है। इसमें केंद्र सरकार के संबंधित मंत्रालय, उत्तर प्रदेश के राज्य स्तरीय विभाग, तथा प्रासंगिक सांविधिक निकाय शामिल हैं।",
    "व्यवहार में, कई सरकारी योजनाओं और नीतिगत हस्तक्षेपों ने वर्तमान दृष्टिकोण की संभावनाओं और सीमाओं — दोनों को उजागर किया है। अंतिम छोर तक क्रियान्वयन की कमी, जिला स्तर पर क्षमता की बाधाएँ, तथा राज्यों के बीच असमान प्रदर्शन आज भी बड़ी चुनौतियाँ बने हुए हैं, यद्यपि डिजिटलीकरण और लक्षित कल्याण हस्तांतरण से हाल के वर्षों में परिणामों में सुधार हुआ है।",
    "अंततः, एक स्थायी समाधान के लिए संस्थागत क्षमता को मजबूत करना, अंतर-विभागीय समन्वय में सुधार करना, तथा राष्ट्रीय नीति निर्माण में उत्तर प्रदेश की विशिष्ट परिस्थितियों को शामिल करना आवश्यक है, ताकि सुधारों का लाभ अंतिम नागरिक तक पहुँच सके।",
  ].join("\n\n");
}

function sampleModelAnswer(topic: string, wordLimit: number, language: Locale): string {
  return language === "hi"
    ? `"${topic}" पर एक आदर्श उत्तर मुख्य विषय को एक-दो पंक्तियों में परिभाषित करते हुए शुरू होगा, फिर मुख्य भाग को 3-4 स्पष्ट उप-शीर्षकों — संवैधानिक/विधिक आधार, संस्थागत तंत्र, उत्तर प्रदेश-विशिष्ट पहलू, तथा प्रमुख चुनौतियाँ — में व्यवस्थित करेगा, प्रत्येक बिंदु को किसी नामित प्रावधान, योजना या आंकड़े से पुष्ट करेगा, और अंत में एक समाधान-उन्मुख निष्कर्ष के साथ समाप्त होगा, जो ${wordLimit} शब्दों की सीमा के भीतर हो।`
    : `A model answer on "${topic}" would open by defining the core issue in one or two lines, then organise the body under 3-4 clearly sub-headed points — constitutional/legal basis, institutional mechanism, UP-specific dimension, and key challenges — each substantiated with a named provision, scheme or data point, before closing with a solution-oriented conclusion that stays within the ${wordLimit}-word limit.`;
}

interface EvalQuestionRow {
  id: string;
  marks: number | null;
  word_limit: number | null;
  stem_i18n: BilingualText;
}

async function fetchQuestions(paperCode: string, limit: number): Promise<EvalQuestionRow[]> {
  const { data, error } = await supabase()
    .from("questions")
    .select("id, marks, word_limit, stem_i18n")
    .eq("paper_code", paperCode)
    .eq("type", "descriptive")
    .eq("is_published", true)
    .order("id", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`fetch questions (${paperCode}) failed: ${error.message}`);
  return (data ?? []) as EvalQuestionRow[];
}

async function seedOneEvaluation(
  userId: string,
  question: EvalQuestionRow,
  daysAgo: number,
  fraction: number,
  language: Locale,
  rubricVersion: string,
): Promise<string> {
  const isEssay = rubricVersion === ESSAY_RUBRIC_VERSION;
  const wordLimit = question.word_limit ?? (isEssay ? ESSAY_WORD_LIMIT : 150);
  const maxScore = question.marks ?? (isEssay ? ESSAY_MAX_MARKS : 10);

  const dims = rubricDimensions(rubricVersion);
  const justifications = language === "hi" ? JUSTIFICATIONS_HI : JUSTIFICATIONS_EN;
  const dimensionScores: DimensionScore[] = dims.map((d) => ({
    key: d.key,
    label: d.label,
    weight: d.weight,
    score: clamp10(fraction * 10 + (Math.random() - 0.5) * 2.4),
    justification: justifications[d.key] ?? "",
  }));
  const overallScore = computeOverallScore(dimensionScores, maxScore);

  const createdAt = tsAt(daysAgo, randInt(8, 23), randInt(0, 59));
  const topic = question.stem_i18n?.en?.trim() || question.stem_i18n?.hi?.trim() || "this topic";
  const answerText = language === "hi" ? sampleAnswerHi(topic) : sampleAnswerEn(topic);

  const { data: submission, error: subErr } = await supabase()
    .from("answer_submissions")
    .insert({
      user_id: userId,
      question_id: question.id,
      mode: "typed",
      typed_text: answerText,
      status: "complete",
      language,
      meta: {},
      created_at: createdAt,
      updated_at: createdAt,
    })
    .select("id")
    .single();
  if (subErr) throw new Error(`submission insert failed: ${subErr.message}`);
  const submissionId = submission.id as string;

  const tokensUsed = randInt(3200, 7200);
  const costUsd = Math.round(((tokensUsed / 1_000_000) * 12) * 10000) / 10000;

  const { error: evalErr } = await supabase()
    .from("evaluations")
    .insert({
      submission_id: submissionId,
      model: MODELS.sonnet,
      rubric_version: rubricVersion,
      overall_score: overallScore,
      max_score: maxScore,
      dimension_scores: dimensionScores,
      strengths_i18n:
        language === "hi" ? { hi: SAMPLE_STRENGTHS_HI, en: "" } : { hi: "", en: SAMPLE_STRENGTHS_EN },
      improvements_i18n:
        language === "hi" ? { hi: SAMPLE_IMPROVEMENTS_HI, en: "" } : { hi: "", en: SAMPLE_IMPROVEMENTS_EN },
      model_answer_i18n:
        language === "hi"
          ? { hi: sampleModelAnswer(topic, wordLimit, "hi"), en: "" }
          : { hi: "", en: sampleModelAnswer(topic, wordLimit, "en") },
      raw_response: {
        analysis: {
          is_off_topic: false,
          reference_points: SAMPLE_REFERENCE_POINTS,
          missed_key_points: SAMPLE_MISSED_POINTS,
          factual_errors: [],
          overall_comment: language === "hi" ? SAMPLE_OVERALL_HI : SAMPLE_OVERALL_EN,
        },
        pass1_dimensions: {},
        word_count: Math.round(wordLimit * (0.85 + Math.random() * 0.25)),
        word_limit: wordLimit,
      },
      tokens_used: tokensUsed,
      cost_usd: costUsd,
      created_at: createdAt,
      updated_at: createdAt,
    });
  if (evalErr) throw new Error(`evaluation insert failed: ${evalErr.message}`);

  return submissionId;
}

async function seedAllEvaluations(userId: string): Promise<{ activeDates: Set<string>; submissionIds: string[] }> {
  const papers = [...new Set(EVAL_PLAN.map((e) => e.paper))];
  const pool = new Map<string, EvalQuestionRow[]>();
  for (const p of papers) pool.set(p, await fetchQuestions(p, 3));

  const activeDates = new Set<string>();
  const submissionIds: string[] = [];
  for (const item of EVAL_PLAN) {
    const qs = pool.get(item.paper) ?? [];
    const question = qs[item.qIndex] ?? qs[0];
    if (!question) {
      console.warn(`  ! no published descriptive question found for ${item.paper} — skipping this evaluation`);
      continue;
    }
    const rubricVersion = item.paper === ESSAY_PAPER_CODE ? ESSAY_RUBRIC_VERSION : RUBRIC_VERSION;
    const submissionId = await seedOneEvaluation(
      userId,
      question,
      item.daysAgo,
      item.fraction,
      item.language,
      rubricVersion,
    );
    activeDates.add(dateOffset(item.daysAgo));
    submissionIds.push(submissionId);
  }
  console.log(`  seeded ${submissionIds.length} answer-writing evaluations across ${papers.length} Mains papers`);
  return { activeDates, submissionIds };
}

// ---------------------------------------------------------------------------
// SRS base deck (nodes / questions / manual cards) + note reads
// ---------------------------------------------------------------------------
const MANUAL_CARDS: { front: BilingualText; back: BilingualText }[] = [
  {
    front: {
      en: "Which Article of the Constitution provides for the Right to Constitutional Remedies?",
      hi: "संविधान का कौन सा अनुच्छेद संवैधानिक उपचारों के अधिकार का प्रावधान करता है?",
    },
    back: {
      en: "Article 32 — allows a citizen to move the Supreme Court directly for enforcement of Fundamental Rights; Dr. Ambedkar called it the 'heart and soul' of the Constitution.",
      hi: "अनुच्छेद 32 — नागरिक को मौलिक अधिकारों के प्रवर्तन हेतु सीधे उच्चतम न्यायालय जाने की अनुमति देता है; डॉ. अंबेडकर ने इसे संविधान की 'आत्मा और हृदय' कहा।",
    },
  },
  {
    front: {
      en: "UPPSC Prelims negative marking for a wrong MCQ answer?",
      hi: "यूपीपीएससी प्रारंभिक में गलत एमसीक्यू उत्तर के लिए नकारात्मक अंकन?",
    },
    back: {
      en: "One-third (0.33) of the marks allotted to that question is deducted for a wrong answer.",
      hi: "गलत उत्तर के लिए उस प्रश्न को आवंटित अंकों का एक-तिहाई (0.33) काटा जाता है।",
    },
  },
  {
    front: { en: "UPPSC Prelims 2026 exam date?", hi: "यूपीपीएससी प्रारंभिक 2026 परीक्षा तिथि?" },
    back: {
      en: "6 December 2026, per the official UPPSC exam calendar.",
      hi: "आधिकारिक यूपीपीएससी परीक्षा कैलेंडर के अनुसार 6 दिसंबर 2026।",
    },
  },
];

async function seedSrsBaseDeck(userId: string): Promise<void> {
  const { data: nodes, error: nodeErr } = await supabase()
    .from("syllabus_nodes")
    .select("id")
    .eq("paper_code", "PRE_GS1")
    .eq("depth", 1)
    .limit(4);
  if (nodeErr) throw new Error(`syllabus node fetch failed: ${nodeErr.message}`);
  const nodePicks = (nodes ?? []).slice(0, 2) as { id: string }[];
  for (const n of nodePicks) await addNodeToRevision(userId, n.id);

  const { data: qs, error: qErr } = await supabase()
    .from("questions")
    .select("id")
    .eq("paper_code", "PRE_GS1")
    .eq("type", "mcq")
    .eq("is_published", true)
    .limit(6);
  if (qErr) throw new Error(`question fetch failed: ${qErr.message}`);
  const questionPicks = (qs ?? []).slice(0, 3) as { id: string }[];
  for (const q of questionPicks) await addQuestionToRevision(userId, q.id);

  for (const card of MANUAL_CARDS) await createManualCard(userId, card.front, card.back);

  console.log(
    `  base SRS deck: +${nodePicks.length} topic card(s), +${questionPicks.length} question card(s), +${MANUAL_CARDS.length} manual card(s)`,
  );
}

async function seedNoteReads(userId: string): Promise<void> {
  const { data: notes, error } = await supabase()
    .from("notes")
    .select("id, syllabus_node_id")
    .eq("status", "published")
    .limit(4);
  if (error) throw new Error(`notes fetch failed: ${error.message}`);
  const picks = (notes ?? []).slice(0, 3) as { id: string; syllabus_node_id: string }[];
  const daysAgoList = [14, 12, 9];

  const rows = picks.map((n, i) => ({
    user_id: userId,
    name: "note_read",
    props: { note_id: n.id, syllabus_node_id: n.syllabus_node_id },
    created_at: tsAt(daysAgoList[i] ?? 5, randInt(18, 22), randInt(0, 59)),
  }));
  if (rows.length > 0) {
    const { error: insErr } = await supabase().from("events").insert(rows);
    if (insErr) throw new Error(`note_read event insert failed: ${insErr.message}`);
  }
  console.log(`  ${rows.length} note_read event(s) recorded`);
}

// ---------------------------------------------------------------------------
// SRS review history — real ts-fsrs scheduling (lib/fsrs.ts's reviewCard),
// replayed at historical timestamps so the deck ends up with a genuine
// New/Learning/Review spread instead of a uniform "just added" state.
// ---------------------------------------------------------------------------
async function seedSrsReviewHistory(userId: string, daysAgoList: number[]): Promise<Set<string>> {
  const { data: cards, error } = await supabase()
    .from("srs_cards")
    .select("id, fsrs_state")
    .eq("user_id", userId);
  if (error) throw new Error(`srs card fetch failed: ${error.message}`);
  const deck = (cards ?? []) as { id: string; fsrs_state: FsrsStateJson }[];
  const activeDates = new Set<string>();
  if (deck.length === 0) return activeDates;

  const stateById = new Map<string, FsrsStateJson>(deck.map((c) => [c.id, c.fsrs_state]));
  const touched = new Set<string>();
  const batchSize = Math.min(10, deck.length);
  const reviewRows: {
    card_id: string;
    user_id: string;
    rating: number;
    reviewed_at: string;
    elapsed_days: number;
    scheduled_days: number;
  }[] = [];

  for (const daysAgo of daysAgoList) {
    const ids = shuffle(deck.map((c) => c.id)).slice(0, batchSize);
    const reviewedAt = tsAt(daysAgo, randInt(19, 23), randInt(0, 59));
    for (const cardId of ids) {
      const rating = weightedRating();
      const current = stateById.get(cardId) ?? null;
      const { state, elapsed_days, scheduled_days } = reviewCard(current, rating, new Date(reviewedAt));
      stateById.set(cardId, state);
      touched.add(cardId);
      reviewRows.push({
        card_id: cardId,
        user_id: userId,
        rating,
        reviewed_at: reviewedAt,
        elapsed_days,
        scheduled_days,
      });
    }
    activeDates.add(dateOffset(daysAgo));
  }

  for (let i = 0; i < reviewRows.length; i += 100) {
    const { error: insErr } = await supabase()
      .from("srs_reviews")
      .insert(reviewRows.slice(i, i + 100));
    if (insErr) throw new Error(`srs_reviews insert failed: ${insErr.message}`);
  }

  for (const cardId of touched) {
    const { error: updErr } = await supabase()
      .from("srs_cards")
      .update({ fsrs_state: stateById.get(cardId) })
      .eq("id", cardId);
    if (updErr) throw new Error(`srs_cards state update failed: ${updErr.message}`);
  }

  console.log(
    `  logged ${reviewRows.length} SRS reviews across ${daysAgoList.length} day(s) over a ${deck.length}-card deck (${touched.size} card(s) touched, rest stay New/due-now)`,
  );
  return activeDates;
}

// ---------------------------------------------------------------------------
// Community — one discussion thread + reply, plus one shared answer for peer
// review.
// ---------------------------------------------------------------------------
async function seedCommunity(userId: string, submissionIds: string[]): Promise<string | null> {
  const { data: nodes, error } = await supabase()
    .from("syllabus_nodes")
    .select("id, title_i18n")
    .eq("paper_code", "PRE_GS1")
    .eq("depth", 1)
    .limit(1);
  if (error) throw new Error(`syllabus node fetch failed: ${error.message}`);
  const node = (nodes ?? [])[0] as { id: string; title_i18n: BilingualText } | undefined;

  let dateStr: string | null = null;
  if (node) {
    const daysAgo = 5;
    const thread = await createThread(
      userId,
      "node",
      node.id,
      `Best way to structure Mains answers on ${node.title_i18n.en}?`,
      "Sharing my approach for structuring Mains answers on this topic — intro with a definition, 3-4 body points with UP-specific examples, and a forward-looking conclusion. What's worked for others preparing for UPPSC?",
    );
    const createdAt = tsAt(daysAgo, 19, 30);
    await supabase().from("discussion_threads").update({ created_at: createdAt }).eq("id", thread.id);
    await addPost(
      userId,
      thread.id,
      "Following up — also found that citing the relevant constitutional article by number earns extra credit with examiners.",
    );
    dateStr = dateOffset(daysAgo);
  }

  if (submissionIds.length > 0) {
    await shareAnswerForPeerReview(userId, submissionIds[submissionIds.length - 1]);
  }
  console.log(`  community: 1 discussion thread + reply${node ? "" : " (skipped — no PRE_GS1 section found)"}, 1 shared answer for peer review`);
  return dateStr;
}

// ---------------------------------------------------------------------------
// Notifications — a couple of historical (already actioned) rows for a
// "used" look, plus the real self-heal generator for today's live nudge(s).
// ---------------------------------------------------------------------------
async function seedNotifications(userId: string): Promise<void> {
  const rows = [
    {
      user_id: userId,
      type: "srs_due",
      status: "read",
      scheduled_for: tsAt(6, 7, 0),
      dedupe_key: `srs_due:${dateOffset(6)}`,
      title_i18n: { en: "Revision due", hi: "रिवीजन बकाया" },
      body_i18n: {
        en: "10 cards due for revision today.",
        hi: "आज 10 कार्ड रिवीजन के लिए बकाया हैं।",
      },
      link: "/revision",
    },
    {
      user_id: userId,
      type: "quiz_ready",
      status: "dismissed",
      scheduled_for: tsAt(3, 5, 0),
      dedupe_key: `quiz_ready:${dateOffset(3)}`,
      title_i18n: { en: "Today's quiz is ready", hi: "आज की क्विज़ तैयार है" },
      body_i18n: {
        en: "A fresh daily quiz is waiting — keep your streak going.",
        hi: "एक नई डेली क्विज़ तैयार है — अपनी स्ट्रीक जारी रखें।",
      },
      link: "/practice",
    },
  ];
  const { error } = await supabase().from("notification_schedule").insert(rows);
  if (error) throw new Error(`notification seed failed: ${error.message}`);

  await generateNotifications(userId);
  console.log(`  seeded ${rows.length} historical notification(s) + ran the real self-heal generator for today`);
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
async function printSummary(userId: string, email: string, password: string): Promise<void> {
  const db = supabase();
  const tables: [string, string][] = [
    ["attempts", "user_id"],
    ["answer_submissions", "user_id"],
    ["srs_cards", "user_id"],
    ["srs_reviews", "user_id"],
    ["milestones", "user_id"],
    ["notification_schedule", "user_id"],
    ["discussion_threads", "user_id"],
    ["discussion_posts", "user_id"],
    ["shared_answers", "user_id"],
    ["node_mastery", "user_id"],
    ["events", "user_id"],
  ];
  const counts: Record<string, number> = {};
  for (const [table, col] of tables) {
    const { count } = await db.from(table).select("id", { count: "exact", head: true }).eq(col, userId);
    counts[table] = count ?? 0;
  }
  const { data: profile } = await db
    .from("users_profile")
    .select("streak_count, last_active_date, plan, streak_freezes")
    .eq("id", userId)
    .single();

  console.log("\n=== Demo account seeded ===\n");
  console.log(`  Email:    ${email}`);
  console.log(`  Password: ${password}`);
  console.log(
    `  Plan:     ${profile?.plan} · Streak: ${profile?.streak_count} day(s) (last active ${profile?.last_active_date}, ${profile?.streak_freezes} freeze(s) banked)\n`,
  );
  console.log("  Seeded:");
  console.log(`   - ${counts.attempts} MCQ test attempts (sectional PYQ papers + mock tests)`);
  console.log(`   - ${counts.answer_submissions} answer-writing submissions + evaluations`);
  console.log(`   - ${counts.srs_cards} SRS cards, ${counts.srs_reviews} logged FSRS reviews`);
  console.log(`   - ${counts.node_mastery} syllabus nodes with computed mastery`);
  console.log(`   - ${counts.milestones} milestones earned`);
  console.log(`   - ${counts.notification_schedule} notifications`);
  console.log(
    `   - ${counts.discussion_threads} discussion thread(s), ${counts.discussion_posts} post(s), ${counts.shared_answers} shared answer(s) for peer review`,
  );
  console.log(`   - ${counts.events} tracked events (note reads, etc.)`);
  console.log("\n  Sign in at /en or /hi with the email + password above.\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  console.log(`\n=== demo:seed — ${args.email}${args.reset ? " (--reset)" : ""} ===\n`);

  const userId = await resolveOrCreateUser(args.email, DEMO_PASSWORD, args.reset);
  console.log(`Using auth user ${userId}\n`);

  console.log("[1/9] Profile + onboarding...");
  await setupProfile(userId);

  console.log("[2/9] MCQ test attempts...");
  const attemptDates = await seedAllAttempts(userId);

  console.log("[3/9] Answer-writing evaluations...");
  const { activeDates: evalDates, submissionIds } = await seedAllEvaluations(userId);

  console.log("[4/9] Note reads + SRS base deck...");
  await seedNoteReads(userId);
  await seedSrsBaseDeck(userId);
  const wrong = await seedWrongAnswers(userId, 10);
  console.log(`  wrong-answer SRS cards: +${wrong.added} (${wrong.already} already existed)`);
  const noteFacts = await seedNoteFacts(userId, 3);
  console.log(`  note-fact SRS cards: +${noteFacts.added} (${noteFacts.already} already existed)`);

  console.log("[5/9] SRS review history (real FSRS scheduling)...");
  const streakDaysAgo = Array.from({ length: 15 }, (_, i) => 14 - i); // 14..0, oldest first
  const srsDates = await seedSrsReviewHistory(userId, streakDaysAgo);

  console.log("[6/9] Community — discussion thread + peer review...");
  const communityDate = await seedCommunity(userId, submissionIds);

  console.log("[7/9] Mastery recompute...");
  const masteryCount = await recomputeMastery(userId);
  console.log(`  mastery computed for ${masteryCount} syllabus node(s)`);

  console.log("[8/9] Streak (replaying the real nightly logic day by day)...");
  const allActiveDates = [...new Set([...attemptDates, ...evalDates, ...srsDates, communityDate].filter((d): d is string => !!d))].sort();
  let lastState;
  for (const d of allActiveDates) lastState = await refreshStreak(userId, d);
  console.log(`  final streak: ${lastState?.streak_count} day(s), last active ${lastState?.last_active_date}`);

  console.log("[9/9] Milestones + notifications...");
  await evaluateMilestones(userId);
  await seedNotifications(userId);

  // Give the fire-and-forget community moderation calls a moment to settle
  // before the process exits.
  await new Promise((resolve) => setTimeout(resolve, 1500));

  await printSummary(userId, args.email, DEMO_PASSWORD);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\ndemo:seed failed:", err instanceof Error ? err.stack ?? err.message : err);
    process.exit(1);
  });
