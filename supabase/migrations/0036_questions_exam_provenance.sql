-- 0036_questions_exam_provenance.sql
-- Multi-exam attribution + source provenance for the question bank.
--
-- The bank is expanding beyond UPPSC (UPSC prelims, UP RO/ARO, UPSSSC PET, …).
-- Every question now records WHICH EXAM it came from and WHAT KIND of source it
-- was extracted from — the audit trail that proves what came from where and is
-- rendered as an "exam + year" chip wherever a question shows.
--
--  * exam_code        which exam asked it (uppsc/upsc/up_ro_aro/upsssc_pet/other).
--                     Orthogonal to paper_code: a question still maps into the
--                     UPPSC syllabus (paper_code + syllabus_node_id) for
--                     weightage/analytics, or node_id=null + out_of_syllabus when
--                     the exam asks beyond UPPSC scope.
--  * exam_label_i18n  bilingual display label ("UPSC Civil Services (Prelims)"),
--                     denormalised per row so the chip needs no lookup.
--  * source_kind      provenance TIER of the file it was extracted from:
--                     official (Tier-A govt) | compilation (Tier-B third-party) |
--                     generated (our LLM pipeline) | manual. This is the audit
--                     trail ingest:verify breaks down.
--  * source_ref       manifest id of the source file (e.g. "upsc_prelims_2024_gs1").
--  * out_of_syllabus  true when an out-of-exam question maps to NO UPPSC node
--                     (allowed instead of force-mapping); such rows are still
--                     attributable and searchable but carry no weightage node.
--
-- All existing rows are UPPSC, so exam_code backfills to 'uppsc'. source_kind is
-- backfilled truthfully from what we know today: Mains PYQs were fetched from the
-- official uppsc.up.nic.in portal (official); Prelims PYQs came from third-party
-- compilation mirrors (compilation); generated/manual keep their origin.

-- ---------------------------------------------------------------------------
-- source_kind enum
-- ---------------------------------------------------------------------------
create type source_kind as enum ('official', 'compilation', 'generated', 'manual');

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------
alter table public.questions
  add column exam_code       text        not null default 'uppsc'
    check (exam_code in ('uppsc', 'upsc', 'up_ro_aro', 'upsssc_pet', 'other')),
  add column exam_label_i18n jsonb,
  -- Nullable at first so we can backfill from `source`/`stage`, then set NOT NULL.
  add column source_kind      source_kind,
  add column source_ref       text,
  add column out_of_syllabus  boolean     not null default false;

comment on column public.questions.exam_code is
  'Which exam asked this question. Orthogonal to paper_code (the UPPSC syllabus anchor). Rendered as the exam half of the attribution chip.';
comment on column public.questions.source_kind is
  'Provenance tier of the extracted file: official (Tier-A govt) | compilation (Tier-B third-party) | generated | manual. The ingest:verify audit trail.';
comment on column public.questions.source_ref is
  'Manifest id of the source file this question came from, e.g. "upsc_prelims_2024_gs1".';
comment on column public.questions.out_of_syllabus is
  'True when the question maps to no UPPSC syllabus node (an out-of-scope ask kept rather than force-mapped). node_id is null for these.';

-- ---------------------------------------------------------------------------
-- Backfill
-- ---------------------------------------------------------------------------
-- Everything currently in the bank is UPPSC.
update public.questions
   set exam_label_i18n = jsonb_build_object(
         'en', case stage when 'prelims' then 'UPPSC Prelims' else 'UPPSC Mains' end,
         'hi', case stage when 'prelims' then 'यूपीपीएससी प्रारंभिक' else 'यूपीपीएससी मुख्य' end
       );

-- Provenance, truthfully from what we know (see header): generated/manual keep
-- origin; PYQ Mains came from the official portal, PYQ Prelims from compilations.
update public.questions
   set source_kind = case
         when source = 'generated' then 'generated'::source_kind
         when source = 'manual'    then 'manual'::source_kind
         when stage  = 'mains'     then 'official'::source_kind      -- uppsc.up.nic.in
         else 'compilation'::source_kind                            -- prelims mirrors
       end,
       -- Promote the per-question source_ref out of meta (parser wrote
       -- "<manifest_id>#q<n>"); keep only the file id here.
       source_ref = split_part(coalesce(meta ->> 'source_ref', ''), '#', 1);

alter table public.questions
  alter column source_kind set not null,
  alter column source_kind set default 'manual';   -- honest fallback for any unlabelled future insert

-- ---------------------------------------------------------------------------
-- Indexes — exam-filtered browsing + the provenance/weightage hot paths.
-- ---------------------------------------------------------------------------
create index questions_exam_code_idx on public.questions (exam_code);
create index questions_source_kind_idx on public.questions (source_kind);
-- Weightage reads published PYQs grouped by node/exam/year.
create index questions_weightage_idx
  on public.questions (syllabus_node_id, exam_code, year)
  where is_published and source = 'pyq' and syllabus_node_id is not null;
