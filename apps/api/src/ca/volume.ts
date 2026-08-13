/**
 * The current-affairs pipeline's RUN BUDGET — how much raw feed material one
 * `ca:run` is allowed to turn into exam content.
 *
 * ⚑ ONE HOME, BECAUSE THERE WERE TWO. These three numbers used to be inline
 * literals in BOTH `./run.ts` (the CLI defaults, which the production cron
 * `.github/workflows/ca-run.yml` invokes with no flags) AND `./scheduler.ts`
 * (the opt-in dev node-cron). Raising one and not the other is a silent
 * divergence of exactly the kind this repo keeps finding — a local `pnpm dev`
 * would have gone on quietly running the old volume against the same
 * production database. Both now import from here; there is no third caller
 * (`runPipeline` takes them as required options and defaults nothing).
 *
 * NOT the CA quiz SET sizes. Those live in `./assemble.ts`
 * (`PRELIMS_MAX`/`MAINS_MAX`/`DAILY_*`) and are DOWNSTREAM ASSEMBLY — how many
 * of the already-generated, already-reviewer-approved questions go into one
 * sitting. This file is the POOL those sittings draw from. Raising a set size
 * without the pool just makes a set that cannot fill.
 *
 * ---------------------------------------------------------------------------
 * ⚑ WHY MAX_TOTAL WENT 40 -> 70 (2026-08-13)
 * ---------------------------------------------------------------------------
 * Every number below was measured against the live corpus, not estimated.
 *
 * 1. THE BUDGET BINDS ON EVERY RUN, AND ALWAYS HAS. 3,369 items were taken in
 *    the 21 days to 2026-08-12 — 160.4/day against a ceiling of exactly 4 runs
 *    x 40. Not "occasionally capped": saturated.
 *
 * 2. SUPPLY IS NOT THE LIMIT. Fetching all 11 feeds and applying the pipeline's
 *    own local filter (unseen + dated + inside `--days`), there were 228 fresh
 *    eligible items waiting at `--days 3`. A run took 40 and left 188 behind.
 *    129 of those were under 24h old, so this is standing daily supply, not a
 *    one-off backlog.
 *
 * 3. THE REVIEW QUEUE IS NOT THE LIMIT EITHER — which is what makes this safe
 *    to raise at all, and is the first thing to re-check if it is ever raised
 *    again. Every CA question is inserted `needs_review` and a human approves
 *    it before a student sees it, so reviewer capacity is the real ceiling on
 *    useful volume. Measured: backlog 12, against a DEMONSTRATED throughput of
 *    778 questions actioned in one day (2026-08-11) and 858 on 2026-07-23,
 *    1,889 lifetime. Generation runs at ~30-47 questions/day. The reviewer is
 *    over-provisioned by more than an order of magnitude; 1.75x of ~40/day is
 *    not close to troubling it.
 *
 * 4. WHAT IS ACTUALLY STARVED IS THE DAILY MAINS SITTING. Per-set fill, every
 *    CA set built since the caps were raised:
 *      daily prelims  15/15, 7/15, 15/15, 15/15   — fills on most days
 *      weekly prelims 50/50                       — fills
 *      weekly mains   19/20                       — fills
 *      daily mains    1/5, 2/5, 2/5, 1/5, 1/5, 2/5 — 20-40%, NEVER fills
 *    (Do not compute this as an average over all sets: the weekly caps were
 *    raised 20->50 and 5->20 on 2026-08-12, so older sittings were built at a
 *    lower cap and drag the mean down into a starvation that is not there.)
 *
 * 5. AND THE REASON IS THE TIER MIX, WHICH IS WHY VOLUME IS THE LEVER.
 *    Of 3,370 items taken: 60.0% kept, 32.8% scored prelims >= 2 (MCQ-eligible),
 *    but only 4.1% scored mains == 3 — the ONLY tier that yields a descriptive
 *    question. At 160 items/day that is ~6.6 mains-3 items, against a demand of
 *    5/day/exam x 2 live exams = 10 descriptive questions/day.
 *
 * ⚑ AND THE HONEST LIMIT OF THIS CHANGE: 70 does NOT close the mains gap. It
 * takes ~160 -> ~280 items/day, so ~6.6 -> ~11.5 mains-3 items/day and the
 * daily mains sitting from ~1.5/5 to roughly 2.5-3/5. Closing it by volume
 * alone needs ~400 items/day (100/run), which the wall clock below does not
 * allow. The cheaper follow-up is the 4.1% itself, or generating more than one
 * descriptive question from a mains-3 item that is rich enough for two — both
 * are prompt/quality changes needing their own validation, not a knob.
 *
 * ---------------------------------------------------------------------------
 * ⚑ WHY 70 AND NOT MORE — THE WALL CLOCK, NOT THE MONEY
 * ---------------------------------------------------------------------------
 * Triage is batched (submit-now/collect-later), so it is off the critical path.
 * What costs wall time is the collect phase: per KEPT item, 1 enrich + one
 * node-classify and one MCQ-generation call PER RELEVANT EXAM, plus a mains
 * question + critic for a mains-3 item. Measured per kept item: 1.9 sequential
 * calls with one live exam, 2.78 with two — so each additional live exam adds
 * ~0.88, and a third would put it near 3.7.
 *
 * Measured on the six real dual-exam runs (2026-08-11/12): 132-166 calls,
 * 64-79 of them on the critical path, 10.5-12.7 min wall, one 17.8 min outlier
 * — i.e. 0.164 min/call typical and 0.262 min/call at the worst observed rate.
 *
 * Projecting `maxTotal x 0.60 keep x calls-per-kept x min-per-call`, against
 * `ca-run.yml`'s `timeout-minutes: 50` (plus ~2 min checkout/install):
 *
 *   maxTotal   2 exams typical / worst    3 exams typical / worst
 *      40           11 /  18 min               14 /  23 min
 *      70           19 /  31 min               25 /  40 min     <- shipped
 *     100           27 /  44 min               36 /  58 min     <- BLOWS IT
 *
 * 70 is therefore the largest value that keeps even a worst-observed-rate run
 * inside the EXISTING timeout AFTER a third exam goes live. 100 would need the
 * workflow timeout raised as well, and would still not fill the mains sitting.
 * If this is ever raised past 70, raise `timeout-minutes` in the same commit.
 *
 * COST, disclosed rather than buried. Measured $0.0469 per KEPT item in the
 * dual-exam era ($9.52 over 203 kept), i.e. ~$0.028 per item taken at the 60%
 * keep rate. 40 -> 70 moves Anthropic spend from ~$4.5/day to ~$7.9/day
 * (~$135 -> ~$236/month), and GitHub Actions from ~56 to ~92 minutes/day
 * (~1,700 -> ~2,800 min/month for this workflow alone). ⚑ `docs/operations.md`
 * records that a Free private repo's allowance has historically been 2,000
 * Actions minutes/month — ca-run alone was already near it and this change
 * takes it past. That is a real bill, not a rounding error; it is flagged here
 * because nothing else in the repo would surface it.
 */

