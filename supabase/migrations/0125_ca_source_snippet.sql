-- 0125_ca_source_snippet.sql
-- G2 — retain the RAW SOURCE SNIPPET a current-affairs item was enriched from.
-- Closes docs/OUTSTANDING.md §9 G2.
--
-- ---------------------------------------------------------------------------
-- THE DEFECT THIS CLOSES
-- ---------------------------------------------------------------------------
-- `current_affairs_items` retained NO evidence. `enrichParams` reads the RSS
-- snippet off the IN-FLIGHT `ca_triage_batches.payload` row, and `summary_i18n`
-- is the model's OWN paraphrase of it — so once an item is persisted, the text
-- every downstream claim was derived from is gone from the item entirely.
--
-- Two live consequences, both recorded in §9 G2:
--
--   1. No reviewer can check a shipped fact against its source. The Review
--      Queue shows a generated MCQ and the item's own summary — but the summary
--      is itself model output, so "is this fact real?" can only be answered by
--      re-reading the article by hand, if it is still up.
--
--   2. No before/after test of an enrichment or MCQ prompt change can
--      reproduce the original conditions. This is not hypothetical: the
--      2026-08-08 A/B fed `summary_i18n` back in AS the source and reproduced
--      0 of 16 flagged inventions in EITHER arm — an invalid harness, not a
--      passing result (§9 G6). Panel D's "faithfulness 3.04/5" therefore scored
--      output against a DERIVED reference, so fidelity to the ORIGINAL news
--      text has never been measured at all.
--
-- ---------------------------------------------------------------------------
-- WHY A COLUMN AND NOT A JOIN ONTO ca_triage_batches
-- ---------------------------------------------------------------------------
-- The snippet does survive today in `ca_triage_batches.payload->>'snippet'`,
-- keyed by content_hash — which is how this migration can backfill at all. But
-- that table is a WORK LEDGER, not an archive: rows are settled and reaped
-- (`PENDING_TTL_HOURS`, `CLAIM_TTL_MINUTES` in ca/triage-batch-store.ts), the
-- sync path (`--mode sync`) never writes one, and `ca:backfill` / `ca:widen-exam`
-- reconstruct a PSEUDO-snippet from the stored summary rather than the original.
-- Evidence that is reaped on a timer is not evidence. It lives on the item.
--
-- ---------------------------------------------------------------------------
-- ⚑ THE GRANT BLOCK BELOW IS LOAD-BEARING — READ BEFORE ADDING A COLUMN
-- ---------------------------------------------------------------------------
-- This is publisher text. The whole CA design is built around never mirroring
-- it: `ca/prompts.ts`'s header states "the RSS title/snippet is only ever
-- CONTEXT — every persisted string is a fresh paraphrase", and the enrichment
-- prompt instructs the model in as many words never to copy a sentence
-- verbatim. Today the snippet is protected accordingly: `ca_triage_batches`
-- carries `revoke all ... from anon, authenticated` (0076).
--
-- `current_affairs_items` is the OPPOSITE — 0053's `content_read` policy is
-- `for select to anon, authenticated using (is_published)`, and 0015 grants
-- table-level SELECT to both roles. So adding this column naively would take
-- publisher article text from service-role-only to WORLD-READABLE with the
-- anon key, on every published row. That is a downgrade of protection, not a
-- neutral schema addition.
--
-- Postgres will not let a column-level REVOKE do this: per the REVOKE docs, "if
-- a role has been granted privileges on a table, then revoking the same
-- privileges from individual columns will have no effect." The table-level
-- grant must go, and every OTHER column be re-granted individually.
--
-- ⚑ CONSEQUENCE, AND IT IS THE REASON THIS COMMENT IS THIS LONG: after this
-- migration `anon`/`authenticated` hold COLUMN-level SELECT on this table, so a
-- FUTURE `alter table ... add column` is NOT automatically readable by them and
-- a bare `select *` as anon will fail 42501. **A new column on this table needs
-- its own `grant select (col) on public.current_affairs_items to anon,
-- authenticated;` unless it is deliberately internal like this one.**
--
-- This breaks nothing today, and the reason is architectural rather than lucky:
-- every application read of this table goes through Express with the SERVICE
-- ROLE (CLAUDE.md's Architecture section — the one documented exception to that
-- rule is Supabase Storage, not this table), and `service_role` keeps its
-- unrestricted table-level grant below. The anon path is defense-in-depth only.
-- The grant is derived from the live catalog rather than a hand-written column
-- list precisely so it cannot drift from the table it describes.
--
-- ---------------------------------------------------------------------------
-- REPLAYABLE (M14). Every statement is idempotent, and the closing assertions
-- check the SCHEMA (nullable, no default, not anon-readable) rather than a row
-- count — a count assertion is true exactly once, at first apply, and false
-- from the moment the pipeline writes its first row. That is the exact defect
-- 0116's first cut shipped with; see docs/OUTSTANDING.md §8b.
-- ---------------------------------------------------------------------------

