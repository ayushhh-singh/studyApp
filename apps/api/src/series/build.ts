/**
 * `pnpm series:build --slug <s>` — assemble a scheduled test series' papers.
 *
 * A series entry becomes an ordinary `tests` row plus a `test_series_entries`
 * row pointing at it, so the existing attempt engine serves, grades, reviews and
 * ranks it with no changes (design decision D-1).
 *
 * ---------------------------------------------------------------------------
 * DO THE SESSION-15 ASSEMBLY GUARANTEES CARRY OVER? Reuse is not correctness, so
 * each of the four was checked against what a SERIES entry actually is, and two
 * of them needed real work rather than an import.
 *
 *  1. STRUCTURE — PARTLY DIFFERENT, and this is the one it would have been
 *     easiest to get wrong. `mocks.ts`'s `assertPaperStructure` asserts a paper
 *     matches the commission's notified question count, which is right for a
 *     full-length and WRONG for a 50-question sectional: no commission notifies
 *     a sectional, so there is no registry number to check it against. So a
 *     `full_length` entry takes its count/duration/marking FROM THE REGISTRY via
 *     `freshMockPaperConfig` (never the calendar, and the calendar's declared
 *     count is asserted to agree), while every other kind takes its length from
 *     the calendar — a product decision — and still has that length asserted on
 *     the paper actually assembled. Both paths also inherit the duplicate check.
 *
 *  2. WEIGHTAGE — CARRIES OVER, but the AXIS had to change. Every existing
 *     surface balances across depth-1 sections, which is exactly right for a
 *     whole-paper mock. For a sectional targeting one section, every question is
 *     in that section, so a depth-1 axis is a single bucket and balances
 *     nothing. `buildAxis` therefore drops to depth-2 when an entry sits inside
 *     one section, so a 50-question Polity sectional still spreads across
 *     Constitution / Political System / Panchayati Raj / Public Policy by
 *     weightage instead of by luck.
 *
 *  3. QUALITY — CARRIES OVER UNCHANGED. Every pool goes through
 *     `assemblyVisibilityOrFilter()`, which takes no scope argument precisely so
 *     an assembly path cannot opt into the serving-only CURRENT_AFFAIRS
 *     exception. That exception is what put 36 rejected questions into 25 live
 *     tests; a series must never reacquire it.
 *
 *  4. REPETITION — CARRIES OVER, and is stronger here. `preferUnused` is applied
 *     across the WHOLE series in sequence order, not just within one paper, so
 *     each entry spends the pool's fresh supply before repeating. Prefer-unused,
 *     never require-unused: §6.2 records that forcing disjointness wrecked the
 *     topic mix on thin pools (MAINS_GS5 5.0 -> 69.8pp), which trades guarantee 2
 *     for guarantee 4 and is not a fix.
 *
 * ---------------------------------------------------------------------------
 * ⚑ COMPOSITION IS A TARGET, NOT A PROMISE — and today's supply makes that
 * unavoidable rather than merely prudent. §6.2 asks a full-length for ">=50%
 * qgen" so the rank measures more than memory of our own bank. Measured live
 * 2026-08-13, approved+published MCQs:
 *
 *     uppsc PRE_GS1        pyq 1005   generated  17   CA 1451
 *     upsc  UPSC_PRE_GS1   pyq 1057   generated   0   CA   23
 *
 * So the qgen share is unreachable for UPPSC and literally impossible for UPSC
 * right now. The builder does what `daily/quiz.ts` already does for the same
 * situation — fills what a slice can fill, BACKFILLS the shortfall from the
 * other pools, and LOGS it — and additionally records the composition it
 * actually achieved on the test's own `meta.composition_actual`. A paper that
 * silently claimed a mix it did not have would be worse than a short one.
 * qgen:topup's floors were raised for exactly this on 2026-08-13 and its
 * dry-run currently plans 395 shortfall nodes, so the gap closes over the
 * series' run; the recorded actuals are how anyone can tell when it has.
 */
