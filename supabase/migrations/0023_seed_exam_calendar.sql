-- 0023_seed_exam_calendar.sql
-- Verified via web search on 2026-07-05 across multiple independent sources
-- (theiashub.com, pw.live, adda247.com, drishtiias.com, examdetail.in — all
-- cross-checking each other) citing the official UPPSC exam calendar
-- released 2026-01-30 and the Combined State/Upper Subordinate Services
-- (PCS) 2026 notification released 2026-06-25: the Preliminary Examination
-- is scheduled for 2026-12-06. NOT seeded from memory — see CLAUDE.md.

insert into public.exam_calendar (exam_stage, title_i18n, exam_date, year, is_tentative, notes_i18n)
values (
  'prelims',
  '{"hi": "यूपीपीएससी प्रारंभिक परीक्षा 2026", "en": "UPPSC Prelims 2026"}'::jsonb,
  '2026-12-06',
  2026,
  false,
  '{"hi": "आधिकारिक परीक्षा कैलेंडर के अनुसार (जारी: 30 जनवरी 2026)।", "en": "Per the official UPPSC exam calendar (released 30 Jan 2026)."}'::jsonb
);
