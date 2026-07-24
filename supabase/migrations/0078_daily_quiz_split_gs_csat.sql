-- 0078_daily_quiz_split_gs_csat.sql
-- The daily quiz is split into TWO papers per day — a GS quiz (paper_code
-- 'PRE_GS1') and a CSAT quiz (paper_code 'PRE_CSAT') — instead of one blended
-- set. 0024's `tests_daily_quiz_scheduled_date_key` enforced exactly ONE
-- daily_quiz row per date, which now has to become one-per-(date, paper).
--
-- Replace the single-column partial unique index with a two-column one so a
-- GS and a CSAT daily_quiz can coexist on the same scheduled_date. Legacy
-- pre-split rows carry paper_code = NULL; Postgres treats NULLs as distinct in
-- a unique index, so an old blended (date, NULL) row never collides with the
-- new (date, 'PRE_GS1') / (date, 'PRE_CSAT') rows — backward compatible with
-- every historical daily quiz (their attempts/scores still render unchanged;
-- see daily/quiz.ts). No new null-paper daily quizzes are ever created going
-- forward, so the NULL-distinctness is a compatibility escape hatch, not a
-- double-booking loophole in practice.
--
-- daily_quiz_board_entries (0067) is deliberately left as-is: the competitive
-- daily-quiz scoreboard tracks the GS quiz ONLY (CSAT is qualifying-only in the
-- real exam and not merit-ranked — see services/scoreboard.ts recordDailyQuizResult),
-- so its unique (user_id, quiz_date) stays valid — at most one (GS) entry per
-- user per day.

drop index if exists public.tests_daily_quiz_scheduled_date_key;

create unique index if not exists tests_daily_quiz_date_paper_key
  on public.tests(scheduled_date, paper_code)
  where kind = 'daily_quiz' and scheduled_date is not null;
