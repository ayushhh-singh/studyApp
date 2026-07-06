-- 0041_exam_cutoffs.sql
-- Official UPPSC Prelims cut-off marks by year + category, so a mock-test result
-- can show "how you'd stack up" against recent real cut-offs. The Prelims
-- cut-off is on GS Paper-I only, out of 200 (CSAT/Paper-II is qualifying at 33%
-- and does not count toward it).
--
-- Figures verified this session across UPPSC's own cut-off PDFs + 3-4 coaching
-- aggregators (theIAShub, pw.live, studyiq, testbook) — NEVER seeded from
-- memory (per CLAUDE.md's exam-date sourcing policy). 2021-2023 are strongly
-- corroborated (is_official=true); 2024 is single-host provenance and notably
-- lower than trend, so it is flagged is_official=false pending a primary
-- re-confirmation against uppsc.up.nic.in.

create table public.exam_cutoffs (
  id          uuid primary key default gen_random_uuid(),
  exam_code   text    not null,                       -- 'PRE_GS1' (Prelims cut-off is on GS-I)
  stage       text    not null default 'prelims',
  year        int     not null,
  category    text    not null,                        -- general | obc | ews | sc | st
  cutoff      numeric not null,
  out_of      int     not null default 200,
  is_official boolean not null default true,           -- false = provisional / single-source, needs re-confirmation
  source_url  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (exam_code, stage, year, category)
);

create index exam_cutoffs_lookup_idx on public.exam_cutoffs(exam_code, stage, year);

create trigger trg_exam_cutoffs_updated_at
  before update on public.exam_cutoffs
  for each row execute function public.set_updated_at();

-- Dev-permissive RLS (0013 pattern); grants come from 0015 default privileges.
alter table public.exam_cutoffs enable row level security;
create policy dev_permissive_all on public.exam_cutoffs
  for all to anon, authenticated using (true) with check (true);

-- --- Seed: UPPSC Prelims (Combined Upper Subordinate) GS-I cut-offs /200 ------
insert into public.exam_cutoffs (exam_code, stage, year, category, cutoff, out_of, is_official, source_url) values
  ('PRE_GS1','prelims',2021,'general',115,200,true,'UPPSC official cut-off PDF (PCS-2021) + theIAShub/pw.live/studyiq'),
  ('PRE_GS1','prelims',2021,'obc',    113,200,true,'UPPSC official cut-off PDF (PCS-2021)'),
  ('PRE_GS1','prelims',2021,'ews',    117,200,true,'UPPSC official cut-off PDF (PCS-2021)'),
  ('PRE_GS1','prelims',2021,'sc',      96,200,true,'UPPSC official cut-off PDF (PCS-2021)'),
  ('PRE_GS1','prelims',2021,'st',      82,200,true,'UPPSC official cut-off PDF (PCS-2021)'),
  ('PRE_GS1','prelims',2022,'general',111,200,true,'UPPSC official cut-off PDF (PCS-2022) + pw.live'),
  ('PRE_GS1','prelims',2022,'obc',    114,200,true,'UPPSC official cut-off PDF (PCS-2022)'),
  ('PRE_GS1','prelims',2022,'ews',    114,200,true,'UPPSC official cut-off PDF (PCS-2022)'),
  ('PRE_GS1','prelims',2022,'sc',      99,200,true,'UPPSC official cut-off PDF (PCS-2022)'),
  ('PRE_GS1','prelims',2022,'st',      91,200,true,'UPPSC official cut-off PDF (PCS-2022)'),
  ('PRE_GS1','prelims',2023,'general',125,200,true,'UPPSC official cut-off PDF (PCS-2023) + studyiq'),
  ('PRE_GS1','prelims',2023,'obc',    128,200,true,'UPPSC official cut-off PDF (PCS-2023)'),
  ('PRE_GS1','prelims',2023,'ews',    129,200,true,'UPPSC official cut-off PDF (PCS-2023)'),
  ('PRE_GS1','prelims',2023,'sc',     112,200,true,'UPPSC official cut-off PDF (PCS-2023)'),
  ('PRE_GS1','prelims',2023,'st',     109,200,true,'UPPSC official cut-off PDF (PCS-2023)'),
  ('PRE_GS1','prelims',2024,'general',101,200,false,'UPPSC cut-off PDF (PCS-2024, single-host) — provisional, verify vs uppsc.up.nic.in'),
  ('PRE_GS1','prelims',2024,'obc',    102,200,false,'UPPSC cut-off PDF (PCS-2024, single-host) — provisional'),
  ('PRE_GS1','prelims',2024,'ews',    100,200,false,'UPPSC cut-off PDF (PCS-2024, single-host) — provisional'),
  ('PRE_GS1','prelims',2024,'sc',      85,200,false,'UPPSC cut-off PDF (PCS-2024, single-host) — provisional'),
  ('PRE_GS1','prelims',2024,'st',      70,200,false,'UPPSC cut-off PDF (PCS-2024, single-host) — provisional');
