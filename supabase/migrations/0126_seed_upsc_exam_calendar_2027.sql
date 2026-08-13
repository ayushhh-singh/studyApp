-- 0126_seed_upsc_exam_calendar_2027.sql
-- Seed the UPSC Civil Services 2027 Prelims and Mains dates into exam_calendar.
--
-- WHY NOW: `exam_calendar` held exactly ONE row (uppsc / prelims / 2026-12-06,
-- seeded by 0023). `upsc` went live 2026-08-11, so every UPSC user's countdown
-- surfaces — dashboard greeting, profile card, learner profile, study plan —
-- were correctly returning NO countdown at all (`pickNextExam` finds no row for
-- their exam and returns null, which lib/exam-calendar.ts documents as the
-- honest outcome). This gives them a real one. It is also the anchor the test
-- series generator reads (docs/test-series-design.md §13).
--
-- ---------------------------------------------------------------------------
-- PROVENANCE — read from the commission's own PDF, not from an aggregator and
-- not from memory (CLAUDE.md's standing exam-date rule; the same policy as
-- 0023's UPPSC seed and 0106's paper_structure).
--
--   Source: UNION PUBLIC SERVICE COMMISSION,
--           "PROGRAMME OF EXAMINATIONS/RECRUITMENT TESTS (RTs) - 2027",
--           printed "As on 20.05.2026".
--   URL:    https://www.upsc.gov.in/sites/default/files/Calendar-Year-2027-Engl-200526.pdf
--           (the `www.` prefix is MANDATORY — the bare upsc.gov.in host answers
--            /sites/default/files/* with HTTP 200 + text/html soft-404 content,
--            a failure that masquerades as success. See CLAUDE.md's U5 note.)
--   Fetched and text-extracted 2026-08-14; verified 200 + application/pdf +
--   %PDF magic bytes before reading.
--
-- The two rows, VERBATIM from that table:
--
--   Sl. 9/10  Civil Services (Preliminary) Examination, 2027
--             Date of Notification ......... 13.01.2027
--             Last date for applications ... 02.02.2027
--             Date of commencement ......... 23.05.2027 (Sunday)
--             Duration ..................... 1 DAY
--
--   Sl. 19    Civil Services (Main) Examination, 2027
--             Date of commencement ......... 20.08.2027 (Friday)
--             Duration ..................... 5 DAYS
--
-- `is_tentative` is FALSE for both: these are the commission's own published
-- annual-calendar dates, the same standing 0023 gives UPPSC's. The PDF's closing
-- line — "The dates of notification, commencement and duration of Examinations/
-- RTs are liable to alteration, if the circumstances so warrant." — is the
-- boilerplate every commission calendar carries, not a marker of a provisional
-- date; it is recorded in notes_i18n so a reader sees it rather than inferring
-- more certainty than the source offers.
--
-- ---------------------------------------------------------------------------
-- ⚑ THE UPPSC MAINS DATE IS DELIBERATELY *NOT* SEEDED, AND THAT IS THE FINDING.
--
-- docs/test-series-design.md §13 lists it as "~late Mar 2027 (est.)" and marks
-- it an estimate. Researched 2026-08-14: **no official UPPSC Mains date exists
-- for the PCS 2026 cycle** (the cycle whose Prelims is the 2026-12-06 row).
--   * UPPSC's published exam calendar covers 2026 and contains no Mains for a
--     December-2026 Prelims — arithmetically impossible, Mains follows months later.
--   * No UPPSC 2027 annual calendar has been released (UPPSC publishes it in
--     January; today is August 2026).
--   * UPPSC announces Mains dates only AFTER the Preliminary result is declared.
--   * Aggregators reporting "UPPSC PCS Mains 29 Mar - 1 Apr" are quoting the
--     PREVIOUS cycle, already past. They contradict each other on the current one.
-- Seeding an unsourced date — even flagged tentative — would put an estimate
-- into a table whose entire convention is "official sources only", and would
-- feed a wrong countdown to every UPPSC user. A missing row is the honest
-- outcome and the read path already handles it (no countdown, never another
-- exam's date). Seed it when the commission announces it.
--
-- ---------------------------------------------------------------------------
-- REPLAYABLE (docs/OUTSTANDING.md M14): `exam_calendar` carries no uniqueness
-- constraint, so a bare INSERT would duplicate these rows on a re-run and give
-- the countdown two candidate rows for one exam+stage+year. Guarded with NOT
-- EXISTS on (exam_code, exam_stage, year) rather than by adding a unique index:
-- a re-examination or a split sitting is a legitimate reason for two rows at
-- that key, so the constraint would be wrong as a schema-level rule even though
-- it is right as a guard for these two specific seeds.

insert into public.exam_calendar (exam_code, exam_stage, title_i18n, exam_date, year, is_tentative, notes_i18n)
select
  'upsc',
  'prelims'::exam_stage,
  '{"en": "UPSC Civil Services Prelims 2027", "hi": "यूपीएससी सिविल सेवा प्रारंभिक परीक्षा 2027"}'::jsonb,
  '2027-05-23'::date,
  2027,
  false,
  '{"en": "Per the official UPSC Annual Calendar 2027 (as on 20 May 2026): commences 23.05.2027 (Sunday), 1 day. Notification 13.01.2027; applications close 02.02.2027. UPSC notes calendar dates are liable to alteration.", "hi": "आधिकारिक यूपीएससी वार्षिक कैलेंडर 2027 के अनुसार (20 मई 2026 की स्थिति): परीक्षा 23.05.2027 (रविवार), अवधि 1 दिन। अधिसूचना 13.01.2027; आवेदन की अंतिम तिथि 02.02.2027। यूपीएससी के अनुसार कैलेंडर की तिथियाँ परिवर्तनीय हैं।"}'::jsonb
where not exists (
  select 1 from public.exam_calendar
  where exam_code = 'upsc' and exam_stage = 'prelims' and year = 2027
);

insert into public.exam_calendar (exam_code, exam_stage, title_i18n, exam_date, year, is_tentative, notes_i18n)
select
  'upsc',
  'mains'::exam_stage,
  '{"en": "UPSC Civil Services Mains 2027", "hi": "यूपीएससी सिविल सेवा मुख्य परीक्षा 2027"}'::jsonb,
  '2027-08-20'::date,
  2027,
  false,
  '{"en": "Per the official UPSC Annual Calendar 2027 (as on 20 May 2026): commences 20.08.2027 (Friday) and runs 5 days. The date stored is the day the examination begins. UPSC notes calendar dates are liable to alteration.", "hi": "आधिकारिक यूपीएससी वार्षिक कैलेंडर 2027 के अनुसार (20 मई 2026 की स्थिति): परीक्षा 20.08.2027 (शुक्रवार) से आरंभ, अवधि 5 दिन। संग्रहीत तिथि परीक्षा प्रारंभ का दिन है। यूपीएससी के अनुसार कैलेंडर की तिथियाँ परिवर्तनीय हैं।"}'::jsonb
where not exists (
  select 1 from public.exam_calendar
  where exam_code = 'upsc' and exam_stage = 'mains' and year = 2027
);

-- Assert the end state rather than claiming it. True on a first apply AND on a
-- replay, so this migration is genuinely re-runnable (M14).
do $$
declare
  n_pre  int;
  n_main int;
  n_dup  int;
begin
  select count(*) into n_pre from public.exam_calendar
    where exam_code = 'upsc' and exam_stage = 'prelims' and exam_date = '2027-05-23';
  select count(*) into n_main from public.exam_calendar
    where exam_code = 'upsc' and exam_stage = 'mains' and exam_date = '2027-08-20';
  if n_pre <> 1 or n_main <> 1 then
    raise exception '0126: expected exactly 1 upsc prelims 2027-05-23 row and 1 upsc mains 2027-08-20 row, found % and %', n_pre, n_main;
  end if;

  -- A second row at the same (exam_code, exam_stage, year) would make the
  -- countdown's "soonest upcoming row" depend on insert order.
  select count(*) into n_dup from (
    select 1 from public.exam_calendar
    group by exam_code, exam_stage, year having count(*) > 1
  ) d;
  if n_dup > 0 then
    raise exception '0126: % duplicate (exam_code, exam_stage, year) group(s) in exam_calendar', n_dup;
  end if;

  -- The uppsc row 0023 seeded must be untouched by this migration.
  if not exists (
    select 1 from public.exam_calendar
    where exam_code = 'uppsc' and exam_stage = 'prelims' and exam_date = '2026-12-06'
  ) then
    raise exception '0126: the uppsc prelims 2026-12-06 row (0023) is missing';
  end if;
end $$;
