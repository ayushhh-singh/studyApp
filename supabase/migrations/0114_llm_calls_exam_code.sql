-- 0114_llm_calls_exam_code.sql
-- Adds a nullable `exam_code` to llm_calls so per-exam LLM spend is separable.
--
-- WHY, and why this does NOT contradict 0106 §13.
--   0106's decision table lists "llm_calls / ca_triage_batches / generation
--   telemetry — EXAM-AGNOSTIC ops data", and that stays TRUE in the sense it was
--   written: llm_calls is not a user-visible, RLS-scoped, per-exam entity, and
--   nothing about which exam a call served changes who may read the row (it is
--   service-role-only, 0053 §5). What 0106 was deciding is ACCESS SCOPING.
--
--   This column answers a different question — COST ATTRIBUTION. With a second
--   exam's content pipelines about to run (U5's UPSC PYQ ingest landed; a UPSC
--   chapter rollout is next), `pnpm cost:report` can currently only say what the
--   PLATFORM spent, never what `upsc` spent versus `uppsc`. Without that split
--   there is no way to check a signed-off per-exam cost projection against
--   reality, and no way to notice one exam's pipeline quietly costing several
--   times its budget while the platform total looks unremarkable.
--
-- NULLABLE, and NO foreign key — both deliberate:
--   * NULLABLE because many calls are GENUINELY exam-agnostic, not merely
--     un-stamped: `translate`/`translateBatch` at ingest time, community post
--     screening, OCR transcription of a handwritten page. A `not null default`
--     would force those to claim an exam they do not serve, which is worse than
--     an honest NULL — cost:report reports NULL as `(shared/untagged)` rather
--     than silently folding it into the default exam.
--   * NO FK to exams(exam_code) because llm_calls is a HIGH-VOLUME, best-effort
--     INSERT path (lib/anthropic.ts's recordLlmCall never fails the caller's
--     actual model request). An FK adds a per-insert lookup and, worse, turns a
--     bad/renamed code into a 23503 that would silently drop a usage row — cost
--     telemetry must never be the thing that breaks. This mirrors the same
--     reasoning as questions.exam_code (0036), which is a CHECK, not an FK.
--     Note the value here is the SERVING exam ("whose pipeline paid for this"),
--     which is not the same axis as questions.exam_code's PROVENANCE ("which
--     commission asked this"); see docs/multi-exam.md §0a.
--
-- BACKFILL: none. Every existing row predates any stamping, so its true value is
--   unknown, and inventing `uppsc` for all of them would be a guess presented as
--   data — the vast majority WOULD be uppsc, but the U5 ingest's ~$61 of UPSC
--   extraction spend is in this table too, and a blanket backfill would file it
--   under the wrong exam permanently. Historical rows stay NULL and report as
--   `(shared/untagged)`, which is the honest reading.
--
-- Call sites are NOT stamped by this migration or its commit. Threading
--   `examCode` through lib/anthropic.ts is optional-by-design so ~60 call sites
--   do not all have to decide in one change; per-pipeline commits stamp them
--   afterwards. Until then every row reports as untagged, which is expected.
--
-- Hand-replayable (docs/OUTSTANDING.md M14): `add column if not exists` +
--   `create index if not exists`. Postgres supports IF NOT EXISTS for both of
--   these (unlike CREATE TRIGGER / CREATE POLICY, which need a drop-first
--   idempotency dance — none is needed here, this migration creates neither).

alter table public.llm_calls
  add column if not exists exam_code text;

comment on column public.llm_calls.exam_code is
  'Which exam''s pipeline this call served (uppsc/upsc/mppsc). NULLABLE = genuinely exam-agnostic (ingest translate, community screening, OCR) or not yet stamped; cost:report shows both as "(shared/untagged)". Not FK-constrained: this is a best-effort high-volume telemetry insert that must never fail the model call it records.';

-- Supports cost:report's grouping shape: filter/group by exam, then purpose,
-- over a trailing time window (the report's only WHERE is `created_at >= since`).
-- Leading with exam_code keeps the existing llm_calls_purpose_idx useful for the
-- exam-agnostic queries rather than duplicating it.
create index if not exists llm_calls_exam_purpose_idx
  on public.llm_calls (exam_code, purpose, created_at desc);
