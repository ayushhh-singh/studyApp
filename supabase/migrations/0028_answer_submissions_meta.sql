-- 0028_answer_submissions_meta.sql
-- Add a free-form meta JSONB to answer_submissions (mirrors the meta columns on
-- questions/tests/syllabus_nodes from 0018). The evaluation engine uses it to
-- carry the optional word_limit / marks supplied with a *custom* prompt from the
-- POST /answers/submissions request through to the later SSE evaluation request
-- (there is no catalogued question row to read those from). Additive; existing
-- rows default to '{}'.

alter table public.answer_submissions
  add column if not exists meta jsonb not null default '{}'::jsonb;
