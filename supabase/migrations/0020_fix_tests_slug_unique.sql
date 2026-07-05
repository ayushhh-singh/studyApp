-- 0020_fix_tests_slug_unique.sql
-- Same fix as 0019, for tests.slug: 0018 created a PARTIAL unique index
-- (`where slug is not null`), which Postgres cannot use as an ON CONFLICT
-- arbiter for the plain `.upsert(row, { onConflict: "slug" })` that
-- ingest:tests issues. A plain unique index behaves identically (NULLs stay
-- distinct) and fixes the arbiter lookup.

drop index if exists public.tests_slug_key;

create unique index tests_slug_key
  on public.tests(slug);
