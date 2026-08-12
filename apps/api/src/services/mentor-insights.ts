/**
 * Feature 5 — proactive mentor insights.
 *
 * The mentor never messages first; instead a nightly (and on-load self-healing)
 * job derives actionable nudge cards from the learner's own data and writes them
 * to `mentor_insights`, idempotent per (user, dedupe_key). The dashboard renders
 * at most ONE undismissed card. Everything is templated from real signals — no
 * LLM call, so it's free and never hallucinates.
 *
 * There is a catalogue of tip KINDS (weak section, revision backlog, streak
 * rescue, today's study-plan day, fresh current affairs on a weak section,
 * answer-writing weaknesses, rewrite gains, exam pacing). Which one a learner
 * sees is decided by a contextual priority — the IST hour, distance to the exam,
 * and the size of the signal itself — never by insertion order, and never at
 * random. Dismissing the top card reveals the next-most-relevant one.
 */
import type {
  BilingualText,
  DrillRecommendation,
  ImprovementProofItem,
  LearnerProfile,
  MentorInsight,
  StudyPlan,
} from "@neev/shared";
import { supabase } from "../lib/supabase.js";
import { HttpError, notFound } from "../lib/http-error.js";
import { logger } from "../lib/logger.js";
import { IST_OFFSET_MS, istToday, shiftDate } from "../lib/ist.js";
import { getUserExam } from "../lib/exams.js";
import { resolveSubtreeNodeIds } from "../lib/syllabus-subtree.js";
import { getLearnerProfile } from "./learner-profile.js";
import { getRecommendation } from "./micro-drills.js";
import { getImprovementProof } from "./profile-analytics.js";
import { countSrsDue, getDailyProgress, hadActivity, SRS_ACTIVITY_THRESHOLD } from "./daily-progress.js";
import { getActivePlan } from "./study-plan.js";
import { isNudgeAcknowledged, streakRiskDedupeKey } from "./notifications.js";

/** A meaningfully positive average rewrite-improvement bar — matches this file's
 * own `delta > 3` percentage-point bar for calling an evaluation trend "up",
 * just set a bit higher since this is a headline stat, not a soft trend read. */
const REWRITE_IMPROVEMENT_MIN_PCT = 5;

/**
 * IST hour from which a still-blank day counts as "streak at risk". Matches
 * `services/notifications.ts`'s own `TIMES.streak_at_risk` (20:00) on purpose —
 * the bell and the mentor card must not disagree about when the day is late.
 */
const STREAK_RISK_HOUR_IST = 20;

/** Only current affairs this fresh are worth interrupting a study session for. */
const CA_RECENT_DAYS = 7;
/** …and within this window it's genuinely "today's news", which ranks higher. */
const CA_HOT_DAYS = 3;

/** Inside this many days to Prelims, recall/revision outranks Mains writing. */
const PRELIMS_ENDGAME_DAYS = 30;
/** Inside this many days, a weak section is a revision emergency, not a project. */
const PRELIMS_REVISION_DAYS = 60;

/** A backlog worth its own card is at least one study day's worth of reviews. */
const SRS_BACKLOG_MIN = SRS_ACTIVITY_THRESHOLD;
/** Beyond this the backlog is the day's headline problem, not a footnote. */
const SRS_BACKLOG_LARGE = 30;

/**
 * Rows fetched before the contextual sort, and rows returned after it. The fetch
 * limit is deliberately generous: the DB can only order by `created_at`, and
 * every one of a day's candidates is written in ONE upsert (so they share a
 * timestamp and their DB order is arbitrary). Truncating at the database would
 * therefore drop tips at random — possibly the most relevant one — so the whole
 * undismissed set is read and ranked here instead.
 */
const INSIGHT_FETCH_LIMIT = 25;
const INSIGHT_RETURN_LIMIT = 6;