import { CURRENT_AFFAIRS_PAPER_CODE, assemblyVisibilityOrFilter } from "../lib/question-visibility.js";
import { stateFocusFilterFor } from "../ca/curation-scope.js";
import { balancedPick, maxSectionDeviationPct } from "../lib/topic-balance.js";
import { HttpError } from "../lib/http-error.js";
import { selectAll } from "../lib/paginate.js";
import { supabase } from "../lib/supabase.js";
import { roundMarks } from "../lib/marks.js";
import { PRELIMS_MARKING } from "../lib/exam-papers.js";
import { currentExamYear, hotnessRaw, loadNodeWeightage, type OwnWeightage } from "../lib/weightage.js";
import { freshMockPaperConfig } from "../services/mocks.js";
import { istToUtc, loadCalendar, windowClose, type SeriesCalendar, type SeriesEntrySpec } from "./calendar.js";

type Log = (msg: string) => void;

/** A candidate question, keyed by the balance axis this entry uses. */
interface Candidate {
  id: string;
  marks: number;
  top: string;
  source: "pyq" | "ca" | "qgen";
}

const DEFAULT_MCQ_MARKS = 2;

/** A minimum from every populated bucket, so a rarely-asked topic still appears. */
const MIN_PER_SECTION = 1;

// ---------------------------------------------------------------------------
// Syllabus axis
// ---------------------------------------------------------------------------

interface Axis {
  /** node_id -> balance key. */
  keyOf: Map<string, string>;
  /** balance key -> recency-weighted hotness. */
  weightOf: Map<string, number>;
  /** The node ids an entry may draw from. */
  nodeIds: string[];
  depth: number;
}

/**
 * Resolve an entry's node set and its balance axis.
 *
 * `node_targets` are `syllabus_nodes.path` PREFIXES; a prefix matches itself and
 * its descendants. The `${prefix}/` guard is what stops `polity` also matching a
 * hypothetical `polity-extra` — the same trailing-slash rule
 * `lib/syllabus-subtree.ts` uses, reimplemented here only because that helper
 * takes a node id and a calendar names paths.
 *
 * The axis DEPTH is the interesting part; see guarantee 2 in the module header.
 */
async function buildAxis(
  paperCode: string,
  targets: string[],
  weightage: Map<string, OwnWeightage>,
  year: number,
): Promise<Axis> {
  const { data, error } = await supabase()
    .from("syllabus_nodes")
    .select("id, path")
    .eq("paper_code", paperCode);
  if (error) throw new HttpError(500, `syllabus lookup failed for ${paperCode}: ${error.message}`);
  const all = (data ?? []) as { id: string; path: string }[];
  if (all.length === 0) {
    // The synthetic CURRENT_AFFAIRS paper is the case that gets this wrong: it
    // has no tree of its own, because every CA question is mapped into the GS
    // paper's tree. A current-affairs ENTRY therefore names the GS paper — that
    // is what its questions are about and what its axis is — and gets its
    // questions from the CA pool via `composition.ca`, not from a paper code.
    throw new HttpError(
      500,
      `paper "${paperCode}" has no syllabus nodes, so an entry cannot be balanced against it` +
        (paperCode === CURRENT_AFFAIRS_PAPER_CODE
          ? ` — a current_affairs entry should name the GS paper its questions map into (e.g. PRE_GS1) and set composition.ca = 100`
          : ""),
    );
  }

  const matches = (p: string) =>
    targets.length === 0 || targets.some((t) => p === t || p.startsWith(`${t}/`));
  const selected = all.filter((n) => n.path !== "" && matches(n.path));
  if (selected.length === 0) {
    throw new HttpError(
      500,
      `node_targets [${targets.join(", ")}] match no node in ${paperCode} — a path prefix is wrong (paths are slugs like "polity/constitution")`,
    );
  }

  // Depth-2 axis when the entry sits inside a single depth-1 section, so a
  // sectional balances across its real sub-topics instead of one bucket.
  const firstSegments = new Set(selected.map((n) => n.path.split("/")[0]));
  const depth = firstSegments.size === 1 ? 2 : 1;
  const keyFor = (p: string) => p.split("/").slice(0, depth).join("/");

  const keyOf = new Map<string, string>();
  for (const n of selected) keyOf.set(n.id, keyFor(n.path));

  // Hotness rolls UP: every selected node contributes to its axis key, so a key
  // that is a chapter carries its whole subtree's weight.
  const weightOf = new Map<string, number>();
  for (const n of selected) {
    const w = weightage.get(n.id);
    if (!w) continue;
    const k = keyFor(n.path);
    weightOf.set(k, (weightOf.get(k) ?? 0) + hotnessRaw(w.byYear, year));
  }
  return { keyOf, weightOf, nodeIds: selected.map((n) => n.id), depth };
}

