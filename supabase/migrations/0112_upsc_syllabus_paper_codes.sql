-- 0112 — UPSC: bind the 7 General Studies papers to their now-real paper codes,
-- and tell the truth about launch scope now that a syllabus tree exists.
--
-- CONTEXT. Migration 0106 seeded `exams.upsc.paper_structure` from the official
-- CSE notification with `paper_code: null` on EVERY paper, which was correct at
-- the time: a paper code only means something once a syllabus tree exists under
-- it. `apps/web/src/hooks/use-paper-catalog.ts` filters on exactly that field —
--
--     "An exam whose registry papers carry `paper_code: null` (every non-UPPSC
--      exam today — no syllabus ingested) yields an EMPTY catalog."
--
-- — so until this migration a UPSC user got an empty paper catalog. The
-- hand-authored tree (`pnpm ingest:upsc-syllabus`, 202 rows across 7 papers,
-- coverage-gated against the verbatim official text) is now loaded, so the codes
-- become meaningful and the catalog can render.
--
-- MAPPING is by the commission's own `official_label`, never by array index —
-- indices are fragile if the structure is ever re-seeded, labels are printed in
-- the notification. UPSC's Main-exam labels are genuinely offset from the GS
-- numbering (Paper-II is GS-I, Paper-III is GS-II, ...), which is exactly why
-- this is done explicitly rather than derived arithmetically:
--
--   prelims  Paper I    -> UPSC_PRE_GS1      (General Studies)
--   prelims  Paper II   -> UPSC_PRE_CSAT     (CSAT; stage_gate 33% already set in 0106)
--   mains    Paper-I    -> UPSC_MAINS_ESSAY  (Essay)
--   mains    Paper-II   -> UPSC_MAINS_GS1
--   mains    Paper-III  -> UPSC_MAINS_GS2
--   mains    Paper-IV   -> UPSC_MAINS_GS3
--   mains    Paper-V    -> UPSC_MAINS_GS4
--
-- DELIBERATELY LEFT NULL (do not "complete" these later without a tree):
--   mains Paper-A / Paper-B  — qualifying Indian-language and English papers.
--                              Not General Studies; no syllabus tree authored.
--   mains Paper-VI / Paper-VII — the candidate-chosen optional subject (~25
--                              subjects plus 23 literatures, x2 papers). One
--                              tree cannot represent them, and `usePaperCatalog`
--                              correctly omits a code-less paper.
-- Leaving them null is the honest state, and it keeps the catalog free of papers
-- we have no content for.
--
-- NOT CHANGED HERE: `is_live` stays false. A syllabus tree alone is not a
-- launchable exam — there is still no UPSC question bank, no study chapters, and
-- `lib/exam-config.ts` still has ~74 UNAUTHORED slots for upsc (docs/OUTSTANDING
-- §8f "U6"), so every model-facing path would throw. `assertSelectableExam`
-- continues to reject `target_exam = 'upsc'`.

-- ---------------------------------------------------------------------------
-- 1. paper_code backfill, matched on (stage, official_label). Idempotent:
--    re-running sets the same seven values.
-- ---------------------------------------------------------------------------
do $$
declare
  m  record;
  s  int;
  p  int;
  ps jsonb;
  n_set int := 0;
begin
  select paper_structure into ps from public.exams where exam_code = 'upsc';
  if ps is null then
    raise exception '0112: exams row for upsc is missing (expected from 0106)';
  end if;

  for m in
    select * from (values
      ('prelims', 'Paper I',   'UPSC_PRE_GS1'),
      ('prelims', 'Paper II',  'UPSC_PRE_CSAT'),
      ('mains',   'Paper-I',   'UPSC_MAINS_ESSAY'),
      ('mains',   'Paper-II',  'UPSC_MAINS_GS1'),
      ('mains',   'Paper-III', 'UPSC_MAINS_GS2'),
      ('mains',   'Paper-IV',  'UPSC_MAINS_GS3'),
      ('mains',   'Paper-V',   'UPSC_MAINS_GS4')
    ) as t(stage, label, code)
  loop
    for s in 0 .. jsonb_array_length(ps -> 'stages') - 1 loop
      if ps -> 'stages' -> s ->> 'stage' = m.stage
         and jsonb_typeof(ps -> 'stages' -> s -> 'papers') = 'array' then
        for p in 0 .. jsonb_array_length(ps -> 'stages' -> s -> 'papers') - 1 loop
          if ps -> 'stages' -> s -> 'papers' -> p ->> 'official_label' = m.label then
            ps := jsonb_set(
              ps,
              array['stages', s::text, 'papers', p::text, 'paper_code'],
              to_jsonb(m.code)
            );
            n_set := n_set + 1;
          end if;
        end loop;
      end if;
    end loop;
  end loop;

  if n_set <> 7 then
    raise exception '0112: expected to set 7 paper codes, set % — official_label values changed?', n_set;
  end if;

  update public.exams set paper_structure = ps where exam_code = 'upsc';
