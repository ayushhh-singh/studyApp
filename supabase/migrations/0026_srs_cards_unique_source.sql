-- 0025_srs_cards_unique_source.sql
-- A given user should never have two srs_cards from the same source (e.g.
-- the same syllabus node added to revision twice). NULLs in source_id never
-- conflict with each other under a standard btree unique index, so this
-- doesn't block manual/freeform cards that have no source row at all.
create unique index if not exists srs_cards_user_source_key
  on public.srs_cards(user_id, source_type, source_id);
