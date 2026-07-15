# Real-source Hindi overlay — run log

The Hindi side of every UPPSC PYQ was originally **regenerated from the clean
English via machine translation** (the source PDFs encode Hindi in a legacy
non-Unicode font whose text layer is mojibake — see `apps/api/src/ingest/pyq.ts`
and CLAUDE.md), and flagged `meta.machine_translated=true`. The Hindi glyphs are
still printed on the page, so a **visual read** of the rasterized page recovers
UPPSC's own wording. `pnpm ingest:hindi-overlay` merges + validates those
subagent vision-reads against the live DB rows and overlays the source Hindi.

Since the questions table is not version-controlled, this file is the git
provenance trail for each overlay run: what paper, how many rows were replaced,
and which were deliberately left machine-translated (and why).

## Provenance model
`meta.hindi_source` on every processed (published, MCQ) row:
- `source_extracted` — Hindi is UPPSC's own printed wording (read from the source
  PDF, English cross-checked per option key). `machine_translated` set to `false`.
- `machine_translated` — could not be confidently replaced; stays flagged and in
  the Review Queue's machine-translated tab.

Language-neutral **code options** (e.g. `"3, 1, 4, 2"`, `"A-1, B-2, C-3, D-4"`)
are printed identically in both columns; their Hindi is retained as-is (never
overwritten → no format drift vs the untouched English), and alignment is
verified by matching the answer digit sequence per key (a strict permutation
guard). Only the stem and textual options carry real bilingual Hindi to overlay.

## Precondition
Only run against a source PDF that is a genuine Hindi+English printed bilingual
original. English-only sources have no Hindi to read and stay machine-translated.

---

## Runs

### PRE_GS1 2024 — 2026-07-13
- Source: `content-raw/pyq_prelims/uppsc_prelims_2024_gs1.pdf` (Drishti, `lang: both`,
  clean two-column Hindi-left/English-right; bilinguality visually verified).
- Read: 6 overlapping vision-read subagents (≤~32 Q each), 200 DPI page rasters.
- Targets (published MCQ, machine-translated): **132**.
- **Accepted (source-extracted): 125** — 344 option-Hindi strings overlaid, 156
  language-neutral code options kept. Double-read verified: 19; single-read: 106.
- Integrity: 0 option-count/key-order drift, `correct_option_key` valid on all,
  0 empty/illegible strings in output.
- **Left machine-translated: 7**
  - q81, q88, q105 — Hindi genuinely illegible on the page (honesty, not a guess).
  - q50, q84, q94 — **pre-existing DB corruption**: option key stored as `","`.
  - q19 — **pre-existing DB corruption**: option D English is `","` (content lost
    at the original 2024 ingest).

### PRE_GS1 2019 — 2026-07-13
- Source: `content-raw/pyq_prelims/uppcs prelims gs1 2019.pdf` (Drishti two-column
  Hindi/English bilingual; verified).
- Read: 6 overlapping vision-read subagents (≤~30 Q each), 200 DPI.
- Targets: **150** → **accepted 147**, double-read verified 30.
- Integrity: 0 drift, correct_option_key valid on all.
- **Left machine-translated: 3** — all AGENT vision misreads correctly caught by
  the English/code cross-check (not DB corruption):
  - q38 — agent misread a match-code digit (D-4 read as D-1).
  - q46 — agent misread option C "Wheat" as "When".
  - q79 — agent misread option C "Sochi" as "Sachi".

### PRE_GS1 2020 — 2026-07-13
- Source: `content-raw/pyq_prelims/uppcs prelims gs1 2020.pdf` (Drishti two-column
  bilingual).
- Read: 6 overlapping vision-read subagents, 200 DPI.
- Targets: **150** → **accepted 150** (100%), double-read verified 28.
- Integrity: 0 drift, correct_option_key valid on all. 0 left machine-translated.

### PRE_GS1 2021 — 2026-07-13
- Source: `content-raw/pyq_prelims/uppcs prelims gs1 2021.pdf` (Drishti two-column
  bilingual). (Live target count had grown to 144 by run time — a concurrent
  re-gate published more 2021 rows; the tool loads live targets, so it processed
  all 144.)
