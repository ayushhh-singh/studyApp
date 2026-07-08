# Mastery engine

Per-user, per-syllabus-node **mastery** — the game skin (unseen → bronze → silver
→ gold → exam-ready territory) over honest spaced-repetition logic. It exists to
answer one question the aspirant actually has: _"which parts of the syllabus have
I actually secured for the exam, and which are slipping?"_

Nothing here is cosmetic-only: a node earns a high level **only** by recent,
broad, accurate practice, and loses it by neglect — exactly the signal that
should drive what you revise next.

## Where it lives

- Table: `node_mastery` (`0043_node_mastery.sql`) — one row per `(user_id, syllabus_node_id)`.
- Thresholds & factor constants: [`apps/api/src/mastery/config.ts`](../apps/api/src/mastery/config.ts) — **config, not code**. Change the numbers there; the formula below reads them.
- Compute + read: [`apps/api/src/mastery/compute.ts`](../apps/api/src/mastery/compute.ts).
- Endpoint: `GET /api/v1/mastery?paper=<CODE>` → the Conquest Map payload (every node of the paper annotated with mastery + PYQ weight). `paper` omitted → all papers.

## The formula

Mastery is scored on the **graded MCQ answers** attributed to a node — and, because
`syllabus_nodes` uses a materialized path, rolled **up the tree**: a section node
aggregates every answer from every topic beneath it (a question at path `a/b/c`
counts toward `a/b/c`, `a/b`, `a`, and the paper root `""`).

For a node's aggregated answers, let:

- `attempted` = number of graded answers (an answer is graded once its attempt is submitted),
- `correct` = how many were right,
- `lastPractised` = the most recent submit timestamp among them.

Then three factors, each in `[0, 1]`:

```
accuracy = correct / attempted
volume   = min(1, attempted / VOLUME_TARGET)                    VOLUME_TARGET = 15
recency  = 0.5 ^ (daysSinceLastPractised / RECENCY_HALF_LIFE)   RECENCY_HALF_LIFE = 30 days
```

and the score:

```
score = round( 100 · accuracy · volume · recency )     // 0–100
```

### Level thresholds (`config.ts`)

| Level        | Score ≥ |
| ------------ | ------- |
| `exam_ready` | 80      |
| `gold`       | 60      |
| `silver`     | 35      |
| `bronze`     | 1       |
| `unseen`     | no attempts (`attempted = 0`) |

### Why each factor

- **accuracy** — getting questions right is the point. On its own it's a liar: 2/2 is 100% but proves nothing.
- **volume** — breadth guards against the small-sample lie. You need ~`VOLUME_TARGET` recent questions on a node before full credit; below that, mastery is capped proportionally.
- **recency** — the honest-SRS core. It is a pure function of _time since you last touched the node_, halving every 30 days. This is what makes **Gold fade back to Silver when a node goes untouched**: with no new practice, `accuracy` and `volume` hold but `recency` decays, so the score falls and the level drops. Neglect is punished, exactly as real retention decays.

Worked example: 18 graded answers, 16 correct, practised today →
`accuracy 0.89 · volume 1.0 · recency 1.0 = 89` → **exam-ready**.
Leave it 30 days → `recency 0.5` → `44` → **silver**.
60 days → `recency 0.25` → `22` → **bronze**. The fade is the feature.

## When it recomputes

Mastery is time-dependent (recency decays continuously), so it is settled on a schedule:

1. **After each attempt submit** — `recomputeMastery(userId)` fires best-effort from the submit route (`routes/attempts.ts`). A failure there never fails the submit; it just waits for the nightly pass.
2. **Nightly (00:05 IST)** — the `daily/scheduler.ts` streak-settle cron also recomputes, so an untouched node's decay is reflected even if the app is never opened.
3. **Manually** — `pnpm mastery:build [--user <uuid>]` for backfill.

Recompute is idempotent (upsert on `(user_id, syllabus_node_id)`) and cheap for a
single user. `meta` on each row snapshots the inputs (`attempted`, `correct`,
`accuracy`, `days_since_last`, `last_practiced_at`) so a stale level is explainable
without re-querying.

## Does this help clear UPPCS?

Yes — it's the map of what's secured vs. slipping, weighted by real PYQ frequency
(the Conquest Map sizes each territory by how often UPPSC actually asks it and
pulses the weak-but-high-weight sections). It turns "revise everything" into
"revise _this_ next," and the decay makes sure yesterday's win doesn't masquerade
as today's readiness.