// ---------------------------------------------------------------------------
// Pools
// ---------------------------------------------------------------------------

/** `.in()` chunk size — a long URL fails outright (CLAUDE.md's repeated `.in()` gotcha). */
const IN_CHUNK = 100;

/**
 * The CA questions belonging to items this exam considers STATE-focused — the
 * pool a `state_special` entry's current-affairs slice draws from.
 *
 * Resolved through `ca/curation-scope.ts`'s `stateFocusFilterFor` rather than by
 * reading `is_up_specific` directly, because that column is one commission's
 * verdict: post-0116 rows carry a per-exam `state_focus` array and the legacy
 * boolean is attributed ONLY to the default exam. Reading the boolean here would
 * label a UP story state-focused for an MP aspirant.
 *
 * Returns null for a nationally-scoped exam (UPSC), which is the honest answer
 * — there is no such paper for them, and the calendar for UPSC accordingly has
 * no state_special entry.
 *
 * ⚑ SCOPE LIMIT, stated rather than papered over: this narrows the CA slice
 * only. §6.2 also asks for "UP-tagged PYQ", and no such tag exists on
 * `questions` — UPPSC's own PYQs are UP-relevant by virtue of being that
 * commission's paper, so the PYQ slice stays the paper's ordinary pool.
 */
async function stateFocusedCaQuestionIds(examCode: string): Promise<Set<string> | null> {
  const filter = stateFocusFilterFor(examCode);
  if (!filter) return null;
  const rows = await selectAll<{ id: string; mcq_question_ids: string[] | null }>(() =>
    supabase()
      .from("current_affairs_items")
      .select("id, mcq_question_ids")
      .eq("status", "published")
      .overlaps("exam_codes", [examCode])
      .or(filter)
      .order("id", { ascending: true }),
  );
  const out = new Set<string>();
  for (const r of rows) for (const q of r.mcq_question_ids ?? []) out.add(q);
  return out;
}

