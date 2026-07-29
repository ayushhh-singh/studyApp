-- 0106_multi_exam_foundation.sql
-- FOUNDATIONAL multi-exam schema. The platform has been UPPSC-only since 0001;
-- this migration introduces the `exams` registry and threads an explicit exam
-- dimension through the tables where the exam is NOT derivable by a join.
--
-- NOTHING BECOMES LIVE HERE. `exams.is_live` is true for 'uppsc' only; 'upsc'
-- and 'mppsc' are seeded as registry rows with their real paper structures so
-- the schema is proven against three genuinely different exam shapes, but they
-- carry zero syllabus nodes, zero questions and zero content. This is a schema
-- + data-model change, not a product launch.
--
-- ===========================================================================
-- THE LOAD-BEARING INVARIANT — READ BEFORE ADDING A SECOND SYLLABUS
-- ===========================================================================
-- `syllabus_nodes.paper_code` is GLOBALLY UNIQUE ACROSS EXAMS, and the pre-
-- existing unique index `syllabus_nodes_paper_path_key (paper_code, path)` is
-- retained specifically to ENFORCE that. This is deliberate and load-bearing:
--
--   * ~30 call sites read syllabus_nodes filtered ONLY by paper_code (paper
--     trees, breadcrumbs, subtree flattening, time-attack topics, weightage
--     ranking, mastery ancestor mapping, notes/qgen paper resolution). Audited
--     one by one — see docs/multi-exam.md for the full call-site table.
--   * If two exams shared a paper_code, every one of those reads would silently
--     return the other exam's nodes, and `ingest:syllabus`'s upsert (whose
--     conflict target IS (paper_code, path)) would OVERWRITE the UPPSC tree in
--     place rather than insert a second one.
--   * Retaining the global index converts that entire silent-corruption class
--     into a LOUD unique-violation at ingest time.
--
-- Therefore: a second exam's paper codes MUST be namespaced with the exam as a
-- PREFIX — 'UPSC_PRE_GS1', 'MPPSC_MAINS_GS2', … — never a bare 'PRE_GS1'.
-- The prefix (not a suffix) also keeps existing `like 'PRE_%'` / `like 'MAINS_%'`
-- prefix scans UPPSC-only by construction.
-- Do NOT drop syllabus_nodes_paper_path_key. The (exam_code, paper_code, path)
-- index added below is documentation-of-intent and defence in depth; the global
-- one is the actual guarantee.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. exams registry
-- ---------------------------------------------------------------------------
-- paper_structure is a single JSONB document rather than a papers TABLE because
-- it is reference/marketing data (rendered on the exam picker and the "what we
-- cover" page), not something joined against at query time — the queryable
-- paper dimension already exists as syllabus_nodes.paper_code. Modelling it as
-- a table would add a join to every paper read for zero query benefit.
--
-- The shape was designed against all three REAL structures at once (UPSC CSE,
-- UPPSC PCS, MPPSC SSE), each verified against the commission's own notification
-- /exam-plan PDF — never from memory, per this repo's exam-sourcing policy. The
-- full zod contract lives in packages/shared/src/exams.ts; the seeds below carry
-- `sources` and `unverified_notes` so a contested figure is disclosed, not
-- silently asserted.
--
--   { version, effective_from_year, effective_to_year, total_marks,
--     stages: [ { stage, counts_for_merit, marks, shortlist_multiple,
--                 answer_languages, papers: [ { … } ] } ],
--     sources: [], unverified_notes: [] }
--
-- FIVE fields exist because a naive shape provably breaks on real data. Each was
-- found by checking the actual notifications, so do not "simplify" them away:
--
--  1. `minimum: {role, pct, pct_by_category}` — NOT a boolean `is_qualifying`.
--     All three exams set minimum marks, for THREE different purposes:
--       stage_gate      clear it to advance; marks never count for merit
--                       (CSAT at 33% in UPSC and UPPSC).
--       evaluation_gate fail it and your other papers are NEVER EVALUATED
--                       (UPSC Paper-A/Paper-B at 25%) — strictly harsher.
--       merit_floor     the paper DOES count for merit but also has a floor
--                       (MPPSC's 40%/30% per paper; UPPSC General Hindi).
--     `pct_by_category` because MPPSC's floor is 40% UR / 30% reserved.
--     `pct: null` means "a threshold exists but its value is not published"
--     (UPPSC General Hindi is literally "as determined by the Commission");
--     absence of the whole `minimum` object means "no threshold".
--
--  2. `negative_marking: {fraction, of:"question_marks"}` — a FRACTION, not an
--     absolute. UPPSC's one-third rule deducts ~0.44 in Prelims Paper I and
--     ~0.67 in Paper II because the papers carry different marks per question.
--     A scalar gets one of the two wrong — published aggregator tables often do.
--
--  3. `optional_group` — NOT a boolean `is_optional_subject`. UPSC's Paper-VI
--     and Paper-VII must be the SAME candidate-chosen subject; a boolean cannot
--     express the pairing. Neither UPPSC nor MPPSC has an optional at all.
--
--  4. `effective_from_year` / `effective_to_year` — the most load-bearing field
--     here. UPPSC restructured for Mains 2023 (optional abolished, GS-V/VI
--     added); MPPSC changed for 2026 (negative marking introduced, prelims
--     2 -> 3 marks/question, GS-IV 200 -> 300, interview 175 -> 185). Without
--     versioning, a 2021 PYQ renders against a structure that did not exist when
--     it was set and every "out of N marks" figure on an older paper is wrong.
--
--  5. `question_count: null` means NOT OFFICIALLY NOTIFIED, not "unknown to us".
--     UPSC's notification fixes 200 marks and two hours per prelims paper but
--     never the question count; the familiar 100/80 is practice, not a notified
--     figure, so it is recorded in unverified_notes instead of asserted.
--
-- Also stage-level, because they are not paper properties: `counts_for_merit`
-- (prelims counts for merit in NONE of the three), `shortlist_multiple`, and
-- `answer_languages` — with a per-paper override, since MPPSC's Papers V and VI
-- are Hindi-only while its GS papers accept Hindi or English. The interview is a
-- STAGE with marks and no papers, not a pseudo-paper full of nulls.
create table public.exams (
  exam_code         text        primary key,
  display_name_i18n jsonb       not null,
  is_live           boolean     not null default false,
  paper_structure   jsonb       not null default '{}'::jsonb,
  launch_scope_i18n jsonb       not null default '{}'::jsonb,
  sort_order        int         not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.exams is
  'Registry of exams the platform can serve. is_live gates whether an exam is selectable in-product; a non-live row is reference data only.';
comment on column public.exams.paper_structure is
  'Reference document of the exam pattern (stages -> papers). NOT queried at runtime — the queryable paper dimension is syllabus_nodes.paper_code. See the header for the schema.';
comment on column public.exams.launch_scope_i18n is
  'The HONEST per-exam coverage statement shown to a user before they pick this exam: {"summary_i18n", "covered_i18n"[], "not_covered_i18n"[]}. Never overstate what is ingested.';

create trigger trg_exams_updated_at
  before update on public.exams
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 1b. Seed the three exams  (MUST run before any FK column below)
-- ---------------------------------------------------------------------------
-- Only 'uppsc' is is_live. 'upsc' and 'mppsc' are REFERENCE ROWS: verified
-- pattern + honest launch-scope copy that says plainly they have no syllabus,
-- no questions and no study material yet. Seeding them now is what proves the
-- paper_structure shape against three genuinely different exams instead of
-- generalising from one.
--
-- Every figure comes from the commission's own notification / exam-plan PDF
-- (listed per row in `sources`), never from memory or an aggregator — the same
-- policy as the exam_calendar and exam_cutoffs seeds. Aggregators are actively
-- unreliable here: many still publish MPPSC's pre-2024 1400/175 figures, and
-- several transplant UPSC's 33% CSAT threshold onto MPPSC (whose floor is
-- 40%/30% by category). Anything that could not be confirmed against a primary
-- source is disclosed in that row's `unverified_notes` rather than asserted.
--
-- Arithmetic cross-check (validated against the zod contract before commit):
-- summing only counts_for_merit papers plus the interview reproduces each
-- exam's officially published grand total —
--   UPPSC 1500 + 100 = 1600
--   UPSC  1750 + 275 = 2025   (Paper-A/Paper-B are qualifying, excluded)
--   MPPSC 1500 + 185 = 1685
--
-- ORDERING IS LOAD-BEARING: every exam_code column added below is NOT NULL
-- DEFAULT 'uppsc' WITH a foreign key to this table. Postgres validates that
-- default against the FK for all existing rows at ALTER time, so if these rows
-- are not already present the very first ALTER fails with a foreign-key
-- violation. Seed first, then add the columns.
--
-- Idempotent: re-running refreshes the reference data in place.
insert into public.exams
  (exam_code, display_name_i18n, is_live, paper_structure, launch_scope_i18n, sort_order)
values
  ('uppsc', '{"en": "UPPSC (UP PCS)", "hi": "यूपीपीएससी (यूपी पीसीएस)"}'::jsonb, true,
   '{"version": 1, "effective_from_year": 2023, "effective_to_year": null, "total_marks": 1600, "stages": [{"stage": "prelims", "counts_for_merit": false, "marks": null, "shortlist_multiple": 15, "answer_languages": ["hi", "en"], "papers": [{"paper_code": "PRE_GS1", "order": 1, "official_label": "Paper I", "name_i18n": {"en": "General Studies-I", "hi": "सामान्य अध्ययन – प्रथम प्रश्नपत्र"}, "format": "objective", "marks": 200, "duration_minutes": 120, "question_count": 150, "marks_per_question": 1.3333, "negative_marking": {"fraction": 0.3333, "of": "question_marks"}, "counts_for_merit": false, "minimum": null, "optional_group": null, "applies_to_all_candidates": true, "answer_languages": null}, {"paper_code": "PRE_CSAT", "order": 2, "official_label": "Paper II", "name_i18n": {"en": "General Studies-II (CSAT)", "hi": "सामान्य अध्ययन – द्वितीय प्रश्नपत्र (सी-सैट)"}, "format": "objective", "marks": 200, "duration_minutes": 120, "question_count": 100, "marks_per_question": 2, "negative_marking": {"fraction": 0.3333, "of": "question_marks"}, "counts_for_merit": false, "minimum": {"role": "stage_gate", "pct": 33, "pct_by_category": null}, "optional_group": null, "applies_to_all_candidates": true, "answer_languages": null}]}, {"stage": "mains", "counts_for_merit": true, "marks": null, "shortlist_multiple": null, "answer_languages": ["hi", "en", "ur"], "papers": [{"paper_code": "MAINS_GH", "order": 1, "official_label": "Paper I", "name_i18n": {"en": "General Hindi", "hi": "सामान्य हिन्दी"}, "format": "descriptive", "marks": 150, "duration_minutes": 180, "question_count": null, "marks_per_question": null, "negative_marking": null, "counts_for_merit": true, "minimum": {"role": "merit_floor", "pct": null, "pct_by_category": null}, "optional_group": null, "applies_to_all_candidates": true, "answer_languages": null}, {"paper_code": "MAINS_ESSAY", "order": 2, "official_label": "Paper II", "name_i18n": {"en": "Essay", "hi": "निबन्ध"}, "format": "descriptive", "marks": 150, "duration_minutes": 180, "question_count": null, "marks_per_question": null, "negative_marking": null, "counts_for_merit": true, "minimum": null, "optional_group": null, "applies_to_all_candidates": true, "answer_languages": null}, {"paper_code": "MAINS_GS1", "order": 3, "official_label": "Paper 3", "name_i18n": {"en": "General Studies-I", "hi": "सामान्य अध्ययन – प्रथम प्रश्नपत्र"}, "format": "descriptive", "marks": 200, "duration_minutes": 180, "question_count": null, "marks_per_question": null, "negative_marking": null, "counts_for_merit": true, "minimum": null, "optional_group": null, "applies_to_all_candidates": true, "answer_languages": null}, {"paper_code": "MAINS_GS2", "order": 4, "official_label": "Paper 4", "name_i18n": {"en": "General Studies-II", "hi": "सामान्य अध्ययन – द्वितीय प्रश्नपत्र"}, "format": "descriptive", "marks": 200, "duration_minutes": 180, "question_count": null, "marks_per_question": null, "negative_marking": null, "counts_for_merit": true, "minimum": null, "optional_group": null, "applies_to_all_candidates": true, "answer_languages": null}, {"paper_code": "MAINS_GS3", "order": 5, "official_label": "Paper 5", "name_i18n": {"en": "General Studies-III", "hi": "सामान्य अध्ययन – तृतीय प्रश्नपत्र"}, "format": "descriptive", "marks": 200, "duration_minutes": 180, "question_count": null, "marks_per_question": null, "negative_marking": null, "counts_for_merit": true, "minimum": null, "optional_group": null, "applies_to_all_candidates": true, "answer_languages": null}, {"paper_code": "MAINS_GS4", "order": 6, "official_label": "Paper 6", "name_i18n": {"en": "General Studies-IV", "hi": "सामान्य अध्ययन – चतुर्थ प्रश्नपत्र"}, "format": "descriptive", "marks": 200, "duration_minutes": 180, "question_count": null, "marks_per_question": null, "negative_marking": null, "counts_for_merit": true, "minimum": null, "optional_group": null, "applies_to_all_candidates": true, "answer_languages": null}, {"paper_code": "MAINS_GS5", "order": 7, "official_label": "Paper 7", "name_i18n": {"en": "General Studies-V (UP-specific)", "hi": "सामान्य अध्ययन – पंचम प्रश्नपत्र (उत्तर प्रदेश विशेष)"}, "format": "descriptive", "marks": 200, "duration_minutes": 180, "question_count": null, "marks_per_question": null, "negative_marking": null, "counts_for_merit": true, "minimum": null, "optional_group": null, "applies_to_all_candidates": true, "answer_languages": null}, {"paper_code": "MAINS_GS6", "order": 8, "official_label": "Paper 8", "name_i18n": {"en": "General Studies-VI (UP-specific)", "hi": "सामान्य अध्ययन – षष्ठम प्रश्नपत्र (उत्तर प्रदेश विशेष)"}, "format": "descriptive", "marks": 200, "duration_minutes": 180, "question_count": null, "marks_per_question": null, "negative_marking": null, "counts_for_merit": true, "minimum": null, "optional_group": null, "applies_to_all_candidates": true, "answer_languages": null}]}, {"stage": "interview", "counts_for_merit": true, "marks": 100, "shortlist_multiple": null, "answer_languages": [], "papers": []}], "sources": ["https://uppsc.up.nic.in/CandidatePages/Notifications.aspx", "UPPCS-2025 official advertisement (English notification PDF)"], "unverified_notes": ["Grand total 1600 is arithmetic (Mains 1500 + Interview 100); the official scheme prints no explicit grand-total line.", "General Hindi is treated as merit-counting with a minimum floor: it is listed under COMPULSORY SUBJECTS with no merit-exclusion wording, and 1500+100=1600 only holds if it counts. Some aggregators call it qualifying-only (while also printing 1600, contradicting themselves).", "The General Hindi minimum percentage is not officially published — the notification says only ''as may be determined by the Government or the Commission''. Quoted 30%/33% figures are unsourced; 33% belongs to CSAT.", "Mains-to-interview shortlist multiple not confirmed from the official scheme."]}'::jsonb,
   '{"summary_i18n": {"en": "Fully covered. Complete syllabus, an 8-year PYQ bank, fact-audited study chapters for every topic, AI answer evaluation, and daily current affairs.", "hi": "पूर्ण रूप से उपलब्ध। सम्पूर्ण पाठ्यक्रम, 8 वर्षों का पिछले वर्षों के प्रश्नों का बैंक, हर विषय के लिए तथ्य-जाँचित अध्ययन अध्याय, एआई उत्तर मूल्यांकन और दैनिक करेंट अफेयर्स।"}, "covered_i18n": [{"en": "Prelims GS-I and CSAT, 2018-2025 PYQs", "hi": "प्रारंभिक जीएस-I एवं सी-सैट, 2018-2025 के प्रश्न"}, {"en": "All 8 Mains papers with AI answer evaluation", "hi": "एआई उत्तर मूल्यांकन के साथ सभी 8 मुख्य प्रश्नपत्र"}, {"en": "Study chapters for every syllabus topic", "hi": "प्रत्येक पाठ्यक्रम विषय हेतु अध्ययन अध्याय"}, {"en": "UP-focused daily current affairs", "hi": "यूपी-केंद्रित दैनिक करेंट अफेयर्स"}], "not_covered_i18n": []}'::jsonb, 1),
  ('upsc', '{"en": "UPSC Civil Services", "hi": "यूपीएससी सिविल सेवा"}'::jsonb, false,
   '{"version": 1, "effective_from_year": null, "effective_to_year": null, "total_marks": 2025, "stages": [{"stage": "prelims", "counts_for_merit": false, "marks": null, "shortlist_multiple": null, "answer_languages": ["hi", "en"], "papers": [{"paper_code": null, "order": 1, "official_label": "Paper I", "name_i18n": {"en": "General Studies", "hi": "सामान्य अध्ययन"}, "format": "objective", "marks": 200, "duration_minutes": 120, "question_count": null, "marks_per_question": null, "negative_marking": {"fraction": 0.3333, "of": "question_marks"}, "counts_for_merit": false, "minimum": null, "optional_group": null, "applies_to_all_candidates": true, "answer_languages": null}, {"paper_code": null, "order": 2, "official_label": "Paper II", "name_i18n": {"en": "CSAT", "hi": "सी-सैट"}, "format": "objective", "marks": 200, "duration_minutes": 120, "question_count": null, "marks_per_question": null, "negative_marking": {"fraction": 0.3333, "of": "question_marks"}, "counts_for_merit": false, "minimum": {"role": "stage_gate", "pct": 33, "pct_by_category": null}, "optional_group": null, "applies_to_all_candidates": true, "answer_languages": null}]}, {"stage": "mains", "counts_for_merit": true, "marks": null, "shortlist_multiple": null, "answer_languages": ["en", "eighth_schedule_languages"], "papers": [{"paper_code": null, "order": 1, "official_label": "Paper-A", "name_i18n": {"en": "Indian Language (Eighth Schedule)", "hi": "भारतीय भाषा (अष्टम अनुसूची)"}, "format": "descriptive", "marks": 300, "duration_minutes": 180, "question_count": null, "marks_per_question": null, "negative_marking": null, "counts_for_merit": false, "minimum": {"role": "evaluation_gate", "pct": 25, "pct_by_category": null}, "optional_group": null, "applies_to_all_candidates": false, "answer_languages": null}, {"paper_code": null, "order": 2, "official_label": "Paper-B", "name_i18n": {"en": "English", "hi": "अंग्रेज़ी"}, "format": "descriptive", "marks": 300, "duration_minutes": 180, "question_count": null, "marks_per_question": null, "negative_marking": null, "counts_for_merit": false, "minimum": {"role": "evaluation_gate", "pct": 25, "pct_by_category": null}, "optional_group": null, "applies_to_all_candidates": true, "answer_languages": null}, {"paper_code": null, "order": 3, "official_label": "Paper-I", "name_i18n": {"en": "Essay", "hi": "निबंध"}, "format": "descriptive", "marks": 250, "duration_minutes": 180, "question_count": null, "marks_per_question": null, "negative_marking": null, "counts_for_merit": true, "minimum": null, "optional_group": null, "applies_to_all_candidates": true, "answer_languages": null}, {"paper_code": null, "order": 4, "official_label": "Paper-II", "name_i18n": {"en": "General Studies-I", "hi": "सामान्य अध्ययन-I"}, "format": "descriptive", "marks": 250, "duration_minutes": 180, "question_count": null, "marks_per_question": null, "negative_marking": null, "counts_for_merit": true, "minimum": null, "optional_group": null, "applies_to_all_candidates": true, "answer_languages": null}, {"paper_code": null, "order": 5, "official_label": "Paper-III", "name_i18n": {"en": "General Studies-II", "hi": "सामान्य अध्ययन-II"}, "format": "descriptive", "marks": 250, "duration_minutes": 180, "question_count": null, "marks_per_question": null, "negative_marking": null, "counts_for_merit": true, "minimum": null, "optional_group": null, "applies_to_all_candidates": true, "answer_languages": null}, {"paper_code": null, "order": 6, "official_label": "Paper-IV", "name_i18n": {"en": "General Studies-III", "hi": "सामान्य अध्ययन-III"}, "format": "descriptive", "marks": 250, "duration_minutes": 180, "question_count": null, "marks_per_question": null, "negative_marking": null, "counts_for_merit": true, "minimum": null, "optional_group": null, "applies_to_all_candidates": true, "answer_languages": null}, {"paper_code": null, "order": 7, "official_label": "Paper-V", "name_i18n": {"en": "General Studies-IV (Ethics)", "hi": "सामान्य अध्ययन-IV (नीतिशास्त्र)"}, "format": "descriptive", "marks": 250, "duration_minutes": 180, "question_count": null, "marks_per_question": null, "negative_marking": null, "counts_for_merit": true, "minimum": null, "optional_group": null, "applies_to_all_candidates": true, "answer_languages": null}, {"paper_code": null, "order": 8, "official_label": "Paper-VI", "name_i18n": {"en": "Optional Subject – Paper 1", "hi": "वैकल्पिक विषय – प्रश्नपत्र 1"}, "format": "descriptive", "marks": 250, "duration_minutes": 180, "question_count": null, "marks_per_question": null, "negative_marking": null, "counts_for_merit": true, "minimum": null, "optional_group": "optional_1", "applies_to_all_candidates": true, "answer_languages": null}, {"paper_code": null, "order": 9, "official_label": "Paper-VII", "name_i18n": {"en": "Optional Subject – Paper 2", "hi": "वैकल्पिक विषय – प्रश्नपत्र 2"}, "format": "descriptive", "marks": 250, "duration_minutes": 180, "question_count": null, "marks_per_question": null, "negative_marking": null, "counts_for_merit": true, "minimum": null, "optional_group": "optional_1", "applies_to_all_candidates": true, "answer_languages": null}]}, {"stage": "interview", "counts_for_merit": true, "marks": 275, "shortlist_multiple": null, "answer_languages": [], "papers": []}], "sources": ["UPSC Civil Services Examination 2026 official notification (upsc.gov.in)"], "unverified_notes": ["Prelims question counts (commonly 100 for GS and 80 for CSAT) are NOT stated in the official notification, which fixes only 200 marks and two hours per paper. Recorded as null rather than asserted from past papers.", "Prelims-to-Mains shortlist multiple (commonly quoted 12-13x) is not fixed in the notification.", "Paper-A does not apply to candidates from Arunachal Pradesh, Manipur, Meghalaya, Mizoram, Nagaland and Sikkim, nor to certain hearing-impaired PwBD candidates (applies_to_all_candidates=false).", "Optional subject is one of ~25 subjects plus the literature of any of 23 languages; both optional papers must be the SAME subject (optional_group).", "Specified-disability candidates receive 20 minutes/hour compensatory time, so duration_minutes is not constant per candidate.", "The Personality Test explicitly carries no minimum qualifying marks."]}'::jsonb,
   '{"summary_i18n": {"en": "Not available yet. We have mapped the exam pattern but have not yet ingested any UPSC syllabus, questions or study material.", "hi": "अभी उपलब्ध नहीं। हमने परीक्षा पैटर्न दर्ज कर लिया है, परन्तु अभी तक कोई यूपीएससी पाठ्यक्रम, प्रश्न या अध्ययन सामग्री नहीं जोड़ी गई है।"}, "covered_i18n": [{"en": "Verified exam pattern and marks scheme", "hi": "सत्यापित परीक्षा पैटर्न एवं अंक योजना"}], "not_covered_i18n": [{"en": "Syllabus tree", "hi": "पाठ्यक्रम संरचना"}, {"en": "Past-year question bank", "hi": "पिछले वर्षों के प्रश्नों का बैंक"}, {"en": "Study chapters", "hi": "अध्ययन अध्याय"}, {"en": "Optional subjects", "hi": "वैकल्पिक विषय"}, {"en": "Current affairs mapped to the UPSC syllabus", "hi": "यूपीएससी पाठ्यक्रम से जुड़े करेंट अफेयर्स"}]}'::jsonb, 2),
  ('mppsc', '{"en": "MPPSC (MP State Service)", "hi": "एमपीपीएससी (एमपी राज्य सेवा)"}'::jsonb, false,
   '{"version": 1, "effective_from_year": 2026, "effective_to_year": null, "total_marks": 1685, "stages": [{"stage": "prelims", "counts_for_merit": false, "marks": null, "shortlist_multiple": 20, "answer_languages": ["hi", "en"], "papers": [{"paper_code": null, "order": 1, "official_label": "Paper I", "name_i18n": {"en": "General Studies", "hi": "सामान्य अध्ययन"}, "format": "objective", "marks": 300, "duration_minutes": 120, "question_count": 100, "marks_per_question": 3, "negative_marking": {"fraction": 0.3333, "of": "question_marks"}, "counts_for_merit": false, "minimum": {"role": "stage_gate", "pct": null, "pct_by_category": {"UR": 40, "SC": 30, "ST": 30, "OBC": 30, "EWS": 30, "PwD": 30}}, "optional_group": null, "applies_to_all_candidates": true, "answer_languages": null}, {"paper_code": null, "order": 2, "official_label": "Paper II", "name_i18n": {"en": "General Aptitude Test", "hi": "सामान्य अभिरुचि परीक्षण"}, "format": "objective", "marks": 300, "duration_minutes": 120, "question_count": 100, "marks_per_question": 3, "negative_marking": {"fraction": 0.3333, "of": "question_marks"}, "counts_for_merit": false, "minimum": {"role": "stage_gate", "pct": null, "pct_by_category": {"UR": 40, "SC": 30, "ST": 30, "OBC": 30, "EWS": 30, "PwD": 30}}, "optional_group": null, "applies_to_all_candidates": true, "answer_languages": null}]}, {"stage": "mains", "counts_for_merit": true, "marks": null, "shortlist_multiple": 3, "answer_languages": ["hi", "en"], "papers": [{"paper_code": null, "order": 1, "official_label": "Paper I", "name_i18n": {"en": "General Studies-I (History & Geography)", "hi": "सामान्य अध्ययन-I (इतिहास एवं भूगोल)"}, "format": "descriptive", "marks": 300, "duration_minutes": 180, "question_count": null, "marks_per_question": null, "negative_marking": null, "counts_for_merit": true, "minimum": {"role": "merit_floor", "pct": null, "pct_by_category": {"UR": 40, "SC": 30, "ST": 30, "OBC": 30, "EWS": 30, "PwD": 30}}, "optional_group": null, "applies_to_all_candidates": true, "answer_languages": ["hi", "en"]}, {"paper_code": null, "order": 2, "official_label": "Paper II", "name_i18n": {"en": "General Studies-II (Political Science, Sociology)", "hi": "सामान्य अध्ययन-II (राजनीति विज्ञान, समाजशास्त्र)"}, "format": "descriptive", "marks": 300, "duration_minutes": 180, "question_count": null, "marks_per_question": null, "negative_marking": null, "counts_for_merit": true, "minimum": {"role": "merit_floor", "pct": null, "pct_by_category": {"UR": 40, "SC": 30, "ST": 30, "OBC": 30, "EWS": 30, "PwD": 30}}, "optional_group": null, "applies_to_all_candidates": true, "answer_languages": ["hi", "en"]}, {"paper_code": null, "order": 3, "official_label": "Paper III", "name_i18n": {"en": "General Studies-III (Economics, Science & Technology, Public Health)", "hi": "सामान्य अध्ययन-III (अर्थशास्त्र, विज्ञान एवं प्रौद्योगिकी, लोक स्वास्थ्य)"}, "format": "descriptive", "marks": 300, "duration_minutes": 180, "question_count": null, "marks_per_question": null, "negative_marking": null, "counts_for_merit": true, "minimum": {"role": "merit_floor", "pct": null, "pct_by_category": {"UR": 40, "SC": 30, "ST": 30, "OBC": 30, "EWS": 30, "PwD": 30}}, "optional_group": null, "applies_to_all_candidates": true, "answer_languages": ["hi", "en"]}, {"paper_code": null, "order": 4, "official_label": "Paper IV", "name_i18n": {"en": "General Studies-IV (Philosophy, Psychology, Public Administration, Management, Case Study)", "hi": "सामान्य अध्ययन-IV (दर्शनशास्त्र, मनोविज्ञान, लोक प्रशासन, प्रबंधन, प्रकरण अध्ययन)"}, "format": "descriptive", "marks": 300, "duration_minutes": 180, "question_count": null, "marks_per_question": null, "negative_marking": null, "counts_for_merit": true, "minimum": {"role": "merit_floor", "pct": null, "pct_by_category": {"UR": 40, "SC": 30, "ST": 30, "OBC": 30, "EWS": 30, "PwD": 30}}, "optional_group": null, "applies_to_all_candidates": true, "answer_languages": ["hi", "en"]}, {"paper_code": null, "order": 5, "official_label": "Paper V", "name_i18n": {"en": "General Hindi & Grammar", "hi": "सामान्य हिन्दी एवं व्याकरण"}, "format": "descriptive", "marks": 200, "duration_minutes": 120, "question_count": null, "marks_per_question": null, "negative_marking": null, "counts_for_merit": true, "minimum": {"role": "merit_floor", "pct": null, "pct_by_category": {"UR": 40, "SC": 30, "ST": 30, "OBC": 30, "EWS": 30, "PwD": 30}}, "optional_group": null, "applies_to_all_candidates": true, "answer_languages": ["hi"]}, {"paper_code": null, "order": 6, "official_label": "Paper VI", "name_i18n": {"en": "Hindi Essay & Drafting", "hi": "हिन्दी निबंध एवं प्रारूप लेखन"}, "format": "descriptive", "marks": 100, "duration_minutes": 150, "question_count": null, "marks_per_question": null, "negative_marking": null, "counts_for_merit": true, "minimum": {"role": "merit_floor", "pct": null, "pct_by_category": {"UR": 40, "SC": 30, "ST": 30, "OBC": 30, "EWS": 30, "PwD": 30}}, "optional_group": null, "applies_to_all_candidates": true, "answer_languages": ["hi"]}]}, {"stage": "interview", "counts_for_merit": true, "marks": 185, "shortlist_multiple": null, "answer_languages": [], "papers": []}], "sources": ["https://mppsc.mp.gov.in/uploads/syllabus/Exam_Plan_and_Syllabus_State_Service_Examination_2026_Dated_05_01_2026.pdf", "https://mppsc.mp.gov.in/uploads/advertisement/Advt_State_Service_Exam_2026_Dated_31_12_2025.pdf"], "unverified_notes": ["Structure changed materially for the 2026 cycle: prelims went 2 -> 3 marks/question (200 -> 300 per paper) and negative marking was introduced for the first time, stated by the Commission as the formula 3R-W (1 mark deducted per wrong answer, i.e. one third of a question''s marks).", "Qualifying threshold is 40% unreserved / 30% SC-ST-OBC-EWS-PwD and applies to EACH paper. The widely-copied ''33%'' is UPSC''s CSAT figure wrongly transplanted onto MPPSC.", "Pre-2024 figures (mains 1400, interview 175) could not be confirmed from a pre-2024 official document; the 1500/185/1685 set is confirmed from the official 2024-effective and 2026 plan PDFs. Many aggregators still publish the stale set.", "Marks are not fixed in the MP State Service Exam Rules 2015 (Rule 3(2)) — the Commission may revise the exam plan per cycle, so re-check the current year''s plan PDF before relying on these figures."]}'::jsonb,
   '{"summary_i18n": {"en": "Not available yet. We have mapped the exam pattern but have not yet ingested any MPPSC syllabus, questions or study material.", "hi": "अभी उपलब्ध नहीं। हमने परीक्षा पैटर्न दर्ज कर लिया है, परन्तु अभी तक कोई एमपीपीएससी पाठ्यक्रम, प्रश्न या अध्ययन सामग्री नहीं जोड़ी गई है।"}, "covered_i18n": [{"en": "Verified exam pattern and marks scheme (2026 cycle)", "hi": "सत्यापित परीक्षा पैटर्न एवं अंक योजना (2026 चक्र)"}], "not_covered_i18n": [{"en": "Syllabus tree", "hi": "पाठ्यक्रम संरचना"}, {"en": "Past-year question bank", "hi": "पिछले वर्षों के प्रश्नों का बैंक"}, {"en": "Study chapters", "hi": "अध्ययन अध्याय"}, {"en": "Hindi-medium Mains papers V and VI", "hi": "हिन्दी माध्यम मुख्य प्रश्नपत्र V एवं VI"}, {"en": "MP-specific current affairs", "hi": "एमपी-केंद्रित करेंट अफेयर्स"}]}'::jsonb, 3)
on conflict (exam_code) do update set
  display_name_i18n = excluded.display_name_i18n,
  is_live           = excluded.is_live,
  paper_structure   = excluded.paper_structure,
  launch_scope_i18n = excluded.launch_scope_i18n,
  sort_order        = excluded.sort_order;

-- ---------------------------------------------------------------------------
-- 2. syllabus_nodes.exam_code
-- ---------------------------------------------------------------------------
-- Every existing node is UPPSC, so the NOT NULL DEFAULT backfills all 294 rows
-- with no separate UPDATE.
alter table public.syllabus_nodes
  add column if not exists exam_code text not null default 'uppsc'
    references public.exams(exam_code) on update cascade;

comment on column public.syllabus_nodes.exam_code is
  'Which exam''s syllabus this node belongs to. paper_code remains globally unique across exams (see 0106 header) — this column is the explicit, filterable exam dimension, not a licence to reuse paper codes.';

-- Documentation-of-intent + defence in depth. The GLOBAL (paper_code, path)
-- index from 0018 is the real guarantee and is deliberately NOT dropped.
create unique index if not exists syllabus_nodes_exam_paper_path_key
  on public.syllabus_nodes(exam_code, paper_code, path);

-- Serves the unfiltered whole-table / all-paper-roots reads that are now
-- exam-scoped (papers grid, syllabus tree, weakness buckets, CA candidates).
create index if not exists syllabus_nodes_exam_depth_idx
  on public.syllabus_nodes(exam_code, depth, order_index);

-- ---------------------------------------------------------------------------
-- 3. users_profile.target_exam
-- ---------------------------------------------------------------------------
-- NOTE the deliberately-similar neighbour: `target_exam_year` (int, since 0003)
-- is WHICH YEAR the user is attempting. `target_exam` is WHICH EXAM. They are
-- unrelated; do not conflate them in a query or a form.
alter table public.users_profile
  add column if not exists target_exam text not null default 'uppsc'
    references public.exams(exam_code) on update cascade;

comment on column public.users_profile.target_exam is
  'Which exam this user is preparing for (FK exams.exam_code). Distinct from target_exam_year, which is the attempt YEAR. Drives every exam-scoped read on the user''s behalf.';

create index if not exists users_profile_target_exam_idx
  on public.users_profile(target_exam);

-- ---------------------------------------------------------------------------
-- 4. questions.exam_code — extend the 0036 CHECK to cover mppsc
-- ---------------------------------------------------------------------------
-- SEMANTIC WARNING, do not "unify" these two columns:
--   * questions.exam_code  = which exam ASKED this question. It is PROVENANCE.
--     Its domain deliberately includes exams we do NOT serve as products
--     (up_ro_aro, upsssc_pet, other) because their PYQs are ingested for
--     weightage-overlap analytics against the UPPSC syllabus.
--   * syllabus_nodes.exam_code = which exam's SYLLABUS a node belongs to. It is
--     PRODUCT SCOPE and FKs to exams.
-- A UPSC question mapped onto a UPPSC node is a legitimate, intended row.
-- Because of that overlap the domains differ, so questions.exam_code stays a
-- CHECK and is intentionally NOT an FK to exams.
--
-- 0036 shipped with 'mppsc' absent; adding it now so an MPPSC PYQ ingest is not
-- blocked by a constraint violation the moment U5 starts.
alter table public.questions
  drop constraint if exists questions_exam_code_check;
alter table public.questions
  add constraint questions_exam_code_check
    check (exam_code in ('uppsc', 'upsc', 'mppsc', 'up_ro_aro', 'upsssc_pet', 'other'));

-- ---------------------------------------------------------------------------
-- 5. tests.exam_code  — NEEDS-COLUMN (exam is NOT derivable)
-- ---------------------------------------------------------------------------
-- tests.paper_code is NULLABLE and 18 live daily_quiz rows have it NULL, so the
-- exam cannot be derived by joining paper_code -> syllabus_nodes for every row.
-- A test is also the anchor the whole attempt/analytics chain derives FROM
-- (attempts -> tests), so putting the column here is what makes attempts,
-- attempt_answers, personal_bests and the scoreboards exam-derivable without
-- a column of their own.
alter table public.tests
  add column if not exists exam_code text not null default 'uppsc'
    references public.exams(exam_code) on update cascade;

comment on column public.tests.exam_code is
  'Which exam this test belongs to. Required rather than derived because paper_code is nullable (daily_quiz). Everything downstream (attempts, attempt_answers, personal_bests, scoreboards) derives its exam from here.';

create index if not exists tests_exam_kind_idx
  on public.tests(exam_code, kind);

-- ---------------------------------------------------------------------------
-- 6. exam_calendar.exam_code  — NEEDS-COLUMN
-- ---------------------------------------------------------------------------
-- The dashboard/profile/study-plan "days until the exam" countdown reads the
-- next upcoming row by exam_stage alone. With three exams' dates in one table
-- that silently counts down to the WRONG exam. Not derivable — a calendar row
-- has no link to any exam-scoped parent.
alter table public.exam_calendar
  add column if not exists exam_code text not null default 'uppsc'
    references public.exams(exam_code) on update cascade;

comment on column public.exam_calendar.exam_code is
  'Which exam this scheduled date belongs to. Every countdown lookup MUST filter on it or it counts down to another exam''s date.';

drop index if exists exam_calendar_date_idx;
create index exam_calendar_date_idx
  on public.exam_calendar(exam_code, exam_stage, exam_date);

-- ---------------------------------------------------------------------------
-- 7. exam_cutoffs — resolve the exam_code NAMING COLLISION, then scope it
-- ---------------------------------------------------------------------------
-- 0041 named its PAPER-code column `exam_code` and stores 'PRE_GS1' in it. With
-- a real exam_code column now existing on five other tables, that name is an
-- actively dangerous trap: `.eq("exam_code", "uppsc")` against exam_cutoffs
-- returns zero rows, silently and with no error. Renamed to what it holds.
-- Guarded so a partial/re-run application does not fail: a bare RENAME errors
-- with "column exam_code does not exist" the second time through.
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'exam_cutoffs'
       and column_name = 'exam_code'
  ) and not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'exam_cutoffs'
       and column_name = 'paper_code'
  ) then
    alter table public.exam_cutoffs rename column exam_code to paper_code;
  end if;
