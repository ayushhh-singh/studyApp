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
 * 1. THE BUDGET IS THE BINDING CONSTRAINT ON A TYPICAL RUN. 3,369 items were
 *    taken in the 21 days to 2026-08-12, and the direct evidence is the run
 *    log itself: it prints "budget spent (max-total=N)" with items left
 *    unprocessed, and at the 40 budget there were 188 fresh eligible items
 *    left behind (see 2). Clustering those items by >20-min gaps: 99 runs, a
 *    MEDIAN of 38 items against the 40 cap, 47% landing in 38-42.
 *
 *    ⚑ CORRECTED FROM AN EARLIER DRAFT OF THIS FILE, which claimed the budget
 *    binds on EVERY run and read 160.4 items/day as "exactly 4 runs x 40".
 *    Both were too neat. There are 4.7 item-clusters/day, not 4 — manual and
 *    dev-scheduler runs happen on top of the 6-hourly cron — and 49 of 99
 *    clusters came in under 38, i.e. supply or dedupe ran out on that tick
 *    before the budget did. "Binds on a typical run" is what the data
 *    supports; "saturated on every run" is not.
 *
 * 2. SUPPLY IS NOT THE LIMIT. Fetching all 11 feeds and applying the pipeline's
 *    own local filter (unseen + dated + inside `--days`), there were 228 fresh
 *    eligible items waiting at `--days 3`. A run took 40 and left 188 behind.
 *    129 of those were under 24h old, so this is standing daily supply, not a
 *    one-off backlog.
 *
 * 3. REVIEWER CAPACITY IS NOT THE LIMIT — but REVIEWER LATENCY partly is, and
 *    the two must not be conflated. This is the first thing to re-check if the
 *    budget is ever raised again. Every CA question is inserted `needs_review`
 *    and a human approves it before a student sees it (measured: ZERO rows are
 *    ever inserted already-approved), so the reviewer sits between generation
 *    and every downstream sitting.
 *
 *    CAPACITY is not close to troubled: backlog 25, all of it under 24h old,
 *    against a DEMONSTRATED 778 questions actioned in one day (2026-08-11),
 *    858 on 2026-07-23, 1,889 lifetime — versus generation at ~30-47/day.
 *
 *    ⚑ LATENCY IS THE REAL COST, AND IT CAPS THE CONVERSION RATE. A daily
 *    sitting draws on `questions.created_at` within [day-1, day+1) AND
 *    approved (`approvedCaQuestionIds` in ./assemble.ts) — so a question has
 *    roughly ONE DAY to be approved or it never enters that day's sitting.
 *    Measured on questions created in the last 7 days: p50 21.9h to a review
 *    decision, 53% within 24h, 63% within 48h. So only about HALF of what is
 *    generated reaches the sitting it was generated for.
 *
 *    That does not argue against raising the budget — it argues FOR it, since
 *    the shortfall is roughly a factor of two and volume is the only lever
 *    that does not require the reviewer to change habits. But do not read
 *    "the reviewer has 20x headroom" as "generation converts 1:1". It does
 *    not, and the lifetime p50 (209h) is far worse than the 7-day figure
 *    because it is dominated by historical catch-up bursts — quote the recent
 *    window, not the lifetime one.
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
 *    the daily mains cap x 2 live exams.
 *
 * ⚑ WHETHER 70 CLOSES THE MAINS GAP DEPENDS ON A CAP THAT MOVED THE SAME DAY.
 * Against the ORIGINAL cap of 5/day/exam the answer was no: demand 10/day, and
 * 70 lifts ~160 -> ~280 items/day, i.e. ~6.6 -> ~11.5 mains-3 items/day, which
 * at the measured conversion (the verification run turned 8 mains-3 items into
 * 5 descriptive questions — a question is generated per RELEVANT exam, and not
 * every item is mains-3 for both) is ~7.2 questions/day. Short of 10.
 *
 * `DAILY_MAINS_MAX` was then lowered 5 -> 3 (./assemble.ts, and the reasoning
 * there is daily student load, not this arithmetic), which puts demand at
 * 6/day — so **~7.2 vs 6 now closes it, with roughly 20% margin**, and at the
 * 11.4% mains-3 rate the verification run actually showed it closes to ~20/day.
 *
 * TREAT THAT AS PLAUSIBLE, NOT PROVEN. Both figures lean on one run's
 * conversion ratio, and its 11.4% is 2.8x the 4.1% historical baseline — the
 * new subject desks may genuinely have raised it by supplying real policy
 * issues rather than general news, or that batch may simply have been rich.
 * Same signature, different causes. Measure the `mains == 3` rate over a few
 * days at this volume before concluding. If it reverts toward 4.1%, the next
 * lever is a second descriptive question from an item rich enough for two —
 * a prompt/quality change needing its own validation, not a knob.
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
 * `ca-run.yml`'s `timeout-minutes` (plus ~2 min checkout/install):
 *
 *   maxTotal   2 exams typical / worst    3 exams typical / worst
 *      40           11 /  18 min               14 /  23 min
 *      70           19 /  31 min               25 /  40 min     <- shipped
 *     100           27 /  44 min               36 /  58 min     <- BLOWS IT
 *
 * 70 is therefore the largest value that keeps even a worst-observed-rate run
 * inside a 50-minute timeout AFTER a third exam goes live. 100 would need the
 * workflow timeout raised as well, and would still not fill the mains sitting.
 * If this is ever raised past 70, raise `timeout-minutes` in the same commit.
 *
 * ⚑ AND THE TABLE ABOVE ASSUMES ONE BATCH PER RUN, WHICH IS NOT GUARANTEED.
 * `collectBatch` is called in a loop over every entry `listPendingBatches()`
 * returns, so a batch that has not finished before the next 6h tick submits
 * another leaves the run after that collecting BOTH. Measured over 97 real
 * batches: submit->collect p50 5.47h against the 6h cadence, and 1 of 95
 * collect events (1%) collected 2 batches (max ever 2). At 2 x 70 = 140 items
 * the same arithmetic gives 40 min typical / 63 worst at two exams — so the
 * OLD 40 budget was safe even on a double-collect (24/37) and 70 was not.
 * `ca-run.yml`'s timeout was raised 50 -> 75 in the same pass to cover it; the
 * reasoning and what is still deliberately uncovered live there.
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
 * Per-source ceiling for one run. DELIBERATELY UNCHANGED at 70, on measurement:
 * a real run at maxTotal 70 took at most 10 from any one source, so it does not
 * bind. Verified live, not simulated — the run of 2026-08-13T06:24Z reported
 *   national:10/39 india:10/89 livemint:10/14 lucknow:9/9
 *   economy:9/13 science:9/14 environment:4/4 explained:9/20
 * i.e. 70 taken across 8 productive desks, two of them drained to empty with
 * their unused share flowing to the others. That is rotation working.
 *
 * ⚑ BUT IT IS ALSO A HARD CEILING ON MAX_TOTAL, WHICH IS EASY TO MISS. The most
 * a run can ever take is `sum over sources of min(supply, MAX_PER_SOURCE)`. On
 * that same measured supply that is 99 — so raising MAX_TOTAL past ~85 buys
 * progressively less and past 99 buys NOTHING AT ALL until MAX_PER_SOURCE is
 * raised with it. An earlier draft of this comment claimed raising it "would
 * change behaviour only on days when few desks have anything"; that is wrong,
 * and it is wrong in the direction that matters — it would have let someone
 * raise MAX_TOTAL to 120 and quietly get 99.
 *
 * It nevertheless stays at 15 HERE, because at MAX_TOTAL 70 the binding
 * constraint is the wall clock (see above), not this. When the two are raised
 * together, note what changes: the subject desks added by `./sources.ts` are
 * SHALLOW (economy 13, science 14, environment 4 fresh items in that run) while
 * the general national feeds are deep (39 and 89), so every item above ~85 comes
 * disproportionately from the general feeds. Measured on that supply, the three
 * general feeds' share of a run goes 40.0% at MAX_TOTAL 40 -> 42.9% at 70 ->
 * 44.4% at the 99 ceiling. Modest, but it only moves one way, and re-concentrating
 * on the general feeds is precisely what `./sources.ts` was restructured to undo.
 */
export const CA_DEFAULT_MAX_PER_SOURCE = 15;

/** Run-wide ceiling on items taken. See the header for the full derivation. */
export const CA_DEFAULT_MAX_TOTAL = 70;