async function fetchPool(opts: {
  examCode: string;
  paperCode: string;
  nodeIds: string[];
  source: "pyq" | "ca" | "qgen";
  axis: Axis;
  caWindow?: [string, string];
  /** CA slice only: restrict to these question ids (state_special entries). */
  restrictTo?: ReadonlySet<string>;
}): Promise<Candidate[]> {
  const out: Candidate[] = [];
  const perQuestionDefault = PRELIMS_MARKING[opts.paperCode]?.marksPerQuestion ?? DEFAULT_MCQ_MARKS;

  for (let i = 0; i < opts.nodeIds.length; i += IN_CHUNK) {
    const chunk = opts.nodeIds.slice(i, i + IN_CHUNK);
    // Paged: one paper's approved MCQs run past PostgREST's 1000-row cap
    // (PRE_GS1 alone is 1005 PYQs), and a truncated pool silently narrows the
    // paper rather than erroring.
    const rows = await selectAll<{ id: string; marks: number | null; syllabus_node_id: string | null }>(() => {
      let q = supabase()
        .from("questions")
        .select("id, marks, syllabus_node_id")
        .eq("type", "mcq")
        // The paper is titled to ONE commission's pattern, so it may contain
        // only that commission's questions. Other exams (UPSSSC PET, UP RO/ARO)
        // deliberately share UPPSC's paper codes for weightage analytics.
        .eq("exam_code", opts.examCode)
        // Quality guarantee — no scope argument to get wrong.
        .or(assemblyVisibilityOrFilter())
        .in("syllabus_node_id", chunk)
        .order("id", { ascending: true });

      if (opts.source === "ca") {
        q = q.eq("paper_code", CURRENT_AFFAIRS_PAPER_CODE);
        if (opts.caWindow) {
          // A CA question's own created_at is when the pipeline produced it from
          // its news item, so it is the honest proxy for "which months of current
          // affairs is this test about".
          q = q.gte("created_at", `${opts.caWindow[0]}T00:00:00+05:30`)
               .lte("created_at", `${opts.caWindow[1]}T23:59:59+05:30`);
        }
      } else {
        q = q
          .eq("paper_code", opts.paperCode)
          .eq("source", opts.source === "pyq" ? "pyq" : "generated")
          // Some PYQs carry a real paper_code but are out-of-syllabus filler.
          .eq("out_of_syllabus", false);
      }
      return q;
    });

    for (const r of rows) {
      const key = r.syllabus_node_id ? opts.axis.keyOf.get(r.syllabus_node_id) : undefined;
      if (!key) continue; // outside this entry's targets
      if (opts.restrictTo && !opts.restrictTo.has(r.id)) continue;
      out.push({ id: r.id, marks: r.marks ?? perQuestionDefault, top: key, source: opts.source });
    }
  }
  return out;
}

function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Order a pool so questions this series has not used yet come first.
 *
 * PREFER-unused, never REQUIRE-unused — see guarantee 4. Because `balancedPick`
 * honours within-bucket order, this makes each bucket spend its own fresh supply
 * first while leaving the per-bucket COUNTS identical to an independent sample,
 * so the topic mix is untouched.
 */
