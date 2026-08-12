/**
 * Unit tests for the proactive mentor-tip catalogue and its CONTEXTUAL ranking —
 *   pnpm --filter api test:tips
 *
 * `buildCandidates` is pure (context in, ranked candidates out: no DB, no clock,
 * no model), which is the whole reason the ranking is testable. These assertions
 * pin the behaviour the feature exists for: the tip the dashboard shows is
 * chosen from what is TRUE for this learner right now — time of day, distance to
 * the exam, the size of the signal — and never from insertion order.
 *
 * No env or network needed; exits non-zero on any failed assertion.
 */
import assert from "node:assert/strict";
import type { LearnerProfile, StudyPlan } from "@neev/shared";
import { buildCandidates, type TipContext } from "../src/services/mentor-insights.js";

let passed = 0;
function check(label: string, actual: unknown, expected: unknown): void {
  assert.deepEqual(actual, expected, `${label}: expected ${expected}, got ${actual}`);
  passed++;
}
function ok(label: string, cond: boolean): void {
  assert.ok(cond, label);
  passed++;
}

const TODAY = "2026-08-12";

/** A learner with a real, measured weak section and some answer-writing history. */
function profile(over: Partial<LearnerProfile> = {}): LearnerProfile {
  return {
    weak_nodes: [
      {
        node_id: "11111111-1111-4111-8111-111111111111",
        paper_code: "PRE_GS1",
        title_i18n: { en: "Indian Polity", hi: "भारतीय राजव्यवस्था" },
        accuracy_pct: 42,
        answered_count: 18,
      },
    ],
    strong_nodes: [],
    evaluation: {
      count: 6,
      recent_overall_pct: 55,
      trend: "flat",
      dimension_avgs: { content_coverage: 4 },
      weakest_dimension: "content_coverage",
    },
    streak_count: 12,
    days_to_exam: 120,
    recent_nodes: [],
    activity_last_7d: { answers_written: 3, mcqs_attempted: 40, srs_reviews: 25 },
    locale: "en",
    computed_at: new Date().toISOString(),
    ...over,
  };
}

function plan(remaining: number, total: number): StudyPlan {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    target_date: null, generated_by_model: "x", hours_per_day: 4,
    days: [
      {
        date: TODAY,
        day_label_i18n: { en: "Wednesday", hi: "बुधवार" },
        focus_i18n: { en: "Polity revision", hi: "राजव्यवस्था दोहराई" },
        tasks: Array.from({ length: total }, (_, i) => ({
          id: `task-${i}`,
          title_i18n: { en: `Task ${i}`, hi: `काम ${i}` },
          kind: "read" as const,
          duration_min: 30,
          done: i >= remaining,
        })),
      },
    ],
    created_at: TODAY, updated_at: TODAY,
  };
}

function ctx(over: Partial<TipContext> = {}): TipContext {
  return {
    profile: profile(),
    today: TODAY,
    hourIst: 10,
    srsDue: 0,
    // null = "not evaluated", which is what the loader really passes outside the
    // late-evening window where a streak can break.
    dayIsBlank: null,
    streakNudgeAcknowledged: null,
    plan: null,
    weakNodeCa: null,
    drillRecommendation: null,
    improvementProof: null,
    ...over,
  };
}

/** Kinds produced, ordered most-relevant-first (what the dashboard would pick). */
function ranked(c: TipContext): string[] {
  return buildCandidates(c)
    .sort((a, b) => b.priority - a.priority)
    .map((x) => x.kind);
}
const top = (c: TipContext) => ranked(c)[0];
const kinds = (c: TipContext) => new Set(buildCandidates(c).map((k) => k.kind));
const pr = (c: TipContext, kind: string) => buildCandidates(c).find((x) => x.kind === kind)!.priority;
const tip = (c: TipContext, kind: string) => buildCandidates(c).find((x) => x.kind === kind)!;

// --- TIME OF DAY changes the answer, on identical learner data ---------------
// The single strongest demonstration that picking is contextual: same learner,
// same day, same everything — only the clock moves.
check("10 AM on an untouched day → plan, not streak panic", top(ctx({ plan: plan(3, 5), hourIst: 10 })), "plan_today");
check(
  "9 PM on that same untouched day → streak rescue",
  top(ctx({ plan: plan(3, 5), hourIst: 21, dayIsBlank: true, streakNudgeAcknowledged: true })),
  "streak_risk",
);
// The hour gate is real, not just an artefact of the loader not computing it.
ok(
  "streak_risk cannot fire in the morning even on a blank day",
  !kinds(ctx({ hourIst: 10, dayIsBlank: true, streakNudgeAcknowledged: true })).has("streak_risk"),
);