const DRILL_TYPE_LABELS: Record<"intro" | "conclusion", BilingualText> = {
  intro: { en: "introduction", hi: "परिचय" },
  conclusion: { en: "conclusion", hi: "निष्कर्ष" },
};

const DIMENSION_LABELS: Record<string, BilingualText> = {
  structure_flow: { en: "structure & flow", hi: "संरचना और प्रवाह" },
  content_coverage: { en: "content coverage", hi: "विषयवस्तु कवरेज" },
  keywords_concepts: { en: "keywords & concepts", hi: "कीवर्ड और अवधारणाएँ" },
  examples_data: { en: "examples & data", hi: "उदाहरण और आंकड़े" },
  presentation: { en: "presentation", hi: "प्रस्तुति" },
  word_limit_language: { en: "word limit & language", hi: "शब्द-सीमा और भाषा" },
};

export interface Candidate {
  kind: string;
  dedupe_key: string;
  insight_i18n: BilingualText;
  cta_link: string | null;
  /**
   * How much this tip matters RIGHT NOW, 0-100. The dashboard shows exactly one
   * card, so this — not insertion order, and not `created_at` — is what decides
   * which. Every score is a base for the tip's kind plus modifiers read off the
   * three things that actually change what a candidate should be doing: the IST
   * hour, how close the exam is, and the size of the signal itself.
   */
  priority: number;
}

/** A freshly-published current-affairs item mapped into a weak section's subtree. */
interface WeakNodeCa {
  id: string;
  date: string;
  title_i18n: BilingualText;
  section_title_i18n: BilingualText;
}

/** Everything the catalogue below reads. Any field may be null — each signal is
 * loaded best-effort, and a tip whose signal failed to load is simply not a
 * candidate rather than an error on the dashboard's hottest card. */
export interface TipContext {
  profile: LearnerProfile;
  today: string;
  /** IST wall-clock hour, 0-23 — the time-of-day input to the ranking. */
  hourIst: number;
  /** SRS cards due right now; null when the count couldn't be loaded. */
  srsDue: number | null;
  /**
   * True when the day has NO qualifying study activity yet, by the streak
   * engine's own `hadActivity` rule. Null when not evaluated — it is only
   * computed late in the day, when a streak can actually break, because
   * deriving it costs a full `getDailyProgress`.
   */
  dayIsBlank: boolean | null;
  /**
   * True once the user has read or dismissed the bell's own streak nudge for
   * today. The two surfaces say the same thing, so they run as an ESCALATION
   * rather than a pair: the bell (which also drives web push, and so reaches
   * someone who isn't in the app) goes first, and this card only takes over if
   * they acknowledged it and STILL haven't studied. Null when not evaluated.
   */
  streakNudgeAcknowledged: boolean | null;
  plan: StudyPlan | null;
  weakNodeCa: WeakNodeCa | null;
  drillRecommendation: DrillRecommendation | null;
  improvementProof: { items: ImprovementProofItem[]; avg_delta_pct: number | null } | null;
}

/**
 * The weakest section that clears the evidence bar — scanned for, rather than
 * taken as `weak_nodes[0]`, because the very weakest may rest on too few
 * answers to nudge on honestly.
 *
 * ONE definition, used by both the `weak_node` tip and the CA tip that hangs
 * off the same section, so the card can never name one section while its
 * companion links current affairs for another.
 */
function pickWeakNode(profile: LearnerProfile): LearnerProfile["weak_nodes"][number] | undefined {
  return profile.weak_nodes.find((n) => n.accuracy_pct < 55 && n.answered_count >= 4);
}

/**
 * Pure: context in, ranked candidates out. No DB, no clock, no model — every
 * time-dependent input arrives on `ctx`, which is what makes the contextual
 * ranking testable (`pnpm --filter api test:tips`).
 */
