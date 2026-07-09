-- Real UPPSC Prelims GS-I marking is fractional: 150 questions summing to
-- 200 marks = 1.33 marks per correct answer (verified via web search,
-- cross-confirmed across independent sources; matches the app's existing
-- -0.33 negative-marking constant in ingest/tests.ts). The int columns below
-- can't represent that — widen to numeric(6,2), which still holds every
-- existing whole-number value unchanged.
alter table questions alter column marks type numeric(6,2);
alter table tests alter column total_marks type numeric(6,2);
alter table test_questions alter column marks type numeric(6,2);