- Read: 5 overlapping vision-read subagents, 200 DPI.
- Targets: **144** → **accepted 132**, double-read verified 26.
- Integrity: 0 drift, correct_option_key valid on all.
- **Left machine-translated: 12**
  - q103, q105 — Hindi illegible on the page (honesty).
  - q15 — agent folded the matched-list items into the stem (stem-structure
    mismatch vs the shorter DB stem); left to avoid stem drift.
  - q34, q38, q50, q54, q61, q79, q81, q99, q107 — **pre-existing DB data bug:
    the row stores only 2–3 options (A,B or A,B,C) while the printed paper has 4.**
    Options C/D were dropped at the original 2021 ingest; the overlay correctly
    refuses to map 4 read options onto a truncated row. Flagged for a separate
    option-completeness repair (see docs/OUTSTANDING.md).

### PRE_CSAT 2024 — 2026-07-13
- Source: `content-raw/pyq_prelims/uppsc_prelims_2024_csat.pdf` (Drishti). **Mixed
  layout** (verified page-by-page): a Hindi-language section (Hindi-only, both
  columns), an English-language section (English-only), and a bilingual
  aptitude/reasoning/quant section (two-column, English-left/Hindi-right).
- Read: 4 subagents; the prompt marks single-language questions (no bilingual
  pair) so they are excluded from the cross-checked overlay.
- Targets: **99** → **accepted 52** (the bilingual section), double-read 15.
- **Left machine-translated: 47**
  - q1–45 — single-language sections (Hindi-only language test q1–25;
    English-only language test q26–45). No parallel-language column, so the
    per-option English cross-check that guards key alignment can't run — left
    flagged by design (their Hindi may be authentic but needs a different,
    content-matched pass; see docs/OUTSTANDING.md).
  - q48, q66 — geometry questions where the agent folded a "[diagram: …]"
    description into the stem; left rather than store an agent annotation.
- Tool improvement this run: `norm()` now folds superscript/subscript digits and
  degree/ordinal marks (e.g. "2x³" ≡ "2x3", "120°" ≡ "120º") so quant options
  aren't false-rejected — rescued 2 questions.

### PRE_CSAT 2022 — 2026-07-13
- Source: `content-raw/pyq_prelims/uppcs prelims csat 2022.pdf` (Drishti). Only
  **1** published MCQ was machine-translated (q53, a reasoning odd-one-out in the
  bilingual section).
- Targets: **1** → **accepted 1**. (Source print discrepancy: Hindi option (c)
  prints "CJ 17" vs English "GJ 17"; transcribed verbatim, honesty over guessing.)

## Option-completeness repair — 2026-07-13
The overlay surfaced (did not cause) 13 pre-existing corrupted rows that it
safely refused to overlay; repaired them as a follow-up after **visually
verifying the reconstructed options against the source pages** (q34, q38, q19
spot-checked pixel-for-pixel):
- **GS1 2024 q50/q84/q94** — option A's key was stored as `","`; relabeled to `A`
  (English text was already correct; kept it, added source Hindi).
- **GS1 2024 q19** — option D's English content had been lost (`","`); restored
  "Decrease of temperature by 4°C in the Indian Ocean" + Hindi from the read.
- **GS1 2021 q34/q38/q50/q54/q61/q79/q81/q99/q107** — rows stored only 2–3 of 4
  options (options dropped at the original 2021 ingest); restored the full 4-option
  set (English + Hindi) from the vision read.
Guard: reconstructed from the aligned vision read only where the existing DB
options matched the read positionally; kept authoritative DB English for options
that already had real content, restored agent English only for the lost/missing
ones; `correct_option_key` re-verified valid in the new A/B/C/D keys for all 13.
All 13 now `hindi_source='source_extracted'`, `meta.option_completeness_repaired=true`.

## Totals (2026-07-13)
Across the six processed prelims papers: **620 published MCQ rows
source-extracted** (607 Hindi-overlay + 13 option-completeness repairs) and re-flagged `hindi_source='source_extracted'`; the
remainder left `hindi_source='machine_translated'` (illegible spans,
single-language CSAT language-test sections, agent misreads correctly caught by
the cross-check, and pre-existing DB corruption). Per-paper: GS1 2024 125/132,
GS1 2019 147/150, GS1 2020 150/150, GS1 2021 132/144, CSAT 2024 52/99,
CSAT 2022 1/1.