export function buildCandidates(ctx: TipContext): Candidate[] {
  const { profile, today, hourIst, srsDue, dayIsBlank, streakNudgeAcknowledged, plan, weakNodeCa, drillRecommendation, improvementProof } = ctx;
  const out: Candidate[] = [];

  const daysToExam = profile.days_to_exam;
  const morning = hourIst >= 4 && hourIst < 12;
  const afternoonOrEvening = hourIst >= 12 && hourIst < 22;
  const lateNight = hourIst >= 22 || hourIst < 4;
  // Within the last month before Prelims, a Mains answer-writing nudge is the
  // wrong ask — the marginal hour belongs to recall and revision. These tips
  // aren't suppressed (the user may be writing Mains deliberately), just ranked
  // below the recall ones for that window.
  const endgame = daysToExam != null && daysToExam <= PRELIMS_ENDGAME_DAYS;

  // 1. Weakest section with enough evidence → a targeted drill.
  const weak = pickWeakNode(profile);
  if (weak) {
    out.push({
      kind: "weak_node",
      dedupe_key: `weak_node:${weak.node_id}:${today}`,
      insight_i18n: {
        en: `You're missing ${weak.title_i18n.en || weak.title_i18n.hi} questions (${weak.accuracy_pct}% of ${weak.answered_count} recently). Revise the topic and drill its PYQs.`,
        hi: `आप ${weak.title_i18n.hi || weak.title_i18n.en} के प्रश्नों में चूक रहे हैं (हाल ही में ${weak.answered_count} में से ${weak.accuracy_pct}%)। विषय दोहराएँ और इसके PYQ हल करें।`,
      },
      // Link to the section's Learn page (notes / PYQs / CA tabs) — PYQs attach
      // to leaf nodes, so a /practice?node=<section> filter would be empty. This
      // matches the dashboard weakness-card convention.
      cta_link: `/learn/${weak.paper_code}/${weak.node_id}`,
      // The strongest all-day tip: it names a measured deficit, and closing it
      // is worth more the closer the exam gets.
      priority: 80 + (daysToExam != null && daysToExam <= PRELIMS_REVISION_DAYS ? 10 : 0),
    });
  }

  // 2. Weakest answer-writing dimension — OR, when a specific micro-drill is
  // ready to recommend for that exact weakness (structure_flow), surface the
  // more actionable drill nudge instead. These two overlap whenever the
  // weakest dimension is structure_flow, so they're mutually exclusive for
  // that day: drill_ready wins when it's ready, eval_dimension is the
  // fallback (both when the weakest dimension isn't structure_flow at all,
  // and when it is but drill data isn't ready yet).
  const dim = profile.evaluation.weakest_dimension;
  const drillReady = drillRecommendation?.has_enough_data && drillRecommendation.recommended_type;
  if (drillReady) {
    const drillType = drillRecommendation!.recommended_type as "intro" | "conclusion";
    const label = DRILL_TYPE_LABELS[drillType];
    out.push({
      kind: "drill_ready",
      dedupe_key: `drill_ready:${today}`,
      insight_i18n: {
        en: `Your answers keep losing marks on structure & flow. A quick ${label.en} drill (80 words, 2 minutes) is the fastest way to fix it — try one now.`,
        hi: `आपके उत्तर संरचना और प्रवाह में अंक गँवा रहे हैं। एक छोटा ${label.hi} अभ्यास (80 शब्द, 2 मिनट) इसे सुधारने का सबसे तेज़ तरीका है — अभी एक आज़माएँ।`,
      },
      cta_link: `/profile`,
      priority: 75 + (afternoonOrEvening ? 6 : 0) - (endgame ? 25 : 0),
    });
  } else if (profile.evaluation.count >= 2 && dim && DIMENSION_LABELS[dim]) {
    const label = DIMENSION_LABELS[dim];
    out.push({
      kind: "eval_dimension",
      dedupe_key: `eval_dim:${dim}:${today}`,
      insight_i18n: {
        en: `Your answers keep losing marks on ${label.en}. Write one answer today with that in focus.`,
        hi: `आपके उत्तर ${label.hi} में अंक गँवा रहे हैं। आज एक उत्तर उसी पर ध्यान देकर लिखें।`,
      },
      cta_link: `/answers`,
      priority: 58 + (afternoonOrEvening ? 6 : 0) - (endgame ? 25 : 0),
    });
  }

  // 3. Real, meaningful average score gain across the user's own rewritten
  // answers (same question, later attempt) — a concrete, motivating number
  // rather than a generic nudge.
  if (
    improvementProof &&
    improvementProof.avg_delta_pct != null &&
    improvementProof.avg_delta_pct >= REWRITE_IMPROVEMENT_MIN_PCT &&
    improvementProof.items.length > 0
  ) {
    const deltaStr = `${improvementProof.avg_delta_pct > 0 ? "+" : ""}${improvementProof.avg_delta_pct}%`;
    out.push({
      kind: "rewrite_improvement",
      dedupe_key: `rewrite_improvement:${today}`,
      insight_i18n: {
        en: `When you rewrite an answer, you gain ${deltaStr} on average. Pick an old weak answer and try it again.`,
        hi: `जब आप किसी उत्तर को फिर से लिखते हैं, तो औसतन ${deltaStr} अंक बढ़ते हैं। कोई पुराना कमज़ोर उत्तर चुनें और उसे दोबारा लिखें।`,
      },
      cta_link: `/profile`,
      // Encouragement, not a correction — it should never outrank something the
      // user has to act on today.
      priority: 48 - (endgame ? 20 : 0),
    });
  }

  // 4. Streak about to break. The one genuinely time-of-day-gated tip: it is
  // meaningless at 9 AM (the day has barely started) and the most urgent thing
  // on the dashboard at 9 PM. Only fires for a streak that actually exists —
  // there is nothing to rescue at 0, and inventing urgency would be dishonest.
  // The bell carries this first (and pushes it to a device); this card is the
  // escalation for someone who acknowledged that and still hasn't studied, so
  // the two never say the same thing at the same time.
  if (
    dayIsBlank === true &&
    streakNudgeAcknowledged === true &&
    profile.streak_count >= 1 &&
    hourIst >= STREAK_RISK_HOUR_IST
  ) {
    out.push({
      kind: "streak_risk",
      dedupe_key: `streak_risk:${today}`,
      insight_i18n: {
        en: `Your ${profile.streak_count}-day streak has nothing logged against it today. One quiz, one answer, or ${SRS_ACTIVITY_THRESHOLD} revisions keeps it alive.`,
        hi: `आज आपकी ${profile.streak_count} दिन की स्ट्रीक के लिए कुछ भी दर्ज नहीं हुआ है। एक क्विज़, एक उत्तर, या ${SRS_ACTIVITY_THRESHOLD} रिवीजन इसे बचा लेंगे।`,
      },
      // NOT /dashboard: this card is only ever rendered ON the dashboard, so
      // linking there is a button that goes nowhere. A quiz is the fastest of
      // the three qualifying actions the copy names.
      cta_link: `/practice`,
      priority: 95,
    });
  }

  // 5. Revision backlog. Real due-card count from the same day-progress source
  // the Today checklist and the streak engine read, so the three never disagree.
  if (srsDue != null && srsDue >= SRS_BACKLOG_MIN) {
    out.push({
      kind: "srs_backlog",
      dedupe_key: `srs_backlog:${today}`,
      insight_i18n: {
        en: `${srsDue} revision cards are due. Clearing a due card is the cheapest recall you'll buy today.`,
        hi: `${srsDue} रिवीजन कार्ड बकाया हैं। बकाया कार्ड निपटाना आज की सबसे सस्ती दोहराई है।`,
      },
      cta_link: `/revision`,
      // A large backlog compounds daily, so it outranks most things; and
      // revision is a morning habit, so it climbs further before noon.
      priority: 70 + (srsDue >= SRS_BACKLOG_LARGE ? 12 : 0) + (morning ? 8 : 0),
    });
  }

  // 6. Today's own study-plan day, if the user has generated a plan and hasn't
  // finished it. Reads the persisted plan — never re-generates or invents one.
  const planDay = plan?.days.find((d) => d.date === today);
  const planRemaining = planDay ? planDay.tasks.filter((task) => !task.done).length : 0;
  if (planDay && planRemaining > 0) {
    const focus = planDay.focus_i18n;
    out.push({
      kind: "plan_today",
      dedupe_key: `plan_today:${today}`,
      insight_i18n: {
        en: focus.en
          ? `${planRemaining} of ${planDay.tasks.length} tasks left in today's plan — today's focus is ${focus.en}.`
          : `${planRemaining} of ${planDay.tasks.length} tasks left in today's study plan.`,
        hi: focus.hi
          ? `आज की योजना में ${planDay.tasks.length} में से ${planRemaining} काम बाकी हैं — आज का फोकस है ${focus.hi}।`
          : `आज की अध्ययन योजना में ${planDay.tasks.length} में से ${planRemaining} काम बाकी हैं।`,
      },
      // Deliberately NO cta_link. The plan lives on the dashboard, which is the
      // only page this card renders on — a button linking there would go
      // nowhere. The card renders fine without one (the CTA is conditional),
      // and the tip is informational: the plan itself is further down the page.
      cta_link: null,
      // Worth most when the day is still ahead of the user; pointless to open a
      // multi-task plan at midnight, so it drops out of contention late.
      priority: 72 + (morning ? 12 : 0) - (lateNight ? 30 : 0),
    });
  }

  // 7. Fresh current affairs that actually land on a section the user is weak
  // in — the one tip that connects two otherwise separate surfaces. Skipped
  // entirely unless a genuinely recent, published, exam-visible item exists.
  if (weakNodeCa) {
    const hot = weakNodeCa.date >= shiftDate(today, -CA_HOT_DAYS);
    const section = weakNodeCa.section_title_i18n;
    out.push({
      kind: "ca_weak_node",
      // Keyed by DAY, not by item id: `ca:run` publishes every 6h, so keying on
      // the item would mint a fresh card each time a newer item landed and the
      // learner could face three CA cards in one day. Every other tip is
      // one-per-day; this one now matches. The row stores the item it was built
      // from, so the link stays consistent with the text all day.
      dedupe_key: `ca_weak_node:${today}`,
      insight_i18n: {
        en: `New current affairs in ${section.en || section.hi}, one of your weaker sections: "${weakNodeCa.title_i18n.en || weakNodeCa.title_i18n.hi}".`,
        hi: `${section.hi || section.en} में नई करेंट अफेयर्स — यह आपके कमज़ोर खंडों में से एक है: "${weakNodeCa.title_i18n.hi || weakNodeCa.title_i18n.en}"।`,
      },
      cta_link: `/current-affairs?item=${weakNodeCa.id}`,
      priority: 52 + (hot ? 10 : 0),
    });
  }

  // 8. Exam proximity, tiered — the same countdown means a different instruction
  // at 5 days than at 80, so the copy and the rank both move with the bucket.
  if (daysToExam != null && daysToExam > 0 && daysToExam <= 90) {
    const tier =
      daysToExam <= 7
        ? {
            priority: 78,
            en: `Prelims is ${daysToExam} days away. Revision and full mocks only now — a new topic this late costs more than it returns.`,
            hi: `प्रीलिम्स में ${daysToExam} दिन बचे हैं। अब सिर्फ़ दोहराई और पूरे मॉक — इतनी देर से नया विषय शुरू करना नुक़सान का सौदा है।`,
          }
        : daysToExam <= PRELIMS_ENDGAME_DAYS
          ? {
              priority: 62,
              en: `Prelims is ${daysToExam} days away. A daily quiz plus your due revision cards is the highest-yield hour left in the day.`,
              hi: `प्रीलिम्स में ${daysToExam} दिन बचे हैं। रोज़ाना क्विज़ और बकाया रिवीजन कार्ड — दिन का सबसे फ़ायदेमंद घंटा यही है।`,
            }
          : {
              priority: 45,
              en: `Prelims is ${daysToExam} days away — a daily quiz keeps your recall sharp while you're still covering ground.`,
              hi: `प्रीलिम्स में ${daysToExam} दिन बचे हैं — सिलेबस पूरा करते हुए भी रोज़ाना क्विज़ आपकी स्मृति तेज़ रखती है।`,
            };
    out.push({
      kind: "exam_proximity",
      dedupe_key: `exam_close:${today}`,
      insight_i18n: { en: tier.en, hi: tier.hi },
      cta_link: `/practice`,
      priority: tier.priority,
    });
  }

  // 9. Nothing to personalise from yet. Every tip above is derived from the
  // user's own measured data, so a brand-new account qualifies for none of them
  // — and an empty mentor card is the worst first impression the feature can
  // make. This says the honest thing (there IS no read yet) and names the one
  // action that produces one. Ranked last so it can never mask a real signal.
  const noSignal =
    profile.weak_nodes.length === 0 &&
    profile.evaluation.count === 0 &&
    profile.activity_last_7d.answers_written +
      profile.activity_last_7d.mcqs_attempted +
      profile.activity_last_7d.srs_reviews ===
      0;
  if (noSignal) {
    out.push({
      kind: "get_started",
      dedupe_key: `get_started:${today}`,
      insight_i18n: {
        en: `Take today's quiz — it's what gives the mentor its first read on which sections are weak. Every tip after this one builds on it.`,
        hi: `आज की क्विज़ हल करें — इसी से मेंटर को पहली बार पता चलेगा कि कौन-से खंड कमज़ोर हैं। इसके बाद के सारे सुझाव इसी पर बनते हैं।`,
      },
      cta_link: `/practice`,
      priority: 20,
    });
  }

  return out;
}