/**
 * Freshness window in days. NOT a volume lever, deliberately — widening it to 5
 * or 7 would add supply (228 -> 361 -> 441 measured at the same instant) but the
 * added material is stale news, and `indian-express-economy` in particular is
 * "deep but slow" (200 items spanning months), so a wider window pulls in weeks-
 * old stories rather than more of today's. Volume comes from MAX_TOTAL.
 *
 * A float, not an int: it is compared against a fractional age downstream, so
 * `--days 0.5` is a valid 12-hour narrowing.
 */
export const CA_DEFAULT_DAYS = 3;

/**
 * Per-source ceiling for one run. DELIBERATELY UNCHANGED at 70, on measurement.
 *
 * Since `./source-rotation.ts` landed, items are drained round-robin, so a
 * source can only exceed its fair share when other sources have run out — and
 * with 9 of 11 feeds carrying supply, the fair share at maxTotal 70 is ~7.8 and
 * this cap does not bind at all (simulated against the live feeds at maxTotal
 * 80: the busiest source took 11). Raising it would therefore change behaviour
 * ONLY on days when few desks have anything — which is precisely when
 * concentrating the run on the two or three general national feeds is least
 * desirable, since breadth across the subject desks is what `./sources.ts` was
 * restructured for. So it stays a bound on concentration, not a volume knob.
 */
export const CA_DEFAULT_MAX_PER_SOURCE = 15;

/** Run-wide ceiling on items taken. See the header for the full derivation. */
export const CA_DEFAULT_MAX_TOTAL = 70;