-- 1. The column. Nullable with NO default, and both properties are meaningful:
--    NULL means "this row predates snippet retention (or its snippet could not
--    be recovered)", which is a genuinely different state from "the source
--    carried an empty snippet" (''). A `not null default ''` would erase that
--    distinction on all ~5,178 existing rows and make the backfill unverifiable.
alter table public.current_affairs_items
  add column if not exists source_snippet text;

comment on column public.current_affairs_items.source_snippet is
  'Raw RSS title/snippet the item was triaged and enriched FROM — the evidence '
  'every derived claim traces back to (G2). INTERNAL ONLY: publisher text, '
  'never served to a client. Deliberately excluded from CURRENT_AFFAIRS_COLUMNS '
  'and from the anon/authenticated column grants below. NULL = predates '
  'retention or unrecoverable.';

-- 2. Backfill from the triage ledger while those rows still exist. Matched on
--    content_hash, which is the pipeline's own identity for an item (0031's
--    partial unique index) and is carried verbatim on both tables. Only fills
--    rows that are still NULL, so a replay is convergent and can never
--    overwrite a snippet the pipeline has since written for real.
update public.current_affairs_items ca
   set source_snippet = b.payload ->> 'snippet'
  from public.ca_triage_batches b
 where b.content_hash = ca.content_hash
   and ca.source_snippet is null
   and nullif(btrim(coalesce(b.payload ->> 'snippet', '')), '') is not null;

-- 3. Close the exposure described above.
revoke select on public.current_affairs_items from anon, authenticated;

do $$
declare
  col text;
begin
  for col in
    select c.column_name
      from information_schema.columns c
     where c.table_schema = 'public'
       and c.table_name   = 'current_affairs_items'
       and c.column_name <> 'source_snippet'
  loop
    execute format(
      'grant select (%I) on public.current_affairs_items to anon, authenticated',
      col
    );
  end loop;
end $$;

-- service_role must keep unrestricted access: it is what the API and every
-- ingest CLI actually use, and it is the ONLY role that may read the snippet.
grant select on public.current_affairs_items to service_role;

-- 4. Assert the end state.
do $$
begin
  -- 4a. The column exists, is nullable, and has no default.
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'current_affairs_items'
       and column_name  = 'source_snippet'
       and is_nullable  = 'YES'
       and column_default is null
  ) then
    raise exception
      '0125: current_affairs_items.source_snippet must exist, be nullable and carry no default '
      '(NULL is the load-bearing "predates retention" sentinel)';
  end if;

  -- 4b. anon/authenticated must NOT be able to read it. This is the whole point
  --     of the grant block; asserting it means a future table-wide `grant
  --     select` that silently re-exposes the column fails this migration on
  --     replay instead of going unnoticed.
  if has_column_privilege('anon', 'public.current_affairs_items', 'source_snippet', 'SELECT')
     or has_column_privilege('authenticated', 'public.current_affairs_items', 'source_snippet', 'SELECT')
  then
    raise exception
      '0125: source_snippet is readable by anon/authenticated — it is publisher text and must be '
      'service-role only (see the grant block above)';
  end if;

  -- 4c. ...while the rest of the table stays readable by them, so the revoke
  --     above cannot have quietly taken the public feed down with it.
  if not has_column_privilege('anon', 'public.current_affairs_items', 'title_i18n', 'SELECT')
     or not has_column_privilege('anon', 'public.current_affairs_items', 'status', 'SELECT')
  then
    raise exception
      '0125: the anon column re-grant did not cover the normal content columns';
  end if;
end $$;