/**
 * The freshest published current-affairs item mapped anywhere into the weakest
 * qualifying section's subtree.
 *
 * Filters mirror `getCurrentAffairsItemById` exactly — `status='published'` plus
 * an `exam_codes` overlap — because the tip's CTA opens that very endpoint. A
 * looser filter here would produce a card whose link 404s. Subtree rather than
 * the section id alone: weak nodes are depth-1 sections while CA triage maps to
 * depth 1-2, so an exact match would miss most real links.
 */
async function loadWeakNodeCa(
  userId: string,
  weakNode: LearnerProfile["weak_nodes"][number],
  today: string,
): Promise<WeakNodeCa | null> {
  const [examCode, subtreeIds] = await Promise.all([
    getUserExam(userId),
    resolveSubtreeNodeIds(weakNode.node_id),
  ]);
  if (subtreeIds.length === 0) return null;

  const { data, error } = await supabase()
    .from("current_affairs_items")
    .select("id, date, title_i18n")
    .eq("status", "published")
    .overlaps("exam_codes", [examCode])
    .overlaps("syllabus_node_ids", subtreeIds)
    .gte("date", shiftDate(today, -CA_RECENT_DAYS))
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new HttpError(500, `weak-node current affairs lookup failed: ${error.message}`);
  if (!data) return null;
  return {
    id: data.id as string,
    date: data.date as string,
    title_i18n: data.title_i18n as BilingualText,
    section_title_i18n: weakNode.title_i18n,
  };
}