function unusedFirst(pool: Candidate[], used: ReadonlySet<string>): Candidate[] {
  if (used.size === 0) return shuffle(pool);
  return [...shuffle(pool.filter((q) => !used.has(q.id))), ...shuffle(pool.filter((q) => used.has(q.id)))];
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

export interface EntryBuildResult {
  sequence_no: number;
  slug: string;
  test_id: string;
  question_count: number;
  requested: { pyq: number; ca: number; qgen: number };
  achieved: { pyq: number; ca: number; qgen: number };
  backfilled: number;
  deviation_pct: number;
  reused_from_earlier_entries: number;
}

/**
 * Split `count` into the three slices, largest-remainder so the parts sum to
 * exactly `count` rather than to 99 or 101 after rounding.
 */
function sliceTargets(count: number, c: { pyq: number; ca: number; qgen: number }) {
  const raw = { pyq: (count * c.pyq) / 100, ca: (count * c.ca) / 100, qgen: (count * c.qgen) / 100 };
  const floored = { pyq: Math.floor(raw.pyq), ca: Math.floor(raw.ca), qgen: Math.floor(raw.qgen) };
  let rem = count - (floored.pyq + floored.ca + floored.qgen);
  const order: ("pyq" | "ca" | "qgen")[] = ["pyq", "ca", "qgen"];
  order.sort((a, b) => raw[b] - Math.floor(raw[b]) - (raw[a] - Math.floor(raw[a])));
  for (const k of order) {
    if (rem <= 0) break;
    floored[k] += 1;
    rem -= 1;
  }
  return floored;
}

async function assembleEntry(
  cal: SeriesCalendar,
  entry: SeriesEntrySpec,
  ctx: { weightage: Map<string, OwnWeightage>; year: number; used: Set<string> },
  log: Log,
): Promise<{ items: Candidate[]; result: Omit<EntryBuildResult, "test_id" | "slug"> }> {
  const axis = await buildAxis(entry.paper_code, entry.node_targets, ctx.weightage, ctx.year);

  // A full-length mirrors a real commission paper, so its structure comes from
  // the registry, never from the calendar (guarantee 1).
  let count = entry.question_count;
  if (entry.entry_kind === "full_length") {
    const reg = await freshMockPaperConfig(entry.paper_code);
    if (reg) {
      if (reg.count !== entry.question_count) {
        throw new HttpError(
          500,
          `series ${cal.slug} entry ${entry.sequence_no}: calendar declares ${entry.question_count} questions but exams.paper_structure notifies ${reg.count} for ${entry.paper_code}`,
        );
      }
      count = reg.count;
    }
  }

  // A state-special paper's CA slice is drawn only from state-focused items.
  const stateOnly = entry.entry_kind === "state_special" ? await stateFocusedCaQuestionIds(cal.exam_code) : null;
  if (entry.entry_kind === "state_special" && stateOnly === null) {
    throw new HttpError(
      500,
      `series ${cal.slug} entry ${entry.sequence_no}: ${cal.exam_code} is a nationally-scoped exam and has no state lens, so a state_special entry is not meaningful for it`,
    );
  }

  const [pyq, ca, qgen] = await Promise.all([
    fetchPool({ examCode: cal.exam_code, paperCode: entry.paper_code, nodeIds: axis.nodeIds, source: "pyq", axis }),
    fetchPool({
      examCode: cal.exam_code,
      paperCode: entry.paper_code,
      nodeIds: axis.nodeIds,
      source: "ca",
      axis,
      ...(entry.ca_window ? { caWindow: entry.ca_window } : {}),
      ...(stateOnly ? { restrictTo: stateOnly } : {}),
    }),
    fetchPool({ examCode: cal.exam_code, paperCode: entry.paper_code, nodeIds: axis.nodeIds, source: "qgen", axis }),
  ]);

  const requested = sliceTargets(count, entry.composition);
  const weightOf = (top: string) => axis.weightOf.get(top) ?? 0;

  // ONE shared running map across the three slices — this is exactly the case
  // `balancedPick` was built for. Balancing each slice independently does not
  // balance the paper: three separately-balanced draws from three differently
  // shaped pools still compose into a skewed whole.
  const pools: Record<"pyq" | "ca" | "qgen", Candidate[]> = { pyq, ca, qgen };

  // ⚑ A SOURCE AT 0% IS EXCLUDED FROM THE POOL, NOT MERELY DEPRIORITISED.
  //
  // A calendar author writing `"ca": 100, "pyq": 0` means "this paper is current
  // affairs", and that is the paper's IDENTITY, not a preference. The first
  // version of this function backfilled a short slice from the other pools
  // regardless, and the dry run showed exactly what that produces: entry 9,
  // titled "Current affairs, January to June 2026", assembled 100 questions of
  // which ZERO were current affairs and 100 were PYQs — because the ca_window
  // matched nothing and PYQ silently filled the gap. A mislabelled paper is
  // worse than a paper that refuses to build.
  //
  // So the composition's zeroes are hard, its non-zeroes are soft: a source the
  // calendar asked for can under-deliver and the others cover it, but a source
  // it excluded can never appear.
  const activeSources = (["pyq", "ca", "qgen"] as const).filter((k) => entry.composition[k] > 0);

  // ⚑ TOPIC MIX IS THE HARD CONSTRAINT; COMPOSITION IS THE SOFT ONE. This is a
  // deliberate inversion of the obvious design (pick each source's slice, then
  // combine), and the dry run is why. Under the per-slice loop, entry 1's Polity
  // sectional came out at 26.6pp max section deviation — PRE_GS1's entire
  // generated supply is 17 questions concentrated in ONE depth-2 bucket, so a
  // 30% qgen slice had nowhere else to put them and the paper's topic mix
  // absorbed the damage. Re-ordering the slices only moved it to 20.6pp.
  //
  // §6.2 already states the principle for the analogous case: when freshness and
  // mix conflict, give the entry a deeper pool, "not a stricter selector".
  // Mix is what makes a paper the exam's pattern; composition is what makes it
  // feel fresh. So: build ONE pool, and inside each topic bucket order the
  // candidates to approximate the requested composition. `balancedPick` honours
  // within-bucket order and chooses buckets purely by weightage deficit, so a
  // single call now delivers an exact topic mix AND the composition the bucket
  // can actually support — degrading per bucket instead of per paper.
  const byBucket = new Map<string, Candidate[]>();
  for (const kind of activeSources) {
    for (const q of unusedFirst(pools[kind], ctx.used)) {
      const arr = byBucket.get(q.top);
      if (arr) arr.push(q);
      else byBucket.set(q.top, [q]);
    }
  }

  const orderedPool: Candidate[] = [];
  for (const [, bucketItems] of byBucket) {
    // Split this bucket by source, preserving each source's own unused-first
    // order, then interleave by largest remaining share of the requested mix.
    const bySource = new Map<string, Candidate[]>();
    for (const q of bucketItems) {
      const arr = bySource.get(q.source);
      if (arr) arr.push(q);
      else bySource.set(q.source, [q]);
    }
    const taken: Record<string, number> = { pyq: 0, ca: 0, qgen: 0 };
    let placed = 0;
    for (;;) {
      let best: string | null = null;
      let bestDeficit = -Infinity;
      for (const kind of activeSources) {
        const avail = bySource.get(kind);
        if (!avail || taken[kind] >= avail.length) continue;
        const deficit = (entry.composition[kind] / 100) * (placed + 1) - taken[kind];
        if (deficit > bestDeficit) {
          best = kind;
          bestDeficit = deficit;
        }
      }
      if (!best) break;
      orderedPool.push(bySource.get(best)![taken[best]]);
      taken[best] += 1;
      placed += 1;
    }
  }

  const picked = balancedPick({
    pool: orderedPool,
    count,
    weightOf,
    minPerSection: MIN_PER_SECTION,
  });

  const items = picked;
  const achieved = { pyq: 0, ca: 0, qgen: 0 };
  for (const q of items) achieved[q.source] += 1;
  const reused = items.filter((q) => ctx.used.has(q.id)).length;
  const backfilled = activeSources.reduce((n, k) => n + Math.max(0, requested[k] - achieved[k]), 0);

  // Structure gate, on the paper actually built (guarantee 1). Both branches
  // check the same two things; only where the number comes from differs.
  if (items.length !== count) {
    const asked = activeSources.join("+");
    throw new HttpError(
      500,
      `series ${cal.slug} entry ${entry.sequence_no}: assembled ${items.length}/${count} questions from ${asked} — ` +
        `pool too thin (pyq ${pyq.length}, ca ${ca.length}, qgen ${qgen.length} for these node targets` +
        `${entry.ca_window ? `, ca_window ${entry.ca_window[0]}..${entry.ca_window[1]}` : ""}). ` +
        `Widen the window, widen node_targets, or wait for supply — do NOT relax the composition's zeroes, they are the paper's identity.`,
    );
  }
  if (new Set(items.map((q) => q.id)).size !== items.length) {
    throw new HttpError(500, `series ${cal.slug} entry ${entry.sequence_no}: duplicate question in one paper`);
  }

  const deviation = maxSectionDeviationPct(items, weightOf, axis.weightOf.keys());
  if (backfilled > 0) {
    log(
      `  entry ${entry.sequence_no}: backfilled ${backfilled} — requested pyq/ca/qgen ` +
        `${requested.pyq}/${requested.ca}/${requested.qgen}, achieved ${achieved.pyq}/${achieved.ca}/${achieved.qgen} ` +
        `(pool had ${pyq.length}/${ca.length}/${qgen.length})`,
    );
  }

  return {
    items,
    result: {
      sequence_no: entry.sequence_no,
      question_count: items.length,
      requested,
      achieved,
      backfilled,
      deviation_pct: Number(deviation.toFixed(1)),
      reused_from_earlier_entries: reused,
    },
  };
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/**
 * `full_length` -> `mock`, everything else -> `sectional`.
 *
 * ⚑ NOT a new `test_kind`. `v_test_leaderboard` filters `kind in ('mock',
 * 'sectional')`, so a 'series' kind would produce series tests with no rank, no
 * error and no failing test (§5.3). "Is this part of a series" is answered by
 * the test_series_entries join, not by the kind.
 */
function testKindFor(entry: SeriesEntrySpec): "mock" | "sectional" {
  return entry.entry_kind === "full_length" ? "mock" : "sectional";
}

async function upsertSeries(cal: SeriesCalendar): Promise<string> {
  const entries = [...cal.entries].sort((a, b) => a.sequence_no - b.sequence_no);
  const { data, error } = await supabase()
    .from("test_series")
    .upsert(
      {
        slug: cal.slug,
        exam_code: cal.exam_code,
        stage: cal.stage,
        paper_scope: cal.paper_scope,
        title_i18n: cal.title_i18n,
        description_i18n: cal.description_i18n,
        target_exam_year: cal.target_exam_year,
        starts_on: entries[0].opens_on,
        ends_on: entries[entries.length - 1].opens_on,
        meta: { built_from: `${cal.slug}.json`, entry_count: entries.length },
      },
      { onConflict: "slug" },
    )
    .select("id, status")
    .single();
  if (error) throw new HttpError(500, `series upsert failed: ${error.message}`);
  return data.id as string;
}

async function upsertEntryTest(
  cal: SeriesCalendar,
  entry: SeriesEntrySpec,
  items: Candidate[],
  achieved: { pyq: number; ca: number; qgen: number },
  log: Log,
): Promise<string> {
  const slug = `series:${cal.slug}:${entry.sequence_no}`;
  const reg = await freshMockPaperConfig(entry.paper_code);
  const totalMarks = roundMarks(items.reduce((s, q) => s + q.marks, 0));

  const { data, error } = await supabase()
    .from("tests")
    .upsert(
      {
        slug,
        title_i18n: {
          en: `${cal.title_i18n.en} — Test ${entry.sequence_no}`,
          hi: `${cal.title_i18n.hi} — टेस्ट ${entry.sequence_no}`,
        },
        kind: testKindFor(entry),
        // Stamped explicitly: the column default is a valid exam code, so
        // relying on it would silently tag a second exam's paper `uppsc`.
        exam_code: cal.exam_code,
        paper_code: entry.paper_code,
        duration_minutes: entry.duration_minutes,
        total_marks: totalMarks,
        is_published: true,
        meta: {
          source: "series",
          series_slug: cal.slug,
          sequence_no: entry.sequence_no,
          entry_kind: entry.entry_kind,
          composition_requested: entry.composition,
          // The honest record of what the pools could actually supply.
          composition_actual: achieved,
          ...(reg
            ? {
                official_max_marks: reg.officialMaxMarks,
                qualifying_pct: reg.qualifyingPct,
                marking_scheme: {
                  type: reg.markingSchemeType,
                  negative_marking: reg.negativeMarking,
                  note: "one-third (1/3) negative marking",
                },
              }
            : {}),
        },
      },
      { onConflict: "slug" },
    )
    .select("id")
    .single();
  if (error) throw new HttpError(500, `test upsert failed for ${slug}: ${error.message}`);
  const testId = data.id as string;

  const del = await supabase().from("test_questions").delete().eq("test_id", testId);
  if (del.error) throw new HttpError(500, `clear members failed: ${del.error.message}`);
  const rows = items.map((it, i) => ({ test_id: testId, question_id: it.id, order_index: i, marks: it.marks }));
  const ins = await supabase().from("test_questions").insert(rows);
  if (ins.error) throw new HttpError(500, `insert members failed: ${ins.error.message}`);
  void log;
  return testId;
}

async function upsertSeriesEntry(seriesId: string, cal: SeriesCalendar, entry: SeriesEntrySpec, testId: string) {
  const opensAt = istToUtc(entry.opens_on, cal.opens_time_ist);
  const closesAt = windowClose(entry.opens_on, entry.open_days);
  const { error } = await supabase()
    .from("test_series_entries")
    .upsert(
      {
        series_id: seriesId,
        test_id: testId,
        sequence_no: entry.sequence_no,
        entry_kind: entry.entry_kind,
        opens_at: opensAt.toISOString(),
        closes_at: closesAt.toISOString(),
        // ranked_until = closes_at: the window that is open is the window that
        // counts. A later attempt still runs, unranked (§2.4).
        ranked_until: closesAt.toISOString(),
        syllabus_note_i18n: entry.syllabus_note_i18n,
        sources_i18n: entry.sources_i18n,
        ...(entry.ca_window ? { ca_window: `[${entry.ca_window[0]},${entry.ca_window[1]}]` } : {}),
        meta: { node_targets: entry.node_targets, composition: entry.composition },
      },
      { onConflict: "series_id,sequence_no" },
    );
  if (error) throw new HttpError(500, `series entry upsert failed (seq ${entry.sequence_no}): ${error.message}`);
}

export interface SeriesBuildResult {
  slug: string;
  exam_code: string;
  series_id: string | null;
  entries: EntryBuildResult[];
}

/**
 * Build (or rebuild) one series. Idempotent on `tests.slug` and on
 * `(series_id, sequence_no)`, so a re-run refreshes membership with a fresh
 * balanced sample rather than duplicating anything.
 *
 * `dryRun` assembles and reports without writing a single row — the mode to use
 * when checking whether a calendar's pools can actually fill it.
 */
export async function buildSeries(slug: string, opts: { dryRun?: boolean } = {}, log: Log = () => {}): Promise<SeriesBuildResult> {
  const cal = loadCalendar(slug);
  const weightage = await loadNodeWeightage();
  const year = currentExamYear();
  const used = new Set<string>();
  const entries = [...cal.entries].sort((a, b) => a.sequence_no - b.sequence_no);

  log(`${cal.slug} — ${cal.exam_code}/${cal.stage}, ${entries.length} entries${opts.dryRun ? " [dry run]" : ""}`);

  const seriesId = opts.dryRun ? null : await upsertSeries(cal);
  const results: EntryBuildResult[] = [];

  for (const entry of entries) {
    const { items, result } = await assembleEntry(cal, entry, { weightage, year, used }, log);
    let testId = "(dry-run)";
    if (!opts.dryRun && seriesId) {
      testId = await upsertEntryTest(cal, entry, items, result.achieved, log);
      await upsertSeriesEntry(seriesId, cal, entry, testId);
    }
    // Applied AFTER this entry, so freshness accumulates in sequence order.
    for (const q of items) used.add(q.id);
    results.push({ ...result, test_id: testId, slug: `series:${cal.slug}:${entry.sequence_no}` });
    log(
      `  #${entry.sequence_no} ${entry.entry_kind} ${entry.paper_code} — ${result.question_count} Q, ` +
        `pyq/ca/qgen ${result.achieved.pyq}/${result.achieved.ca}/${result.achieved.qgen}, ` +
        `deviation ${result.deviation_pct}pp, reused ${result.reused_from_earlier_entries}`,
    );
  }

  return { slug: cal.slug, exam_code: cal.exam_code, series_id: seriesId, entries: results };
}
