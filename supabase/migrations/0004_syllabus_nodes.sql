-- 0004_syllabus_nodes.sql
-- The full UPPSC syllabus as a self-referencing tree.

create table public.syllabus_nodes (
  id               uuid primary key default gen_random_uuid(),
  exam_stage       exam_stage  not null,
  paper_code       text        not null,           -- e.g. GS1, GS2, CSAT, ESSAY, GS5_UP, GS6_UP
  parent_id        uuid        references public.syllabus_nodes(id) on delete cascade,
  title_i18n       jsonb       not null,
  description_i18n jsonb,
  order_index      int         not null default 0,
  depth            int         not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index syllabus_nodes_parent_idx on public.syllabus_nodes(parent_id);
create index syllabus_nodes_paper_idx  on public.syllabus_nodes(exam_stage, paper_code, order_index);

create trigger trg_syllabus_nodes_updated_at
  before update on public.syllabus_nodes
  for each row execute function public.set_updated_at();