/**
 * Load every signal the catalogue reads, concurrently and best-effort.
 *
 * COST NOTE: this runs on every `GET /mentor/insights`, i.e. every dashboard
 * load, so every branch is skipped when it provably cannot produce a candidate
 * — no evaluations → no drill/improvement tips; no weak node → no CA tip — and
 * every one degrades to null rather than throwing, so a single slow or failing
 * table can never take out the dashboard's mentor card.
 *
 * The one genuinely expensive signal is `hadActivity`, which needs a full
 * `getDailyProgress` (~10 counts plus the day's answer set) that the dashboard
 * summary is ALREADY paying for separately on the same page load. It is
 * therefore fetched only when the streak tip could actually fire — late in the
 * day, for a learner who has a streak to lose — which is a small slice of real
 * traffic. The rest of the day needs only the due-card count, so that comes
 * from the shared `countSrsDue` instead: one indexed count rather than ten.
 *
 * Note this does NOT introduce a second definition of "did anything happen
 * today". When the answer matters it still comes from `hadActivity`, the same
 * rule the streak engine and the Today checklist use; what's avoided is paying
 * for it at 9 AM, when no streak can break for another eleven hours.
 */
async function loadSignals(
  userId: string,
  profile: LearnerProfile,
  today: string,
  hourIst: number,
): Promise<Omit<TipContext, "profile" | "today" | "hourIst">> {
  const hasEvaluations = profile.evaluation.count > 0;
  const weakNode = pickWeakNode(profile);
  const streakCouldBreak = profile.streak_count >= 1 && hourIst >= STREAK_RISK_HOUR_IST;
  const warn = (what: string) => (err: unknown) => {
    logger.warn({ err }, `mentor-insights: ${what} load failed`);
    return null;
  };

  // Resolved once here rather than inside countSrsDue, so the due-card number
  // this tip promises is scoped to the SAME exam the revision session will
  // serve (0124). A mismatch is the Session-16 "N due -> empty session" bug.
  const examCode = await getUserExam(userId);
  const [srsDue, dayIsBlank, streakNudgeAcknowledged, plan, weakNodeCa, drillRecommendation, improvementProof] = await Promise.all([
    countSrsDue(userId, examCode).catch(warn("due-card count")),
    streakCouldBreak
      ? getDailyProgress(userId)
          .then((p) => !hadActivity(p))
          .catch(warn("daily progress"))
      : null,
    streakCouldBreak
      ? isNudgeAcknowledged(userId, streakRiskDedupeKey(today)).catch(warn("streak nudge status"))
      : null,
    getActivePlan(userId)
      .then((state) => state.plan)
      .catch(warn("study plan")),
    weakNode ? loadWeakNodeCa(userId, weakNode, today).catch(warn("weak-node current affairs")) : null,
    hasEvaluations ? getRecommendation(userId).catch(warn("drill recommendation")) : null,
    hasEvaluations ? getImprovementProof(userId).catch(warn("improvement proof")) : null,
  ]);

  return { srsDue, dayIsBlank, streakNudgeAcknowledged, plan, weakNodeCa, drillRecommendation, improvementProof };
}