// --- Bell first, card second: never both at once ----------------------------
// The bell nudge (which also pushes to a device) covers the streak first. Until
// the user acknowledges it, this card must stay quiet or the same sentence
// appears twice on one screen.
ok(
  "bell nudge still unread → no duplicate card",
  !kinds(ctx({ hourIst: 21, dayIsBlank: true, streakNudgeAcknowledged: false })).has("streak_risk"),
);
ok(
  "bell row not created yet (race) → still no card",
  !kinds(ctx({ hourIst: 21, dayIsBlank: true, streakNudgeAcknowledged: null })).has("streak_risk"),
);
ok(
  "acknowledged and STILL nothing studied → the card escalates",
  kinds(ctx({ hourIst: 21, dayIsBlank: true, streakNudgeAcknowledged: true })).has("streak_risk"),
);
// …and it must not fire when the day HAS been used, however late it is.
ok("9 PM but the day has activity → no streak_risk", !kinds(ctx({ hourIst: 21, dayIsBlank: false })).has("streak_risk"));
// …nor when activity is simply unknown (the loader skipped the expensive read).
ok("9 PM with activity unknown → no streak_risk", !kinds(ctx({ hourIst: 21, dayIsBlank: null })).has("streak_risk"));
// …nor for someone with no streak to lose (inventing urgency would be dishonest).
ok(
  "9 PM with a 0-day streak → no streak_risk",
  !kinds(ctx({ hourIst: 21, dayIsBlank: true, streakNudgeAcknowledged: true, profile: profile({ streak_count: 0 }) })).has("streak_risk"),
);

// --- SIGNAL SIZE moves rank -------------------------------------------------
const small = ctx({ hourIst: 14, srsDue: 12 });
const large = ctx({ hourIst: 14, srsDue: 60 });
ok("a bigger revision backlog outranks a smaller one", pr(large, "srs_backlog") > pr(small, "srs_backlog"));
ok("a backlog below one study day's worth isn't a card at all", !kinds(ctx({ srsDue: 4 })).has("srs_backlog"));
ok("an unknown backlog isn't a card either", !kinds(ctx({ srsDue: null })).has("srs_backlog"));
ok(
  "revision ranks higher in the morning than mid-afternoon",
  pr(ctx({ hourIst: 7, srsDue: 12 }), "srs_backlog") > pr(small, "srs_backlog"),
);

// --- DAYS TO EXAM re-orders the same candidates -----------------------------
// Far out, Mains answer-writing is a fine ask. Inside the last month, recall
// wins the marginal hour — same learner, same tips, different order.
const farOut = ctx({ hourIst: 14, profile: profile({ days_to_exam: 80 }) });
const endgame = ctx({ hourIst: 14, profile: profile({ days_to_exam: 10 }) });
ok("eval_dimension outranks exam_proximity 80 days out", pr(farOut, "eval_dimension") > pr(farOut, "exam_proximity"));
ok("…and is outranked by it inside the last month", pr(endgame, "exam_proximity") > pr(endgame, "eval_dimension"));
ok("the weak section outranks everything 10 days out", top(endgame) === "weak_node");

// Exam copy is tiered, not one sentence with a number swapped in.
const copyFor = (days: number) => tip(ctx({ profile: profile({ days_to_exam: days }) }), "exam_proximity");
ok("5 days out says revision-and-mocks-only", /mocks only/i.test(copyFor(5).insight_i18n.en));
ok("20 days out names the daily quiz + due cards", /daily quiz/i.test(copyFor(20).insight_i18n.en));
ok("all three tiers carry real Devanagari, not a fallback", [5, 20, 80].every((d) => /[ऀ-ॿ]/.test(copyFor(d).insight_i18n.hi)));
// …and the tiers must RANK differently, not just read differently — otherwise
// "5 days out" competes for the card on the same footing as "80 days out".
ok("urgency rises as the exam approaches", copyFor(5).priority > copyFor(20).priority && copyFor(20).priority > copyFor(80).priority);
ok("no exam tip beyond 90 days", !kinds(ctx({ profile: profile({ days_to_exam: 200 }) })).has("exam_proximity"));