end $$;

-- Assert the end state rather than trusting the loop: exactly 7 non-null codes,
-- and every one of them must actually have syllabus rows behind it.
do $$
declare
  n_codes int;
  n_orphan int;
begin
  select count(*) into n_codes
  from public.exams e,
       jsonb_array_elements(e.paper_structure -> 'stages') st,
       jsonb_array_elements(st -> 'papers') p
  where e.exam_code = 'upsc' and p ->> 'paper_code' is not null;
  if n_codes <> 7 then
    raise exception '0112: expected 7 non-null paper codes for upsc, found %', n_codes;
  end if;

  select count(*) into n_orphan
  from public.exams e,
       jsonb_array_elements(e.paper_structure -> 'stages') st,
       jsonb_array_elements(st -> 'papers') p
  where e.exam_code = 'upsc'
    and p ->> 'paper_code' is not null
    and not exists (
      select 1 from public.syllabus_nodes n
      where n.exam_code = 'upsc' and n.paper_code = p ->> 'paper_code'
    );
  if n_orphan > 0 then
    raise exception '0112: % paper code(s) have no syllabus_nodes rows — load the tree first (pnpm ingest:upsc-syllabus)', n_orphan;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. launch_scope_i18n — the syllabus tree is now covered, so stop saying it
--    isn't. This copy is rendered to real users by the exam picker / switcher
--    (U3), so an accurate list matters more than a tidy one. Language and
--    optional papers are named as explicitly out of scope rather than silently
--    absent.
-- ---------------------------------------------------------------------------
update public.exams
set launch_scope_i18n = jsonb_build_object(
  'summary_i18n', jsonb_build_object(
    'en', 'Partly available. The exam pattern and the full official General Studies syllabus tree are in place, but we have not yet ingested any UPSC past-year questions or study material.',
    'hi', 'आंशिक रूप से उपलब्ध। परीक्षा पैटर्न एवं सम्पूर्ण आधिकारिक सामान्य अध्ययन पाठ्यक्रम संरचना दर्ज है, परन्तु अभी तक कोई यूपीएससी पिछले वर्षों के प्रश्न या अध्ययन सामग्री नहीं जोड़ी गई है।'
  ),
  'covered_i18n', jsonb_build_array(
    jsonb_build_object(
      'en', 'Verified exam pattern and marks scheme',
      'hi', 'सत्यापित परीक्षा पैटर्न एवं अंक योजना'
    ),
    jsonb_build_object(
      'en', 'Full General Studies syllabus tree — Prelims GS and CSAT, Mains GS-I to GS-IV, Essay',
      'hi', 'सम्पूर्ण सामान्य अध्ययन पाठ्यक्रम संरचना — प्रारंभिक सामान्य अध्ययन एवं सी-सैट, मुख्य सामान्य अध्ययन-I से IV, निबंध'
    )
  ),
  'not_covered_i18n', jsonb_build_array(
    jsonb_build_object('en', 'Past-year question bank', 'hi', 'पिछले वर्षों के प्रश्नों का बैंक'),
    jsonb_build_object('en', 'Study chapters', 'hi', 'अध्ययन अध्याय'),
    jsonb_build_object('en', 'Optional subjects (Mains Paper-VI and Paper-VII)', 'hi', 'वैकल्पिक विषय (मुख्य प्रश्नपत्र VI एवं VII)'),
    jsonb_build_object('en', 'Qualifying language papers (Paper-A and Paper-B)', 'hi', 'अर्हक भाषा प्रश्नपत्र (प्रश्नपत्र A एवं B)'),
    jsonb_build_object('en', 'Current affairs mapped to the UPSC syllabus', 'hi', 'यूपीएससी पाठ्यक्रम से जुड़े करेंट अफेयर्स')
  )
)
where exam_code = 'upsc';
