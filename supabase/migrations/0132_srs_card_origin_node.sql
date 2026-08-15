-- 0132 — srs_cards.origin_node_id: where a revision card came from.
--
-- WHY A NEW COLUMN AND NOT `source_id`. `source_id` is overloaded and only
-- SOMETIMES a resolvable reference: it is a real id for question cards (a
-- question), node cards (a syllabus node) and evaluation cards (a submission),
-- but a sha256-DERIVED uuid for note-deck/block cards and current-affairs facts
-- (the idempotency key for "one card per fact", see services/srs.ts and
-- services/notes.ts). A hash cannot be resolved back to anything, so "take me to
-- the chapter this came from" is not answerable from `source_id` — measured
-- 2026-08-16, only 37 of 132 live cards (28%) could name their origin at all.
--
-- That matters because a revision card is currently a DEAD END: when recall
-- fails, the card tells you the answer and offers no way to go and actually
-- re-read the topic. This column is what makes that link possible.
--
-- SEMANTICS. `origin_node_id` is the syllabus topic a card is revision FOR — not
-- a foreign key to whatever object created it. It is deliberately nullable and
-- best-effort: a hand-written card has no origin, and a current-affairs fact
-- legitimately spans several nodes (`current_affairs_items.syllabus_node_ids` is
-- an array), so forcing one would be a guess. NULL means "no source to link to",
-- which the UI renders as no link rather than a broken one.
--
-- ON DELETE SET NULL, not CASCADE: retiring a syllabus node must never delete a
-- user's revision card. Losing the link is acceptable; losing the card is not.
alter table public.srs_cards
  add column if not exists origin_node_id uuid references public.syllabus_nodes(id) on delete set null;

comment on column public.srs_cards.origin_node_id is
  'Syllabus topic this card is revision for, for the "re-read the chapter" link. Nullable and best-effort — see 0132. Populated at write time by services/srs.ts + services/notes.ts, and repaired by backfillCardOriginNodes() (nightly + `pnpm srs:refresh-cards`), which also recovers the sha256-derived note-card ids that SQL cannot reverse.';

-- Backfill the two cases SQL can resolve directly. The sha256-derived ones
-- (note decks/blocks) are recovered by backfillCardOriginNodes() in TypeScript
-- instead, deliberately: it reuses services/notes.ts's OWN `noteSourceId`
-- rather than reimplementing the hash-to-uuid formatting in SQL, where a second
-- copy could silently drift and match nothing (this repo has been bitten by
-- exactly that class of duplication before).

-- (a) question cards -> the question's syllabus node.
update public.srs_cards c
   set origin_node_id = q.syllabus_node_id
  from public.questions q
 where c.source_type = 'question'
   and c.source_id = q.id
   and q.syllabus_node_id is not null
   and c.origin_node_id is null;

-- (b) node cards (addNodeToRevision stores the node id itself in source_id).
update public.srs_cards c
   set origin_node_id = c.source_id
  from public.syllabus_nodes n
 where c.source_type = 'manual'
   and c.source_id = n.id
   and c.origin_node_id is null;

-- Replayable assertion: assert the SCHEMA, never a row count. A count-based
-- check ("no row is non-null") is true exactly once and false forever after,
-- which is the M14 defect this repo has already had to fix once.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'srs_cards' and column_name = 'origin_node_id'
       and is_nullable = 'YES' and column_default is null
  ) then
    raise exception '0132: srs_cards.origin_node_id must exist, be NULLABLE and have NO default — a NOT NULL default would make "no origin" indistinguishable from a real one';
  end if;
end $$;
