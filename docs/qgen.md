# Question generation (`qgen`) + review surface

AI generation of exam-standard MCQ and Mains-descriptive questions, gated behind
a human Review Queue. Every generated question is `source='generated'`,
`review_state='needs_review'`, `is_published=false` until a reviewer approves it.

## Pipeline (four stages)

`apps/api/src/qgen/` — orchestrated by `generate.ts`.

| Stage | Model | What it does |
| --- | --- | --- |
| **A · generate** | `claude-sonnet-5` (effort `medium`) | Few-shot-conditioned + RAG-grounded bilingual questions, strict JSON. Chunked (5/call) so the cached context block is reused across chunks. |
| **B · critic** | `claude-sonnet-5` (effort `medium`) | Per-question verdict: single-correct / plausible distractors / UPPSC tone / in-syllabus / factual red flags → `approve`. |
| **C · blind verify** | `claude-haiku-4-5` | Answers each MCQ with the key HIDDEN; a mismatch against the intended key auto-rejects (ambiguous stem or wrong key). MCQ only. |
| **D · dedup** | OpenAI `text-embedding-3-small` | Cosine of the stem vs the node's existing bank + the other candidates; ≥ `0.90` → rejected as a duplicate. |

Survivors insert with a full `generation_meta` audit trail (model, prompt
version, difficulty, critic verdict, verify result, dedup near-hits, grounding
`source_context_ids`, `batch_id`). Each run records one `generation_batches`
row (`requested_count` / `accepted_count` / `cost_usd`).

### Few-shot conditioning + grounding (cached)

Stage A's system prompt is two segments: a fixed instruction block, then a
**per-node context block (`cache: true`)** = 5–8 real published PYQs mapped to
the node (node-scoped first, then paper-level) + RAG passages retrieved from the
`embeddings` store for the node. Byte-identical across a node's chunks, so
chunks 2+ read it from the prompt cache (Anthropic ephemeral, ~2048-token
minimum on sonnet — the block clears it easily).

### Descriptive variant

Mains-style questions with a directive verb (examine / critically analyse / …),
realistic marks + word limit, and a bilingual **marking-points outline** stored
in `generation_meta.marking_points_i18n` for the answer evaluator to ground on.
Stage C (blind verify) is skipped (no single correct answer).

## Commands

```bash
# Interactive, synchronous (structuredJson):
pnpm qgen --node <uuid|PAPER_CODE> --count N --kind mcq|descriptive [--difficulty e:m:h]
pnpm qgen --node <uuid> --count 20 --kind mcq --batch   # force the batch path

# Nightly top-up (Message Batches, 50% cheaper) — every top-level node keeps
# >= 40 published MCQs (prelims) and >= 8 descriptive (mains); generate only the
# shortfall, bounded by QGEN_BATCH_MAX_USD.
pnpm qgen:topup [--max-usd N] [--kind mcq|descriptive] [--dry-run]
```

`--node` accepts a syllabus-node uuid or a paper code (→ that paper's root node,
for broad paper-level few-shot/grounding).

### Batch (Message Batches API)

The nightly top-up pipelines stage-by-stage through the batch helper in
`lib/anthropic.ts` (`runBatch` — submit, poll `processing_status` to `ended`,
collect keyed by `custom_id`): one batch for all Stage-A chunks across all
nodes, then one for all critics, then one for all verifies. Batch rows are
priced at 0.5× and tagged `llm_calls.meta.batch=true`. Interactive/dev runs stay
synchronous.

## Review Queue

`/:locale/review`, gated by `ADMIN_MODE=true` (server env; the SPA learns it from
`GET /admin/status` and hides the queue otherwise — becomes an `is_admin`
profile flag in Session 18b). Card-at-a-time, keyboard **j/k** navigate, **a**
approve, **e** edit-then-approve, **r** reject; bulk-approve for high-confidence
(blind-verify agreed, no factual flags, gate passes). Four tabs: generated MCQs,
generated descriptive, machine-translated PYQ content (audit surface — approving
stamps `meta.human_verified`), and the `ca:run` current-affairs MCQs (finally
reviewable).

**Approve** = `review_state='approved'` + `is_published=true` iff the bilingual
publish gate passes (the DB trigger from 0005/0017 blocks publishing an
incomplete row; `is_published` is derived from the stored `publish_gate_ok`).
User-facing visibility (`lib/question-visibility.ts`) now requires
`is_published AND review_state='approved'` — so a generated question is invisible
everywhere until approved.

## Prompt versions

`QGEN_PROMPT_VERSION` in `qgen/prompts.ts`. Bump on any prompt change; it is
recorded in each row's `generation_meta.prompt_version` and in
`generation_batches.meta.prompt_version`.

| Version | Date | Notes |
| --- | --- | --- |
| `qgen-v1` | 2026-07-06 | Initial. MCQ + descriptive generation, single-correct/plausibility/tone/syllabus/facts critic, blind-verify (MCQ), cosine dedup @ 0.90. Acceptance: 20 MCQs for "Panchayati Raj and Local Governance" → 15 accepted (75% approvable-untouched; rejected critic 1, verify 1, dedup 3), first run, no iteration. |

## Cost

`pnpm cost:report` breaks out `qgen_*` `llm_calls` (batch rows marked `*`) and a
**cost-per-accepted-question** section from `generation_batches` (sync vs batch).

Observed for `qgen-v1` (sonnet gen + sonnet critic + haiku verify): **~₹2.3 per
accepted question synchronous** (20-MCQ run, few-shot block cached across
chunks). The batch path halves the model spend (~₹1.1–1.4). Targets are ~₹1.5
sync / ~₹0.9 batch — the gap is the sonnet critic, kept deliberately (a weaker
critic lowers the approvable rate that the 75% figure depends on). Revisit if a
cheaper critic still clears the ≥70% bar.

## Config (`apps/api/.env`)

| Var | Default | Purpose |
| --- | --- | --- |
| `ADMIN_MODE` | `false` | Enables `/admin/review/*` + the `/:locale/review` UI. |
| `QGEN_BATCH_MAX_USD` | `5` | Cost ceiling for one `qgen:topup` run; shortfall nodes are trimmed to fit and the rest deferred (logged, never silently dropped). |
