-- 0068_magazine_deep_dives.sql
-- Storage for the Mains Analysis edition's five monthly Deep Dives — the one
-- piece of the two-edition magazine that isn't pure assembly from already-
-- published current_affairs_items/questions. A deep dive is a longer sonnet-
-- synthesized analysis of one of the month's top issues (ranked by
-- mains_relevance + syllabus weightage), grounded on that issue's own
-- mains_brief + related items + RAG-retrieved notes/PYQs. It goes through the
-- Review Queue's new Magazine tab (needs_review -> published|rejected) before
-- ever appearing in the public Mains Analysis document.
--
-- Everything else in both editions (Prelims Compendium, the rest of Mains
-- Analysis) is computed on demand from current_affairs_items/questions, same
-- as the single-edition magazine before it — no new table needed for those.

create table public.magazine_deep_dives (
  id uuid primary key default gen_random_uuid(),
  month text not null check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  rank smallint not null check (rank between 1 and 5),
  status text not null default 'needs_review' check (status in ('needs_review', 'published', 'rejected')),

  title_i18n jsonb not null,
  intro_i18n jsonb not null,
  -- Bilingual list of analysis paragraphs — {hi:[...], en:[...]}, aligned length.
  synthesis_i18n jsonb not null,
  significance_i18n jsonb not null default '{"hi":[],"en":[]}'::jsonb,
  challenges_i18n jsonb not null default '{"hi":[],"en":[]}'::jsonb,
  way_forward_i18n jsonb not null default '{"hi":[],"en":[]}'::jsonb,
  keywords_i18n jsonb not null default '{"hi":[],"en":[]}'::jsonb,
  case_examples_i18n jsonb not null default '{"hi":[],"en":[]}'::jsonb,

  gs_papers text[] not null default '{}'::text[],
  syllabus_node_ids uuid[] not null default '{}'::uuid[],
  -- current_affairs_items this deep dive was synthesized from (the ranked
  -- issue item + its related items in the same month/node cluster).
  source_item_ids uuid[] not null default '{}'::uuid[],
  -- Citation registry (RAG chunks + source items), same {id,title,url} shape
  -- as notes.sources.
  sources jsonb not null default '[]'::jsonb,

  model text,
  cost_usd numeric not null default 0,
  -- Free-form generation audit blob (batch id, request custom_id, etc).
  meta jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One deep dive per rank slot per month — regenerating a month replaces
  -- these rows (see ca/deepdive.ts) rather than accumulating duplicates.
  unique (month, rank)
);

create trigger set_updated_at
  before update on public.magazine_deep_dives
  for each row execute function public.set_updated_at();

create index magazine_deep_dives_month_idx on public.magazine_deep_dives(month);
create index magazine_deep_dives_status_idx on public.magazine_deep_dives(status);

alter table public.magazine_deep_dives enable row level security;

-- Public read once published (mirrors notes/questions/current_affairs_items'
-- content_read shape from 0053/0056). Writes are service-role only (the API
-- always talks to Postgres with the service role) — no insert/update/delete
-- policy for anon/authenticated.
create policy content_read on public.magazine_deep_dives
  for select to anon, authenticated using (status = 'published');
