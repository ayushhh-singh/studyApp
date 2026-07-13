-- 0074_key_provenance.sql
-- KEY-PROVENANCE trust layer for the PYQ answer-key publish gate.
--
-- Background (docs/OUTSTANDING.md A4): CSAT (comprehension/reasoning/quant) items
-- can't be reliably re-solved blind (without the passage), so the Session-27
-- blind-resolve gate flagged/held many CSAT questions even when a real answer key
-- existed. The fix is to make the publish gate trust a VERIFIED OFFICIAL-COMMISSION
-- key directly (publish on key-match + bilingual completeness alone), while KEEPING
-- the blind-resolve corroboration requirement for lower-trust coaching-reproduced
-- keys. An official key IS the ground truth — requiring an unreliable independent
-- solve to agree with ground truth was the bug. This is applied uniformly by key
-- provenance, not CSAT-special-cased (see services/... pyq-load.ts decideReview).
--
--   key_provenance  where the answer key APPLIED to this question came from:
--     'official_commission' — an official UPPSC / commission answer-key PDF
--                             downloaded directly (content-raw/answer_key/*.pdf),
--                             per booklet series. Authoritative ground truth.
--     'coaching_reproduced' — a single-series key reproduced by a coaching site
--                             (theexampillar keymaps). Less trustworthy → still
--                             gated on blind-resolve corroboration.
--     'none'                — no answer key was sourced for this question at all
--                             (its correct_option_key, if any, is a blind proposal).
--
-- This is the audit trail of the KEY SOURCE and is orthogonal to
-- meta.answer_key_verified (whether a verified key was actually APPLIED — e.g. the
-- 2021 GS-I official key existed but was series-MISALIGNED and stripped, so it is
-- provenance='official_commission' yet answer_key_verified=false → falls through to
-- the blind gate, which is exactly the item-3 safety net).

-- ---------------------------------------------------------------------------
-- key_provenance enum + column
-- ---------------------------------------------------------------------------
create type key_provenance as enum ('official_commission', 'coaching_reproduced', 'none');

alter table public.questions
  add column key_provenance key_provenance not null default 'none';

comment on column public.questions.key_provenance is
  'Provenance of the answer key applied to this question: official_commission (official UPPSC/commission PDF) | coaching_reproduced (theexampillar single-series keymap) | none. Drives the publish gate together with meta.answer_key_verified (migration 0074).';

-- ---------------------------------------------------------------------------
-- Backfill from the documented, evidence-based key sourcing (CLAUDE.md Session
-- 27.5 + the official answer-key PDFs actually present in content-raw/answer_key/).
-- Must stay in lock-step with keyProvenanceFor() in
-- apps/api/src/ingest/key-provenance.ts (the source of truth for FUTURE loads).
-- Only prelims MCQ papers carry answer keys; Mains descriptive keeps 'none'.
-- ---------------------------------------------------------------------------

-- official_commission: an official commission answer-key PDF was downloaded for
-- this (paper, year). content-raw/answer_key/: GS1 {2019,2020,2021,2023,2024},
-- CSAT {2024}. (2021 GS-I's official key was later stripped as series-misaligned,
-- but its SOURCE was still official — the gate handles that via answer_key_verified.)
update public.questions
   set key_provenance = 'official_commission'
 where type = 'mcq'
   and (
     (paper_code = 'PRE_GS1'  and year in (2019, 2020, 2021, 2023, 2024)) or
     (paper_code = 'PRE_CSAT' and year in (2024))
   );

-- coaching_reproduced: the applied/available key came from a theexampillar
-- single-series keymap (no official PDF). GS1 {2018,2025}, CSAT {2019-2023}.
update public.questions
   set key_provenance = 'coaching_reproduced'
 where type = 'mcq'
   and (
     (paper_code = 'PRE_GS1'  and year in (2018, 2025)) or
     (paper_code = 'PRE_CSAT' and year in (2019, 2020, 2021, 2022, 2023))
   );

-- Everything else stays 'none' (default): GS1 2022 + null-year, CSAT 2018 +
-- 2025 + null-year (no key sourced), and all Mains descriptive papers.

-- ---------------------------------------------------------------------------
-- Safety-net flag reason: a SYSTEM-generated "AI blind-resolve disagrees with the
-- official-commission key" flag lands in the same admin Review Queue as user
-- reports (services/question-reports.ts), but is distinct from a user complaint —
-- it is inserted with user_id=null and this dedicated reason (item 3). It never
-- blocks publish for an official key; it only surfaces the disagreement for a human.
-- ---------------------------------------------------------------------------
alter type question_report_reason add value if not exists 'ai_key_dispute';
