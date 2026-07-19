/**
 * Entitlements — the ONE place that decides what a user's plan lets them do.
 *
 * Every metered / Pro-only endpoint (evaluation, daily-answer, OCR, mentor,
 * notes, mocks, micro-drills) consults this module rather than reimplementing a
 * limit. Durable counters come from the DB (actual usage rows) so they survive
 * a restart and can't be evaded — the in-memory user-keyed rate-limit store
 * (lib/rate-limit.ts) is the coarse burst limiter that sits in front; the hard
 * business caps (3-eval trial, 60/mo, 10/100 mentor/day) live here, DB-counted.
 *
 * Limits (the loss ceiling that keeps Pro profitable) are code constants; the
 * PRICE of a plan is data (the `plans` table). A 402 with an upgrade hint is the
 * signal the UI turns into a paywall at the exact moment a limit bites.
 */
import type { Entitlements, Quota, UserPlan } from "@neev/shared";
import { supabase } from "../lib/supabase.js";
import { HttpError } from "../lib/http-error.js";
import { istDayRangeUtc, istToday } from "../lib/ist.js";
import { loadNodeWeightage } from "../lib/weightage.js";
import { resolveSubtreeNodeIds } from "../lib/syllabus-subtree.js";
import { logger } from "../lib/logger.js";

// ---------------------------------------------------------------------------
// Limits (the loss ceiling — keep these firm).
// ---------------------------------------------------------------------------
export const LIMITS = {
  free: {
    /** Lifetime AI answer-evaluation trial. */
    evaluations: 3,
    /** Mentor messages per IST day. */
    mentorPerDay: 10,
    /** Published notes a Free user can fully read, per paper (by weightage). */
    freeNotesPerPaper: 5,
  },
  pro: {
    /** Fair-use cap per calendar month — also the loss ceiling. Keep it firm. */
    evaluations: 60,
    mentorPerDay: 100,
  },
  trial: {
    /**
     * The 7-day Pro trial gets full Pro FEATURES (OCR, mocks, drills, all notes)
     * but tighter DAILY caps on the two expensive AI surfaces — enough to feel
     * the product, not enough to burn a month of Pro cost in a week.
     */
    evaluationsPerDay: 2,
    mentorPerDay: 15,
  },
} as const;

/** A 402 the UI reads as "show the upgrade paywall for `feature`". */
export function paywall(feature: string, message: string): HttpError {
  return new HttpError(402, message, { feature });
}

// ---------------------------------------------------------------------------
// Plan resolution (with lazy downgrade of a lapsed Pro)
// ---------------------------------------------------------------------------
interface PlanRow {
  plan: UserPlan;
  plan_expires_at: string | null;
}

/**
 * The user's effective plan. If they're marked 'pro' but plan_expires_at has
 * passed, we treat them as free AND flip the row (best-effort) so the downgrade
 * is durable without a cron.
 */
export async function getPlanFor(userId: string): Promise<{ plan: UserPlan; expiresAt: string | null }> {
  const { data, error } = await supabase()
    .from("users_profile")
    .select("plan, plan_expires_at")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new HttpError(500, `plan lookup failed: ${error.message}`);
  const row = (data as PlanRow | null) ?? { plan: "free", plan_expires_at: null };

  if (row.plan === "pro" && row.plan_expires_at && new Date(row.plan_expires_at) <= new Date()) {
    // Lapsed — downgrade lazily.
    const { error: dErr } = await supabase()
      .from("users_profile")
      .update({ plan: "free" })
      .eq("id", userId)
      .eq("plan", "pro");
    if (dErr) logger.warn({ err: dErr, userId }, "lazy plan downgrade failed");
    return { plan: "free", expiresAt: row.plan_expires_at };
  }
  return { plan: row.plan, expiresAt: row.plan_expires_at };
}