/**
 * Generate today's insights idempotently. Safe to call repeatedly.
 *
 * Returns dedupe_key → priority for the candidates that qualify RIGHT NOW, so
 * `listInsights` can rank the stored rows by present relevance rather than by
 * the arbitrary order a single batched upsert happens to write them in.
 */
export async function generateMentorInsights(userId: string): Promise<Map<string, number>> {
  let profile;
  try {
    profile = await getLearnerProfile(userId);
  } catch (err) {
    logger.warn({ err }, "mentor-insights: profile load failed");
    return new Map();
  }

  const today = istToday();
  // IST wall-clock hour. Derived the same way as lib/ist.ts's own date helpers
  // (shift into IST, then read a UTC field) so the hour and the `today`
  // boundary can never disagree across midnight.
  const hourIst = new Date(Date.now() + IST_OFFSET_MS).getUTCHours();
  const signals = await loadSignals(userId, profile, today, hourIst);
  const candidates = buildCandidates({ profile, today, hourIst, ...signals });

  const priorityByKey = new Map(candidates.map((c) => [c.dedupe_key, c.priority]));
  if (candidates.length === 0) return priorityByKey;

  const rows = candidates.map((c) => ({
    user_id: userId,
    kind: c.kind,
    dedupe_key: c.dedupe_key,
    insight_i18n: c.insight_i18n,
    cta_link: c.cta_link,
    // Persisted for inspection only — ranking always uses the value recomputed
    // for the CURRENT request, since `ignoreDuplicates` means an existing row's
    // meta is never refreshed and would go stale within the day.
    meta: { priority: c.priority },
  }));
  // ignoreDuplicates so a re-run never resurfaces a dismissed card (unique on
  // (user_id, dedupe_key); a dismissed row keeps its key for the day).
  const { error } = await supabase()
    .from("mentor_insights")
    .upsert(rows, { onConflict: "user_id,dedupe_key", ignoreDuplicates: true });
  if (error) logger.warn({ err: error }, "mentor-insights: upsert failed");

  return priorityByKey;
}