end $$;

comment on column public.exam_cutoffs.paper_code is
  'The PAPER the cut-off is on (e.g. PRE_GS1 — UPPSC Prelims cut-off is on GS-I only). Renamed from exam_code in 0106; it never held an exam code.';

alter table public.exam_cutoffs
  add column if not exists exam_code text not null default 'uppsc'
    references public.exams(exam_code) on update cascade;

comment on column public.exam_cutoffs.exam_code is
  'Which exam these cut-offs are for. Genuinely an exam code, unlike the column that used to bear this name.';

-- Rebuild the key/index around the corrected column names.
alter table public.exam_cutoffs
  drop constraint if exists exam_cutoffs_exam_code_stage_year_category_key;
alter table public.exam_cutoffs
  add constraint exam_cutoffs_exam_paper_stage_year_category_key
    unique (exam_code, paper_code, stage, year, category);

drop index if exists exam_cutoffs_lookup_idx;
create index exam_cutoffs_lookup_idx
  on public.exam_cutoffs(exam_code, paper_code, stage, year);

-- ---------------------------------------------------------------------------
-- 8. tests: extend the daily-quiz uniqueness to include the exam
-- ---------------------------------------------------------------------------
-- 0078's `tests_daily_quiz_date_paper_key (scheduled_date, paper_code) where
-- kind='daily_quiz'` allows exactly ONE daily quiz per (date, paper). Two exams
-- building their own quiz on the same day would collide — the second build
-- fails with a unique violation. Widened to include the exam.
--
-- tests.slug's global uniqueness (0018/0020) needs NO change: slugs embed the
-- paper code ('pyq:PRE_GS1:2024'), and paper codes are globally unique across
-- exams by the invariant in this file's header, so a second exam's slugs are
-- namespaced automatically.
drop index if exists public.tests_daily_quiz_date_paper_key;
create unique index if not exists tests_daily_quiz_exam_date_paper_key
  on public.tests(exam_code, scheduled_date, paper_code)
  where kind = 'daily_quiz';

-- ---------------------------------------------------------------------------
-- 9. embeddings.exam_code — NEEDS-COLUMN for ANN correctness
-- ---------------------------------------------------------------------------
-- The exam IS derivable (source_id -> syllabus_nodes/notes/questions), but that
-- derivation cannot be applied to a vector search: `match_embeddings` (0027)
-- does `ORDER BY vector <=> query LIMIT k` against the HNSW index. Post-filtering
-- the top-k by exam destroys recall (the whole top-k can be another exam's
-- near-identical chapter), and joining before the ORDER BY defeats the index.
-- The filter has to be a cheap predicate on this table.
--
-- !! REQUIRED FOLLOW-UP, BLOCKING: this column alone does nothing. Before ANY
-- !! non-UPPSC content is embedded, `match_embeddings` must gain an exam filter
-- !! param and lib/embed-upsert.ts must stamp the real exam instead of relying
-- !! on this default. Until then a second exam's chunks would be written as
-- !! 'uppsc' and cited to UPPSC users by the mentor. See docs/multi-exam.md.
alter table public.embeddings
  add column if not exists exam_code text not null default 'uppsc'
    references public.exams(exam_code) on update cascade;

comment on column public.embeddings.exam_code is
  'Denormalized exam of the source row. Denormalized deliberately: a vector ANN search cannot be post-filtered or join-filtered without wrecking recall or the HNSW index. See the 0106 header — match_embeddings must filter on this before a second exam is embedded.';

create index if not exists embeddings_exam_locale_idx
  on public.embeddings(exam_code, locale, source_type);

-- ---------------------------------------------------------------------------
-- 10. doubt_faq_cache.exam_code — NEEDS-COLUMN (silent wrong-answer bug)
-- ---------------------------------------------------------------------------
-- This is a GLOBAL semantic answer cache keyed only by (embedding, locale, mode).
-- "Explain the amendment procedure" asked by an MPPSC user would hit a cached,
-- UPPSC-framed answer — complete with UPPSC PYQ references — at >= 0.95
-- similarity, served silently with no model call and no way for the user to
-- tell. Scoping the cache per exam is the only correct behaviour.
--
-- !! REQUIRED FOLLOW-UP, BLOCKING: `match_doubt_faq` (0070) must filter on this
-- !! column and `upsertFaqCache`'s near-duplicate lookup must include it in the
-- !! match, or the cache stays cross-exam in practice.
alter table public.doubt_faq_cache
  add column if not exists exam_code text not null default 'uppsc'
    references public.exams(exam_code) on update cascade;

comment on column public.doubt_faq_cache.exam_code is
  'Which exam the cached answer was framed for. Without it the cache serves one exam''s framing to another exam''s user, silently and with no model call.';

-- ---------------------------------------------------------------------------
-- 11. current_affairs_items — MULTI-EXAM by design (verified, not assumed)
-- ---------------------------------------------------------------------------
-- DECISION: one CA item MAY map to nodes of MULTIPLE exams. A national budget /
-- IR / environment story is genuinely relevant to all three; only
-- `is_up_specific` items are near-exclusive to UPPSC.
--
-- VERIFIED (0009, re-checked against the live table): the node linkage is
-- `syllabus_node_ids uuid[]`, a bare array with no FK and no cardinality
-- constraint — NOT a scalar and NOT a join table. Because node ids are unique
-- and each node is now exam-scoped, one array can legitimately hold nodes from
-- several exams' trees with no schema change. `node_significance` is already a
-- jsonb map keyed BY NODE ID, so per-exam significance copy also already works.
-- So the existing mapping does support multi-exam, exactly as hoped.
--
-- The one thing it does NOT support is an efficient "CA relevant to MY exam"
-- feed: that would need a containment scan against a per-exam node id set on
-- every list query. Hence the denormalized relevance array below — it is a
-- query-path optimisation, not a second source of truth. Deliberately an ARRAY,
-- not a scalar: a scalar would force duplicating every national item once per
-- exam and re-paying the triage + enrich LLM cost per copy.
alter table public.current_affairs_items
  add column if not exists exam_codes text[] not null default array['uppsc']::text[];

comment on column public.current_affairs_items.exam_codes is
  'Which exams this item is relevant to (denormalized from syllabus_node_ids -> nodes -> exam, for the feed query path). Array, not scalar: one national story is legitimately relevant to several exams and must NOT be duplicated per exam.';

create index if not exists current_affairs_items_exam_codes_idx
  on public.current_affairs_items using gin (exam_codes);

-- NOTE (not changed here, flagged): `gs_papers text[]` assumes UPPSC's GS1-6
-- numbering and `is_up_specific` assumes UP. Both need generalising when a
-- second exam's CA actually runs; left alone rather than half-migrated.

-- ---------------------------------------------------------------------------
-- 12. discussion_threads.exam_code — NEEDS-COLUMN (nullable = cross-exam)
-- ---------------------------------------------------------------------------
-- The exam derives in principle, but `anchor_id` is polymorphic across four
-- tables with NO foreign key, so deriving it means a 4-way conditional join on
-- every hub list query — and the hot index is
-- `(updated_at desc) where moderation_status='visible'`, which an exam
-- predicate must live inside to stay cheap.
--
-- NULLABLE on purpose: null means "not exam-specific" (a general prep-strategy
-- thread), which stays visible to everyone. Only anchored threads carry a code.
alter table public.discussion_threads
  add column if not exists exam_code text
    references public.exams(exam_code) on update cascade;

comment on column public.discussion_threads.exam_code is
  'Exam this thread belongs to; NULL = a general, cross-exam thread visible to all. Denormalized because anchor_id is polymorphic with no FK, so deriving it would mean a 4-way join on the hub feed.';

create index if not exists discussion_threads_exam_visible_idx
  on public.discussion_threads(exam_code, updated_at desc)
  where moderation_status = 'visible';

-- ---------------------------------------------------------------------------
-- 13. Tables deliberately given NO exam column — decisions on the record
-- ---------------------------------------------------------------------------
-- notes (study chapters) — DERIVES-EXAM via `syllabus_node_id` (NOT NULL,
--   UNIQUE). No column added. CONSEQUENCE, stated plainly rather than buried:
--   because that UNIQUE is per node and node trees are per exam, the 284
--   fact-audited chapters would be DUPLICATED per exam — roughly 90% identical
--   content at 3x the authoring and fact-audit cost. The alternative (exam-
--   agnostic chapter bodies + a note_syllabus_nodes join table + a per-exam
--   state-angle overlay, replacing the hardcoded `up_angle`) drops the UNIQUE
--   and touches notes:embed, the reader, the review queue and getPaperSummaries'
--   coverage counts. That is a content-strategy call with a real cost attached,
--   NOT a mechanical schema fix, so it is deliberately NOT decided here.
--
-- attempts / attempt_answers / answer_test_sessions / personal_bests /
--   daily_quiz_board_entries — DERIVES-EXAM via `test_id -> tests.exam_code`,
--   which is precisely why tests carries the column (section 5). One caveat:
--   `attempts.test_id` is nullable for ad-hoc `meta.question_ids` sets; those
--   rows fall back to the owner's `users_profile.target_exam`.
--
-- node_mastery / generation_batches / question_reports / question_audits /
--   question_model_answers / evaluations / evaluation_translations —
--   DERIVES-EXAM via a node or question FK. No column.
--
-- srs_cards / srs_reviews — USER-SCOPED and intentionally EXAM-AGNOSTIC. A
--   revision card is the user's own memory of a fact; a user who switches exams
--   should keep their deck, not lose it. `source_id` is polymorphic-by-
--   convention, so a scalar exam column would also be unenforceable.
--
-- study_plans / daily_stats / drill_sessions / milestones / events /
--   learner_profiles / mentor_insights / user_notes / notification_schedule /
--   push_* / trial_starts / feature_first_touch — USER-SCOPED. The user has one
--   `target_exam`; these follow it. NOTE this makes single-exam-at-a-time an
--   explicit product decision, reinforced by two pre-existing keys:
--   `study_plans unique(user_id) where is_active` and
--   `daily_quiz_board_entries unique(user_id, quiz_date)`.
--
-- plans / subscriptions / billing_events — EXAM-AGNOSTIC. One product, one
--   price ladder across exams (see docs/OUTSTANDING.md §7). Revisit only with
--   an explicit pricing decision.
--
-- reports / user_blocks / post_screenings / community_authors — EXAM-AGNOSTIC.
--   Moderation is one queue and one blocklist regardless of exam.
--
-- llm_calls / ca_triage_batches / generation telemetry — EXAM-AGNOSTIC ops data.
--
-- mv_node_weightage — ALREADY CORRECT, do not "fix" it. Its grain is
--   (node_id, exam_code, year) where exam_code is the ASKING exam, which is
--   exactly "how often does exam X ask topic Y" and supports the genuinely
--   useful cross-exam view (UPSC frequency on a UPPSC node). The owning exam
--   derives from node_id.
--
-- mv_test_leaderboard / mv_mock_series_board / scoreboard_rank_snapshots —
--   safe as keyed, BECAUSE of the global paper-code uniqueness invariant
--   (mv_mock_series_board is keyed on (paper_code, user_id), and board_key
--   stores a raw paper_code). If that invariant is ever dropped, these merge
--   two exams' boards silently. One more reason not to drop it.
--
-- mv_mains_weekly_board — KNOWN GAP, not fixed here. It has no exam dimension
--   and would rank three exams' answer-writing against each other. Fixing it
--   needs the rubric registry to gain an exam dimension too (the
--   `rubric_version <> 'essay-v1'` split is hardcoded in 0069 and
--   services/scoreboard.ts). Blocking before a second exam goes live; tracked
--   in docs/multi-exam.md.

-- ---------------------------------------------------------------------------
-- 14. RLS for the new table (0053 content-table pattern)
-- ---------------------------------------------------------------------------
-- `exams` is public reference data: readable by anon + authenticated (the exam
-- picker and the coverage page render pre-auth), writable by NOBODY except the
-- service role — no write policy is created, exactly like syllabus_nodes /
-- exam_calendar / exam_cutoffs in 0053. Grants come from 0015's default
-- privileges, and 0053 already revoked insert/update/delete from anon.
alter table public.exams enable row level security;

create policy content_read on public.exams
  for select to anon, authenticated using (true);