// ---------------------------------------------------------------------------
// Trial detection — a trial user and a paid Pro user both have plan='pro'.
// ---------------------------------------------------------------------------
/** True iff the user has an ACTIVE (paid, webhook-created) subscription row. */
async function hasActiveSubscription(userId: string): Promise<boolean> {
  const { count, error } = await supabase()
    .from("subscriptions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("status", "active");
  if (error) throw new HttpError(500, `subscription check failed: ${error.message}`);
  return (count ?? 0) > 0;
}

export interface TrialContext {
  plan: UserPlan;
  expiresAt: string | null;
  /** On the 7-day Pro trial: plan='pro' + an expiry + NO active paid subscription. */
  isOnTrial: boolean;
}

/**
 * The user's plan plus whether their Pro is a trial vs a paid subscription. A
 * lapsed trial has already been downgraded to 'free' by getPlanFor (same lazy
 * path as a lapsed paid Pro), so it never resolves as a trial here. The
 * subscription check runs only when plan='pro' (short-circuited for free).
 */
export async function getTrialContext(userId: string): Promise<TrialContext> {
  const { plan, expiresAt } = await getPlanFor(userId);
  const isOnTrial = plan === "pro" && !!expiresAt && !(await hasActiveSubscription(userId));
  return { plan, expiresAt, isOnTrial };
}

// ---------------------------------------------------------------------------
// Evaluation credits
// ---------------------------------------------------------------------------
function monthStartUtc(): string {
  const [y, m] = istToday().split("-");
  return istDayRangeUtc(`${y}-${m}-01`).startUtc;
}

/**
 * Count answer evaluations "spent". A submission counts once it has ENTERED
 * evaluation, so the credit can't be refunded by abandoning it:
 *   - 'evaluating' / 'complete'                → in flight or done.
 *   - 'failed' WITH typed_text present         → it reached the model then failed
 *     or was released. This is the key anti-abuse case: a user who streams the
 *     full evaluation (strengths/improvements/model answer all arrive before the
 *     result is persisted) and then disconnects gets the submission flipped to
 *     'failed' (releaseStuckEvaluation) — without this clause they'd never spend
 *     a credit and could loop for unlimited free evaluations.
 * A 'failed' handwritten submission with NO typed_text failed at the OCR stage
 * (before any evaluation) and correctly does NOT consume an evaluation credit.
 * An abandoned draft ('pending'/'ocr_done') never counts. `since` bounds the
 * window: unset = lifetime (free floor), month start (paid Pro), or IST-day
 * start (trial's per-day cap).
 */
async function countEvaluations(userId: string, since?: string): Promise<number> {
  let q = supabase()
    .from("answer_submissions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .or("status.in.(evaluating,complete),and(status.eq.failed,typed_text.not.is.null)");
  if (since) q = q.gte("created_at", since);
  const { count, error } = await q;
  if (error) throw new HttpError(500, `evaluation count failed: ${error.message}`);
  return count ?? 0;
}

export async function getEvaluationQuota(
  userId: string,
): Promise<Quota & { plan: UserPlan; isOnTrial: boolean }> {
  const { plan, isOnTrial } = await getTrialContext(userId);
  let limit: number;
  let period: Quota["period"];
  let since: string | undefined;
  if (isOnTrial) {
    // Trial: a firm per-IST-day cap (not the paid monthly fair-use pool).
    limit = LIMITS.trial.evaluationsPerDay;
    period = "day";
    since = istDayRangeUtc(istToday()).startUtc;
  } else if (plan === "pro") {
    limit = LIMITS.pro.evaluations;
    period = "month";
    since = monthStartUtc();
  } else {
    limit = LIMITS.free.evaluations;
    period = "lifetime";
    since = undefined;
  }
  const used = await countEvaluations(userId, since);
  return { plan, isOnTrial, used, limit, remaining: Math.max(0, limit - used), period };
}

/** Throw a 402 paywall if the user has no evaluation credit left. */
export async function assertEvaluationCredit(userId: string): Promise<void> {
  const q = await getEvaluationQuota(userId);
  if (q.remaining <= 0) {
    let message: string;
    if (q.isOnTrial) {
      // Distinct from the free "upgrade" and the paid "next month" messages:
      // a trial user already HAS Pro features — theirs resets at midnight.
      message = `You've used both of today's trial evaluations. They reset at midnight IST — or go Pro for more.`;
    } else if (q.plan === "pro") {
      message = `You've reached the fair-use cap of ${q.limit} evaluations this month.`;
    } else {
      message = `You've used all ${q.limit} free evaluations. Upgrade to Pro for more.`;
    }
    throw paywall("evaluation", message);
  }
}

// ---------------------------------------------------------------------------
// Mentor daily limit
// ---------------------------------------------------------------------------
export async function getMentorQuota(userId: string): Promise<Quota & { plan: UserPlan }> {
  const { plan, isOnTrial } = await getTrialContext(userId);
  const limit = isOnTrial
    ? LIMITS.trial.mentorPerDay
    : plan === "pro"
      ? LIMITS.pro.mentorPerDay
      : LIMITS.free.mentorPerDay;
  const { startUtc } = istDayRangeUtc(istToday());
  // Sum meta.quota_cost (default 1) rather than count rows, so an in-depth
  // teacher lesson correctly costs 2 messages. Bounded by the day's cap, so
  // fetching the day's user turns and summing in memory is cheap.
  const { data, error } = await supabase()
    .from("doubt_messages")
    .select("meta, doubt_threads!inner(user_id)")
    .eq("doubt_threads.user_id", userId)
    .eq("role", "user")
    .gte("created_at", startUtc);
  if (error) throw new HttpError(500, `mentor count failed: ${error.message}`);
  const used = (data ?? []).reduce((sum, row) => {
    const cost = (row.meta as { quota_cost?: number } | null)?.quota_cost;
    return sum + (typeof cost === "number" && cost > 0 ? cost : 1);
  }, 0);
  return { plan, used, limit, remaining: Math.max(0, limit - used), period: "day" };
}

// ---------------------------------------------------------------------------
// Pro-only feature gates
// ---------------------------------------------------------------------------
async function assertPro(userId: string, feature: string, message: string): Promise<void> {
  const { plan } = await getPlanFor(userId);
  if (plan !== "pro") throw paywall(feature, message);
}

export function assertHandwrittenOcr(userId: string): Promise<void> {
  return assertPro(userId, "handwritten_ocr", "Handwritten answer upload is a Pro feature. Upgrade to submit photos of your answers.");
}

export function assertMicroDrill(userId: string): Promise<void> {
  return assertPro(userId, "micro_drills", "Micro-drills are a Pro feature. Upgrade to practice intros and conclusions.");
}

export function assertMockTests(userId: string): Promise<void> {
  return assertPro(userId, "mock_tests", "The mock test series is a Pro feature. Upgrade to attempt full-length papers.");
}

// ---------------------------------------------------------------------------
// Notes — Free users get the top-5 published notes per paper (by weightage)
// ---------------------------------------------------------------------------
let freeNoteCache: { at: number; ids: Set<string> } | null = null;
const FREE_NOTE_TTL_MS = 60_000;

/**
 * The set of syllabus_node_ids whose published note is inside the Free
 * top-5-per-paper allowance (ranked by the node's PYQ weightage total). Cached
 * briefly since it changes only when notes are published or ingestion reruns.
 */
export async function listFreeNoteNodeIds(): Promise<Set<string>> {
  if (freeNoteCache && Date.now() - freeNoteCache.at < FREE_NOTE_TTL_MS) return freeNoteCache.ids;

  const [{ data, error }, weightage] = await Promise.all([
    supabase()
      .from("notes")
      .select("syllabus_node_id, syllabus_nodes(paper_code)")
      .eq("status", "published"),
    loadNodeWeightage(),
  ]);
  if (error) throw new HttpError(500, `free-notes lookup failed: ${error.message}`);

  interface Row {
    syllabus_node_id: string;
    syllabus_nodes: { paper_code: string } | { paper_code: string }[] | null;
  }
  const rows = (data ?? []) as Row[];

  // Rank by SUBTREE weight (this node's own PYQs plus every descendant's),
  // not just the node's own directly-tagged count. Most depth-1 sections
  // have their PYQs tagged to depth-2 sub-topic leaves rather than the
  // section node itself, so an own-count-only ranking picked the WRONG top-5
  // (e.g. a 57-PYQ section with its own direct tags beat a 500+-PYQ section
  // whose PYQs all sit on its sub-topics). Every other weightage-ranking
  // surface (syllabus tree endpoints, mastery/Conquest Map's is_priority)
  // already rolls counts up through the subtree before ranking — this
  // brings the notes paywall in line with that convention.
  const subtreeWeights = await Promise.all(
    rows.map(async (r) => {
      const subtreeIds = await resolveSubtreeNodeIds(r.syllabus_node_id);
      const weight = subtreeIds.reduce((sum, id) => sum + (weightage.get(id)?.total ?? 0), 0);
      return { row: r, weight };
    }),
  );

  const byPaper = new Map<string, { nodeId: string; weight: number }[]>();
  for (const { row: r, weight } of subtreeWeights) {
    const sn = Array.isArray(r.syllabus_nodes) ? r.syllabus_nodes[0] : r.syllabus_nodes;
    const paper = sn?.paper_code ?? "__none__";
    (byPaper.get(paper) ?? byPaper.set(paper, []).get(paper)!).push({ nodeId: r.syllabus_node_id, weight });
  }

  const ids = new Set<string>();
  for (const list of byPaper.values()) {
    list
      .sort((a, b) => b.weight - a.weight || a.nodeId.localeCompare(b.nodeId))
      .slice(0, LIMITS.free.freeNotesPerPaper)
      .forEach((n) => ids.add(n.nodeId));
  }
  freeNoteCache = { at: Date.now(), ids };
  return ids;
}

/** Whether this user may read the full note for `nodeId`. */
export async function canReadFullNote(userId: string, nodeId: string): Promise<boolean> {
  const { plan } = await getPlanFor(userId);
  if (plan === "pro") return true;
  const free = await listFreeNoteNodeIds();
  return free.has(nodeId);
}

// ---------------------------------------------------------------------------
// Full snapshot for the UI (GET /entitlements)
// ---------------------------------------------------------------------------
export async function getEntitlements(userId: string): Promise<Entitlements> {
  const { plan, expiresAt, isOnTrial } = await getTrialContext(userId);
  const isPro = plan === "pro";
  const [evaluations, mentor] = await Promise.all([getEvaluationQuota(userId), getMentorQuota(userId)]);
  return {
    plan,
    plan_expires_at: expiresAt,
    is_on_trial: isOnTrial,
    evaluations: { used: evaluations.used, limit: evaluations.limit, remaining: evaluations.remaining, period: evaluations.period },
    mentor_messages: { used: mentor.used, limit: mentor.limit, remaining: mentor.remaining, period: mentor.period },
    features: {
      handwritten_ocr: isPro,
      micro_drills: isPro,
      mock_tests: isPro,
      all_notes: isPro,
      advanced_analytics: isPro,
      magazine_pdf: isPro,
    },
  };
}