interface InsightRow extends MentorInsight {
  dedupe_key: string;
}

/**
 * Undismissed insights, MOST RELEVANT FIRST — the dashboard renders [0].
 *
 * The database can only order by `created_at`, and a day's candidates are all
 * written in one upsert, so their stored order is arbitrary. Ranking therefore
 * happens here, against the priorities just computed for this request. Rows
 * whose dedupe_key is not among today's candidates (yesterday's undismissed
 * card, or a tip whose condition has since stopped holding) sort last, newest
 * first — still available, so dismissing every fresh tip reveals the next one
 * rather than an empty card, but never ahead of something true right now.
 */
export async function listInsights(userId: string, selfHeal = true): Promise<MentorInsight[]> {
  const priorityByKey = selfHeal ? await generateMentorInsights(userId) : new Map<string, number>();
  const { data, error } = await supabase()
    .from("mentor_insights")
    .select("id, kind, insight_i18n, cta_link, created_at, dedupe_key")
    .eq("user_id", userId)
    .eq("dismissed", false)
    .order("created_at", { ascending: false })
    .limit(INSIGHT_FETCH_LIMIT);
  if (error) throw new HttpError(500, `insights lookup failed: ${error.message}`);

  const rows = (data ?? []) as InsightRow[];
  rows.sort((a, b) => {
    const pa = priorityByKey.get(a.dedupe_key);
    const pb = priorityByKey.get(b.dedupe_key);
    if (pa != null && pb != null && pa !== pb) return pb - pa;
    if (pa != null && pb == null) return -1;
    if (pa == null && pb != null) return 1;
    const byRecency = Date.parse(b.created_at) - Date.parse(a.created_at);
    if (byRecency !== 0) return byRecency;
    // Two tips can legitimately tie on priority, and a day's candidates all
    // share one upsert timestamp — so without a stable final key the card would
    // pick a different one on each reload and visibly flicker. `id` is unique
    // and unchanging, which makes the choice arbitrary but CONSISTENT.
    return a.id.localeCompare(b.id);
  });

  return rows.slice(0, INSIGHT_RETURN_LIMIT).map(({ id, kind, insight_i18n, cta_link, created_at }) => ({
    id,
    kind,
    insight_i18n,
    cta_link,
    created_at,
  }));
}

export async function dismissInsight(userId: string, id: string): Promise<MentorInsight> {
  const { data, error } = await supabase()
    .from("mentor_insights")
    .update({ dismissed: true })
    .eq("id", id)
    .eq("user_id", userId)
    .select("id, kind, insight_i18n, cta_link, created_at")
    .maybeSingle();
  if (error) throw new HttpError(500, `insight dismiss failed: ${error.message}`);
  if (!data) throw notFound("Insight not found");
  return data as MentorInsight;
}