// --- The CA tip links the item it names -------------------------------------
const withCa = ctx({
  weakNodeCa: {
    id: "33333333-3333-4333-8333-333333333333",
    date: TODAY,
    title_i18n: { en: "New Election Commission ruling", hi: "चुनाव आयोग का नया निर्णय" },
    section_title_i18n: { en: "Indian Polity", hi: "भारतीय राजव्यवस्था" },
  },
});
const caTip = tip(withCa, "ca_weak_node");
check("CA tip deep-links the exact item", caTip.cta_link, "/current-affairs?item=33333333-3333-4333-8333-333333333333");
ok("CA tip names the weak section it belongs to", caTip.insight_i18n.en.includes("Indian Polity"));
ok("no CA tip without a real recent item", !kinds(ctx()).has("ca_weak_node"));
// One CA card per day: keying on the item id would mint a fresh card every time
// `ca:run` published a newer one, so the key must NOT contain the item id.
check("CA tip is keyed by day, not by item", caTip.dedupe_key, `ca_weak_node:${TODAY}`);

// --- The plan tip reads the real plan, and steps aside at night -------------
const planTip = tip(ctx({ plan: plan(3, 5) }), "plan_today");
ok("plan tip reports real remaining/total", /3 of 5/.test(planTip.insight_i18n.en));
ok("plan tip names the day's own focus", planTip.insight_i18n.en.includes("Polity revision"));
ok("a finished plan produces no tip", !kinds(ctx({ plan: plan(0, 5) })).has("plan_today"));
ok("a plan for another day produces no tip", !kinds(ctx({ today: "2026-08-13", plan: plan(3, 5) })).has("plan_today"));
ok(
  "the plan tip drops down the order at midnight",
  pr(ctx({ hourIst: 23, plan: plan(3, 5) }), "plan_today") < pr(ctx({ hourIst: 10, plan: plan(3, 5) }), "plan_today"),
);

// --- No tip may link to the page it is rendered on --------------------------
// The card renders ONLY on the dashboard (routes/dashboard.tsx), so a
// `/dashboard` CTA is a button that goes nowhere.
const everyTip = buildCandidates(
  ctx({
    hourIst: 21,
    dayIsBlank: true,
    streakNudgeAcknowledged: true,
    srsDue: 40,
    plan: plan(2, 6),
    weakNodeCa: withCa.weakNodeCa,
    profile: profile({ days_to_exam: 45 }),
    improvementProof: { items: [{} as never], avg_delta_pct: 12 },
  }),
);
ok(`no tip links to /dashboard (${everyTip.length} tips checked)`, everyTip.every((c) => c.cta_link !== "/dashboard"));
check("the plan tip has no CTA at all, rather than a dead one", planTip.cta_link, null);
check("the streak rescue sends you somewhere you can act", tip(ctx({ hourIst: 21, dayIsBlank: true, streakNudgeAcknowledged: true }), "streak_risk").cta_link, "/practice");

// --- Never nothing: a brand-new account still gets an honest card -----------
const blank = ctx({
  profile: profile({
    weak_nodes: [],
    evaluation: { count: 0, recent_overall_pct: null, trend: "none", dimension_avgs: {}, weakest_dimension: null },
    streak_count: 0,
    days_to_exam: null,
    activity_last_7d: { answers_written: 0, mcqs_attempted: 0, srs_reviews: 0 },
  }),
});
check("a learner with no data still has exactly one tip", ranked(blank), ["get_started"]);
ok("…and it disappears the moment there IS a signal", !kinds(ctx()).has("get_started"));

// --- Dismissing the top tip must reveal a next one --------------------------
ok(`a real learner has several tips to fall through (${everyTip.length})`, everyTip.length >= 4);
const allKinds = everyTip.map((c) => c.kind);
ok("every tip kind in a run is distinct", new Set(allKinds).size === allKinds.length);

// --- Every candidate is well-formed ----------------------------------------
for (const c of everyTip) {
  ok(`${c.kind}: dedupe_key is day-scoped`, c.dedupe_key.includes(TODAY));
  ok(`${c.kind}: has both locales`, c.insight_i18n.en.length > 0 && c.insight_i18n.hi.length > 0);
  ok(`${c.kind}: Hindi is Devanagari, not an English fallback`, /[ऀ-ॿ]/.test(c.insight_i18n.hi));
  ok(`${c.kind}: priority is in range`, c.priority > 0 && c.priority <= 100);
  ok(`${c.kind}: links somewhere in-app`, c.cta_link === null || c.cta_link.startsWith("/"));
}

console.log(`✓ mentor tips: ${passed}/${passed} assertions passed`);
