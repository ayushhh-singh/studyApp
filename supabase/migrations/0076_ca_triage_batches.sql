-- =============================================================================
-- 0076_ca_triage_batches.sql — the exactly-once ledger for BATCHED CA triage.
--
-- WHY THIS TABLE EXISTS
-- Triage (is this RSS item relevant / which syllabus nodes does it map to?) is
-- the CA pipeline's highest-frequency LLM call — one per feed item, every run,
-- and ~94% of its prompt is the syllabus candidate list. The Message Batches
-- API prices it at 0.5x, but a batch is ASYNCHRONOUS (up to 24h), while
-- `ca:run` is a cron job with a bounded workflow budget. So triage moves off
-- the synchronous path and becomes two phases in DIFFERENT processes:
--
--   PHASE 1 (submit)  a run claims the new items it just read from RSS, posts
--                     them as one Message Batch, and exits. Nothing is enriched
--                     or published for those items yet.
--   PHASE 2 (collect) a LATER run checks whether an earlier batch has ended,
--                     pulls its results, and continues the pipeline from there.
--
-- Between the two phases the ONLY record of what is in flight is this table, so
-- it has to carry both the attribution needed to bill the call correctly and
-- the item payload needed to resume the pipeline in a process that never saw
-- the original RSS fetch.
--
-- WHY THE PARTIAL UNIQUE INDEX IS LOAD-BEARING
-- The same item WILL be re-read from RSS on every run in the window between
-- submit and collect: it has not been inserted into current_affairs_items yet
-- (that only happens after triage+enrich), so the pipeline's existing
-- content_hash dedupe cannot see it. Without a lock, run N+1 would submit it
-- into a second batch and we would pay for — and later process — the same item
-- twice. `ca_triage_batches_inflight_hash_uidx` is that lock: at most ONE
-- claimed-or-pending row may exist per content_hash, so a second submission
-- attempt fails with 23505 and is skipped. The index is PARTIAL on purpose —
-- once a row reaches a terminal state ('collected'/'failed') it stops blocking,
-- which is what lets a failed item legitimately re-enter via RSS on a later run.
--
-- STATUS MACHINE (every row ends in exactly one terminal state)
--   claimed    → the lock is held, but the Anthropic batch does not exist yet
--                (batch_id is NULL). A process that dies here leaves an orphan;
--                the collect phase's reaper DELETES claimed rows older than
--                CLAIM_TTL_MINUTES, releasing the hash so RSS re-feeds the item.
--   pending    → submitted; batch_id + submitted_at are set. A crash mid-collect
--                leaves the row here, so the next run simply retries it. Retry is
--                safe because the downstream insert is keyed on content_hash.
--   collected  → results applied. Terminal.
--   failed     → unrecoverable (batch errored/expired, or the row outlived
--                PENDING_TTL_HOURS). Terminal; the item may re-enter via RSS.
--
-- Internal table: RLS on with NO policy at all, so only the service role (which
-- bypasses RLS) can touch it — same pattern as embeddings / llm_calls /
-- generation_batches (see 0053 §6). Nothing is granted to anon/authenticated.
-- =============================================================================

create table public.ca_triage_batches (
  id            uuid primary key default gen_random_uuid(),
  -- NULL while the row is only 'claimed' (the lock is taken before the
  -- Anthropic batch exists); set to the real batch id at submission.
  batch_id      text,
  -- Unique within a batch; the key every Message Batches result is returned by.
  custom_id     text not null,
  -- sha256 of the item's link — the SAME dedupe key current_affairs_items.content_hash
  -- uses, which is what makes the in-flight lock and the final insert agree.
  content_hash  text not null,
  status        text not null default 'claimed'
                check (status in ('claimed', 'pending', 'collected', 'failed')),
  -- Everything the collect phase needs to resume the pipeline for this item
  -- without re-reading RSS: link/title/snippet/date/source + the syllabus
  -- candidate ids the model was actually SHOWN (post pre-filter), so the
  -- response can be validated against the same set it chose from.
  payload       jsonb not null,
  submitted_at  timestamptz,
  collected_at  timestamptz,
  last_error    text,
  created_at    timestamptz not null default now()
);

-- THE ANTI-DOUBLE-SUBMIT LOCK (see the header): at most one in-flight row per
-- item. A concurrent/duplicate submission attempt hits 23505 and is skipped
-- rather than paying for the item a second time. Partial so terminal rows stop
-- blocking and a failed item can legitimately be retried from RSS later.
create unique index ca_triage_batches_inflight_hash_uidx
  on public.ca_triage_batches (content_hash)
  where status in ('claimed', 'pending');

-- custom_id is only guaranteed unique WITHIN a batch (it is the key results are
-- returned by), so the uniqueness is scoped to batch_id and skips claimed rows.
create unique index ca_triage_batches_batch_custom_uidx
  on public.ca_triage_batches (batch_id, custom_id)
  where batch_id is not null;

-- Reaper + "what is still pending?" queries.
create index ca_triage_batches_status_created_idx
  on public.ca_triage_batches (status, created_at);

comment on table public.ca_triage_batches is
  'Exactly-once ledger for CA triage submitted to the Anthropic Message Batches API: one row per item, submitted in one process and collected in a later one (migration 0076).';

alter table public.ca_triage_batches enable row level security;
revoke all on public.ca_triage_batches from anon, authenticated;
