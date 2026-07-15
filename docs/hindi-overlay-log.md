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
